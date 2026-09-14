import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import { MarketingMemoryEngine, DEFAULT_EVIDENCE_THRESHOLDS } from '../../src/knowledge/marketing-memory.js';
import { CampaignKnowledgeGraph } from '../../src/knowledge/knowledge-graph.js';
import { AgentScorecardEngine } from '../../src/analytics/agent-scorecard.js';
import { AutonomyController } from '../../src/control-plane/autonomy-controller.js';
import { FirstCustomerAutomationPipeline } from '../../src/workflows/first-customer-automation.js';
import { AttributionEvidenceEngine } from '../../src/revenue/attribution-evidence.js';

describe('Evidence-Gated Autonomous Growth - 15 Invariant Audit Suite', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';
  const testJourneyId = 'journey-961c351f-71d2-4d7b-a842-b6858984b288';
  const testApptId = 'appt_suresh_001';

  let revenueEngine: RevenueReconciliationEngine;
  let economicsEngine: RealEconomicsEngine;
  let memoryEngine: MarketingMemoryEngine;
  let knowledgeGraph: CampaignKnowledgeGraph;
  let scorecardEngine: AgentScorecardEngine;
  let autonomyController: AutonomyController;
  let firstCustomerPipeline: FirstCustomerAutomationPipeline;
  let attributionEngine: AttributionEvidenceEngine;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();

    revenueEngine = new RevenueReconciliationEngine();
    economicsEngine = new RealEconomicsEngine();
    memoryEngine = new MarketingMemoryEngine();
    knowledgeGraph = new CampaignKnowledgeGraph();
    scorecardEngine = new AgentScorecardEngine();
    autonomyController = new AutonomyController();
    firstCustomerPipeline = new FirstCustomerAutomationPipeline();
    attributionEngine = new AttributionEvidenceEngine();

    const db = getDb();
    // Ensure clean state for Suresh Reddy test journey
    db.prepare(`
      INSERT OR REPLACE INTO customer_journeys (
        id, organization_id, business_id, visitor_id, customer_name,
        customer_phone, customer_email, stage, first_touch_channel,
        last_touch_channel, touchpoints_json, total_lifetime_value_inr,
        classification, attribution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testJourneyId,
      orgId,
      businessId,
      'vis_real_2f6de21c',
      'Suresh Reddy',
      '+919849123456',
      'suresh.reddy.hyd@gmail.com',
      'QUALIFIED_LEAD',
      'GOOGLE_SEARCH',
      'WHATSAPP',
      JSON.stringify([
        {
          channel: 'GOOGLE_SEARCH',
          campaignId: 'cmp_google_invisalign_01',
          timestamp: '2026-09-12T14:30:00Z',
        },
      ]),
      0,
      'REAL',
      'UNVERIFIED',
      '2026-09-12T14:30:00Z',
      '2026-09-12T14:30:00Z'
    );

    db.prepare(`
      INSERT OR REPLACE INTO appointments (
        id, journey_id, business_id, patient_name, appointment_date,
        service, clinic_location, clinic_confirmation, confirmation_timestamp,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      testApptId,
      testJourneyId,
      businessId,
      'Suresh Reddy',
      '2026-09-15T10:30:00Z',
      'Invisalign Clear Aligners 3D Scan & Doctor Consultation',
      'SmileKraft Banjara Hills',
      'CONFIRMED',
      '2026-09-13T10:45:00.000Z',
      '2026-09-13T10:45:00.000Z',
      '2026-09-13T10:45:00.000Z'
    );
  });

  // =========================================================================
  // INVARIANT 1: Consultation cannot become customer without treatment acceptance
  // =========================================================================
  it('Invariant 1: Consultation cannot become customer without treatment acceptance', async () => {
    // 1. Direct engine check: Attempting to record treatment payment on an unaccepted plan must throw
    const unacceptedPlan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: testJourneyId,
      service: 'Invisalign Full Course',
      quotedAmountINR: 150000,
      doctorNotes: 'Digital 3D scan complete. Patient undecided on treatment.',
      clinicConfirmation: 'PENDING',
      status: 'PROPOSED',
    });

    expect(() => {
      revenueEngine.recordTreatmentPayment({
        businessId,
        organizationId: orgId,
        journeyId: testJourneyId,
        treatmentPlanId: unacceptedPlan.id,
        amountINR: 20000,
        paymentMethod: 'UPI',
        transactionRef: 'UPI-REF-INV-99001',
        invoiceNumber: 'INV-SK-2026-099',
        verificationSource: 'HDFC_BANK_STATEMENT',
        verifiedByUserId: 'usr_owner_01',
      });
    }).toThrow(/treatment plan has not been accepted/i);

    // Journey stage must remain QUALIFIED_LEAD
    const db = getDb();
    const journey = db.prepare('SELECT stage FROM customer_journeys WHERE id = ?').get(testJourneyId) as any;
    expect(journey.stage).toBe('QUALIFIED_LEAD');

    // 2. Automation pipeline check: Insufficient doctor notes stops conversion
    const pipelineResult = await firstCustomerPipeline.executePipeline({
      businessId,
      journeyId: testJourneyId,
      appointmentId: testApptId,
      invoiceNumber: 'INV-TEST-001',
      paidAmountINR: 20000,
      quotedAmountINR: 150000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-REF-123456',
      verificationSource: 'BANK_STATEMENT',
      serviceRendered: 'Invisalign Comprehensive',
      doctorNotes: 'Short', // Less than 10 characters -> fails Gate 3
      dryRun: false,
    });

    expect(pipelineResult.overallSuccess).toBe(false);
    expect(pipelineResult.steps[2].status).toBe('FAILED');
    expect(pipelineResult.steps[2].name).toBe('Treatment Plan Quote Formulation');
  });

  // =========================================================================
  // INVARIANT 2: Treatment plan quote cannot become revenue
  // =========================================================================
  it('Invariant 2: Treatment plan quote cannot become revenue', () => {
    const quoteAmount = 150000;
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: testJourneyId,
      service: 'Invisalign Comprehensive Treatment Plan',
      quotedAmountINR: quoteAmount,
      doctorNotes: 'Full arch digital scans taken. Treatment plan quoted at ₹150,000.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    expect(plan.id).toBeDefined();
    expect(plan.quotedAmountINR).toBe(quoteAmount);

    // Verify revenue ledger is untouched
    const summary = revenueEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(0);
    expect(summary.realRevenueIndependentlyVerifiedINR).toBe(0);
    expect(summary.realMarketingAttributedRevenueINR).toBe(0);

    const db = getDb();
    const txCount = db.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE journey_id = ?').get(testJourneyId) as any;
    expect(txCount.cnt).toBe(0);
  });

  // =========================================================================
  // INVARIANT 3: Quoted amount cannot become paid amount
  // =========================================================================
  it('Invariant 3: Quoted amount cannot become paid amount (deposit ₹20,000 -> rev ₹20,000, outstanding ₹130,000)', () => {
    const quotedAmount = 150000;
    const depositAmount = 20000;

    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: testJourneyId,
      service: 'Invisalign Treatment',
      quotedAmountINR: quotedAmount,
      doctorNotes: 'Patient approved 3D treatment plan and agreed to ₹20,000 booking deposit.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    const { transaction, treatmentPlan } = revenueEngine.recordTreatmentPayment({
      businessId,
      organizationId: orgId,
      journeyId: testJourneyId,
      treatmentPlanId: plan.id,
      amountINR: depositAmount,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-HDFC-DEP-002948',
      invoiceNumber: 'INV-SK-2026-101',
      verificationSource: 'BANK_STATEMENT',
      verifiedByUserId: 'usr_owner_01',
    });

    // Transaction is strictly the paid amount
    expect(transaction.amountINR).toBe(depositAmount);
    expect(transaction.amountINR).not.toBe(quotedAmount);

    // Treatment plan tracks paid vs outstanding balance
    expect(treatmentPlan.paidAmountINR).toBe(depositAmount);
    expect(treatmentPlan.outstandingAmountINR).toBe(130000);
    expect(treatmentPlan.status).toBe('IN_PROGRESS');

    // Revenue summary reflects paid amount
    const summary = revenueEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(depositAmount);
    expect(summary.realRevenueIndependentlyVerifiedINR).toBe(depositAmount);
  });

  // =========================================================================
  // INVARIANT 4: Payment must have external evidence (gateway ref or bank UTR)
  // =========================================================================
  it('Invariant 4: Payment must have external evidence (gateway ref or bank UTR)', () => {
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: testJourneyId,
      service: 'Invisalign Treatment',
      quotedAmountINR: 150000,
      doctorNotes: 'Patient accepted Invisalign treatment.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    // Missing / invalid transaction reference must throw
    expect(() => {
      revenueEngine.recordTreatmentPayment({
        businessId,
        organizationId: orgId,
        journeyId: testJourneyId,
        treatmentPlanId: plan.id,
        amountINR: 20000,
        paymentMethod: 'UPI',
        transactionRef: '', // Missing external reference
        invoiceNumber: 'INV-TEST-002',
        verificationSource: 'BANK_STATEMENT',
        verifiedByUserId: 'usr_owner_01',
      });
    }).toThrow(/external payment evidence.*required/i);

    expect(() => {
      revenueEngine.recordTreatmentPayment({
        businessId,
        organizationId: orgId,
        journeyId: testJourneyId,
        treatmentPlanId: plan.id,
        amountINR: 20000,
        paymentMethod: 'UPI',
        transactionRef: '123', // Too short (< 6 chars)
        invoiceNumber: 'INV-TEST-003',
        verificationSource: 'BANK_STATEMENT',
        verifiedByUserId: 'usr_owner_01',
      });
    }).toThrow(/external payment evidence.*required/i);
  });

  // =========================================================================
  // INVARIANT 5: Workflow cannot invent transaction amount
  // =========================================================================
  it('Invariant 5: Workflow cannot invent transaction amount (zero or negative payment rejected)', async () => {
    const result = await firstCustomerPipeline.executePipeline({
      businessId,
      journeyId: testJourneyId,
      appointmentId: testApptId,
      invoiceNumber: 'INV-TEST-INV-001',
      paidAmountINR: 0, // Invalid amount
      quotedAmountINR: 150000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-REF-VALID-99',
      verificationSource: 'BANK_STATEMENT',
      serviceRendered: 'Invisalign',
      doctorNotes: 'Comprehensive 3D scan and alignment review completed.',
      dryRun: false,
    });

    expect(result.overallSuccess).toBe(false);
    expect(result.steps[4].status).toBe('FAILED');
    expect(result.steps[4].details).toMatch(/Payment amount must be greater than ₹0/);
  });

  // =========================================================================
  // INVARIANT 6: Workflow cannot duplicate payment (idempotency key enforcement)
  // =========================================================================
  it('Invariant 6: Workflow cannot duplicate payment (idempotency key enforcement)', async () => {
    const customDedupKey = `idemp-test-${Date.now()}`;

    // 1st Execution
    const firstRun = await firstCustomerPipeline.executePipeline({
      businessId,
      journeyId: testJourneyId,
      appointmentId: testApptId,
      invoiceNumber: 'INV-IDEMP-001',
      paidAmountINR: 20000,
      quotedAmountINR: 150000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-HDFC-9912388',
      verificationSource: 'BANK_STATEMENT',
      serviceRendered: 'Invisalign Treatment',
      doctorNotes: 'Doctor confirmed diagnosis, 3D scans complete, plan accepted.',
      dryRun: false,
      idempotencyKey: customDedupKey,
    });

    expect(firstRun.overallSuccess).toBe(true);
    expect(firstRun.idempotentReplay).toBeFalsy();

    // 2nd Execution with identical key
    const secondRun = await firstCustomerPipeline.executePipeline({
      businessId,
      journeyId: testJourneyId,
      appointmentId: testApptId,
      invoiceNumber: 'INV-IDEMP-001',
      paidAmountINR: 20000,
      quotedAmountINR: 150000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-HDFC-9912388',
      verificationSource: 'BANK_STATEMENT',
      serviceRendered: 'Invisalign Treatment',
      doctorNotes: 'Doctor confirmed diagnosis, 3D scans complete, plan accepted.',
      dryRun: false,
      idempotencyKey: customDedupKey,
    });

    expect(secondRun.overallSuccess).toBe(true);
    expect(secondRun.idempotentReplay).toBe(true);
    expect(secondRun.steps[0].name).toBe('Idempotency Gate');
    expect(secondRun.steps[0].status).toBe('SKIPPED');

    // Revenue in database must be exactly ₹20,000 (NOT duplicated to ₹40,000)
    const summary = revenueEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(20000);
  });

  // =========================================================================
  // INVARIANT 7: UTM-only cannot become verified attribution
  // =========================================================================
  it('Invariant 7: UTM-only cannot become verified attribution', () => {
    const evidence = attributionEngine.getEvidenceForJourney(testJourneyId);
    expect(evidence.verificationStatus).toBe('UNVERIFIED');
    expect(evidence.hierarchyLevel).not.toBe('LEVEL_1_VERIFIED_GCLID');
    expect(evidence.hierarchyLevel).not.toBe('LEVEL_2_CAMPAIGN_CORRELATION');

    // Quoted/paid money attached to this unverified journey is categorized as unattributed
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: testJourneyId,
      service: 'Invisalign',
      quotedAmountINR: 150000,
      doctorNotes: '3D scans completed.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    revenueEngine.recordTreatmentPayment({
      businessId,
      organizationId: orgId,
      journeyId: testJourneyId,
      treatmentPlanId: plan.id,
      amountINR: 20000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-BANK-772611',
      invoiceNumber: 'INV-UTM-001',
      verificationSource: 'BANK_STATEMENT',
      verifiedByUserId: 'usr_owner_01',
    });

    const summary = revenueEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(20000);
    expect(summary.realMarketingAttributedRevenueINR).toBe(0);
    expect(summary.unattributedRealRevenueINR).toBe(20000);
  });

  // =========================================================================
  // INVARIANT 8: Unverified graph relation cannot become verified attribution (POSSIBLY_ATTRIBUTED_TO)
  // =========================================================================
  it('Invariant 8: Unverified graph relation cannot become verified attribution (POSSIBLY_ATTRIBUTED_TO)', () => {
    // Ensure journey is unverified
    const db = getDb();
    db.prepare("UPDATE customer_journeys SET attribution_status = 'UNVERIFIED' WHERE id = ?").run(testJourneyId);

    knowledgeGraph.syncFromLiveEntities(businessId);
    const { edges } = knowledgeGraph.getGraph();

    const campaignEdge = edges.find((e) => e.targetNodeId === testJourneyId);
    expect(campaignEdge).toBeDefined();
    expect(campaignEdge?.relation).toBe('POSSIBLY_ATTRIBUTED_TO');
    expect(campaignEdge?.verificationStatus).toBe('UNVERIFIED');
    expect(campaignEdge?.relation).not.toBe('VERIFIED_ATTRIBUTED_TO');

    // Stamping as verified flips relation to VERIFIED_ATTRIBUTED_TO
    db.prepare("UPDATE customer_journeys SET attribution_status = 'VERIFIED' WHERE id = ?").run(testJourneyId);
    knowledgeGraph.syncFromLiveEntities(businessId);
    const updatedGraph = knowledgeGraph.getGraph();
    const verifiedEdge = updatedGraph.edges.find((e) => e.targetNodeId === testJourneyId);
    expect(verifiedEdge?.relation).toBe('VERIFIED_ATTRIBUTED_TO');
    expect(verifiedEdge?.verificationStatus).toBe('VERIFIED');
  });

  // =========================================================================
  // INVARIANT 9: One observation cannot create PROVEN memory (strictly PROMISING)
  // =========================================================================
  it('Invariant 9: One observation cannot create PROVEN memory (strictly PROMISING)', () => {
    const maturity = memoryEngine.calculateMaturity({
      evidenceCount: 1,
      sourceType: 'REAL_INTERNAL_DATA',
      payingCustomersCount: 0,
      verifiedRevenueINR: 0,
    });
    expect(maturity).toBe('PROMISING');
    expect(maturity).not.toBe('PROVEN');
    expect(maturity).not.toBe('SUPPORTED');

    // Recording memory with 1 observation
    const mem = memoryEngine.recordMemory({
      businessId,
      dimension: 'WINNING_KEYWORD',
      key: 'invisalign-banjara-hills',
      insight: 'First consultation inquiry from Banjara Hills clear aligner search.',
      evidenceReference: testJourneyId,
      sourceType: 'REAL_INTERNAL_DATA',
      evidenceCount: 1,
      verifiedRevenueINR: 0,
      payingCustomersCount: 0,
    });
    expect(mem.maturity).toBe('PROMISING');

    // Requires >= 10 observations and >= 3 customers for PROVEN
    const provenCheck = memoryEngine.calculateMaturity({
      evidenceCount: 10,
      sourceType: 'REAL_INTERNAL_DATA',
      payingCustomersCount: 3,
      netContributionINR: 50000,
    });
    expect(provenCheck).toBe('PROVEN');
  });

  // =========================================================================
  // INVARIANT 10: Pending prediction cannot count toward accuracy
  // =========================================================================
  it('Invariant 10: Pending prediction cannot count toward accuracy', () => {
    const agentId = 'agt_paid_search_01';

    // Record an initial prediction
    const pred = scorecardEngine.recordPrediction({
      decisionId: 'dec_test_001',
      agentId,
      businessId,
      expectedConversionRate: 0.15,
      expectedCplINR: 1200,
      confidence: 0.85,
    });

    expect(pred.status).toBe('PREDICTION_PENDING');

    const scorecard = scorecardEngine.getScorecard(agentId);
    expect(scorecard?.pendingPredictionsCount).toBeGreaterThanOrEqual(1);
    // Unresolved prediction does not alter average accuracy
    expect(scorecard?.averagePredictionAccuracyPercent).toBe(0);

    // Resolve prediction with actual data
    scorecardEngine.resolvePrediction(pred.id, {
      actualConversionRate: 0.14,
      actualCplINR: 1250,
    });

    const updatedScorecard = scorecardEngine.getScorecard(agentId);
    expect(updatedScorecard?.averagePredictionAccuracyPercent).toBeGreaterThan(0);
  });

  // =========================================================================
  // INVARIANT 11: Test learning cannot modify production
  // =========================================================================
  it('Invariant 11: Test learning cannot modify production', () => {
    // 1. Test data maturity can never graduate beyond HYPOTHESIS
    const testMaturity = memoryEngine.calculateMaturity({
      evidenceCount: 50,
      sourceType: 'TEST_DATA',
      payingCustomersCount: 20,
      netContributionINR: 500000,
    });
    expect(testMaturity).toBe('HYPOTHESIS');

    // 2. Cannot record REAL verified revenue against a TEST journey
    const db = getDb();
    const testJourney = 'journey-synthetic-test-01';
    db.prepare(`
      INSERT INTO customer_journeys (
        id, organization_id, business_id, visitor_id, classification, stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'TEST', 'LEAD', datetime('now'), datetime('now'))
    `).run(testJourney, orgId, businessId, 'vis-test-01');

    expect(() => {
      revenueEngine.recordVerifiedManualRevenue({
        businessId,
        organizationId: orgId,
        journeyId: testJourney,
        invoiceNumber: 'INV-FAKE-01',
        amountINR: 50000,
        paymentMethod: 'UPI',
        transactionRef: 'UPI-FAKE-9988',
        verificationSource: 'BANK_STATEMENT',
        verifiedByUserId: 'usr_owner_01',
      });
    }).toThrow(/Cannot record REAL revenue against a TEST customer journey/i);
  });

  // =========================================================================
  // INVARIANT 12: Historical seed spend cannot enter live ROAS
  // =========================================================================
  it('Invariant 12: Historical seed spend (₹21,300) cannot enter live ROAS', () => {
    const summary = revenueEngine.getRevenueSummary(businessId);
    // Mock seed campaigns are excluded from live Google Ads spend
    expect(summary.verifiedActualGoogleAdsSpendINR).toBe(0);

    const economics = economicsEngine.calculate(businessId);
    expect(economics.actualAdSpendINR).toBe(0);
    // When spend is 0, ROAS must be returned as 'N/A' (no division by zero or fake numbers)
    expect(economics.verifiedRoas).toBe('N/A');
    expect(economics.verifiedRoi).toBe('N/A');
  });

  // =========================================================================
  // INVARIANT 13: Autonomous scaling denied under threshold
  // =========================================================================
  it('Invariant 13: Autonomous scaling denied under threshold (< 5 customers / negative contribution)', () => {
    // Attempt to transition to AUTONOMOUS_SCALING with only 0 real paying customers
    const result = autonomyController.setOperatingMode(businessId, 'AUTONOMOUS_SCALING');
    expect(result.success).toBe(false);
    expect(result.rationale).toMatch(/SCALING GATE LOCKED/);

    const policy = autonomyController.getBudgetPolicy(businessId);
    expect(policy.activeMode).not.toBe('AUTONOMOUS_SCALING');
  });

  // =========================================================================
  // INVARIANT 14: Budget increase beyond policy rejected
  // =========================================================================
  it('Invariant 14: Budget increase beyond policy rejected', () => {
    const policy = autonomyController.getBudgetPolicy(businessId);
    const excessiveBudget = policy.remainingAutonomousBudgetINR + 5000;

    const proposal = {
      id: 'prop-excessive-01',
      businessId,
      agentId: 'agt_paid_search_01',
      actionType: 'SCALE_CAMPAIGN' as const,
      targetEntityId: 'cmp_google_invisalign_01',
      evidence: 'High search volume observed in Hyderabad.',
      reason: 'Aggressive scaling proposal.',
      confidence: 0.9,
      expectedImpact: '+50% volume',
      budgetImpactINR: excessiveBudget,
      risk: 'MEDIUM' as const,
      approvalStatus: 'PROPOSED' as const,
      createdAt: new Date().toISOString(),
    };

    const execution = autonomyController.executeOptimizationProposal(businessId, proposal);
    expect(execution.success).toBe(false);
    expect(execution.rationale).toMatch(/BUDGET POLICY REJECTION/);
  });

  // =========================================================================
  // INVARIANT 15: Kill switch stops optimization immediately
  // =========================================================================
  it('Invariant 15: Kill switch stops optimization immediately', () => {
    // Activate kill switch
    autonomyController.activateKillSwitch(businessId, 'Emergency safety stop requested by clinic director.');

    const policy = autonomyController.getBudgetPolicy(businessId);
    expect(policy.activeMode).toBe('OBSERVE');
    expect(policy.stopConditionsTriggered).toBe(true);

    const proposal = {
      id: 'prop-safe-01',
      businessId,
      agentId: 'agt_paid_search_01',
      actionType: 'INCREASE_KEYWORD' as const,
      targetEntityId: 'kw-invisalign',
      evidence: 'Verified clinical booking.',
      reason: 'Expand impressions.',
      confidence: 0.95,
      expectedImpact: '+10% volume',
      budgetImpactINR: 500,
      risk: 'LOW' as const,
      approvalStatus: 'PROPOSED' as const,
      createdAt: new Date().toISOString(),
    };

    const execution = autonomyController.executeOptimizationProposal(businessId, proposal);
    expect(execution.success).toBe(false);
    expect(execution.rationale).toMatch(/KILL SWITCH \/ STOP CONDITION ACTIVE/);
  });
});
