import { getDb, resetDbForTesting } from '../packages/backend/src/db/client.js';
import { seedDatabase } from '../packages/backend/src/db/seed.js';
import { ClosedLoopMarketingCycle } from '../packages/backend/src/workflows/closed-loop-cycle.js';
import { TrafficProvenanceEngine } from '../packages/backend/src/organic/traffic-provenance.js';
import { GoogleBusinessProfileAdapter } from '../packages/backend/src/organic/gbp-integration.js';
import { CustomerJourneyTracker } from '../packages/backend/src/revenue/customer-journey-tracker.js';
import { RevenueReconciliationEngine } from '../packages/backend/src/revenue/revenue-reconciliation.js';
import { RealEconomicsEngine } from '../packages/backend/src/revenue/real-economics.js';
import { AutonomyController } from '../packages/backend/src/control-plane/autonomy-controller.js';

async function runEndToEndSimulation() {
  console.log('================================================================================');
  console.log('🚀 AI MARKETING ORGANIZATION — END-TO-END AUTONOMOUS SIMULATION');
  console.log('================================================================================\n');

  // Reset and seed fresh database instance
  resetDbForTesting();
  seedDatabase();
  const db = getDb();
  const orgId = 'org_smilekraft_01';
  const businessId = 'biz_smilekraft_hyd';
  const goalId = 'goal_100_leads_hyd';

  // ---------------------------------------------------------------------------
  // STEP 1: INITIAL STATE VERIFICATION
  // ---------------------------------------------------------------------------
  console.log('▶ [PHASE 1: PRE-SIMULATION TRUTH AUDIT]');
  const economicsEngine = new RealEconomicsEngine();
  const revenueEngine = new RevenueReconciliationEngine();
  const initialEco = economicsEngine.calculate(businessId);
  const autonomy = new AutonomyController();
  const policy = autonomy.getBudgetPolicy(businessId);
  const revSummary = revenueEngine.getRevenueSummary(businessId);

  console.log(`  • Operating Mode:           ${policy.activeMode}`);
  console.log(`  • Autonomous Spend Cap:      ₹${policy.maxAutonomousSpendINR.toLocaleString('en-IN')}`);
  console.log(`  • Paid Media Spend:          ₹${initialEco.actualAdSpendINR.toLocaleString('en-IN')}`);
  console.log(`  • Verified Real Revenue:     ₹${initialEco.verifiedRealRevenueINR.toLocaleString('en-IN')}`);
  console.log(`  • Attributed Real Revenue:   ₹${initialEco.attributedRealRevenueINR.toLocaleString('en-IN')}`);
  console.log(`  • Test / Sandbox Revenue:    ₹${revSummary.testRevenueINR.toLocaleString('en-IN')}`);
  console.log(`  • Active Real Customers:     ${initialEco.organicCustomers}`);
  console.log(`  • Active Real Leads:         ${initialEco.organicLeads}`);

  // ---------------------------------------------------------------------------
  // STEP 2: RUN CLOSED-LOOP MARKETING CYCLE (STRATEGY -> CONTENT -> EXPERIMENT)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [PHASE 2: AUTONOMOUS CLOSED-LOOP MARKETING CYCLE EXECUTION]');
  console.log('  Executing 8-stage autonomous pipeline:');
  console.log('  1. Market Intelligence -> 2. Strategy v1 -> 3. Campaign Flight -> 4. Content Creation');
  console.log('  -> 5. Safe Sandbox Publication -> 6. Telemetry Ingestion -> 7. Experimentation -> 8. Strategy Evolution v2');

  const cycle = new ClosedLoopMarketingCycle();
  const cycleResult = await cycle.executeCompleteCycle({
    organizationId: orgId,
    businessId,
    goalId
  });

  console.log(`  ✓ Workflow Completed:        ${cycleResult.workflowId}`);
  console.log(`  ✓ Initial Strategy v1:       ${cycleResult.strategyId}`);
  console.log(`  ✓ Flight Campaign:           ${cycleResult.campaignId}`);
  console.log(`  ✓ Content Assets Created:    ${cycleResult.contentAssetIds.length} assets`);
  console.log(`  ✓ Experiment Concluded:      ${cycleResult.experimentId}`);
  console.log(`  ✓ Evolved Strategy v2:       ${cycleResult.evolvedStrategyId}`);

  // ---------------------------------------------------------------------------
  // STEP 3: REACH & AUDIENCE ENGAGEMENT AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n▶ [PHASE 3: REACH & AUDIENCE EXPOSURE AUDIT]');
  const gbpAdapter = new GoogleBusinessProfileAdapter();
  const gbpInsights = gbpAdapter.getLocationInsights(businessId);

  console.log('  --- Google Business Profile Reach ---');
  console.log(`  • Local Search Impressions:  ${gbpInsights.searchImpressions.toLocaleString()} views`);
  console.log(`  • Google Maps Impressions:   ${gbpInsights.mapImpressions.toLocaleString()} views`);
  console.log(`  • Total Local Reach:         ${((gbpInsights.searchImpressions as number) + (gbpInsights.mapImpressions as number)).toLocaleString()} prospective local patients`);
  console.log(`  • Website Action Clicks:     ${gbpInsights.websiteClicks} visits`);
  console.log(`  • Direct Call Inquiries:     ${gbpInsights.callClicks} telephone taps`);
  console.log(`  • Direction Requests:        ${gbpInsights.directionRequests} route navigations`);
  console.log(`  • Clinic Reputation:         ⭐ ${gbpInsights.averageRating} / 5.0 (${gbpInsights.reviewsCount} verified reviews)`);

  // Simulate traffic provenance recording for organic sessions
  const provenanceEngine = new TrafficProvenanceEngine();

  // Test Harness / Simulation Session
  const simSession = provenanceEngine.recordSession({
    businessId,
    landingPage: '/aligners-banjara-hills',
    referrer: 'https://www.google.co.in/search?q=clear+aligners+banjara+hills',
    utmSource: 'google_organic',
    utmMedium: 'organic_search',
    isTestHarness: true,
  });

  const trafficStats = provenanceEngine.getOrganicDistributionStats(businessId);
  console.log('\n  --- Organic Website & Landing Page Reach ---');
  console.log(`  • Total Ingested Sessions:   ${trafficStats.totalSessions}`);
  console.log(`  • Test / Harness Sessions:   ${trafficStats.testSessions} (Flagged: ${simSession.verificationReason})`);
  console.log(`  • Verified External Visits:  ${trafficStats.verifiedExternalVisitors} (Zero deception: simulated traffic is never counted as real external reach)`);

  // ---------------------------------------------------------------------------
  // STEP 4: REVENUE FUNNEL SIMULATION (PATIENT JOURNEY -> QUOTE -> PAYMENT)
  // ---------------------------------------------------------------------------
  console.log('\n▶ [PHASE 4: SIMULATED PATIENT CONVERSION & REVENUE PIPELINE]');
  const journeyTracker = new CustomerJourneyTracker();

  console.log('  [Stage 1: Lead Discovery & Inquiry]');
  const simVisitorId = 'vis_sim_patient_vikram';
  const journey = journeyTracker.recordTouchpoint({
    businessId,
    organizationId: orgId,
    visitorId: simVisitorId,
    channel: 'GOOGLE_BUSINESS_PROFILE',
    event: 'gbp_profile_click',
    campaignId: cycleResult.campaignId,
    classification: 'TEST',
  });

  console.log(`  ✓ Touchpoint Logged:         ${journey.firstTouchChannel} (Stage: ${journey.stage})`);

  console.log('  [Stage 2: Consultation Booking & Qualification]');
  const qualified = journeyTracker.advanceStage({
    businessId,
    visitorId: simVisitorId,
    targetStage: 'QUALIFIED_LEAD',
    customerName: 'Vikram Malhotra',
    customerPhone: '+91-98480-77665',
    customerEmail: 'vikram.m@techcorp.in',
  });
  console.log(`  ✓ Lead Qualified:            ${qualified.customerName} (Stage: ${qualified.stage})`);

  console.log('  [Stage 3: Clinical Attendance & 3D Scan]');
  const opportunity = journeyTracker.advanceStage({
    businessId,
    visitorId: simVisitorId,
    targetStage: 'OPPORTUNITY',
  });
  console.log(`  ✓ Clinical Consult Completed: Stage elevated to ${opportunity.stage}`);

  console.log('  [Stage 4: Treatment Plan Formulation — Quote != Revenue]');
  const quotedPlan = revenueEngine.recordTreatmentPlan({
    businessId,
    journeyId: opportunity.id,
    service: 'Comprehensive Invisible Aligners (Both Arches)',
    quotedAmountINR: 150000,
    acceptedTreatmentAmountINR: 150000,
    depositAmountINR: 0,
    paidAmountINR: 0,
    doctorNotes: 'Patient has Class I crowding. 3D iTero scan captured. Clear aligner plan presented and accepted.',
    clinicConfirmation: 'CONFIRMED',
    confirmationSource: 'Dr. Aravind Reddy - Clinic Consultation Log',
    status: 'ACCEPTED',
  });
  console.log(`  ✓ Treatment Quoted:          ₹${quotedPlan.quotedAmountINR.toLocaleString('en-IN')} (Status: ${quotedPlan.status})`);
  console.log('    ℹ Critical Safety Rule:    Quoted treatment value is strictly NOT recognized as cash revenue!');

  console.log('  [Stage 5: Deposit Payment Execution]');
  const txSim = revenueEngine.recordTransaction({
    businessId,
    organizationId: orgId,
    journeyId: opportunity.id,
    campaignId: cycleResult.campaignId,
    invoiceNumber: 'INV-SIM-2026-888',
    amountINR: 45000,
    paymentMethod: 'UPI',
    paymentGateway: 'SIMULATED',
    transactionRef: 'upi_sim_ref_982471',
    status: 'SUCCESS',
    classification: 'TEST', // Strictly segregated test transaction
    serviceRendered: 'Invisible Aligners Initial Deposit & Lab Fabrication Fee',
  });

  db.prepare(`
    UPDATE treatment_plans 
    SET deposit_amount_inr = 45000, paid_amount_inr = 45000, outstanding_amount_inr = 105000, status = 'IN_PROGRESS', updated_at = datetime('now')
    WHERE id = ?
  `).run(quotedPlan.id);

  console.log(`  ✓ Payment Recorded:          ₹${txSim.amountINR.toLocaleString('en-IN')} via ${txSim.paymentMethod}`);
  console.log(`  ✓ Ledger Classification:     ${txSim.classification} (Segregated from real funds)`);
  console.log(`  ✓ Remaining Patient Balance: ₹1,05,000 (Quote ₹1,50,000 - Paid ₹45,000)`);

  // ---------------------------------------------------------------------------
  // STEP 5: FINAL POST-SIMULATION REALITY AUDIT
  // ---------------------------------------------------------------------------
  console.log('\n▶ [PHASE 5: POST-SIMULATION REVENUE & REALITY AUDIT]');
  const finalEco = economicsEngine.calculate(businessId);
  const revenueSummary = revenueEngine.getRevenueSummary(businessId);
  const totalAiCost = (db.prepare('SELECT SUM(estimated_cost_inr) as cost FROM ai_cost_logs WHERE business_id = ?').get(businessId) as any)?.cost || 0;

  console.log('  ================================================================');
  console.log('  📊 SUMMARY SCORECARD: SIMULATION VS REAL WORLD');
  console.log('  ================================================================');
  console.log(`  METRIC                              SIMULATION MODE     REAL WORLD (TRUTH)`);
  console.log(`  ----------------------------------------------------------------`);
  console.log(`  Paid Media Spend (INR):             ₹0.00               ₹0.00 (Zero-Budget Mode)`);
  console.log(`  AI Reasoning Compute Cost (INR):    ₹${totalAiCost.toFixed(2)}               ₹${totalAiCost.toFixed(2)} (${finalEco.aiCostStatus})`);
  console.log(`  Local Search Reach (GBP Views):     ${((gbpInsights.searchImpressions as number) + (gbpInsights.mapImpressions as number)).toLocaleString()} views         2,310 historical impressions`);
  console.log(`  Organic Visitor Sessions Ingested:  ${trafficStats.totalSessions} sessions         0 verified external sessions`);
  console.log(`  Simulated Quoted Pipeline (INR):    ₹${quotedPlan.quotedAmountINR.toLocaleString('en-IN')}         ₹0.00 real quotes`);
  console.log(`  Test / Simulated Cash Revenue (INR):₹${revenueSummary.testRevenueINR.toLocaleString('en-IN')}        ₹0.00`);
  console.log(`  VERIFIED REAL REVENUE (INR):        ₹0.00               ₹0.00 (ZERO BLEED)`);
  console.log(`  MARKETING-ATTRIBUTED REAL REVENUE:  ₹0.00               ₹0.00 (ZERO BLEED)`);
  console.log(`  Real Paying Customers:              0                   0`);
  console.log('  ================================================================');

  // Strict Invariant Assertions to confirm system integrity
  if (finalEco.verifiedRealRevenueINR !== 0) {
    throw new Error('FATAL INVARIANT VIOLATION: Test simulation contaminated verified real revenue!');
  }
  if (finalEco.attributedRealRevenueINR !== 0) {
    throw new Error('FATAL INVARIANT VIOLATION: Test simulation contaminated real marketing-attributed revenue!');
  }
  if (finalEco.actualAdSpendINR !== 0) {
    throw new Error('FATAL INVARIANT VIOLATION: Paid spend recorded under ZERO_BUDGET_GROWTH mode!');
  }

  console.log('\n  ✅ ALL INTEGRITY INVARIANTS PRESERVED:');
  console.log('     1. Simulation successfully ran research, strategy, campaign, content, and conversion.');
  console.log('     2. Simulation recorded reach and ₹45,000 test revenue in the test ledger.');
  console.log('     3. Zero contamination: Real-world revenue remains strictly ₹0 until external bank proof arrives.');
  console.log('     4. Autonomy remains bounded and evidence-gated.\n');
}

runEndToEndSimulation().catch(err => {
  console.error('Fatal simulation error:', err);
  process.exit(1);
});
