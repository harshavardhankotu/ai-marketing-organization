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

  it('rejects recording REAL manual revenue by non-owner or script (Single Trusted Authority)', () => {
    expect(() => {
      engine.recordVerifiedManualRevenue({
        businessId,
        organizationId: orgId,
        verifiedByUserId: 'usr_floki_test_harness', // Non-owner user
        invoiceNumber: 'INV-UNAUTH-AUDIT-01',
        amountINR: 45000,
        paymentMethod: 'UPI',
        transactionRef: 'UPI-UNAUTH-001',
        verificationSource: 'BANK_STATEMENT',
      });
    }).toThrow(/Unauthorized: Only an authenticated clinic OWNER can certify REAL revenue/);
  });

  it('rejects recording REAL revenue against a TEST customer journey (Anti-Cross-Contamination)', () => {
    // 1. Create a TEST journey
    const testJourney = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Test Patient',
      customerPhone: '+91 99999 11111',
      customerEmail: 'patient@example.com',
      channel: 'WHATSAPP',
      classification: 'TEST',
    });
    expect(testJourney.classification).toBe('TEST');

    // 2. Owner attempting to attach REAL revenue to a TEST journey must be rejected
    expect(() => {
      engine.recordVerifiedManualRevenue({
        businessId,
        organizationId: orgId,
        verifiedByUserId: 'usr_owner_01',
        invoiceNumber: 'INV-CROSS-ATTEMPT-01',
        amountINR: 45000,
        paymentMethod: 'UPI',
        transactionRef: 'UPI-CROSS-REF-001',
        verificationSource: 'BANK_STATEMENT',
        journeyId: testJourney.id,
      });
    }).toThrow(/Cannot record REAL revenue against a TEST customer journey/);
  });

  it('strictly separates marketing-attributed real revenue from unattributed real revenue and calculates verified ROAS only on attributed revenue', () => {
    // 1. Unattributed Real Walk-in Transaction (₹40,000)
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-WALKIN-01',
      amountINR: 40000,
      paymentMethod: 'CASH',
      paymentGateway: 'MANUAL',
      classification: 'REAL',
      serviceRendered: 'Emergency Walk-in Root Canal Treatment',
    });

    // 2. Marketing-Attributed Real Transaction (₹45,000 linked to campaign)
    engine.recordTransaction({
      businessId,
      organizationId: orgId,
      campaignId: 'camp_seed_aligners_01',
      invoiceNumber: 'INV-CAMP-ATTR-01',
      amountINR: 45000,
      paymentMethod: 'UPI',
      paymentGateway: 'RAZORPAY',
      transactionRef: 'pay_rzp_camp_01',
      classification: 'REAL',
      serviceRendered: 'Clear Aligners via WhatsApp Campaign',
    });

    const summary = engine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(85000);
    expect(summary.realMarketingAttributedRevenueINR).toBe(45000);
    expect(summary.unattributedRealRevenueINR).toBe(40000);

    // ROAS must be computed strictly as realMarketingAttributedRevenueINR / marketingSpendINR
    // Total ad spend is ₹21,300 from seed campaigns (12,400 + 8,900)
    expect(summary.marketingSpendINR).toBe(21300);
    expect(summary.verifiedRoas).toBe(2.11); // 45,000 / 21,300 = 2.11x (NOT 85,000 / 21,300 = 3.99x)
    expect(summary.roas).toBe(2.11);
  });

  it('automatically classifies synthetic email domains as TEST and prevents escalation', () => {
    const lead = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Kavita Synthetic',
      customerPhone: '+91 94401 12345',
      customerEmail: 'kavita.999@hyderabad-tech.example', // .example synthetic domain
      channel: 'WHATSAPP',
    });

    expect(lead.classification).toBe('TEST');

    // Attempting to advance stage with REAL classification on a TEST journey must throw
    expect(() => {
      tracker.advanceStage({
        businessId,
        visitorId: lead.visitorId,
        targetStage: 'OPPORTUNITY',
        classification: 'REAL',
      });
    }).toThrow(/Anti-Escalation Violation: Cannot escalate TEST customer journey to REAL/);
  });
});
