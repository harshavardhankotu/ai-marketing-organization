import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { D1Client } from '../../src/db/d1-client.js';
import { CommercialLifecycleManager } from '../../src/revenue/commercial-lifecycle.js';
import { FirstLiveCommercialActionManager } from '../../src/revenue/first-live-commercial-action.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { DeliveryBlueprintManager } from '../../src/revenue/delivery-blueprint.js';
import { createHmac } from 'crypto';

describe('Single Owner, Real UPI & Production Commercial Architecture (Spec §§ 1–60)', () => {
  let app: Hono;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    app = new Hono();
    app.route('/api/v1', apiRouter);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // 1. Owner Authentication & Session Security (Spec § 2 & § 3)
  describe('1. Owner Authentication & Session Security', () => {
    it('authenticates owner with valid key and generates authenticated session with cookie', async () => {
      process.env.OWNER_API_KEY = 'secret_owner_live_key_999';

      const res = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'secret_owner_live_key_999' })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.token).toMatch(/^sess_own_/);
      expect(json.data.principal_type).toBe('OWNER');
      expect(json.data.organization_id).toBe(OwnerAuthService.OWNER_ORGANIZATION_ID);

      const cookie = res.headers.get('set-cookie');
      expect(cookie).toContain('owner_session=');
      expect(cookie).toContain('HttpOnly');
    });

    it('rejects invalid owner credentials with 401', async () => {
      process.env.OWNER_API_KEY = 'correct_key_123';

      const res = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'wrong_key_999' })
      });

      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Invalid owner credentials/i);
    });

    it('validates active session and retrieves owner configuration', async () => {
      process.env.OWNER_API_KEY = 'secret_owner_live_key_999';
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1', 'Vitest');

      const res = await app.request('/api/v1/auth/owner/session', {
        headers: {
          'Authorization': `Bearer ${session.token}`
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.principal_type).toBe('OWNER');
      expect(json.data.owner_name).toBe('Harsha Vardhan Kotu');
    });

    it('logs out and revokes active session', async () => {
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1', 'Vitest');

      const logoutRes = await app.request('/api/v1/auth/owner/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.token}`
        }
      });
      expect(logoutRes.status).toBe(200);

      // Session should now be invalid
      const checkRes = await app.request('/api/v1/auth/owner/session', {
        headers: {
          'Authorization': `Bearer ${session.token}`
        }
      });
      expect(checkRes.status).toBe(401);
    });
  });

  // 2. Public Route Boundaries & Tenant Guard (Spec § 5 & § 29)
  describe('2. Public Route Boundaries & Tenant Guard', () => {
    it('keeps public lead and health endpoints open without owner auth', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'prod_secret_123';

      const healthRes = await app.request('/api/v1/health');
      expect(healthRes.status).toBe(200);

      const leadRes = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_test_live',
          customerName: 'Sanjay Reddy',
          customerPhone: '+91-99887-76655',
          utmSource: 'DIRECT'
        })
      });
      expect(leadRes.status).toBe(201);
    });

    it('rejects unauthenticated requests to owner-protected endpoints in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'prod_secret_123';

      // Attempt to access setup status without credentials
      const res = await app.request('/api/v1/setup/status');
      expect(res.status).toBe(401);

      // Attempt to access revenue proof without credentials
      const proofRes = await app.request('/api/v1/commercial/proof');
      expect(proofRes.status).toBe(401);
    });
  });

  // 3. Public Payment Order Creation & Tamper Resistance (Spec § 6 & § 7)
  describe('3. Public Payment Order Creation & Tamper Resistance', () => {
    it('creates authorized payment order for permitted deposit amount', async () => {
      const res = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          amountINR: 500,
          service: 'Initial Orthodontic Consultation'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.orderId).toBeDefined();
      expect(json.data.amountINR).toBe(500);
      expect(json.data.currency).toBe('INR');
    });

    it('strictly rejects tampered deposit amounts (e.g. changing ₹500 to ₹1)', async () => {
      const res = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          amountINR: 1, // Tamper attempt
          service: 'Consultation Deposit'
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/PAYMENT_TAMPER_DETECTED/i);
    });

    it('rejects order creation in production if Razorpay credentials are missing', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      const res = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          amountINR: 500
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toMatch(/CREDENTIAL_FAULT/i);
    });
  });

  // 4. Payment Verification Semantics & Business Ownership (Spec § 8 & § 22)
  describe('4. Payment Verification Semantics & Business Ownership', () => {
    it('verifies valid Razorpay HMAC signature and retrieves authoritative stored order', async () => {
      const razorpay = new RazorpayAdapter();
      const secret = 'test_secret_for_checkout_hmac';
      process.env.RAZORPAY_KEY_SECRET = secret;

      // 1. Create order
      const order = await razorpay.createPaymentOrder({
        businessId: 'biz_smilekraft_hyd',
        amountINR: 500,
        service: 'Consultation Deposit'
      });

      const paymentId = 'pay_real_prov_12345';
      const validSig = createHmac('sha256', secret)
        .update(`${order.orderId}|${paymentId}`)
        .digest('hex');

      // 2. Verify payment
      const res = await app.request('/api/v1/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          paymentId,
          signature: validSig,
          method: 'UPI'
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.amountINR).toBe(500);

      // Verify order status updated in DB
      const db = getDb();
      const updatedOrder = db.prepare('SELECT status, payment_id FROM payment_orders WHERE order_id = ?').get(order.orderId) as any;
      expect(updatedOrder.status).toBe('PAID');
      expect(updatedOrder.payment_id).toBe(paymentId);
    });

    it('strictly rejects forged or invalid payment signature', async () => {
      const razorpay = new RazorpayAdapter();
      const order = await razorpay.createPaymentOrder({
        businessId: 'biz_smilekraft_hyd',
        amountINR: 500
      });

      const res = await app.request('/api/v1/payments/razorpay/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          paymentId: 'pay_unauthorized_999',
          signature: 'invalid_forged_signature_000000',
          method: 'UPI'
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toMatch(/Invalid Razorpay payment signature/i);
    });
  });

  // 5. Manual UPI Claims & Owner Verification (Spec § 15, § 16, § 17, § 18)
  describe('5. Manual UPI Claims & Owner Verification', () => {
    it('customer submits UTR and registers claim as PAYMENT_CLAIMED (never verified revenue)', async () => {
      const res = await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          amountINR: 500,
          utr: '423589123456',
          serviceRendered: 'Consultation Deposit'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.status).toBe('PAYMENT_CLAIMED');
      expect(json.data.utr).toBe('423589123456');

      // Verify revenue ledger has NOT recorded this as REAL revenue
      const db = getDb();
      const realTx = db.prepare(`SELECT * FROM transactions WHERE transaction_ref = '423589123456'`).get();
      expect(realTx).toBeUndefined();
    });

    it('rejects fake, empty, or placeholder UTR (e.g. utr_179044...)', async () => {
      const res = await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          amountINR: 500,
          utr: 'utr_179044123456' // Auto-generated fake placeholder
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.error).toMatch(/INVALID_UTR/i);
    });

    it('owner certifies valid bank UTR and records HUMAN_VERIFIED_PAYMENT', async () => {
      const db = getDb();
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1');

      // Register claim first
      const claimRes = await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          amountINR: 500,
          utr: '987654321098'
        })
      });
      const claimData = (await claimRes.json() as any).data;

      // Owner confirms
      const confirmRes = await app.request('/api/v1/payments/manual-upi/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`
        },
        body: JSON.stringify({
          claimId: claimData.claimId,
          utr: '987654321098',
          businessId: 'biz_smilekraft_hyd',
          amountINR: 500
        })
      });

      expect(confirmRes.status).toBe(200);
      const json = await confirmRes.json() as any;
      expect(json.success).toBe(true);
      expect(json.classification).toBe('MANUAL_VERIFIED');
      expect(json.status).toBe('HUMAN_VERIFIED_PAYMENT');

      // Verified in ledger as MANUAL_VERIFIED
      const tx = db.prepare(`SELECT * FROM transactions WHERE transaction_ref = '987654321098'`).get() as any;
      expect(tx).toBeDefined();
      expect(tx.classification).toBe('MANUAL_VERIFIED');
    });
  });

  // 6. Razorpay UPI Payment Links & Provider Link Table (Spec § 11 & § 12)
  describe('6. Razorpay UPI Payment Links & Provider Link Table', () => {
    it('creates payment link and records in payment_provider_links table', async () => {
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1');

      const res = await app.request('/api/v1/payments/razorpay/create-payment-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`
        },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          amountINR: 15000,
          description: 'AI Inbound Lead Conversion System - 50% Upfront Setup',
          prospectId: 'prospect_dental_01'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.providerLinkId).toBeDefined();
      expect(json.data.shortUrl).toContain('https://rzp.io/');

      // Verify DB record in payment_provider_links
      const db = getDb();
      const linkRow = db.prepare('SELECT * FROM payment_provider_links WHERE id = ?').get(json.data.id) as any;
      expect(linkRow).toBeDefined();
      expect(linkRow.amount_inr).toBe(15000);
      expect(linkRow.status).toBe('CREATED');
    });
  });

  // 7. Setup Wizard Diagnostic & Commercial Proof (Spec § 48, § 57, § 58)
  describe('7. Setup Wizard Diagnostic & Commercial Proof', () => {
    it('GET /api/v1/setup/status returns complete checklist of required accounts and blocker diagnostics', async () => {
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1');

      const res = await app.request('/api/v1/setup/status', {
        headers: {
          'Authorization': `Bearer ${session.token}`
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.checklist).toBeDefined();
      expect(json.data.checklist.owner_auth).toBeDefined();
      expect(json.data.checklist.d1_storage).toBeDefined();
      expect(json.data.checklist.razorpay).toBeDefined();
      expect(json.data.what_can_run_now.length).toBeGreaterThan(0);
      expect(json.data.what_is_blocked.length).toBeGreaterThan(0);
    });

    it('POST /api/v1/setup/live-smoke-test performs safe non-destructive checks', async () => {
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1');

      const res = await app.request('/api/v1/setup/live-smoke-test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.token}`
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.checks.owner_auth.pass).toBe(true);
      expect(json.checks.local_sqlite.pass).toBe(true);
    });

    it('GET /api/v1/commercial/proof exposes truthful commercial audit with ₹0 unverified revenue', async () => {
      const ownerAuth = OwnerAuthService.getInstance();
      const session = ownerAuth.createSession('127.0.0.1');

      const res = await app.request('/api/v1/commercial/proof', {
        headers: {
          'Authorization': `Bearer ${session.token}`
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.software_ready).toBe(true);
      expect(json.data.autonomy_ready).toBe(true);
      expect(json.data.commercial_ready).toBe(true);
      expect(json.data.verified_payments).toBe(0);
      expect(json.data.verified_customers).toBe(0);
      expect(json.data.verified_platform_revenue).toBe(0);
      expect(json.data.verified_client_revenue).toBe(0);
      expect(json.data.current_blocker).toBe('AUTHORIZED_OUTBOUND_MISSING');
    });
  });

  // 8. D1 Production Persistence Assertion (Spec § 37)
  describe('8. D1 Production Persistence Assertion', () => {
    it('halts irreversible external commercial actions in production if D1 is not configured', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CLOUDFLARE_D1_DATABASE_ID;
      delete process.env.CLOUDFLARE_D1_API_TOKEN;

      const actionManager = FirstLiveCommercialActionManager.getInstance();
      const result = await actionManager.executeFirstOutbound({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        opportunityId: 'opp_prod_fail_01',
        sequenceStep: 1,
        channel: 'WHATSAPP',
        recipientName: 'Dr. Rao',
        businessName: 'Rao Dental Clinic',
        observedPainPoint: 'Speed to lead on weekends',
        proposedOutcome: '5x faster after-hours qualification',
        messageText: 'Hello Dr. Rao, quick question about weekend inquiries.',
        purpose: 'INITIAL_OUTREACH'
      });

      expect(result.executed).toBe(false);
      expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
      expect(result.reason).toMatch(/PERSISTENCE_FAULT/i);
    });
  });

  // 9. Full Simulated Commercial Closed-Loop (Spec § 56)
  describe('9. Full Simulated Commercial Closed-Loop Test', () => {
    it('executes full sequence from prospect to delivery strictly tagged as TEST with ₹0 real revenue', async () => {
      const db = getDb();
      const proposalEngine = ProposalEngine.getInstance();
      const blueprintManager = DeliveryBlueprintManager.getInstance();

      db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Primary Owner Org', 'owner-org')`).run();
      db.prepare(`
        INSERT OR IGNORE INTO businesses (
          id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice
        ) VALUES ('biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'TECH', 'Technology', 'Bangalore', 'Koramangala', 'Professional')
      `).run();
      db.prepare(`INSERT OR IGNORE INTO customer_journeys (id, organization_id, business_id, visitor_id, stage, classification) VALUES ('sim_journey_01', 'org_owner_primary', 'biz_platform_aro', 'vis_01', 'PROPOSAL', 'TEST')`).run();

      // 1. Prospect -> Proposal
      const proposal = proposalEngine.createProposal({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        prospectId: 'sim_prospect_01',
        title: 'AI Inbound Lead Conversion System',
        customerProblem: 'High lead drop-off after clinic closing hours',
        proposedSolution: 'Automated 24/7 WhatsApp AI triage and appointment booking',
        deliverables: ['Custom WhatsApp Knowledge Base', 'Direct Google Calendar Booking', 'Staff Alert Webhook'],
        setupPriceINR: 15000,
        monthlyPriceINR: 8000
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.setupPriceINR).toBe(15000);

      // 2. Proposal Accepted
      const acceptRes = proposalEngine.acceptProposal(proposal.id);
      expect(acceptRes.proposal.status).toBe('ACCEPTED');

      // 3. Simulated Payment in test mode
      const tx = db.prepare(`
        INSERT INTO transactions (
          id, business_id, organization_id, invoice_number, amount_inr,
          payment_method, payment_gateway, transaction_ref, status, classification,
          service_rendered, created_at
        ) VALUES ('tx_sim_01', 'biz_platform_aro', 'org_owner_primary', 'INV-SIM-01', 15000, 'UPI', 'RAZORPAY', 'pay_sim_01', 'SUCCESS', 'TEST', 'Simulated Setup Fee', datetime('now'))
      `).run();

      // 4. Delivery Blueprint Initiation & Customer Outcome
      const blueprint = blueprintManager.get5DayBlueprint();
      expect(blueprint.length).toBe(6);
      expect(blueprint[0].day).toBe(0);

      const completedOutcome = blueprintManager.recordCustomerResult({
        customerJourneyId: 'sim_journey_01',
        businessId: 'biz_platform_aro',
        organizationId: 'org_owner_primary',
        inboundLeads: 120,
        sub2MinResponses: 118,
        appointmentsBooked: 24,
        appointmentsAttended: 20,
        customersClosed: 8,
        customerBusinessRevenueINR: 120000,
        platformRevenueINR: 0,
        averageResponseSeconds: 45
      });

      expect(completedOutcome.appointmentsBooked).toBe(24);
      expect(completedOutcome.customerBusinessRevenueINR).toBe(120000);

      // 5. Audit Check: Real verified revenue remains strictly ₹0
      const verifiedRealRevenue = db.prepare(`
        SELECT COALESCE(SUM(amount_inr), 0) as total
        FROM transactions
        WHERE classification = 'REAL'
      `).get() as any;

      expect(verifiedRealRevenue.total).toBe(0);
    });
  });
});
