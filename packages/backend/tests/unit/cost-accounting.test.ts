import { describe, it, expect, beforeEach } from 'vitest';
import { CostAccountingEngine } from '../../src/revenue/cost-accounting.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('AI Cost Accounting Engine Unit Tests', () => {
  let engine: CostAccountingEngine;
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    engine = new CostAccountingEngine();
  });

  it('calculates nominal token costs accurately in INR', () => {
    // 1000 input tokens = ₹0.06, 1000 output tokens = ₹0.24 -> Total = ₹0.30
    const cost = engine.calculateEstimatedCostINR(1000, 1000);
    expect(cost).toBe(0.30);
  });

  it('logs AI cost and computes division breakdown', () => {
    const log = engine.logCost({
      organizationId: orgId,
      businessId,
      agentId: 'agt_test_writer',
      division: 'CONTENT',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'low',
      inputTokens: 2000,
      outputTokens: 500,
      latencyMs: 320,
      purpose: 'Generate local dental clinic WhatsApp teaser',
    });

    expect(log.id).toBeTruthy();
    expect(log.totalTokens).toBe(2500);
    expect(log.estimatedCostINR).toBeGreaterThan(0);

    const summary = engine.getCostSummary(businessId);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(summary.totalCostINR).toBeGreaterThan(0);
    expect(summary.divisionBreakdown).toHaveProperty('CONTENT');
  });
});
