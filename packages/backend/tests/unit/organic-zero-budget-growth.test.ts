import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OrganicChannelManager } from '../../src/organic/organic-channel-manager.js';
import { OrganicContentEngine } from '../../src/organic/organic-content-engine.js';
import { LocalLandingPageEngine } from '../../src/organic/local-landing-pages.js';
import { ReviewAndReferralEngine } from '../../src/organic/review-and-referral-engine.js';
import { GoogleBusinessProfileAdapter } from '../../src/organic/gbp-integration.js';
import { AutonomyController } from '../../src/control-plane/autonomy-controller.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { MarketingMemoryEngine } from '../../src/knowledge/marketing-memory.js';
import { AgentScorecardEngine } from '../../src/analytics/agent-scorecard.js';
import { QuotaManager } from '../../src/ai/quota-manager.js';

describe('Zero-Budget Autonomous Growth Test Suite', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';
  const userId = 'usr_owner_01';
  const testJourneyId = 'journey-961c351f-71d2-4d7b-a842-b6858984b288';
  const testApptId = 'appt_suresh_001';

  let channelManager: OrganicChannelManager;
  let contentEngine: OrganicContentEngine;
  let landingPageEngine: LocalLandingPageEngine;
  let reviewReferralEngine: ReviewAndReferralEngine;
  let gbpAdapter: GoogleBusinessProfileAdapter;
  let autonomyController: AutonomyController;
  let economicsEngine: RealEconomicsEngine;
  let revenueEngine: RevenueReconciliationEngine;
  let memoryEngine: MarketingMemoryEngine;
  let scorecardEngine: AgentScorecardEngine;
  let quotaManager: QuotaManager;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();

    channelManager = new OrganicChannelManager();
    contentEngine = new OrganicContentEngine();
    landingPageEngine = new LocalLandingPageEngine();
    reviewReferralEngine = new ReviewAndReferralEngine();
    gbpAdapter = new GoogleBusinessProfileAdapter();
    autonomyController = new AutonomyController();
    economicsEngine = new RealEconomicsEngine();
    revenueEngine = new RevenueReconciliationEngine();
    memoryEngine = new MarketingMemoryEngine();
    quotaManager = QuotaManager.getInstance();
    autonomyController.setOperatingMode(businessId, 'ZERO_BUDGET_GROWTH');
  });

  // =========================================================================
  // 1. Operating Mode & Paid-Spend Prohibition
  // =========================================================================
  it('1. Enforces ZERO_BUDGET_GROWTH mode and strictly rejects paid advertising spend', () => {
    const policy = autonomyController.getBudgetPolicy(businessId);
    expect(policy.activeMode).toBe('ZERO_BUDGET_GROWTH');
    expect(policy.maxAutonomousSpendINR).toBe(0.0);
    expect(policy.remainingAutonomousBudgetINR).toBe(0.0);

    // Any proposal with paid budget impact must be rejected
    const paidProposal = {
      id: 'prop-paid-001',
      businessId,
      agentId: 'agt_paid_search_01',
      actionType: 'SCALE_CAMPAIGN' as const,
      targetEntityId: 'cmp_google_ads_01',
      evidence: 'High search demand.',
      reason: 'Attempting to run Google Ads in zero-budget mode.',
      confidence: 0.9,
      expectedImpact: '+20% volume',
      budgetImpactINR: 2000,
      risk: 'MEDIUM' as const,
      approvalStatus: 'PROPOSED' as const,
      createdAt: new Date().toISOString(),
    };

    const execution = autonomyController.executeOptimizationProposal(businessId, paidProposal);
    expect(execution.success).toBe(false);
    expect(execution.rationale).toMatch(/ZERO-BUDGET GROWTH PROHIBITION: Paid media spend is strictly ₹0/);
  });

  // =========================================================================
  // 2. 10 Free Organic Channels Portfolio
  // =========================================================================
  it('2. Maintains portfolio of all 10 free organic channels with strategies and CTAs', () => {
    const channels = channelManager.listChannels(businessId);
    expect(channels.length).toBe(10);

    const channelNames = channels.map((c) => c.channel);
    expect(channelNames).toContain('GOOGLE_BUSINESS_PROFILE');
    expect(channelNames).toContain('ORGANIC_SEO');
    expect(channelNames).toContain('INSTAGRAM_ORGANIC');
    expect(channelNames).toContain('FACEBOOK_ORGANIC');
    expect(channelNames).toContain('YOUTUBE_ORGANIC');
    expect(channelNames).toContain('LINKEDIN_ORGANIC');
    expect(channelNames).toContain('WHATSAPP_INBOUND');
    expect(channelNames).toContain('REFERRALS');
    expect(channelNames).toContain('LOCAL_PARTNERSHIPS');
    expect(channelNames).toContain('DIRECT_OUTREACH');

    for (const c of channels) {
      expect(c.strategy).toBeDefined();
      expect(c.strategy.length).toBeGreaterThan(10);
      expect(c.callToAction).toBeDefined();
      expect(c.activeStatus).toBe('ACTIVE');
      // Impressions are unknown unless linked to actual API
      expect(c.metrics?.impressions).toBe('UNKNOWN');
    }
  });

  // =========================================================================
  // 3. Deterministic Organic Tracking & UTM Generation
  // =========================================================================
  it('3. Generates deterministic organic UTM parameters without paid click IDs', () => {
    const utm = channelManager.generateOrganicUTM({
      channel: 'INSTAGRAM_ORGANIC',
      campaign: 'aligners_hyd_organic',
      content: 'doctor_explainer_01',
      targetKeyword: 'clear aligners Hyderabad',
    });

    expect(utm.utmSource).toBe('instagram');
    expect(utm.utmMedium).toBe('organic');
    expect(utm.utmCampaign).toBe('aligners_hyd_organic');
    expect(utm.utmContent).toBe('doctor_explainer_01');
    expect(utm.fullQueryString).toContain('utm_source=instagram');
    expect(utm.fullQueryString).toContain('utm_medium=organic');
    expect(utm.fullQueryString).toContain('utm_campaign=aligners_hyd_organic');
    expect(utm.fullQueryString).toContain('utm_content=doctor_explainer_01');
    expect(utm.fullQueryString).toContain('utm_term=clear%20aligners%20hyderabad');
  });

  // =========================================================================
  // 4. Medical Content Compliance & Doctor Approval Workflow
  // =========================================================================
  it('4. Gating clinical claims: Medical content requires clinic doctor approval before publication', () => {
    // 1. Content with clinical orthodontic assertions
    const draft = contentEngine.createContentDraft({
      businessId,
      channel: 'INSTAGRAM_ORGANIC',
      campaignId: 'cmp_organic_hyd_01',
      contentType: 'DOCTOR_EXPLANATION',
      title: 'Painless teeth straightening in 6 months',
      body: 'Our invisible aligners gently straighten teeth with zero brackets. Treatment guaranteed in 6 months.',
      callToAction: 'Book Free 3D Scan',
      createdByAgent: 'agt_content_01',
      hasMedicalClaim: true,
      medicalClaimSource: 'SmileKraft Orthodontic Guidelines',
    });

    expect(draft.hasMedicalClaim).toBe(true);
    expect(draft.approvalStatus).toBe('PENDING_CLINIC_APPROVAL');
    expect(draft.publicationStatus).toBe('DRAFT');

    // 2. Unauthorized approval attempt must fail
    expect(() => {
      contentEngine.approveContent({
        contentId: draft.id,
        approvedByUserId: 'usr_unauthorized_viewer',
      });
    }).toThrow(/Unauthorized: Only an authenticated clinic OWNER/);

    // 3. Certified clinic doctor / owner approves content
    const approved = contentEngine.approveContent({
      contentId: draft.id,
      approvedByUserId: userId,
      publishImmediately: true,
    });

    expect(approved.approvalStatus).toBe('APPROVED');
    expect(approved.publicationStatus).toBe('PUBLISHED');
    expect(approved.clinicApprovedBy).toBe('Dr. Aravind Reddy');
    expect(approved.publishedAt).toBeDefined();
  });

  // =========================================================================
  // 5. Local Landing Page Engine
  // =========================================================================
  it('5. Serves verified local landing pages with canonical URLs and schema.org structured data', () => {
    const pages = landingPageEngine.listLandingPages();
    expect(pages.length).toBe(3);

    const slugs = pages.map((p) => p.slug);
    expect(slugs).toContain('aligners-hyderabad');
    expect(slugs).toContain('aligners-banjara-hills');
    expect(slugs).toContain('aligners-gachibowli');

    const banjaraPage = landingPageEngine.getLandingPage('aligners-banjara-hills');
    expect(banjaraPage).not.toBeNull();
    expect(banjaraPage?.location).toBe('Banjara Hills, Hyderabad');
    expect(banjaraPage?.verifiedDoctor).toBe('Dr. Aravind Reddy, MDS Orthodontics');
    expect(banjaraPage?.whatsappNumber).toBe('+91 98491 23456');

    const jsonLd = landingPageEngine.generateJsonLd(banjaraPage!);
    expect(jsonLd['@type']).toBe('Dentist');
    expect(jsonLd.telephone).toBe('+91 98491 23456');
    expect(jsonLd.medicalSpecialty).toBe('Orthodontics');
  });

  // =========================================================================
  // 6. Review Request Workflow (Post-Clinical Confirmation)
  // =========================================================================
  it('6. Review requests strictly require completed clinic appointment confirmation', () => {
    // Verified confirmed appointment succeeds
    const reviewReq = reviewReferralEngine.createReviewRequest({
      businessId,
      customerId: 'cust_suresh_001',
      journeyId: testJourneyId,
      appointmentId: testApptId,
      channel: 'WHATSAPP',
    });

    expect(reviewReq.id).toBeDefined();
    expect(reviewReq.clinicConfirmation).toBe('CONFIRMED');
    expect(reviewReq.status).toBe('QUEUED');

    // Unconfirmed or non-existent appointment must fail
    expect(() => {
      reviewReferralEngine.createReviewRequest({
        businessId,
        customerId: 'cust_unconfirmed_001',
        journeyId: testJourneyId,
        appointmentId: 'appt_non_existent',
        channel: 'WHATSAPP',
      });
    }).toThrow(/Cannot request review: Appointment.*does not match journey/);
  });

  // =========================================================================
  // 7. Ethical Direct Outreach & Rate Limiting
  // =========================================================================
  it('7. Ethical direct outreach enforces max 10 daily dispatches and human approval', () => {
    // 1. Create outreach draft
    const draft = reviewReferralEngine.createOutreachDraft({
      businessId,
      segment: 'Corporate HR HITEC City',
      prospectName: 'Sunil Rao (HR Director, Tech Mahindra)',
      channel: 'LINKEDIN',
      messageDraft: 'Dear Sunil, Dr. Aravind Reddy from SmileKraft Banjara Hills offers corporate dental wellness checkups.',
    });

    expect(draft.complianceChecked).toBe(true);
    expect(draft.humanApproved).toBe(false);
    expect(draft.dispatched).toBe(false);

    // 2. Dispatch with owner authorization
    const dispatched = reviewReferralEngine.dispatchOutreach({
      outreachId: draft.id,
      approvedByUserId: userId,
    });

    expect(dispatched.dispatched).toBe(true);
    expect(dispatched.humanApproved).toBe(true);

    // 3. Exceeding 10 daily dispatches throws rate limit error
    const db = getDb();
    for (let i = 0; i < 9; i++) {
      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel,
          message_draft, compliance_checked, human_approved, dispatched, dispatch_timestamp, response_status, created_at
        ) VALUES (?, ?, 'Corporate', 'HR Lead', 'LINKEDIN', 'Draft', 1, 1, 1, datetime('now'), 'PENDING', datetime('now'))
      `).run(`outreach-fill-${i}`, businessId);
    }

    const overflowDraft = reviewReferralEngine.createOutreachDraft({
      businessId,
      segment: 'Corporate HR',
      prospectName: 'Ravi Kumar',
      channel: 'LINKEDIN',
      messageDraft: 'Corporate checkup outreach',
    });

    expect(() => {
      reviewReferralEngine.dispatchOutreach({
        outreachId: overflowDraft.id,
        approvedByUserId: userId,
      });
    }).toThrow(/ETHICAL OUTREACH RATE LIMIT EXCEEDED/);
  });

  // =========================================================================
  // 8. WhatsApp Inbound Tracking
  // =========================================================================
  it('8. Tracks WhatsApp inbound journey touchpoints without simulated conversations', () => {
    const db = getDb();
    const waJourneyId = 'journey-wa-inbound-001';
    db.prepare(`
      INSERT INTO customer_journeys (
        id, organization_id, business_id, visitor_id, customer_name,
        customer_phone, stage, first_touch_channel, last_touch_channel,
        touchpoints_json, classification, attribution_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'QUALIFIED_LEAD', 'WHATSAPP_INBOUND', 'WHATSAPP_INBOUND', ?, 'REAL', 'UNVERIFIED', datetime('now'), datetime('now'))
    `).run(
      waJourneyId,
      orgId,
      businessId,
      'vis_wa_01',
      'Pooja Sharma',
      '+919876543210',
      JSON.stringify([
        {
          channel: 'WHATSAPP_INBOUND',
          utmSource: 'whatsapp',
          utmCampaign: 'wa_direct_booking',
          timestamp: new Date().toISOString(),
        },
      ])
    );

    const journey = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(waJourneyId) as any;
    expect(journey.first_touch_channel).toBe('WHATSAPP_INBOUND');
    expect(journey.classification).toBe('REAL');
    expect(journey.attribution_status).toBe('UNVERIFIED');
  });

  // =========================================================================
  // 9. Organic Economics & Zero-ROAS Invariant
  // =========================================================================
  it('9. Organic economics calculates lead/customer revenue and omits ROAS (paid spend is ₹0)', () => {
    const economics = economicsEngine.calculate(businessId);

    // Paid media spend is strictly ₹0
    expect(economics.actualAdSpendINR).toBe(0);
    // In zero-budget mode, ROAS must be 'N/A' (no division by zero or fake ROAS)
    expect(economics.verifiedRoas).toBe('N/A');
    expect(economics.verifiedRoi).toBe('N/A');

    // Real organic metrics
    expect(economics.organicVisitors).toBeGreaterThanOrEqual(1);
    expect(economics.organicLeads).toBeGreaterThanOrEqual(1);
    expect(economics.organicConsultations).toBeGreaterThanOrEqual(1);
    expect(economics.organicCustomers).toBe(0);
    expect(economics.organicVerifiedRevenueINR).toBe(0);
  });

  // =========================================================================
  // 10. AI Cost Truth & Gemini Free-Tier Quota
  // =========================================================================
  it('10. AI cost truth: Reports ₹0 cost with status VERIFIED when within free tier', () => {
    // When ai_cost_logs has 0 cost, status is VERIFIED
    const economics = economicsEngine.calculate(businessId);
    expect(economics.aiCostStatus).toBe('VERIFIED');

    // Quota manager validates free-tier headroom
    const quotaStatus = quotaManager.getStatus();
    expect(quotaStatus.freeTierActive).toBe(true);
    expect(quotaStatus.geminiMaxDailyRequests).toBeGreaterThan(0);
    expect(quotaStatus.geminiRequestsToday).toBeLessThan(quotaStatus.geminiMaxDailyRequests);
  });

  // =========================================================================
  // 11. Organic Knowledge Memory Evidence Maturity
  // =========================================================================
  it('11. Single organic lead observation remains PROMISING (not WINNING or PROVEN)', () => {
    const maturity = memoryEngine.calculateMaturity({
      evidenceCount: 1,
      sourceType: 'REAL_INTERNAL_DATA',
      payingCustomersCount: 0,
      verifiedRevenueINR: 0,
    });
    expect(maturity).toBe('PROMISING');
    expect(maturity).not.toBe('PROVEN');

    const mem = memoryEngine.recordMemory({
      businessId,
      dimension: 'WINNING_KEYWORD',
      key: 'invisalign-banjara-hills-organic',
      insight: 'First consultation inquiry from Banjara Hills organic search & WhatsApp desk.',
      evidenceReference: testJourneyId,
      sourceType: 'REAL_INTERNAL_DATA',
      evidenceCount: 1,
      verifiedRevenueINR: 0,
      payingCustomersCount: 0,
    });
    expect(mem.maturity).toBe('PROMISING');
  });

  // =========================================================================
  // 12. Zero-Budget Experiment Proposal Model
  // =========================================================================
  it('12. Proposes zero-budget experiments strictly with budgetINR = 0 and defined stop conditions', () => {
    const experiments = autonomyController.generateZeroBudgetExperiments(businessId);
    expect(experiments.length).toBeGreaterThanOrEqual(3);

    for (const exp of experiments) {
      expect(exp.budgetINR).toBe(0); // Hard ₹0 budget constraint
      expect(exp.hypothesis).toBeDefined();
      expect(exp.control).toBeDefined();
      expect(exp.treatment).toBeDefined();
      expect(exp.primaryMetric).toBeDefined();
      expect(exp.stopCondition).toBeDefined();
      expect(exp.status).toBe('PROPOSED');
    }
  });

  // =========================================================================
  // 13. Google Business Profile Boundary
  // =========================================================================
  it('13. Google Business Profile adapter retrieves local signals without synthetic metrics', () => {
    const insights = gbpAdapter.getLocationInsights(businessId);
    expect(insights.businessId).toBe(businessId);
    expect(insights.averageRating).toBe(4.9);
    expect(insights.callClicks).toBeGreaterThan(0);
    expect(insights.websiteClicks).toBeGreaterThan(0);

    // Record verified local call click
    const initialCalls = insights.callClicks;
    gbpAdapter.recordEngagementSignal(businessId, 'CALL');
    const updated = gbpAdapter.getLocationInsights(businessId);
    expect(updated.callClicks).toBe(initialCalls + 1);
  });

  // =========================================================================
  // 14. First Real Customer Pipeline: Zero Fabrication Baseline Preserved
  // =========================================================================
  it('14. Baseline preserved: Suresh Reddy remains in FIRST_REAL_CONSULTATION with 0 revenue', () => {
    const summary = revenueEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(0);
    expect(summary.realRevenueIndependentlyVerifiedINR).toBe(0);
    expect(summary.realMarketingAttributedRevenueINR).toBe(0);

    const db = getDb();
    const journey = db.prepare('SELECT stage, classification FROM customer_journeys WHERE id = ?').get(testJourneyId) as any;
    expect(journey.stage).toBe('QUALIFIED_LEAD');
    expect(journey.classification).toBe('REAL');

    const appt = db.prepare('SELECT clinic_confirmation FROM appointments WHERE id = ?').get(testApptId) as any;
    expect(appt.clinic_confirmation).toBe('CONFIRMED');
  });

  // =========================================================================
  // 15. Real Profitability Condition in Zero-Budget Mode
  // =========================================================================
  it('15. Profitability requires verified revenue to exceed verified costs (net contribution > 0)', () => {
    const economics = economicsEngine.calculate(businessId);
    // At ₹0 revenue and ₹0 ad spend, net contribution is ₹0 (not yet profitable)
    expect(economics.netContributionINR).toBe(0);

    // Only upon verified revenue entry does net contribution become positive
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: testJourneyId,
      service: 'Invisalign Treatment',
      quotedAmountINR: 150000,
      doctorNotes: '3D scan accepted by patient.',
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
      transactionRef: 'UPI-HDFC-VERIFIED-01',
      invoiceNumber: 'INV-SK-2026-ORGANIC-01',
      verificationSource: 'HDFC_BANK_STATEMENT',
      verifiedByUserId: userId,
    });

    // Mark journey attribution as verified for marketing attributed calculation
    const db = getDb();
    db.prepare("UPDATE customer_journeys SET attribution_status = 'VERIFIED' WHERE id = ?").run(testJourneyId);

    const profitableEconomics = economicsEngine.calculate(businessId);
    expect(profitableEconomics.verifiedRealRevenueINR).toBe(20000);
    expect(profitableEconomics.netContributionINR).toBe(20000);
    expect(profitableEconomics.netContributionINR).toBeGreaterThan(0);
  });
});
