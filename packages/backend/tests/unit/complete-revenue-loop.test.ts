import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { AutonomyPolicyController } from '../../src/revenue/autonomy-policy.js';
import { OfferEngine } from '../../src/revenue/offer-engine.js';
import { OutboundEngine } from '../../src/revenue/outbound-engine.js';
import { SalesConversationEngine } from '../../src/revenue/sales-conversation-engine.js';
import { MeetingEngine } from '../../src/revenue/meeting-engine.js';
import { DeliveryEngine } from '../../src/revenue/delivery-engine.js';
import { LearningEngine } from '../../src/revenue/learning-engine.js';
import { ExperimentEngine } from '../../src/revenue/experiment-engine.js';
import { RevenueBottleneckEngine } from '../../src/revenue/revenue-bottleneck-engine.js';
import { RealityReportGenerator } from '../../src/revenue/reality-report-generator.js';
import app from '../../src/index.js';

describe('Complete Autonomous Revenue Loop — Truthful End-to-End System Tests', () => {
  const orgId = 'org_smilekraft_01';
  const bizId = 'biz_smilekraft_hyd';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  // 1. AutonomyPolicyController enforces ₹0 autonomous marketing spend policy & DPDP contactability
  it('1. AutonomyPolicyController enforces ₹0 spend policy and DPDP suppression', () => {
    const policy = AutonomyPolicyController.getInstance();

    // Zero-budget policy check: ₹0 spend is allowed
    const zeroSpend = policy.evaluateAction(orgId, 'OUTBOUND_SEND', {
      costINR: 0,
      channel: 'WHATSAPP'
    });
    expect(zeroSpend.allowed).toBe(true);

    // Paid marketing spend is strictly blocked
    const paidSpend = policy.evaluateAction(orgId, 'CAMPAIGN_LAUNCH', {
      costINR: 500,
      channel: 'META_ADS'
    });
    expect(paidSpend.allowed).toBe(false);
    expect(paidSpend.violatedRule).toBe('ZERO_BUDGET_POLICY');

    // DPDP contactability check: unsuppressed contact
    const contactable = policy.getContactSafety('+919876543210');
    expect(contactable).toBe('CONTACTABLE');

    // Suppress contact permanently
    policy.suppressContact('+919876543210', 'DO_NOT_CONTACT');
    const suppressed = policy.getContactSafety('+919876543210');
    expect(suppressed).toBe('DO_NOT_CONTACT');

    // Action targeting suppressed contact must be blocked
    const outreachToSuppressed = policy.evaluateAction(orgId, 'OUTBOUND_SEND', {
      costINR: 0,
      channel: 'WHATSAPP',
      targetContactId: '+919876543210'
    });
    expect(outreachToSuppressed.allowed).toBe(false);
    expect(outreachToSuppressed.violatedRule).toBe('CONTACT_SUPPRESSED');
  });

  // 2. OfferEngine creates structured commercial offers with pricing models and delivery terms
  it('2. OfferEngine creates commercial offers with qualification and pricing models', () => {
    const offerEngine = OfferEngine.getInstance();
    const offers = offerEngine.generateOffersForBusiness({
      businessId: bizId,
      organizationId: orgId,
      verticalId: 'HEALTHCARE_CLINIC',
      businessName: 'SmileKraft Dental Clinic'
    });

    expect(offers.length).toBeGreaterThan(0);
    const primaryOffer = offers[0];
    expect(primaryOffer.id).toBeDefined();
    expect(primaryOffer.priceINR).toBeGreaterThan(0);
    expect(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'REVENUE_SHARE', 'HYBRID']).toContain(primaryOffer.pricingModel);
    expect(primaryOffer.deliverables.length).toBeGreaterThan(0);
    expect(primaryOffer.deliveryTimeDays).toBeGreaterThan(0);

    const retrieved = offerEngine.getOffersForBusiness(bizId);
    expect(retrieved.length).toBe(offers.length);
  });

  // 3. OutboundEngine blocks unauthorized dispatch without live credentials
  it('3. OutboundEngine strictly returns BLOCKED_AUTHORIZATION when credentials are missing', async () => {
    const outbound = OutboundEngine.getInstance();
    const result = await outbound.dispatch({
      businessId: bizId,
      organizationId: orgId,
      channel: 'WHATSAPP',
      recipientId: 'rec_test_01',
      recipientContact: '+919988776655',
      body: 'Hello, are you interested in our dental smile assessment?'
    });

    expect(result.success).toBe(false);
    expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(result.externalId).toBeUndefined(); // Zero fake wamid!
  });

  // 4. OutboundEngine respects suppression and never contacts opted-out numbers
  it('4. OutboundEngine strictly suppresses dispatch to opted-out recipients', async () => {
    const policy = AutonomyPolicyController.getInstance();
    const phone = '+919111222333';
    policy.suppressContact(phone, 'DO_NOT_CONTACT');

    const outbound = OutboundEngine.getInstance();
    const result = await outbound.dispatch({
      businessId: bizId,
      organizationId: orgId,
      channel: 'WHATSAPP',
      recipientId: 'rec_suppressed_01',
      recipientContact: phone,
      body: 'Following up on your smile query'
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('SUPPRESSED');
    expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(result.error).toContain('Outbound blocked');
  });

  // 5. SalesConversationEngine deterministically routes replies and handles opt-out
  it('5. SalesConversationEngine classifies intents and automates opt-out suppression', async () => {
    const salesEngine = SalesConversationEngine.getInstance();

    // 1. Opt-out message
    const optOutRes = await salesEngine.handleInboundMessage({
      businessId: bizId,
      organizationId: orgId,
      channel: 'WHATSAPP',
      senderContact: '+919000000001',
      senderName: 'Test Contact',
      messageText: 'STOP. Please do not contact me ever again.'
    });

    expect(optOutRes.intent).toBe('DO_NOT_CONTACT');
    expect(optOutRes.suppressed).toBe(true);

    // Confirm DPDP suppression was recorded in policy controller
    const policy = AutonomyPolicyController.getInstance();
    const check = policy.getContactSafety('+919000000001');
    expect(check).toBe('DO_NOT_CONTACT');

    // 2. Ready to buy message
    const buyRes = await salesEngine.handleInboundMessage({
      businessId: bizId,
      organizationId: orgId,
      channel: 'WHATSAPP',
      senderContact: '+919000000002',
      senderName: 'Interested Buyer',
      messageText: 'I am ready to buy. Please send the payment link.'
    });

    expect(buyRes.intent).toBe('READY_TO_BUY');
    expect(buyRes.routedAction).toBe('SEND_PAYMENT_REQUEST');
  });

  // 6. MeetingEngine creates internal DB appointments but flags external calendar action as INTERNAL_AUTOMATION without live credentials
  it('6. MeetingEngine creates internal appointment without fabricating Google Calendar events', async () => {
    const meetingEngine = MeetingEngine.getInstance();
    const result = await meetingEngine.bookMeeting({
      businessId: bizId,
      organizationId: orgId,
      title: 'Consultation with Senior Orthodontist',
      startTime: new Date(Date.now() + 86400000).toISOString(),
      endTime: new Date(Date.now() + 90000000).toISOString(),
      attendees: [{ name: 'Vikram Joshi', email: 'vikram.j@gmail.com', phone: '+919822334455' }]
    });

    expect(result.success).toBe(true);
    expect(result.meetingId).toBeDefined();
    // In unconfigured environment without live Google Calendar OAuth, strictly classified as INTERNAL_AUTOMATION
    expect(result.actionClassification).toBe('INTERNAL_AUTOMATION');
    expect(result.provider).toBe('INTERNAL');
    expect(result.externalEventId).toBeUndefined();
  });

  // 7. DeliveryEngine manages service fulfillment lifecycle and retention trigger
  it('7. DeliveryEngine tracks customer fulfillment from activation to retention', async () => {
    const delivery = DeliveryEngine.getInstance();

    const activation = delivery.activateCustomer({
      organizationId: orgId,
      businessId: bizId,
      customerJourneyId: 'journey_01',
      serviceType: 'Clear Aligner Treatment',
      paidAmountINR: 35000
    });

    expect(activation.taskId).toBeDefined();
    expect(activation.stage).toBe('ONBOARDING');
    expect(activation.actionClassification).toBe('INTERNAL_AUTOMATION');

    // Request review & referral for customer
    const referralRes = await delivery.requestReferralAndReview(orgId, bizId, 'journey_01');
    // Without live WhatsApp credentials, referral outreach is safely classified as BLOCKED_AUTHORIZATION
    expect(referralRes.actionClassification).toBe('BLOCKED_AUTHORIZATION');
  });

  // 8. ExperimentEngine marks low-sample experiments as INCONCLUSIVE (<30 samples)
  it('8. ExperimentEngine evaluates low-sample cohort as INCONCLUSIVE with zero false victories', () => {
    const db = getDb();
    const expId = 'exp_sample_test_01';

    db.prepare(`
      INSERT INTO experiments (
        id, organization_id, business_id, title, hypothesis, baseline,
        treatment, success_metric, minimum_evidence_requirement, expected_effect,
        start_date, status, metrics_json
      ) VALUES (?, ?, ?, 'Pricing Test', 'Lower upfront increases volume', 'standard', 'discounted', 'conversion_rate', 30, '+15% volume', '2026-09-01', 'RUNNING', ?)
    `).run(expId, orgId, bizId, JSON.stringify({
      baselineSamples: 12,
      baselineConversions: 2,
      treatmentSamples: 14,
      treatmentConversions: 3
    }));

    const expEngine = ExperimentEngine.getInstance();
    const evaluation = expEngine.evaluate(expId);

    expect(evaluation.status).toBe('INCONCLUSIVE');
    expect(evaluation.reason).toContain('Insufficient sample size');
    expect(evaluation.winnerVariant).toBeUndefined();
  });

  // 9. LearningEngine strictly isolates real-world learnings from simulation data
  it('9. LearningEngine isolates REAL_WORLD_LEARNING from SIMULATION_INSIGHT', () => {
    const learningEngine = LearningEngine.getInstance();

    learningEngine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'SIMULATION_INSIGHT',
      decision: 'Adjust aligner budget',
      hypothesis: 'Higher intent at evening hours',
      action: 'Run simulation',
      audience: 'Young professionals',
      offer: 'Aligner promo',
      channel: 'WHATSAPP',
      result: 'Projected 20% lift',
      evidence: { simulation: true }
    });

    learningEngine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Send price card',
      hypothesis: 'Direct pricing resolves objections',
      action: 'Deliver pricing sheet',
      audience: 'Inbound lead',
      offer: 'Aligner consultation',
      channel: 'WHATSAPP',
      result: 'Verified patient payment received',
      evidence: { forceRealAudit: true, transactionId: 'txn_real_01' }
    });

    const db = getDb();
    const realRecords = db.prepare(`SELECT * FROM learning_records WHERE business_id = ? AND learning_type = 'REAL_WORLD_LEARNING'`).all(bizId);
    expect(realRecords.length).toBe(1);

    const simRecords = db.prepare(`SELECT * FROM learning_records WHERE business_id = ? AND learning_type = 'SIMULATION_INSIGHT'`).all(bizId);
    expect(simRecords.length).toBe(1);
  });

  // 10. RevenueBottleneckEngine diagnoses root cause blockers truthfully
  it('10. RevenueBottleneckEngine accurately diagnoses pipeline blockers', () => {
    const bottleneckEngine = RevenueBottleneckEngine.getInstance();
    const diagnosis = bottleneckEngine.diagnose(bizId, orgId);

    expect(diagnosis.bottleneck).toBeDefined();
    expect(diagnosis.severity).toBeDefined();
    expect(diagnosis.effect).toBeDefined();
    expect(diagnosis.bestNextAction).toBeDefined();
    expect(['AUTHORIZED_OUTBOUND_MISSING', 'NO_PROSPECTS', 'NO_PAYMENT_METHOD', 'QUOTA_LIMITED', 'NONE_REVENUE_FLOWING']).toContain(diagnosis.bottleneck);
  });

  // 11. RealityReportGenerator & Proof Endpoints return 100% verified DB truth
  it('11. RealityReportGenerator and proof endpoints report zero unverified revenue', async () => {
    const res = await app.request('/api/v1/system/reality-report');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.runtime).toBeDefined();
    expect(json.data.revenue.verifiedClientRevenueINR).toBe(0); // Zero fake revenue
    expect(json.data.revenue.verifiedPlatformRevenueINR).toBe(0);
    expect(json.data.actualExternalActions).toBe(0); // Zero fake actions

    // Check revenue proof endpoint
    const proofRes = await app.request('/api/v1/revenue/proof');
    expect(proofRes.status).toBe(200);
    const proofJson = await proofRes.json() as any;
    expect(proofJson.success).toBe(true);
    expect(proofJson.data.verified_revenue).toBe(0);
    expect(proofJson.data.zero_paid_spend_verified).toBe(true);

    // Check bottleneck endpoint
    const bottleRes = await app.request('/api/v1/revenue/bottleneck');
    expect(bottleRes.status).toBe(200);
    const bottleJson = await bottleRes.json() as any;
    expect(bottleJson.success).toBe(true);
    expect(bottleJson.data.bottleneck).toBeDefined();
  });
});
