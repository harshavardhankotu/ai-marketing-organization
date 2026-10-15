import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { ProductOpportunityPipeline } from '../../src/commission/product-opportunity-pipeline.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { CommissionLedgerEngine } from '../../src/commission/commission-ledger.js';
import app from '../../src/index.js';

const ORG = 'org_owner_primary';
const BIZ = 'biz_platform_aro';

describe('Buying Funnel Reconciliation & Opportunity Progression Suite', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    ProductOpportunityPipeline.resetInstanceForTesting();

    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO partners (
        id, organization_id, name, industry, website, partner_type, approval_status, active_status
      ) VALUES (
        'part_amazon_in_01', ?, 'Amazon India Associates', 'E-COMMERCE', 'https://amazon.in', 'AFFILIATE', 'APPROVED', 1
      )
    `).run(ORG);

    db.prepare(`
      INSERT OR REPLACE INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, status, active
      ) VALUES (
        'poff_6fd7d0d3-7', 'part_amazon_in_01', ?, 'Phomemo PM-241BT Thermal Printer', 'phomemo-pm-241bt',
        'office', 'Shipping label sellers', 'https://amazon.in/s?k=thermal+printer',
        'https://amazon.in/s?k=thermal+printer&tag=test-21', 'ACTIVE', 1
      )
    `).run(ORG);
  });

  afterEach(() => {
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;
  });

  describe('1. Reconciled 15-Stage Funnel & Cumulative Stage Counts', () => {
    it('counts guides cumulatively so publish-ready guides do not disappear from drafted count', async () => {
      const db = getDb();

      // Ensure single offer and single PUBLISH_READY guide (matching production reality)
      db.prepare("DELETE FROM commission_content_assets WHERE organization_id = ?").run(ORG);
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, intent_target,
          content_markdown, primary_offer_id, status, view_count, referral_click_count, created_at
        ) VALUES (
          'cnt_test_ready', ?, 'test-ready-guide', 'GUIDE',
          'Test Thermal Printer Guide', 'office', 'best thermal printer',
          'Guide content', 'poff_6fd7d0d3-7', 'PUBLISH_READY', 0, 0, datetime('now')
        )
      `).run(ORG);

      // Seed demand signal so stages 1-3 have non-zero counts
      db.prepare(`
        INSERT OR REPLACE INTO demand_signals (
          id, organization_id, category, topic, raw_query, signal_type, urgency,
          estimated_monthly_volume, status, evidence_snippet, source_url, created_at
        ) VALUES (
          'sig_test_01', ?, 'office', 'thermal printer', 'thermal shipping printer',
          'BUYER_QUESTION', 0.8, 200, 'DISCOVERED', 'Thermal printer evidence', 'https://example.com/test', datetime('now')
        )
      `).run(ORG);

      // Simulate 22 internal referral tracking link creations (matching production reality)
      db.prepare("DELETE FROM referrals WHERE organization_id = ?").run(ORG);
      for (let i = 1; i <= 22; i++) {
        db.prepare(`
          INSERT INTO referrals (
            id, partner_id, offer_id, organization_id, click_id, destination_url,
            source, campaign, created_at
          ) VALUES (?, 'part_amazon_in_01', 'poff_6fd7d0d3-7', ?, ?, 'https://amazon.in/s?k=printer', 'autonomous_loop', 'cycle_test', datetime('now'))
        `).run(`ref_auto_${i}`, ORG, `clk_auto_${i}`);
      }

      const res = await app.request('/api/v1/commission/funnel', {
        headers: { 'x-organization-id': ORG }
      });
      expect(res.status).toBe(200);

      const json = await res.json() as any;
      expect(json.success).toBe(true);

      const stages = json.data.stages;
      const draftStage = stages.find((s: any) => s.stageKey === 'DRAFT_GUIDES');
      const readyStage = stages.find((s: any) => s.stageKey === 'PUBLISH_READY_GUIDES');
      const intakeStage = stages.find((s: any) => s.stageKey === 'OWNER_INTAKE_ATTESTED');
      const publishedStage = stages.find((s: any) => s.stageKey === 'PUBLISHED_GUIDES');
      const clickStage = stages.find((s: any) => s.stageKey === 'OUTBOUND_CLICKS');

      // Cumulative draft count must be 1 (not 0) because guide reached publish-ready
      expect(draftStage.count).toBe(1);
      expect(draftStage.status).toBe('CLEAR');

      // Publish-ready stage must be 1
      expect(readyStage.count).toBe(1);
      expect(readyStage.status).toBe('CLEAR');

      // Owner intake attestation must be 0 and identified as CURRENT_BOTTLENECK
      expect(intakeStage.count).toBe(0);
      expect(intakeStage.status).toBe('CURRENT_BOTTLENECK');

      // Downstream published guides must be 0 and BLOCKED_DOWNSTREAM
      expect(publishedStage.count).toBe(0);
      expect(publishedStage.status).toBe('BLOCKED_DOWNSTREAM');

      // Outbound clicks must be 0 (internal referral link generation is NOT a click)
      expect(clickStage.count).toBe(0);

      // Active top blocker must be OWNER_INTAKE_ATTESTED (Stage 8), NOT DRAFT_GUIDES (Stage 6)
      expect(json.data.activeTopBlocker.stageIndex).toBe(8);
      expect(json.data.activeTopBlocker.stageKey).toBe('OWNER_INTAKE_ATTESTED');

      // Attribution diagnostics must explain the 22 tracking links
      expect(json.data.attributionDiagnostics.internalTrackingLinksGenerated).toBe(22);
      expect(json.data.attributionDiagnostics.realOutboundClicksRecorded).toBe(0);
      expect(json.data.attributionDiagnostics.explanation).toContain('internal tracking links');
    });
  });

  describe('2. Click Attribution vs Internal Link Generation', () => {
    it('CommissionLedgerEngine does not treat internal tracking link generation as clicks', async () => {
      const db = getDb();
      const ledger = CommissionLedgerEngine.getInstance();

      // Seed 15 internal referral rows with 0 content asset clicks
      db.prepare("DELETE FROM referrals WHERE organization_id = ?").run(ORG);
      for (let i = 1; i <= 15; i++) {
        db.prepare(`
          INSERT INTO referrals (
            id, partner_id, offer_id, organization_id, click_id, destination_url,
            source, campaign, created_at
          ) VALUES (?, 'part_amazon_in_01', 'poff_6fd7d0d3-7', ?, ?, 'https://amazon.in', 'autonomous_loop', 'cycle', datetime('now'))
        `).run(`ref_t_${i}`, ORG, `clk_t_${i}`);
      }

      const summary = await ledger.getSummary(ORG);
      // clicks must be 0
      expect(summary.clicks).toBe(0);
      // qualifiedReferrals records the 15 tracking link rows
      expect(summary.qualifiedReferrals).toBe(15);
    });
  });

  describe('3. NextBestActionEngine Pending Publication Gate', () => {
    it('halts new offer and content creation when an existing guide is PUBLISH_READY and awaits owner intake', () => {
      const db = getDb();
      const nbaEngine = NextBestActionEngine.getInstance();

      // Ensure an active offer exists with a PUBLISH_READY guide
      db.prepare("DELETE FROM commission_content_assets WHERE organization_id = ?").run(ORG);
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, intent_target,
          content_markdown, primary_offer_id, status, created_at
        ) VALUES (
          'cnt_pending_pub', ?, 'pending-guide', 'GUIDE',
          'Phomemo PM-241BT Guide', 'office', 'shipping printer',
          'Guide content', 'poff_6fd7d0d3-7', 'PUBLISH_READY', datetime('now')
        )
      `).run(ORG);

      // Seed unfulfilled demand signals
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, category, topic, raw_query, signal_type, urgency,
          estimated_monthly_volume, status, evidence_snippet, source_url, created_at
        ) VALUES (
          'sig_unfulfilled_01', ?, 'wireless microphone', 'Best wireless mic',
          'which wireless mic is best for interview', 'BUYER_QUESTION', 0.9, 300, 'DISCOVERED',
          'Looking for a wireless mic for youtube interviews with type-c port', 'https://example.com/q1', datetime('now')
        )
      `).run(ORG);

      const action = nbaEngine.choose(BIZ, ORG, { ignoreCooldown: true });

      // Must NOT be CREATE_CONTENT_ASSET for unfulfilled demand signals
      expect(action.actionType).not.toBe('CREATE_CONTENT_ASSET');
      // Must NOT be DISCOVER_OFFER
      expect(action.actionType).not.toBe('DISCOVER_OFFER');
      // Must be AWAIT_OWNER_INTAKE to surface the publication blocker
      expect(action.actionType).toBe('AWAIT_OWNER_INTAKE');
      expect(action.targetId).toBe('cnt_pending_pub');
      expect(action.rationale).toContain('Awaiting owner intake submission');
    });
  });

  describe('4. Detailed Status for Six Evaluated Opportunities', () => {
    it('evaluates all 6 categories and maps them strictly to honest states', async () => {
      const pipeline = ProductOpportunityPipeline.getInstance();
      const db = getDb();

      // Ensure single offer and single PUBLISH_READY guide matching production
      db.prepare("DELETE FROM commission_content_assets WHERE organization_id = ?").run(ORG);
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, intent_target,
          content_markdown, primary_offer_id, status, view_count, referral_click_count, created_at
        ) VALUES (
          'cnt_d5cdad0f-9', ?, 'office-b08p13wglx-buyer-guide', 'GUIDE',
          'Best Direct Thermal Shipping Label Printers in India', 'office', 'thermal shipping label printer',
          'Guide content', 'poff_6fd7d0d3-7', 'PUBLISH_READY', 0, 0, datetime('now')
        )
      `).run(ORG);

      // Clean demand signals and insert the exact 6 categories from production
      db.prepare("DELETE FROM demand_signals WHERE organization_id = ?").run(ORG);

      // 1. best accounting software small business India (77 buyer questions)
      for (let i = 1; i <= 5; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (?, ?, 'best accounting software small business India', 'GST accounting software', 'best accounting software for small business India', 'BUYER_QUESTION', 0.7, 500, 'DISCOVERED', 'Looking for GST invoice software', 'https://example.com/soft', datetime('now'))
        `).run(`sig_acc_${i}`, ORG);
      }

      // 2. thermal label printer (4 buyer questions, active offer poff_6fd7d0d3-7, PUBLISH_READY guide)
      for (let i = 1; i <= 4; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (?, ?, 'thermal label printer', 'Thermal label printer', 'which thermal printer prints 4x6 shipping labels', 'BUYER_QUESTION', 0.8, 200, 'DISCOVERED', 'Need 4x6 shipping label printer for e-commerce', 'https://example.com/print', datetime('now'))
        `).run(`sig_prn_${i}`, ORG);
      }

      // 3. wireless microphone (3 buyer questions)
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (?, ?, 'wireless microphone', 'Wireless microphone', 'which wireless lav mic connects to usb-c android', 'BUYER_QUESTION', 0.8, 150, 'DISCOVERED', 'Dual lav mic usb-c android for street interviews', 'https://example.com/mic', datetime('now'))
        `).run(`sig_mic_${i}`, ORG);
      }

      // 4. barcode scanner (3 buyer questions)
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (?, ?, 'barcode scanner', 'Barcode scanner', 'which 2d barcode scanner reads qr codes', 'BUYER_QUESTION', 0.8, 120, 'DISCOVERED', '2D wireless qr code scanner 20m range', 'https://example.com/bar', datetime('now'))
        `).run(`sig_bar_${i}`, ORG);
      }

      // 5. mechanical keypad (2 buyer questions)
      for (let i = 1; i <= 2; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (?, ?, 'mechanical keypad', 'Mechanical keypad', 'which mechanical numpad has hot swappable switches', 'BUYER_QUESTION', 0.6, 60, 'DISCOVERED', 'Silent hot swappable numpad mechanical keypad', 'https://example.com/key', datetime('now'))
        `).run(`sig_key_${i}`, ORG);
      }

      // 6. coffee grinder (2 buyer questions)
      for (let i = 1; i <= 2; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, signal_type, urgency,
            estimated_monthly_volume, status, evidence_snippet, source_url, created_at
          ) VALUES (?, ?, 'coffee grinder', 'Coffee grinder', 'which manual coffee hand grinder has conical burrs', 'BUYER_QUESTION', 0.7, 80, 'DISCOVERED', 'Manual hand coffee grinder with conical burrs', 'https://example.com/cof', datetime('now'))
        `).run(`sig_cof_${i}`, ORG);
      }

      const opportunities = await pipeline.getDetailedOpportunityStatus(ORG);
      expect(opportunities.length).toBe(6);

      // Verify thermal label printer -> NEEDS_OWNER_ACTION
      const printerOpp = opportunities.find(o => o.category === 'thermal label printer');
      expect(printerOpp).toBeDefined();
      expect(printerOpp!.funnelState).toBe('NEEDS_OWNER_ACTION');
      expect(printerOpp!.nextStep).toContain('Complete statutory owner intake');

      // Verify wireless microphone -> NEEDS_PRODUCT_EVIDENCE
      const micOpp = opportunities.find(o => o.category === 'wireless microphone');
      expect(micOpp).toBeDefined();
      expect(micOpp!.funnelState).toBe('NEEDS_PRODUCT_EVIDENCE');
      expect(micOpp!.nextStep).toContain('Retrieve verified manufacturer technical specifications');

      // Verify barcode scanner -> NEEDS_PRODUCT_EVIDENCE
      const scanOpp = opportunities.find(o => o.category === 'barcode scanner');
      expect(scanOpp).toBeDefined();
      expect(scanOpp!.funnelState).toBe('NEEDS_PRODUCT_EVIDENCE');
      expect(scanOpp!.nextStep).toContain('Retrieve verified manufacturer technical specifications');

      // Verify accounting software -> NEEDS_PARTNER_APPROVAL
      const accOpp = opportunities.find(o => o.category === 'best accounting software small business India');
      expect(accOpp).toBeDefined();
      expect(accOpp!.funnelState).toBe('NEEDS_PARTNER_APPROVAL');
      expect(accOpp!.nextStep).toContain('Obtain owner authorization for Indian SaaS affiliate partner');

      // Verify mechanical keypad (< 3 signals) -> QUALIFIED
      const keyOpp = opportunities.find(o => o.category === 'mechanical keypad');
      expect(keyOpp).toBeDefined();
      expect(keyOpp!.funnelState).toBe('QUALIFIED');
      expect(keyOpp!.nextStep).toContain('Gather at least 1 additional BUYER_QUESTION signal');

      // Verify coffee grinder (< 3 signals) -> QUALIFIED
      const cofOpp = opportunities.find(o => o.category === 'coffee grinder');
      expect(cofOpp).toBeDefined();
      expect(cofOpp!.funnelState).toBe('QUALIFIED');
      expect(cofOpp!.nextStep).toContain('Gather at least 1 additional BUYER_QUESTION signal');
    });
  });
});
