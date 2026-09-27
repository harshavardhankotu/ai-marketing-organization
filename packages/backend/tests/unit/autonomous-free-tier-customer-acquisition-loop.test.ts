import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { OfferCatalogService } from '../../src/revenue/offer-catalog.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { FirstCustomerStateMachine } from '../../src/revenue/first-customer-state-machine.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { SalesConversationEngine } from '../../src/revenue/sales-conversation-engine.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { AutonomyPolicyController } from '../../src/revenue/autonomy-policy.js';
import { GoogleBusinessProfileAdapter, GoogleAdsAdapter, EmailAdapter } from '../../src/integrations/adapter-base.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';

describe('Autonomous Free-Tier Customer Acquisition Loop & Truth Integrity', () => {
  let app: Hono;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    OfferCatalogService.getInstance().ensurePlatformOffers();
    app = new Hono();
    app.route('/api/v1', apiRouter);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. EMPTY PLATFORM PROSPECT DISCOVERY & EVIDENCE VERIFICATION
  // ────────────────────────────────────────────────────────────────────────────
  it('1. Empty platform prospect discovery creates real SMB candidates with evidence', async () => {
    const db = getDb();
    db.prepare('DELETE FROM platform_prospects').run();
    db.prepare('DELETE FROM opportunities').run();
    db.prepare('DELETE FROM sales_pipeline').run();
    db.prepare('DELETE FROM commercial_evidence').run();

    const discEngine = PlatformProspectDiscoveryEngine.getInstance();
    const result = await discEngine.discoverProspects(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID,
      { vertical: 'dental', city: 'Hyderabad', limit: 2 }
    );

    expect(result.status).toBe('PROSPECTS_DISCOVERED');
    expect(result.count).toBeGreaterThan(0);
    expect(result.prospects[0].businessName).not.toContain('SmileKraft');
    expect(result.prospects[0].websiteUrl).toMatch(/^https?:\/\//);

    // Verify persistence across all 4 required tables
    const prospectRows = db.prepare('SELECT * FROM platform_prospects').all();
    const oppRows = db.prepare('SELECT * FROM opportunities').all();
    const pipeRows = db.prepare('SELECT * FROM sales_pipeline').all();
    const evRows = db.prepare('SELECT * FROM commercial_evidence').all();

    expect(prospectRows.length).toBeGreaterThan(0);
    expect(oppRows.length).toBeGreaterThan(0);
    expect(pipeRows.length).toBeGreaterThan(0);
    expect(evRows.length).toBeGreaterThan(0);
  });

  it('2. Rejects prospect creation when candidate lacks verifiable evidence', () => {
    const discEngine = PlatformProspectDiscoveryEngine.getInstance();

    // Missing website
    expect(discEngine.validateCandidate({
      businessName: 'Valid Clinic',
      vertical: 'clinic',
      city: 'Hyderabad',
      websiteUrl: '',
      contactPhone: '+919440123456',
      observedGap: 'Manual triage',
      evidenceSourceUrl: 'https://validclinic.in',
      evidenceTimestamp: new Date().toISOString()
    })).toBe(false);

    // Missing source URL
    expect(discEngine.validateCandidate({
      businessName: 'Valid Clinic',
      vertical: 'clinic',
      city: 'Hyderabad',
      websiteUrl: 'https://validclinic.in',
      contactPhone: '+919440123456',
      observedGap: 'Manual triage',
      evidenceSourceUrl: '',
      evidenceTimestamp: new Date().toISOString()
    })).toBe(false);

    // Missing contact info (both phone and email missing)
    expect(discEngine.validateCandidate({
      businessName: 'Valid Clinic',
      vertical: 'clinic',
      city: 'Hyderabad',
      websiteUrl: 'https://validclinic.in',
      observedGap: 'Manual triage',
      evidenceSourceUrl: 'https://validclinic.in',
      evidenceTimestamp: new Date().toISOString()
    })).toBe(false);

    // Seed name rejection
    expect(discEngine.validateCandidate({
      businessName: 'SmileKraft Dental Clinic',
      vertical: 'dental',
      city: 'Hyderabad',
      websiteUrl: 'https://smilekraft.in',
      contactPhone: '+919440123456',
      observedGap: 'Manual triage',
      evidenceSourceUrl: 'https://smilekraft.in',
      evidenceTimestamp: new Date().toISOString()
    })).toBe(false);
  });

  it('3. Suppresses duplicate prospects and duplicate outreach targets', async () => {
    const discEngine = PlatformProspectDiscoveryEngine.getInstance();
    const candidate = {
      businessName: 'Aura Skin and Dental Clinic',
      vertical: 'dental' as const,
      city: 'Bengaluru',
      websiteUrl: 'https://auraclinic.in',
      contactPhone: '+919880123456',
      contactEmail: 'info@auraclinic.in',
      observedGap: 'No bot verified',
      evidenceSourceUrl: 'https://auraclinic.in/contact',
      evidenceTimestamp: new Date().toISOString()
    };

    // First persistence succeeds
    const firstPersist = await discEngine.persistCandidates(
      [candidate],
      OwnerAuthService.OWNER_ORGANIZATION_ID,
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      'CACHE_REUSE'
    );
    expect(firstPersist.length).toBe(1);

    // Duplicate candidate validation returns false
    expect(discEngine.validateCandidate(candidate)).toBe(false);

    // Second persistence call skips duplicate
    const secondPersist = await discEngine.persistCandidates(
      [candidate],
      OwnerAuthService.OWNER_ORGANIZATION_ID,
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      'CACHE_REUSE'
    );
    expect(secondPersist.length).toBe(0);
  });

  it('4. Free Gemini-only operation succeeds without Tavily credentials', async () => {
    delete process.env.TAVILY_API_KEY;
    const discEngine = PlatformProspectDiscoveryEngine.getInstance();
    const result = await discEngine.discoverProspects(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID,
      { vertical: 'clinic', city: 'Pune', limit: 1 }
    );

    expect(result.status).toBe('PROSPECTS_DISCOVERED');
    expect(result.count).toBeGreaterThan(0);
  });

  it('5. Returns BLOCKED_NO_FREE_RESEARCH_CAPABILITY when all AI/search routes unavailable in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.GEMINI_API_KEY;
    delete process.env.TAVILY_API_KEY;

    const discEngine = PlatformProspectDiscoveryEngine.getInstance();
    const result = await discEngine.discoverProspects(
      OwnerAuthService.PLATFORM_BUSINESS_ID,
      OwnerAuthService.OWNER_ORGANIZATION_ID
    );

    expect(result.status).toBe('BLOCKED_NO_FREE_RESEARCH_CAPABILITY');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. CRON SECURITY & DURABLE TELEMETRY
  // ────────────────────────────────────────────────────────────────────────────
  it('6. In production, cron ping rejects missing or placeholder CRON_PING_SECRET with 403', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CRON_PING_SECRET;

    const res = await app.request('/api/v1/cron/ping', {
      method: 'POST',
      headers: { 'x-cron-secret': 'some_secret' }
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('CRON_PING_SECRET is mandatory in production');
  });

  it('7. In production, cron ping rejects default dev secret "cron_ping_default_dev"', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_PING_SECRET = 'cron_ping_default_dev';

    const res = await app.request('/api/v1/cron/ping', {
      method: 'POST',
      headers: { 'x-cron-secret': 'cron_ping_default_dev' }
    });

    expect(res.status).toBe(403);
  });

  it('8. Cron status distinguishes CONFIGURED, OBSERVED, and HEALTHY without env var guessing', async () => {
    // 1. Initial state (0 pings): CONFIGURED
    process.env.CRON_PING_SECRET = 'prod_secret_12345';
    const initialRes = await app.request('/api/v1/cron/status');
    const initialBody = await initialRes.json() as any;
    expect(initialBody.data.status).toBe('CONFIGURED');

    // 2. Successful ping -> records telemetry
    const pingRes = await app.request('/api/v1/cron/ping', {
      method: 'POST',
      headers: {
        'x-cron-secret': 'prod_secret_12345',
        'user-agent': 'cloudflare-cron-worker/1.0',
        'cf-worker': 'ai-marketing-cron-worker'
      }
    });
    expect(pingRes.status).toBe(200);

    // 3. Observed status
    const statusRes = await app.request('/api/v1/cron/status');
    const statusBody = await statusRes.json() as any;
    expect(statusBody.data.totalPings).toBe(1);
    expect(statusBody.data.lastObservedPing).toBeTruthy();
    expect(statusBody.data.status).toBe('HEALTHY');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. READY_TO_BUY EVENT ROUTING & PROPOSAL PAYMENT AUTOMATION
  // ────────────────────────────────────────────────────────────────────────────
  it('9. READY_TO_BUY event routes to SEND_PAYMENT_REQUEST, not BOOK_MEETING', async () => {
    const db = getDb();
    const sce = SalesConversationEngine.getInstance();
    const aro = AutonomousRevenueOrchestrator.getInstance();

    // Create a prospect in pipeline
    const prospectId = 'ppros_test_routing_01';
    const pipelineId = 'pipe_test_routing_01';
    db.prepare(`
      INSERT INTO platform_prospects (id, prospect_business_name, prospect_phone, prospect_city, prospect_vertical, stage)
      VALUES (?, 'Elite Dental Studio', '+919440998877', 'Hyderabad', 'dental', 'CONTACTED')
    `).run(prospectId);

    db.prepare(`
      INSERT INTO sales_pipeline (id, business_id, organization_id, outbound_contact_id, stage, next_action)
      VALUES (?, ?, ?, ?, 'CONTACTED', 'AWAITING_REPLY')
    `).run(pipelineId, OwnerAuthService.PLATFORM_BUSINESS_ID, OwnerAuthService.OWNER_ORGANIZATION_ID, prospectId);

    // Handle inbound "READY_TO_BUY" message
    const replyRes = await sce.handleInboundMessage({
      businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      senderContact: '+919440998877',
      channel: 'WHATSAPP',
      messageText: 'We are ready to move forward. Send over the agreement and payment link.'
    });

    expect(replyRes.intent).toBe('READY_TO_BUY');
    expect(replyRes.routedAction).toBe('SEND_PAYMENT_REQUEST');

    // Simulate event handler execution in ARO
    await aro.handleDurableEvent('LEAD_REPLIED', {
      contact: '+919440998877',
      intent: 'READY_TO_BUY',
      nextAction: 'SEND_PAYMENT_REQUEST',
      pipelineId
    });

    // Check pipeline updated to PAYMENT_PENDING with next_action SEND_PAYMENT_REQUEST
    const row = db.prepare('SELECT stage, next_action FROM sales_pipeline WHERE id = ?').get(pipelineId) as any;
    expect(row.stage).toBe('PAYMENT_PENDING');
    expect(row.next_action).toBe('SEND_PAYMENT_REQUEST');
  });

  it('10. DEMO_REQUEST and PRICE_QUESTION route to their respective actions', async () => {
    const sce = SalesConversationEngine.getInstance();
    const aro = AutonomousRevenueOrchestrator.getInstance();
    const db = getDb();

    const pipeDemo = 'pipe_test_demo_01';
    db.prepare(`
      INSERT INTO sales_pipeline (id, business_id, organization_id, stage, next_action)
      VALUES (?, ?, ?, 'CONTACTED', 'AWAITING_REPLY')
    `).run(pipeDemo, OwnerAuthService.PLATFORM_BUSINESS_ID, OwnerAuthService.OWNER_ORGANIZATION_ID);

    await aro.handleDurableEvent('LEAD_REPLIED', {
      contact: '+919440111222',
      intent: 'DEMO_REQUEST',
      nextAction: 'BOOK_MEETING',
      pipelineId: pipeDemo
    });

    const demoRow = db.prepare('SELECT stage, next_action FROM sales_pipeline WHERE id = ?').get(pipeDemo) as any;
    expect(demoRow.stage).toBe('MEETING_BOOKED');
    expect(demoRow.next_action).toBe('BOOK_MEETING');

    // PRICE_QUESTION
    const priceRes = await sce.handleInboundMessage({
      businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      senderContact: '+919440333444',
      channel: 'WHATSAPP',
      messageText: 'What is your pricing and setup cost?'
    });
    expect(priceRes.intent).toBe('PRICE_QUESTION');
    expect(priceRes.responseTemplate).toContain('₹15,000');
    expect(priceRes.responseTemplate).toContain('₹8,000/month');
  });

  it('11. Proposal acceptance automatically triggers real Razorpay payment link creation and binding', async () => {
    const propEngine = ProposalEngine.getInstance();
    const proposal = propEngine.createProposal({
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
      prospectId: 'ppros_autolink_01',
      title: 'AI Inbound Lead Conversion for Care Clinic',
      customerProblem: 'Inquiries go unanswered outside clinic hours.',
      proposedSolution: 'Deploy 24/7 WhatsApp triage bot and GBP funnels.',
      deliverables: ['WhatsApp Triage Bot', 'GBP Funnel'],
      setupPriceINR: 15000,
      monthlyPriceINR: 8000
    });

    // 1. Initial acceptance marks status ACCEPTED and PAYMENT_LINK_NOT_CREATED
    const acceptRes = propEngine.acceptProposal(proposal.id);
    expect(acceptRes.proposal.status).toBe('ACCEPTED');
    expect(acceptRes.status).toBe('PAYMENT_LINK_NOT_CREATED');

    // 2. Authoritative payment link execution binds real link
    const linkExecRes = await propEngine.executeProposalPaymentLinkCreation(proposal.id);
    expect(linkExecRes.success).toBe(true);
    expect(linkExecRes.status).toBe('PAYMENT_REQUESTED');
    expect(linkExecRes.paymentLinkUrl).toBeTruthy();

    // Check payment_requests record bound to provider link
    const db = getDb();
    const payReq = db.prepare('SELECT * FROM payment_requests WHERE prospect_id = ? ORDER BY created_at DESC LIMIT 1').get('ppros_autolink_01') as any;
    expect(payReq.status).toBe('SENT');
    expect(payReq.provider_link_id).toBeTruthy();
    expect(payReq.short_url || payReq.payment_link).toBe(linkExecRes.paymentLinkUrl);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. FALSE-LIVE ADAPTER PREVENTIONS & OUTBOUND SAFETY
  // ────────────────────────────────────────────────────────────────────────────
  it('12. Google GBP and Ads adapters return BLOCKED_AUTHORIZATION and never fake live IDs', async () => {
    const gbp = new GoogleBusinessProfileAdapter();
    const gbpRes = await gbp.publish({
      title: 'Update Local Listing',
      body: 'Hours updated'
    });
    expect(gbpRes.success).toBe(false);
    expect(gbpRes.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(gbpRes.externalId).toBeUndefined();

    const gads = new GoogleAdsAdapter();
    const gadsRes = await gads.publish({
      title: 'Search Campaign',
      body: 'Dental implants in Hyderabad'
    });
    expect(gadsRes.success).toBe(false);
    expect(gadsRes.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(gadsRes.externalId).toBeUndefined();
  });

  it('13. Platform email sender identity rejects clinic identity and requires PLATFORM_SENDER_EMAIL in prod', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PLATFORM_SENDER_EMAIL;
    process.env.SENDER_EMAIL = 'support@smilekraft.in'; // Clinic identity

    const emailAdapter = new EmailAdapter({ smtpKey: 'SG.test_valid_key' });
    const res = await emailAdapter.publish({
      title: 'Platform Partnership',
      body: 'Automate your lead conversions.',
      recipientEmail: 'doctor@careclinic.in'
    });

    expect(res.success).toBe(false);
    expect(res.actionClassification).toBe('BLOCKED_AUTHORIZATION');
    expect(res.message).toContain('PLATFORM_SENDER_EMAIL is required in production');
  });

  it('14. Outbound contact safety blocks system owner, platform, and seed clinic phone numbers', () => {
    const policy = AutonomyPolicyController.getInstance();

    expect(policy.getContactSafety('+919999999999')).toBe('BLOCKED');
    expect(policy.getContactSafety('support@smilekraft.in')).toBe('BLOCKED');
    expect(policy.getContactSafety('platform@aimarketing.local')).toBe('BLOCKED');
    expect(policy.getContactSafety('+919440123456')).toBe('CONTACTABLE');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. FIRST-CUSTOMER STATE MACHINE
  // ────────────────────────────────────────────────────────────────────────────
  it('15. FirstCustomerStateMachine accurately evaluates pipeline progression from NO_PROSPECTS', async () => {
    const db = getDb();
    db.prepare('DELETE FROM platform_prospects').run();
    db.prepare('DELETE FROM customer_journeys').run();
    db.prepare('DELETE FROM revenue_records').run();
    db.prepare('DELETE FROM payment_requests').run();
    db.prepare('DELETE FROM proposals').run();
    db.prepare('DELETE FROM sales_pipeline').run();

    const sm = FirstCustomerStateMachine.getInstance();
    const evalInitial = sm.evaluateState();
    expect(evalInitial.currentStage).toBe('NO_PROSPECTS');
    expect(evalInitial.nextStage).toBe('DISCOVER_PROSPECTS');
    expect(evalInitial.executable).toBe(true);

    // Advance 1 step: creates prospect
    const advResult = await sm.advance();
    expect(advResult.success).toBe(true);
    expect(advResult.newStage).toBe('PLATFORM_PROSPECT_CREATED');

    // Re-evaluate: OUTREACH_READY
    const evalSecond = sm.evaluateState();
    expect(['OUTREACH_READY', 'CONTACTED', 'EVIDENCE_VERIFIED']).toContain(evalSecond.currentStage);
  });
});
