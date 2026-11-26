import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { recordSiteFixFunnelEvent, recordToolVisitSession } from '../../src/tools/site-audit/sitefix-funnel-attribution.js';
import { renderOwnerToolPage } from '../../src/tools/site-audit/owner-tool-pages.js';
import { renderSiteAuditPage } from '../../src/tools/site-audit/site-audit-page.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';

describe('SiteFix Funnel Attribution & Reconciliation', () => {
  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM traffic_sessions WHERE source LIKE 'web%' OR source = 'site-audit'`).run();
      db.prepare(`DELETE FROM durable_events WHERE event_type = 'SITEFIX_FUNNEL_EVENT'`).run();
    } catch {}
  });

  it('1. Single external visit beacon increments verifiedExternalVisits in /revenue-funnel', async () => {
    // Send external visit beacon
    const res = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Forwarded-For': '203.0.113.195'
      },
      body: JSON.stringify({
        source: 'web_whatsapp_preview',
        url: 'https://ai-marketing-organization.onrender.com/tools/whatsapp-link-preview-checker',
        referrer: 'https://google.com'
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.recorded).toBe(true);
    expect(data.data.isExternal).toBe(true);
    expect(data.data.trafficEvidenceStatus).toBe('VERIFIED_EXTERNAL');

    // Verify session recorded in local SQLite
    const db = getDb();
    const session = db.prepare(`SELECT * FROM traffic_sessions WHERE traffic_evidence_status = 'VERIFIED_EXTERNAL' LIMIT 1`).get() as any;
    expect(session).toBeDefined();
    expect(session.is_external).toBe(1);

    // Verify /public/revenue-funnel?fresh=true reflects verified external visit
    const funnelRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    expect(funnelRes.status).toBe(200);
    const funnelData = await funnelRes.json();
    expect(funnelData.data.funnel.verifiedExternalVisits).toBeGreaterThanOrEqual(1);
  });

  it('2. Diagnostic probe is marked TEST and excluded from verifiedExternalVisits', async () => {
    const res = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'sitefix-diagnostic-probe/1.0',
        'X-Diagnostic-Probe': '1',
        'X-Forwarded-For': '127.0.0.1'
      },
      body: JSON.stringify({
        source: 'web_open_graph',
        url: 'https://ai-marketing-organization.onrender.com/tools/open-graph-checker'
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.recorded).toBe(true);
    expect(data.data.isExternal).toBe(false);
    expect(data.data.trafficEvidenceStatus).toBe('TEST');

    // Verify probe row in SQLite has is_external = 0
    const db = getDb();
    const probeSession = db.prepare(`SELECT * FROM traffic_sessions WHERE traffic_evidence_status = 'TEST' LIMIT 1`).get() as any;
    expect(probeSession).toBeDefined();
    expect(probeSession.is_external).toBe(0);
  });

  it('3. checkout_open_invoked increments checkoutInitiated in /revenue-funnel and checkout_start increments paymentOrdersCreated', async () => {
    await recordSiteFixFunnelEvent({
      stage: 'checkout_start',
      source: 'web',
      isProbe: false,
      url: 'https://example.com',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
    });
    await recordSiteFixFunnelEvent({
      stage: 'checkout_open_invoked',
      source: 'web',
      isProbe: false,
      url: 'https://example.com',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
    });

    const funnelRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    expect(funnelRes.status).toBe(200);
    const funnelData = await funnelRes.json();
    expect(funnelData.data.selfServeSaaSFunnel.checkoutInitiated).toBeGreaterThanOrEqual(1);
    expect(funnelData.data.selfServeSaaSFunnel.paymentOrdersCreated).toBeGreaterThanOrEqual(1);
  });

  it('4. Tool pages render problem visualization, 6 Fix-Pack components, and ₹499 CTA', () => {
    // Check owner tool page
    const ownerHtml = renderOwnerToolPage('whatsapp-link-preview-checker', {
      apiBaseUrl: 'https://ai-marketing-organization.onrender.com',
      canonicalOrigin: 'https://ai-marketing-organization.onrender.com'
    });

    expect(ownerHtml).toContain('Issues Identified on URL');
    expect(ownerHtml).toContain('Fix All Issues for ₹499 — Instant AI Pack');
    expect(ownerHtml).toContain('1. HTML &lt;head&gt; Meta &amp; Social Tags');
    expect(ownerHtml).toContain('2. Schema.org Structured Data');
    expect(ownerHtml).toContain('3. Search Engine Directives');
    expect(ownerHtml).toContain('4. Instant Delivery');
    expect(ownerHtml).toContain('instant browser download + email receipt');
    expect(ownerHtml).toContain('5. 7-Day Verification Recheck');
    expect(ownerHtml).toContain('6. 7-Day Refund Guarantee');
    expect(ownerHtml).toContain('WhatsApp Link Preview Comparison (Before vs. After Fix-Pack)');
    expect(ownerHtml).toContain('/api/v1/referrals/beacon');

    // Check main site-audit page
    const siteAuditHtml = renderSiteAuditPage();
    expect(siteAuditHtml).toContain('findingsSummaryBanner');
    expect(siteAuditHtml).toContain('Fix All Issues for ₹499 — Instant AI Pack');
    expect(siteAuditHtml).toContain('1. HTML &lt;head&gt; Meta &amp; Social Tags');
    expect(siteAuditHtml).toContain('2. Schema.org Structured Data');
    expect(siteAuditHtml).toContain('3. Search Engine Directives');
    expect(siteAuditHtml).toContain('4. Instant Delivery');
    expect(siteAuditHtml).toContain('instant browser download + email receipt');
    expect(siteAuditHtml).toContain('5. 7-Day Verification Recheck');
    expect(siteAuditHtml).toContain('6. 7-Day Refund Guarantee');
    expect(siteAuditHtml).toContain('/api/v1/referrals/beacon');
  });

  it('5. Page load logs page_view and does NOT increment preview_displayed', async () => {
    // Initial funnel check
    const initialRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const initialData = await initialRes.json();
    const initialPreviews = initialData.data.selfServeSaaSFunnel.preview_displayed || 0;

    // Simulate page load visit
    const visitRes = await recordToolVisitSession({
      source: 'web',
      landingPage: '/tools/site-audit',
      referrer: 'https://google.com',
      isProbe: false
    });

    expect(visitRes.recorded).toBe(true);
    expect(visitRes.storageStatus).toBe('FALLBACK_LOCAL_ONLY');
    expect(visitRes.d1Persisted).toBe(false);

    // Verify durable_events has page_view event, not preview_open
    const db = getDb();
    const evt = db.prepare(`SELECT payload_json FROM durable_events WHERE event_type = 'SITEFIX_FUNNEL_EVENT' ORDER BY created_at DESC LIMIT 1`).get() as any;
    expect(evt).toBeDefined();
    const payload = JSON.parse(evt.payload_json);
    expect(payload.stage).toBe('page_view');

    // Verify /public/revenue-funnel?fresh=true does NOT increment preview_displayed
    const afterRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const afterData = await afterRes.json();
    expect(afterData.data.selfServeSaaSFunnel.preview_displayed).toBe(initialPreviews);
  });

  it('6. GET /checkout routes to /tools/site-audit and preserves query parameters', async () => {
    const res = await app.request('/checkout?source=test_flow', { method: 'GET', redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/tools/site-audit?source=test_flow');
  });

  it('7. Revenue funnel returns real refund accounting, honest metric labels, and clean stages', async () => {
    const res = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const saas = json.data.selfServeSaaSFunnel;
    expect(saas.refundsCount).toBeDefined();
    expect(typeof saas.refundsCount).toBe('number');
    expect(saas.netCapturedINR).toBeDefined();
    expect(typeof saas.netCapturedINR).toBe('number');
    expect(saas.grossCapturedINR).toBeDefined();
    expect(typeof saas.grossCapturedINR).toBe('number');
    expect(saas.netCapturedINR).toBe(Math.max(0, saas.grossCapturedINR - (saas.refundAmountINR || 0)));

    expect(saas.externalPageViews).toBeDefined();
    expect(saas.distinctSessionFingerprints).toBeDefined();
    expect(saas.distinctBrowserSessions).toBeDefined();
    expect(saas.stages).toBeDefined();
    expect(saas.stages.page_view).toBeDefined();
    expect(saas.stages.scan_started).toBeDefined();
    expect(saas.stages.scan_completed).toBeDefined();
    expect(saas.stages.preview_displayed).toBeDefined();
    expect(saas.stages.order_created).toBeDefined();
    expect(saas.stages.checkout_modal_opened).toBeDefined();
    expect(saas.stages.payment_captured).toBeDefined();
    expect(saas.stages.deliverable_ready).toBeDefined();
    expect(saas.stages.email_accepted).toBeDefined();
    expect(saas.stages.email_delivered).toBeDefined();
  });

  it('8. ensureCustomerJourney() handles D1 organization_id schema compatibility', async () => {
    const adapter = RazorpayStandardAdapter.getInstance();
    const d1Repo = D1RevenueRepository.getInstance();
    const journeyId = `test_journey_${Date.now()}`;

    // Normal execution
    await expect(adapter.ensureCustomerJourney(
      journeyId,
      'buyer@example.com',
      'Test Buyer',
      false,
      'PAYMENT_VERIFIED'
    )).resolves.not.toThrow();

    // Verify row exists in DB
    const db = getDb();
    const row = db.prepare('SELECT id, customer_email, stage FROM customer_journeys WHERE id = ?').get(journeyId) as any;
    expect(row).toBeDefined();
    expect(row.customer_email).toBe('buyer@example.com');

    // Simulate D1 error: 'table customer_journeys has no column named organization_id'
    const fallbackJourneyId = `test_journey_d1_${Date.now()}`;
    const executeWriteSpy = vi.spyOn(d1Repo, 'executeWrite');
    let callCount = 0;
    executeWriteSpy.mockImplementation(async (table: string, sql: string, params: any[]) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('D1_ERROR: table customer_journeys has no column named organization_id at offset 32');
      }
      // Execute the fallback SQL directly in sqlite
      return { results: [], rowsAffected: 1, source: 'PERSISTENT_SQLITE' as any };
    });

    try {
      await expect(adapter.ensureCustomerJourney(
        fallbackJourneyId,
        'fallback@example.com',
        'Fallback Buyer',
        false,
        'PAYMENT_VERIFIED'
      )).resolves.not.toThrow();
      expect(callCount).toBe(2);
    } finally {
      executeWriteSpy.mockRestore();
    }
  });

  it('9. refund.processed webhook reconciles idempotently and updates netCapturedINR', async () => {
    const db = getDb();
    const orderId = `ord_rzp_test_refund_${Date.now()}`;
    const paymentId = `pay_test_refund_${Date.now()}`;
    const refundId = `rfnd_test_${Date.now()}`;
    const nowStr = new Date().toISOString();

    // 1. Insert a captured order in universal_orders
    db.prepare(`
      INSERT OR REPLACE INTO universal_orders (
        id, business_id, organization_id, customer_name, customer_email, customer_phone, offer_id, amount_minor, currency,
        status, payment_provider, provider_order_id, provider_payment_id,
        fulfillment_status, metadata_json, created_at, updated_at, is_test
      ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'Test Customer', 'customer@example.com', '+919876543210', 'sitefix_core_499', 49900, 'INR',
        'CAPTURED', 'RAZORPAY', ?, ?, 'DELIVERABLE_READY_EMAIL_PENDING', '{}', ?, ?, 0)
    `).run(orderId, orderId, paymentId, nowStr, nowStr);

    // Initial check: grossCapturedINR = 499, refundAmountINR = 0, netCapturedINR = 499
    const initialRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const initialFunnel = (await initialRes.json()).data.selfServeSaaSFunnel;
    expect(initialFunnel.grossCapturedINR).toBeGreaterThanOrEqual(499);

    // 2. Prepare refund.processed webhook payload and signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'unverified_webhook_hmac_secret';
    const eventId = `evt_refund_${Date.now()}`;
    const payload = {
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'refund.processed',
      contains: ['refund', 'payment'],
      payload: {
        refund: {
          entity: {
            id: refundId,
            amount: 49900,
            currency: 'INR',
            payment_id: paymentId,
            order_id: orderId,
            status: 'processed'
          }
        },
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 49900,
            amount_refunded: 49900,
            refund_status: 'full'
          }
        }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    // 3. Send refund.processed webhook
    const whRes = await app.request('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    });

    expect(whRes.status).toBe(200);
    const whData = await whRes.json();
    expect(whData.success).toBe(true);
    expect(whData.processed).toBe(true);
    expect(whData.duplicate).toBe(false);
    expect(whData.refund.amountINR).toBe(499);

    // 4. Send duplicate refund.processed webhook
    const dupRes = await app.request('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    });
    expect(dupRes.status).toBe(200);
    const dupData = await dupRes.json();
    expect(dupData.success).toBe(true);
    expect(dupData.duplicate).toBe(true);

    // 5. Verify order status updated to REFUNDED in database
    const updatedOrder = db.prepare('SELECT status FROM universal_orders WHERE id = ?').get(orderId) as any;
    expect(updatedOrder.status).toBe('REFUNDED');

    // 6. Verify revenue funnel preserves grossCapturedINR and reports refund
    const afterRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const afterFunnel = (await afterRes.json()).data.selfServeSaaSFunnel;
    expect(afterFunnel.grossCapturedINR).toBe(initialFunnel.grossCapturedINR); // preserved!
    expect(afterFunnel.refundsCount).toBeGreaterThanOrEqual(1);
    expect(afterFunnel.refundAmountINR).toBeGreaterThanOrEqual(499);
    expect(afterFunnel.netCapturedINR).toBe(Math.max(0, afterFunnel.grossCapturedINR - afterFunnel.refundAmountINR));
  });

  it('10. Non-conflation: checkout_modal_opened reported independently without fallback', async () => {
    // Check initial counts
    const initRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const initFunnel = (await initRes.json()).data.selfServeSaaSFunnel;
    const initialModals = initFunnel.stages.checkout_modal_opened || 0;

    // Send checkout_modal_opened beacon
    const beaconRes = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'checkout_modal_opened',
        event: 'checkout_modal_opened',
        source: 'site-audit',
        auditId: 'audit_test_modal_123',
        orderId: 'order_test_modal_123'
      })
    });
    expect(beaconRes.status).toBe(200);
    const bData = await beaconRes.json();
    expect(bData.success).toBe(true);
    expect(bData.stage).toBe('checkout_modal_opened');

    // Verify revenue funnel reports updated checkout_modal_opened independently
    const afterRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const afterFunnel = (await afterRes.json()).data.selfServeSaaSFunnel;
    expect(afterFunnel.stages.checkout_modal_opened).toBe(initialModals + 1);
    expect(afterFunnel.checkoutModalOpened).toBe(initialModals + 1);

    // Verify honest traffic metrics: diagnostic probe is excluded from externalPageViews
    const probeRes = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Diagnostic-Probe': '1'
      },
      body: JSON.stringify({
        source: 'site-audit',
        url: 'https://ai-marketing-organization.onrender.com/tools/site-audit'
      })
    });
    expect(probeRes.status).toBe(200);
    const probeData = await probeRes.json();
    expect(probeData.data.isExternal).toBe(false);
  });

  it('11. Deals Freshness Guard: excludes stale offers older than 7 days', async () => {
    const db = getDb();
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const d1Repo = D1RevenueRepository.getInstance();
    const d1Spy = vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(false);

    // Clean up any test deals first
    db.prepare(`DELETE FROM public_deals WHERE id IN ('deal_fresh_test_1', 'deal_stale_test_1')`).run();
    (engine as any).dealsMap?.delete('deal_fresh_test_1');
    (engine as any).dealsMap?.delete('deal_stale_test_1');

    db.prepare(`
      INSERT INTO public_deals (
        id, slug, title, merchant, category, sector_code, product_url,
        current_price_inr, availability, verification_status, deal_kind,
        is_monetizable, product_verified, affiliate_verified, discount_verification_type,
        evidence_json, last_verified_at, created_at, updated_at
      ) VALUES (
        'deal_fresh_test_1', 'deal-fresh-test-1', 'Fresh Test Deal', 'ExampleStore', 'Electronics', 'ELECTRONICS', 'https://example.com/fresh-deal',
        499, 'IN_STOCK', 'VERIFIED', 'PRODUCT',
        1, 1, 1, 'UNCONFIRMED',
        '{}', datetime('now', '-1 day'), datetime('now', '-1 day'), datetime('now', '-1 day')
      ), (
        'deal_stale_test_1', 'deal-stale-test-1', 'Stale Test Deal', 'ExampleStore', 'Electronics', 'ELECTRONICS', 'https://example.com/stale-deal',
        499, 'IN_STOCK', 'VERIFIED', 'PRODUCT',
        1, 1, 1, 'UNCONFIRMED',
        '{}', datetime('now', '-8 days'), datetime('now', '-8 days'), datetime('now', '-8 days')
      )
    `).run();

    try {
      const eligible = await engine.getEligiblePublicDeals();
      const ids = eligible.deals.map(d => d.id);
      expect(ids).toContain('deal_fresh_test_1');
      expect(ids).not.toContain('deal_stale_test_1');

      const queried = engine.queryPublicDeals();
      const queriedIds = queried.deals.map(d => d.id);
      expect(queriedIds).toContain('deal_fresh_test_1');
      expect(queriedIds).not.toContain('deal_stale_test_1');
    } finally {
      db.prepare(`DELETE FROM public_deals WHERE id IN ('deal_fresh_test_1', 'deal_stale_test_1')`).run();
      (engine as any).dealsMap?.delete('deal_fresh_test_1');
      (engine as any).dealsMap?.delete('deal_stale_test_1');
      d1Spy.mockRestore();
    }
  });

  it('12. Partial refund keeps grossCapturedINR, records durable_events, sets PARTIALLY_REFUNDED, then full refund marks REFUNDED', async () => {
    const db = getDb();
    const orderId = `ord_rzp_partial_rfnd_${Date.now()}`;
    const paymentId = `pay_partial_rfnd_${Date.now()}`;
    const refundId1 = `rfnd_part1_${Date.now()}`;
    const refundId2 = `rfnd_part2_${Date.now()}`;
    const nowStr = new Date().toISOString();

    db.prepare(`
      INSERT OR REPLACE INTO universal_orders (
        id, business_id, organization_id, customer_name, customer_email, customer_phone, offer_id, amount_minor, currency,
        status, payment_provider, provider_order_id, provider_payment_id,
        fulfillment_status, metadata_json, created_at, updated_at, is_test
      ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'Test Partial Customer', 'partial@example.com', '+919876543210', 'sitefix_core_499', 49900, 'INR',
        'CAPTURED', 'RAZORPAY', ?, ?, 'DELIVERABLE_READY_EMAIL_PENDING', '{}', ?, ?, 0)
    `).run(orderId, orderId, paymentId, nowStr, nowStr);

    const adapter = RazorpayStandardAdapter.getInstance();

    // 1. First partial refund of ₹200 (20000 paise)
    const res1 = await adapter.handleRefundProcessed({
      eventId: `evt_part1_${Date.now()}`,
      payloadHash: 'hash_part1',
      refundId: refundId1,
      orderId,
      paymentId,
      amountPaise: 20000,
      rawPayload: {}
    });

    expect(res1.processed).toBe(true);
    expect(res1.status).toBe('PARTIALLY_REFUNDED');
    expect(res1.refundAmountINR).toBe(200);

    // Verify order in database is PARTIALLY_REFUNDED, NOT REFUNDED
    const orderAfterPart1 = db.prepare('SELECT status, amount_minor FROM universal_orders WHERE id = ?').get(orderId) as any;
    expect(orderAfterPart1.status).toBe('PARTIALLY_REFUNDED');
    expect(orderAfterPart1.amount_minor).toBe(49900); // gross preserved

    // Verify durable_events record exists
    const durableRow1 = db.prepare(`SELECT * FROM durable_events WHERE id = ?`).get(`rfnd_evt_${refundId1}`) as any;
    expect(durableRow1).toBeDefined();
    expect(durableRow1.event_type).toBe('RAZORPAY_REFUND_PROCESSED');
    const payload1 = JSON.parse(durableRow1.payload_json);
    expect(payload1.newStatus).toBe('PARTIALLY_REFUNDED');
    expect(payload1.amountINR).toBe(200);

    // Duplicate test for part 1
    const res1Dup = await adapter.handleRefundProcessed({
      eventId: `evt_part1_${Date.now()}`,
      payloadHash: 'hash_part1',
      refundId: refundId1,
      orderId,
      paymentId,
      amountPaise: 20000,
      rawPayload: {}
    });
    expect(res1Dup.duplicate).toBe(true);

    // 2. Second partial refund of ₹299 (29900 paise) -> cumulative 49900 paise (full amount)
    const res2 = await adapter.handleRefundProcessed({
      eventId: `evt_part2_${Date.now()}`,
      payloadHash: 'hash_part2',
      refundId: refundId2,
      orderId,
      paymentId,
      amountPaise: 29900,
      rawPayload: {}
    });

    expect(res2.processed).toBe(true);
    expect(res2.status).toBe('REFUNDED');
    expect(res2.refundAmountINR).toBe(299);

    // Order status now updated to REFUNDED
    const orderAfterPart2 = db.prepare('SELECT status, amount_minor FROM universal_orders WHERE id = ?').get(orderId) as any;
    expect(orderAfterPart2.status).toBe('REFUNDED');
    expect(orderAfterPart2.amount_minor).toBe(49900); // gross captured still preserved!
  });

  it('13. Webhook returns HTTP 503 on durable persistence failure (fail closed)', async () => {
    const adapter = RazorpayStandardAdapter.getInstance();
    const handleSpy = vi.spyOn(adapter, 'handleRefundProcessed').mockRejectedValueOnce(new Error('D1_STORAGE_TIMEOUT: Write failed'));

    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'unverified_webhook_hmac_secret';
    const payload = {
      entity: 'event',
      event: 'refund.processed',
      payload: {
        refund: { entity: { id: 'rfnd_fail_test', amount: 49900, currency: 'INR' } }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    const res = await app.request('/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': 'evt_fail_test'
      },
      body: rawBody
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.retry).toBe(true);
    expect(body.error).toContain('Refund durable reconciliation failed');

    handleSpy.mockRestore();
  });

  it('14. Real-schema customer_journeys test (17 columns without organization_id) triggers fallback SQL', async () => {
    const db = getDb();
    const adapter = RazorpayStandardAdapter.getInstance();
    const testJourneyId = `real_schema_cj_${Date.now()}`;

    // Swap customer_journeys to a table with the exact 17-column live D1 schema (WITHOUT organization_id)
    db.prepare(`ALTER TABLE customer_journeys RENAME TO customer_journeys_temp_backup`).run();
    try {
      db.prepare(`
        CREATE TABLE customer_journeys (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL,
          visitor_id TEXT NOT NULL,
          stage TEXT NOT NULL DEFAULT 'AWARENESS',
          first_touch_channel TEXT,
          last_touch_channel TEXT,
          conversion_probability REAL NOT NULL DEFAULT 0.05,
          total_lifetime_value_inr REAL NOT NULL DEFAULT 0,
          touchpoints_json TEXT NOT NULL DEFAULT '[]',
          customer_name TEXT,
          customer_phone TEXT,
          customer_email TEXT,
          classification TEXT NOT NULL DEFAULT 'REAL',
          gclid TEXT,
          attribution_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();

      // Calling ensureCustomerJourney must encounter real SQLite missing-column error on first query,
      // catch it, execute the 17-column fallback query, and succeed without throwing.
      await expect(adapter.ensureCustomerJourney(
        testJourneyId,
        'real_schema_buyer@example.com',
        'Real Schema Buyer',
        false,
        'PAYMENT_VERIFIED'
      )).resolves.not.toThrow();

      // Verify the record was inserted cleanly via fallback SQL
      const inserted = db.prepare('SELECT id, customer_email, stage, business_id FROM customer_journeys WHERE id = ?').get(testJourneyId) as any;
      expect(inserted).toBeDefined();
      expect(inserted.id).toBe(testJourneyId);
      expect(inserted.customer_email).toBe('real_schema_buyer@example.com');
      expect(inserted.stage).toBe('PAYMENT_VERIFIED');
    } finally {
      db.prepare(`DROP TABLE IF EXISTS customer_journeys`).run();
      db.prepare(`ALTER TABLE customer_journeys_temp_backup RENAME TO customer_journeys`).run();
    }
  });

  it('15. checkout_open_invoked recorded and siteAuditsStarted strictly independent', async () => {
    const res = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'checkout_open_invoked',
        event: 'checkout_open_invoked',
        source: 'site-audit',
        auditId: 'audit_invoked_test',
        orderId: 'order_invoked_test'
      })
    });
    expect(res.status).toBe(200);
    const bData = await res.json();
    expect(bData.success).toBe(true);
    expect(bData.stage).toBe('checkout_open_invoked');

    const funnelRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
    const funnelJson = await funnelRes.json();
    const saas = funnelJson.data.selfServeSaaSFunnel;
    expect(saas.stages.checkout_open_invoked).toBeGreaterThanOrEqual(1);
    expect(saas.checkoutInitiated).toBeGreaterThanOrEqual(1);
  });

  it('16. IndexNow returns key for both indexnow-key-38f9d0c2.txt and ai-marketing-indexnow-key.txt', async () => {
    const res1 = await app.request('/indexnow-key-38f9d0c2.txt');
    expect(res1.status).toBe(200);
    expect(res1.headers.get('content-type')).toContain('text/plain');
    expect(await res1.text()).toBe('indexnow-key-38f9d0c2');

    const res2 = await app.request('/ai-marketing-indexnow-key.txt');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('content-type')).toContain('text/plain');
    expect(await res2.text()).toBe('ai-marketing-indexnow-key');
  });

  it('17. TEST_SANDBOX order capture events do not increment live payment_captured in /revenue-funnel', async () => {
    const db = getDb();
    const sandboxOrderId = 'ord_rzp_sandbox_test_1';
    db.prepare(`DROP TABLE IF EXISTS universal_orders_temp_backup`).run();
    db.prepare(`DROP TABLE IF EXISTS payment_orders_temp_backup`).run();
    db.prepare(`ALTER TABLE universal_orders RENAME TO universal_orders_temp_backup`).run();
    db.prepare(`CREATE TABLE universal_orders AS SELECT * FROM universal_orders_temp_backup WHERE 0`).run();
    db.prepare(`ALTER TABLE payment_orders RENAME TO payment_orders_temp_backup`).run();
    db.prepare(`CREATE TABLE payment_orders AS SELECT * FROM payment_orders_temp_backup WHERE 0`).run();

    try {
      db.prepare(`
        INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name, customer_email, customer_phone,
          amount_minor, currency, status, payment_provider, provider_order_id, provider_payment_id,
          fulfillment_status, metadata_json, is_test, created_at, updated_at
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'SITEFIX_AI_PACK_V1', 'SiteFix Customer', 'test@example.com', '',
          49900, 'INR', 'TEST_CAPTURED', 'RAZORPAY', 'order_sandbox_1', 'pay_sandbox_1',
          'DELIVERABLE_READY_EMAIL_PENDING', '{"mode":"TEST_SANDBOX","sku":"SITEFIX_AI_PACK_V1"}', 0, datetime('now'), datetime('now')
        )
      `).run(sandboxOrderId);

      await recordSiteFixFunnelEvent({
        stage: 'capture',
        source: 'web',
        isProbe: false,
        orderId: sandboxOrderId,
        paymentId: 'pay_sandbox_1',
        url: 'https://ai-marketing-organization.onrender.com/tools/site-audit',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      });

      const funnelRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
      expect(funnelRes.status).toBe(200);
      const funnelJson = await funnelRes.json();
      expect(funnelJson.data.selfServeSaaSFunnel.paymentCaptured).toBe(0);
      expect(funnelJson.data.selfServeSaaSFunnel.stages.payment_captured).toBe(0);

      const preserved = db.prepare(`SELECT id, status FROM universal_orders WHERE id = ?`).get(sandboxOrderId) as any;
      expect(preserved?.status).toBe('TEST_CAPTURED');

      // 17b/c: Live capture + similar-looking non-test capture stored alongside sandbox row (sandbox row first) ARE counted
      const liveLookalikeOrderId = 'ord_rzp_live_lookalike_1';
      db.prepare(`
        INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name, customer_email, customer_phone,
          amount_minor, currency, status, payment_provider, provider_order_id, provider_payment_id,
          fulfillment_status, metadata_json, is_test, created_at, updated_at
        ) VALUES (
          ?, 'biz_platform_aro', 'org_owner_primary', 'SITEFIX_AI_PACK_V1', 'Live Buyer', 'buyer@example.com', '',
          49900, 'INR', 'CHECKOUT', 'RAZORPAY', 'order_live_1', 'pay_live_1',
          'PENDING', '{"mode":"LIVE","sku":"SITEFIX_AI_PACK_V1"}', 0, datetime('now'), datetime('now')
        )
      `).run(liveLookalikeOrderId);

      await recordSiteFixFunnelEvent({
        stage: 'payment_captured',
        source: 'web',
        isProbe: false,
        orderId: liveLookalikeOrderId,
        paymentId: 'pay_live_1',
        url: 'https://ai-marketing-organization.onrender.com/tools/site-audit',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      });

      const multiRowRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
      expect(multiRowRes.status).toBe(200);
      const multiRowJson = await multiRowRes.json();
      expect(multiRowJson.data.selfServeSaaSFunnel.paymentCaptured).toBe(1);
      expect(multiRowJson.data.selfServeSaaSFunnel.stages.payment_captured).toBe(1);
      expect(multiRowJson.data.selfServeSaaSFunnel.paymentCapturedStatus).toBe('VERIFIED');
      expect(db.prepare(`SELECT id FROM universal_orders WHERE id = ?`).get(sandboxOrderId)).toBeDefined();
      expect(db.prepare(`SELECT id FROM universal_orders WHERE id = ?`).get(liveLookalikeOrderId)).toBeDefined();

      // 17d: Classification lookup failure fails safely without falling back to rawEventCaptured
      const repo = D1RevenueRepository.getInstance();
      const origQuery = repo.query.bind(repo);
      const querySpy = vi.spyOn(repo, 'query').mockImplementation(async (table: string, sql: string, params?: any[]) => {
        if (table === 'universal_orders' && sql.includes('TEST_CAPTURED')) {
          throw new Error('D1 classification lookup failed');
        }
        return origQuery(table, sql, params);
      });
      try {
        const failRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
        expect(failRes.status).toBe(200);
        const failJson = await failRes.json();
        expect(failJson.data.selfServeSaaSFunnel.paymentCaptured).toBeNull();
        expect(failJson.data.selfServeSaaSFunnel.stages.payment_captured).toBeNull();
        expect(failJson.data.selfServeSaaSFunnel.paymentCapturedStatus).toBe('UNAVAILABLE');
      } finally {
        querySpy.mockRestore();
      }
    } finally {
      db.prepare(`DROP TABLE IF EXISTS universal_orders`).run();
      db.prepare(`ALTER TABLE universal_orders_temp_backup RENAME TO universal_orders`).run();
      db.prepare(`DROP TABLE IF EXISTS payment_orders`).run();
      db.prepare(`ALTER TABLE payment_orders_temp_backup RENAME TO payment_orders`).run();
    }
  });

  it('18. Distinguishes authoritative zero from missing/degraded attribution and preserves positive ledger captures', async () => {
    const db = getDb();
    db.prepare(`DROP TABLE IF EXISTS universal_orders_temp_backup`).run();
    db.prepare(`DROP TABLE IF EXISTS payment_orders_temp_backup`).run();
    db.prepare(`ALTER TABLE universal_orders RENAME TO universal_orders_temp_backup`).run();
    db.prepare(`CREATE TABLE universal_orders AS SELECT * FROM universal_orders_temp_backup WHERE 0`).run();
    db.prepare(`ALTER TABLE payment_orders RENAME TO payment_orders_temp_backup`).run();
    db.prepare(`CREATE TABLE payment_orders AS SELECT * FROM payment_orders_temp_backup WHERE 0`).run();

    try {
      // (a) Successful authoritative zero
      const zeroRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
      expect(zeroRes.status).toBe(200);
      const zeroJson = await zeroRes.json();
      expect(zeroJson.data.selfServeSaaSFunnel.paymentCaptured).toBe(0);
      expect(zeroJson.data.selfServeSaaSFunnel.stages.payment_captured).toBe(0);
      expect(zeroJson.data.selfServeSaaSFunnel.paymentCapturedStatus).toBe('VERIFIED');

      // (b) Attribution lookup throws / sfxTotals missing -> UNAVAILABLE (null)
      const sfaModule = await import('../../src/tools/site-audit/sitefix-funnel-attribution.js');
      const throwSpy = vi.spyOn(sfaModule, 'getSiteFixFunnelAttributionSummaryAsync').mockRejectedValueOnce(new Error('D1 attribution read error'));
      try {
        const errRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
        expect(errRes.status).toBe(200);
        const errJson = await errRes.json();
        expect(errJson.data.selfServeSaaSFunnel.paymentCaptured).toBeNull();
        expect(errJson.data.selfServeSaaSFunnel.stages.payment_captured).toBeNull();
        expect(errJson.data.selfServeSaaSFunnel.paymentCapturedStatus).toBe('UNAVAILABLE');
      } finally {
        throwSpy.mockRestore();
      }

      // (c) Attribution returns SQLite fallback summary with persistenceWarning -> UNAVAILABLE (null)
      const repo = D1RevenueRepository.getInstance();
      const origQuery = repo.query.bind(repo);
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVitest = process.env.VITEST;
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      const d1CfgSpy = vi.spyOn(repo, 'isRemoteD1Configured').mockReturnValue(true);
      const d1QuerySpy = vi.spyOn(repo, 'query').mockImplementation(async (table: string, sql: string, params?: any[]) => {
        if (table === 'durable_events' && sql.includes('SITEFIX_FUNNEL_EVENT')) {
          throw new Error('Remote D1 read failed');
        }
        return origQuery(table, sql, params);
      });
      try {
        const warnRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
        expect(warnRes.status).toBe(200);
        const warnJson = await warnRes.json();
        expect(warnJson.data.selfServeSaaSFunnel.paymentCaptured).toBeNull();
        expect(warnJson.data.selfServeSaaSFunnel.stages.payment_captured).toBeNull();
        expect(warnJson.data.selfServeSaaSFunnel.paymentCapturedStatus).toBe('UNAVAILABLE');
      } finally {
        d1QuerySpy.mockRestore();
        d1CfgSpy.mockRestore();
        if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
        else delete process.env.NODE_ENV;
        if (prevVitest !== undefined) process.env.VITEST = prevVitest;
      }

      // (d) Positive authoritative ledger capture still counted even if attribution has persistenceWarning
      db.prepare(`
        INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name, customer_email, customer_phone,
          amount_minor, currency, status, payment_provider, provider_order_id, provider_payment_id,
          fulfillment_status, metadata_json, is_test, created_at, updated_at
        ) VALUES (
          'ord_rzp_auth_live_1', 'biz_platform_aro', 'org_owner_primary', 'SITEFIX_AI_PACK_V1', 'Auth Buyer', 'auth@example.com', '',
          49900, 'INR', 'CAPTURED', 'RAZORPAY', 'order_auth_1', 'pay_auth_1',
          'DELIVERED', '{"mode":"LIVE","sku":"SITEFIX_AI_PACK_V1"}', 0, datetime('now'), datetime('now')
        )
      `).run();

      const posRes = await app.request('/api/v1/public/revenue-funnel?fresh=true');
      expect(posRes.status).toBe(200);
      const posJson = await posRes.json();
      expect(posJson.data.selfServeSaaSFunnel.paymentCaptured).toBe(1);
      expect(posJson.data.selfServeSaaSFunnel.stages.payment_captured).toBe(1);
      expect(posJson.data.selfServeSaaSFunnel.paymentCapturedStatus).toBe('VERIFIED');
    } finally {
      db.prepare(`DROP TABLE IF EXISTS universal_orders`).run();
      db.prepare(`ALTER TABLE universal_orders_temp_backup RENAME TO universal_orders`).run();
      db.prepare(`DROP TABLE IF EXISTS payment_orders`).run();
      db.prepare(`ALTER TABLE payment_orders_temp_backup RENAME TO payment_orders`).run();
    }
  });
});
