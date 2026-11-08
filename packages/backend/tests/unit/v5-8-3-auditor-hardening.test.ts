import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import {
  AutonomousDealDiscoveryEngine,
  APPROVED_SHOPIFY_MERCHANTS
} from '../../src/commission/autonomous-deal-discovery-engine.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { createHmac } from 'node:crypto';

describe('V5.8.3 — Auditor-Aligned Production Hardening', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    GooglePageSpeedClient.resetInstance();
    CuelinksV3Client.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    process.env.SITE_AUDIT_SIGNING_SECRET = 'a'.repeat(32);

    try {
      const db = getDb();
      db.prepare("DELETE FROM payment_orders WHERE id LIKE 'po_v583_%' OR order_id LIKE 'order_v583_%'").run();
      db.prepare("DELETE FROM public_deals WHERE id LIKE 'deal_v583_%'").run();
      db.prepare("DELETE FROM cuelinks_campaigns WHERE campaign_id LIKE 'camp_v583_%'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    GooglePageSpeedClient.resetInstance();
    CuelinksV3Client.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. Razorpay Auditor Verification Hardening & Replay Prevention', () => {
    const keySecret = 'rzp_test_secret_fixture_583';
    const keyId = 'rzp_test_fixture_583';

    it('rejects verification if HMAC signature is invalid', async () => {
      process.env.RAZORPAY_KEY_SECRET = keySecret;
      process.env.RAZORPAY_KEY_ID = keyId;

      const orderId = 'order_v583_hmac_test';
      const paymentId = 'pay_v583_hmac_test';

      const res = await app.request('/api/v1/tools/site-audit/audit_v583_1/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: 'invalid_tampered_signature_hex'
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('INVALID_PAYMENT_SIGNATURE');
    });

    it('fails closed when Razorpay payment status is not captured', async () => {
      process.env.RAZORPAY_KEY_SECRET = keySecret;
      process.env.RAZORPAY_KEY_ID = keyId;
      process.env.TEST_VERIFY_RAZORPAY_API = 'true';

      const orderId = 'order_v583_uncaptured';
      const paymentId = 'pay_v583_uncaptured';
      const auditId = 'audit_v583_uncaptured';

      // Seed order in CREATED status
      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, '{}', datetime('now'), datetime('now'))
      `).run('po_v583_uncaptured', orderId, auditId);

      const validSig = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');

      // Mock Razorpay API returning 'authorized' instead of 'captured'
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('api.razorpay.com')) {
          return new Response(JSON.stringify({
            id: paymentId,
            status: 'authorized',
            order_id: orderId,
            amount: 49900,
            currency: 'INR'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200 });
      });

      const res = await app.request(`/api/v1/tools/site-audit/${auditId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig
        })
      });

      expect(res.status).toBe(402);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('PAYMENT_NOT_CAPTURED');
      fetchSpy.mockRestore();
    });

    it('fails closed when Razorpay amount does not match expected order amount', async () => {
      process.env.RAZORPAY_KEY_SECRET = keySecret;
      process.env.RAZORPAY_KEY_ID = keyId;
      process.env.TEST_VERIFY_RAZORPAY_API = 'true';

      const orderId = 'order_v583_amount_mismatch';
      const paymentId = 'pay_v583_amount_mismatch';
      const auditId = 'audit_v583_amount_mismatch';

      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, '{}', datetime('now'), datetime('now'))
      `).run('po_v583_amount_mismatch', orderId, auditId);

      const validSig = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');

      // Gateway returns 100 paise instead of 49900 paise
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('api.razorpay.com')) {
          return new Response(JSON.stringify({
            id: paymentId,
            status: 'captured',
            order_id: orderId,
            amount: 100, // Mismatch!
            currency: 'INR'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200 });
      });

      const res = await app.request(`/api/v1/tools/site-audit/${auditId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('PAYMENT_AMOUNT_MISMATCH');
      fetchSpy.mockRestore();
    });

    it('verifies valid captured payment and blocks replay attempt with HTTP 409', async () => {
      process.env.RAZORPAY_KEY_SECRET = keySecret;
      process.env.RAZORPAY_KEY_ID = keyId;
      process.env.TEST_VERIFY_RAZORPAY_API = 'true';

      const orderId = 'order_v583_atomic_replay';
      const paymentId = 'pay_v583_atomic_replay';
      const auditId = 'audit_v583_atomic_replay';

      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, '{}', datetime('now'), datetime('now'))
      `).run('po_v583_atomic_replay', orderId, auditId);

      const validSig = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
        if (String(url).includes('api.razorpay.com')) {
          return new Response(JSON.stringify({
            id: paymentId,
            status: 'captured',
            order_id: orderId,
            amount: 49900,
            currency: 'INR'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200 });
      });

      // Call 1: First verification succeeds
      const res1 = await app.request(`/api/v1/tools/site-audit/${auditId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig
        })
      });

      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(json1.verified).toBe(true);
      expect(json1.downloadToken).toBeDefined();

      // Database order status is now CAPTURED
      const orderRow = db.prepare('SELECT status, payment_id FROM payment_orders WHERE order_id = ?').get(orderId) as any;
      expect(orderRow.status).toBe('CAPTURED');
      expect(orderRow.payment_id).toBe(paymentId);

      // Call 2: Replay attempt with same orderId MUST return HTTP 409 Conflict
      const res2 = await app.request(`/api/v1/tools/site-audit/${auditId}/verify-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: validSig
        })
      });

      expect(res2.status).toBe(409);
      const json2 = await res2.json();
      expect(json2.success).toBe(false);
      expect(json2.error).toContain('ORDER_ALREADY_CAPTURED');

      fetchSpy.mockRestore();
    });
  });

  describe('2. Cuelinks Static Fallback Purge & True affiliated === true Gate', () => {
    it('discovers verified active merchants dynamically from cuelinks_campaigns', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO cuelinks_campaigns (campaign_id, name, merchant_domain, category, status, verification_source, created_at, updated_at)
        VALUES ('camp_v583_dyn_boat', 'boAt Lifestyle', 'boat-lifestyle.com', 'Electronics', 'ACTIVE', 'CUELINKS_API_V3', datetime('now'), datetime('now'))
      `).run();

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const merchants = await engine.getActiveVerifiedMerchants('SECTOR_B_ELECTRONICS');
      expect(merchants.some(m => m.domain === 'boat-lifestyle.com')).toBe(true);
      expect(merchants.some(m => m.cuelinksCampaignId === 'camp_v583_dyn_boat')).toBe(true);
    });

    it('rejects monetization and evicts deal from memory if convertLink returns affiliated: false', async () => {
      process.env.CUELINKS_API_KEY = 'test_api_key';
      process.env.CUELINKS_CHANNEL_ID = '331585';

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinksClient = engine.getCuelinksClient();

      // Mock Cuelinks API returning affiliated: false (unaffiliated merchant/link)
      vi.spyOn(cuelinksClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
        url: 'https://unaffiliated-shop.example.com/p/123',
        affiliated: false,
        tracking_url: 'https://linksredirect.com/?cid=123&url=test' // Has tracking_url but affiliated is FALSE!
      });

      const res = await engine.ingestAndVerifyDeal({
        id: 'deal_v583_unaffiliated_1',
        title: 'Unaffiliated Noise Cancelling Headphones',
        brand: 'GenericBrand',
        merchant: 'UnaffiliatedShop',
        category: 'Electronics',
        productUrl: 'https://unaffiliated-shop.example.com/p/123',
        currentPriceINR: 1999,
        referencePriceINR: 2999,
        availability: 'IN_STOCK',
        sourceUrl: 'https://unaffiliated-shop.example.com/feed',
        sourceDomain: 'unaffiliated-shop.example.com',
        sourceType: 'MERCHANT_SHOPIFY_FEED',
        isMonetizable: true, // Caller tries to claim monetizable
        trackingUrl: 'https://linksredirect.com/spoofed' // Caller tries to pass tracking url
      });

      // Deal verification must fail affiliate check
      expect(res.deal.affiliateVerified).toBe(false);
      expect(res.deal.isMonetizable).toBe(false);
      expect(res.deal.trackingUrl).toBeUndefined();
      expect(res.deal.verificationStatus).toBe('PRODUCT_ONLY_UNMONETIZED');

      // Must be excluded from eligible public deals catalog
      const eligible = await engine.getEligiblePublicDeals();
      expect(eligible.deals.some(d => d.id === 'deal_v583_unaffiliated_1')).toBe(false);
    });

    it('verifies and retains deal when convertLink returns affiliated: true with active campaign', async () => {
      process.env.CUELINKS_API_KEY = 'test_api_key';
      process.env.CUELINKS_CHANNEL_ID = '331585';

      const db = getDb();
      // Seed active verified Cuelinks campaign
      db.prepare(`
        INSERT INTO cuelinks_campaigns (campaign_id, name, merchant_domain, category, status, verification_source, created_at, updated_at)
        VALUES ('camp_v583_boat', 'boAt Lifestyle', 'boat-lifestyle.com', 'Electronics', 'ACTIVE', 'CUELINKS_API_V3', datetime('now'), datetime('now'))
      `).run();

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cuelinksClient = engine.getCuelinksClient();

      vi.spyOn(cuelinksClient, 'isConfigured').mockReturnValue(true);
      vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
        url: 'https://www.boat-lifestyle.com/products/airdopes-141',
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=4232&subid=test&url=boat',
        campaign: { id: 'camp_v583_boat', name: 'boAt Lifestyle' }
      });

      const res = await engine.ingestAndVerifyDeal({
        id: 'deal_v583_boat_verified',
        title: 'boAt Airdopes 141 Bluetooth Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
        currentPriceINR: 1299,
        referencePriceINR: 4490,
        availability: 'IN_STOCK',
        sourceUrl: 'https://www.boat-lifestyle.com/feed',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'MERCHANT_SHOPIFY_FEED'
      });

      expect(res.deal.affiliateVerified).toBe(true);
      expect(res.deal.isMonetizable).toBe(true);
      expect(res.deal.trackingUrl).toContain('linksredirect.com');
      expect(res.deal.verificationStatus).toBe('VERIFIED');

      // Cached in dealsMap
      const cached = engine.getDealById('deal_v583_boat_verified');
      expect(cached).toBeDefined();
      expect(cached?.id).toBe('deal_v583_boat_verified');

      // getEligiblePublicDeals returns it
      const eligible = await engine.getEligiblePublicDeals();
      expect(eligible.deals.some(d => d.id === 'deal_v583_boat_verified')).toBe(true);
    });
  });

  describe('3. Clean Homepage Without Public Sandbox Test Artifacts', () => {
    it('serves SSR root homepage (GET /) without sandbox card or test checkout script', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Verification meta tags must be present
      expect(html).toContain('<meta name="cuelinks-verification" content="VERIFY-CL-YE94W8YS" />');
      expect(html).toContain('<meta name="google-site-verification" content="WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I" />');

      // Sandbox test artifacts MUST BE ABSENT from public homepage
      expect(html).not.toContain('id="razorpay-sandbox-test-panel"');
      expect(html).not.toContain('Razorpay Payment Gateway Sandbox Verification');
      expect(html).not.toContain('runRazorpayLiveTestCheckout');
      expect(html).not.toContain('🧪 Razorpay Payment Gateway');
    });
  });

  describe('4. Honest Telemetry & Dynamic Observability', () => {
    it('reports UNCONFIGURED_KEYLESS_MODE for PageSpeed when API key is unset', async () => {
      delete process.env.GOOGLE_PAGESPEED_API_KEY;

      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.version).toMatch(/^5\.8\.[34]$/);
      expect(json.buildMetadata.version).toMatch(/^5\.8\.[34]$/);
      expect(json.quotaLedger.google_pagespeed.configuredStatus).toBe('UNCONFIGURED_KEYLESS_MODE');
      expect(['CONFIGURED', 'UNCONFIGURED_KEYLESS_MODE']).toContain(json.capabilityMatrix.pageSpeedInsights.status);
    });

    it('reports CONFIGURED_API_KEY for PageSpeed when API key is set', async () => {
      process.env.GOOGLE_PAGESPEED_API_KEY = 'ai_key_fixture_pagespeed_123';

      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.quotaLedger.google_pagespeed.configuredStatus).toBe('CONFIGURED_API_KEY');
      expect(['CONFIGURED', 'CONFIGURED_API_KEY']).toContain(json.capabilityMatrix.pageSpeedInsights.status);
    });

    it('reports CHANNEL_APPROVED_NO_AFFILIATED_LINKS when channel is approved but 0 deals affiliated', async () => {
      process.env.CUELINKS_API_KEY = 'cl_live_fixture_key_123';
      process.env.CUELINKS_CHANNEL_ID = '331585';

      // Ensure 0 affiliate_verified deals in DB
      const db = getDb();
      db.prepare('DELETE FROM public_deals').run();

      vi.spyOn(CuelinksSyncManager.getInstance(), 'getApprovedChannel').mockResolvedValue({
        channelId: 331585,
        name: 'AutoRevenue Platform',
        url: 'https://ai-marketing-organization.onrender.com',
        approved: true
      });

      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.capabilityMatrix.cuelinksAffiliate.status).toBe('CHANNEL_APPROVED_NO_AFFILIATED_LINKS');
    });

    it('reports LIVE_VERIFIED for Cuelinks only when channel is approved AND >= 1 deal is affiliated', async () => {
      process.env.CUELINKS_API_KEY = 'cl_live_fixture_key_123';
      process.env.CUELINKS_CHANNEL_ID = '331585';

      const db = getDb();
      db.prepare('DELETE FROM public_deals').run();
      db.prepare(`
        INSERT INTO public_deals (id, slug, title, brand, merchant, category, sector_code, product_url, current_price_inr, availability, verification_status, is_monetizable, product_verified, affiliate_verified, created_at, updated_at)
        VALUES ('deal_v583_live_1', 'boat-airdopes-live', 'boAt Airdopes', 'boAt', 'boAt', 'Electronics', 'SECTOR_B_ELECTRONICS', 'https://boat.example.com', 999, 'IN_STOCK', 'VERIFIED', 1, 1, 1, datetime('now'), datetime('now'))
      `).run();

      vi.spyOn(CuelinksSyncManager.getInstance(), 'getApprovedChannel').mockResolvedValue({
        channelId: 331585,
        name: 'AutoRevenue Platform',
        url: 'https://ai-marketing-organization.onrender.com',
        approved: true
      });

      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.capabilityMatrix.cuelinksAffiliate.status).toBe('LIVE_VERIFIED');
    });
  });
});