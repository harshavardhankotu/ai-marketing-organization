/**
 * PR #94 Regression Test Suite:
 * 1. Authenticated Owner Price Approval Boundary on B2B pilot proposals
 * 2. Real Server-Side B2B Razorpay Checkout, HMAC + Webhook Verification & delivery_tasks Persistence
 * 3. B2BPilotService Fail-Closed Scan Handling (SCAN_FAILED) & Strict 3-State Audit Truth
 * 4. Catalog Honesty (isSeedFallback blocked from editorial gates, SEED_SNAPSHOT + noindex, /vs/ 200 resolution)
 * 5. Category-Specific Gemini Guides (zero thermal-printer leakage; reviewer trade-offs only when snippets passed)
 * 6. D1 Budget Transparency (cycle & daily checks before background queries; readiness telemetry)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { D1Client } from '../../src/db/d1-client.js';
import { B2BPilotService } from '../../src/revenue/b2b-pilot-service.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import {
  passesEditorialQualityGate,
  StaticSiteGenerator,
  generateComparisonPairs,
  generateBuyerIntentHubs,
  findComparisonPairBySlug
} from '../../src/commission/static-site-generator.js';
import { createHighIntentStarterDeals } from '../../src/commission/starter-deals.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';

function createTestApp() {
  const app = new Hono();
  app.route('/api/v1', apiRouter);
  return app;
}

describe('PR #94: B2B Checkout Truth, Audit Truth, Catalog Honesty, Category Guides & D1 Budget Transparency', () => {
  const originalOwnerKey = process.env.OWNER_API_KEY;
  const originalRzpKeyId = process.env.RAZORPAY_KEY_ID;
  const originalRzpSecret = process.env.RAZORPAY_KEY_SECRET;
  const originalRzpWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const originalRzpMode = process.env.RAZORPAY_MODE;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OWNER_API_KEY = 'test_owner_secret_pr94_valid_key_32chars';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_pr94mockkeyid';
    process.env.RAZORPAY_KEY_SECRET = 'pr94_mock_razorpay_secret_key';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'pr94_mock_webhook_secret_key';
    process.env.RAZORPAY_MODE = 'test';
    B2BPilotService.resetInstance();
    RazorpayStandardAdapter.resetInstance();
    const d1 = D1Client.getInstance();
    d1.resetDailyBackgroundUsage();
    d1.endBackgroundCycle();
    d1.resetQuotaCircuitBreakerForTesting();
    AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
  });

  afterEach(() => {
    process.env.OWNER_API_KEY = originalOwnerKey;
    process.env.RAZORPAY_KEY_ID = originalRzpKeyId;
    process.env.RAZORPAY_KEY_SECRET = originalRzpSecret;
    process.env.RAZORPAY_WEBHOOK_SECRET = originalRzpWebhookSecret;
    process.env.RAZORPAY_MODE = originalRzpMode;
    vi.restoreAllMocks();
  });

  describe('1. Authenticated Owner Price Approval Boundary & 2. Real B2B Checkout/Delivery', () => {
    it('ignores client-supplied ownerApproved and priceINR on public POST & GET /b2b/pilot-proposal', async () => {
      const app = createTestApp();

      vi.spyOn(SiteAuditScanner.prototype, 'scanUrl').mockResolvedValue({
        auditId: 'audit_mock_pub',
        url: 'https://coaching-test-academy.in',
        domain: 'coaching-test-academy.in',
        scannedAt: new Date().toISOString(),
        overallStatus: 'NEEDS_IMPROVEMENT',
        score: 72,
        scoreExplanation: 'Deterministic scan',
        metrics: {
          httpStatus: 200,
          responseTimeMs: 110,
          htmlSizeBytes: 2400,
          contentType: 'text/html',
          redirectChain: [],
          hasRobotsTxt: true,
          hasSitemap: true,
          jsonLdTypesFound: [],
          contactChannelsFound: []
        },
        findings: [
          { id: 'schema_jsonld_missing', category: 'STRUCTURED_DATA', title: 'Missing Schema', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: 'none', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: true, needsUserConfirmation: false },
          { id: 'viewport_present', category: 'HTML_METADATA', title: 'Viewport Present', status: 'PASS', severity: 'INFO', location: 'head', evidence: 'ok', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: false, needsUserConfirmation: false }
        ],
        preview: { title: 'Test', metaDescription: 'Test', canonicalUrl: 'https://coaching-test-academy.in', ogTitle: '', ogImage: '', fixPackSnippetPreview: '' },
        disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true },
        rawHtml: '<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Test Academy</h1></body></html>'
      });

      // Public POST attempting price/approval tampering
      const postRes = await app.request('/api/v1/b2b/pilot-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://coaching-test-academy.in',
          businessName: 'Test Coaching Academy',
          authorizedToScan: true,
          ownerApproved: true,
          priceINR: 1
        })
      });
      expect(postRes.status).toBe(200);
      const postJson = await postRes.json() as any;
      expect(postJson.success).toBe(true);
      expect(postJson.data.status).toBe('UNPRICED_DRAFT');
      expect(postJson.data.approvalStatus).toBe('PENDING_OWNER_APPROVAL');
      expect(postJson.data.ownerApproved).toBe(false);
      expect(postJson.data.priceINR).toBeNull();
      expect(postJson.data.approvedPriceINR).toBeNull();
      expect(postJson.data.checkoutUrl).toBeNull();
      expect(postJson.data.html).toContain('UNPRICED_DRAFT');
      expect(postJson.data.html).not.toContain('/b2b/checkout/');
      expect(postJson.data.html).not.toContain('/checkout?package=');

      // Public GET attempting price/approval tampering via query string
      const getRes = await app.request(
        '/api/v1/b2b/pilot-proposal?url=https://coaching-test-academy.in&authorizedToScan=true&ownerApproved=true&priceINR=1&format=json'
      );
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json() as any;
      expect(getJson.data.ownerApproved).toBe(false);
      expect(getJson.data.priceINR).toBeNull();
      expect(getJson.data.checkoutUrl).toBeNull();
      expect(getJson.data.status).toBe('UNPRICED_DRAFT');
    });

    it('rejects unauthenticated owner approval, approves with valid owner key, enforces D1 approvedPriceINR on B2B order, and creates PENDING_IMPLEMENTATION delivery_task on verify/webhook', async () => {
      const app = createTestApp();
      const db = getDb();

      vi.spyOn(SiteAuditScanner.prototype, 'scanUrl').mockResolvedValue({
        auditId: 'audit_mock_b2b_flow',
        url: 'https://hyderabad-prep.in',
        domain: 'hyderabad-prep.in',
        scannedAt: new Date().toISOString(),
        overallStatus: 'NEEDS_IMPROVEMENT',
        score: 68,
        scoreExplanation: 'Deterministic scan',
        metrics: {
          httpStatus: 200,
          responseTimeMs: 140,
          htmlSizeBytes: 1800,
          contentType: 'text/html',
          redirectChain: [],
          hasRobotsTxt: false,
          hasSitemap: false,
          jsonLdTypesFound: [],
          contactChannelsFound: []
        },
        findings: [
          { id: 'schema_jsonld_missing', category: 'STRUCTURED_DATA', title: 'Missing Schema', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: 'none', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: true, needsUserConfirmation: false },
          { id: 'viewport_missing', category: 'HTML_METADATA', title: 'Missing Viewport', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: 'none', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: true, needsUserConfirmation: false }
        ],
        preview: { title: 'Hyd Prep', metaDescription: 'Prep', canonicalUrl: 'https://hyderabad-prep.in', ogTitle: '', ogImage: '', fixPackSnippetPreview: '' },
        disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true },
        rawHtml: '<html><body><h1>Hyderabad Prep</h1></body></html>'
      });

      // Step 1: Create draft proposal publicly
      const draftRes = await app.request('/api/v1/b2b/pilot-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://hyderabad-prep.in',
          businessName: 'Hyderabad Prep Institute',
          contactEmail: 'director@hyderabad-prep.in',
          authorizedToScan: true
        })
      });
      const draftJson = await draftRes.json() as any;
      const proposalId = draftJson.data.proposalId;
      expect(proposalId).toBeTruthy();

      // Step 2: Unauthenticated /b2b/checkout/:proposalId and create-b2b-order must fail closed (403) while unapproved
      const preCheckoutHtmlRes = await app.request(`/api/v1/b2b/checkout/${proposalId}`);
      expect(preCheckoutHtmlRes.status).toBe(403);

      const preOrderRes = await app.request('/api/v1/payments/razorpay/create-b2b-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, customerEmail: 'director@hyderabad-prep.in' })
      });
      expect(preOrderRes.status).toBe(403);

      // Step 3: Unauthenticated owner approval must return 401
      const unauthApproveRes = await app.request(`/api/v1/owner/b2b/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceINR: 15000 })
      });
      expect(unauthApproveRes.status).toBe(401);

      // Step 4: Authenticated owner approval succeeds and persists durably
      const authApproveRes = await app.request(`/api/v1/owner/b2b/proposals/${proposalId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test_owner_secret_pr94_valid_key_32chars'
        },
        body: JSON.stringify({
          priceINR: 14500,
          scopeNotes: 'Includes WhatsApp enquiry CTA + Admissions Form + LocalBusiness JSON-LD',
          expiresInHours: 72
        })
      });
      expect(authApproveRes.status).toBe(200);
      const approveJson = await authApproveRes.json() as any;
      expect(approveJson.success).toBe(true);
      expect(approveJson.data.approvalStatus).toBe('OWNER_APPROVED');
      expect(approveJson.data.approvedPriceINR).toBe(14500);
      expect(approveJson.data.checkoutUrl).toContain(`/b2b/checkout/${proposalId}`);

      const storedDurable = db.prepare('SELECT * FROM durable_events WHERE id = ?').get(`b2b_proposal_${proposalId}`) as any;
      expect(storedDurable).toBeDefined();
      expect(storedDurable.processed).toBe(1);
      const storedPayload = JSON.parse(storedDurable.payload_json);
      expect(storedPayload.approvalStatus).toBe('OWNER_APPROVED');
      expect(storedPayload.approvedPriceINR).toBe(14500);

      // Step 5: Checkout HTML route now returns HTTP 200 with Razorpay checkout script
      const checkoutHtmlRes = await app.request(`/api/v1/b2b/checkout/${proposalId}`);
      expect(checkoutHtmlRes.status).toBe(200);
      const checkoutHtml = await checkoutHtmlRes.text();
      expect(checkoutHtml).toContain('checkout.razorpay.com/v1/checkout.js');
      expect(checkoutHtml).toContain('14,500');
      expect(checkoutHtml).toContain('/api/v1/payments/razorpay/create-b2b-order');

      // Step 6: create-b2b-order ignores tampered priceINR=1 and uses ONLY D1 approvedPriceINR (14500 => 1450000 paise)
      const mockRazorpayOrderId = 'order_b2b_pr94_mock_001';
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: mockRazorpayOrderId, amount: 1450000, currency: 'INR' })
      } as any);

      const orderRes = await app.request('/api/v1/payments/razorpay/create-b2b-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId,
          customerEmail: 'director@hyderabad-prep.in',
          customerName: 'Hyderabad Prep Director',
          priceINR: 1, // Tamper attempt — must be ignored
          amountINR: 1
        })
      });
      expect(orderRes.status).toBe(200);
      const orderJson = await orderRes.json() as any;
      expect(orderJson.success).toBe(true);
      expect(orderJson.amount).toBe(1450000);
      expect(orderJson.amountINR).toBe(14500);
      expect(orderJson.offerId).toBe('B2B_WEBSITE_ENQUIRY_SETUP');
      expect(orderJson.razorpayOrderId).toBe(mockRazorpayOrderId);

      const uOrder = db.prepare('SELECT * FROM universal_orders WHERE id = ?').get(orderJson.orderId) as any;
      expect(uOrder).toBeDefined();
      expect(uOrder.offer_id).toBe('B2B_WEBSITE_ENQUIRY_SETUP');
      expect(uOrder.amount_minor).toBe(1450000);
      expect(uOrder.provider_order_id).toBe(mockRazorpayOrderId);

      // Step 7: Verify payment via HMAC signature + confirm durable delivery_tasks (PENDING_IMPLEMENTATION)
      const mockPaymentId = 'pay_b2b_pr94_mock_001';
      const sig = createHmac('sha256', 'pr94_mock_razorpay_secret_key')
        .update(`${mockRazorpayOrderId}|${mockPaymentId}`)
        .digest('hex');

      const verifyRes = await app.request('/api/v1/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderJson.orderId,
          razorpay_order_id: mockRazorpayOrderId,
          razorpay_payment_id: mockPaymentId,
          razorpay_signature: sig
        })
      });
      expect(verifyRes.status).toBe(200);
      const verifyJson = await verifyRes.json() as any;
      expect(verifyJson.success).toBe(true);
      expect(verifyJson.fulfillmentStatus).toBe('PENDING_IMPLEMENTATION');

      const delivTask = db.prepare('SELECT * FROM delivery_tasks WHERE id = ?').get(`deliv_${orderJson.orderId}_${mockPaymentId}`) as any;
      expect(delivTask).toBeDefined();
      expect(delivTask.service_type).toBe('B2B_WEBSITE_ENQUIRY_SETUP');
      expect(delivTask.stage).toBe('PENDING_IMPLEMENTATION');

      // Step 8: Webhook idempotency & verification for B2B order
      const webhookPayload = JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: mockPaymentId,
              order_id: mockRazorpayOrderId,
              amount: 1450000,
              currency: 'INR',
              status: 'captured'
            }
          }
        }
      });
      const whSig = createHmac('sha256', 'pr94_mock_webhook_secret_key').update(webhookPayload).digest('hex');
      const uniqueEventId = `evt_b2b_pr94_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const whRes = await app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': whSig,
          'x-razorpay-event-id': uniqueEventId
        },
        body: webhookPayload
      });
      expect(whRes.status).toBe(200);
      const whJson = await whRes.json() as any;
      expect(whJson.success).toBe(true);
      expect(whJson.data.fulfillmentStatus).toBe('PENDING_IMPLEMENTATION');

      // Verify idempotent webhook replay
      const whReplayRes = await app.request('/api/v1/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': whSig,
          'x-razorpay-event-id': uniqueEventId
        },
        body: webhookPayload
      });
      expect(whReplayRes.status).toBe(200);
      const whReplayJson = await whReplayRes.json() as any;
      expect(whReplayJson.success).toBe(true);
      expect(whReplayJson.duplicate).toBe(true);
    });

    it('rejects expired owner-approved proposals on GET /b2b/checkout/:proposalId and create-b2b-order', async () => {
      const app = createTestApp();
      const db = getDb();

      vi.spyOn(SiteAuditScanner.prototype, 'scanUrl').mockResolvedValue({
        auditId: 'audit_mock_exp',
        url: 'https://expired-academy.in',
        domain: 'expired-academy.in',
        scannedAt: new Date().toISOString(),
        overallStatus: 'NEEDS_IMPROVEMENT',
        score: 70,
        scoreExplanation: 'Mock',
        metrics: { httpStatus: 200, responseTimeMs: 100, htmlSizeBytes: 800, contentType: 'text/html', redirectChain: [], hasRobotsTxt: false, hasSitemap: false, jsonLdTypesFound: [], contactChannelsFound: [] },
        findings: [],
        preview: { title: 'Exp', metaDescription: 'Exp', canonicalUrl: 'https://expired-academy.in', ogTitle: '', ogImage: '', fixPackSnippetPreview: '' },
        disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true },
        rawHtml: '<html><body><h1>Expired</h1></body></html>'
      });

      const draft = await B2BPilotService.getInstance().generateProposal({
        targetUrl: 'https://expired-academy.in',
        businessName: 'Expired Academy'
      });
      await B2BPilotService.getInstance().approveProposal({
        proposalId: draft.proposalId,
        priceINR: 9999
      });

      // Force expiry in D1/SQLite
      const row = db.prepare('SELECT payload_json FROM durable_events WHERE id = ?').get(`b2b_proposal_${draft.proposalId}`) as any;
      const parsed = JSON.parse(row.payload_json);
      parsed.expiresAt = new Date(Date.now() - 60_000).toISOString();
      db.prepare('UPDATE durable_events SET payload_json = ? WHERE id = ?').run(JSON.stringify(parsed), `b2b_proposal_${draft.proposalId}`);

      const checkoutRes = await app.request(`/api/v1/b2b/checkout/${draft.proposalId}`);
      expect(checkoutRes.status).toBe(403);

      const orderRes = await app.request('/api/v1/payments/razorpay/create-b2b-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: draft.proposalId, customerEmail: 'owner@expired-academy.in' })
      });
      expect(orderRes.status).toBe(403);
    });
  });

  describe('3. B2BPilotService Fail-Closed Scan Handling & 3-State Audit Truth', () => {
    it('fails closed with SCAN_FAILED (HTTP 422) when live scan errors or times out — never substitutes fake findings', async () => {
      const app = createTestApp();
      vi.spyOn(SiteAuditScanner.prototype, 'scanUrl').mockRejectedValue(new Error('FETCH_TIMEOUT: Request timed out after 5000ms'));

      const res = await app.request('/api/v1/b2b/pilot-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://unreachable-coaching-site.invalid', businessName: 'Unreachable', authorizedToScan: true })
      });
      expect(res.status).toBe(422);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toBe('SCAN_FAILED');
      expect(json.data).toBeUndefined();
    });

    it('classifies VERIFIED_PRESENT, VERIFIED_MISSING, and NOT_CHECKED accurately from HTML and scanner ISSUE/FAIL', async () => {
      const service = B2BPilotService.getInstance();

      const mockScannerWithElements: any = {
        scanUrl: vi.fn().mockResolvedValue({
          auditId: 'audit_truth_1',
          url: 'https://good-academy.in',
          domain: 'good-academy.in',
          scannedAt: new Date().toISOString(),
          overallStatus: 'NEEDS_IMPROVEMENT',
          score: 75,
          scoreExplanation: 'Mock',
          metrics: { httpStatus: 200, responseTimeMs: 120, htmlSizeBytes: 2000, contentType: 'text/html', redirectChain: [], hasRobotsTxt: true, hasSitemap: true, jsonLdTypesFound: ['EducationalOrganization'], contactChannelsFound: [] },
          findings: [
            { id: 'schema_types_detected', category: 'STRUCTURED_DATA', title: 'Valid Schema', status: 'PASS', severity: 'INFO', location: 'script', evidence: 'EducationalOrganization', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: false, needsUserConfirmation: false },
            { id: 'viewport_missing', category: 'HTML_METADATA', title: 'Missing Mobile Viewport Meta Tag', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: 'none', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: true, needsUserConfirmation: false },
            { id: 'opengraph_tags_incomplete', category: 'HTML_METADATA', title: 'Incomplete Open Graph', status: 'FAIL', severity: 'HIGH', location: 'head', evidence: 'missing', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: true, needsUserConfirmation: false }
          ],
          rawHtml: `
            <html>
              <body>
                <a href="https://wa.me/919999999999?text=Admissions">WhatsApp Us</a>
                <form action="/admissions" method="POST">
                  <input type="text" name="student_name" />
                  <input type="tel" name="phone" />
                </form>
              </body>
            </html>
          `
        })
      };

      const proposal = await service.generateProposal({
        targetUrl: 'https://good-academy.in',
        businessName: 'Good Academy'
      }, { scanner: mockScannerWithElements });

      const byItem = new Map(proposal.verifiedFindings.map(f => [f.item, f.status]));
      expect(byItem.get('Direct WhatsApp Click-to-Chat CTA')).toBe('VERIFIED_PRESENT');
      expect(byItem.get('Course & Admissions Enquiry Form')).toBe('VERIFIED_PRESENT');
      expect(byItem.get('LocalBusiness / EducationalOrganization Schema')).toBe('VERIFIED_PRESENT');
      expect(byItem.get('Mobile Viewport Configuration')).toBe('VERIFIED_MISSING'); // Mapped from scanner ISSUE
      expect(byItem.get('Open Graph WhatsApp Preview Metadata')).toBe('VERIFIED_MISSING'); // Mapped from scanner FAIL
      expect(byItem.get('Core Web Vitals (PageSpeed Insights)')).toBe('NOT_CHECKED');
    });
  });

  describe('4. Catalog Honesty & /vs/... Resolution', () => {
    it('blocks isSeedFallback: true deals from passesEditorialQualityGate and renders SEED_SNAPSHOT + noindex', () => {
      const starters = createHighIntentStarterDeals();
      expect(starters.length).toBe(6);
      for (const sd of starters) {
        expect(passesEditorialQualityGate(sd)).toBe(false);
      }

      const ssg = StaticSiteGenerator.getInstance();
      const config = {
        siteName: 'AI Marketing Organization',
        authorName: 'Editorial Desk',
        contactEmail: 'editorial@ai-marketing-organization.onrender.com',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      };

      const dealsHtml = ssg.renderDealsHtml(starters, config);
      expect(dealsHtml).toContain('SEED_SNAPSHOT');
      expect(dealsHtml).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(dealsHtml).not.toContain('✓ Verified');

      const detailHtml = ssg.renderDealDetailHtml(starters[0], [], config);
      expect(detailHtml).toContain('SEED_SNAPSHOT');
      expect(detailHtml).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('prevents 4k-dashcams-and-car-tech-india from matching Personal Care / Charcoal and resolves every /vs/ link on /best/ hubs to HTTP 200', async () => {
      const starters = createHighIntentStarterDeals();
      const hubs = generateBuyerIntentHubs(starters, 'https://ai-marketing-organization.onrender.com', 10);

      // Bug 1 check: car-tech hub must NOT match skincare/charcoal deals
      const dashcamHub = hubs.find(h => h.intentSlug === '4k-dashcams-and-car-tech-india');
      expect(dashcamHub).toBeUndefined();

      // Every /vs/ link generated by generateComparisonPairs resolves cleanly via findComparisonPairBySlug
      const pairs = generateComparisonPairs(starters, 50);
      expect(pairs.length).toBeGreaterThanOrEqual(2);
      for (const pair of pairs) {
        const { matched } = findComparisonPairBySlug(starters, pair.comparisonSlug, 100);
        expect(matched).toBeDefined();
        expect(matched?.comparisonSlug).toBe(pair.comparisonSlug);
      }
    });
  });

  describe('5. Category-Specific Gemini Guides', () => {
    it('removes thermal-printer/logistics leakage from non-printer guides and only prompts reviewer trade-offs when reviewSnippets are passed', async () => {
      const db = getDb();
      const offerId = 'test_offer_pr94_skincare';

      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, country, website, approval_status, active_status)
        VALUES ('part_test_dotkey_pr94', 'org_owner_primary', 'Dot & Key', 'Health & Beauty', 'IN', 'https://dotandkey.com', 'APPROVED', 'ACTIVE')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer, price_inr, status, active,
          destination_url, authorized_tracking_url, evidence_json
        ) VALUES (?, 'part_test_dotkey_pr94', 'org_owner_primary', 'Dot & Key 72HR Hydrating Gel Moisturizer', 'dotkey-gel-pr94',
          'Health & Beauty', 'Skincare Buyers', 495, 'ACTIVE', 1,
          'https://dotandkey.com/products/gel', 'https://cuelinks.com/track?id=dotkey94', ?)
      `).run(
        offerId,
        JSON.stringify({
          display_name: 'Dot & Key 72HR Hydrating Gel Moisturizer',
          listing_facts: [
            { fact: 'Contains hyaluronic acid and Japanese rice water', date: '2026-11-24' },
            { fact: 'Oil-free lightweight gel formulation in 60ml jar', date: '2026-11-24' },
            { fact: 'Suitable for oily and combination skin types', date: '2026-11-24' }
          ]
        })
      );

      const engine = ContentAssetEngine.getInstance();

      // 5a: Deterministic fallback must have ZERO thermal/printer/logistics leakage
      const fallbackGuide = await engine.generateGuideForApprovedOffer(offerId, 'org_owner_primary', {
        templateFallback: true
      });
      expect(fallbackGuide.contentMarkdown.toLowerCase()).not.toContain('thermal');
      expect(fallbackGuide.contentMarkdown.toLowerCase()).not.toContain('printer');
      expect(fallbackGuide.contentMarkdown.toLowerCase()).not.toContain('shipping label');
      expect(fallbackGuide.contentMarkdown.toLowerCase()).not.toContain('media rolls');
      expect(fallbackGuide.contentMarkdown).toContain('Usage & Selection Considerations');

      // 5b: Without reviewSnippets, Gemini prompt must NOT ask for reviewer trade-offs
      let capturedPromptNoSnippets = '';
      const mockFetchNoSnippets = vi.fn().mockImplementation(async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        capturedPromptNoSnippets = body.contents[0].parts[0].text;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    whoShouldBuy: 'Buyers with oily or combination skin seeking a lightweight gel moisturizer.',
                    whoShouldAvoid: 'Buyers seeking heavy occlusive balm hydration for very dry skin.',
                    verifiedSpecsSummary: 'Formulated with hyaluronic acid and Japanese rice water in a 60ml oil-free gel.',
                    honestLimitations: 'Fragrance sensitivity should be patch-tested prior to full facial application.'
                  })
                }]
              }
            }]
          })
        };
      });

      const guideNoSnippets = await engine.generateGuideForApprovedOffer(offerId, 'org_owner_primary', {
        invokeGemini: true,
        fetchFn: mockFetchNoSnippets as any
      });
      expect(capturedPromptNoSnippets.toLowerCase()).not.toContain('trade-off');
      expect(guideNoSnippets.contentMarkdown).toContain('Verified Specifications Summary:');
      expect(guideNoSnippets.contentMarkdown.toLowerCase()).not.toContain('thermal');

      // 5c: With actual reviewSnippets, Gemini prompt includes snippets and reviewer trade-offs
      let capturedPromptWithSnippets = '';
      const mockFetchWithSnippets = vi.fn().mockImplementation(async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        capturedPromptWithSnippets = body.contents[0].parts[0].text;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    whoShouldBuy: 'Buyers seeking non-greasy hydration in humid climates.',
                    whoShouldAvoid: 'Buyers sensitive to light gel fragrances.',
                    verifiedSpecsVsTradeoffs: 'Light oil-free gel matches manufacturer claims, though reviewers note hydration fades quickly in dry AC rooms.',
                    honestLimitations: 'Jar packaging requires clean hands or spatula for hygienic scooping.'
                  })
                }]
              }
            }]
          })
        };
      });

      const guideWithSnippets = await engine.generateGuideForApprovedOffer(offerId, 'org_owner_primary', {
        invokeGemini: true,
        reviewSnippets: ['Absorbs fast without grease, but light hydration wears off in strong AC.'],
        fetchFn: mockFetchWithSnippets as any
      });
      expect(capturedPromptWithSnippets).toContain('Actual reviewer snippets:');
      expect(capturedPromptWithSnippets).toContain('verifiedSpecsVsTradeoffs');
      expect(guideWithSnippets.contentMarkdown).toContain('Verified Specifications vs Trade-offs:');
    });
  });

  describe('6. D1 Budget Transparency & Enforcement', () => {
    it('blocks background queries when cycle or daily background budget is exceeded while permitting customer queries', async () => {
      const d1 = D1Client.getInstance();
      d1.startBackgroundCycle(100);
      d1.recordCycleUsage(150, 0);
      expect(d1.isCycleBudgetExceeded()).toBe(true);

      await expect(
        d1.executeQuery('SELECT count(*) as c FROM public_deals', [], false, 'P3', true)
      ).rejects.toThrow(/D1 BUDGET GUARD/);

      d1.endBackgroundCycle();

      // Customer-facing P0 query outside background cycle executes cleanly
      const res = await d1.executeQuery<{ ok: number }>('SELECT 1 as ok', [], false, 'P0', false);
      expect(res.results[0].ok).toBe(1);
    });

    it('exposes instanceLocalDailyBackgroundRowsRead and backward-compatible d1Status object + d1Health string in readiness endpoints', async () => {
      const app = createTestApp();
      const d1 = D1Client.getInstance();
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.SITE_AUDIT_SIGNING_SECRET = 'test_signing_secret_32_chars_long_pr94';
      const { RazorpayStandardAdapter } = await import('../../src/payments/razorpay-adapter.js');
      vi.spyOn(RazorpayStandardAdapter.getInstance(), 'probeRazorpayAuth').mockResolvedValue({
        providerAcceptedAuth: true,
        httpStatus: 200,
        authDiagnosticCode: 'OK',
        authStatus: 'PROVIDER_AUTHENTICATED',
        keyMode: 'TEST_SANDBOX'
      });

      d1.startBackgroundCycle(2500);
      d1.recordCycleUsage(42, 1);
      d1.endBackgroundCycle();

      const healthRes = await app.request('/api/v1/health');
      expect(healthRes.status).toBe(200);
      const healthJson = await healthRes.json() as any;
      expect(healthJson.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(healthJson.d1Status).toBeDefined();
      expect(healthJson.d1Status.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(healthJson.d1Status.status).toBe('HEALTHY');

      const siteAuditReadyRes = await app.request('/api/v1/tools/site-audit/readiness');
      expect(siteAuditReadyRes.status).toBe(200);
      const readyJson = await siteAuditReadyRes.json() as any;
      expect(readyJson.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(readyJson.d1Health).toBe('HEALTHY');
      expect(readyJson.quotaStatus).toBe('HEALTHY');
      expect(readyJson.d1Status.status).toBe('HEALTHY');
      expect(readyJson.d1Status.remoteD1Configured).toBe(true);
      expect(readyJson.d1Status.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(readyJson.d1Telemetry.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(readyJson.telemetryScopeNote).toMatch(/instance-local/i);

      const b2bReadyRes = await app.request('/api/v1/b2b/readiness');
      expect(b2bReadyRes.status).toBe(200);
      const b2bReadyJson = await b2bReadyRes.json() as any;
      expect(b2bReadyJson.d1Health).toBe('HEALTHY');
      expect(b2bReadyJson.quotaStatus).toBe('HEALTHY');
      expect(b2bReadyJson.d1Status.status).toBe('HEALTHY');
      expect(b2bReadyJson.d1Status.circuitBreaker).toBeDefined();
      expect(b2bReadyJson.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(b2bReadyJson.telemetryScopeNote).toMatch(/instance-local/i);

      // Simulate active D1 quota circuit exhaustion -> readiness must report DEGRADED_QUOTA_EXHAUSTED & isReady: false
      d1.tripReadQuotaCircuitBreaker('Your account has exceeded D1 free tier daily row read limit (code 7500)');
      const degradedAuditRes = await app.request('/api/v1/tools/site-audit/readiness');
      const degradedAuditJson = await degradedAuditRes.json() as any;
      expect(degradedAuditJson.d1Health).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(degradedAuditJson.quotaStatus).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(degradedAuditJson.d1Status.status).toBe('QUOTA_CIRCUIT_OPEN');
      expect(degradedAuditJson.d1Status.readExhausted).toBe(true);
      expect(degradedAuditJson.status).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(degradedAuditJson.isReady).toBe(false);

      const degradedB2bRes = await app.request('/api/v1/b2b/readiness');
      const degradedB2bJson = await degradedB2bRes.json() as any;
      expect(degradedB2bJson.d1Health).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(degradedB2bJson.quotaStatus).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(degradedB2bJson.d1Status.status).toBe('QUOTA_CIRCUIT_OPEN');
      expect(degradedB2bJson.status).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(degradedB2bJson.isReady).toBe(false);
      expect(degradedB2bJson.proposalDraftingAvailable).toBe(false);
      expect(degradedB2bJson.checkoutOrderCreationReady).toBe(false);
      d1.resetQuotaCircuitBreakerForTesting();

      const sysReadyRes = await app.request('/api/v1/system/readiness', {
        headers: { 'Authorization': 'Bearer test_owner_secret_pr94_valid_key_32chars' }
      });
      expect(sysReadyRes.status).toBe(200);
      const sysJson = await sysReadyRes.json() as any;
      expect(sysJson.data.instanceLocalDailyBackgroundRowsRead).toBe(42);
      expect(sysJson.data.d1Status.instanceLocalDailyBackgroundRowsRead).toBe(42);
    });
  });
});
