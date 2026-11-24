import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { recordSiteFixFunnelEvent, recordToolVisitSession } from '../../src/tools/site-audit/sitefix-funnel-attribution.js';
import { renderOwnerToolPage } from '../../src/tools/site-audit/owner-tool-pages.js';
import { renderSiteAuditPage } from '../../src/tools/site-audit/site-audit-page.js';

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

  it('3. checkout_start funnel event increments checkoutInitiated in /revenue-funnel', async () => {
    await recordSiteFixFunnelEvent({
      stage: 'checkout_start',
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
    expect(saas.stages).toBeDefined();
    expect(saas.stages.page_view).toBeDefined();
    expect(saas.stages.scan_started).toBeDefined();
    expect(saas.stages.scan_completed).toBeDefined();
    expect(saas.stages.preview_displayed).toBeDefined();
    expect(saas.stages.order_created).toBeDefined();
    expect(saas.stages.checkout_modal_opened).toBeDefined();
    expect(saas.stages.payment_captured).toBeDefined();
    expect(saas.stages.deliverable_ready).toBeDefined();
    expect(saas.stages.email_delivered).toBeDefined();
  });
});
