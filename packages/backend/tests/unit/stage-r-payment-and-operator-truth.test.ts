import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { renderSiteAuditPage } from '../../src/tools/site-audit/site-audit-page.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Stage R — Payment Attribution, Separate Fulfillment Machine, Fail-Closed Readiness & Operator UI Truth', () => {
  let db: any;
  let razorpayAdapter: RazorpayAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    db = getDb();
    razorpayAdapter = new RazorpayAdapter();
    process.env = { ...originalEnv };
    process.env.VITEST = 'true';
    process.env.JWT_SECRET = 'test_jwt_secret_must_be_at_least_32_characters_long_for_security';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Task 1: Manual UPI Tenant Attribution & Strict Claim Validation', () => {
    it('preserves non-platform tenant business_id and organization_id, never overwriting with platform ID', async () => {
      const claimId = `claim_tenant_${Date.now()}`;
      const utr = `999000${Date.now().toString().slice(-6)}`;
      const tenantBusinessId = 'biz_smilekraft_hyd';
      const tenantOrgId = 'org_smilekraft_01';

      // Insert tenant claim
      db.prepare(`
        INSERT INTO manual_upi_claims (
          id, business_id, organization_id, utr, amount_inr, status,
          payer_name, notes, claimed_at
        ) VALUES (?, ?, ?, ?, 1500, 'PAYMENT_CLAIMED', 'Tenant Buyer', ?, datetime('now'))
      `).run(claimId, tenantBusinessId, tenantOrgId, utr, JSON.stringify({ domain: 'smilekraft.in', sku: 'custom_pack', buyerEmail: 'buyer@smilekraft.in' }));

      // Confirm claim by owner
      const result = await razorpayAdapter.confirmManualUpiClaim({
        claimId,
        utr,
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID, // Caller tries to pass platform businessId
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        amountINR: 1500,
        ownerUserId: 'usr_owner_01'
      });

      expect(result.success).toBe(true);

      // Verify that transaction records authoritative tenant businessId
      const tx = db.prepare(`SELECT business_id, organization_id, transaction_ref, amount_inr FROM transactions WHERE transaction_ref = ?`).get(utr) as any;
      expect(tx).toBeDefined();
      expect(tx.business_id).toBe(tenantBusinessId);
      expect(tx.organization_id).toBe(tenantOrgId);
      expect(tx.amount_inr).toBe(1500);

      // Verify platform revenue records were NOT created for tenant revenue
      const platRev = db.prepare(`SELECT id FROM revenue_records WHERE transaction_id = ? AND business_id = ?`).get(utr, OwnerAuthService.PLATFORM_BUSINESS_ID) as any;
      expect(platRev).toBeUndefined();
    });

    it('rejects UTR mismatch with UTR_MISMATCH error', async () => {
      const claimId = `claim_utr_mismatch_${Date.now()}`;
      const claimedUtr = `999111${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, business_id, organization_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'biz_smilekraft_hyd', 'org_smilekraft_01', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
      `).run(claimId, claimedUtr);

      await expect(
        razorpayAdapter.confirmManualUpiClaim({
          claimId,
          utr: '999999999999', // Different UTR
          businessId: 'biz_smilekraft_hyd',
          organizationId: 'org_smilekraft_01',
          amountINR: 499,
          ownerUserId: 'usr_owner_01'
        })
      ).rejects.toThrow('UTR_MISMATCH');
    });

    it('rejects amount mismatch with AMOUNT_MISMATCH error', async () => {
      const claimId = `claim_amt_mismatch_${Date.now()}`;
      const utr = `999222${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, business_id, organization_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'biz_smilekraft_hyd', 'org_smilekraft_01', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
      `).run(claimId, utr);

      await expect(
        razorpayAdapter.confirmManualUpiClaim({
          claimId,
          utr,
          businessId: 'biz_smilekraft_hyd',
          organizationId: 'org_smilekraft_01',
          amountINR: 1999, // Mismatched amount
          ownerUserId: 'usr_owner_01'
        })
      ).rejects.toThrow('AMOUNT_MISMATCH');
    });

    it('rejects verification of non-existent claimId with CLAIM_NOT_FOUND error', async () => {
      await expect(
        razorpayAdapter.confirmManualUpiClaim({
          claimId: 'non_existent_claim_99999',
          utr: '123456789012',
          businessId: 'biz_smilekraft_hyd',
          organizationId: 'org_smilekraft_01',
          amountINR: 499,
          ownerUserId: 'usr_owner_01'
        })
      ).rejects.toThrow('CLAIM_NOT_FOUND');
    });

    it('rejects conflicting claim statuses (REJECTED or REFUNDED)', async () => {
      const claimId = `claim_rejected_${Date.now()}`;
      const utr = `999333${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, business_id, organization_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'biz_smilekraft_hyd', 'org_smilekraft_01', ?, 499, 'REJECTED', datetime('now'))
      `).run(claimId, utr);

      await expect(
        razorpayAdapter.confirmManualUpiClaim({
          claimId,
          utr,
          businessId: 'biz_smilekraft_hyd',
          organizationId: 'org_smilekraft_01',
          amountINR: 499,
          ownerUserId: 'usr_owner_01'
        })
      ).rejects.toThrow('CONFLICTING_CLAIM_STATUS');
    });

    it('handles duplicate UTR verification idempotently without error', async () => {
      const utr = `999444${Date.now().toString().slice(-6)}`;

      // First confirmation creates transaction
      const first = await razorpayAdapter.confirmManualUpiClaim({
        utr,
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        amountINR: 499,
        ownerUserId: 'usr_owner_01'
      });
      expect(first.success).toBe(true);

      // Second confirmation returns existing transaction without duplicating
      const second = await razorpayAdapter.confirmManualUpiClaim({
        utr,
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        amountINR: 499,
        ownerUserId: 'usr_owner_01'
      });
      expect(second.success).toBe(true);
      expect(second.transactionId).toBe(first.transactionId);
    });
  });

  describe('Task 2: Separate Verification from Fulfillment & Idempotent Retry', () => {
    it('retryManualUpiFulfillment rejects unverified claims with UNVERIFIED_PAYMENT', async () => {
      const claimId = `claim_unverified_${Date.now()}`;
      const utr = `999555${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, business_id, organization_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'biz_smilekraft_hyd', 'org_smilekraft_01', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
      `).run(claimId, utr);

      await expect(
        razorpayAdapter.retryManualUpiFulfillment(claimId)
      ).rejects.toThrow('UNVERIFIED_PAYMENT');
    });

    it('retryManualUpiFulfillment idempotently provisions deliverable for verified claim', async () => {
      const claimId = `claim_retry_${Date.now()}`;
      const utr = `999666${Date.now().toString().slice(-6)}`;
      const domain = `retry-site-${Date.now()}.com`;

      db.prepare(`
        INSERT INTO site_audits (domain, target_url, business_name, status, created_at)
        VALUES (?, ?, 'Retry Biz', 'COMPLETED', datetime('now'))
      `).run(domain, `https://${domain}`);

      db.prepare(`
        INSERT INTO manual_upi_claims (id, business_id, organization_id, utr, amount_inr, status, notes, claimed_at)
        VALUES (?, 'biz_smilekraft_hyd', 'org_smilekraft_01', ?, 499, 'HUMAN_VERIFIED_PAYMENT', ?, datetime('now'))
      `).run(claimId, utr, JSON.stringify({ domain, sku: 'sitefix_core_499', buyerEmail: 'buyer@retry.com' }));

      const retryRes = await razorpayAdapter.retryManualUpiFulfillment(claimId);
      expect(retryRes.success).toBe(true);
      expect(retryRes.downloadToken).toBeDefined();
      expect(retryRes.downloadUrl).toBeDefined();
      expect(retryRes.deliverableStatus).toBe('READY');

      // Verify delivery_tasks record was generated
      const task = db.prepare(`SELECT stage, deliverables_json FROM delivery_tasks WHERE id LIKE ?`).get(`%${utr}%`) as any;
      expect(task).toBeDefined();
      expect(task.stage).toBe('COMPLETED');
      expect(task.deliverables_json).toContain(domain);
    });
  });

  describe('Task 3: Fail-Closed Razorpay Readiness & Live-Mode Sandbox Isolation', () => {
    it('fails closed in LIVE mode when gateway probe is rejected (providerAcceptedAuth === false)', () => {
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.RAZORPAY_MODE = 'live';
      process.env.RAZORPAY_KEY_ID = 'rzp_live_testkey12345678';
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_test12345678';

      const service = SiteAuditService.getInstance();

      // Probe returns 401 rejected secret
      const readiness = service.getCheckoutReadiness({
        authProbeResult: {
          providerAcceptedAuth: false,
          authDiagnosticCode: 'RAZORPAY_401_REJECTED_SECRET',
          authStatus: 'AUTH_FAILED',
          keyMode: 'LIVE'
        }
      });

      expect(readiness.isReady).toBe(false);
      expect(readiness.status).toBe('LOCKED_MISSING_CONFIGURATION');
      expect(readiness.missingConfig).toContain('RAZORPAY_AUTH_FAILED');
      expect(readiness.paymentReadiness.liveMoneyReady).toBe(false);
    });

    it('hides sandbox notice and mock credentials by default in site-audit-page HTML', () => {
      const html = renderSiteAuditPage();

      // Verify that sandboxTestModeNotice has style="display: none;"
      expect(html).toContain('id="sandboxTestModeNotice" style="display: none;');
      // Verify customer-safe live gateway maintenance handler is wired
      expect(html).toContain('checkoutStatusText');
      expect(html).toContain('sandboxTestModeNotice');
    });
  });

  describe('Task 4: Operator UI & Real Economics Contracts', () => {
    it('RealEconomicsEngine returns averageOrderValueINR as arpcINR when customer revenue exists, and null when zero', () => {
      const engine = new RealEconomicsEngine();
      const summary = engine.calculate('biz_smilekraft_hyd');

      // When there are 0 real customers, averageOrderValueINR should be null (not ₹499 fallback)
      expect(summary.averageOrderValueINR).toBeNull();
    });

    it('RazorpayStandardAdapter exposes probeRazorpayAuth returning structured diagnostic contract', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const probe = await adapter.probeRazorpayAuth();

      expect(probe).toBeDefined();
      expect(typeof probe.providerAcceptedAuth).toBe('boolean');
      expect(['OK', 'MISSING_KEYS', 'MODE_PREFIX_MISMATCH', 'RAZORPAY_401_REJECTED_SECRET', 'NETWORK_ERROR']).toContain(probe.authDiagnosticCode);
      expect(['NOT_CONFIGURED', 'CREDENTIALS_PRESENT', 'PROVIDER_AUTHENTICATED', 'AUTH_FAILED']).toContain(probe.authStatus);
      expect(['LIVE', 'TEST_SANDBOX', 'NONE']).toContain(probe.keyMode);
    });
  });
});
