import { describe, it, expect, beforeEach } from 'vitest';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { CustomerJourneyTracker } from '../../src/revenue/customer-journey-tracker.js';
import { MemoryStore } from '../../src/memory/memory-store.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Tenant Security & Isolation Audit (Requirement 28)', () => {
  const bizA = 'biz_smilekraft_hyd';
  const orgA = 'org_smilekraft_01';

  const bizB = 'biz_apex_ortho_blr';
  const orgB = 'org_apex_02';

  let revenueEngine: RevenueReconciliationEngine;
  let journeyTracker: CustomerJourneyTracker;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();

    const db = getDb();
    // Seed second tenant: Business B (Apex Orthodontics Bangalore)
    db.prepare(`
      INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)
    `).run(orgB, 'Apex Healthcare Bangalore', 'apex-blr');

    db.prepare(`
      INSERT INTO businesses (
        id, organization_id, name, vertical_id, vertical_name, risk_tier,
        country, currency, timezone, city, neighborhood, primary_language,
        brand_voice, autonomy_mode
      ) VALUES (?, ?, ?, 'HEALTHCARE_DENTAL', 'Dental Care', 'MEDIUM', 'IN', 'INR', 'Asia/Kolkata', 'Bangalore', 'Indiranagar', 'English', 'Professional', 'ASSISTED')
    `).run(bizB, orgB, 'Apex Ortho Bangalore');

    revenueEngine = new RevenueReconciliationEngine();
    journeyTracker = new CustomerJourneyTracker();
    memoryStore = new MemoryStore();
  });

  it('verifies Business A cannot access or see Business B revenue or transactions', () => {
    // 1. Record transaction for Business B (₹1,50,000 REAL)
    revenueEngine.recordTransaction({
      businessId: bizB,
      organizationId: orgB,
      invoiceNumber: 'INV-BIZ-B-001',
      amountINR: 150000,
      paymentMethod: 'NETBANKING',
      classification: 'REAL',
      serviceRendered: 'Apex Bangalore Orthodontic Surgery',
    });

    // 2. Query revenue summary for Business A
    const summaryA = revenueEngine.getRevenueSummary(bizA);
    // Must NOT contain Business B's ₹1,50,000!
    expect(summaryA.realRevenueINR).toBe(0);

    // 3. Query revenue summary for Business B
    const summaryB = revenueEngine.getRevenueSummary(bizB);
    expect(summaryB.realRevenueINR).toBe(150000);

    // 4. List transactions for Business A
    const txsA = revenueEngine.listTransactions(bizA);
    expect(txsA.some((t) => t.invoiceNumber === 'INV-BIZ-B-001')).toBe(false);

    // 5. List transactions for Business B
    const txsB = revenueEngine.listTransactions(bizB);
    expect(txsB.length).toBe(1);
    expect(txsB[0].invoiceNumber).toBe('INV-BIZ-B-001');
  });

  it('verifies customer journeys and patient PII are completely isolated across businesses', () => {
    // 1. Create patient journey in Business B
    const journeyB = journeyTracker.recordTouchpoint({
      businessId: bizB,
      organizationId: orgB,
      visitorId: 'vis_blr_patient_01',
      channel: 'INSTAGRAM',
      event: 'instagram_direct_message',
      classification: 'REAL',
    });

    journeyTracker.advanceStage({
      businessId: bizB,
      visitorId: 'vis_blr_patient_01',
      targetStage: 'LEAD',
      customerName: 'Sanjay Hegde (Bangalore Patient)',
      customerPhone: '+91-98800-11223',
    });

    // 2. Query journeys from Business A perspective
    const journeysA = journeyTracker.listJourneys(bizA);
    const hasPatientB = journeysA.some((j) => j.visitorId === 'vis_blr_patient_01' || j.customerName?.includes('Sanjay Hegde'));
    expect(hasPatientB).toBe(false);

    // 3. Funnel counts are partitioned
    const funnelA = journeyTracker.getJourneyFunnel(bizA);
    const funnelB = journeyTracker.getJourneyFunnel(bizB);
    expect(funnelB.LEAD).toBe(1);
    expect(funnelA.LEAD).toBe(0); // Business A has no un-advanced leads in this test run
  });

  it('verifies AI memory items respect tenant boundaries', () => {
    // 1. Store strategic competitor intel for Business A
    memoryStore.set(
      orgA,
      bizA,
      'BUSINESS',
      'competitor_pricing_secrets',
      { bannedDiscount: 'Never offer >10% discount in Banjara Hills' }
    );

    // 2. Store distinct memory for Business B
    memoryStore.set(
      orgB,
      bizB,
      'BUSINESS',
      'competitor_pricing_secrets',
      { aggressivePricing: 'Offer ₹5,000 launch credit in Indiranagar' }
    );

    // 3. Retrieve memory for Business A
    const memA = memoryStore.get<any>(bizA, 'BUSINESS', 'competitor_pricing_secrets');
    expect(memA?.bannedDiscount).toBe('Never offer >10% discount in Banjara Hills');

    // 4. Retrieve memory for Business B
    const memB = memoryStore.get<any>(bizB, 'BUSINESS', 'competitor_pricing_secrets');
    expect(memB?.aggressivePricing).toBe('Offer ₹5,000 launch credit in Indiranagar');
    expect(memB?.bannedDiscount).toBeUndefined();
  });
});
