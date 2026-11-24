import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  SiteAuditFixPackGenerator,
  SiteAuditScanner,
  sanitizeHttpUrl,
  serializeJsonLdSafely,
  type SiteAuditResult
} from '@ai-marketing/sitefix-core';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import {
  clearPublicScanCacheForTesting,
  setPublicScanMemoryCacheCapForTesting,
  getPublicScanMemoryCacheSizeForTesting,
  executeHardenedPublicScan,
  normalizeUrlForPublicCache,
  PUBLIC_SCAN_CACHE_EVENT_TYPE
} from '../../src/tools/site-audit/public-scan-service.js';
import {
  recordSiteFixFunnelEvent,
  hashFunnelVisitorKey,
  resetSiteFixFunnelWriteMetricsForTesting,
  SITEFIX_FUNNEL_EVENT_TYPE,
  type SiteFixLaunchSource
} from '../../src/tools/site-audit/sitefix-funnel-attribution.js';

function seedCachedAuditRow(rawUrl: string, auditId = 'aud_pass21_cached') {
  const db = getDb();
  const normalized = normalizeUrlForPublicCache(rawUrl);
  const cacheHash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  const payload = {
    normalizedUrl: normalized,
    cachedAt: new Date().toISOString(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    authorizationMode: 'SELF_DECLARED_AUTHORIZATION',
    result: {
      auditId,
      url: normalized,
      scannedAt: new Date().toISOString(),
      overallStatus: 'NEEDS_IMPROVEMENT',
      score: 78,
      scoreExplanation: 'Cached deterministic fixture',
      findings: [],
      metrics: {
        httpStatus: 200,
        responseTimeMs: 30,
        htmlSizeBytes: 1024,
        contentType: 'text/html',
        redirectChain: [normalized],
        hasRobotsTxt: true,
        hasSitemap: true,
        jsonLdTypesFound: ['WebSite'],
        contactChannelsFound: []
      },
      preview: {
        title: 'Cached SiteFix Fixture',
        metaDescription: 'Cached description for Pass 2.1 verification.',
        canonicalUrl: normalized,
        ogTitle: 'Cached SiteFix Fixture',
        ogImage: `${normalized}og.png`,
        fixPackSnippetPreview: '<title>Cached SiteFix Fixture</title>'
      },
      disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true }
    }
  };
  db.prepare(
    `INSERT INTO durable_events (id, event_type, organization_id, payload_json, created_at)
     VALUES (?, ?, 'org_owner_primary', ?, datetime('now'))`
  ).run(`sfx_cache_${cacheHash}_${auditId}`, PUBLIC_SCAN_CACHE_EVENT_TYPE, JSON.stringify(payload));
  return normalized;
}

describe('PASS 2.1 — Security & Commercial Integrity Closure', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const managedEnvKeys = [
    'ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST',
    'ENFORCE_PUBLIC_MCP_LIMITS_IN_TEST',
    'PUBLIC_SCAN_IP_DAILY_CAP',
    'PUBLIC_SCAN_GLOBAL_DAILY_CAP',
    'PUBLIC_MCP_ENABLED',
    'SITE_AUDIT_TERMS_ATTESTED',
    'SITE_AUDIT_TERMS_SHA256',
    'RAZORPAY_MODE',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_TEST_KEY_ID',
    'RAZORPAY_TEST_KEY_SECRET',
    'RAZORPAY_HOSTED_PAYMENT_LINK_URL'
  ];

  beforeEach(() => {
    for (const k of managedEnvKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    clearPublicScanCacheForTesting();
    DurableRateLimiter.resetInstanceForTesting();
    const db = getDb();
    try {
      db.prepare(`DELETE FROM durable_rate_limits`).run();
      db.prepare(`DELETE FROM durable_events WHERE event_type IN (?, ?)`).run(
        PUBLIC_SCAN_CACHE_EVENT_TYPE,
        SITEFIX_FUNNEL_EVENT_TYPE
      );
    } catch {}
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    clearPublicScanCacheForTesting();
    DurableRateLimiter.resetInstanceForTesting();
  });

  // =========================================================================
  // FIX 1 — FAIL-CLOSED RATE LIMITER & PROVEN GLOBAL + PER-IP DAILY CAPS
  // =========================================================================
  describe('FIX 1 — Fail-Closed Rate Limiter & Proven Global + Per-IP Daily Caps', () => {
    it('enforces exact 20/day per-IP cap (20 pass, 21st returns 429) with daily salted bucket key', async () => {
      seedCachedAuditRow('https://cap-ip-test.example', 'aud_ip_cap');
      process.env.ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST = 'true';
      process.env.PUBLIC_SCAN_IP_DAILY_CAP = '20';
      process.env.PUBLIC_SCAN_GLOBAL_DAILY_CAP = '500';

      for (let i = 1; i <= 20; i++) {
        const res = await app.request('/api/v1/public/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '198.51.100.42'
          },
          body: JSON.stringify({
            url: 'https://cap-ip-test.example',
            confirmAuthorized: true,
            source: 'web_whatsapp_preview'
          })
        });
        expect(res.status, `Request #${i} from single IP should pass`).toBe(200);
      }

      const blockedRes = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '198.51.100.42'
        },
        body: JSON.stringify({
          url: 'https://cap-ip-test.example',
          confirmAuthorized: true,
          source: 'web_whatsapp_preview'
        })
      });
      expect(blockedRes.status).toBe(429);
      const blockedJson = (await blockedRes.json()) as any;
      expect(blockedJson.code).toBe('IP_DAILY_RATE_LIMIT_EXCEEDED');

      // Confirm daily salted bucket key format persisted in durable_rate_limits
      const rows = getDb()
        .prepare(`SELECT key, request_count FROM durable_rate_limits WHERE key LIKE 'public_scan:ip:%'`)
        .all() as Array<{ key: string; request_count: number }>;
      expect(rows.length).toBe(1);
      expect(rows[0].key).toMatch(/^public_scan:ip:[a-f0-9]{16}:\d{4}-\d{2}-\d{2}$/);
      expect(rows[0].request_count).toBe(21);
    });

    it('enforces exact 500/day global cap across distinct IPs (500 pass, 501st returns 429) and resets cleanly on next UTC day', async () => {
      const limiter = DurableRateLimiter.getInstance();
      const day1Ms = Date.UTC(2026, 10, 21, 12, 0, 0);
      const day2Ms = Date.UTC(2026, 10, 22, 0, 1, 0);

      // 500 requests across 50 distinct IPs (10 each) must all pass
      for (let i = 0; i < 500; i++) {
        const ip = `203.0.${Math.floor(i / 200)}.${(i % 200) + 1}`;
        const res = await limiter.checkPublicScanDailyCaps(ip, {
          ipDailyCap: 20,
          globalDailyCap: 500,
          nowMs: day1Ms
        });
        expect(res.allowed, `Global request #${i + 1} should pass`).toBe(true);
        expect(res.globalBucketKey).toBe('public_scan:global:2026-11-21');
      }

      // 501st request from a brand-new IP must be rejected with GLOBAL_DAILY_RATE_LIMIT_EXCEEDED
      const overCap = await limiter.checkPublicScanDailyCaps('198.51.100.250', {
        ipDailyCap: 20,
        globalDailyCap: 500,
        nowMs: day1Ms
      });
      expect(overCap.allowed).toBe(false);
      expect(overCap.reason).toBe('GLOBAL_DAILY_RATE_LIMIT_EXCEEDED');

      // Also verify HTTP route returns 429 when global daily bucket is exhausted
      seedCachedAuditRow('https://cap-global-test.example', 'aud_global_cap');
      process.env.ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST = 'true';
      process.env.PUBLIC_SCAN_IP_DAILY_CAP = '20';
      process.env.PUBLIC_SCAN_GLOBAL_DAILY_CAP = '2';
      getDb().prepare(`DELETE FROM durable_rate_limits`).run();

      const g1 = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.1' },
        body: JSON.stringify({ url: 'https://cap-global-test.example', confirmAuthorized: true })
      });
      const g2 = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.2' },
        body: JSON.stringify({ url: 'https://cap-global-test.example', confirmAuthorized: true })
      });
      const g3 = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.3' },
        body: JSON.stringify({ url: 'https://cap-global-test.example', confirmAuthorized: true })
      });
      expect(g1.status).toBe(200);
      expect(g2.status).toBe(200);
      expect(g3.status).toBe(429);
      expect(((await g3.json()) as any).code).toBe('GLOBAL_DAILY_RATE_LIMIT_EXCEEDED');

      // Next UTC day resets cleanly for BOTH IP and global buckets
      const nextDayRes = await limiter.checkPublicScanDailyCaps('203.0.0.1', {
        ipDailyCap: 20,
        globalDailyCap: 500,
        nowMs: day2Ms
      });
      expect(nextDayRes.allowed).toBe(true);
      expect(nextDayRes.globalBucketKey).toBe('public_scan:global:2026-11-22');
      expect(nextDayRes.ipBucketKey).toMatch(/^public_scan:ip:[a-f0-9]{16}:2026-11-22$/);
    });

    it('prevents concurrent requests at the limit from overshooting', async () => {
      const limiter = DurableRateLimiter.getInstance();
      const nowMs = Date.UTC(2026, 10, 21, 14, 0, 0);

      // Fire 25 concurrent requests against a cap of 20
      const results = await Promise.all(
        Array.from({ length: 25 }, () =>
          limiter.checkPublicScanDailyCaps('198.51.100.99', {
            ipDailyCap: 20,
            globalDailyCap: 500,
            nowMs
          })
        )
      );

      const allowedCount = results.filter(r => r.allowed).length;
      const deniedCount = results.filter(r => !r.allowed && r.reason === 'IP_DAILY_RATE_LIMIT_EXCEEDED').length;
      expect(allowedCount).toBe(20);
      expect(deniedCount).toBe(5);
    });

    it('fails closed with HTTP 503 (RATE_LIMITER_UNAVAILABLE) and ZERO URL fetches on storage failure for /public/scan and /public/mcp', async () => {
      process.env.ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST = 'true';
      process.env.ENFORCE_PUBLIC_MCP_LIMITS_IN_TEST = 'true';
      process.env.PUBLIC_MCP_ENABLED = 'true';

      const scanSpy = vi.spyOn(SiteAuditScanner.prototype, 'scanUrl');

      // Simulate storage outage on durable_rate_limits
      const db = getDb();
      const originalPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        if (String(sql).includes('durable_rate_limits')) {
          throw new Error('D1_STORAGE_OFFLINE: simulated connection refused');
        }
        return originalPrepare(sql);
      }) as any);

      // 1. /api/v1/public/scan MUST return 503 and fetch 0 target URLs
      const scanRes = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.88' },
        body: JSON.stringify({
          url: 'https://never-fetched.example',
          confirmAuthorized: true,
          source: 'web_open_graph'
        })
      });
      expect(scanRes.status).toBe(503);
      expect(scanRes.headers.get('retry-after')).toBe('60');
      const scanJson = (await scanRes.json()) as any;
      expect(scanJson.success).toBe(false);
      expect(scanJson.code).toBe('RATE_LIMITER_UNAVAILABLE');
      expect(scanSpy).toHaveBeenCalledTimes(0);

      // 2. /api/v1/public/mcp MUST also fail closed with 503 on storage failure
      const mcpRes = await app.request('/api/v1/public/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.88' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'sitefix_check_url',
            arguments: { url: 'https://never-fetched.example', confirmAuthorized: true }
          }
        })
      });
      expect(mcpRes.status).toBe(503);
      const mcpJson = (await mcpRes.json()) as any;
      expect(mcpJson.error?.message).toContain('RATE_LIMITER_UNAVAILABLE');
      expect(scanSpy).toHaveBeenCalledTimes(0);
    });
  });

  // =========================================================================
  // FIX 2 — STRICT HTML, URL & JSON-LD ESCAPING IN SiteAuditFixPackGenerator
  // =========================================================================
  describe('FIX 2 — Strict HTML, URL & JSON-LD Escaping in SiteAuditFixPackGenerator', () => {
    it('neutralizes ", \', <script>, </script>, and javascript:alert(1) across all generated Fix-Pack snippets', () => {
      const maliciousAudit: SiteAuditResult = {
        auditId: 'aud_xss_1',
        url: 'https://victim-site.example/page',
        scannedAt: new Date().toISOString(),
        overallStatus: 'ACTION_REQUIRED',
        score: 30,
        scoreExplanation: 'Malicious metadata injection fixture',
        findings: [],
        metrics: {
          httpStatus: 200,
          responseTimeMs: 25,
          htmlSizeBytes: 400,
          contentType: 'text/html',
          redirectChain: ['https://victim-site.example/page'],
          hasRobotsTxt: false,
          hasSitemap: false,
          jsonLdTypesFound: [],
          contactChannelsFound: []
        },
        preview: {
          title: `Acme "Best" 'Shop' </title><script>alert(1)</script>`,
          metaDescription: `Desc "quoted" 'single' </script><img src=x onerror=alert(1)>`,
          canonicalUrl: `javascript:alert(1)`,
          ogTitle: `OG "Break" 'Out' <script>evil()</script>`,
          ogDescription: `OG Desc </script><svg onload=alert(1)>`,
          ogUrl: `javascript:alert('og')`,
          ogImage: `javascript:alert('img')`,
          twitterTitle: `TW "Quote" <script>x</script>`,
          twitterDescription: `TW 'Single' </script>`,
          twitterImage: `javascript:alert('tw')`,
          fixPackSnippetPreview: ''
        },
        disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true }
      };

      const pack = new SiteAuditFixPackGenerator().generateFixPack(maliciousAudit);

      // 1. Zero unescaped script tags or attribute breakouts in HTML head, OG, and Twitter snippets
      for (const snippet of [
        pack.headMetadataSnippet,
        pack.openGraphSnippet,
        pack.twitterCardSnippet,
        pack.sitemapXmlSnippet || ''
      ]) {
        expect(snippet).not.toContain('<script>');
        expect(snippet).not.toContain('</script>');
        expect(snippet).not.toContain('<img ');
        expect(snippet).not.toContain('<svg ');
        expect(snippet.toLowerCase()).not.toContain('javascript:');
      }

      // 2. Observed special chars are properly entity-escaped
      expect(pack.headMetadataSnippet).toContain('&quot;Best&quot;');
      expect(pack.headMetadataSnippet).toContain('&#39;Shop&#39;');
      expect(pack.headMetadataSnippet).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(pack.openGraphSnippet).toContain('&quot;Break&quot;');
      expect(pack.twitterCardSnippet).toContain('&lt;script&gt;x&lt;/script&gt;');

      // 3. Unsafe canonical & image URLs dropped/replaced with verified HTTP(S) fallback
      expect(pack.canonicalUrlRecommendation).toBe('https://victim-site.example/page');
      expect(pack.headMetadataSnippet).toContain('<link rel="canonical" href="https://victim-site.example/page">');
      expect(pack.openGraphSnippet).not.toContain('<meta property="og:image"');
      expect(pack.twitterCardSnippet).not.toContain('<meta name="twitter:image"');

      // 4. JSON-LD safely escapes `<` as `\u003c` and never embeds raw `</script>` inside the script body
      const scriptMatch = pack.schemaJsonLdSnippet.match(
        /<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/
      );
      expect(scriptMatch).toBeTruthy();
      const jsonBody = scriptMatch![1];
      expect(jsonBody).not.toContain('<');
      expect(jsonBody).not.toContain('</script>');
      expect(jsonBody).toContain('\\u003c');
      expect(jsonBody.toLowerCase()).not.toContain('javascript:');
      // Must remain 100% valid JSON when parsed
      const parsedLd = JSON.parse(jsonBody);
      expect(parsedLd['@context']).toBe('https://schema.org');
      expect(parsedLd.url).toBe('https://victim-site.example/page');
      expect(parsedLd.image).toBeUndefined();

      // 5. Direct helper unit assertions
      expect(sanitizeHttpUrl('javascript:alert(1)')).toBeNull();
      expect(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(sanitizeHttpUrl('https://safe.example/img.png')).toBe('https://safe.example/img.png');
      expect(serializeJsonLdSafely({ x: '</script><script>alert(1)</script>' })).not.toContain('<');
    });
  });

  // =========================================================================
  // FIX 3 — SINGLE COMMERCIAL CONFIG GATING, BOUNDED CACHE, SELF-ATTESTATION,
  //         /sitemap.xml PARITY & END-TO-END SOURCE ATTRIBUTION
  // =========================================================================
  describe('FIX 3 — Commercial Gating, Bounded Cache, Self-Attestation, /sitemap.xml & End-to-End Attribution', () => {
    it('gates commercial checkout strictly on SiteAuditService.getCheckoutReadiness() + owner/OWN_OFFER.md while keeping free diagnostics available', async () => {
      seedCachedAuditRow('https://gating-test.example', 'aud_gating_1');
      process.env.RAZORPAY_HOSTED_PAYMENT_LINK_URL = 'https://rzp.io/i/sitefix-test-link';

      // Case A: Owner attestation missing -> free diagnostics returned, checkout strictly LOCKED & hosted link suppressed
      delete process.env.SITE_AUDIT_TERMS_ATTESTED;
      const lockedRes = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://gating-test.example',
          confirmAuthorized: true,
          source: 'web_whatsapp_preview'
        })
      });
      expect(lockedRes.status).toBe(200);
      const lockedJson = (await lockedRes.json()) as any;
      expect(lockedJson.success).toBe(true);
      expect(lockedJson.result?.auditId).toBe('aud_gating_1');
      expect(lockedJson.authorizationMode).toBe('SELF_DECLARED_AUTHORIZATION');
      expect(JSON.stringify(lockedJson)).not.toMatch(/verified ownership/i);
      expect(lockedJson.ownerOfferAttested).toBe(false);
      expect(lockedJson.checkoutReady).toBe(false);
      expect(lockedJson.checkoutLocked).toBe(true);
      expect(lockedJson.checkoutUrl).toBeNull();
      expect(lockedJson.hostedPaymentLinkUrl).toBeNull();

      // Case B: Owner attested + gateway configured -> unlocked with authoritative SKU/price from owner/OWN_OFFER.md
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.SITE_AUDIT_TERMS_SHA256 = SiteAuditService.computeTermsFileHash() || '';
      process.env.RAZORPAY_MODE = 'TEST';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_pass21_key';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_test_pass21_secret';

      const readyRes = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://gating-test.example',
          confirmAuthorized: true,
          source: 'web_whatsapp_preview'
        })
      });
      expect(readyRes.status).toBe(200);
      const readyJson = (await readyRes.json()) as any;
      expect(readyJson.ownerOfferAttested).toBe(true);
      expect(readyJson.checkoutReady).toBe(true);
      expect(readyJson.checkoutLocked).toBe(false);
      expect(readyJson.canonicalSku).toBe('SITEFIX_AI_PACK_V1');
      expect(readyJson.priceINR).toBe(499);
      expect(readyJson.checkoutUrl).toContain('source=web_whatsapp_preview');
      expect(readyJson.hostedPaymentLinkUrl).toBe('https://rzp.io/i/sitefix-test-link');
    });

    it('enforces bounded in-memory cache eviction and surfaces explicit cacheStatus (HIT_D1, HIT_MEMORY, MISS, D1_READ_FAILED, D1_WRITE_FAILED)', async () => {
      // 1. HIT_D1 -> promotes to bounded memory -> second call returns HIT_MEMORY
      seedCachedAuditRow('https://cache-status-test.example', 'aud_cache_stat_1');
      const first = await executeHardenedPublicScan({ url: 'https://cache-status-test.example' });
      expect(first.cached).toBe(true);
      expect(first.cacheStatus).toBe('HIT_D1');

      const second = await executeHardenedPublicScan({ url: 'https://cache-status-test.example' });
      expect(second.cached).toBe(true);
      expect(second.cacheStatus).toBe('HIT_MEMORY');

      // 2. Bounded memory cache cap (evicts oldest when exceeding cap)
      clearPublicScanCacheForTesting();
      setPublicScanMemoryCacheCapForTesting(3);
      for (let i = 1; i <= 5; i++) {
        seedCachedAuditRow(`https://bounded-${i}.example`, `aud_bnd_${i}`);
        await executeHardenedPublicScan({ url: `https://bounded-${i}.example` });
      }
      expect(getPublicScanMemoryCacheSizeForTesting()).toBe(3);

      // 3. Explicit MISS -> D1_WRITE_FAILED when durable_events write fails
      clearPublicScanCacheForTesting();
      const injectedFetch = (async () =>
        new Response('<html><head><title>Fresh Scan</title></head><body>Hi</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        })) as unknown as typeof fetch;

      const db = getDb();
      const origPrepare = db.prepare.bind(db);
      const spyWriteFail = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        if (String(sql).includes('INSERT OR IGNORE INTO durable_events')) {
          throw new Error('SIMULATED_D1_WRITE_ERROR');
        }
        return origPrepare(sql);
      }) as any);

      const writeFailOut = await executeHardenedPublicScan({
        url: 'https://write-fail-cache.example',
        fetchOptionsOverride: { fetchImpl: injectedFetch, skipDnsForInjectedFetch: true }
      });
      expect(writeFailOut.cached).toBe(false);
      expect(writeFailOut.cacheStatus).toBe('D1_WRITE_FAILED');
      spyWriteFail.mockRestore();

      // 4. Explicit D1_READ_FAILED when durable_events read throws (and write succeeds)
      clearPublicScanCacheForTesting();
      const spyReadFail = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        if (String(sql).includes('SELECT payload_json, created_at') && String(sql).includes('durable_events')) {
          throw new Error('SIMULATED_D1_READ_ERROR');
        }
        return origPrepare(sql);
      }) as any);

      const readFailOut = await executeHardenedPublicScan({
        url: 'https://read-fail-cache.example',
        fetchOptionsOverride: { fetchImpl: injectedFetch, skipDnsForInjectedFetch: true }
      });
      expect(readFailOut.cached).toBe(false);
      expect(readFailOut.cacheStatus).toBe('D1_READ_FAILED');
      spyReadFail.mockRestore();
    });

    it('exposes all 4 owner tool pages in GET /sitemap.xml with HTTP 200 parity', async () => {
      const sitemapRes = await app.request('/sitemap.xml');
      expect(sitemapRes.status).toBe(200);
      const xml = await sitemapRes.text();

      const ownerToolPaths = [
        '/tools/whatsapp-link-preview-checker',
        '/tools/open-graph-checker',
        '/tools/robots-and-sitemap-validator',
        '/tools/json-ld-tester'
      ];

      for (const toolPath of ownerToolPaths) {
        expect(xml).toContain(`<loc>https://ai-marketing-organization.onrender.com${toolPath}</loc>`);
        const pageRes = await app.request(toolPath);
        expect(pageRes.status, `${toolPath} must return HTTP 200`).toBe(200);
      }
    });

    it('propagates a single source across scan -> preview_open -> checkout_start -> capture -> delivered and separates uniqueVisitors vs scanAttempts vs completedScans on /api/v1/owner/today', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM durable_events WHERE event_type = ?`).run(SITEFIX_FUNNEL_EVENT_TYPE);

      const sourcesToVerify: SiteFixLaunchSource[] = [
        'web_whatsapp_preview',
        'cli',
        'action',
        'mcp'
      ];

      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.SITE_AUDIT_TERMS_SHA256 = SiteAuditService.computeTermsFileHash() || '';
      process.env.RAZORPAY_MODE = 'TEST';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_attr_e2e_01';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_test_attr_e2e_secret_01';

      const service = SiteAuditService.getInstance();

      for (let idx = 0; idx < sourcesToVerify.length; idx++) {
        const src = sourcesToVerify[idx];
        const visitorIp = `198.51.100.${10 + idx}`;
        const visitorUa = `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Visitor/${idx}`;
        const targetUrl = `https://e2e-${src}.example`;
        const auditId = `aud_e2e_${src}`;
        const orderId = `order_e2e_${src}`;
        const paymentId = `pay_e2e_${src}`;

        // Seed cached audit & persist to SiteAuditService so deliverable generation works
        seedCachedAuditRow(targetUrl, auditId);
        await service.persistAuditToD1({
          auditId,
          url: `${targetUrl}/`,
          scannedAt: new Date().toISOString(),
          overallStatus: 'NEEDS_IMPROVEMENT',
          score: 75,
          scoreExplanation: 'E2E attribution fixture',
          findings: [],
          metrics: {
            httpStatus: 200,
            responseTimeMs: 20,
            htmlSizeBytes: 512,
            contentType: 'text/html',
            redirectChain: [`${targetUrl}/`],
            hasRobotsTxt: true,
            hasSitemap: true,
            jsonLdTypesFound: ['WebSite'],
            contactChannelsFound: []
          },
          preview: {
            title: `Site ${src}`,
            metaDescription: `Desc ${src}`,
            canonicalUrl: `${targetUrl}/`,
            ogTitle: `Site ${src}`,
            ogImage: `${targetUrl}/og.png`,
            fixPackSnippetPreview: '<title>Site</title>'
          },
          disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true }
        });

        // 1. Scan attempt + completed scan (same visitor runs 2 scan attempts: 1 failed attempt + 1 completed scan)
        const expectedVisitorHash = hashFunnelVisitorKey(`${visitorIp}|${visitorUa}`);
        const attemptWrite = await recordSiteFixFunnelEvent({
          stage: 'scan_attempt',
          source: src,
          isProbe: false,
          url: targetUrl,
          userAgent: visitorUa,
          visitorHash: expectedVisitorHash,
          authorizationMode: 'SELF_DECLARED_AUTHORIZATION'
        });
        expect(attemptWrite.persisted).toBe(true);
        const scanRes = await app.request('/api/v1/public/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': visitorIp,
            'User-Agent': visitorUa
          },
          body: JSON.stringify({
            url: targetUrl,
            confirmAuthorized: true,
            source: src
          })
        });
        expect(scanRes.status).toBe(200);

        // 2. preview_open (same visitor)
        const previewRes = await app.request(`/tools/site-audit?url=${encodeURIComponent(targetUrl)}&source=${src}`, {
          headers: {
            'x-forwarded-for': visitorIp,
            'User-Agent': visitorUa
          }
        });
        expect(previewRes.status).toBe(200);

        // 3. checkout_start -> insert payment_orders with originating source (same visitor)
        db.prepare(
          `INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
           VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, ?, datetime('now'), datetime('now'))`
        ).run(
          `po_e2e_${src}`,
          orderId,
          auditId,
          JSON.stringify({ auditId, sku: 'SITEFIX_AI_PACK_V1', source: src })
        );
        await recordSiteFixFunnelEvent({
          stage: 'checkout_start',
          source: src,
          isProbe: false,
          auditId,
          orderId,
          userAgent: visitorUa,
          visitorHash: expectedVisitorHash
        });

        // 4. capture -> transition payment_orders to PAID + record capture with same source
        db.prepare(
          `UPDATE payment_orders SET status = 'PAID', payment_id = ?, updated_at = datetime('now') WHERE order_id = ?`
        ).run(paymentId, orderId);
        await recordSiteFixFunnelEvent({
          stage: 'capture',
          source: src,
          isProbe: false,
          auditId,
          orderId,
          paymentId,
          userAgent: visitorUa,
          visitorHash: expectedVisitorHash
        });

        // 5. delivered -> download WITHOUT ?source= query param; MUST inherit source from payment_orders.notes_json!
        const token = service.generateDeliveryToken(orderId, auditId, paymentId, 72);
        const dlRes = await app.request(`/api/v1/offer/download/${encodeURIComponent(token)}?format=json`, {
          headers: {
            'x-forwarded-for': visitorIp,
            'User-Agent': visitorUa
          }
        });
        expect(dlRes.status).toBe(200);
      }

      // Inspect /api/v1/owner/today and assert exact per-source E2E counts + metric separation
      const ownerSession = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const todayRes = await app.request('/api/v1/owner/today', {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
      });
      expect(todayRes.status).toBe(200);
      const todayJson = (await todayRes.json()) as any;
      const attr = todayJson.data?.sitefixFunnelAttribution;
      expect(attr).toBeDefined();
      expect(attr.reportingWindow).toBe('LATEST_5000_EVENTS');
      expect(attr.eventLimitReached).toBe(false);

      for (const src of sourcesToVerify) {
        expect(attr.bySource[src].distinctVisitorFingerprints).toBe(1);
        expect(attr.bySource[src].scanAttempts).toBe(2);
        expect(attr.bySource[src].completedScans).toBe(1);
        expect(attr.bySource[src].scan).toBe(1);
        expect(attr.bySource[src].page_view).toBe(1);
        expect(attr.bySource[src].checkout_start).toBe(1);
        expect(attr.bySource[src].capture).toBe(1);
        expect(attr.bySource[src].delivery).toBe(1);
        expect(attr.bySource[src].delivered).toBe(1);
      }

      expect(attr.totals.distinctVisitorFingerprints).toBe(4);
      expect(attr.totals.scanAttempts).toBe(8);
      expect(attr.totals.completedScans).toBe(4);
      expect(attr.totals.delivered).toBe(4);
      resetSiteFixFunnelWriteMetricsForTesting();
    });
  });
});
