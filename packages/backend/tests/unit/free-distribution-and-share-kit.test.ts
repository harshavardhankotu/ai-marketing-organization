import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { ShareKitService } from '../../src/commission/share-kit-service.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { app } from '../../src/index.js';

describe('Step 7: Free Distribution (Policy-Safe, Zero Rupees, Zero Credits)', () => {
  const db = getDb();
  const orgId = 'org_owner_primary';
  const partnerId = 'part_test_dist_01';
  const offerId = 'poff_test_dist_01';

  beforeEach(async () => {
    delete process.env.GOOGLE_SITE_VERIFICATION;

    // Seed test partner and offer for beacon testing
    try {
      db.prepare(`
        INSERT OR REPLACE INTO partners (
          id, organization_id, name, industry, country, website,
          partner_type, approval_status, active_status, network, tracking_type,
          authorization_status, program_url, coverage, disclosure_required, evidence_json,
          created_at, updated_at
        ) VALUES (
          ?, ?, 'Amazon India Associates', 'Retail', 'India',
          'https://affiliate-program.amazon.in', 'AFFILIATE', 'APPROVED', 1,
          'AMAZON_ASSOCIATES', 'DIRECT_ID_TAG', 'AUTHORIZED', 'https://affiliate-program.amazon.in',
          'India', 1, '{}', datetime('now'), datetime('now')
        )
      `).run(partnerId, orgId);

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category,
          target_customer, commission_model, commission_amount_inr, status,
          destination_url, authorized_tracking_url, created_at, updated_at
        ) VALUES (
          ?, ?, ?, 'Thermal Label Printer 80mm', 'thermal-label-printer-80mm', 'Hardware',
          'Merchants', 'FIXED', 80, 'ACTIVE',
          'https://www.amazon.in/s?k=thermal+printer', 'https://www.amazon.in/s?k=thermal+printer&tag=mock-21',
          datetime('now'), datetime('now')
        )
      `).run(offerId, partnerId, orgId);
    } catch {}
  });

  afterEach(() => {
    delete process.env.GOOGLE_SITE_VERIFICATION;
    try {
      db.prepare("DELETE FROM partner_offers WHERE id = ?").run(offerId);
      db.prepare("DELETE FROM partners WHERE id = ?").run(partnerId);
      db.prepare("DELETE FROM commission_content_assets WHERE organization_id = ?").run(orgId);
    } catch {}
  });

  it('1. StaticSiteGenerator includes Google Search Console meta tag when env var is set and omits when unset', () => {
    const generator = StaticSiteGenerator.getInstance();
    const config = {
      siteName: 'Test Supplies Guide',
      authorName: 'Test Author',
      contactEmail: 'contact@example.com',
      siteUrl: 'https://example.com'
    };

    // When unset:
    const htmlWithout = generator.renderLandingPageHtml([], config);
    expect(htmlWithout).not.toContain('google-site-verification');

    // When set:
    process.env.GOOGLE_SITE_VERIFICATION = 'gsc_verification_code_abc123';
    const htmlWith = generator.renderLandingPageHtml([], config);
    expect(htmlWith).toContain('<meta name="google-site-verification" content="gsc_verification_code_abc123">');
  });

  it('2. ShareKitService fails closed when no guide is published', async () => {
    // Clean published guides for test org
    db.prepare("DELETE FROM commission_content_assets WHERE organization_id = ?").run(orgId);

    const kit = ShareKitService.getInstance();
    const result = await kit.generateWeeklyShareKit(orgId);
    expect(result.active).toBe(false);
    expect(result.reason).toContain('NO_PUBLISHED_GUIDES');
    expect(result.drafts).toHaveLength(0);
    expect(result.tavilySearchesRun).toBe(0);
  });

  it('3. ShareKitService drafts pre-formatted text linking ONLY to guide URL without Amazon links or tags', async () => {
    // Seed one PUBLISHED guide
    db.prepare(`
      INSERT OR REPLACE INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category,
        intent_target, content_markdown, status, created_at, updated_at
      ) VALUES (
        'guide_share_test_01', ?, 'best-thermal-shipping-label-printers', 'GUIDE',
        'Best Thermal Shipping Label Printers Guide', 'Logistics',
        'e-commerce merchants', '# Thermal Printer Guide', 'PUBLISHED',
        datetime('now'), datetime('now')
      )
    `).run(orgId);

    const kit = ShareKitService.getInstance();
    const result = await kit.generateWeeklyShareKit(orgId);

    expect(result.active).toBe(true);
    expect(result.drafts.length).toBeGreaterThan(0);
    expect(result.tavilySearchesRun).toBe(0);

    for (const draft of result.drafts) {
      expect(draft.guideUrl).toContain('/guides/best-thermal-shipping-label-printers');
      expect(draft.draftAnswer).toContain(draft.guideUrl);
      // Strict policy check: zero amazon URLs or tags
      expect(draft.draftAnswer).not.toContain('amazon.');
      expect(draft.draftAnswer).not.toContain('tag=');
    }
  });

  it('4. Beacon endpoint records visit with salted IP hash without external tool or LLM calls', async () => {
    const res = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      },
      body: JSON.stringify({
        offerId,
        placement: 'direct_beacon',
        source: 'direct_beacon',
        url: 'https://ai-marketing-platform-core.web.app/guides/sample.html'
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.recorded).toBe(true);
    expect(body.data.isRevenue).toBe(false);
    expect(body.data.ipHash).toBeDefined();

    // Verify row was written to referral_click_events
    const count = db.prepare("SELECT count(*) as cnt FROM referral_click_events WHERE offer_id = ?").get(offerId) as any;
    expect(count.cnt).toBeGreaterThanOrEqual(1);
  });

  it('5. Beacon endpoint filters out bot traffic safely', async () => {
    const res = await app.request('/api/v1/referrals/beacon', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)'
      },
      body: JSON.stringify({
        offerId,
        placement: 'direct_beacon'
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.recorded).toBe(false);
  });
});
