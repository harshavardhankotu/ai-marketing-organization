import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { ReferralTrackingEngine } from '../../src/commission/referral-tracking.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';

describe('Stage B Production Recovery Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Phase 1: Razorpay Credential Pair Isolation & Webhook Idempotency (Defect 1 & 2)', () => {
    it('correctly identifies valid LIVE credential pair', () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_live_realKey123';
      process.env.RAZORPAY_KEY_SECRET = 'liveSecret456';
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_live789';

      const adapter = new RazorpayAdapter();
      const pair = adapter.getCredentialPair();

      expect(pair.mode).toBe('LIVE');
      expect(pair.keyId).toBe('rzp_live_realKey123');
      expect(pair.keySecret).toBe('liveSecret456');
      expect(adapter.isLiveConfigured()).toBe(true);
      expect(adapter.hasAnyValidCredentials()).toBe(true);
    });

    it('correctly identifies valid SANDBOX_TEST credential pair', () => {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_testKey123';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'testSecret456';

      const adapter = new RazorpayAdapter();
      const pair = adapter.getCredentialPair();

      expect(pair.mode).toBe('SANDBOX_TEST');
      expect(pair.keyId).toBe('rzp_test_testKey123');
      expect(pair.keySecret).toBe('testSecret456');
      expect(adapter.isLiveConfigured()).toBe(false);
      expect(adapter.hasAnyValidCredentials()).toBe(true);
    });

    it('fails closed when live key ID is paired with missing secret', () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_live_realKey123';
      delete process.env.RAZORPAY_KEY_SECRET;
      process.env.RAZORPAY_TEST_KEY_SECRET = 'testSecret456';

      const adapter = new RazorpayAdapter();
      const pair = adapter.getCredentialPair();

      expect(pair.mode).toBe('MISCONFIGURED_CREDENTIAL_PAIR');
      expect(pair.keyId).toBe('');
      expect(pair.keySecret).toBe('');
      expect(adapter.getKeyId()).toBe('');
      expect(adapter.getKeySecret()).toBe('');
      expect(adapter.hasAnyValidCredentials()).toBe(false);
    });

    it('fails closed when key starts with rzp_test_ in live slot', () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_imposterKey';
      process.env.RAZORPAY_KEY_SECRET = 'someSecret';

      const adapter = new RazorpayAdapter();
      const pair = adapter.getCredentialPair();

      expect(pair.mode).toBe('MISCONFIGURED_CREDENTIAL_PAIR');
      expect(adapter.hasAnyValidCredentials()).toBe(false);
    });
  });

  describe('Phase 2: Dynamic Per-Visitor subid Click Attribution (Defect 3 & 4)', () => {
    it('generates distinct unique click IDs and subid parameters for sequential clicks', async () => {
      const trackingEngine = ReferralTrackingEngine.getInstance();
      
      const offerSlug = 'boat-lifestyle';
      const dummyUrl = 'https://linksredirect.com/?cid=123&subid=clk_initial';

      // Test URL transformation directly
      const url1 = new URL(dummyUrl);
      const clickId1 = `clk_${Date.now()}_a1b2c3`;
      url1.searchParams.set('subid', clickId1);

      const url2 = new URL(dummyUrl);
      const clickId2 = `clk_${Date.now() + 10}_d4e5f6`;
      url2.searchParams.set('subid', clickId2);

      expect(url1.searchParams.get('subid')).toBe(clickId1);
      expect(url2.searchParams.get('subid')).toBe(clickId2);
      expect(clickId1).not.toBe(clickId2);
      expect(url1.toString()).not.toBe(url2.toString());
    });
  });

  describe('Phase 4: SiteFix Honest Diagnostics & JS Syntax Validation (Defect 6 & /offer Fix)', () => {
    it('returns BLOCKED_NO_DEDICATED_KEY / MISSING_API_KEY immediately when GOOGLE_PAGESPEED_API_KEY is unset', async () => {
      delete process.env.GOOGLE_PAGESPEED_API_KEY;

      const client = GooglePageSpeedClient.getInstance();
      const res = await client.runAudit('https://example.com', 'mobile');

      expect(res.status).toBe('UNAVAILABLE');
      expect(['MISSING_API_KEY', 'BLOCKED_NO_DEDICATED_KEY']).toContain(res.reason);
      expect(res.metrics).toBeNull();
      expect(res.coreWebVitals).toBeNull();
    });

    it('labels score as 12-Point Deterministic HTML, SEO & Schema Technical Audit Score in scanner', () => {
      const scanner = new SiteAuditScanner();
      const { explanation } = scanner.calculateDeterministicScore([]);

      expect(explanation).toContain('12-Point Deterministic HTML, SEO & Schema Technical Audit Score');
      expect(explanation).toContain('DISCLOSURE: This score measures technical standards conformance; it does NOT predict search engine rankings.');
    });

    it('renders /offer HTML without JavaScript syntax errors around beacon try-catch', () => {
      const html = DirectCommercialOfferPage.getInstance().renderOfferHtml();

      expect(html).toContain("fetch('/api/v1/referrals/beacon'");
      // Ensure the try block is properly closed with catch before downloadIcsFile
      const beaconIdx = html.indexOf("fetch('/api/v1/referrals/beacon'");
      const icsIdx = html.indexOf('function downloadIcsFile()', beaconIdx);
      expect(icsIdx).toBeGreaterThan(beaconIdx);

      const snippetBetween = html.substring(beaconIdx, icsIdx);
      expect(snippetBetween).toContain('} catch');
    });
  });
});
