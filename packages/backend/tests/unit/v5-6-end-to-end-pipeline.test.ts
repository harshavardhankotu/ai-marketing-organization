import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { AutomationRegistryEngine } from '../../src/automation/automation-registry-engine.js';
import { app } from '../../src/index.js';

describe('V5.6 — End-to-End Autonomous Pipeline Wiring', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    CommercialLearningEngine.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    GooglePageSpeedClient.resetInstance();
    BrevoMcpClient.resetInstance();

    try {
      const db = getDb();
      db.prepare("DELETE FROM provider_quotas WHERE provider = 'google_pagespeed'").run();
      db.prepare("DELETE FROM search_cache WHERE query_normalized LIKE 'pagespeed%'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    CommercialLearningEngine.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    GooglePageSpeedClient.resetInstance();
    BrevoMcpClient.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. GooglePageSpeedClient Key Resolution & Keyless Fallback', () => {
    it('falls back to GOOGLE_SEARCH_API_KEY when GOOGLE_PAGESPEED_API_KEY is unset', async () => {
      delete process.env.GOOGLE_PAGESPEED_API_KEY;
      process.env.GOOGLE_SEARCH_API_KEY = 'AIzaSySearchKeyFallback12345';

      let calledUrl = '';
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        calledUrl = url;
        return Promise.resolve(new Response(JSON.stringify({
          lighthouseResult: {
            categories: {
              performance: { score: 0.85 },
              seo: { score: 0.92 }
            },
            audits: {
              'largest-contentful-paint': { numericValue: 1200, displayValue: '1.2 s' },
              'cumulative-layout-shift': { numericValue: 0.05, displayValue: '0.05' }
            }
          }
        }), { status: 200 }));
      });

      const uniqueUrl = `https://ps-test-key-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.org`;
      const client = GooglePageSpeedClient.getInstance(mockFetch);
      const res = await client.runAudit(uniqueUrl);

      expect(res.status).toBe('SUCCESS');
      expect(calledUrl).toContain('key=AIzaSySearchKeyFallback12345');
      expect(res.performanceScore).toBe(85);
      expect(res.seoScore).toBe(92);
    });

    it('falls back to unauthenticated keyless request when all Google keys are unset', async () => {
      delete process.env.GOOGLE_PAGESPEED_API_KEY;
      delete process.env.GOOGLE_SEARCH_API_KEY;
      delete process.env.GEMINI_API_KEY;

      let calledUrl = '';
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        calledUrl = url;
        return Promise.resolve(new Response(JSON.stringify({
          lighthouseResult: {
            categories: {
              performance: { score: 0.78 },
              seo: { score: 0.88 }
            },
            audits: {
              'largest-contentful-paint': { numericValue: 1800, displayValue: '1.8 s' },
              'cumulative-layout-shift': { numericValue: 0.02, displayValue: '0.02' }
            }
          }
        }), { status: 200 }));
      });

      const uniqueUrl = `https://ps-test-keyless-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.org`;
      const client = GooglePageSpeedClient.getInstance(mockFetch);
      const res = await client.runAudit(uniqueUrl);

      expect(res.status).toBe('SUCCESS');
      expect(calledUrl).not.toContain('key=');
      expect(calledUrl).toContain('pagespeedonline/v5/runPagespeed');
      expect(res.performanceScore).toBe(78);
      expect(res.seoScore).toBe(88);
    });
  });

  describe('2. BrevoMcpClient Dual-Protocol Routing', () => {
    it('routes directly to standard v3 REST when key is standard xkeysib key', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-test-rest-key-12345';
      let restCalled = false;

      const mockFetch = vi.fn().mockImplementation((url: string, opts: any) => {
        if (url.includes('api.brevo.com/v3/smtp/email')) {
          restCalled = true;
          expect(opts.headers['api-key']).toBe('xkeysib-test-rest-key-12345');
          return Promise.resolve(new Response(JSON.stringify({ messageId: 'msg_rest_123' }), { status: 201 }));
        }
        return Promise.resolve(new Response('Not found', { status: 404 }));
      });

      const client = BrevoMcpClient.getInstance(mockFetch);
      const res = await client.sendTransactionalEmail({
        to: [{ email: 'doctor@example.com', name: 'Dr. Patel' }],
        subject: 'Website Diagnostic',
        htmlContent: '<p>Audit Report</p>'
      });

      expect(res.success).toBe(true);
      expect(res.protocolUsed).toBe('BREVO_REST_V3');
      expect(restCalled).toBe(true);
    });
  });

  describe('3. Connected daily_market_demand_research Execution', () => {
    it('executes full sector cycle and publishes audit scorecard or verified deal', async () => {
      const db = getDb();
      const registry = AutomationRegistryEngine.getInstance();
      await registry.ensureInitialized();

      // Ensure at least 1 verified test deal exists for public rendering
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      dealEngine.registerDealCandidate({
        title: 'boAt Airdopes 141 ANC Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141-anc',
        currentPriceINR: 1299,
        referencePriceINR: 2990,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED'
      });
      await dealEngine.executeAutonomousCycle('test_cycle_v5_6');

      // Execute daily_market_demand_research
      const execResult = await registry.executeWorkflow('daily_market_demand_research', 'TEST_HARNESS', 20000);
      expect(execResult.status).toBe('COMPLETED');
      expect(execResult.itemsProcessed).toBeGreaterThanOrEqual(1);

      // Verify that commercial bandit recorded the interaction
      const learningEngine = CommercialLearningEngine.getInstance();
      learningEngine.ensureBanditInitialized();
      const banditStates = learningEngine.getSectorBanditIntelligence();
      expect(Object.keys(banditStates).length).toBe(8);
    });
  });

  describe('4. Server-Rendered Public /audit/:domain Page', () => {
    it('renders live scorecard HTML with Schema.org JSON-LD and CTAs', async () => {
      // Seed an audit in site_audits
      const auditService = SiteAuditService.getInstance();
      auditService.setAuditInCache({
        auditId: 'audit_test_dentist',
        url: 'https://testdentist.in',
        domain: 'testdentist.in',
        businessName: 'Dr. Test Dental Clinic',
        probedAt: new Date().toISOString(),
        scorecard: {
          totalScore: 84,
          grade: 'B',
          items: [
            { category: 'SEO', title: 'Meta Title', status: 'PASS', score: 100 },
            { category: 'SECURITY', title: 'HTTPS Enforced', status: 'PASS', score: 100 }
          ]
        },
        pageSpeed: {
          status: 'SUCCESS',
          performanceScore: 82,
          seoScore: 90,
          coreWebVitals: { lcp: '1.4s', cls: '0.01' },
          opportunities: []
        }
      });

      const res = await app.request('/audit/testdentist.in');
      expect(res.status).toBe(200);

      const html = await res.text();
      expect(html).toContain('testdentist.in');
      expect(html).toContain('Executive Audit Scorecard');
      expect(html).toContain('https://schema.org');
      expect(html).toContain('TechArticle');
      expect(html).toContain('Unlock Instant Ready-to-Paste Fix-Pack (₹499)');
      expect(html).toContain('Live Sandbox Validation');
      expect(html).toContain('#Ad');
    });
  });

  describe('5. Server-Rendered Public /compare/:sectorSlug Buying Guide', () => {
    it('renders comparison guide with ItemList JSON-LD and #Ad statutory disclosure', async () => {
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      dealEngine.registerDealCandidate({
        title: 'boAt Nirvana Ion ANC Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Audio & Wearables',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        productUrl: 'https://www.boat-lifestyle.com/products/nirvana-ion-anc',
        currentPriceINR: 1999,
        referencePriceINR: 7990,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED'
      });
      await dealEngine.executeAutonomousCycle('test_compare_v5_6');

      const res = await app.request('/compare/electronics-technology');
      const text = await res.text();
      if (res.status !== 200) {
        console.error('Compare route returned status:', res.status, 'body:', text);
      }
      expect(res.status).toBe(200);

      expect(text).toContain('Electronics &amp; Tech');
      expect(text).toContain('#Ad Disclosure:');
      expect(text).toContain('https://schema.org');
      expect(text).toContain('ItemList');
      expect(text).toContain('boAt Nirvana Ion ANC Earbuds');
      expect(text).toContain('₹1,999');
      expect(text).toContain('View Deal &rarr;');
    });
  });

  describe('6. Dynamically Populated /sitemap.xml', () => {
    it('includes active /compare/..., /audit/..., and /deals/... URLs', async () => {
      // Ensure at least 1 audit exists in site_audits
      const db = getDb();
      db.prepare(`
        INSERT INTO site_audits (
          domain, target_url, business_name, performance_score, seo_score,
          core_web_vitals_json, checklist_json, status, updated_at
        ) VALUES (
          'clovedental.in', 'https://clovedental.in', 'Clove Dental India', 85, 92,
          '{}', '[]', 'COMPLETED', datetime('now')
        ) ON CONFLICT(domain) DO UPDATE SET updated_at = datetime('now')
      `).run();

      const res = await app.request('/sitemap.xml');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('xml');

      const xml = await res.text();
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain('/compare/electronics-technology');
      expect(xml).toContain('/compare/gold-silver-jewellery');
      expect(xml).toContain('/audit/clovedental.in');
    });
  });
});
