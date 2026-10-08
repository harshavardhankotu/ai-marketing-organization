import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../../src/db/client.js';
import { OwnerControlCenterEngine } from '../../src/commission/owner-control-center.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_OUTPUT_DIR = path.resolve(__dirname, '../../../frontend/dist-fixture-test');

describe('Item 6: Publish Chain Behind The Approval Gate (Fixtures and Dry-Run Only)', () => {
  const orgId = 'org_owner_primary';
  const engine = OwnerControlCenterEngine.getInstance();
  const db = getDb();

  beforeEach(() => {
    // Clean test fixture directory
    if (fs.existsSync(FIXTURE_OUTPUT_DIR)) {
      fs.rmSync(FIXTURE_OUTPUT_DIR, { recursive: true, force: true });
    }

    // Clean up test offer and content asset slugs
    try {
      db.prepare("DELETE FROM partner_offers WHERE offer_slug LIKE '%b08p13wglx%'").run();
      db.prepare("DELETE FROM commission_content_assets WHERE slug LIKE '%b08p13wglx%'").run();
    } catch {}

    // Ensure valid owner intake exists
    db.prepare(`
      INSERT OR REPLACE INTO owner_intake (
        id, organization_id, application_date, listed_site_urls_json,
        agreement_read_confirmed, agreement_read_confirmed_at,
        site_name, author_name, contact_email,
        tavily_key_rotated, status, written_by,
        created_at, completed_at, updated_at
      ) VALUES (
        'intake_test_gate', ?, '2026-10-08', '["https://ai-marketing-platform-core.web.app"]',
        1, datetime('now'),
        'Commercial Printing Reviews', 'Harsha Vardhan', 'review@reviewhub.in',
        1, 'VALID', 'OWNER_FORM',
        datetime('now'), datetime('now'), datetime('now')
      )
    `).run(orgId);

    // Ensure Amazon Associates partner exists
    db.prepare(`
      INSERT INTO partners (
        id, organization_id, name, industry, country, website,
        partner_type, approval_status, active_status, network, tracking_type,
        authorization_status, program_url, coverage, disclosure_required, evidence_json,
        created_at, updated_at
      ) VALUES (
        'part_amazon_in_01', ?, 'Amazon Associates India', 'ecommerce', 'India',
        'https://affiliate-program.amazon.in', 'AFFILIATE', 'PROVISIONAL', 1,
        'AMAZON_ASSOCIATES', 'DIRECT_ID_TAG', 'AUTHORIZED', 'https://affiliate-program.amazon.in',
        'India', 1, '{}', datetime('now'), datetime('now')
      ) ON CONFLICT(id) DO UPDATE SET organization_id = excluded.organization_id, active_status = 1, approval_status = 'PROVISIONAL', authorization_status = 'AUTHORIZED'
    `).run(orgId);

    // Seed test proposal in PROPOSED state
    db.prepare(`
      INSERT OR REPLACE INTO product_proposals (
        id, organization_id, category, product_name, manufacturer_name,
        spec_summary, source_url, retrieval_date, page_text_snippet,
        status, product_checked, provenance, created_at, updated_at
      ) VALUES (
        'prop_phomemo_gate_test', ?, 'Office & Commercial Supplies',
        'Phomemo PM-241BT Bluetooth Shipping Label Printer', 'Phomemo Official',
        'Direct Thermal 203 DPI, 150 mm/s print speed, supports 1-4 inch label rolls',
        'https://phomemo.com/products/pm-241bt', '2026-10-08',
        '"Direct Thermal 203 DPI specification"',
        'PROPOSED', 0, 'APP_LOGGED_CALL', datetime('now'), datetime('now')
      )
    `).run(orgId);
  });

  afterEach(() => {
    delete process.env.AMAZON_AFFILIATE_TAG;
    if (fs.existsSync(FIXTURE_OUTPUT_DIR)) {
      fs.rmSync(FIXTURE_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it('GATE REFUSAL: Refuses to execute publish chain if proposal is not approved by owner', async () => {
    await expect(
      engine.executePublishChainBehindApprovalGate(orgId, 'prop_phomemo_gate_test', {
        outputDir: FIXTURE_OUTPUT_DIR
      })
    ).rejects.toThrow(/APPROVAL_GATE_LOCKED.*status is 'PROPOSED'.*Owner approval on Amazon.in is strictly required/);
  });

  it('GATE REFUSAL: Refuses to execute publish chain if productChecked is false', async () => {
    // Manually force status to APPROVED without product_checked
    db.prepare("UPDATE product_proposals SET status = 'APPROVED', product_checked = 0 WHERE id = 'prop_phomemo_gate_test'").run();

    await expect(
      engine.executePublishChainBehindApprovalGate(orgId, 'prop_phomemo_gate_test', {
        outputDir: FIXTURE_OUTPUT_DIR
      })
    ).rejects.toThrow(/APPROVAL_GATE_LOCKED/);
  });

  it('COMPLETE PIPELINE: After owner approves product, builds guide from owner plus manufacturer facts, lints, renders static HTML, verifies sitemap and Firebase dry-run, without publishing to production', async () => {
    process.env.AMAZON_AFFILIATE_TAG = 'reviewhub21-21';

    // 1. Owner approves product through canonical approval gate
    const approvalResult = await engine.approveProposal(orgId, 'prop_phomemo_gate_test', {
      amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX?tag=reviewhub21-21',
      productChecked: true,
      displayName: 'Phomemo PM-241BT Thermal Shipping Label Printer',
      listingFacts: [
        { fact: 'Direct Thermal 203 DPI Resolution Printing', date: '2026-10-08', type: 'spec' },
        { fact: 'Maximum print speed of 150 mm per second', date: '2026-10-08', type: 'spec' },
        { fact: 'Compatible with standard 4x6 inch thermal shipping labels', date: '2026-10-08', type: 'spec' }
      ],
      writtenBy: 'OWNER_FORM'
    });

    expect(approvalResult.proposal.status).toBe('APPROVED');
    expect(approvalResult.proposal.productChecked).toBe(true);
    expect(approvalResult.offer.status).toBe('ACTIVE');

    // 2. Execute publish chain behind approval gate in dry-run/fixture mode
    const chainResult = await engine.executePublishChainBehindApprovalGate(orgId, 'prop_phomemo_gate_test', {
      outputDir: FIXTURE_OUTPUT_DIR
    });

    // 3. Verify gate status and output identifiers
    expect(chainResult.success).toBe(true);
    expect(chainResult.gateStatus).toBe('APPROVED_AND_ACTIVE');
    expect(chainResult.lintPassed).toBe(true);
    expect(chainResult.guideSlug).toBeDefined();
    expect(chainResult.guideUrl).toContain('https://ai-marketing-platform-core.web.app/guides/');
    expect(chainResult.sitemapUrl).toBe('https://ai-marketing-platform-core.web.app/sitemap.xml');
    expect(chainResult.statusPageUrl).toBe('https://ai-marketing-organization.onrender.com/owner/status');

    // 4. Verify guide combines BOTH owner-approved listing facts AND manufacturer facts
    const assetRow = db.prepare('SELECT * FROM commission_content_assets WHERE id = ?').get(chainResult.guideAssetId) as any;
    expect(assetRow).toBeDefined();
    expect(assetRow.content_markdown).toContain('## Verified Technical Specifications (Owner-Approved)');
    expect(assetRow.content_markdown).toContain('Direct Thermal 203 DPI Resolution Printing');
    expect(assetRow.content_markdown).toContain('Maximum print speed of 150 mm per second');
    expect(assetRow.content_markdown).toContain('Compatible with standard 4x6 inch thermal shipping labels');

    // Manufacturer facts from proposal
    expect(assetRow.content_markdown).toContain('## Manufacturer Specifications & Documentation');
    expect(assetRow.content_markdown).toContain('Phomemo Official');
    expect(assetRow.content_markdown).toContain('https://phomemo.com/products/pm-241bt');

    // Mandatory disclosure
    expect(assetRow.content_markdown).toContain('As an Amazon Associate I earn from qualifying purchases.');

    // 5. Verify static rendering output files exist on disk
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'sitemap.xml'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'robots.txt'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'about', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'privacy', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'terms', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE_OUTPUT_DIR, 'disclosure', 'index.html'))).toBe(true);

    // 6. Verify sitemap.xml contains the guide URL
    const sitemapContent = fs.readFileSync(path.join(FIXTURE_OUTPUT_DIR, 'sitemap.xml'), 'utf-8');
    expect(sitemapContent).toContain(chainResult.guideUrl);

    // 7. Verify NO production publish: Asset in database remains status = PUBLISH_READY (zero live publish)
    expect(assetRow.status).toBe('PUBLISH_READY');
    expect(chainResult.productionPublish).toBe('BLOCKED_BEHIND_OWNER_GATE');
    expect(chainResult.firebaseDeployment).toBe('DRY_RUN_VERIFIED');
  });
});
