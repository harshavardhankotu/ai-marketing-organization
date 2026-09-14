import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { TrafficProvenanceEngine } from '../../src/organic/traffic-provenance.js';
import { GoogleBusinessProfileAdapter } from '../../src/organic/gbp-integration.js';
import { OrganicContentEngine } from '../../src/organic/organic-content-engine.js';
import { LocalLandingPageEngine } from '../../src/organic/local-landing-pages.js';
import { RealEconomicsEngine } from '../../src/revenue/real-economics.js';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { AutonomyController } from '../../src/control-plane/autonomy-controller.js';
import { QuotaManager } from '../../src/ai/quota-manager.js';
import { MarketingMemoryEngine } from '../../src/knowledge/marketing-memory.js';

describe('Real Organic Distribution & Evidence-Gated Acquisition Test Suite', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';
  const userId = 'usr_owner_01';
  const sureshJourneyId = 'journey-961c351f-71d2-4d7b-a842-b6858984b288';
  const sureshApptId = 'appt_suresh_001';

  let trafficProvenance: TrafficProvenanceEngine;
  let gbpAdapter: GoogleBusinessProfileAdapter;
  let contentEngine: OrganicContentEngine;
  let landingPageEngine: LocalLandingPageEngine;
  let economicsEngine: RealEconomicsEngine;
  let revenueEngine: RevenueReconciliationEngine;
  let autonomyController: AutonomyController;
  let memoryEngine: MarketingMemoryEngine;
  let quotaManager: QuotaManager;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();

    trafficProvenance = new TrafficProvenanceEngine();
    gbpAdapter = new GoogleBusinessProfileAdapter();
    contentEngine = new OrganicContentEngine();
    landingPageEngine = new LocalLandingPageEngine();
    economicsEngine = new RealEconomicsEngine();
    revenueEngine = new RevenueReconciliationEngine();
    autonomyController = new AutonomyController();
    memoryEngine = new MarketingMemoryEngine();
    quotaManager = QuotaManager.getInstance();

    autonomyController.setOperatingMode(businessId, 'ZERO_BUDGET_GROWTH');
  });

  // =========================================================================
  // 1. Internal browser request != external traffic
  // =========================================================================
  it('1. Internal browser request != external traffic (Localhost & private IPs classified as INTERNAL)', () => {
    const loopbackEval = trafficProvenance.evaluateTrafficEvidence({
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    expect(loopbackEval.status).toBe('INTERNAL');
    expect(loopbackEval.isExternal).toBe(false);

    const privateSubnetEval = trafficProvenance.evaluateTrafficEvidence({
      ipAddress: '192.168.1.45',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    });
    expect(privateSubnetEval.status).toBe('INTERNAL');
    expect(privateSubnetEval.isExternal).toBe(false);

    // External request with public Indian ISP IP and organic search referrer
    const externalEval = trafficProvenance.evaluateTrafficEvidence({
      ipAddress: '49.205.142.88',
      referrer: 'https://www.google.co.in/',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X)',
    });
    expect(externalEval.status).toBe('VERIFIED_EXTERNAL');
    expect(externalEval.isExternal).toBe(true);
  });

  // =========================================================================
  // 2. Test visitor != REAL visitor
  // =========================================================================
  it('2. Test visitor != REAL visitor (Automated test runner requests classified as TEST)', () => {
    const testRunnerEval = trafficProvenance.evaluateTrafficEvidence({
      ipAddress: '49.205.142.88',
      userAgent: 'vitest/3.2.7 (node-test-runner)',
    });
    expect(testRunnerEval.status).toBe('TEST');
    expect(testRunnerEval.isExternal).toBe(false);

    const explicitTestEval = trafficProvenance.evaluateTrafficEvidence({
      isTestHarness: true,
      ipAddress: '49.205.142.88',
    });
    expect(explicitTestEval.status).toBe('TEST');
    expect(explicitTestEval.isExternal).toBe(false);

    // Record both sessions
    trafficProvenance.recordSession({
      businessId,
      visitorId: 'vis_test_001',
      landingPage: '/aligners-hyderabad',
      isTestHarness: true,
    });

    trafficProvenance.recordSession({
      businessId,
      visitorId: 'vis_external_001',
      landingPage: '/aligners-banjara-hills',
      ipAddress: '157.48.22.91',
      referrer: 'https://www.google.com/',
    });

    const stats = trafficProvenance.getOrganicDistributionStats(businessId);
    expect(stats.testSessions).toBe(1);
    expect(stats.verifiedExternalSessions).toBe(1);
    expect(stats.verifiedExternalVisitors).toBe(1); // Test visitor excluded from verified external visitors
  });

  // =========================================================================
  // 3. UTM-only != verified attribution
  // =========================================================================
  it('3. UTM-only != verified attribution (UTM presence without external provenance remains unverified)', () => {
    // Session has UTM params but originates from localhost developer client
    const session = trafficProvenance.recordSession({
      businessId,
      visitorId: 'vis_dev_01',
      landingPage: '/aligners-hyderabad?utm_source=google_organic&utm_medium=organic&utm_campaign=seo_local_guides',
      utmSource: 'google_organic',
      utmMedium: 'organic',
      utmCampaign: 'seo_local_guides',
      ipAddress: '127.0.0.1',
    });

    expect(session.source).toBe('GOOGLE_ORGANIC');
    expect(session.trafficEvidenceStatus).toBe('INTERNAL');
    expect(session.isExternal).toBe(false);

    // Lead created from this internal session has unverified attribution
    const lead = trafficProvenance.recordLead({
      businessId,
      customerName: 'Internal Test Lead',
      sessionId: session.sessionId,
    });

    expect(lead.acquisitionEvidence.verifiedOrganic).toBe(false);
    expect(lead.acquisitionEvidence.trafficEvidenceStatus).toBe('INTERNAL');

    const db = getDb();
    const journey = db.prepare('SELECT attribution_status FROM customer_journeys WHERE id = ?').get(lead.journeyId) as any;
    expect(journey.attribution_status).toBe('UNVERIFIED');
  });

  // =========================================================================
  // 4. published=false != published=true
  // =========================================================================
  it('4. published=false != published=true (Newly created content defaults strictly to DRAFT)', () => {
    const draft = contentEngine.createContentDraft({
      businessId,
      channel: 'INSTAGRAM_ORGANIC',
      campaignId: 'cmp_aligners_hyd_organic',
      contentType: 'PATIENT_EDUCATION',
      title: 'How 3D Dental Scanners Create Digital Aligners',
      body: 'See how digital impressions replace uncomfortable putty trays for modern orthodontics.',
      callToAction: 'DM SMILE for Free Digital 3D Preview',
      createdByAgent: 'agt_social_copywriter',
    });

    expect(draft.publicationStatus).toBe('DRAFT');
    expect(draft.publishedAt).toBeUndefined();

    const stats = contentEngine.getContentStats(businessId);
    expect(stats.publishedCount).toBe(0);
    expect(stats.draftCount).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // 5. draft content != published content
  // =========================================================================
  it('5. draft content != published content (Approved content remains DRAFT until external publication evidence exists)', () => {
    const draft = contentEngine.createContentDraft({
      businessId,
      channel: 'INSTAGRAM_ORGANIC',
      campaignId: 'cmp_aligners_hyd_organic',
      contentType: 'PATIENT_EDUCATION',
      title: 'Smile Care Essentials for Aligner Patients',
      body: 'Keep aligners crystal clear with simple daily maintenance tips.',
      callToAction: 'Save this post for your aligner journey',
      createdByAgent: 'agt_social_copywriter',
    });

    // Owner approves the draft
    const approved = contentEngine.approveContent({
      contentId: draft.id,
      approvedByUserId: userId,
    });
    expect(approved.approvalStatus).toBe('APPROVED');
    expect(approved.publicationStatus).toBe('DRAFT'); // Not published yet without external post ID & live URL

    // Now record verified external publication evidence
    const published = contentEngine.recordPublicationEvidence({
      contentId: draft.id,
      externalPostId: 'ig_post_984712093',
      externalUrl: 'https://instagram.com/p/C9x8Y1zK2pQ',
      platform: 'INSTAGRAM',
      verifiedByUserId: userId,
    });

    expect(published.publicationStatus).toBe('PUBLISHED');
    expect(published.publishedAt).toBeDefined();

    const stats = contentEngine.getContentStats(businessId);
    expect(stats.verifiedPublishedCount).toBe(1);
  });

  // =========================================================================
  // 6. fake social engagement != external engagement
  // =========================================================================
  it('6. fake social engagement != external engagement (GBP requires genuine OAuth and unverified signals do not create revenue)', () => {
    // Check initial GBP OAuth state
    const oauthStatus = gbpAdapter.getOAuthStatus(businessId);
    expect(oauthStatus.oauthStatus).toBe('PENDING_AUTHORIZATION');
    expect(oauthStatus.hasEncryptedRefreshToken).toBe(false);

    // API actions are blocked without authorization
    expect(() => gbpAdapter.ensureAuthorized(businessId)).toThrow(/OAuth 2.0 authorization/);

    // Simulate genuine owner OAuth completion
    const authorized = gbpAdapter.handleOAuthCallback({
      businessId,
      code: 'auth_code_google_gbp_live_2026',
      googleAccountId: 'accounts/108934789123847',
      locationId: 'locations/9847123984712',
      refreshToken: 'secret_live_refresh_token_gbp',
    });

    expect(authorized.oauthStatus).toBe('AUTHORIZED');
    expect(authorized.hasEncryptedRefreshToken).toBe(true);

    // Verify plaintext refresh token was NOT stored
    const db = getDb();
    const credRow = db.prepare('SELECT encrypted_refresh_token FROM gbp_oauth_authorizations WHERE business_id = ?').get(businessId) as any;
    expect(credRow.encrypted_refresh_token).not.toContain('secret_live_refresh_token_gbp');
    expect(credRow.encrypted_refresh_token).toMatch(/^enc_v1_/);

    // Incrementing GBP clicks does NOT fabricate revenue or paying customers
    gbpAdapter.recordEngagementSignal(businessId, 'CALL');
    const economics = economicsEngine.calculate(businessId);
    expect(economics.verifiedRealRevenueINR).toBe(0);
    expect(economics.organicCustomers).toBe(0);
  });

  // =========================================================================
  // 7. organic attribution chain persists
  // =========================================================================
  it('7. organic attribution chain persists (source -> session -> visitor -> lead -> journey)', () => {
    const visitorId = 'vis_org_ext_7781';
    const sessionId = 'sess_org_ext_7781';

    // 1. Session created
    const session = trafficProvenance.recordSession({
      businessId,
      visitorId,
      sessionId,
      landingPage: '/aligners-banjara-hills',
      referrer: 'https://www.google.co.in/',
      utmSource: 'google_organic',
      utmMedium: 'organic',
      utmCampaign: 'aligners_banjara_organic',
      utmContent: 'road12_landing_header',
      ipAddress: '103.211.55.12',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    });

    expect(session.source).toBe('GOOGLE_ORGANIC');
    expect(session.trafficEvidenceStatus).toBe('VERIFIED_EXTERNAL');

    // 2. Lead ingested from session
    const leadResult = trafficProvenance.recordLead({
      businessId,
      customerName: 'Ananya Sharma',
      customerPhone: '+91 98490 11223',
      customerEmail: 'ananya.s@gmail.com',
      sessionId: session.sessionId,
      notes: 'Inquiry for clear aligners from Banjara Hills landing page',
    });

    expect(leadResult.acquisitionEvidence.verifiedOrganic).toBe(true);
    expect(leadResult.acquisitionEvidence.sourceProvenance).toBe('GOOGLE_ORGANIC');
    expect(leadResult.acquisitionEvidence.trafficEvidenceStatus).toBe('VERIFIED_EXTERNAL');

    // 3. Journey provenance check
    const db = getDb();
    const journey = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(leadResult.journeyId) as any;
    expect(journey.visitor_id).toBe(visitorId);
    expect(journey.first_touch_channel).toBe('GOOGLE_ORGANIC');
    expect(journey.attribution_status).toBe('VERIFIED');

    // 4. Trace acquisition evidence back from journey
    const fetchedEvidence = trafficProvenance.getAcquisitionEvidence(leadResult.journeyId);
    expect(fetchedEvidence).not.toBeNull();
    expect(fetchedEvidence?.customerName).toBe('Ananya Sharma');
    expect(fetchedEvidence?.verifiedOrganic).toBe(true);
  });

  // =========================================================================
  // 8. organic visitor -> lead is preserved
  // =========================================================================
  it('8. organic visitor -> lead is preserved (Verified external visitor increments verifiedOrganicLeads count)', () => {
    const session = trafficProvenance.recordSession({
      businessId,
      landingPage: '/aligners-gachibowli',
      referrer: 'https://www.instagram.com/',
      utmSource: 'instagram',
      utmMedium: 'organic',
      utmCampaign: 'aligners_gachibowli_organic',
      ipAddress: '115.112.44.19',
    });

    trafficProvenance.recordLead({
      businessId,
      customerName: 'Vikram Varma',
      sessionId: session.sessionId,
      notes: 'Gachibowli IT corridor clear aligner consultation',
    });

    const economics = economicsEngine.calculate(businessId);
    expect(economics.externalOrganicVisitors).toBeGreaterThanOrEqual(1);
    expect(economics.verifiedOrganicLeads).toBe(1);
  });

  // =========================================================================
  // 9. Suresh remains REAL but source remains UNVERIFIED
  // =========================================================================
  it('9. Suresh remains REAL but source remains UNVERIFIED (Excluded from verifiedOrganicLeads)', () => {
    const sureshEvidence = trafficProvenance.getAcquisitionEvidence('Suresh Reddy');
    expect(sureshEvidence).not.toBeNull();
    expect(sureshEvidence?.customerName).toBe('Suresh Reddy');
    expect(sureshEvidence?.leadStatus).toBe('REAL_LEAD');
    expect(sureshEvidence?.sourceProvenance).toBe('WHATSAPP_INBOUND');
    expect(sureshEvidence?.trafficEvidenceStatus).toBe('UNKNOWN');
    expect(sureshEvidence?.verifiedOrganic).toBe(false); // Never relabeled as verified organic without proof

    // In economics summary:
    // realLeads includes Suresh (1)
    // verifiedOrganicLeads is 0 (since no verified external session exists for Suresh)
    const economics = economicsEngine.calculate(businessId);
    expect(economics.organicLeads).toBeGreaterThanOrEqual(1);
    expect(economics.verifiedOrganicLeads).toBe(0);
    expect(economics.organicCustomers).toBe(0);
    expect(economics.verifiedRealRevenueINR).toBe(0);
  });

  // =========================================================================
  // 10. REAL customer requires actual treatment acceptance
  // =========================================================================
  it('10. REAL customer requires actual treatment acceptance (Appointment is not a customer)', () => {
    const db = getDb();
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(sureshApptId) as any;
    expect(appt.clinic_confirmation).toBe('CONFIRMED');

    // Customer count remains 0 because treatment has not been accepted
    const economics = economicsEngine.calculate(businessId);
    expect(economics.organicCustomers).toBe(0);
    expect(economics.organicConsultations).toBe(1);

    // Only when treatment plan is accepted and recorded does stage transition to CUSTOMER
    revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: sureshJourneyId,
      service: 'Invisalign Treatment',
      quotedAmountINR: 150000,
      doctorNotes: 'Doctor completed 3D scan review. Patient accepted 12-month aligner plan.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    db.prepare("UPDATE customer_journeys SET stage = 'CUSTOMER' WHERE id = ?").run(sureshJourneyId);

    const updatedEconomics = economicsEngine.calculate(businessId);
    expect(updatedEconomics.organicCustomers).toBe(1);
  });

  // =========================================================================
  // 11. REAL revenue requires actual payment evidence
  // =========================================================================
  it('11. REAL revenue requires actual payment evidence (Quoted ₹150,000 does not equal verified revenue)', () => {
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: sureshJourneyId,
      service: 'Invisalign Treatment',
      quotedAmountINR: 150000,
      doctorNotes: '3D scan treatment plan presented to patient.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    // Before payment: revenue is strictly ₹0
    const prePaymentEconomics = economicsEngine.calculate(businessId);
    expect(prePaymentEconomics.verifiedRealRevenueINR).toBe(0);

    // Only upon external payment verification (UPI bank reference) is revenue recognized
    revenueEngine.recordTreatmentPayment({
      businessId,
      organizationId: orgId,
      journeyId: sureshJourneyId,
      treatmentPlanId: plan.id,
      amountINR: 25000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-HDFC-9847120-VERIFIED',
      invoiceNumber: 'INV-SK-2026-REAL-01',
      verificationSource: 'HDFC_BANK_STATEMENT',
      verifiedByUserId: userId,
    });

    const postPaymentEconomics = economicsEngine.calculate(businessId);
    expect(postPaymentEconomics.verifiedRealRevenueINR).toBe(25000);
    expect(postPaymentEconomics.verifiedRealRevenueINR).not.toBe(150000); // Actual payment amount, not quote amount!
  });

  // =========================================================================
  // 12. organic attributed revenue requires verified provenance
  // =========================================================================
  it('12. organic attributed revenue requires verified provenance (Unverified journey revenue goes to unattributedRealRevenueINR)', () => {
    const plan = revenueEngine.recordTreatmentPlan({
      businessId,
      journeyId: sureshJourneyId,
      service: 'Invisalign Treatment',
      quotedAmountINR: 150000,
      doctorNotes: 'Treatment accepted.',
      clinicConfirmation: 'CONFIRMED',
      status: 'ACCEPTED',
    });

    revenueEngine.recordTreatmentPayment({
      businessId,
      organizationId: orgId,
      journeyId: sureshJourneyId,
      treatmentPlanId: plan.id,
      amountINR: 30000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-HDFC-UNVERIFIED-ATTR',
      invoiceNumber: 'INV-SK-2026-UNATTR-01',
      verificationSource: 'HDFC_BANK_STATEMENT',
      verifiedByUserId: userId,
    });

    // Journey attribution_status is UNVERIFIED (Suresh has unverified provenance)
    const summary = revenueEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueIndependentlyVerifiedINR).toBe(30000);
    expect(summary.realMarketingAttributedRevenueINR).toBe(0); // Excluded from marketing attributed revenue
    expect(summary.unattributedRealRevenueINR).toBe(30000);
  });

  // =========================================================================
  // 13. AI free-tier status is not fabricated
  // =========================================================================
  it('13. AI free-tier status is not fabricated (Truthfully reports FREE_TIER_VERIFIED within daily allowance)', () => {
    const quotaStatus = quotaManager.getStatus();
    expect(quotaStatus.freeTierActive).toBe(true);
    expect(quotaStatus.geminiMaxDailyRequests).toBe(1500);
    expect(quotaStatus.geminiRequestsToday).toBeLessThan(quotaStatus.geminiMaxDailyRequests);

    const economics = economicsEngine.calculate(businessId);
    expect(economics.freeTierStatus).toBe('FREE_TIER_VERIFIED');
    expect(economics.aiCostStatus).toBe('VERIFIED');
  });

  // =========================================================================
  // 14. unsupported medical claim cannot publish
  // =========================================================================
  it('14. unsupported medical claim cannot publish (Clinical orthodontic claims require clinic doctor approval before publication)', () => {
    const claimDraft = contentEngine.createContentDraft({
      businessId,
      channel: 'ORGANIC_SEO',
      campaignId: 'cmp_aligners_hyd_organic',
      contentType: 'TREATMENT_PROCESS',
      title: 'Painless Teeth Straightening with 100% Guaranteed Outcome',
      body: 'Our orthodontic clear aligners guarantee painless teeth alignment in 6 months with zero relapse.',
      callToAction: 'Book Free 3D Scan',
      createdByAgent: 'agt_seo_specialist',
    });

    expect(claimDraft.hasMedicalClaim).toBe(true);
    expect(claimDraft.approvalStatus).toBe('PENDING_CLINIC_APPROVAL');

    // Attempting to record publication evidence without doctor signoff is blocked
    expect(() =>
      contentEngine.recordPublicationEvidence({
        contentId: claimDraft.id,
        externalPostId: 'web_blog_998',
        externalUrl: 'https://smilekraftdental.in/blog/painless-teeth-straightening',
        platform: 'WEBSITE',
        verifiedByUserId: userId,
      })
    ).toThrow(/Clinical orthodontic claims are present and have not received required clinic doctor approval/);

    // Only after doctor approval can publication evidence be recorded
    contentEngine.approveContent({
      contentId: claimDraft.id,
      approvedByUserId: userId,
    });

    const published = contentEngine.recordPublicationEvidence({
      contentId: claimDraft.id,
      externalPostId: 'web_blog_998',
      externalUrl: 'https://smilekraftdental.in/blog/painless-teeth-straightening',
      platform: 'WEBSITE',
      verifiedByUserId: userId,
    });

    expect(published.publicationStatus).toBe('PUBLISHED');
  });
});
