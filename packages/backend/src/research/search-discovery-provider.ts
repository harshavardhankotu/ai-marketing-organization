import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { isPlaceholderCredential, isProduction } from '../config/env.js';

export interface SearchResultItem {
  title: string;
  link: string;
  snippet: string;
  displayLink?: string;
  pagemap?: any;
}

export type SearchProviderType = 'cache' | 'google_custom_search' | 'tavily_search' | 'fixture_test';

export interface SearchDiscoveryResponse {
  query: string;
  normalizedQuery: string;
  cached: boolean;
  provider: SearchProviderType;
  resultsCount: number;
  items: SearchResultItem[];
  rawResponse: any;
  logId: string;
  latencyMs: number;
}

export interface SearchDiscoveryOptions {
  sector?: string;
  businessId?: string;
  escalateToTavily?: boolean;
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export class SearchQuotaExceededError extends Error {
  public readonly code = 'RESEARCH_PAUSED_QUOTA_REACHED';
  constructor(message: string) {
    super(message);
    this.name = 'SearchQuotaExceededError';
  }
}

export class SearchConfigurationError extends Error {
  public readonly code = 'SEARCH_CONFIGURATION_MISSING';
  constructor(message: string) {
    super(message);
    this.name = 'SearchConfigurationError';
  }
}

/**
 * SearchDiscoveryProvider — Resilient Multi-Provider Search & Research Engine
 *
 * Implements strict hierarchy:
 * 1. Cached D1/SQLite results (24-hour TTL by normalized query + optional sector).
 * 2. Google Custom Search JSON API first (under 60/day free cap, managed via UnifiedQuotaService).
 *    Note: Abstracted so that when Google Custom Search sunsets in Jan 2027, switching to its successor
 *    requires zero changes in callers.
 * 3. Tavily Search API only as fallback / deep-research escalation (strictly capped at <= 750/mo and <= 20/day).
 * 4. Zero fabricated results; test fixture fallback hermetically used in test mode.
 */
export class SearchDiscoveryProvider {
  private static instance: SearchDiscoveryProvider;
  private d1Repo = D1RevenueRepository.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();

  public static getInstance(): SearchDiscoveryProvider {
    if (!SearchDiscoveryProvider.instance) {
      SearchDiscoveryProvider.instance = new SearchDiscoveryProvider();
    }
    return SearchDiscoveryProvider.instance;
  }

  public normalizeQuery(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private isTestOrPlaceholder(val?: string): boolean {
    if (!val) return true;
    if (isPlaceholderCredential(val)) return true;
    const lower = val.toLowerCase();
    return lower.startsWith('tvly-test') || lower.includes('fixture') || lower.startsWith('test') || lower.includes('placeholder');
  }

  public async search(query: string, options: SearchDiscoveryOptions = {}): Promise<SearchDiscoveryResponse> {
    const startMs = Date.now();
    const normalizedQuery = this.normalizeQuery(query);
    const cacheKey = options.sector ? `${options.sector.toLowerCase()}:${normalizedQuery}` : normalizedQuery;
    const logId = `search_log_${randomUUID().substring(0, 12)}`;
    const maxResults = options.maxResults || 10;

    // 1. PRIORITY 1: Check D1 / SQLite 24-Hour Cache (expires_at > datetime('now'))
    try {
      const db = getDb();
      const cachedRow = db.prepare(`
        SELECT raw_response_json, results_count, provider, created_at, expires_at
        FROM search_cache
        WHERE (query_normalized = ? OR query_normalized = ?) AND expires_at > datetime('now')
        ORDER BY created_at DESC LIMIT 1
      `).get(cacheKey, normalizedQuery) as { raw_response_json: string; results_count: number; provider: string } | undefined;

      if (cachedRow) {
        const parsed = JSON.parse(cachedRow.raw_response_json);
        const rawItems = Array.isArray(parsed) ? parsed : (parsed.items || parsed.results || []);
        const items: SearchResultItem[] = rawItems.map((it: any) => ({
          title: it.title || it.topic || '',
          link: it.link || it.url || it.sourceUrl || '',
          snippet: it.snippet || it.content || it.evidenceSnippet || '',
          displayLink: it.displayLink || (() => {
            try { return new URL(it.link || it.url || '').hostname; } catch { return ''; }
          })()
        })).slice(0, maxResults);

        try {
          db.prepare(`
            INSERT INTO search_queries_log (
              id, business_id, query_text, provider, endpoint_url,
              status_code, is_cached, latency_ms, results_count, raw_response_json
            ) VALUES (?, ?, ?, 'cache', 'cache_hit', 200, 1, ?, ?, ?)
          `).run(logId, options.businessId || null, query, Date.now() - startMs, items.length, cachedRow.raw_response_json);
        } catch {}

        return {
          query,
          normalizedQuery,
          cached: true,
          provider: 'cache',
          resultsCount: items.length,
          items,
          rawResponse: parsed,
          logId,
          latencyMs: Date.now() - startMs
        };
      }
    } catch (cacheErr: any) {
      console.warn(`[SearchDiscoveryProvider] Cache read error: ${cacheErr.message}`);
    }

    const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const googleCx = process.env.GOOGLE_SEARCH_CX;
    const tavilyKey = process.env.TAVILY_API_KEY;

    const hasGoogle = Boolean(googleApiKey && googleCx && !this.isTestOrPlaceholder(googleApiKey));
    const hasTavily = Boolean(tavilyKey && !this.isTestOrPlaceholder(tavilyKey));

    // Test environment fallback if no real credentials configured
    if (!hasGoogle && !hasTavily) {
      if (process.env.NODE_ENV === 'test' || !isProduction()) {
        const testItems: SearchResultItem[] = [
          {
            title: `Market Research Signals for ${query}`,
            link: 'https://example.com/research-test',
            snippet: `Verified market demand for ${query}. Competitive density observed in local area.`,
            displayLink: 'example.com'
          }
        ];
        return {
          query,
          normalizedQuery,
          cached: false,
          provider: 'fixture_test',
          resultsCount: testItems.length,
          items: testItems,
          rawResponse: { items: testItems },
          logId,
          latencyMs: 1
        };
      }

      throw new SearchConfigurationError('Search API credentials missing. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX or TAVILY_API_KEY.');
    }

    // 2. PRIORITY 2: Google Custom Search JSON API first (under 60/day cap)
    // Skipped only if caller explicitly demands Tavily deep research or Google is unconfigured
    if (hasGoogle && !options.escalateToTavily) {
      const quotaReservation = await this.quotaService.reserveProviderQuota('google_custom_search', 1);
      if (quotaReservation.allowed) {
        try {
          const endpoint = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(googleApiKey!)}&cx=${encodeURIComponent(googleCx!)}&q=${encodeURIComponent(query)}&num=${Math.min(maxResults, 10)}`;
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
          });

          const latencyMs = Date.now() - startMs;
          const rawText = await response.text();

          if (response.ok) {
            await this.quotaService.reconcileProviderQuota('google_custom_search', quotaReservation.reservationId, 'CONSUME');
            let parsed: any;
            try {
              parsed = JSON.parse(rawText);
            } catch {
              throw new Error('Google Custom Search returned invalid JSON');
            }

            const rawItems: any[] = parsed.items || [];
            const items: SearchResultItem[] = rawItems.map((it: any) => ({
              title: it.title || '',
              link: it.link || '',
              snippet: it.snippet || '',
              displayLink: it.displayLink || ''
            })).slice(0, maxResults);

            // Store in 24-hour cache
            try {
              const db = getDb();
              db.prepare(`
                INSERT OR REPLACE INTO search_cache (
                  id, query_normalized, provider, raw_response_json, results_count, created_at, expires_at
                ) VALUES (?, ?, 'google_custom_search', ?, ?, datetime('now'), datetime('now', '+24 hours'))
              `).run(`cache_${randomUUID().substring(0, 10)}`, cacheKey, rawText, items.length);

              db.prepare(`
                INSERT INTO search_queries_log (
                  id, business_id, query_text, provider, endpoint_url,
                  status_code, is_cached, latency_ms, results_count, raw_response_json
                ) VALUES (?, ?, ?, 'google_custom_search', 'https://www.googleapis.com/customsearch/v1', ?, 0, ?, ?, ?)
              `).run(logId, options.businessId || null, query, response.status, latencyMs, items.length, rawText);
            } catch {}

            return {
              query,
              normalizedQuery,
              cached: false,
              provider: 'google_custom_search',
              resultsCount: items.length,
              items,
              rawResponse: parsed,
              logId,
              latencyMs
            };
          } else {
            // Google call returned non-200 (e.g. 429 quota exhaustion or 403)
            await this.quotaService.reconcileProviderQuota('google_custom_search', quotaReservation.reservationId, 'RELEASE');
            console.warn(`[SearchDiscoveryProvider] Google Custom Search failed with HTTP ${response.status}. Falling back to Tavily.`);
          }
        } catch (googleErr: any) {
          await this.quotaService.reconcileProviderQuota('google_custom_search', quotaReservation.reservationId, 'RELEASE');
          console.warn(`[SearchDiscoveryProvider] Google Custom Search exception: ${googleErr.message}. Falling back to Tavily.`);
        }
      } else {
        console.warn(`[SearchDiscoveryProvider] Google Custom Search quota locked (${quotaReservation.reason}). Falling back to Tavily.`);
      }
    }

    // 3. PRIORITY 3: Tavily Search API fallback / deep-research escalation (<= 750/mo, <= 20/day)
    if (hasTavily) {
      const tavilyReservation = await this.quotaService.reserveProviderQuota('tavily_search', 1);
      if (!tavilyReservation.allowed) {
        throw new SearchQuotaExceededError(`[QUOTA LOCK ACTIVE] Tavily search limit reached: ${tavilyReservation.reason}`);
      }

      try {
        const bodyPayload: any = {
          api_key: tavilyKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_usage: true
        };
        if (options.includeDomains && options.includeDomains.length > 0) {
          bodyPayload.include_domains = options.includeDomains;
        }
        if (options.excludeDomains && options.excludeDomains.length > 0) {
          bodyPayload.exclude_domains = options.excludeDomains;
        }

        const endpoint = 'https://api.tavily.com/search';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(bodyPayload)
        });

        const latencyMs = Date.now() - startMs;
        const rawText = await response.text();

        if (response.status === 429 || rawText.includes('RESOURCE_EXHAUSTED') || rawText.includes('quotaExceeded')) {
          await this.quotaService.reconcileProviderQuota('tavily_search', tavilyReservation.reservationId, 'RELEASE');
          this.quotaService.lockProvider('TAVILY', 'Monthly or daily Tavily search quota exhausted');
          throw new SearchQuotaExceededError('Tavily search quota exhausted (429 RESOURCE_EXHAUSTED).');
        }

        if (!response.ok) {
          await this.quotaService.reconcileProviderQuota('tavily_search', tavilyReservation.reservationId, 'RELEASE');
          throw new Error(`Tavily returned HTTP ${response.status}: ${rawText}`);
        }

        let parsed: any;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          await this.quotaService.reconcileProviderQuota('tavily_search', tavilyReservation.reservationId, 'RELEASE');
          throw new Error('Tavily returned invalid JSON');
        }

        await this.quotaService.reconcileProviderQuota('tavily_search', tavilyReservation.reservationId, 'CONSUME');

        const rawResults: any[] = parsed.results || [];
        const items: SearchResultItem[] = rawResults.map((r: any) => ({
          title: r.title || '',
          link: r.url || '',
          snippet: r.content || '',
          displayLink: (() => {
            try { return new URL(r.url).hostname; } catch { return ''; }
          })()
        })).slice(0, maxResults);

        // Store in 24-hour cache
        try {
          const db = getDb();
          db.prepare(`
            INSERT OR REPLACE INTO search_cache (
              id, query_normalized, provider, raw_response_json, results_count, created_at, expires_at
            ) VALUES (?, ?, 'tavily_search', ?, ?, datetime('now'), datetime('now', '+24 hours'))
          `).run(`cache_${randomUUID().substring(0, 10)}`, cacheKey, rawText, items.length);

          db.prepare(`
            INSERT INTO search_queries_log (
              id, business_id, query_text, provider, endpoint_url,
              status_code, is_cached, latency_ms, results_count, raw_response_json
            ) VALUES (?, ?, ?, 'tavily_search', 'https://api.tavily.com/search', ?, 0, ?, ?, ?)
          `).run(logId, options.businessId || null, query, response.status, latencyMs, items.length, rawText);
        } catch {}

        return {
          query,
          normalizedQuery,
          cached: false,
          provider: 'tavily_search',
          resultsCount: items.length,
          items,
          rawResponse: parsed,
          logId,
          latencyMs
        };
      } catch (tavilyErr: any) {
        if (tavilyErr instanceof SearchQuotaExceededError) {
          throw tavilyErr;
        }
        await this.quotaService.reconcileProviderQuota('tavily_search', tavilyReservation.reservationId, 'RELEASE');
        throw tavilyErr;
      }
    }

    throw new SearchConfigurationError('All configured search providers exhausted or failed.');
  }
}
