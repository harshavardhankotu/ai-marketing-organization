import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { DPDPComplianceManager } from '../../src/compliance/dpdp-manager.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Razorpay Automated Payment Gateway & DPDP Compliance Suite', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';
  const testSecret = 'test_webhook_secret_xyz123';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  describe('1. Razorpay HMAC-SHA256 Cryptographic Verification', () => {
    const adapter = new RazorpayAdapter();

    it('verifies an authentic HMAC-SHA256 signature from Razorpay', () => {
      const payload = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_rzp_test_1001', amount: 4500000 } } }
      });
      const validSignature = createHmac('sha256', testSecret).update(payload).digest('hex');

      const result = adapter.verifyWebhookSignature(payload, validSignature, testSecret);
      expect(result).toBe(true);
    });

    it('rejects a forged or tampered signature (anti-spoofing)', () => {
      const payload = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_rzp_test_1001', amount: 4500000 } } }
      });
      const forgedSignature = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      const result = adapter.verifyWebhookSignature(payload, forgedSignature, testSecret);
      expect(result).toBe(false);
    });
  });

  describe('2. Automated Payment Processing & Real Ledger Booking', () => {
    const adapter = new RazorpayAdapter();

    it('processes payment.captured and automatically books verified REAL revenue', async () => {
      const db = getDb();

      // Create patient journey in OPPORTUNITY stage
      const journeyId = 'journey_rzp_test_patient_01';
      db.prepare(`
        INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id, customer_name, customer_phone,
          stage, first_touch_channel, last_touch_channel, touchpoints_json,
          total_lifetime_value_inr, classification, created_at, updated_at
        ) VALUES (?, ?, ?, 'vis_rzp_01', 'Ankit Verma', '+919876543210',
          'OPPORTUNITY', 'GOOGLE_BUSINESS_PROFILE', 'WHATSAPP', '[]',
          0, 'REAL', datetime('now'), datetime('now'))
      `).run(journeyId, orgId, businessId);

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_autobook_998',
              amount: 4500000, // ₹45,000 in paise
              currency: 'INR',
              status: 'captured',
              order_id: 'order_rzp_plan_45k',
              method: 'upi',
              description: 'Clear Aligners Down Payment',
              notes: {
                business_id: businessId,
                journey_id: journeyId,
                invoice_number: 'INV-RZP-2026-AUTOPAY',
                service: 'Invisible Clear Aligners - Phase 1'
              }
            }
          }
        }
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = createHmac('sha256', testSecret).update(rawBody).digest('hex');

      const res = await adapter.processWebhook({
        rawBody,
        signature,
        event: eventPayload,
        overrideSecret: testSecret,
      });

      expect(res.processed).toBe(true);
      expect(res.amountINR).toBe(45000);
      expect(res.journeyId).toBe(journeyId);

      // Verify transaction entered ledger with REAL classification
      const tx = db.prepare('SELECT * FROM transactions WHERE transaction_ref = ?').get('pay_rzp_autobook_998') as any;
      expect(tx).toBeTruthy();
      expect(tx.amount_inr).toBe(45000);
      expect(tx.classification).toBe('REAL');
      expect(tx.payment_gateway).toBe('RAZORPAY');
      expect(tx.payment_method).toBe('UPI');

      // Verify Customer Journey stage was elevated to CUSTOMER
      const updatedJourney = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(journeyId) as any;
      expect(updatedJourney.stage).toBe('CUSTOMER');
    });

    it('enforces idempotency and suppresses duplicate ledger entries on replayed webhooks', async () => {
      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_idempotent_112',
              amount: 2000000,
              currency: 'INR',
              status: 'captured',
              method: 'upi',
              notes: {
                business_id: businessId,
                invoice_number: 'INV-IDEM-001',
              }
            }
          }
        }
      };

      const rawBody = JSON.stringify(eventPayload);
      const signature = createHmac('sha256', testSecret).update(rawBody).digest('hex');

      // First delivery
      const first = await adapter.processWebhook({ rawBody, signature, event: eventPayload, overrideSecret: testSecret });
      expect(first.processed).toBe(true);

      // Replayed delivery (e.g. gateway retry)
      const second = await adapter.processWebhook({ rawBody, signature, event: eventPayload, overrideSecret: testSecret });
      expect(second.processed).toBe(true);
      expect(second.reason).toContain('already processed');

      const db = getDb();
      const txCount = db.prepare("SELECT COUNT(*) as cnt FROM transactions WHERE transaction_ref = 'pay_rzp_idempotent_112'").get() as any;
      expect(txCount.cnt).toBe(1); // Exactly 1 ledger entry
    });

    it('creates payment order, verifies checkout signature, and confirms patient deposit', async () => {
      const order = await adapter.createPaymentOrder({
        businessId,
        journeyId: 'journey-961c351f-71d2-4d7b-a842-b6858984b288',
        amountINR: 500,
        receipt: 'rcpt_test_consultation_001',
        notes: { patient: 'Suresh Reddy', service: 'Consultation Deposit' }
      });

      expect(order.orderId).toBeTruthy();
      expect(order.amountINR).toBe(500);

      const testKeySecret = 'test_checkout_secret_abc123';
      const paymentId = 'pay_checkout_verified_001';
      const validSig = createHmac('sha256', testKeySecret).update(`${order.orderId}|${paymentId}`).digest('hex');

      // Verify signature helper
      expect(adapter.verifyPaymentSignature(order.orderId, paymentId, validSig, testKeySecret)).toBe(true);
      expect(adapter.verifyPaymentSignature(order.orderId, paymentId, 'invalid_sig', testKeySecret)).toBe(false);

      // Confirm client payment
      const confirmed = await adapter.confirmClientPayment({
        orderId: order.orderId,
        paymentId,
        signature: validSig,
        businessId,
        journeyId: 'journey-961c351f-71d2-4d7b-a842-b6858984b288',
        secret: testKeySecret
      });

      expect(confirmed.success).toBe(true);
      expect(confirmed.amountINR).toBe(500);

      const db = getDb();
      const tx = db.prepare('SELECT * FROM transactions WHERE transaction_ref = ?').get(paymentId) as any;
      expect(tx).toBeTruthy();
      expect(tx.amount_inr).toBe(500);
      expect(tx.classification).toBe('REAL');
      expect(tx.payment_gateway).toBe('RAZORPAY');

      // Idempotency: reconfirming same payment returns success without duplicating transaction
      const duplicateConfirm = await adapter.confirmClientPayment({
        orderId: order.orderId,
        paymentId,
        signature: validSig,
        businessId,
        secret: testKeySecret
      });
      expect(duplicateConfirm.success).toBe(true);
      const totalTx = db.prepare("SELECT COUNT(*) as count FROM transactions WHERE transaction_ref = ?").get(paymentId) as any;
      expect(totalTx.count).toBe(1);
    });
  });

  describe('3. DPDP Act 2023 Digital Patient Consent & Section 12 Erasure', () => {
    const dpdp = new DPDPComplianceManager();

    it('records and verifies itemized digital patient consent', () => {
      const consent = dpdp.recordConsent({
        businessId,
        journeyId: 'journey_dpdp_test_01',
        customerName: 'Meera Nambiar',
        customerPhone: '+91-98765-11223',
        ipAddress: '157.48.12.90',
        purpose: 'Orthodontic consultation coordination at SmileKraft Banjara Hills',
        consentVersion: '2026.1'
      });

      expect(consent.id).toBeTruthy();
      expect(consent.status).toBe('ACTIVE');
      expect(consent.customerName).toBe('Meera Nambiar');

      const retrieved = dpdp.getConsent('+91-98765-11223');
      expect(retrieved).toBeTruthy();
      expect(retrieved?.purpose).toContain('Orthodontic consultation');
    });

    it('implements Section 12 Right to Erasure: anonymizes personal data while preserving tax ledgers', () => {
      const db = getDb();
      const journeyId = 'journey_erasure_test_01';
      const phone = '+919988776655';

      // Seed journey and consent
      db.prepare(`
        INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id, customer_name, customer_phone,
          stage, first_touch_channel, last_touch_channel, touchpoints_json,
          total_lifetime_value_inr, classification, created_at, updated_at
        ) VALUES (?, ?, ?, 'vis_erasure_01', 'Rahul Dravid', ?,
          'CUSTOMER', 'WHATSAPP', 'WHATSAPP', '[]', 25000, 'REAL', datetime('now'), datetime('now'))
      `).run(journeyId, orgId, businessId, phone);

      db.prepare(`
        INSERT INTO appointments (
          id, journey_id, business_id, patient_name, appointment_date, service,
          clinic_location, clinic_confirmation, confirmation_timestamp, created_at, updated_at
        ) VALUES ('appt_erasure_01', ?, ?, 'Rahul Dravid', '2026-09-25T10:00:00Z',
          'Aligners Consultation', 'SmileKraft Banjara Hills', 'CONFIRMED', datetime('now'), datetime('now'), datetime('now'))
      `).run(journeyId, businessId);

      // Seed statutory financial transaction
      db.prepare(`
        INSERT INTO transactions (
          id, organization_id, business_id, journey_id, invoice_number, amount_inr,
          payment_method, payment_gateway, transaction_ref, status, classification,
          service_rendered, created_at
        ) VALUES ('tx_erasure_01', ?, ?, ?, 'INV-ERASE-001', 25000,
          'UPI', 'RAZORPAY', 'pay_statutory_tax_01', 'SUCCESS', 'REAL',
          'Aligner Treatment Down Payment', datetime('now'))
      `).run(orgId, businessId, journeyId);

      dpdp.recordConsent({
        businessId,
        journeyId,
        customerName: 'Rahul Dravid',
        customerPhone: phone,
        purpose: 'Dental treatment',
      });

      // Execute Section 12 Erasure Request
      const erasureResult = dpdp.requestErasure({
        businessId,
        phoneOrJourneyId: phone,
        reason: 'Patient exercised DPDP Section 12 Right to Erasure'
      });

      expect(erasureResult.success).toBe(true);
      expect(erasureResult.anonymizedRecordsCount).toBe(1);
      expect(erasureResult.financialRecordsPreservedCount).toBe(1);

      // Verify personal identity is anonymized
      const anonymizedJourney = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(journeyId) as any;
      expect(anonymizedJourney.customer_name).toContain('Anonymized Patient');
      expect(anonymizedJourney.customer_phone).toBeNull();
      expect(anonymizedJourney.customer_email).toBeNull();

      // Verify appointment patient name is anonymized
      const anonymizedAppt = db.prepare('SELECT * FROM appointments WHERE journey_id = ?').get(journeyId) as any;
      expect(anonymizedAppt.patient_name).toContain('Anonymized Patient');

      // Verify statutory transaction ledger is preserved
      const preservedTx = db.prepare('SELECT * FROM transactions WHERE id = ?').get('tx_erasure_01') as any;
      expect(preservedTx).toBeTruthy();
      expect(preservedTx.amount_inr).toBe(25000);
      expect(preservedTx.status).toBe('SUCCESS');
    });
  });
});
