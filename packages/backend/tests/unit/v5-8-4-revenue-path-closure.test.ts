import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { DurableJobQueue } from '../../src/automation/durable-job-queue.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { createHmac, createHash } from 'node:crypto';

describe('V5.8.4 — Revenue Path Closure, Razorpay Webhook Hardening & Truthful Architecture', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    GooglePageSpeedClient.resetInstance();
    CuelinksV3Client.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    DurableJobQueue.resetInstance();
    process.env.SITE_AUDIT_SIGNING_SECRET = 'a'.repeat(32);

    try {
      const db = getDb();
      db.prepare("DELETE FROM payment_orders WHERE id LIKE 'po_v584_%' OR order_id LIKE 'order_v584_%'").run();
      db.prepare("DELETE FROM processed_webhook_events WHERE event_id LIKE 'evt_v584_%'").run();
      db.prepare("DELETE FROM automation_jobs WHERE workflow_id LIKE 'wf_v584_%' OR id LIKE 'job_v584_%'").run();
      db.prepare("DELETE FROM cuelinks_campaigns WHERE campaign_id LIKE 'camp_v584_%'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    GooglePageSpeedClient.resetInstance();
    CuelinksV3Client.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    DurableJobQueue.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. Priority 1: Razorpay Webhook & Payment Status Hardening', () => {
    const webhookSecret = 'rzp_test_webhook_secret_v584';

    it('idempotently handles duplicate webhook events via processed_webhook_events', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const orderId = 'order_v584_idemp_1';
      const paymentId = 'pay_v584_idemp_1';
      const auditId = 'audit_v584_idemp_1';
      const eventId = 'evt_v584_idemp_1';

      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, ?, datetime('now'), datetime('now'))
      `).run('po_v584_idemp_1', orderId, auditId, JSON.stringify({ auditId }));

      const payload = {
        entity: 'event',
        account_id: 'acc_v584_test',
        event: 'payment.captured',
        id: eventId,
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 49900,
              currency: 'INR',
              status: 'captured',
              notes: { auditId }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

      // First webhook delivery -> processed
      const res1 = await app.request('/api/v1/tools/site-audit/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId
        },
        body: rawBody
      });

      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.success).toBe(true);
      expect(json1.processed).toBe(true);

      // Verify event was logged in processed_webhook_events
      const eventRow = db.prepare('SELECT event_id, order_id, payment_id FROM processed_webhook_events WHERE event_id = ?').get(eventId) as any;
      expect(eventRow).toBeDefined();
      expect(eventRow.order_id).toBe(orderId);

      // Second webhook delivery with the exact same event -> returns duplicate_ignored
      const res2 = await app.request('/api/v1/tools/site-audit/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId
        },
        body: rawBody
      });

      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.status).toBe('duplicate_ignored');
    });

    it('rejects tampered or forged webhook signature in constant time', async () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
      const rawBody = JSON.stringify({ event: 'payment.captured' });

      const res = await app.request('/api/v1/tools/site-audit/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000'
        },
        body: rawBody
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Invalid Razorpay webhook signature');
    });

    it('enforces auditId access control in payment-status endpoint and rejects mismatch with 403', async () => {
      const orderId = 'order_v584_mismatch';
      const auditIdA = 'audit_v584_legit';
      const auditIdB = 'audit_v584_attacker';

      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CAPTURED', ?, ?, datetime('now'), datetime('now'))
      `).run('po_v584_mismatch', orderId, auditIdA, JSON.stringify({ auditId: auditIdA }));

      // Attacker tries to query status of orderId against auditIdB
      const res = await app.request(`/api/v1/tools/site-audit/${auditIdB}/payment-status?orderId=${orderId}`, {
        method: 'GET'
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('FORBIDDEN');
    });

    it('does not mint download token if order is not captured or payment_id is missing', async () => {
      const orderId = 'order_v584_uncaptured_status';
      const auditId = 'audit_v584_uncaptured_status';

      const db = getDb();
      db.prepare(`
        INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
        VALUES (?, 'biz_platform_aro', ?, 499, 'INR', 'CREATED', ?, ?, datetime('now'), datetime('now'))
      `).run('po_v584_uncaptured_status', orderId, auditId, JSON.stringify({ auditId }));

      const res = await app.request(`/api/v1/tools/site-audit/${auditId}/payment-status?orderId=${orderId}`, {
        method: 'GET'
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.isCaptured).toBe(false);
      expect(json.downloadToken).toBeUndefined();
      expect(json.downloadUrl).toBeUndefined();
    });
  });

  describe('2. Priority 2: Cuelinks Provenance & Public Deals Eviction', () => {
    it('strictly requires verification_source = CUELINKS_API_V3 for active merchants', async () => {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO cuelinks_campaigns (campaign_id, name, merchant_domain, status, verification_source)
        VALUES ('camp_v584_valid', 'Valid Merchant', 'validmerchant.in', 'ACTIVE', 'CUELINKS_API_V3')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO cuelinks_campaigns (campaign_id, name, merchant_domain, status, verification_source)
        VALUES ('camp_v584_invalid', 'Invalid Merchant', 'invalidmerchant.in', 'ACTIVE', 'MANUAL_IMPORT')
      `).run();

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const merchants = await engine.getActiveVerifiedMerchants();

      const validFound = merchants.some(m => m.domain === 'validmerchant.in');
      const invalidFound = merchants.some(m => m.domain === 'invalidmerchant.in');

      expect(validFound).toBe(true);
      expect(invalidFound).toBe(false);
    });
  });

  describe('3. Priority 3: Queue Deduplication & Compaction', () => {
    it('enforces at most 1 active QUEUED or RUNNING job per workflow_id', async () => {
      const queue = DurableJobQueue.getInstance();
      const wfId = 'wf_v584_dedup_test';

      const res1 = await queue.enqueueJob({
        workflowId: wfId,
        idempotencyKey: `idemp_${wfId}_1`,
        payload: { test: 1 }
      });
      expect(res1.enqueued).toBe(true);

      const res2 = await queue.enqueueJob({
        workflowId: wfId,
        idempotencyKey: `idemp_${wfId}_2`,
        payload: { test: 2 }
      });
      expect(res2.enqueued).toBe(false);
      expect(res2.job.id).toBe(res1.job.id);
    });

    it('compacts stale duplicate queue jobs keeping only the latest per workflow', async () => {
      const db = getDb();
      const wfId = 'wf_v584_compact_test';

      // Insert 3 duplicate queued jobs directly
      db.prepare(`
        INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
        VALUES
          ('job_v584_c1', ?, 'biz_platform_aro', 'org_owner_primary', 'k1', 'QUEUED', 1, '{}', '{}', 0, 3, datetime('now', '-2 hours'), '{}', datetime('now', '-2 hours'), datetime('now', '-2 hours')),
          ('job_v584_c2', ?, 'biz_platform_aro', 'org_owner_primary', 'k2', 'QUEUED', 1, '{}', '{}', 0, 3, datetime('now', '-1 hours'), '{}', datetime('now', '-1 hours'), datetime('now', '-1 hours')),
          ('job_v584_c3', ?, 'biz_platform_aro', 'org_owner_primary', 'k3', 'QUEUED', 1, '{}', '{}', 0, 3, datetime('now'), '{}', datetime('now'), datetime('now'))
      `).run(wfId, wfId, wfId);

      const queue = DurableJobQueue.getInstance();
      const compactedCount = await queue.compactStaleDuplicateQueueJobs();
      expect(compactedCount).toBeGreaterThanOrEqual(2);

      const remainingQueued = db.prepare(`SELECT id, status, last_error FROM automation_jobs WHERE workflow_id = ? AND status = 'QUEUED'`).all(wfId) as any[];
      expect(remainingQueued.length).toBe(1);
      expect(remainingQueued[0].id).toBe('job_v584_c3');

      const superseded = db.prepare(`SELECT id, status, last_error FROM automation_jobs WHERE workflow_id = ? AND status = 'NO_ACTION_DUE'`).all(wfId) as any[];
      expect(superseded.length).toBe(2);
      expect(superseded[0].last_error).toBe('SUPERSEDED_DEDUP');
    });
  });

  describe('4. Priority 4: Truthful Telemetry & Readiness', () => {
    it('returns v5.8.4, real migration version, and unconfigured keyless status in autonomy-status', async () => {
      delete process.env.GOOGLE_PAGESPEED_API_KEY;

      const res = await app.request('/api/v1/public/autonomy-status', { method: 'GET' });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.version).toBe('5.8.4');
      expect(json.buildMetadata.version).toBe('5.8.4');
      expect(json.buildMetadata.d1MigrationVersion).not.toBe('UNKNOWN_QUERY_FAILED');
      expect(json.capabilityMatrix.pageSpeedInsights.status).toBe('UNCONFIGURED_KEYLESS_MODE');
    });

    it('reports unmeasuredExternalCosts in revenue-funnel with zero freeTierSavingsINR and verified measurement status', async () => {
      const res = await app.request('/api/v1/public/revenue-funnel', { method: 'GET' });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.data.measurementStatus).toBe('VERIFIED_LIVE_DB');
      expect(json.data.operatingCosts.freeTierSavingsINR).toBeUndefined();
      expect(json.data.operatingCosts.unmeasuredExternalCosts).toBe('FREE_TIER_QUOTA_BOUNDED');
      expect(json.data.funnel.bankCashReceivedINR).toBe(0);
      expect(json.data.selfServeSaaSFunnel.bankConfirmedCashINR).toBe(0);
    });

    it('reports sandboxModeActive: true in system/readiness when test key is active', async () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture_v584';

      const res = await app.request('/api/v1/system/readiness', { method: 'GET' });
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.success).toBe(true);
      expect(json.data.sandboxModeActive).toBe(true);
    });
  });

  describe('5. Priority 5: Administrative Homepage Compliance', () => {
    it('renders administrative inquiry capture framing with explicit non-clinical disclaimer and verification tags', async () => {
      const offerPage = DirectCommercialOfferPage.getInstance();
      const html = offerPage.renderHomepageHtml({
        cuelinksVerificationCode: 'VERIFY-CL-YE94W8YS',
        googleSiteVerification: 'WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I'
      });

      expect(html).toContain('Administrative After-Hours Lead Capture');
      expect(html).toContain('[Illustrative Administrative Example — No Clinical or Medical Triage]');
      expect(html).toContain('content="WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I"');
      expect(html).toContain('content="VERIFY-CL-YE94W8YS"');

      // Purged medical advice and clinical pricing claims
      expect(html).not.toContain('Dr. Suresh has reserved emergency slots');
      expect(html).not.toContain('rinse gently with warm salt water');
      expect(html).not.toContain('starting from ₹22,000 per implant');
      expect(html).not.toContain('3D CBCT scan');
      expect(html).not.toContain('#razorpay-sandbox-test-panel');
    });
  });
});
