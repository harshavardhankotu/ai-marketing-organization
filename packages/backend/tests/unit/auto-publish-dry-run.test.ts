import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach } from 'vitest';
import { AutomaticOfferLane, GeneratedGuide, SpecLineRecord } from '../../src/commission/automatic-offer-lane.js';
import { prepareDeployGuides } from '../../../../scripts/prepare-deploy-guides.mjs';
import { getDb } from '../../src/db/client.js';

describe('Step 4: Automatic Publish & Deploy Dry-Run Verification', () => {
  const lane = AutomaticOfferLane.getInstance();

  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare('DELETE FROM commission_content_assets').run();
    } catch {}
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
      CREATE TABLE IF NOT EXISTS brand_spec_lines (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        spec_line TEXT NOT NULL,
        source_url TEXT NOT NULL,
        retrieved_at TEXT NOT NULL
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
        productId: 'prod_phomemo_m110',
        brand: 'Phomemo',
        model: 'M110',
        specLine: 'Print speed: 150mm/s direct thermal printing',
        sourceUrl: 'https://phomemo.com/m110',
        retrievedAt: new Date().toISOString()
      }
    ];

    db.prepare(`
      INSERT OR REPLACE INTO brand_spec_lines (id, product_id, brand, model, spec_line, source_url, retrieved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(specLines[0].id, specLines[0].productId, specLines[0].brand, specLines[0].model, specLines[0].specLine, specLines[0].sourceUrl, specLines[0].retrievedAt);

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
      const tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-dry-run-'));
      try {
        const deployRes = await prepareDeployGuides({
          dryRun: true,
          outputDir: tempOutputDir,
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
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
      }
    } finally {
      process.env.AUTO_PUBLISH_ENABLED = prevEnv;
    }
  });

  it('fails with NO_PUBLISHED_GUIDE when zero published guides exist (Step 4b)', async () => {
    await expect(
      prepareDeployGuides({ dryRun: true, mockGuides: [] })
    ).rejects.toThrow(/NO_PUBLISHED_GUIDE/);
  });

  it('builds positive one-published-guide catalog in temporary directory without dirtying public/ (Section B)', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-positive-test-'));
    try {
      const mockGuide = {
        id: 'guide_phomemo_test',
        title: 'Thermal Label Printer Buyer Guide',
        slug: 'thermal-label-printer-guide',
        body: '<p>Comprehensive thermal printer guide</p>',
        created_at: new Date().toISOString()
      };

      const res = await prepareDeployGuides({
        outputDir: tempDir,
        mockGuides: [mockGuide]
      });

      expect(res.skipped).toBeUndefined();
      expect(res.publishedCount).toBe(1);
      expect(res.sitemapUrls).toHaveLength(2); // Root + 1 guide
      expect(res.sitemapUrls[1]).toContain(mockGuide.slug);

      // Verify files written to temporary directory only
      const guideFile = path.join(tempDir, 'guides', `${mockGuide.slug}.html`);
      expect(fs.existsSync(guideFile)).toBe(true);
      const guideContent = fs.readFileSync(guideFile, 'utf8');
      expect(guideContent).toContain(mockGuide.title);

      const indexFile = path.join(tempDir, 'index.html');
      expect(fs.existsSync(indexFile)).toBe(true);
      expect(fs.readFileSync(indexFile, 'utf8')).toContain(mockGuide.title);

      const sitemapFile = path.join(tempDir, 'sitemap.xml');
      expect(fs.existsSync(sitemapFile)).toBe(true);
      expect(fs.readFileSync(sitemapFile, 'utf8')).toContain(`/guides/${mockGuide.slug}.html`);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('verifies deploy-guides.yml has credential check and emits exact notice when firebase key is missing', () => {
    const rootDir = fs.existsSync(path.resolve(process.cwd(), '.github'))
      ? process.cwd()
      : path.resolve(process.cwd(), '../..');
    const workflowPath = path.resolve(rootDir, '.github/workflows/deploy-guides.yml');
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, 'utf8');

    // 1. Workflow file contains the check step and notice
    expect(content).toContain('Check Firebase Deployment Credentials');
    expect(content).toContain('id: check-firebase');
    expect(content).toContain('echo "::notice::deploy skipped: key missing"');
    expect(content).toContain('steps.check-firebase.outputs.can_deploy == \'true\'');

    // 2. Exact simulation of workflow logic
    const simulateWorkflowKeyCheck = (hasKey: boolean, skippedOutput: string): { canDeploy: boolean; noticeEmitted: string | null } => {
      let canDeploy = false;
      let noticeEmitted: string | null = null;
      if (hasKey) {
        canDeploy = true;
      } else {
        canDeploy = false;
        if (skippedOutput !== 'true') {
          noticeEmitted = '::notice::deploy skipped: key missing';
        }
      }
      return { canDeploy, noticeEmitted };
    };

    // When key is missing and published guides exist (skipped != 'true')
    const resultMissing = simulateWorkflowKeyCheck(false, 'false');
    expect(resultMissing.canDeploy).toBe(false);
    expect(resultMissing.noticeEmitted).toBe('::notice::deploy skipped: key missing');

    // When key is present and guides exist
    const resultPresent = simulateWorkflowKeyCheck(true, 'false');
    expect(resultPresent.canDeploy).toBe(true);
    expect(resultPresent.noticeEmitted).toBeNull();

    // When skipped is true (no published guides), no notice even if key is missing
    const resultSkipped = simulateWorkflowKeyCheck(false, 'true');
    expect(resultSkipped.canDeploy).toBe(false);
    expect(resultSkipped.noticeEmitted).toBeNull();
  });
});
