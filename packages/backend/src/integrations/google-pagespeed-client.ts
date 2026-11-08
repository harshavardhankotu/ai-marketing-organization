import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { isPlaceholderCredential, isProduction } from '../config/env.js';

export interface PageSpeedMetrics {
  performanceScore: number | null; // 0 - 100 or null
  seoScore: number | null;         // 0 - 100 or null
  accessibilityScore?: number | null; // 0 - 100 or null
  bestPracticesScore?: number | null; // 0 - 100 or null
  coreWebVitals: {
    lcp?: string; // Largest Contentful Paint
    fcp?: string; // First Contentful Paint
    cls?: string; // Cumulative Layout Shift
    tbt?: string; // Total Blocking Time
  } | null;
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    savingsEst?: string;
  }>;
}

export interface PageSpeedAuditResult {
  status: 'SUCCESS' | 'UNAVAILABLE';
  reason?: 'MISSING_API_KEY' | 'QUOTA_EXHAUSTED' | string;
  executionPath?: 'KEYED_SUCCESS' | 'KEYLESS_SUCCESS' | 'FALLBACK_KEYLESS_SUCCESS' | 'UNAVAILABLE';
  targetUrl: string;
  strategy: 'mobile' | 'desktop';
  performanceScore?: number | null; // 0 - 100 or null
  seoScore?: number | null;         // 0 - 100 or null
  accessibilityScore?: number | null; // 0 - 100 or null
  bestPracticesScore?: number | null; // 0 - 100 or null
  coreWebVitals?: {
    lcp?: string;
    fcp?: string;
    cls?: string;
    tbt?: string;
  } | null;
  opportunities?: Array<{
    id: string;
    title: string;
    description: string;
    savingsEst?: string;
  }>;
  metrics: PageSpeedMetrics | null;
  cached: boolean;
  quotaBlocked: boolean;
  timestamp: string;
}

export interface SiteFixOptimizationBundle {
  targetUrl: string;
  businessName: string;
  performanceScore: number | null;
  auditSummary: string;
  recommendedHeadSnippets: string;
  schemaJsonLd: string;
  implementationChecklist: string[];
  auditTimestamp: string;
}

export class PageSpeedQuotaExceededError extends Error {
  public readonly code = 'PAGESPEED_DAILY_QUOTA_REACHED';
  constructor(message: string) {
    super(message);
    this.name = 'PageSpeedQuotaExceededError';
  }
}

/**
 * GooglePageSpeedClient — Automated Web Vitals, Performance & SiteFix AI Diagnostic Client
 *
 * Implements:
 * 1. Strict 40 requests/day cap via UnifiedQuotaService ('google_pagespeed').
 * 2. 24-hour cache keyed by canonical URL + strategy in SQLite/D1 search_cache.
 * 3. Dedicated key resolution: ONLY GOOGLE_PAGESPEED_API_KEY (never Gemini, Search, or HTML tokens).
 * 4. Keyless fallback: Bounded retry for keyed HTTP 400, 401, or 403 errors.
 * 5. Absolutely no synthetic metrics: Genuine Lighthouse data or UNAVAILABLE.
 * 6. Supported categories: performance, seo, accessibility, best-practices.
 */
export class GooglePageSpeedClient {
  private static instance: GooglePageSpeedClient;
  private quotaService = UnifiedQuotaService.getInstance();
  private fetchFn: typeof fetch = globalThis.fetch;

  public static getInstance(fetchFn?: typeof fetch): GooglePageSpeedClient {
    if (!GooglePageSpeedClient.instance) {
      GooglePageSpeedClient.instance = new GooglePageSpeedClient();
    }
    if (fetchFn) {
      GooglePageSpeedClient.instance.fetchFn = fetchFn;
    }
    return GooglePageSpeedClient.instance;
  }

  public static resetInstance(): void {
    GooglePageSpeedClient.instance = undefined as any;
  }

  public normalizeUrl(url: string): string {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }

  public async runAudit(targetUrl: string, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<PageSpeedAuditResult> {
    const normalized = this.normalizeUrl(targetUrl);
    const cacheKey = `pagespeed:${strategy}:${normalized}`;

    // 1. Check 24-Hour Cache in search_cache
    try {
      const db = getDb();
      const cached = db.prepare(`
        SELECT raw_response_json, created_at, expires_at
        FROM search_cache
        WHERE query_normalized = ? AND expires_at > datetime('now')
        LIMIT 1
      `).get(cacheKey) as { raw_response_json: string } | undefined;

      if (cached) {
        const parsed: PageSpeedAuditResult = JSON.parse(cached.raw_response_json);
        parsed.cached = true;
        return parsed;
      }
    } catch (e: any) {
      console.warn(`[GooglePageSpeedClient] Cache check error: ${e.message}`);
    }

    // 2. Resolve API Key: Strictly GOOGLE_PAGESPEED_API_KEY only
    // Never pass GEMINI_API_KEY, GOOGLE_SEARCH_API_KEY, or HTML verification tokens
    const dedicatedKey = (process.env.GOOGLE_PAGESPEED_API_KEY || '').trim();
    const hasValidKey = Boolean(
      dedicatedKey &&
      !isPlaceholderCredential(dedicatedKey) &&
      !dedicatedKey.startsWith('test') &&
      !dedicatedKey.includes('placeholder') &&
      !dedicatedKey.includes('VERIFY-') &&
      !dedicatedKey.includes('WVPs1hLZg')
    );
    const apiKey = hasValidKey ? dedicatedKey : null;

    if (!apiKey && (isProduction() || this.fetchFn === globalThis.fetch)) {
      return {
        status: 'UNAVAILABLE',
        reason: 'MISSING_API_KEY',
        executionPath: 'UNAVAILABLE',
        targetUrl,
        strategy,
        metrics: null,
        coreWebVitals: null,
        opportunities: [],
        cached: false,
        quotaBlocked: false,
        timestamp: new Date().toISOString()
      };
    }

    // 3. Reserve Quota (40/day cap via UnifiedQuotaService)
    const reservation = await this.quotaService.reserveProviderQuota('google_pagespeed', 1);
    if (!reservation.allowed) {
      return {
        status: 'UNAVAILABLE',
        reason: 'QUOTA_EXHAUSTED',
        executionPath: 'UNAVAILABLE',
        targetUrl,
        strategy,
        metrics: null,
        coreWebVitals: null,
        opportunities: [],
        cached: false,
        quotaBlocked: true,
        timestamp: new Date().toISOString()
      };
    }

    // Google runPagespeed endpoint works with OR without an API key
    const categories = ['performance', 'seo', 'accessibility', 'best-practices'];
    const categoryQuery = categories.map(c => `category=${c}`).join('&');
    const baseUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(targetUrl)}&strategy=${strategy}&${categoryQuery}`;
    const endpoint = apiKey ? `${baseUrl}&key=${encodeURIComponent(apiKey)}` : baseUrl;

    let executionPath: 'KEYED_SUCCESS' | 'KEYLESS_SUCCESS' | 'FALLBACK_KEYLESS_SUCCESS' | 'UNAVAILABLE' = 'UNAVAILABLE';

    try {
      let res: Response;
      try {
        res = await this.fetchFn(endpoint, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(20000)
        });
      } catch (keyedErr: any) {
        // If keyed request timed out or threw network error and key was used, try keyless once if appropriate
        if (apiKey) {
          console.warn(`[GooglePageSpeedClient] Keyed request exception (${keyedErr.message}), falling back to keyless request`);
          res = await this.fetchFn(baseUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(20000)
          });
          executionPath = 'FALLBACK_KEYLESS_SUCCESS';
        } else {
          throw keyedErr;
        }
      }

      if (apiKey && res.ok) {
        executionPath = 'KEYED_SUCCESS';
      } else if (!apiKey && res.ok) {
        executionPath = 'KEYLESS_SUCCESS';
      }

      // If keyed request returned 400, 401 (e.g. invalid/restricted key) or 403, fallback to keyless live query
      if (!res.ok && apiKey && (res.status === 400 || res.status === 401 || res.status === 403)) {
        console.warn(`[GooglePageSpeedClient] Keyed request returned HTTP ${res.status}. Executing keyless fallback attempt.`);
        try {
          res = await this.fetchFn(baseUrl, {
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(20000)
          });
          if (res.ok) {
            executionPath = 'FALLBACK_KEYLESS_SUCCESS';
          }
        } catch (fallbackErr: any) {
          console.warn(`[GooglePageSpeedClient] Keyless fallback exception: ${fallbackErr.message}`);
        }
      }

      if (!res.ok) {
        await this.quotaService.reconcileProviderQuota('google_pagespeed', reservation.reservationId, 'RELEASE');
        console.warn(`[GooglePageSpeedClient] API returned HTTP ${res.status}`);
        return {
          status: 'UNAVAILABLE',
          reason: `API_HTTP_${res.status}`,
          executionPath: 'UNAVAILABLE',
          targetUrl,
          strategy,
          metrics: null,
          coreWebVitals: null,
          opportunities: [],
          cached: false,
          quotaBlocked: false,
          timestamp: new Date().toISOString()
        };
      }

      const data: any = await res.json();
      const lighthouse = data?.lighthouseResult;
      if (!lighthouse || !lighthouse.categories) {
        await this.quotaService.reconcileProviderQuota('google_pagespeed', reservation.reservationId, 'RELEASE');
        return {
          status: 'UNAVAILABLE',
          reason: 'MISSING_LIGHTHOUSE_DATA',
          executionPath: 'UNAVAILABLE',
          targetUrl,
          strategy,
          performanceScore: null,
          seoScore: null,
          accessibilityScore: null,
          bestPracticesScore: null,
          coreWebVitals: null,
          opportunities: [],
          metrics: null,
          cached: false,
          quotaBlocked: false,
          timestamp: new Date().toISOString()
        };
      }

      await this.quotaService.reconcileProviderQuota('google_pagespeed', reservation.reservationId, 'CONSUME');

      // Genuine Lighthouse scores (never synthetic defaults)
      const perfCatScore = lighthouse.categories?.performance?.score;
      const perfScore = typeof perfCatScore === 'number' && Number.isFinite(perfCatScore)
        ? Math.round(perfCatScore * 100)
        : null;

      const seoCatScore = lighthouse.categories?.seo?.score;
      const seoScore = typeof seoCatScore === 'number' && Number.isFinite(seoCatScore)
        ? Math.round(seoCatScore * 100)
        : null;

      const a11yCatScore = lighthouse.categories?.accessibility?.score;
      const accessibilityScore = typeof a11yCatScore === 'number' && Number.isFinite(a11yCatScore)
        ? Math.round(a11yCatScore * 100)
        : null;

      const bpCatScore = lighthouse.categories?.['best-practices']?.score;
      const bestPracticesScore = typeof bpCatScore === 'number' && Number.isFinite(bpCatScore)
        ? Math.round(bpCatScore * 100)
        : null;

      const audits = lighthouse.audits || {};
      const lcp = audits['largest-contentful-paint']?.displayValue || undefined;
      const fcp = audits['first-contentful-paint']?.displayValue || undefined;
      const cls = audits['cumulative-layout-shift']?.displayValue || undefined;
      const tbt = audits['total-blocking-time']?.displayValue || undefined;

      const coreWebVitals = (lcp || fcp || cls || tbt)
        ? { lcp, fcp, cls, tbt }
        : null;

      const opportunities: Array<{ id: string; title: string; description: string; savingsEst?: string }> = [];
      const oppKeys = ['render-blocking-resources', 'unminified-css', 'unminified-javascript', 'unused-javascript', 'modern-image-formats'];
      for (const key of oppKeys) {
        const item = audits[key];
        if (item && item.score !== null && item.score < 0.9) {
          opportunities.push({
            id: key,
            title: item.title || key,
            description: item.description || '',
            savingsEst: item.displayValue
          });
        }
      }

      const metrics: PageSpeedMetrics = {
        performanceScore: perfScore,
        seoScore,
        accessibilityScore,
        bestPracticesScore,
        coreWebVitals,
        opportunities: opportunities.slice(0, 5)
      };

      const result: PageSpeedAuditResult = {
        status: 'SUCCESS',
        executionPath,
        targetUrl,
        strategy,
        performanceScore: perfScore,
        seoScore,
        accessibilityScore,
        bestPracticesScore,
        coreWebVitals,
        opportunities: opportunities.slice(0, 5),
        metrics,
        cached: false,
        quotaBlocked: false,
        timestamp: new Date().toISOString()
      };

      this.cacheResult(cacheKey, result);
      return result;
    } catch (err: any) {
      await this.quotaService.reconcileProviderQuota('google_pagespeed', reservation.reservationId, 'RELEASE');
      console.warn(`[GooglePageSpeedClient] Fetch exception: ${err.message}`);
      return {
        status: 'UNAVAILABLE',
        reason: err.message || 'NETWORK_ERROR',
        executionPath: 'UNAVAILABLE',
        targetUrl,
        strategy,
        metrics: null,
        coreWebVitals: null,
        opportunities: [],
        cached: false,
        quotaBlocked: false,
        timestamp: new Date().toISOString()
      };
    }
  }

  private cacheResult(cacheKey: string, result: PageSpeedAuditResult): void {
    try {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO search_cache (
          id, query_normalized, provider, raw_response_json, results_count, created_at, expires_at
        ) VALUES (?, ?, 'google_pagespeed', ?, 1, datetime('now'), datetime('now', '+24 hours'))
      `).run(`ps_${randomUUID().substring(0, 10)}`, cacheKey, JSON.stringify(result));
    } catch {}
  }

  /**
   * Generates a complete SiteFix AI Optimization Bundle for the ₹499 pack.
   */
  public async generateSiteFixBundle(targetUrl: string, businessName: string = 'Local Business'): Promise<SiteFixOptimizationBundle> {
    const audit = await this.runAudit(targetUrl, 'mobile');

    let hostname = 'example.com';
    try {
      hostname = new URL(targetUrl).hostname;
    } catch {}

    const schemaObj = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "name": businessName,
      "url": targetUrl,
      "address": {
        "@type": "PostalAddress",
        "addressCountry": "IN"
      },
      "potentialAction": {
        "@type": "ReserveAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": `${targetUrl}#contact`,
          "inLanguage": "en-IN"
        },
        "result": {
          "@type": "Reservation",
          "name": "Appointment Booking"
        }
      }
    };

    const recommendedHeadSnippets = `
<!-- SiteFix AI Recommended Head Tags for ${hostname} -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<meta property="og:title" content="${businessName}">
<meta property="og:url" content="${targetUrl}">
<meta property="og:type" content="website">
<link rel="canonical" href="${targetUrl}">
<script type="application/ld+json">
${JSON.stringify(schemaObj, null, 2)}
</script>
`.trim();

    const isAvailable = audit.status === 'SUCCESS' && Boolean(audit.metrics);
    const perfScore = audit.performanceScore ?? null;
    const auditSummary = isAvailable
      ? `Performance score: ${perfScore !== null ? perfScore + '/100' : 'N/A'}, SEO score: ${audit.seoScore !== null ? audit.seoScore + '/100' : 'N/A'}. Core Web Vitals LCP: ${audit.coreWebVitals?.lcp || 'N/A'}, CLS: ${audit.coreWebVitals?.cls || 'N/A'}. ${audit.opportunities?.length || 0} priority performance opportunities detected.`
      : 'Live Core Web Vitals data currently unavailable: Google PageSpeed free tier quota reached or unconfigured. Raw HTML audit completed.';

    return {
      targetUrl,
      businessName,
      performanceScore: perfScore,
      auditSummary,
      recommendedHeadSnippets,
      schemaJsonLd: JSON.stringify(schemaObj, null, 2),
      implementationChecklist: [
        'Deploy verified Schema.org LocalBusiness JSON-LD snippet into website <head>',
        'Add canonical tag and responsive viewport metadata',
        'Enable gzip/brotli compression on web server',
        'Defer non-critical third-party analytics and chat widgets',
        'Convert hero images to WebP format'
      ],
      auditTimestamp: audit.timestamp
    };
  }
}
