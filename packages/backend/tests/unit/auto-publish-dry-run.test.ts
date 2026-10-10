import { describe, it, expect, beforeEach } from 'vitest';
import { AutomaticOfferLane, GeneratedGuide, SpecLineRecord } from '../../src/commission/automatic-offer-lane.js';
import { prepareDeployGuides } from '../../../../scripts/prepare-deploy-guides.mjs';
import { getDb } from '../../src/db/client.js';

describe('Step 4: Automatic Publish & Deploy Dry-Run Verification', () => {
  const lane = AutomaticOfferLane.getInstance();

  beforeEach(() => {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_intake (
        id TEXT PRIMARY KEY,
        written_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS partners (
        id TEXT PRIMARY KEY,
        network TEXT NOT NULL,
        approval_status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_assets (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        business_id TEXT NOT NULL,
        offer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        slug TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        format TEXT NOT NULL,
        body TEXT NOT NULL,
        target_url TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS referral_click_events (
        id TEXT PRIMARY KEY,
        placement TEXT NOT NULL
      );
    `);
  });

  it('executes full dry run: lint pass, publish, build, deploy command printed, IndexNow payload printed (Step 4g)', async () => {
    const db = getDb();

    // 1. Setup valid owner intake and provisional partner
    db.prepare(`
      INSERT OR REPLACE INTO owner_intake (
        id, organization_id, application_date, listed_site_urls_json, agreement_read_confirmed,
        agreement_read_confirmed_at, site_name, author_name, contact_email, tavily_key_rotated,
        completed_at, updated_at, written_by, status, created_at
      ) VALUES (
        'intake_01', 'org_owner_primary', '2026-09-01', '["https://aimarketing.org"]', 1,
        datetime('now'), 'AI Marketing Org', 'Owner Name', 'owner@aimarketing.org', 1,
        datetime('now'), datetime('now'), 'OWNER_ENV', 'VALID', datetime('now')
      )
    `).run();
    db.prepare(`INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, approval_status) VALUES ('part_amz', 'org_owner_primary', 'Amazon Associates', 'E-commerce', 'https://amazon.in', 'AMAZON_ASSOCIATES', 'PROVISIONAL')`).run();

    // 2. Verified spec lines
    const specLines: SpecLineRecord[] = [
      {
        id: 'spec_1',
        productId: 'prod_dryrun',
        brand: 'Phomemo',
        model: 'M110',
        specLine: 'Print speed: 150mm/s direct thermal printing',
        sourceUrl: 'https://phomemo.com/m110',
        retrievedAt: new Date().toISOString()
      }
    ];

    // 3. Generate guide
    const guide: GeneratedGuide = lane.generateGuide(
      {
        category: 'thermal label printer',
        brand: 'Phomemo',
        model: 'M110',
        targetQuery: 'Phomemo M110'
      },
      specLines
    );

    // 4. Run Lint -> Passes
    const lintRes = lane.lintGuide(guide, specLines);
    expect(lintRes.valid).toBe(true);
    expect(lintRes.errors.length).toBe(0);

    // 5. Publish guide with AUTO_PUBLISH_ENABLED=true
    const prevEnv = process.env.AUTO_PUBLISH_ENABLED;
    process.env.AUTO_PUBLISH_ENABLED = 'true';

    try {
      const pubRes = lane.activateAndPublishGuide(guide, lintRes);
      expect(pubRes.published).toBe(true);

      // Verify guide is in commission_content_assets with status PUBLISHED
      const asset = db.prepare(`SELECT * FROM commission_content_assets WHERE slug = ?`).get(guide.slug) as any;
      expect(asset).toBeDefined();
      expect(asset.status).toBe('PUBLISHED');

      // 6. Run prepareDeployGuides dry run
      const deployRes = await prepareDeployGuides({
        dryRun: true,
        mockGuides: [{
          id: asset.id,
          title: asset.title,
          slug: asset.slug,
          body: asset.content_markdown,
          created_at: asset.created_at
        }]
      });

      expect(deployRes.publishedCount).toBeGreaterThan(0);
      expect(deployRes.indexNowPayload.host).toBeDefined();
      expect(deployRes.indexNowPayload.key).toBeDefined();
      expect(deployRes.indexNowPayload.urlList.length).toBeGreaterThan(0);
    } finally {
      process.env.AUTO_PUBLISH_ENABLED = prevEnv;
    }
  });

  it('fails with NO_PUBLISHED_GUIDE when zero published guides exist (Step 4b)', async () => {
    await expect(
      prepareDeployGuides({ dryRun: true, mockGuides: [] })
    ).rejects.toThrow(/NO_PUBLISHED_GUIDE/);
  });
});
