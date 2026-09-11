import { describe, it, expect, beforeEach } from 'vitest';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { CustomerJourneyTracker } from '../../src/revenue/customer-journey-tracker.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Revenue Integrity & Anti-Pollution Audit (Requirement 27)', () => {
  let engine: RevenueReconciliationEngine;
  let tracker: CustomerJourneyTracker;
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    engine = new RevenueReconciliationEngine();
    tracker = new CustomerJourneyTracker();
  });

  it('strictly isolates REAL, TEST, and SIMULATED revenue from polluting each other', () => {
    // 1. Initial baseline: Real revenue is strictly 0
    let summary = engine.getRevenueSummary(businessId);
    expect(summary.realRevenueINR).toBe(0);

    // 2. Ingest ₹1,00,000 SIMULATED revenue
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-SIM-001',
      amountINR: 100000,
      paymentMethod: 'UPI',
      classification: 'SIMULATED',
      serviceRendered: 'Simulated 10 Patient Implants',
    });

    summary = engine.getRevenueSummary(businessId);
    // Real revenue MUST remain 0 - zero synthetic pollution
    expect(summary.realRevenueINR).toBe(0);
    expect(summary.simulatedRevenueINR).toBe(100000);

    // 3. Ingest ₹50,000 TEST sandbox revenue
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-TEST-002',
      amountINR: 50000,
      paymentMethod: 'NO_COST_EMI',
      classification: 'TEST',
      serviceRendered: 'Staging Environment Test Consultation',
    });

    summary = engine.getRevenueSummary(businessId);
    // Real revenue MUST still remain 0
    expect(summary.realRevenueINR).toBe(0);
    expect(summary.testRevenueINR).toBeGreaterThanOrEqual(123000); // 73k seed + 50k
    expect(summary.simulatedRevenueINR).toBe(100000);

    // 4. Ingest verified REAL revenue
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-REAL-001',
      amountINR: 45000,
      paymentMethod: 'UPI',
      paymentGateway: 'RAZORPAY',
      transactionRef: 'pay_rzp_live_real_01',
      classification: 'REAL',
      serviceRendered: 'Patient Clear Aligner Full Arch - Clinic Collection',
    });

    summary = engine.getRevenueSummary(businessId);
    // Real revenue now exactly 45,000 without any test or simulated numbers added into it
    expect(summary.realRevenueINR).toBe(45000);
    expect(summary.testRevenueINR).toBeGreaterThanOrEqual(123000);
    expect(summary.simulatedRevenueINR).toBe(100000);
  });

  it('rejects duplicate transactions with identical invoice numbers', () => {
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-DUP-TEST-01',
      amountINR: 15000,
      paymentMethod: 'UPI',
      classification: 'TEST',
    });

    // Attempting to record same invoice number again must throw and be rejected
    expect(() => {
      engine.recordTransaction({
        businessId,
        organizationId: orgId,
        invoiceNumber: 'INV-DUP-TEST-01',
        amountINR: 15000,
        paymentMethod: 'UPI',
        classification: 'TEST',
      });
    }).toThrow(/Duplicate transaction: Invoice INV-DUP-TEST-01 already exists/);
  });

  it('rejects duplicate payment references (preventing replay attacks)', () => {
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-REF-01',
      amountINR: 20000,
      paymentMethod: 'UPI',
      transactionRef: 'upi_unique_utr_998811',
      classification: 'REAL',
    });

    expect(() => {
      engine.recordTransaction({
        businessId,
        organizationId: orgId,
        invoiceNumber: 'INV-REF-02',
        amountINR: 20000,
        paymentMethod: 'UPI',
        transactionRef: 'upi_unique_utr_998811', // Replayed reference
        classification: 'REAL',
      });
    }).toThrow(/Duplicate transaction: Reference upi_unique_utr_998811 already recorded/);
  });

  it('processes refund correctly and decrements customer journey lifetime value', () => {
    // 1. Create journey and transaction
    const journey = tracker.recordTouchpoint({
      businessId,
      organizationId: orgId,
      visitorId: 'vis_refund_patient',
      channel: 'WHATSAPP',
      event: 'whatsapp_consultation',
      classification: 'REAL',
    });

    const tx = engine.recordTransaction({
      businessId,
      organizationId: orgId,
      journeyId: journey.id,
      invoiceNumber: 'INV-REFUNDABLE-01',
      amountINR: 28000,
      paymentMethod: 'CREDIT_CARD',
      classification: 'REAL',
      serviceRendered: 'Titanium Single Implant',
    });

    const db = getDb();
    let journeyInDb = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(journey.id) as any;
    expect(journeyInDb.total_lifetime_value_inr).toBe(28000);

    // 2. Issue refund
    const refunded = engine.refundTransaction(businessId, tx.id, 'Patient opted for alternative procedure before surgery');
    expect(refunded.status).toBe('REFUNDED');

    journeyInDb = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(journey.id) as any;
    expect(journeyInDb.total_lifetime_value_inr).toBe(0);

    // 3. Status is excluded from active revenue calculations
    const summary = engine.getRevenueSummary(businessId);
    expect(summary.realRevenueINR).toBe(0); // Refunded transactions do not count towards active revenue
  });

  it('records verified manual revenue with audit log and verification source', () => {
    const tx = engine.recordVerifiedManualRevenue({
      businessId,
      organizationId: orgId,
      verifiedByUserId: 'usr_owner_01',
      invoiceNumber: 'INV-AUDIT-VERIFIED-01',
      amountINR: 35000,
      paymentMethod: 'NETBANKING',
      transactionRef: 'NEFT-HDFC-99218274',
      verificationSource: 'BANK_STATEMENT',
      serviceRendered: 'Full Mouth Scaling & Aesthetic Veneers',
    });

    expect(tx.id).toBeTruthy();
    expect(tx.classification).toBe('REAL');

    // Verify audit log entry
    const db = getDb();
    const audit = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ?').get(tx.id) as any;
    expect(audit).toBeDefined();
    expect(audit.action).toBe('VERIFIED_REVENUE_ENTRY');
    const details = JSON.parse(audit.details_json);
    expect(details.verificationSource).toBe('BANK_STATEMENT');
  });
});
