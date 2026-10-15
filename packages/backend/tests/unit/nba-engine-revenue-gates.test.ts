import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { AgentScorecardEngine } from '../../src/analytics/agent-scorecard.js';

describe('NextBestActionEngine Revenue Gates & Truth Invariants', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    resetDbForTesting();
    const db = getDb();

    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
      VALUES (?, 'Primary Owner Organization', 'owner-primary', datetime('now'))
    `).run(orgId);

    db.prepare(`
      INSERT OR IGNORE INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, created_at)
      VALUES (?, ?, 'Platform Business', 'platform-biz', 'vert_tech', 'Technology', datetime('now'))
    `).run(bizId, orgId);

    db.prepare(`
      INSERT OR IGNORE INTO partners (id, organization_id, name, industry, website, partner_type, network, active_status, created_at)
      VALUES ('part_amazon_01', ?, 'Amazon Associates India', 'E-commerce', 'https://associates.amazon.in', 'AFFILIATE', 'AMAZON_ASSOCIATES', 1, datetime('now'))
    `).run(orgId);
  });

  it('1. CREATE_REFERRAL_LINK is NOT chosen when guide is only PUBLISH_READY or unpublished', () => {
    const db = getDb();
    const nbaEngine = NextBestActionEngine.getInstance();

    // Insert an active partner offer without a published guide
    db.prepare(`
      INSERT INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, status, active, commission_amount_inr, created_at
      ) VALUES (
        'offer_phomemo_01', 'part_amazon_01', ?, 'Phomemo M110 Label Printer',
        'phomemo-m110', 'label printer', 'Buyers seeking label printers',
        'https://www.amazon.in/dp/B08X', 'https://www.amazon.in/dp/B08X?tag=sample',
        'ACTIVE', 1, 0, datetime('now')
      )
    `).run(orgId);

    // Insert guide in PUBLISH_READY status (not yet published)
    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category, intent_target,
        content_markdown, primary_offer_id, status, created_at
      ) VALUES (
        'cca_phomemo_01', ?, 'guide-phomemo-m110', 'GUIDE',
        'Phomemo M110 Buyer Guide', 'label printer', 'best label printer',
        'Guide content', 'offer_phomemo_01', 'PUBLISH_READY', datetime('now')
      )
    `).run(orgId);

    const action = nbaEngine.choose(bizId, orgId, { ignoreCooldown: true });

    // Must NOT be CREATE_REFERRAL_LINK
    expect(action.actionType).not.toBe('CREATE_REFERRAL_LINK');
  });

  it('2. Unverified commission does not forecast ₹1,000 or ₹400 expected revenue', () => {
    const db = getDb();
    const nbaEngine = NextBestActionEngine.getInstance();

    // Insert active partner offer with unverified (0) commission
    db.prepare(`
      INSERT INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, status, active, commission_amount_inr, created_at
      ) VALUES (
        'offer_test_unverified', 'part_amazon_01', ?, 'Test Unverified Product',
        'test-unverified', 'electronics', 'Buyers seeking electronics',
        'https://www.amazon.in/dp/B09Y', 'https://www.amazon.in/dp/B09Y?tag=sample',
        'ACTIVE', 1, 0, datetime('now')
      )
    `).run(orgId);

    // Insert PUBLISHED guide to make it eligible for referral link creation
    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category, intent_target,
        content_markdown, primary_offer_id, status, created_at
      ) VALUES (
        'cca_test_published', ?, 'guide-test-unverified', 'GUIDE',
        'Test Unverified Guide', 'electronics', 'test query',
        'Content', 'offer_test_unverified', 'PUBLISHED', datetime('now')
      )
    `).run(orgId);

    const action = nbaEngine.choose(bizId, orgId, { ignoreCooldown: true });

    if (action.actionType === 'CREATE_REFERRAL_LINK') {
      // Must not fabricate ₹1000 or ₹400
      expect(action.expectedRevenueINR).toBe(0);
      expect(action.estimatedRevenueINR).toBe(0);
      expect(action.rationale).toContain('Commission estimate: UNKNOWN');
      expect(action.rationale).not.toContain('₹1000');
      expect(action.rationale).not.toContain('₹400');
    }
  });

  it('3. CREATE_REFERRAL_LINK is emitted once guide is genuinely PUBLISHED with same org and offer', () => {
    const db = getDb();
    const nbaEngine = NextBestActionEngine.getInstance();

    db.prepare(`
      INSERT INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, status, active, commission_amount_inr, created_at
      ) VALUES (
        'offer_published_01', 'part_amazon_01', ?, 'Published Product Offer',
        'pub-product', 'electronics', 'Buyers seeking electronics',
        'https://www.amazon.in/dp/B01Z', 'https://www.amazon.in/dp/B01Z?tag=sample',
        'ACTIVE', 1, 150, datetime('now')
      )
    `).run(orgId);

    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category, intent_target,
        content_markdown, primary_offer_id, status, created_at
      ) VALUES (
        'cca_published_01', ?, 'guide-published-product', 'GUIDE',
        'Published Guide', 'electronics', 'test query',
        'Content', 'offer_published_01', 'PUBLISHED', datetime('now')
      )
    `).run(orgId);

    const action = nbaEngine.choose(bizId, orgId, { ignoreCooldown: true });

    expect(action.actionType).toBe('CREATE_REFERRAL_LINK');
    expect(action.targetId).toBe('offer_published_01');
    expect(action.targetType).toBe('OFFER');
    expect(action.rationale).toContain('Commission estimate: ₹150');
  });

  it('4. AWAIT_OWNER_INTAKE surfaces publication blocker when guide is PUBLISH_READY and owner intake incomplete', () => {
    const db = getDb();
    const nbaEngine = NextBestActionEngine.getInstance();

    // Ensure owner_intake is empty
    db.prepare('DELETE FROM owner_intake').run();

    // Active offer with PUBLISH_READY guide
    db.prepare(`
      INSERT INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, status, active, commission_amount_inr, created_at
      ) VALUES (
        'offer_pending_intake', 'part_amazon_01', ?, 'Pending Intake Product',
        'pending-intake', 'electronics', 'Buyers seeking electronics',
        'https://www.amazon.in/dp/B02W', 'https://www.amazon.in/dp/B02W?tag=sample',
        'ACTIVE', 1, 200, datetime('now')
      )
    `).run(orgId);

    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category, intent_target,
        content_markdown, primary_offer_id, status, created_at
      ) VALUES (
        'cca_pending_intake', ?, 'guide-pending-intake', 'GUIDE',
        'Pending Intake Guide', 'electronics', 'test query',
        'Content', 'offer_pending_intake', 'PUBLISH_READY', datetime('now')
      )
    `).run(orgId);

    const action = nbaEngine.choose(bizId, orgId, { ignoreCooldown: true });

    // Should surface AWAIT_OWNER_INTAKE
    expect(action.actionType).toBe('AWAIT_OWNER_INTAKE');
    expect(action.targetId).toBe('cca_pending_intake');
    expect(action.targetType).toBe('CONTENT_ASSET');
    expect(action.authorizationRequired).toBe(true);
    expect(action.priorityTier).toBe('P2');
  });

  it('5. AgentScorecardEngine.listScorecards() returns empty array on empty database without synthetic seeding', () => {
    const db = getDb();
    const scorecardEngine = new AgentScorecardEngine();

    // Database is empty
    const cards = scorecardEngine.listScorecards();
    expect(cards).toEqual([]);
    expect(cards.length).toBe(0);

    // Verify zero synthetic rows were inserted into agent_scorecards table
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM agent_scorecards').get() as any;
    expect(countRow.cnt).toBe(0);
  });

  it('6. Inbound customer demo requests emit BOOK_MEETING with P0 priority', () => {
    const db = getDb();
    const nbaEngine = NextBestActionEngine.getInstance();

    // Insert an inbound hot lead request
    db.prepare(`
      INSERT INTO platform_prospects (
        id, prospect_business_name, prospect_city, prospect_vertical,
        prospect_owner_name, prospect_phone, prospect_email, stage, source, created_at
      ) VALUES (
        'prospect_inbound_01', 'Dental Care Clinic', 'Hyderabad', 'dental',
        'Dr. Rao', '+919876543210', 'dr.rao@example.com', 'INBOUND_REQUEST', 'WEBSITE_CONTACT', datetime('now')
      )
    `).run();

    const action = nbaEngine.choose(bizId, orgId, { ignoreCooldown: true });

    expect(action.actionType).toBe('BOOK_MEETING');
    expect(action.priorityTier).toBe('P0');
    expect(action.targetType).toBe('PROSPECT');
  });
});
