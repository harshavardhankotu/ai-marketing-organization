import { describe, it, expect, beforeEach } from 'vitest';
import { OwnerControlCenterEngine } from '../../src/commission/owner-control-center.js';
import { getDb } from '../../src/db/client.js';

describe('Owner Action Truth Gates (Step 1c)', () => {
  const engine = OwnerControlCenterEngine.getInstance();
  const orgId = 'org_owner_primary';

  beforeEach(() => {
    const db = getDb();
    // Clean test tables
    db.prepare('DELETE FROM owner_intake').run();
    db.prepare('DELETE FROM product_proposals').run();
    db.prepare('DELETE FROM partner_offers').run();
    db.prepare('DELETE FROM partners').run();
    db.prepare('DELETE FROM commission_content_assets').run();
    db.prepare('DELETE FROM referral_click_events').run();
    db.prepare('DELETE FROM stored_reports').run();
  });

  it('1. complete intake resolves strictly on status VALID and written_by OWNER_FORM', async () => {
    const db = getDb();

    // Case A: 0 rows -> OPEN
    let status = await engine.computeStatus(orgId);
    let intakeAction = status.openActions.find(a => a.id === 'act_complete_intake');
    expect(intakeAction?.resolved).toBe(false);

    // Case B: written_by = AGENT -> OPEN
    db.prepare(`
      INSERT INTO owner_intake (
        id, organization_id, status, written_by, application_date, site_name,
        listed_site_urls_json, agreement_read_confirmed, agreement_read_confirmed_at,
        author_name, contact_email, tavily_key_rotated, completed_at, created_at, updated_at
      ) VALUES (
        ?, ?, 'VALID', 'AGENT', '2026-10-08', 'Test Site',
        '["https://example.com"]', 1, '2026-10-08T00:00:00Z',
        'Owner', 'owner@example.com', 1, '2026-10-08T00:00:00Z', datetime('now'), datetime('now')
      )
    `).run(orgId, orgId);

    status = await engine.computeStatus(orgId);
    intakeAction = status.openActions.find(a => a.id === 'act_complete_intake');
    expect(intakeAction?.resolved).toBe(false);

    // Case C: written_by = OWNER_FORM and status = VALID -> RESOLVED
    db.prepare(`UPDATE owner_intake SET written_by = 'OWNER_FORM' WHERE organization_id = ?`).run(orgId);

    status = await engine.computeStatus(orgId);
    intakeAction = status.openActions.find(a => a.id === 'act_complete_intake');
    expect(intakeAction?.resolved).toBe(true);
  });

  it('2. approve product resolves strictly on APPROVED proposal with owner_session_id AND active partner offer', async () => {
    const db = getDb();

    // Case A: 0 proposals, 0 offers -> OPEN
    let status = await engine.computeStatus(orgId);
    let approveAction = status.openActions.find(a => a.id === 'act_approve_product');
    expect(approveAction?.resolved).toBe(false);

    // Case B: Proposal is APPROVED, but owner_session_id is NULL -> OPEN
    db.prepare(`
      INSERT INTO product_proposals (id, organization_id, category, product_name, manufacturer_name, spec_summary, source_url, retrieval_date, status, created_at, updated_at)
      VALUES ('prop_01', ?, 'office', 'Printer', 'Phomemo', 'Direct thermal', 'https://phomemo.com', '2026-10-08', 'APPROVED', datetime('now'), datetime('now'))
    `).run(orgId);

    status = await engine.computeStatus(orgId);
    approveAction = status.openActions.find(a => a.id === 'act_approve_product');
    expect(approveAction?.resolved).toBe(false);

    // Case C: Proposal has owner_session_id, but partner_offers has 0 active offers -> OPEN
    db.prepare(`UPDATE product_proposals SET owner_session_id = 'sess_owner_123' WHERE id = 'prop_01'`).run();

    status = await engine.computeStatus(orgId);
    approveAction = status.openActions.find(a => a.id === 'act_approve_product');
    expect(approveAction?.resolved).toBe(false);

    // Case D: Proposal has owner_session_id AND partner_offers has active=1 -> RESOLVED
    db.prepare(`
      INSERT INTO partners (id, organization_id, name, industry, network, website, approval_status, authorization_status, active_status, created_at, updated_at)
      VALUES ('part_amz', ?, 'Amazon', 'E-commerce', 'AMAZON_ASSOCIATES', 'https://amazon.in', 'APPROVED', 'AUTHORIZED', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(orgId);
    db.prepare(`
      INSERT INTO partner_offers (id, partner_id, organization_id, title, offer_slug, destination_url, authorized_tracking_url, category, target_customer, conversion_action, active, status, created_at, updated_at)
      VALUES ('poff_01', 'part_amz', ?, 'Phomemo Printer', 'amazon-b08p13wglx', 'https://amazon.in/dp/B08P13WGLX', 'https://amazon.in/dp/B08P13WGLX?tag=test', 'office', 'Logistics', 'PURCHASE', 1, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(orgId);

    status = await engine.computeStatus(orgId);
    approveAction = status.openActions.find(a => a.id === 'act_approve_product');
    expect(approveAction?.resolved).toBe(true);
  });

  it('3. publish guide resolves strictly on at least 1 guide with status PUBLISHED', async () => {
    const db = getDb();

    // Case A: 0 guides -> OPEN
    let status = await engine.computeStatus(orgId);
    let publishAction = status.openActions.find(a => a.id === 'act_publish_guide');
    expect(publishAction?.resolved).toBe(false);

    // Case B: Guide exists with status PUBLISH_READY -> OPEN
    db.prepare(`
      INSERT INTO commission_content_assets (id, organization_id, slug, asset_type, title, category, location, intent_target, content_markdown, disclosure_markdown, status, created_at, updated_at)
      VALUES ('cnt_01', ?, 'printer-guide', 'GUIDE', 'Printer Guide', 'office', 'India', 'Intent', '# Markdown', 'Disclosure', 'PUBLISH_READY', datetime('now'), datetime('now'))
    `).run(orgId);

    status = await engine.computeStatus(orgId);
    publishAction = status.openActions.find(a => a.id === 'act_publish_guide');
    expect(publishAction?.resolved).toBe(false);

    // Case C: Guide status = PUBLISHED -> RESOLVED
    db.prepare(`UPDATE commission_content_assets SET status = 'PUBLISHED' WHERE id = 'cnt_01'`).run();

    status = await engine.computeStatus(orgId);
    publishAction = status.openActions.find(a => a.id === 'act_publish_guide');
    expect(publishAction?.resolved).toBe(true);
  });

  it('4. share URL resolves strictly on real visit recorded by click beacon', async () => {
    const db = getDb();

    // Case A: 0 visits -> OPEN
    let status = await engine.computeStatus(orgId);
    let shareAction = status.openActions.find(a => a.id === 'act_share_guide');
    expect(shareAction?.resolved).toBe(false);

    // Case B: Real click beacon visit recorded -> RESOLVED
    db.prepare(`
      INSERT INTO referral_click_events (id, referral_id, click_id, organization_id, offer_id, partner_id, destination_url, placement, source, medium, created_at)
      VALUES ('evt_bcn_1', 'ref_bcn_test', 'clk_bcn_1', ?, 'poff_01', 'part_amz', 'https://example.com/guide', 'direct_beacon', 'direct_beacon', 'beacon', datetime('now'))
    `).run(orgId);

    status = await engine.computeStatus(orgId);
    shareAction = status.openActions.find(a => a.id === 'act_share_guide');
    expect(shareAction?.resolved).toBe(true);
  });

  it('5. upload report resolves strictly on stored report file with verified content hash', async () => {
    const db = getDb();

    // Case A: 0 stored reports -> OPEN
    let status = await engine.computeStatus(orgId);
    let reportAction = status.openActions.find(a => a.id === 'act_upload_associates_report');
    expect(reportAction?.resolved).toBe(false);

    // Case B: Ingest real report -> records to stored_reports -> RESOLVED
    // Seed partner first
    db.prepare(`
      INSERT INTO partners (id, organization_id, name, industry, network, website, approval_status, authorization_status, active_status, created_at, updated_at)
      VALUES ('part_amazon_in_01', ?, 'Amazon Associates', 'E-commerce', 'AMAZON_ASSOCIATES', 'https://affiliate-program.amazon.in', 'APPROVED', 'AUTHORIZED', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(orgId);

    const csvContent = `Date,Items Ordered,Items Shipped,Revenue,Earnings,ASIN\n2026-10-08,1,1,₹3499,₹175,B08P13WGLX`;
    await engine.ingestAssociatesReport(orgId, csvContent, 'oct_report.csv');

    status = await engine.computeStatus(orgId);
    reportAction = status.openActions.find(a => a.id === 'act_upload_associates_report');
    expect(reportAction?.resolved).toBe(true);

    const storedRow = db.prepare('SELECT * FROM stored_reports WHERE organization_id = ?').get(orgId) as any;
    expect(storedRow).toBeDefined();
    expect(storedRow.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedRow.filename).toBe('oct_report.csv');
  });

  it('verifies 5 canonical owner actions resolve strictly on proof and open otherwise', async () => {
    const db = getDb();
    // Initially all 5 are open
    let status = await engine.computeStatus(orgId);
    const initialResolved = status.openActions.filter(a => a.resolved);
    expect(initialResolved.length).toBe(0);

    // 1. complete intake: requires VALID status and OWNER_FORM written_by
    db.prepare(`
      INSERT INTO owner_intake (
        id, organization_id, status, written_by, application_date, site_name,
        listed_site_urls_json, agreement_read_confirmed, agreement_read_confirmed_at,
        author_name, contact_email, tavily_key_rotated, completed_at, created_at, updated_at
      ) VALUES (
        ?, ?, 'VALID', 'OWNER_FORM', '2026-10-08', 'Test Site',
        '["https://example.com"]', 1, '2026-10-08T00:00:00Z',
        'Owner', 'owner@example.com', 1, '2026-10-08T00:00:00Z', datetime('now'), datetime('now')
      )
    `).run(orgId, orgId);

    // 2. approve product: requires APPROVED proposal with owner_session_id AND active partner offer
    db.prepare(`
      INSERT INTO product_proposals (id, organization_id, category, product_name, manufacturer_name, spec_summary, source_url, retrieval_date, status, owner_session_id, approved_at, created_at, updated_at)
      VALUES ('prop_01', ?, 'office', 'Printer', 'Phomemo', 'Direct thermal', 'https://phomemo.com', '2026-10-08', 'APPROVED', 'sess_owner_999', datetime('now'), datetime('now'), datetime('now'))
    `).run(orgId);
    db.prepare(`
      INSERT INTO partners (id, organization_id, name, industry, network, website, approval_status, authorization_status, active_status, created_at, updated_at)
      VALUES ('part_amz', ?, 'Amazon', 'E-commerce', 'AMAZON_ASSOCIATES', 'https://amazon.in', 'APPROVED', 'AUTHORIZED', 'ACTIVE', datetime('now'), datetime('now'))
    `).run(orgId);
    db.prepare(`
      INSERT INTO partner_offers (id, partner_id, organization_id, title, offer_slug, destination_url, authorized_tracking_url, category, target_customer, conversion_action, active, status, created_at, updated_at)
      VALUES ('poff_01', 'part_amz', ?, 'Phomemo Printer', 'amazon-b08p13wglx', 'https://amazon.in/dp/B08P13WGLX', 'https://amazon.in/dp/B08P13WGLX?tag=test', 'office', 'Logistics', 'PURCHASE', 1, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(orgId);

    // 3. publish guide: requires guide with status PUBLISHED
    db.prepare(`
      INSERT INTO commission_content_assets (id, organization_id, slug, asset_type, title, category, location, intent_target, content_markdown, disclosure_markdown, status, created_at, updated_at)
      VALUES ('cnt_01', ?, 'printer-guide', 'GUIDE', 'Printer Guide', 'office', 'India', 'Intent', '# Markdown', 'Disclosure', 'PUBLISHED', datetime('now'), datetime('now'))
    `).run(orgId);

    // 4. share URL: requires real visit recorded by click beacon
    db.prepare(`
      INSERT INTO referral_click_events (id, referral_id, click_id, organization_id, offer_id, partner_id, destination_url, placement, source, medium, created_at)
      VALUES ('evt_bcn_1', 'ref_bcn_test', 'clk_bcn_1', ?, 'poff_01', 'part_amz', 'https://example.com/guide', 'direct_beacon', 'direct_beacon', 'beacon', datetime('now'))
    `).run(orgId);

    // 5. upload report: requires stored report file with verified content hash
    db.prepare(`
      INSERT INTO stored_reports (id, organization_id, filename, content_hash, byte_size, row_count, created_at)
      VALUES ('rep_01', ?, 'report.csv', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 100, 1, datetime('now'))
    `).run(orgId);

    status = await engine.computeStatus(orgId);
    const resolvedActions = status.openActions.filter(a => a.resolved);
    expect(resolvedActions.length).toBe(5);
  });
});
