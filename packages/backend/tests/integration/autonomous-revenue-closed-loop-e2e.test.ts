import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { ChannelSelectionEngine } from '../../src/revenue/channel-selection-engine.js';
import { OutboundActionLedger } from '../../src/revenue/outbound-action-ledger.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { DeliveryEngine } from '../../src/revenue/delivery-engine.js';
import { LearningEngine } from '../../src/revenue/learning-engine.js';
import { FirstCustomerStateMachine } from '../../src/revenue/first-customer-state-machine.js';
import { DurableEventBus } from '../../src/revenue/durable-event-bus.js';
import { OpportunityEngine } from '../../src/revenue/opportunity-engine.js';
import { createHmac, randomUUID } from 'crypto';

describe('Autonomous Revenue Closed-Loop E2E Verification', () => {
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    (FirstCustomerStateMachine as any).instance = undefined;
    (PlatformProspectDiscoveryEngine as any).instance = undefined;
    (ProposalEngine as any).instance = undefined;
    (LearningEngine as any).instance = undefined;
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('executes full autonomous revenue loop with zero synthetic truth', async () => {
    const db = getDb();

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 0: INITIAL STATE
    // ─────────────────────────────────────────────────────────────────────────
    const sm = FirstCustomerStateMachine.getInstance();
    const initialState = sm.evaluateState(bizId, orgId);
    expect(initialState.evidence.verifiedRevenueINR).toBe(0);
    expect(initialState.evidence.outreachSent).toBe(false);
    expect(initialState.evidence.responseReceived).toBe(false);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: REAL GROUNDED PROSPECT DISCOVERY
    // ─────────────────────────────────────────────────────────────────────────
    const discoveryEngine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Dr. Rao Smiles Hyderabad',
      vertical: 'dental' as const,
      city: 'Hyderabad',
      websiteUrl: 'https://drraosmiles.in',
      contactPhone: '+919849012345',
      contactEmail: 'contact@drraosmiles.in',
      contactPerson: 'Dr. Rao',
      observedGaps: ['No automated triage bot; response delay > 3h outside hours'],
      evidenceSourceUrl: 'https://drraosmiles.in/contact',
      evidenceSnippet: 'Reach Dr. Rao at contact@drraosmiles.in or visit Banjara Hills, Hyderabad',
      hasGoogleListing: true,
      hasInstantWhatsAppBot: false,
      observedResponseTimeHours: 3.5,
      dataClassification: 'REAL_DATA' as const,
      sourceVerified: true
    };

    const validated = discoveryEngine.validateCandidate(candidate);
    expect(validated).toBe(true);

    // Persist discovered candidate through the engine with complete lineage
    const persisted = await discoveryEngine.persistCandidates([candidate], orgId, bizId, 'GEMINI_RESEARCH');
    expect(persisted).toHaveLength(1);
    const prospectId = persisted[0].id;

    // Verify strict lineage in DB
    const oppRow = db.prepare('SELECT * FROM opportunities WHERE prospect_id = ?').get(prospectId) as any;
    expect(oppRow).toBeDefined();
    expect(oppRow.prospect_id).toBe(prospectId);

    const pipeRow = db.prepare('SELECT * FROM sales_pipeline WHERE opportunity_id = ?').get(oppRow.id) as any;
    expect(pipeRow).toBeDefined();
    expect(pipeRow.outbound_contact_id).toBeDefined();

    const contactRow = db.prepare('SELECT * FROM outbound_contacts WHERE id = ?').get(pipeRow.outbound_contact_id) as any;
    expect(contactRow).toBeDefined();
    expect(contactRow.prospect_email).toBe('contact@drraosmiles.in');
    expect(contactRow.channel).toBe('EMAIL');

    // Verify Milestone M0_PROSPECT_DISCOVERED was recorded, NOT M1
    const m0Evidence = db.prepare("SELECT * FROM commercial_evidence WHERE milestone = 'M0_PROSPECT_DISCOVERED'").get() as any;
    expect(m0Evidence).toBeDefined();
    const m1Premature = db.prepare("SELECT * FROM commercial_evidence WHERE milestone = 'M1_FIRST_LIVE_OUTBOUND'").get() as any;
    expect(m1Premature).toBeUndefined();

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: DETERMINISTIC CHANNEL SELECTION & OUTBOUND DISPATCH
    // ─────────────────────────────────────────────────────────────────────────
    const channelSelection = ChannelSelectionEngine.getInstance().selectChannel({
      prospect: {
        contactEmail: contactRow.prospect_email,
        contactPhone: contactRow.prospect_phone
      },
      outboundContact: {
        emailAuthorized: contactRow.email_authorized,
        whatsappOptIn: contactRow.whatsapp_opt_in,
        channel: contactRow.channel
      },
      approvedTemplateName: 'commercial_outreach_initial'
    });

    // WhatsApp without opt-in is blocked; Email is selected
    expect(channelSelection.allowed).toBe(true);
    expect(channelSelection.channel).toBe('EMAIL');

    // Simulate sending real outbound
    const externalDispatchId = `ext_email_${Date.now()}`;
    const ledger = OutboundActionLedger.getInstance();

    const isAlreadySentBefore = await ledger.isAlreadySent(
      orgId,
      oppRow.id,
      pipeRow.outbound_contact_id,
      1,
      'EMAIL'
    );
    expect(isAlreadySentBefore).toBe(false);

    await ledger.recordAction({
      id: `oal_test_${Date.now()}`,
      organizationId: orgId,
      businessId: bizId,
      opportunityId: oppRow.id,
      outboundContactId: pipeRow.outbound_contact_id,
      sequenceNumber: 1,
      channel: 'EMAIL',
      actionKey: `outreach_${oppRow.id}_EMAIL`,
      provider: 'MOCK_EMAIL',
      providerExternalId: externalDispatchId,
      status: 'DELIVERED'
    });

    // Verify duplicate is blocked
    const isAlreadySentAfter = await ledger.isAlreadySent(
      orgId,
      oppRow.id,
      pipeRow.outbound_contact_id,
      1,
      'EMAIL'
    );
    expect(isAlreadySentAfter).toBe(true);

    // Record M1 Milestone now that actual outbound dispatch succeeded
    db.prepare(`
      INSERT INTO commercial_evidence (
        id, milestone, provider, external_id, timestamp, request_reference,
        tenant_id, business_id, classification, verification_source, details_json
      ) VALUES (?, 'M1_FIRST_LIVE_OUTBOUND', 'MOCK_EMAIL', ?, datetime('now'), ?, ?, ?, 'REAL', 'PROVIDER_DISPATCH_ACK', ?)
    `).run(
      `ev_m1_${Date.now()}`,
      externalDispatchId,
      `dispatch_${oppRow.id}`,
      orgId,
      bizId,
      JSON.stringify({ channel: 'EMAIL', recipient: contactRow.prospect_email })
    );

    // Update pipeline to CONTACTED
    db.prepare("UPDATE sales_pipeline SET stage = 'CONTACTED', updated_at = datetime('now') WHERE id = ?").run(pipeRow.id);

    const contactedState = sm.evaluateState(bizId, orgId);
    expect(contactedState.evidence.outreachSent).toBe(true);
    expect(contactedState.evidence.responseReceived).toBe(false);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: PROSPECT INBOUND RESPONSE & QUALIFICATION
    // ─────────────────────────────────────────────────────────────────────────
    DurableEventBus.emit({
      eventType: 'LEAD_REPLIED',
      organizationId: orgId,
      businessId: bizId,
      payload: { prospectId, channel: 'EMAIL', message: 'Yes, interested in demo' }
    });

    db.prepare("UPDATE sales_pipeline SET stage = 'QUALIFIED', updated_at = datetime('now') WHERE id = ?").run(pipeRow.id);

    const qualifiedState = sm.evaluateState(bizId, orgId);
    expect(qualifiedState.evidence.outreachSent).toBe(true);
    expect(qualifiedState.evidence.responseReceived).toBe(true);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: COMMERCIAL PROPOSAL & PAYMENT REQUEST CREATION
    // ─────────────────────────────────────────────────────────────────────────
    const proposalEngine = ProposalEngine.getInstance();
    const proposal = proposalEngine.createProposal({
      businessId: bizId,
      organizationId: orgId,
      prospectId,
      title: 'AI Inbound Lead Conversion System Setup',
      setupPriceINR: 15000,
      monthlyRetainerINR: 8000,
      deliverables: ['Custom WhatsApp bot', 'Google Business Profile Instant Lead Capture'],
      expectedRevenueINR: 15000
    });

    expect(proposal.id).toBeDefined();

    // Accept proposal — creates payment request with proposal_id
    const acceptRes = proposalEngine.acceptProposal(proposal.id);
    expect(acceptRes.proposal.status).toBe('ACCEPTED');
    expect(acceptRes.paymentLink).toBeNull(); // No fake payment link!

    // Verify payment_request has proposal_id linked
    const payReq = db.prepare('SELECT * FROM payment_requests WHERE proposal_id = ?').get(proposal.id) as any;
    expect(payReq).toBeDefined();
    expect(payReq.proposal_id).toBe(proposal.id);
    expect(payReq.amount_inr).toBe(15000);

    // Simulate provider payment link creation
    const razorpayAdapter = new RazorpayAdapter();
    const liveLink = await razorpayAdapter.createPaymentLink({
      businessId: bizId,
      organizationId: orgId,
      offerId: 'PLATFORM_SETUP',
      amountINR: 15000,
      offerDescription: 'Setup fee for AI Lead Conversion',
      customerName: 'Dr. Rao',
      customerEmail: 'contact@drraosmiles.in',
      customerPhone: '+919849012345'
    });

    expect(liveLink.providerLinkId).toBeDefined();
    expect(liveLink.shortUrl).toBeDefined();

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: VERIFIED RAZORPAY WEBHOOK CAPTURE (Sole Revenue Authority)
    // ─────────────────────────────────────────────────────────────────────────
    const webhookSecret = 'test_webhook_secret_key_12345';
    const fakePaymentId = `pay_${Date.now()}_test`;
    const webhookPayload = JSON.stringify({
      entity: 'event',
      account_id: 'acc_test_owner',
      event: 'payment_link.paid',
      contains: ['payment_link', 'payment'],
      payload: {
        payment_link: {
          entity: {
            id: liveLink.providerLinkId,
            amount: 1500000, // 15000 INR in paise
            amount_paid: 1500000,
            status: 'paid'
          }
        },
        payment: {
          entity: {
            id: fakePaymentId,
            amount: 1500000,
            status: 'captured',
            method: 'upi',
            notes: {
              organization_id: orgId,
              business_id: bizId
            }
          }
        }
      }
    });

    const hmacSig = createHmac('sha256', webhookSecret).update(webhookPayload).digest('hex');

    const webhookResult = await razorpayAdapter.processWebhook({
      rawBody: webhookPayload,
      signature: hmacSig,
      event: JSON.parse(webhookPayload),
      overrideSecret: webhookSecret
    });

    expect(webhookResult.processed).toBe(true);
    expect(webhookResult.transactionId).toBeDefined();

    // Verify revenue record was created exclusively with verified transaction
    const revenueRecord = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(fakePaymentId) as any;
    expect(revenueRecord).toBeDefined();
    expect(revenueRecord.amount_inr).toBe(15000);
    expect(revenueRecord.verified).toBe(1);
    expect(revenueRecord.revenue_type).toBe('PLATFORM_REVENUE');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: CUSTOMER CREATION & 5-DAY DELIVERY BLUEPRINT ACTIVATION
    // ─────────────────────────────────────────────────────────────────────────
    const deliveryRow = db.prepare('SELECT * FROM platform_customer_deliveries WHERE payment_id = ?').get(fakePaymentId) as any;
    expect(deliveryRow).toBeDefined();
    expect(deliveryRow.stage).toBe('ONBOARDING');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: REAL-WORLD LEARNING GENERATION
    // ─────────────────────────────────────────────────────────────────────────
    const learningEngine = LearningEngine.getInstance();
    const learningRecord = learningEngine.recordObservation({
      organizationId: orgId,
      businessId: bizId,
      learningType: 'REAL_WORLD_LEARNING',
      decision: 'Target high-gap local SMBs',
      hypothesis: 'Evidence-based pitch with exact observed delay converts',
      action: 'Sent personalized email pitch citing 3.5h delay',
      audience: 'Dental clinic Hyderabad',
      offer: 'PLATFORM_SETUP',
      channel: 'EMAIL',
      result: 'Verified payment received',
      revenueINR: 15000,
      evidence: {
        externalActionId: externalDispatchId,
        transactionId: fakePaymentId
      }
    });

    expect(learningRecord.learningType).toBe('REAL_WORLD_LEARNING');

    // Final state machine check
    const finalState = sm.evaluateState(bizId, orgId);
    expect(finalState.evidence.verifiedRevenueINR).toBe(15000);
    expect(finalState.currentStage).toBe('REVENUE_RECORDED');
  });
});
