import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { LiveProviderActivation } from '../../src/revenue/live-provider-activation.js';
import { CommercialLifecycleManager } from '../../src/revenue/commercial-lifecycle.js';
import { FirstLiveCommercialActionManager } from '../../src/revenue/first-live-commercial-action.js';
import { PlatformCommercialEngine } from '../../src/revenue/platform-commercial-engine.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { DeliveryBlueprintManager } from '../../src/revenue/delivery-blueprint.js';
import { SalesConversationEngine } from '../../src/revenue/sales-conversation-engine.js';
import { LearningEngine } from '../../src/revenue/learning-engine.js';
import app from '../../src/index.js';

describe('Commercial Activation & Live Sales Reality Suite (Spec §§ 2–34)', () => {
  const orgId = 'org_smilekraft_01';
  const bizId = 'biz_smilekraft_hyd';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  // 1. Live Provider Activation: Unconfigured providers accurately reported
  it('1. LiveProviderActivation reports NOT_CONFIGURED when live credentials are missing', () => {
    const activation = LiveProviderActivation.getInstance();
    const statuses = activation.getAllStatuses();

    expect(statuses.OUTBOUND_WHATSAPP.state).toBe('NOT_CONFIGURED');
    expect(statuses.OUTBOUND_EMAIL.state).toBe('NOT_CONFIGURED');
    expect(statuses.CALENDAR.state).toBe('NOT_CONFIGURED');
    expect(statuses.PAYMENTS.state).toBe('NOT_CONFIGURED');

    // Storage is always healthy (SQLite in local/test)
    expect(statuses.STORAGE.isLiveVerified).toBe(false);

    // Diagnostics report exact setup required
    const diagnostic = activation.getMissingProviderDiagnostic(bizId, orgId);
    expect(diagnostic.blocker).toBe('OUTBOUND_UNAVAILABLE');
    expect(diagnostic.nextHumanSetup).toContain('Configure one approved outbound provider');
    expect(diagnostic.expectedUnlock).toContain('LIVE_EXTERNAL_ACTION');
  });

  // 2. Commercial Lifecycle State evaluates to COMMERCIAL_READY without false promotion
  it('2. CommercialLifecycle evaluates strictly to COMMERCIAL_READY when live external actions are 0', () => {
    const lifecycleMgr = CommercialLifecycleManager.getInstance();
    const evaluation = lifecycleMgr.evaluateState(orgId, bizId);

    expect(evaluation.currentState).toBe('COMMERCIAL_READY');
    expect(evaluation.highestProvenMilestone).toBe('M0_NO_LIVE_PROVIDERS');
    expect(evaluation.liveExternalActionsCount).toBe(0);
    expect(evaluation.verifiedCustomersCount).toBe(0);
    expect(evaluation.verifiedClientRevenueINR).toBe(0);
    expect(evaluation.verifiedPlatformRevenueINR).toBe(0);
  });

  // 3. FirstLiveCommercialActionManager blocks execution without live provider
  it('3. FirstLiveCommercialActionManager returns BLOCKED_AUTHORIZATION without live provider', async () => {
    const actionMgr = FirstLiveCommercialActionManager.getInstance();
    const result = await actionMgr.executeFirstOutbound({
      organizationId: orgId,
      businessId: bizId,
      opportunityId: 'opp_test_first_01',
      sequenceStep: 1,
      channel: 'WHATSAPP',
      recipientPhone: '+919876543210',
      recipientName: 'Dr. Ramesh Gupta',
      businessName: 'Apex Dental Care',
      observedPainPoint: 'Delayed response to evening website inquiries',
      proposedOutcome: 'Sub-2 minute automated patient qualification and appointment booking',
      messageText: 'Hello Dr. Ramesh, would you be open to a 10-minute demonstration?',
      purpose: 'FIRST_COMMERCIAL_OUTBOUND_TEST'
    });

    expect(result.executed).toBe(false);
    expect(result.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(result.milestoneAchieved).toBe(false);
    expect(result.liveExternalActionsCount).toBe(0);
    expect(result.reason).toContain('NOT_CONFIGURED');
  });

  // 4. FirstLiveCommercialActionManager enforces idempotency
  it('4. FirstLiveCommercialActionManager enforces strict idempotency on duplicate invocation', async () => {
    const db = getDb();
    const idempotencyKey = 'outreach:opp_idemp_01:1';

    // Seed prior executed action in idempotent_actions
    db.prepare(`
      INSERT INTO idempotent_actions (idempotency_key, action_type, target_id, tenant_id, executed_at, status, result_json)
      VALUES (?, 'OUTREACH_SEND', 'opp_idemp_01', ?, datetime('now'), 'SUCCESS', '{"externalId":"wamid.test12345"}')
    `).run(idempotencyKey, orgId);

    const actionMgr = FirstLiveCommercialActionManager.getInstance();
    const result = await actionMgr.executeFirstOutbound({
      organizationId: orgId,
      businessId: bizId,
      opportunityId: 'opp_idemp_01',
      sequenceStep: 1,
      channel: 'WHATSAPP',
      recipientPhone: '+919876543210',
      recipientName: 'Dr. Ramesh Gupta',
      businessName: 'Apex Dental Care',
      observedPainPoint: 'Delayed response',
      proposedOutcome: 'Sub-2 min triage',
      messageText: 'Hello Dr. Ramesh',
      purpose: 'IDEMPOTENCY_TEST'
    });

    expect(result.executed).toBe(false);
    expect(result.actionClassification).toBe('IDEMPOTENT_SKIPPED');
    expect(result.reason).toContain('already executed');
  });

  // 5. PlatformCommercialEngine creates the standard offer and personalized outreach
  it('5. PlatformCommercialEngine creates standard offer and personalized pitch without hallucinations', () => {
    const commEngine = PlatformCommercialEngine.getInstance();
    const offer = commEngine.getStandardOffer();

    expect(offer.name).toBe('AI Inbound Lead Conversion System');
    expect(offer.setupPriceINR).toBe(15000);
    expect(offer.monthlyPriceINR).toBe(8000);
    expect(offer.deliveryPeriodDays).toBe(5);
    expect(offer.scope.length).toBeGreaterThan(3);
    expect(offer.limitations.length).toBeGreaterThan(1);

    const prospect = commEngine.qualifyAndGenerateOffer({
      id: 'prospect_apex_01',
      businessName: 'Apex Dental Care',
      vertical: 'HEALTHCARE_CLINIC',
      city: 'Hyderabad',
      contactPhone: '+919849011122',
      contactEmail: 'info@apexdental.in',
      websiteUrl: 'https://apexdentalcare.in',
      observedResponseTimeHours: 3.5,
      hasInstantWhatsAppBot: false
    });

    expect(prospect.offerFitScore).toBeGreaterThanOrEqual(0.8);
    expect(prospect.observedEvidence.gapObserved).toContain('3.5h delay');

    const pitch = commEngine.generatePersonalizedPitch(prospect, 'WHATSAPP');
    expect(pitch.messageText).toContain('Apex Dental Care');
    expect(pitch.messageText).toContain('Hyderabad');
    expect(pitch.messageText).toContain('under 2 minutes');
    expect(pitch.messageText).not.toContain('fabricated');
  });

  // 6. PlatformCommercialEngine quiet hours policy
  it('6. PlatformCommercialEngine enforces quiet hours outside 09:00-20:00 IST', () => {
    const commEngine = PlatformCommercialEngine.getInstance();

    // 11:00 PM IST = 17:30 UTC
    const nightDate = new Date('2026-09-26T17:30:00Z');
    const nightCheck = commEngine.evaluateOutboundDispatchEligibility(nightDate);
    expect(nightCheck.allowed).toBe(false);
    expect(nightCheck.isQuietHours).toBe(true);

    // 2:00 PM IST = 08:30 UTC
    const dayDate = new Date('2026-09-26T08:30:00Z');
    const dayCheck = commEngine.evaluateOutboundDispatchEligibility(dayDate);
    expect(dayCheck.allowed).toBe(true);
    expect(dayCheck.isQuietHours).toBe(false);
  });

  // 7. SalesConversationEngine: Complete 13-intent deterministic playbook
  it('7. SalesConversationEngine handles all 13 distinct conversation intents deterministically', async () => {
    const salesEngine = SalesConversationEngine.getInstance();

    const testCases: Array<{ message: string; expectedIntent: string; expectedAction: string }> = [
      { message: 'I am ready to buy. Please send the payment link.', expectedIntent: 'READY_TO_BUY', expectedAction: 'SEND_PAYMENT_REQUEST' },
      { message: 'Could we schedule a live demo or meeting tomorrow?', expectedIntent: 'DEMO_REQUEST', expectedAction: 'BOOK_MEETING' },
      { message: 'How much does the setup cost?', expectedIntent: 'PRICE_QUESTION', expectedAction: 'SEND_PRICING_DETAILS' },
      { message: 'What is the implementation process and timeline?', expectedIntent: 'HOW_IT_WORKS', expectedAction: 'SEND_DELIVERY_ROADMAP' },
      { message: 'What does your company actually do?', expectedIntent: 'WHAT_DO_YOU_DO', expectedAction: 'SEND_VALUE_PROPOSITION' },
      { message: 'Do you have any case studies or previous results for dental clinics?', expectedIntent: 'CASE_STUDY_REQUEST', expectedAction: 'SEND_CASE_STUDY' },
      { message: 'The price seems a bit too expensive for our budget right now.', expectedIntent: 'OBJECTION_PRICE', expectedAction: 'SEND_ROI_BREAKDOWN' },
      { message: 'We are very busy this quarter, contact me next month.', expectedIntent: 'OBJECTION_TIMING', expectedAction: 'DEFER_FOLLOW_UP' },
      { message: 'I need to consult my partners and get director approval.', expectedIntent: 'NEEDS_APPROVAL', expectedAction: 'SEND_EXECUTIVE_SUMMARY' },
      { message: 'Please email me the brochure and details.', expectedIntent: 'SEND_DETAILS', expectedAction: 'SEND_OFFER_BRIEF' },
      { message: 'Yes, tell me more about how this works.', expectedIntent: 'INTERESTED', expectedAction: 'SEND_QUALIFICATION_PROMPT' },
      { message: 'Not interested at all, thank you.', expectedIntent: 'NOT_INTERESTED', expectedAction: 'CLOSE_OPPORTUNITY' },
      { message: 'STOP messaging me. Unsubscribe immediately.', expectedIntent: 'DO_NOT_CONTACT', expectedAction: 'PERMANENT_SUPPRESSION' }
    ];

    for (const tc of testCases) {
      const res = await salesEngine.handleInboundMessage({
        businessId: bizId,
        organizationId: orgId,
        senderContact: '+919876500000',
        channel: 'WHATSAPP',
        messageText: tc.message
      });

      expect(res.intent).toBe(tc.expectedIntent);
      expect(res.routedAction).toBe(tc.expectedAction);
      expect(res.responseTemplate).toBeDefined();
    }
  });

  // 8. ProposalEngine creates immutable proposals and handles acceptance
  it('8. ProposalEngine creates immutable proposals and generates payment link upon acceptance', () => {
    const proposalEngine = ProposalEngine.getInstance();
    const proposal = proposalEngine.createProposal({
      organizationId: orgId,
      businessId: bizId,
      prospectId: 'prospect_apex_01',
      title: 'AI Lead Conversion System for Apex Dental',
      customerProblem: 'Inquiries outside business hours take average 3.5h to be answered.',
      proposedSolution: '24/7 automated WhatsApp qualification and Google Business Profile appointment booking.',
      deliverables: [
        'WhatsApp 24/7 triage bot',
        'Google Business Profile integration',
        'Automated appointment calendar reminders'
      ],
      setupPriceINR: 15000,
      monthlyPriceINR: 8000,
      timelineDays: 5
    });

    expect(proposal.id).toBeDefined();
    expect(proposal.setupPriceINR).toBe(15000);
    expect(proposal.monthlyPriceINR).toBe(8000);
    expect(proposal.status).toBe('SENT');

    // Duplicate create with same prospectId returns same proposal (idempotency)
    const duplicate = proposalEngine.createProposal({
      organizationId: orgId,
      businessId: bizId,
      prospectId: 'prospect_apex_01',
      title: 'Different Title',
      customerProblem: 'Different Problem',
      proposedSolution: 'Different Solution',
      deliverables: [],
      setupPriceINR: 50000 // Attempted price change
    });

    expect(duplicate.id).toBe(proposal.id);
    expect(duplicate.setupPriceINR).toBe(15000); // Immutability preserved!

    // Accept proposal
    const acceptRes = proposalEngine.acceptProposal(proposal.id);
    expect(acceptRes.proposal.status).toBe('ACCEPTED');
    expect(acceptRes.paymentLink).toContain('lead-conversion-setup-');
  });

  // 9. DeliveryBlueprint: 5-Day fulfillment and outcome measurement
  it('9. DeliveryBlueprint defines canonical 5-day roadmap and captures customer outcomes', () => {
    const bpManager = DeliveryBlueprintManager.getInstance();
    const blueprint = bpManager.get5DayBlueprint();

    expect(blueprint.length).toBe(6); // Day 0 to Day 5
    expect(blueprint[0].day).toBe(0);
    expect(blueprint[0].name).toContain('Customer Activation');
    expect(blueprint[5].day).toBe(5);
    expect(blueprint[5].name).toContain('Handover & Baseline Report');

    // Record verified outcome
    const outcome = bpManager.recordCustomerResult({
      customerJourneyId: 'journey_test_01',
      businessId: bizId,
      organizationId: orgId,
      inboundLeads: 45,
      sub2MinResponses: 44,
      appointmentsBooked: 18,
      appointmentsAttended: 15,
      customersClosed: 6,
      customerBusinessRevenueINR: 210000,
      platformRevenueINR: 15000,
      averageResponseSeconds: 78
    });

    expect(outcome.customerBusinessRevenueINR).toBe(210000);
    expect(outcome.platformRevenueINR).toBe(15000);
    expect(outcome.averageResponseTimeSeconds).toBe(78);

    // Verify segregation: client business revenue vs platform subscription revenue
    const db = getDb();
    const platRevenue = db.prepare(`SELECT SUM(amount_inr) as total FROM revenue_records WHERE revenue_type = 'PLATFORM_REVENUE'`).get() as any;
    expect(platRevenue.total).toBe(15000);
  });

  // 10. Complete Test Simulation Path (Spec § 30)
  it('10. End-to-end simulated customer acquisition path is strictly tagged as TEST classification', async () => {
    const db = getDb();
    const lifecycleMgr = CommercialLifecycleManager.getInstance();

    // Record verified test evidence for each milestone
    lifecycleMgr.recordEvidence({
      milestone: 'M1_FIRST_LIVE_OUTBOUND',
      provider: 'WHATSAPP_TEST_HARNESS',
      externalId: 'wamid.sim_test_01',
      requestReference: 'outreach:opp_sim:1',
      tenantId: orgId,
      businessId: bizId,
      classification: 'TEST',
      verificationSource: 'AUTOMATED_SIMULATION_HARNESS',
      details: { simulation: true }
    });

    lifecycleMgr.recordEvidence({
      milestone: 'M6_FIRST_VERIFIED_PAYMENT',
      provider: 'RAZORPAY_TEST_WEBHOOK',
      externalId: 'pay_sim_test_01',
      requestReference: 'pay:prop_sim_01',
      tenantId: orgId,
      businessId: bizId,
      classification: 'TEST',
      verificationSource: 'WEBHOOK_SIGNATURE_VERIFIED_MOCK',
      details: { amountINR: 15000 }
    });

    // Verification: Reality state MUST remain COMMERCIAL_READY and ZERO live external actions
    // because all test evidence was classified as TEST, NOT REAL!
    const state = lifecycleMgr.evaluateState(orgId, bizId);
    expect(state.currentState).toBe('COMMERCIAL_READY');
    expect(state.liveExternalActionsCount).toBe(0);
    expect(state.verifiedPlatformRevenueINR).toBe(0);
  });

  // 11. API Endpoints: /autonomy/next-real-action and /commercial/* endpoints
  it('11. Commercial activation API endpoints return accurate diagnostic state', async () => {
    // 1. Next Real Action
    const nextActionRes = await app.request('/api/v1/autonomy/next-real-action');
    expect(nextActionRes.status).toBe(200);
    const nextActionJson = await nextActionRes.json() as any;
    expect(nextActionJson.success).toBe(true);
    expect(nextActionJson.data.action).toBeDefined();
    expect(nextActionJson.data.required_capability).toBeDefined();

    // 2. Commercial Lifecycle
    const lifecycleRes = await app.request('/api/v1/commercial/lifecycle');
    expect(lifecycleRes.status).toBe(200);
    const lifecycleJson = await lifecycleRes.json() as any;
    expect(lifecycleJson.success).toBe(true);
    expect(lifecycleJson.data.currentState).toBe('COMMERCIAL_READY');
    expect(lifecycleJson.data.highestProvenMilestone).toBe('M0_NO_LIVE_PROVIDERS');

    // 3. Commercial Providers Status
    const provRes = await app.request('/api/v1/commercial/providers');
    expect(provRes.status).toBe(200);
    const provJson = await provRes.json() as any;
    expect(provJson.success).toBe(true);
    expect(provJson.data.providers.OUTBOUND_WHATSAPP).toBeDefined();
    expect(provJson.data.diagnostic.blocker).toBe('OUTBOUND_UNAVAILABLE');

    // 4. Reality Report Software vs Commercial separation
    const reportRes = await app.request('/api/v1/system/reality-report');
    expect(reportRes.status).toBe(200);
    const reportJson = await reportRes.json() as any;
    expect(reportJson.success).toBe(true);
    expect(reportJson.data.commercialLifecycleState).toBe('COMMERCIAL_READY');
    expect(reportJson.data.softwareCapabilities.softwareReady).toBe(true);
    expect(reportJson.data.softwareCapabilities.commercialReady).toBe(true);
    expect(reportJson.data.commercialProofs.liveExternalActions).toBe(0);
    expect(reportJson.data.commercialProofs.verifiedPlatformRevenueINR).toBe(0);
  });
});
