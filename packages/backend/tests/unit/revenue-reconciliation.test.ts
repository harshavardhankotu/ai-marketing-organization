import { describe, it, expect, beforeEach } from 'vitest';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Revenue Reconciliation Engine Unit Tests', () => {
  let engine: RevenueReconciliationEngine;
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    engine = new RevenueReconciliationEngine();
  });

  it('records transactions and updates summary strictly isolating modes', () => {
    // 1. Record TEST transaction
    const testTx = engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-TEST-991',
      amountINR: 15000,
      paymentMethod: 'UPI',
      paymentGateway: 'PHONEPE_PG',
      classification: 'TEST',
      serviceRendered: 'Laser Teeth Whitening Package',
    });

    expect(testTx.id).toBeTruthy();
    expect(testTx.amountINR).toBe(15000);
    expect(testTx.classification).toBe('TEST');

    // 2. Record REAL transaction
    const realTx = engine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-REAL-101',
      amountINR: 50000,
      paymentMethod: 'NO_COST_EMI',
      paymentGateway: 'RAZORPAY',
      classification: 'REAL',
      serviceRendered: 'Clear Aligners Full Arch',
    });

    expect(realTx.classification).toBe('REAL');

    // 3. Verify Revenue Summary isolation
    const summary = engine.getRevenueSummary(businessId);
    expect(summary.realRevenueINR).toBe(50000);
    expect(summary.testRevenueINR).toBeGreaterThanOrEqual(73000 + 15000); // seed (45000 + 28000) + 15000
    expect(summary.simulatedRevenueINR).toBe(0);
    expect(summary.totalTransactions).toBeGreaterThanOrEqual(4);
  });

  it('lists transactions filtered by classification', () => {
    const testTxs = engine.listTransactions(businessId, { classification: 'TEST' });
    expect(testTxs.length).toBeGreaterThan(0);
    expect(testTxs.every((t) => t.classification === 'TEST')).toBe(true);
  });
});
