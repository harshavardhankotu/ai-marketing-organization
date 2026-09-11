import { describe, it, expect, beforeEach } from 'vitest';
import { CustomerJourneyTracker } from '../../src/revenue/customer-journey-tracker.js';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { CostAccountingEngine } from '../../src/revenue/cost-accounting.js';
import { AttributionEngine } from '../../src/analytics/attribution-engine.js';
import { ExperimentEngine } from '../../src/experiments/experiment-engine.js';
import { LearningManager } from '../../src/control-plane/learning-manager.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Autonomous Revenue Closed-Loop E2E Verification', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';
  const goalId = 'goal_100_leads_hyd';
  const campaignId = 'camp_seed_aligners_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  it('runs complete lifecycle: Visitor -> Lead -> Consultation -> INR Payment -> Attribution -> Learning -> Strategy Evolution', async () => {
    const journeyTracker = new CustomerJourneyTracker();
    const revenueEngine = new RevenueReconciliationEngine();
    const costAccounting = new CostAccountingEngine();

    // 1. Visitor arrives via Meta Ad campaign in Hyderabad
    const visitorId = 'vis_e2e_closed_loop_01';
    const j1 = journeyTracker.recordTouchpoint({
      businessId,
      organizationId: orgId,
      visitorId,
      channel: 'META_ADS',
      event: 'meta_ad_click_gachibowli',
      campaignId,
      classification: 'TEST',
    });
    expect(j1.stage).toBe('SESSION');
    expect(j1.firstTouchChannel).toBe('META_ADS');

    // 2. Multi-touch interaction: User reaches out on WhatsApp
    const j2 = journeyTracker.recordTouchpoint({
      businessId,
      organizationId: orgId,
      visitorId,
      channel: 'WHATSAPP',
      event: 'whatsapp_pricing_inquiry',
      campaignId,
      classification: 'TEST',
    });
    expect(j2.stage).toBe('LEAD');
    expect(j2.lastTouchChannel).toBe('WHATSAPP');

    // 3. Lead is qualified: Booked 3D digital scan consultation
    const j3 = journeyTracker.advanceStage({
      businessId,
      visitorId,
      targetStage: 'QUALIFIED_LEAD',
      customerName: 'Kavita Chawla',
      customerPhone: '+91-98111-22334',
      customerEmail: 'kavita.c@gmail.com',
    });
    expect(j3.stage).toBe('QUALIFIED_LEAD');

    // 4. In-clinic consultation occurs -> Opportunity
    const j4 = journeyTracker.advanceStage({
      businessId,
      visitorId,
      targetStage: 'OPPORTUNITY',
    });
    expect(j4.stage).toBe('OPPORTUNITY');

    // 5. Patient converts and pays via UPI (₹45,000 for Clear Aligners)
    const tx = revenueEngine.recordTransaction({
      businessId,
      organizationId: orgId,
      journeyId: j4.id,
      campaignId,
      invoiceNumber: 'INV-E2E-2026-999',
      amountINR: 45000,
      paymentMethod: 'UPI',
      paymentGateway: 'RAZORPAY',
      transactionRef: 'pay_rzp_closed_loop_1',
      status: 'SUCCESS',
      classification: 'TEST',
      serviceRendered: 'Invisible Clear Aligners - 6 Months Complete Plan',
    });
    expect(tx.id).toBeTruthy();
    expect(tx.amountINR).toBe(45000);

    // 6. Verify Customer Journey updated to CUSTOMER with lifetime value
    const db = getDb();
    const journeyInDb = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(j4.id) as any;
    expect(journeyInDb.stage).toBe('CUSTOMER');
    expect(journeyInDb.total_lifetime_value_inr).toBe(45000);

    // 7. Multi-Touch Attribution Engine attributes credit across channels
    const touchpoints = [
      { id: 'tp-1', channel: 'META_ADS', campaignId, createdAt: new Date().toISOString(), revenueINR: 45000 },
      { id: 'tp-2', channel: 'WHATSAPP', campaignId, createdAt: new Date().toISOString(), revenueINR: 45000 },
    ];
    const attribution = AttributionEngine.calculateAttribution(
      'event_tx_e2e_999',
      touchpoints,
      'LINEAR'
    );
    expect(attribution.length).toBe(2);
    expect(attribution[0].creditFraction).toBe(0.5);
    expect(attribution[1].creditFraction).toBe(0.5);

    // 8. Log AI Reasoning Costs for the conversion
    costAccounting.logCost({
      organizationId: orgId,
      businessId,
      agentId: 'agt_social_copywriter',
      division: 'CONTENT',
      model: 'gemini-3.8-flash',
      thinkingLevel: 'medium',
      inputTokens: 1500,
      outputTokens: 600,
      latencyMs: 410,
      purpose: 'Bilingual patient conversion follow-up generation',
    });

    // 9. Verify Revenue Summary & Unit Economics
    const revenueSummary = revenueEngine.getRevenueSummary(businessId);
    expect(revenueSummary.testRevenueINR).toBeGreaterThanOrEqual(45000);
    expect(revenueSummary.totalTransactions).toBeGreaterThanOrEqual(3);
    expect(revenueSummary.aiCostPerCustomerINR).toBeGreaterThan(0);

    // 10. Experiment evaluates uplift: WhatsApp UPI discount vs Standard booking
    const expId = ExperimentEngine.createExperiment({
      organizationId: orgId,
      businessId,
      campaignId,
      title: 'WhatsApp Direct UPI vs Standard Consultation Link',
      hypothesis: 'Direct UPI payment incentive increases same-day aligner bookings by 25%',
      baseline: 'Standard Clinic Consultation',
      treatment: 'Immediate 0% EMI or ₹2000 UPI cashback',
      successMetric: 'Conversion to Paying Patient',
      expectedEffect: '+25% booking velocity',
      minimumEvidenceRequirement: 10,
    });

    const expEval = ExperimentEngine.evaluateExperiment(expId, {
      baselineSamples: 100,
      baselineConversions: 8,
      treatmentSamples: 100,
      treatmentConversions: 22,
    });
    expect(expEval.outcome).toBe('SCALE');

    // 11. Strategy evolves based on verified experiment result
    const evolved = LearningManager.evolveStrategy(
      orgId,
      businessId,
      goalId,
      'Experiment proved WhatsApp Direct UPI payment with upfront pricing drives 2.75x conversion uplift. Shifting 60% ad budget to WhatsApp direct-booking funnels.',
      [
        { channel: 'WHATSAPP', allocation: 60, rationale: 'Proven 22% conversion rate' },
        { channel: 'META_ADS', allocation: 25, rationale: 'Top-of-funnel lead discovery' },
        { channel: 'GOOGLE_BUSINESS_PROFILE', allocation: 15, rationale: 'Local Hyderabad map searches' },
      ],
      ['Invisible Aligners ₹2,999/mo Zero-Cost EMI', 'Digital 3D Smile Scan Preview']
    );

    expect(evolved.strategyId).toBeTruthy();
    expect(evolved.newVersion).toBe(2);

    // 12. Verify in DB that Strategy v1 is SUPERSEDED and Strategy v2 is ACTIVE
    const activeStrategy = db
      .prepare('SELECT * FROM strategies WHERE business_id = ? AND status = ?')
      .get(businessId, 'ACTIVE') as any;
    expect(activeStrategy.version).toBe(2);
    expect(activeStrategy.id).toBe(evolved.strategyId);
  });
});
