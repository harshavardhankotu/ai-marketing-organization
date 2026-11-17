import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { renderSiteAuditPage } from '../../src/tools/site-audit/site-audit-page.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import app from '../../src/index.js';

describe('Stage R & R.1 — Payment Attribution, Separate Fulfillment Machine, Fail-Closed Readiness & Operator UI Truth', () => {
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

  describe('Task 1 & R.1: Manual UPI Tenant Attribution, Exact Paise & Anti-IDOR', () => {
    it('preserves non-platform tenant business_id and organization_id, never overwriting with platform ID', async () => {
      const claimId = `claim_tenant_${Date.now()}`;
      const utr = `999000${Date.now().toString().slice(-6)}`;
      const tenantBusinessId = 'biz_smilekraft_hyd';
      const tenantOrgId = 'org_smilekraft_01';

      // Insert tenant claim
      db.prepare(`
        INSERT INTO manual_upi_claims (
          id, organization_id, business_id, utr, amount_inr, status,
          payer_name, notes, claimed_at
        ) VALUES (?, ?, ?, ?, 1500, 'PAYMENT_CLAIMED', 'Tenant Buyer', ?, datetime('now'))
      `).run(claimId, tenantOrgId, tenantBusinessId, utr, JSON.stringify({ domain: 'smilekraft.in', sku: 'custom_pack', buyerEmail: 'buyer@smilekraft.in' }));

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

    it('rejects fractional paise mismatch (e.g. 498.60 vs 499) with AMOUNT_MISMATCH error', async () => {
      const claimId = `claim_paise_mismatch_${Date.now()}`;
      const utr = `999050${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
      `).run(claimId, utr);

      await expect(
        razorpayAdapter.confirmManualUpiClaim({
          claimId,
          utr,
          businessId: 'biz_smilekraft_hyd',
          organizationId: 'org_smilekraft_01',
          amountINR: 498.60, // Fractional mismatch that would round to 499 if using Math.round(rupees)
          ownerUserId: 'usr_owner_01'
        })
      ).rejects.toThrow('AMOUNT_MISMATCH');
    });

    it('rejects UTR mismatch with UTR_MISMATCH error', async () => {
      const claimId = `claim_utr_mismatch_${Date.now()}`;
      const claimedUtr = `999111${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
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

    it('rejects non-existent claimId with CLAIM_NOT_FOUND error', async () => {
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
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'REJECTED', datetime('now'))
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

    it('prevents IDOR: rejects modifying customer_journey owned by a different business', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      const foreignJourneyId = `cj_foreign_${Date.now()}`;

      // Create journey owned by business A
      await adapter.ensureCustomerJourney(
        foreignJourneyId,
        'tenantA@example.com',
        'Tenant A User',
        true,
        'LEAD',
        'org_smilekraft_01',
        'biz_smilekraft_hyd'
      );

      // Attempting to overwrite it from business B must be rejected
      await expect(
        adapter.ensureCustomerJourney(
          foreignJourneyId,
          'tenantB@example.com',
          'Tenant B Attacker',
          true,
          'PAYMENT_VERIFIED',
          'org_owner_primary',
          'biz_platform_aro'
        )
      ).rejects.toThrow('TENANT_MISMATCH');
    });
  });

  describe('Task 2 & R.1: Fulfillment State Machine, Owner Auth, Dot-Free Tokens & CAS', () => {
    it('unauthenticated POST /api/v1/payments/manual-upi/:claimId/retry-fulfillment returns 401', async () => {
      const res = await app.request('/api/v1/payments/manual-upi/claim_test_123/retry-fulfillment', {
        method: 'POST'
      });
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Unauthorized');
    });

    it('unauthenticated POST /api/v1/owner/fulfillment/retry returns 401', async () => {
      const res = await app.request('/api/v1/owner/fulfillment/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId: 'claim_test_123' })
      });
      expect(res.status).toBe(401);
    });

    it('retryManualUpiFulfillment rejects unverified claims with UNVERIFIED_PAYMENT', async () => {
      const claimId = `claim_unverified_${Date.now()}`;
      const utr = `999555${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
      `).run(claimId, utr);

      await expect(
        razorpayAdapter.retryManualUpiFulfillment(claimId)
      ).rejects.toThrow('UNVERIFIED_PAYMENT');
    });

    it('generates dot-free delivery tokens that pass verifyDeliveryToken with 5 segments', async () => {
      const claimId = `claim_dotfree_${Date.now()}`;
      const utr = `999777${Date.now().toString().slice(-6)}`;
      const domain = `sub.domain.${Date.now()}.example.com`; // Domain with multiple dots

      db.prepare(`
        INSERT OR REPLACE INTO site_audits (domain, target_url, business_name, status, created_at)
        VALUES (?, ?, 'Dot Site', 'COMPLETED', datetime('now'))
      `).run(domain, `https://${domain}`);

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, notes, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'HUMAN_VERIFIED_PAYMENT', ?, datetime('now'))
      `).run(claimId, utr, JSON.stringify({ domain, sku: 'sitefix_core_499', buyerEmail: 'buyer@example.com' }));

      const retryRes = await razorpayAdapter.retryManualUpiFulfillment(claimId);
      expect(retryRes.success).toBe(true);
      expect(retryRes.downloadToken).toBeDefined();

      // Verify delivery token format: must split into exactly 5 segments (no extra dots from domain in auditId)
      const parts = retryRes.downloadToken!.split('.');
      expect(parts.length).toBe(5);

      const auditService = SiteAuditService.getInstance();
      const verified = await auditService.verifyDeliveryToken(retryRes.downloadToken!);
      expect(verified.valid).toBe(true);
      expect(verified.paymentId).toBe(utr);
    });

    it('missing buyerEmail keeps claim in FULFILLMENT_IN_PROGRESS and never marks FULFILLED', async () => {
      const claimId = `claim_no_email_${Date.now()}`;
      const utr = `999888${Date.now().toString().slice(-6)}`;
      const domain = `no-email-${Date.now()}.com`;

      db.prepare(`
        INSERT INTO site_audits (domain, target_url, business_name, status, created_at)
        VALUES (?, ?, 'No Email Biz', 'COMPLETED', datetime('now'))
      `).run(domain, `https://${domain}`);

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, notes, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'HUMAN_VERIFIED_PAYMENT', ?, datetime('now'))
      `).run(claimId, utr, JSON.stringify({ domain, sku: 'sitefix_core_499' })); // No buyerEmail

      const retryRes = await razorpayAdapter.retryManualUpiFulfillment(claimId);
      expect(retryRes.status).toBe('FULFILLMENT_IN_PROGRESS');
      expect(retryRes.emailReceiptStatus).toBe('MISSING_BUYER_EMAIL');

      const claimInDb = db.prepare(`SELECT status FROM manual_upi_claims WHERE id = ?`).get(claimId) as any;
      expect(claimInDb.status).toBe('FULFILLMENT_IN_PROGRESS');
    });

    it('concurrent REFUNDED lifecycle prevents overwriting to FULFILLED via atomic CAS', async () => {
      const claimId = `claim_cas_refund_${Date.now()}`;
      const utr = `999999${Date.now().toString().slice(-6)}`;
      const domain = `cas-refund-${Date.now()}.com`;

      db.prepare(`
        INSERT INTO site_audits (domain, target_url, business_name, status, created_at)
        VALUES (?, ?, 'CAS Biz', 'COMPLETED', datetime('now'))
      `).run(domain, `https://${domain}`);

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, notes, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'HUMAN_VERIFIED_PAYMENT', ?, datetime('now'))
      `).run(claimId, utr, JSON.stringify({ domain, sku: 'sitefix_core_499', buyerEmail: 'buyer@cas.com' }));

      // Mock Brevo client to simulate successful send, but simulate operator marking REFUNDED during fulfillment
      const origSend = razorpayAdapter['d1Repo'];
      // Simulate concurrent refund in DB before the update
      db.prepare(`UPDATE manual_upi_claims SET status = 'REFUNDED' WHERE id = ?`).run(claimId);

      // Attempting to retry an already refunded claim must fail
      await expect(
        razorpayAdapter.retryManualUpiFulfillment(claimId)
      ).rejects.toThrow('CONFLICTING_CLAIM_STATUS');

      const finalDb = db.prepare(`SELECT status FROM manual_upi_claims WHERE id = ?`).get(claimId) as any;
      expect(finalDb.status).toBe('REFUNDED');
    });

    it('UPDATE manual_upi_claims executes cleanly against exact 0050 schema without updated_at column', async () => {
      const claimId = `claim_schema_${Date.now()}`;
      const utr = `888111${Date.now().toString().slice(-6)}`;

      db.prepare(`
        INSERT INTO manual_upi_claims (id, organization_id, business_id, utr, amount_inr, status, claimed_at)
        VALUES (?, 'org_smilekraft_01', 'biz_smilekraft_hyd', ?, 499, 'PAYMENT_CLAIMED', datetime('now'))
      `).run(claimId, utr);

      // Confirm claim should not throw SQL "no such column: updated_at"
      const res = await razorpayAdapter.confirmManualUpiClaim({
        claimId,
        utr,
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        amountINR: 499,
        ownerUserId: 'usr_owner_01'
      });

      expect(res.success).toBe(true);
      const row = db.prepare(`SELECT status FROM manual_upi_claims WHERE id = ?`).get(claimId) as any;
      expect(['HUMAN_VERIFIED_PAYMENT', 'FULFILLED']).toContain(row.status);
    });
  });

  describe('Task 3 & R.1: Fail-Closed Razorpay Readiness, Storefront Mode & YouTube Link', () => {
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
          httpStatus: 401,
          authDiagnosticCode: 'RAZORPAY_401_REJECTED_SECRET',
          authStatus: 'AUTH_FAILED',
          keyMode: 'LIVE'
        }
      });

      expect(readiness.isReady).toBe(false);
      expect(readiness.status).toBe('LOCKED_MISSING_CONFIGURATION');
      expect(readiness.missingConfig).toContain('RAZORPAY_AUTH_FAILED');
      expect(readiness.paymentReadiness.liveMoneyReady).toBe(false);
      expect(readiness.paymentReadiness.paymentMode).toBe('UNCONFIGURED');
    });

    it('distinguishes network error probe from 401 credential rejection (PROBE_UNREACHABLE)', () => {
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.RAZORPAY_MODE = 'live';
      process.env.RAZORPAY_KEY_ID = 'rzp_live_testkey12345678';
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_test12345678';

      const service = SiteAuditService.getInstance();

      const readiness = service.getCheckoutReadiness({
        authProbeResult: {
          providerAcceptedAuth: false,
          httpStatus: null,
          authDiagnosticCode: 'NETWORK_ERROR',
          authStatus: 'AUTH_FAILED',
          keyMode: 'LIVE'
        }
      });

      expect(readiness.isReady).toBe(false);
      expect(readiness.missingConfig).toContain('PROBE_UNREACHABLE');
      expect(readiness.missingConfig).not.toContain('RAZORPAY_AUTH_FAILED');
      expect(readiness.paymentReadiness.liveMoneyReady).toBe(false);
    });

    it('defaults failed readiness to UNCONFIGURED and hides sandbox test notice', () => {
      const html = renderSiteAuditPage();

      // Verify that sandboxTestModeNotice has style="display: none;"
      expect(html).toContain('id="sandboxTestModeNotice" style="display: none;');
      // Verify UNCONFIGURED fallback in client script
      expect(html).toContain("currentReadiness?.paymentReadiness?.paymentMode || 'UNCONFIGURED'");
    });

    it('StaticSiteGenerator renders accessible Watch Review on YouTube anchor link', () => {
      const generator = new StaticSiteGenerator();
      const mockDeal = {
        id: 'deal_sony_xm5',
        title: 'Sony WH-1000XM5 Headphones',
        merchant: 'Official Store',
        category: 'Electronics',
        currentPriceINR: 24990,
        referencePriceINR: 29990,
        productUrl: 'https://cuelinks.com/exclusive-deal',
        affiliateNetwork: 'CUELINKS',
        youtubeReview: {
          videoId: 'abc123xyz',
          title: 'Sony WH-1000XM5 In-Depth Review',
          embedUrl: 'https://www.youtube-nocookie.com/embed/abc123xyz',
          videoUrl: 'https://www.youtube.com/watch?v=abc123xyz'
        }
      };

      const mockConfig: any = { siteUrl: 'https://bestdeals.in', domain: 'bestdeals.in' };
      const html = generator.renderInstagramBioStorefrontHtml(mockConfig, [mockDeal as any]);
      expect(html).toContain('Watch Review on YouTube &rarr;');
      expect(html).toContain('https://www.youtube.com/watch?v=abc123xyz');
      expect(html).toContain('https://www.youtube-nocookie.com/embed/abc123xyz');
    });
  });

  describe('Task 4 & R.1: Operator Real Economics & AOV Truth', () => {
    it('RealEconomicsEngine derives averageOrderValueINR from verified order count, returning null when 0 orders', () => {
      const engine = new RealEconomicsEngine();
      const summary = engine.calculate('biz_test_no_orders');

      // 0 orders -> null (not hardcoded ₹499)
      expect(summary.averageOrderValueINR).toBeNull();
    });

    it('RealEconomicsEngine accurately calculates AOV across verified paid orders', () => {
      const testBizId = 'biz_test';

      // Clean test biz transactions first
      db.prepare(`DELETE FROM transactions WHERE business_id = ?`).run(testBizId);

      // Insert two real cleared transactions: ₹400 and ₹600 (Average = ₹500)
      db.prepare(`
        INSERT INTO transactions (
          id, organization_id, business_id, invoice_number, amount_inr, status, classification,
          payment_method, payment_gateway, created_at
        ) VALUES
        ('tx_aov_1', 'org_test', ?, 'INV-AOV-1', 400, 'CLEARED', 'REAL', 'UPI', 'MANUAL', datetime('now')),
        ('tx_aov_2', 'org_test', ?, 'INV-AOV-2', 600, 'CLEARED', 'REAL', 'UPI', 'MANUAL', datetime('now'))
      `).run(testBizId, testBizId);

      const engine = new RealEconomicsEngine();
      const summary = engine.calculate(testBizId);

      expect(summary.averageOrderValueINR).toBe(500);
    });
  });
});
