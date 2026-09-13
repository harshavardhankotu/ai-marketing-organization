import { describe, it, expect, beforeEach } from 'vitest';
import { GoogleAdsClient, googleAdsClient } from '../../src/integrations/google-ads.js';
import { CustomerJourneyTracker } from '../../src/revenue/customer-journey-tracker.js';
import { RevenueReconciliationEngine } from '../../src/revenue/revenue-reconciliation.js';
import { SystemReadinessEngine } from '../../src/control-plane/system-readiness.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Google Ads Attribution Engine & Financial Truth (16 Verification Tests)', () => {
  let adsClient: GoogleAdsClient;
  let tracker: CustomerJourneyTracker;
  let revEngine: RevenueReconciliationEngine;
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    adsClient = new GoogleAdsClient();
    tracker = new CustomerJourneyTracker();
    revEngine = new RevenueReconciliationEngine();

    const db = getDb();
    // Seed Suresh Reddy's real journey and confirmed appointment
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
      'WHATSAPP',
      'WHATSAPP',
      JSON.stringify([
        {
          channel: 'WHATSAPP',
          campaignId: 'camp_seed_aligners_01',
          timestamp: '2026-09-13T10:39:06.199Z',
          event: 'public_lead_submission',
          metadata: {
            source: 'google_cpc',
            serviceOfInterest: 'Invisible Clear Aligners',
            notes: 'Consultation request for clear aligners scan and treatment plan at Banjara Hills clinic center',
            utmSource: 'google',
            utmMedium: 'cpc',
            utmCampaign: 'aligners_hyd_search',
            utmTerm: 'clear aligners hyderabad',
            utmContent: 'instant_whatsapp',
            sessionId: 'sess_google_search_hyd_001',
          },
        },
      ]),
      0,
      'REAL',
      'UNVERIFIED',
      '2026-09-13T10:39:06.189Z',
      '2026-09-13T10:41:02.507Z'
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
      'Invisible Clear Aligners 3D Digital Scan & Smile Assessment',
      'SmileKraft Dental Clinic Banjara Hills Center',
      'CONFIRMED',
      '2026-09-13T10:41:00.000Z',
      '2026-09-13T10:41:00.000Z',
      '2026-09-13T10:41:00.000Z'
    );
  });

  // Test 1
  it('1. recordVerifiedClick correctly persists click records to google_clicks table', () => {
    const db = getDb();
    const click = {
      gclid: 'gclid_hyd_aligner_test_123',
      customerId: '1234567890',
      campaignId: 'camp_hyd_search_01',
      campaignName: 'Hyderabad Clear Aligners Search Campaign',
      adGroupId: 'ag_invisible_braces_01',
      keyword: 'best invisible braces banjara hills',
      clickTimestamp: '2026-09-13T10:00:00Z',
      verificationSource: 'GOOGLE_ADS_API_CLICK_VIEW',
      createdAt: '2026-09-13T10:00:05Z',
    };

    adsClient.recordVerifiedClick(click);

    const saved = db.prepare('SELECT * FROM google_clicks WHERE gclid = ?').get(click.gclid) as any;
    expect(saved).toBeDefined();
    expect(saved.gclid).toBe(click.gclid);
    expect(saved.campaign_id).toBe('camp_hyd_search_01');
    expect(saved.keyword).toBe('best invisible braces banjara hills');
    expect(saved.verification_source).toBe('GOOGLE_ADS_API_CLICK_VIEW');
  });

  // Test 2
  it('2. queryClickView handles single-day partition date constraint', async () => {
    // Calling queryClickView with a single date format 'YYYY-MM-DD'
    const today = new Date().toISOString().split('T')[0];
    const clicks = await adsClient.queryClickView(today);
    // Returns array without throwing, safely handling unconfigured API
    expect(Array.isArray(clicks)).toBe(true);
  });

  // Test 3
  it('3. reconcileLeadAttribution with matching local GCLID returns VERIFIED', async () => {
    adsClient.recordVerifiedClick({
      gclid: 'gclid_valid_match_789',
      customerId: '1234567890',
      campaignId: 'camp_hyd_search_01',
      campaignName: 'Hyderabad Search Campaign',
      keyword: 'clear aligners cost hyderabad',
      clickTimestamp: '2026-09-13T11:00:00Z',
      verificationSource: 'GOOGLE_ADS_API_CLICK_VIEW',
      createdAt: new Date().toISOString(),
    });

    const result = await adsClient.reconcileLeadAttribution({
      gclid: 'gclid_valid_match_789',
      campaignId: 'camp_hyd_search_01',
    });

    expect(result.status).toBe('VERIFIED');
    expect(result.gclid).toBe('gclid_valid_match_789');
    expect(result.campaignId).toBe('camp_hyd_search_01');
    expect(result.verificationSource).toBe('GOOGLE_ADS_API_CLICK_VIEW');
  });

  // Test 4
  it('4. reconcileLeadAttribution with campaign ID contradiction returns NOT_ATTRIBUTED', async () => {
    adsClient.recordVerifiedClick({
      gclid: 'gclid_mismatch_456',
      customerId: '1234567890',
      campaignId: 'camp_hyd_aligners_01',
      campaignName: 'Hyderabad Aligners',
      clickTimestamp: '2026-09-13T11:00:00Z',
      verificationSource: 'GOOGLE_ADS_API_CLICK_VIEW',
      createdAt: new Date().toISOString(),
    });

    // Inbound lead claims to come from a different campaign
    const result = await adsClient.reconcileLeadAttribution({
      gclid: 'gclid_mismatch_456',
      campaignId: 'camp_implants_gachibowli_02',
    });

    expect(result.status).toBe('NOT_ATTRIBUTED');
    expect(result.verificationSource).toBe('MISMATCH_DETECTED');
    expect(result.reason).toContain('contradicts');
  });

  // Test 5
  it('5. reconcileLeadAttribution with unrecorded GCLID returns UNVERIFIED without forcing match', async () => {
    const result = await adsClient.reconcileLeadAttribution({
      gclid: 'gclid_unknown_unverified_999',
      campaignId: 'camp_hyd_search_01',
    });

    expect(result.status).toBe('UNVERIFIED');
    expect(result.gclid).toBe('gclid_unknown_unverified_999');
    expect(result.verificationSource).toBe('UNVERIFIED_GCLID');
  });

  // Test 6
  it('6. reconcileLeadAttribution with no GCLID returns UNVERIFIED (honest negative result)', async () => {
    const result = await adsClient.reconcileLeadAttribution({
      campaignId: 'camp_hyd_search_01',
    });

    expect(result.status).toBe('UNVERIFIED');
    expect(result.verificationSource).toBe('NO_GCLID_EVIDENCE');
  });

  // Test 7
  it('7. Inbound lead with sole utm_source=google and no GCLID cannot be attributed', () => {
    const lead = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Ananya Sharma',
      customerPhone: '+91 9988776655',
      channel: 'GOOGLE_SEARCH',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'Hyderabad_Aligners',
      // No gclid provided
    });

    expect(lead.stage).toBe('LEAD');
    expect(lead.classification).toBe('REAL');
    expect(lead.gclid).toBeUndefined();
    // Attribution status must be UNVERIFIED - never assume attribution solely from utm_source
    expect(lead.attributionStatus).toBe('UNVERIFIED');
  });

  // Test 8
  it('8. recordRealLead captures gclid and sets attributionStatus=VERIFIED if matching click exists', () => {
    adsClient.recordVerifiedClick({
      gclid: 'gclid_verified_flow_111',
      customerId: '1234567890',
      campaignId: 'camp_hyd_search_01',
      campaignName: 'Hyderabad Search',
      clickTimestamp: '2026-09-13T12:00:00Z',
      verificationSource: 'GOOGLE_ADS_API_CLICK_VIEW',
      createdAt: new Date().toISOString(),
    });

    const lead = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Rajesh Varma',
      customerPhone: '+91 9123456780',
      channel: 'GOOGLE_SEARCH',
      gclid: 'gclid_verified_flow_111',
      campaignId: 'camp_hyd_search_01',
      utmSource: 'google',
    });

    expect(lead.gclid).toBe('gclid_verified_flow_111');
    expect(lead.attributionStatus).toBe('VERIFIED');
  });

  // Test 9
  it('9. recordRealLead sets attributionStatus=UNVERIFIED when GCLID has no matching click evidence', () => {
    const lead = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Pooja Hegde',
      customerPhone: '+91 9876501234',
      channel: 'GOOGLE_SEARCH',
      gclid: 'gclid_unrecorded_click_222',
      utmSource: 'google',
    });

    expect(lead.gclid).toBe('gclid_unrecorded_click_222');
    expect(lead.attributionStatus).toBe('UNVERIFIED');
  });

  // Test 10
  it('10. Existing real lead Suresh Reddy remains REAL lead with UNVERIFIED attribution', () => {
    const db = getDb();
    const suresh = db.prepare(`
      SELECT * FROM customer_journeys WHERE customer_name = 'Suresh Reddy'
    `).get() as any;

    expect(suresh).toBeDefined();
    expect(suresh.classification).toBe('REAL');
    expect(suresh.stage).toBe('QUALIFIED_LEAD');
    // Suresh Reddy's attribution status must be UNVERIFIED (never forced to VERIFIED without proof)
    expect(suresh.attribution_status).toBe('UNVERIFIED');
  });

  // Test 11
  it('11. Appointments table persists consultation with confirmed status and links to journey', () => {
    const db = getDb();
    const appts = db.prepare(`
      SELECT a.*, j.customer_name 
      FROM appointments a
      JOIN customer_journeys j ON a.journey_id = j.id
      WHERE j.customer_name = 'Suresh Reddy'
    `).all() as any[];

    expect(appts.length).toBeGreaterThan(0);
    const appt = appts[0];
    expect(appt.clinic_confirmation).toBe('CONFIRMED');
    expect(appt.patient_name).toBe('Suresh Reddy');
    expect(appt.clinic_location).toContain('Banjara Hills');
  });

  // Test 12
  it('12. Revenue reconciliation strictly requires attribution_status=VERIFIED to count toward realMarketingAttributedRevenueINR', () => {
    // 1. Create a VERIFIED journey
    adsClient.recordVerifiedClick({
      gclid: 'gclid_rev_test_555',
      customerId: '1234567890',
      campaignId: 'camp_seed_aligners_01',
      campaignName: 'Hyderabad Aligners Campaign',
      clickTimestamp: '2026-09-13T12:00:00Z',
      verificationSource: 'GOOGLE_ADS_API_CLICK_VIEW',
      createdAt: new Date().toISOString(),
    });

    const verifiedLead = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Kavita Rao',
      customerPhone: '+91 9777111222',
      channel: 'GOOGLE_SEARCH',
      gclid: 'gclid_rev_test_555',
      campaignId: 'camp_seed_aligners_01',
    });
    expect(verifiedLead.attributionStatus).toBe('VERIFIED');

    // 2. Record verified real revenue on this verified journey
    revEngine.recordVerifiedManualRevenue({
      businessId,
      organizationId: orgId,
      verifiedByUserId: 'usr_owner_01',
      invoiceNumber: 'INV-REAL-VERIFIED-01',
      amountINR: 45000,
      paymentMethod: 'UPI',
      transactionRef: 'UPI-REF-REAL-VERIFIED-01',
      verificationSource: 'BANK_STATEMENT',
      journeyId: verifiedLead.id,
      campaignId: 'camp_seed_aligners_01',
    });

    const summary = revEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(45000);
    expect(summary.realMarketingAttributedRevenueINR).toBe(45000);
    expect(summary.unattributedRealRevenueINR).toBe(0);
  });

  // Test 13
  it('13. Real transaction on an UNVERIFIED journey is categorized under unattributedRealRevenueINR', () => {
    // Create an UNVERIFIED journey (e.g. walk-in or unverified lead)
    const unverifiedLead = tracker.recordRealLead({
      businessId,
      organizationId: orgId,
      customerName: 'Direct Patient Walk-In',
      customerPhone: '+91 9666222333',
      channel: 'DIRECT',
      // No gclid, attributionStatus remains UNVERIFIED
    });
    expect(unverifiedLead.attributionStatus).toBe('UNVERIFIED');

    // Record verified real revenue on this unverified journey
    revEngine.recordVerifiedManualRevenue({
      businessId,
      organizationId: orgId,
      verifiedByUserId: 'usr_owner_01',
      invoiceNumber: 'INV-REAL-UNATTR-01',
      amountINR: 30000,
      paymentMethod: 'NETBANKING',
      transactionRef: 'NETB-REF-REAL-01',
      verificationSource: 'BANK_STATEMENT',
      journeyId: unverifiedLead.id,
    });

    const summary = revEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(30000);
    // Crucial check: attributed real revenue MUST be 0
    expect(summary.realMarketingAttributedRevenueINR).toBe(0);
    // Unattributed real revenue captures this 30,000
    expect(summary.unattributedRealRevenueINR).toBe(30000);
  });

  // Test 14
  it('14. Anti-bleed check: TEST or SIMULATED transactions never enter realRevenueRecordedINR or realMarketingAttributedRevenueINR', () => {
    revEngine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-TEST-BLEED-CHECK',
      amountINR: 250000,
      paymentMethod: 'UPI',
      classification: 'TEST',
      serviceRendered: 'Test Simulation',
    });

    revEngine.recordTransaction({
      businessId,
      organizationId: orgId,
      invoiceNumber: 'INV-SIM-BLEED-CHECK',
      amountINR: 500000,
      paymentMethod: 'NO_COST_EMI',
      classification: 'SIMULATED',
      serviceRendered: 'Simulated 50 treatments',
    });

    const summary = revEngine.getRevenueSummary(businessId);
    expect(summary.realRevenueRecordedINR).toBe(0);
    expect(summary.realMarketingAttributedRevenueINR).toBe(0);
    expect(summary.unattributedRealRevenueINR).toBe(0);
    expect(summary.testRevenueINR).toBeGreaterThanOrEqual(250000);
    expect(summary.simulatedRevenueINR).toBe(500000);
  });

  // Test 15
  it('15. ROAS denominator isolation: mock seed spend (₹21,300) is excluded; when live spend is 0, ROAS is 0', () => {
    const summary = revEngine.getRevenueSummary(businessId);
    // Verified actual Google Ads live spend must be 0 (historical mock seed spend excluded)
    expect(summary.verifiedActualGoogleAdsSpendINR).toBe(0);
    // Verified ROAS must be 0 (rendered as N/A)
    expect(summary.verifiedRoas).toBe(0);
    expect(summary.realRoas).toBe(0);
  });

  // Test 16
  it('16. SystemReadinessEngine accurately reflects FIRST_REAL_CONSULTATION state and correct attribution counts', () => {
    const readiness = SystemReadinessEngine.evaluateReadiness(businessId);

    expect(readiness.operatingState).toBe('FIRST_REAL_CONSULTATION');
    expect(readiness.metrics).toBeDefined();
    expect(readiness.metrics!.realLeadsCount).toBeGreaterThanOrEqual(1);
    expect(readiness.metrics!.realConsultationsCount).toBeGreaterThanOrEqual(1);
    expect(readiness.metrics!.realCustomersCount).toBe(0);
    expect(readiness.metrics!.realRevenueINR).toBe(0);
    expect(readiness.metrics!.realAttributedRevenueINR).toBe(0);
    expect(readiness.metrics!.unverifiedLeadsCount).toBeGreaterThanOrEqual(1);
    expect(readiness.metrics!.attributedLeadsCount).toBe(0);
    expect(readiness.metrics!.verifiedActualGoogleAdsSpendINR).toBe(0);
  });
});
