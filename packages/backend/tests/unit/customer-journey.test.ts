import { describe, it, expect, beforeEach } from 'vitest';
import { CustomerJourneyTracker } from '../../src/revenue/customer-journey-tracker.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Customer Journey Tracker Unit Tests', () => {
  let tracker: CustomerJourneyTracker;
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    tracker = new CustomerJourneyTracker();
  });

  it('creates and tracks visitor journey stages progressively', () => {
    const visitorId = 'vis_unit_001';

    // 1. Initial touchpoint creates journey at VISITOR / SESSION
    const j1 = tracker.recordTouchpoint({
      businessId,
      organizationId: orgId,
      visitorId,
      channel: 'META_ADS',
      event: 'ad_impression_view',
      campaignId: 'camp_seed_aligners_01',
      classification: 'TEST',
    });

    expect(j1.visitorId).toBe(visitorId);
    expect(j1.firstTouchChannel).toBe('META_ADS');
    expect(j1.touchpoints.length).toBe(1);

    // 2. Click / Website visit advances to SESSION
    const j2 = tracker.recordTouchpoint({
      businessId,
      organizationId: orgId,
      visitorId,
      channel: 'META_ADS',
      event: 'landing_page_visit',
      campaignId: 'camp_seed_aligners_01',
      classification: 'TEST',
    });
    expect(j2.stage).toBe('SESSION');
    expect(j2.touchpoints.length).toBe(2);

    // 3. Lead form submission advances to LEAD
    const j3 = tracker.recordTouchpoint({
      businessId,
      organizationId: orgId,
      visitorId,
      channel: 'WHATSAPP',
      event: 'whatsapp_lead_inquiry',
      classification: 'TEST',
    });
    expect(j3.stage).toBe('LEAD');
    expect(j3.lastTouchChannel).toBe('WHATSAPP');

    // 4. Consultation scheduled advances to QUALIFIED_LEAD
    const j4 = tracker.advanceStage({
      businessId,
      visitorId,
      targetStage: 'QUALIFIED_LEAD',
      customerName: 'Rohit Kulkarni',
      customerPhone: '+91-98760-01122',
    });
    expect(j4.stage).toBe('QUALIFIED_LEAD');
    expect(j4.customerName).toBe('Rohit Kulkarni');

    // 5. In-clinic consultation completed advances to OPPORTUNITY
    const j5 = tracker.advanceStage({
      businessId,
      visitorId,
      targetStage: 'OPPORTUNITY',
    });
    expect(j5.stage).toBe('OPPORTUNITY');

    // 6. Payment received adds revenue and advances to CUSTOMER
    tracker.addRevenue(j5.id, 45000);
    const funnel = tracker.getJourneyFunnel(businessId, 'TEST');
    expect(funnel.CUSTOMER).toBeGreaterThan(0);
  });

  it('aggregates multi-stage funnel correctly', () => {
    const funnel = tracker.getJourneyFunnel(businessId);
    expect(funnel).toHaveProperty('VISITOR');
    expect(funnel).toHaveProperty('LEAD');
    expect(funnel).toHaveProperty('CUSTOMER');
    expect(funnel.CUSTOMER).toBeGreaterThanOrEqual(2); // From seed data
  });
});
