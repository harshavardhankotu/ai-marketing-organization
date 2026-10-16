import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { DemandEngine } from '../../src/commission/demand-engine.js';
import { OwnerControlCenterEngine } from '../../src/commission/owner-control-center.js';
import app from '../../src/index.js';

const ORG = 'org_owner_primary';
const OWNER_KEY = 'test_owner_key_sec_123';

describe('Part G: Distribution Experiment & Weekly Channel Report Test Suite', () => {
  beforeEach(() => {
    resetDbForTesting();
    process.env.OWNER_API_KEY = OWNER_KEY;
    const db = getDb();

    // Default org
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
      VALUES (?, 'Primary Owner Organization', 'owner-primary', datetime('now'))
    `).run(ORG);
  });

  afterEach(() => {
    delete process.env.OWNER_API_KEY;
  });

  describe('1. Daily Reply Desk (Part G.1)', () => {
    it('takes up to 3 valid BUYER_QUESTION rows with real source URLs and excludes seeded/unsourced signals', async () => {
      const db = getDb();
      const engine = DemandEngine.getInstance();

      // Seeded mock signal (MUST BE EXCLUDED)
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, category, topic, raw_query, signal_type, urgency,
          estimated_monthly_volume, status, evidence_snippet, source_url, created_at
        ) VALUES (
          'sig_seeded_01', ?, 'hardware', 'thermal printer', 'which printer works',
          'BUYER_QUESTION', 0.8, 100, 'SEEDED', 'mock evidence', 'https://search.community/q1', datetime('now')
        )
      `).run(ORG);

      // Real buyer questions with genuine community URLs
      for (let i = 1; i <= 5; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (
            ?, ?, 'accounting', 'GST billing question', 'how to auto generate e-way bill in small retail store',
            'BUYER_QUESTION', 0.9, 150, 'DISCOVERED', 'Retail store inquiry for GST billing', 'https://reddit.com/r/indiabusiness/q${i}', datetime('now', '-${i} hours')
          )
        `).run(`sig_real_0${i}`, ORG);
      }

      const desk = engine.getDailyReplyDesk(3);
      expect(desk.length).toBe(3);

      // Verify each item points to direct offer or published guide and has valid community source
      for (const item of desk) {
        expect(item.sourceUrl).toContain('reddit.com');
        expect(item.sourceUrl).not.toContain('search.community');
        expect(item.landingUrl).toContain('/offer');
        expect(item.disclosureText.toLowerCase()).toContain('affiliate');
        expect(item.draftText).toContain('24/7 lead qualification');
      }
    });

    it('marks draft and signal as POSTED_BY_OWNER upon posting confirmation', async () => {
      const db = getDb();
      const engine = DemandEngine.getInstance();

      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, category, topic, raw_query, signal_type, urgency,
          estimated_monthly_volume, status, evidence_snippet, source_url, created_at
        ) VALUES (
          'sig_post_test', ?, 'office_automation', 'WhatsApp bot', 'which whatsapp bot auto books meetings',
          'BUYER_QUESTION', 0.8, 120, 'DISCOVERED', 'WhatsApp triage inquiry', 'https://desidime.com/deals/q1', datetime('now')
        )
      `).run(ORG);

      const desk = engine.getDailyReplyDesk(1);
      expect(desk.length).toBe(1);
      const draftId = desk[0].draftId;

      const res = await app.request(`/api/v1/owner/demand/drafts/${draftId}/post`, {
        method: 'POST',
        headers: {
          'x-api-key': OWNER_KEY,
          'x-organization-id': ORG
        }
      });
      expect(res.status).toBe(200);

      // Verify database state: status = POSTED_BY_OWNER
      const updatedSignal = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get('sig_post_test') as any;
      expect(updatedSignal.status).toBe('POSTED_BY_OWNER');

      const updatedDraft = db.prepare('SELECT status, posted_at FROM outreach_drafts WHERE id = ?').get(draftId) as any;
      expect(updatedDraft.status).toBe('POSTED_BY_OWNER');
      expect(updatedDraft.posted_at).toBeDefined();

      // Ensure it no longer appears in the active daily reply desk
      const freshDesk = engine.getDailyReplyDesk(3);
      const found = freshDesk.find(d => d.signalId === 'sig_post_test');
      expect(found).toBeUndefined();
    });
  });

  describe('2. Weekly Channel Report (Part G.2)', () => {
    it('aggregates search, direct, and referral traffic over the past 7 days', async () => {
      const db = getDb();
      const occ = OwnerControlCenterEngine.getInstance();

      // Seed partner & offer with all required non-null columns
      db.prepare(`
        INSERT OR IGNORE INTO partners (id, organization_id, name, industry, website, partner_type, approval_status)
        VALUES ('part_test_01', ?, 'Test Partner', 'TECH', 'https://test.com', 'AFFILIATE', 'APPROVED')
      `).run(ORG);

      db.prepare(`
        INSERT OR IGNORE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer,
          destination_url, authorized_tracking_url, active
        ) VALUES (
          'poff_test_01', 'part_test_01', ?, 'Test Offer', 'test-offer', 'tech', 'SME owners',
          'https://test.com', 'https://test.com/ref', 1
        )
      `).run(ORG);

      // 1. Search visit (Google referer)
      db.prepare(`
        INSERT INTO referrals (
          id, partner_id, offer_id, organization_id, click_id, destination_url,
          source, referer, utm_medium, created_at
        ) VALUES (
          'ref_search_01', 'part_test_01', 'poff_test_01', ?, 'clk_s1', 'https://test.com',
          'google', 'https://www.google.com/search?q=test', 'organic', datetime('now', '-2 days')
        )
      `).run(ORG);

      // 2. Referral visit (Reddit referer)
      db.prepare(`
        INSERT INTO referrals (
          id, partner_id, offer_id, organization_id, click_id, destination_url,
          source, referer, utm_medium, created_at
        ) VALUES (
          'ref_referral_01', 'part_test_01', 'poff_test_01', ?, 'clk_r1', 'https://test.com',
          'reddit', 'https://reddit.com/r/indiabusiness', 'referral', datetime('now', '-3 days')
        )
      `).run(ORG);

      // 3. Direct visit (no referer)
      db.prepare(`
        INSERT INTO referrals (
          id, partner_id, offer_id, organization_id, click_id, destination_url,
          source, referer, utm_medium, landing_page, created_at
        ) VALUES (
          'ref_direct_01', 'part_test_01', 'poff_test_01', ?, 'clk_d1', 'https://test.com',
          'direct', '', '', '/offer', datetime('now', '-1 days')
        )
      `).run(ORG);

      // Clicks
      db.prepare(`
        INSERT INTO referral_click_events (
          id, referral_id, click_id, organization_id, offer_id, partner_id, placement, source, medium, referrer, destination_url, created_at
        ) VALUES (
          'ev_clk_01', 'ref_referral_01', 'clk_r1', ?, 'poff_test_01', 'part_test_01', 'community_forum', 'reddit', 'referral', 'https://reddit.com/r/indiabusiness', 'https://test.com', datetime('now', '-3 days')
        )
      `).run(ORG);

      const report = await occ.getWeeklyChannelReport(ORG);
      expect(report.reportingPeriod).toBe('Past 7 Days');
      expect(report.totalVisits).toBe(3);
      expect(report.totalClicks).toBe(1);

      expect(report.channels.search.visits).toBe(1);
      expect(report.channels.referral.visits).toBe(1);
      expect(report.channels.direct.visits).toBe(1);

      expect(report.channels.referral.clicks).toBe(1);
      expect(report.channels.search.clicks).toBe(0);
      expect(report.channels.direct.clicks).toBe(0);

      // Verify endpoint
      const res = await app.request('/api/v1/owner/channel-report', {
        headers: {
          'x-api-key': OWNER_KEY,
          'x-organization-id': ORG
        }
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.totalVisits).toBe(3);
      expect(json.data.channels.search.visits).toBe(1);
    });
  });
});
