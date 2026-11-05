import { getDb } from '../db/client.js';
import {
  SearchDiscoveryProvider,
  SearchResultItem,
  SearchQuotaExceededError,
  SearchConfigurationError
} from './search-discovery-provider.js';

export {
  SearchResultItem,
  SearchQuotaExceededError,
  SearchConfigurationError
};

export interface GoogleSearchResponse {
  query: string;
  normalizedQuery: string;
  cached: boolean;
  resultsCount: number;
  items: SearchResultItem[];
  rawResponse: any;
  logId: string;
  latencyMs: number;
}

/**
 * GoogleSearchClient — Facade delegating to SearchDiscoveryProvider
 *
 * Implements Google Custom Search JSON API first (under 60/day cap),
 * falling back to Tavily Search API (<= 20/day, <= 750/mo), with 24-48h caching
 * and strict fail-closed audit logging.
 */
export class GoogleSearchClient {
  private static instance: GoogleSearchClient;
  private provider = SearchDiscoveryProvider.getInstance();

  public static getInstance(): GoogleSearchClient {
    if (!GoogleSearchClient.instance) {
      GoogleSearchClient.instance = new GoogleSearchClient();
    }
    return GoogleSearchClient.instance;
  }

  /**
   * Normalizes query string for deduplication and cache lookup.
   */
  public normalizeQuery(query: string): string {
    return this.provider.normalizeQuery(query);
  }

  /**
   * Executes a search via SearchDiscoveryProvider (Google first, Tavily fallback, with caching).
   */
  public async search(query: string, businessId?: string): Promise<GoogleSearchResponse> {
    const res = await this.provider.search(query, { businessId });
    return {
      query: res.query,
      normalizedQuery: res.normalizedQuery,
      cached: res.cached,
      resultsCount: res.resultsCount,
      items: res.items,
      rawResponse: res.rawResponse,
      logId: res.logId,
      latencyMs: res.latencyMs
    };
  }

  /**
   * Retrieves audit logs for a business or system.
   */
  public getAuditLogs(businessId?: string, limit: number = 50): any[] {
    const db = getDb();
    if (businessId) {
      return db.prepare(`
        SELECT id, business_id, query_text, provider, status_code, is_cached, latency_ms, results_count, created_at, error_message
        FROM search_queries_log
        WHERE business_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(businessId, limit);
    }
    return db.prepare(`
      SELECT id, business_id, query_text, provider, status_code, is_cached, latency_ms, results_count, created_at, error_message
      FROM search_queries_log
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }

  /**
   * Retrieves raw logged response by log ID.
   */
  public getRawResponseByLogId(logId: string): any | null {
    const db = getDb();
    const row = db.prepare('SELECT raw_response_json FROM search_queries_log WHERE id = ?').get(logId) as { raw_response_json: string } | undefined;
    return row ? JSON.parse(row.raw_response_json) : null;
  }
}
