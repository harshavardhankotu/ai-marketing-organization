import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { AttributionEvidenceEngine } from '../../src/revenue/attribution-evidence.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import { MarketingMemoryEngine } from '../../src/knowledge/marketing-memory.js';
import { CampaignKnowledgeGraph } from '../../src/knowledge/knowledge-graph.js';
import { AgentScorecardEngine } from '../../src/analytics/agent-scorecard.js';
import { AutonomyController } from '../../src/control-plane/autonomy-controller.js';
import { FirstCustomerAutomationPipeline } from '../../src/workflows/first-customer-automation.js';
import { GoogleAdsClient, googleAdsClient } from '../../src/integrations/google-ads.js';

describe('Autonomous Growth Engine, Attribution Hierarchy & Real Economics Test Suite', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  let attributionEngine: AttributionEvidenceEngine;
  let economicsEngine: RealEconomicsEngine;
  let memoryEngine: MarketingMemoryEngine;
  let knowledgeGraph: CampaignKnowledgeGraph;
  let scorecardEngine: AgentScorecardEngine;
  let autonomyController: AutonomyController;
  let firstCustomerPipeline: FirstCustomerAutomationPipeline;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();

    attributionEngine = new AttributionEvidenceEngine();
    economicsEngine = new RealEconomicsEngine();
    memoryEngine = new MarketingMemoryEngine();
    knowledgeGraph = new CampaignKnowledgeGraph();
    scorecardEngine = new AgentScorecardEngine();
    autonomyController = new AutonomyController();
    firstCustomerPipeline = new FirstCustomerAutomationPipeline();

    // Seed Suresh Reddy's verified journey and appointment
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO customer_journeys (
        id, organization_id, business_id, visitor_id, customer_name,
        customer_phone, customer_email, stage, first_touch_channel,
        last_touch_channel, touchpoints_json, total_lifetime_value_inr,
        classification, attribution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'journey-961c351f-71d2-4d7b-a842-b6858984b288',
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
          timestamp: '2026-09-13T10:39:06.199Z',
          event: 'search_ad_click',
          source: 'google',
          sessionId: 'sess_suresh_001',
          utmSource: 'google',
          utmCampaign: 'invisalign_hyd_search',
        },
      ]),
      0,
      'REAL',
      'UNVERIFIED',
      '2026-09-13T10:39:06.199Z',
      '2026-09-13T10:39:06.199Z'
    );

    db.prepare(`
      INSERT OR REPLACE INTO appointments (
        id, journey_id, business_id, patient_name, appointment_date,
        service, clinic_location, clinic_confirmation, confirmation_timestamp,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'appt_suresh_001',
      'journey-961c351f-71d2-4d7b-a842-b6858984b288',
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
  // 1. ATTRIBUTION EVIDENCE & GCLID HIERARCHY TESTS
  // =========================================================================
  describe('Attribution Evidence Engine (GCLID Hierarchy)', () => {
    it('Level 1: GCLID match in google_clicks resolves to MATCHED and 100% confidence', () => {
      const db = getDb();
      const testGclid = 'gclid_live_test_level1_123';

      db.prepare(`
        INSERT INTO google_clicks (
          gclid, customer_id, campaign_id, campaign_name, keyword,
          device, click_type, click_timestamp, verification_source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        testGclid,
        '987-654-3210',
        'cmp_google_invisalign_01',
        'SmileKraft Hyderabad Search',
        'invisalign banjara hills',
        'MOBILE',
        'URL_CLICKS',
        '2026-09-13T10:30:00.000Z',
        'GOOGLE_ADS_API_CLICK_VIEW',
        '2026-09-13T10:30:00.000Z'
      );

      db.prepare(`
        UPDATE customer_journeys SET gclid = ? WHERE id = 'journey-961c351f-71d2-4d7b-a842-b6858984b288'
      `).run(testGclid);

      const evidence = attributionEngine.getEvidenceForJourney('journey-961c351f-71d2-4d7b-a842-b6858984b288');
      expect(evidence.hierarchyLevel).toBe('LEVEL_1_VERIFIED_GCLID');
      expect(evidence.verificationStatus).toBe('MATCHED');
      expect(evidence.gclid).toBe(testGclid);
      expect(evidence.clickEvidence?.keyword).toBe('invisalign banjara hills');

      const evaluation = attributionEngine.evaluateAttribution(evidence);
      expect(evaluation.isAttributed).toBe(true);
      expect(evaluation.confidence).toBe(1.0);
    });

    it('Level 2: Session correlation within time window resolves to MATCHED and 85% confidence', () => {
      const db = getDb();
      // Insert click matching campaign within ±30min of journey time (10:39:06)
      db.prepare(`
        INSERT INTO google_clicks (
          gclid, customer_id, campaign_id, campaign_name, keyword,
          click_timestamp, verification_source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'gclid_time_correlated_456',
        '987-654-3210',
        'cmp_google_invisalign_01',
        'SmileKraft Hyderabad Search',
        'invisalign doctor hyderabad',
        '2026-09-13T10:35:00.000Z',
        'GOOGLE_ADS_API_CLICK_VIEW',
        '2026-09-13T10:35:00.000Z'
      );

      const evidence = attributionEngine.getEvidenceForJourney('journey-961c351f-71d2-4d7b-a842-b6858984b288');
      expect(evidence.hierarchyLevel).toBe('LEVEL_2_CAMPAIGN_CORRELATION');
      expect(evidence.verificationStatus).toBe('MATCHED');

      const evaluation = attributionEngine.evaluateAttribution(evidence);
      expect(evaluation.isAttributed).toBe(true);
      expect(evaluation.confidence).toBe(0.85);
    });

    it('Level 3: UTM-only without click evidence resolves strictly to UNVERIFIED and 0% credit', () => {
      // Suresh Reddy with no matching google_clicks record
      const evidence = attributionEngine.getEvidenceForJourney('journey-961c351f-71d2-4d7b-a842-b6858984b288');
      expect(evidence.hierarchyLevel).toBe('LEVEL_3_UTM_ONLY');
      expect(evidence.verificationStatus).toBe('UNVERIFIED');

      const evaluation = attributionEngine.evaluateAttribution(evidence);
      expect(evaluation.isAttributed).toBe(false);
      expect(evaluation.confidence).toBe(0.0);
      expect(evaluation.rationale).toContain('Attribution rejected');
    });

    it('Level 4: Organic / direct journey resolves to NOT_ATTRIBUTED', () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id, stage,
          first_touch_channel, touchpoints_json, classification
        ) VALUES ('journey-organic-999', ?, ?, 'vis-direct-999', 'LEAD', 'DIRECT', '[]', 'REAL')
      `).run(orgId, businessId);

      const evidence = attributionEngine.getEvidenceForJourney('journey-organic-999');
      expect(evidence.hierarchyLevel).toBe('LEVEL_4_UNKNOWN');
      expect(evidence.verificationStatus).toBe('NOT_ATTRIBUTED');

      const evaluation = attributionEngine.evaluateAttribution(evidence);
      expect(evaluation.isAttributed).toBe(false);
    });
  });

  // =========================================================================
  // 1B. GOOGLE ADS 2026 PRODUCTION ARCHITECTURE TESTS
  // =========================================================================
  describe('Google Ads 2026 Production Architecture (Post-Developer Token Sunset)', () => {
    it('Exposes inspectable methods: getAccessLevel, getAuthStatus, and getAccountStatus', async () => {
      const client = new GoogleAdsClient();
      const accessLevel = client.getAccessLevel();
      expect(['STANDARD', 'TEST_ACCOUNT', 'NOT_CONFIGURED']).toContain(accessLevel);

      const authStatus = await client.getAuthStatus();
      expect(['AUTHENTICATED', 'REFRESH_TOKEN_EXPIRED', 'UNAUTHENTICATED']).toContain(authStatus);

      const accountStatus = await client.getAccountStatus();
      expect(['ACTIVE', 'SUSPENDED', 'UNCONFIGURED']).toContain(accountStatus);
    });

    it('Supports offline conversion uploads for clinical treatment purchases', async () => {
      const client = new GoogleAdsClient();
      const result = await client.uploadOfflineConversion({
        customerId: '987-654-3210',
        conversionActionId: 'conv_invisalign_purchase',
        gclid: 'gclid_test_conversion_123',
        conversionDateTime: new Date().toISOString(),
        conversionValue: 150000,
        currencyCode: 'INR',
      });

      expect(result.gclid).toBe('gclid_test_conversion_123');
      expect(result.conversionValue).toBe(150000);
      expect(['UPLOADED', 'RECORDED']).toContain(result.status);
    });
  });

  // =========================================================================
  // 2. REAL ECONOMICS ENGINE TESTS
  // =========================================================================
  describe('Real Economics Engine', () => {
    it('Computes unit economics truthfully when live Google Ads spend is ₹0', () => {
      const economics = economicsEngine.calculate(businessId);
      expect(economics.actualAdSpendINR).toBe(0);
      expect(economics.verifiedRealRevenueINR).toBe(0);
      expect(economics.attributedRealRevenueINR).toBe(0);
      // Denominator safety: CPL & CostPerConsultation are 0 when spend is 0, CAC & ARPC are UNKNOWN when customers is 0
      expect(economics.cplINR).toBe(0);
      expect(economics.costPerConsultationINR).toBe(0);
      expect(economics.cacINR).toBe('UNKNOWN');
      expect(economics.arpcINR).toBe('UNKNOWN');
      expect(economics.verifiedRoas).toBe('N/A');
      expect(economics.verifiedRoi).toBe('N/A');
      expect(economics.netContributionINR).toBe(0);
    });

    it('Excludes historical seed mock spend (₹21,300) from live economics', () => {
      const economics = economicsEngine.calculate(businessId);
      expect(economics.actualAdSpendINR).toBe(0);
      expect(economics.actualAdSpendINR).not.toBe(21300);
    });
  });

  // =========================================================================
  // 3. MARKETING MEMORY ENGINE TESTS
  // =========================================================================
  describe('Marketing Memory Engine', () => {
    it('Records and retrieves structured evidence-backed memories across dimensions', () => {
      const memory = memoryEngine.recordMemory({
        businessId,
        dimension: 'WINNING_KEYWORD',
        key: 'invisalign-banjara-hills',
        insight: 'High commercial intent search in Banjara Hills generated WhatsApp inbound consultation.',
        evidenceReference: 'journey-961c351f-71d2-4d7b-a842-b6858984b288',
        sourceType: 'REAL_INTERNAL_DATA',
        confidence: 0.95,
      });

      expect(memory.id).toBeDefined();
      expect(memory.dimension).toBe('WINNING_KEYWORD');
      expect(memory.confidence).toBe(0.95);

      const list = memoryEngine.listMemories(businessId, 'WINNING_KEYWORD');
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list[0].key).toBe('invisalign-banjara-hills');
      expect(list[0].evidenceReference).toBe('journey-961c351f-71d2-4d7b-a842-b6858984b288');
    });

    it('Supports deleting and retrieving single memory by id', () => {
      const mem = memoryEngine.recordMemory({
        businessId,
        dimension: 'COMPLIANCE_CONSTRAINT',
        key: 'medical-council-pricing-rule',
        insight: 'Direct price discounting in medical ad copy is strictly prohibited.',
        evidenceReference: 'guideline_nmc_2024',
        sourceType: 'REAL_EXTERNAL_EVIDENCE',
      });

      const retrieved = memoryEngine.getMemory(mem.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.key).toBe('medical-council-pricing-rule');

      const deleted = memoryEngine.deleteMemory(mem.id);
      expect(deleted).toBe(true);
      expect(memoryEngine.getMemory(mem.id)).toBeNull();
    });
  });

  // =========================================================================
  // 4. CAMPAIGN KNOWLEDGE GRAPH TESTS
  // =========================================================================
  describe('Campaign Knowledge Graph', () => {
    it('Upserts nodes and provenance edges and synchronizes from live database entities', () => {
      const syncResult = knowledgeGraph.syncFromLiveEntities(businessId);
      expect(syncResult.nodesCount).toBeGreaterThanOrEqual(2);
      expect(syncResult.edgesCount).toBeGreaterThanOrEqual(1);

      const graph = knowledgeGraph.getGraph();
      const leadNode = graph.nodes.find((n) => n.id === 'journey-961c351f-71d2-4d7b-a842-b6858984b288');
      expect(leadNode).toBeDefined();
      expect(leadNode?.type).toBe('LEAD');
      expect(leadNode?.label).toBe('Suresh Reddy');

      const apptNode = graph.nodes.find((n) => n.id === 'appt_suresh_001');
      expect(apptNode).toBeDefined();
      expect(apptNode?.type).toBe('CONSULTATION');

      const consultationEdge = graph.edges.find((e) => e.relation === 'ATTENDED');
      expect(consultationEdge).toBeDefined();
      expect(consultationEdge?.sourceNodeId).toBe('journey-961c351f-71d2-4d7b-a842-b6858984b288');
      expect(consultationEdge?.targetNodeId).toBe('appt_suresh_001');
    });
  });

  // =========================================================================
  // 5. PREDICTION VS OUTCOME & AGENT SCORECARDS TESTS
  // =========================================================================
  describe('Agent Scorecard & Prediction Engine', () => {
    it('Logs predictions and evaluates prediction error when actual outcomes arrive', () => {
      const prediction = scorecardEngine.recordPrediction({
        decisionId: 'dec_test_001',
        agentId: 'agt_growth_lead_01',
        businessId,
        expectedConversionRate: 0.15,
        expectedCplINR: 1500,
        expectedRevenueINR: 50000,
        confidence: 0.88,
      });

      expect(prediction.id).toBeDefined();

      const resolved = scorecardEngine.resolvePrediction(prediction.id, {
        actualConversionRate: 0.14,
        actualCplINR: 1550,
        actualRevenueINR: 50000,
      });

      expect(resolved.predictionError).toBeDefined();
      expect(resolved.predictionError).toBeLessThan(0.10); // Less than 10% error
      expect(resolved.evaluatedAt).toBeDefined();
    });

    it('Maintains agent scorecards with outcome quality scores and real decisions', () => {
      scorecardEngine.recordAgentAction('agt_growth_lead_01', 'Growth Marketing Lead', 'MARKETING_GROWTH', {
        isReal: true,
        wasAccepted: true,
        wasSuccessful: true,
        revenueInfluencedINR: 0,
      });

      const card = scorecardEngine.getScorecard('agt_growth_lead_01');
      expect(card).not.toBeNull();
      expect(card?.agentName).toBe('Growth Marketing Lead');
      expect(card?.realDecisionsCount).toBeGreaterThanOrEqual(1);
      expect(card?.outcomeQualityScore).toBeGreaterThan(50);
    });
  });

  // =========================================================================
  // 6. AUTONOMY CONTROLLER & GOVERNANCE TESTS
  // =========================================================================
  describe('Autonomy Controller & Governance', () => {
    it('Initializes in CONTROLLED_AUTONOMY with a ₹10,000 max spend cap', () => {
      const policy = autonomyController.getBudgetPolicy(businessId);
      expect(policy.activeMode).toBe('CONTROLLED_AUTONOMY');
      expect(policy.maxAutonomousSpendINR).toBe(10000);
      expect(policy.remainingAutonomousBudgetINR).toBe(10000);
      expect(policy.stopConditionsTriggered).toBe(false);
    });

    it('SCALING GATE: Strictly blocks switching to AUTONOMOUS_SCALING without 5 real customers and profit', () => {
      // Currently real customers = 0
      const attempt = autonomyController.setOperatingMode(businessId, 'AUTONOMOUS_SCALING');
      expect(attempt.success).toBe(false);
      expect(attempt.rationale).toContain('SCALING GATE LOCKED');
      expect(attempt.rationale).toContain('at least 5 real paying customers');

      // Policy remains in original mode
      const policy = autonomyController.getBudgetPolicy(businessId);
      expect(policy.activeMode).toBe('CONTROLLED_AUTONOMY');
    });

    it('Triggers stop conditions, halts autonomous campaigns and downgrades mode to OBSERVE', () => {
      const event = autonomyController.triggerStopCondition(
        businessId,
        'CAC_EXCEEDS_MAX',
        'Customer acquisition cost exceeded ₹5,000 threshold'
      );

      expect(event.id).toBeDefined();
      expect(event.campaignHalted).toBe(true);

      const policy = autonomyController.getBudgetPolicy(businessId);
      expect(policy.activeMode).toBe('OBSERVE');
      expect(policy.stopConditionsTriggered).toBe(true);

      const log = autonomyController.listStopConditions();
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0].condition).toBe('CAC_EXCEEDS_MAX');
    });

    it('Generates actionable optimization proposals and experiment candidates', () => {
      const proposals = autonomyController.generateOptimizationProposals(businessId);
      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals[0].budgetImpactINR).toBeLessThanOrEqual(10000);

      const experiments = autonomyController.generateExperimentCandidates(businessId);
      expect(experiments.length).toBeGreaterThan(0);
      expect(experiments[0].hypothesis).toBeDefined();
    });
  });

  // =========================================================================
  // 7. FIRST CUSTOMER AUTOMATION PIPELINE TESTS
  // =========================================================================
  describe('First Customer Automation Pipeline', () => {
    it('Executes in dry-run mode without modifying the database or creating fake customers', async () => {
      const dryRunResult = await firstCustomerPipeline.executePipeline({
        businessId,
        journeyId: 'journey-961c351f-71d2-4d7b-a842-b6858984b288',
        appointmentId: 'appt_suresh_001',
        invoiceNumber: 'INV-SURESH-001',
        amountINR: 150000,
        paymentMethod: 'UPI',
        transactionRef: 'upi_razorpay_suresh_998877',
        verificationSource: 'RAZORPAY_GATEWAY_WEBHOOK',
        serviceRendered: 'Comprehensive Invisalign Clear Aligners Treatment Package',
        doctorNotes: 'Patient completed 3D scan, accepted 18-month clear aligner treatment plan.',
        dryRun: true,
      });

      expect(dryRunResult.overallSuccess).toBe(true);
      expect(dryRunResult.isDryRun).toBe(true);
      expect(dryRunResult.steps.length).toBe(12);

      // Verify that database was NOT altered
      const db = getDb();
      const journey = db.prepare('SELECT stage FROM customer_journeys WHERE id = ?').get('journey-961c351f-71d2-4d7b-a842-b6858984b288') as any;
      expect(journey.stage).toBe('QUALIFIED_LEAD'); // NOT converted to CUSTOMER in dry-run

      const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE invoice_number = ?').get('INV-SURESH-001') as any;
      expect(txCount.count).toBe(0); // Zero fake transaction entries created
    });

    it('Fails step 3 when doctor notes are missing or insufficient', async () => {
      const result = await firstCustomerPipeline.executePipeline({
        businessId,
        journeyId: 'journey-961c351f-71d2-4d7b-a842-b6858984b288',
        appointmentId: 'appt_suresh_001',
        invoiceNumber: 'INV-SURESH-002',
        amountINR: 150000,
        paymentMethod: 'UPI',
        transactionRef: 'upi_ref_123456',
        verificationSource: 'MANUAL_AUDIT',
        serviceRendered: 'Invisalign Treatment',
        doctorNotes: '', // Missing doctor notes!
        dryRun: true,
      });

      expect(dryRunResultStepFailed(result, 3)).toBe(true);
      expect(result.overallSuccess).toBe(false);
    });

    it('Fails step 6 when payment transaction reference is missing', async () => {
      const result = await firstCustomerPipeline.executePipeline({
        businessId,
        journeyId: 'journey-961c351f-71d2-4d7b-a842-b6858984b288',
        appointmentId: 'appt_suresh_001',
        invoiceNumber: 'INV-SURESH-003',
        amountINR: 150000,
        paymentMethod: 'UPI',
        transactionRef: '', // Missing payment ref!
        verificationSource: 'MANUAL_AUDIT',
        serviceRendered: 'Invisalign Treatment',
        doctorNotes: 'Doctor consultation conducted and approved.',
        dryRun: true,
      });

      expect(dryRunResultStepFailed(result, 6)).toBe(true);
      expect(result.overallSuccess).toBe(false);
    });
  });
});

function dryRunResultStepFailed(result: any, stepNumber: number): boolean {
  const step = result.steps.find((s: any) => s.step === stepNumber);
  return step?.status === 'FAILED';
}
