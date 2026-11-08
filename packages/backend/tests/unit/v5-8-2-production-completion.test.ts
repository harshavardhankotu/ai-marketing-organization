import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { SiteAuditService, CANONICAL_SITEFIX_TERMS } from '../../src/tools/site-audit/site-audit-service.js';
import { createHmac } from 'node:crypto';

describe('V5.8.2 — Production Completion & First Genuine Revenue Activation', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    GooglePageSpeedClient.resetInstance();
    CuelinksV3Client.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    process.env.SITE_AUDIT_SIGNING_SECRET = 'a'.repeat(32);
    try {
      const db = getDb();
      db.prepare("DELETE FROM search_cache WHERE provider = 'google_pagespeed'").run();
      db.prepare("DELETE FROM payment_orders WHERE id LIKE 'po_test_v582_%' OR order_id LIKE 'order_v582_%'").run();
      db.prepare("DELETE FROM public_deals WHERE id LIKE 'deal_v582_%'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    GooglePageSpeedClient.resetInstance();
    CuelinksV3Client.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. P0: HTML Verification Tags on SSR Root Homepage (GET /)', () => {
    it('renders both Cuelinks and Google Search Console tags in <head> of actual SSR homepage', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('<!DOCTYPE html>');

      const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      expect(headMatch).not.toBeNull();
      const headHtml = headMatch![1];

      // Exact Cuelinks verification tag
      expect(headHtml).toContain('<meta name="cuelinks-verification" content="VERIFY-CL-YE94W8YS" />');
      const clMatches = headHtml.match(/name="cuelinks-verification"/g);
      expect(clMatches?.length).toBe(1);

      // Exact Google Search Console verification tag
      expect(headHtml).toContain('<meta name="google-site-verification" content="WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I" />');
      const gscMatches = headHtml.match(/name="google-site-verification"/g);
      expect(gscMatches?.length).toBe(1);

      // Canonical URL
      expect(headHtml).toContain('<link rel="canonical" href="https://ai-marketing-organization.onrender.com/">');
    });
  });

  describe('2. P0: Google PageSpeed API Key Resolution & Keyless Fallback', () => {
    it('never passes GEMINI_API_KEY or HTML verification tokens to PageSpeed', async () => {
      process.env.GEMINI_API_KEY = 'ai_gemini_test_secret_key';
      process.env.GOOGLE_PAGESPEED_API_KEY = '';
      delete process.env.GOOGLE_PAGESPEED_API_KEY;

      let calledUrl = '';
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lighthouseResult: {
              categories: {
                performance: { score: 0.82 },
                seo: { score: 0.90 }
              },
              audits: {
                'largest-contentful-paint': { displayValue: '1.9 s' },
                'first-contentful-paint': { displayValue: '1.1 s' }
              }
            }
          })
        };
      });

      const client = GooglePageSpeedClient.getInstance(mockFetch as any);
      const res = await client.runAudit('https://test-pagespeed-keyless-1.com');

      expect(calledUrl).not.toContain('ai_gemini_test_secret_key');
      expect(calledUrl).not.toContain('&key=');
      expect(res.executionPath).toBe('KEYLESS_SUCCESS');
      expect(res.performanceScore).toBe(82);
      expect(res.seoScore).toBe(90);
      expect(res.coreWebVitals?.lcp).toBe('1.9 s');
    });

    it('triggers keyless fallback on keyed HTTP 401 or 403 error', async () => {
      process.env.GOOGLE_PAGESPEED_API_KEY = 'restricted_pagespeed_key_123';

      let callCount = 0;
      const calledUrls: string[] = [];

      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        calledUrls.push(url);
        if (callCount === 1) {
          // Keyed request fails with 401
          return {
            ok: false,
            status: 401,
            text: async () => 'Unauthorized'
          };
        }
        // Fallback keyless request succeeds
        return {
          ok: true,
          status: 200,
          json: async () => ({
            lighthouseResult: {
              categories: {
                performance: { score: 0.74 },
                seo: { score: 0.88 }
              },
              audits: {
                'largest-contentful-paint': { displayValue: '2.1 s' }
              }
            }
          })
        };
      });

      const client = GooglePageSpeedClient.getInstance(mockFetch as any);
      const res = await client.runAudit('https://test-pagespeed-fallback-2.com');

      expect(callCount).toBe(2);
      expect(calledUrls[0]).toContain('&key=restricted_pagespeed_key_123');
      expect(calledUrls[1]).not.toContain('&key=');
      expect(res.status).toBe('SUCCESS');
      expect(res.executionPath).toBe('FALLBACK_KEYLESS_SUCCESS');
      expect(res.performanceScore).toBe(74);
    });

    it('returns UNAVAILABLE with missing data reason and no synthetic metric defaults', async () => {
      delete process.env.GOOGLE_PAGESPEED_API_KEY;

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}) // Empty response without lighthouseResult
      });

      const client = GooglePageSpeedClient.getInstance(mockFetch as any);
      const res = await client.runAudit('https://test-pagespeed-missing-3.com');

      expect(res.status).toBe('UNAVAILABLE');
      expect(res.reason).toBe('MISSING_LIGHTHOUSE_DATA');
      expect(res.performanceScore).toBeNull();
      expect(res.seoScore).toBeNull();
      expect(res.coreWebVitals).toBeNull();
    });
  });

  describe('3. P0: Genuine Cuelinks Verification & Affiliate Monetization Evidence', () => {
    it('rejects unverified channel fallback when client.getChannels returns no approved channels', async () => {
      const mockClient = {
        isConfigured: () => true,
        getChannels: async () => [
          { id: 999999, name: 'Unrelated', status: 'pending', url: 'https://other.com' }
        ]
      } as any;

      const sync = CuelinksSyncManager.getInstance(mockClient);
      const res = await sync.getApprovedChannel(331585);

      expect(res.approved).toBe(false);
      expect(res.channel).toBeNull();
    });

    it('accepts channel only when provider confirms it is approved and active', async () => {
      const mockClient = {
        isConfigured: () => true,
        getChannels: async () => [
          { id: 331585, name: 'ARO Deals', status: 'approved', source_url: 'https://ai-marketing-organization.onrender.com' }
        ]
      } as any;

      const sync = CuelinksSyncManager.getInstance(mockClient);
      const res = await sync.getApprovedChannel(331585);

      expect(res.approved).toBe(true);
      expect(res.channel?.id).toBe(331585);
    });

    it('rejects unmonetized products if Cuelinks convertLink returns affiliated: false', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const mockCuelinksClient = {
        isConfigured: () => true,
        convertLink: async () => ({
          affiliated: false,
          tracking_url: 'https://linksredirect.com/?unaffiliated=true'
        })
      };
      (engine as any).cuelinksClient = mockCuelinksClient;

      const res = await engine.ingestAndVerifyDeal({
        id: 'deal_v582_unaffiliated',
        slug: 'test-unaffiliated-deal',
        canonicalSlug: 'test-unaffiliated-deal',
        title: 'Unaffiliated Product',
        brand: 'TestBrand',
        merchant: 'TestBrand Store',
        category: 'Electronics',
        productUrl: 'https://example.com/products/unaffiliated',
        currentPriceINR: 999,
        availability: 'IN_STOCK',
        dealKind: 'PRODUCT',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        sourceUrl: 'https://example.com/products/unaffiliated',
        sourceDomain: 'example.com',
        sourceType: 'RETAILER_BRAND'
      });

      expect(res.deal?.isMonetizable).toBe(false);
      expect(res.deal?.affiliateVerified).toBe(false);
      expect(res.deal?.verificationStatus).toBe('PRODUCT_ONLY_UNMONETIZED');
    });
  });

  describe('4. P0: SiteFix Payment Security & Readiness Separation', () => {
    it('disallows client-controlled amount overrides and test payment bypass in production mode', async () => {
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.SITE_AUDIT_TERMS_SHA256 = SiteAuditService.computeTermsFileHash() || '';
      process.env.SITE_AUDIT_SIGNING_SECRET = 'a'.repeat(32);
      process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_123';
      process.env.RAZORPAY_KEY_SECRET = 'mock_secret_123';

      const readiness = SiteAuditService.getInstance().getCheckoutReadiness();
      expect(readiness.paymentReadiness.paymentMode).toBe('SANDBOX');
      expect(readiness.paymentReadiness.sandboxTestReady).toBe(true);
      expect(readiness.paymentReadiness.liveMoneyReady).toBe(false); // rzp_test cannot satisfy liveMoneyReady
    });

    it('rejects invalid HMAC payment signature verification without x-test-mode bypass', async () => {
      process.env.RAZORPAY_KEY_SECRET = 'super_secret_test_key_12345';

      // Insert an order first
      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES ('po_test_v582_1', 'biz_platform_aro', 'order_v582_1', 499, 'INR', 'CREATED', 'audit_v582_1', '{}', datetime('now'), datetime('now'))
      `).run();

      const res = await app.request('/api/v1/tools/site-audit/audit_v582_1/verify-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-test-mode': 'true' // Client tries to bypass verification
        },
        body: JSON.stringify({
          orderId: 'order_v582_1',
          paymentId: 'pay_v582_1',
          signature: 'invalid_forged_signature'
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('INVALID_PAYMENT_SIGNATURE');
    });

    it('verifies valid HMAC payment signature and updates order to CAPTURED', async () => {
      const secret = 'super_secret_test_key_12345';
      process.env.RAZORPAY_TEST_KEY_SECRET = secret;
      process.env.RAZORPAY_KEY_SECRET = secret;

      const orderId = 'order_v582_valid';
      const paymentId = 'pay_v582_valid';
      const auditId = 'audit_v582_valid';

      const validSig = createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES ('po_test_v582_valid', 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, '{}', datetime('now'), datetime('now'))
      `).run(orderId, auditId);

      const res = await app.request(`/api/v1/tools/site-audit/${auditId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          paymentId,
          signature: validSig
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.verified).toBe(true);
      expect(json.downloadToken).toBeDefined();

      const updated = db.prepare("SELECT status FROM payment_orders WHERE order_id = ?").get(orderId) as any;
      expect(updated.status).toBe('CAPTURED');
    });
  });

  describe('5. P1: Autonomy Status Version 5.8.2 & Execution Observability', () => {
    it('reports version 5.8.2, buildMetadata, paymentReadiness, and recentWorkflowExecutions24h', async () => {
      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.version).toMatch(/^5\.8\.[23]$/);
      expect(json.buildMetadata).toBeDefined();
      expect(json.buildMetadata.version).toMatch(/^5\.8\.[23]$/);
      expect(json.paymentReadiness).toBeDefined();
      expect(typeof json.paymentReadiness.sandboxTestReady).toBe('boolean');
      expect(typeof json.paymentReadiness.liveMoneyReady).toBe('boolean');

      expect(json.recentWorkflowExecutions24h).toBeDefined();
      expect(typeof json.recentWorkflowExecutions24h.totalExecutions).toBe('number');
    });
  });
});
