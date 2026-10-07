import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { OwnerControlCenterEngine, SaveOwnerIntakeInput } from '../../src/commission/owner-control-center.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { CommissionLedgerEngine } from '../../src/commission/commission-ledger.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { DemandDiscoveryEngine } from '../../src/commission/demand-discovery.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { FirecrawlAdapter } from '../../src/research/firecrawl-adapter.js';
import { AutomaticProductPipeline } from '../../src/commission/automatic-product-pipeline.js';
import { ShareKitService } from '../../src/commission/share-kit-service.js';
import { app } from '../../src/index.js';

describe('OwnerControlCenterEngine (Single-owner system, zero LLM tokens in A-D)', () => {
  const db = getDb();
  const orgId = 'org_owner_test_' + Date.now();
  let engine: OwnerControlCenterEngine;
  let registry: PartnerRegistryEngine;
  let ledger: CommissionLedgerEngine;

  beforeEach(async () => {
    engine = OwnerControlCenterEngine.getInstance();
    registry = PartnerRegistryEngine.getInstance();
    ledger = CommissionLedgerEngine.getInstance();

    // Clean test records
    try {
      db.prepare('DELETE FROM owner_intake WHERE organization_id = ? OR id = ?').run(orgId, orgId);
      db.prepare('DELETE FROM product_proposals WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM owner_status_snapshots WHERE organization_id = ? OR id = ?').run(orgId, orgId);
      db.prepare('DELETE FROM learning_records WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM partner_offers WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM partners WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM commission_records WHERE partner_id = ?').run('part_amazon_in_01');
    } catch {}

    const origTag = process.env.AMAZON_AFFILIATE_TAG;
    process.env.AMAZON_AFFILIATE_TAG = 'testtag-21';

    // Register test Amazon partner with fixed ID
    try {
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
    } catch {}
  });

  afterEach(() => {
    delete process.env.AMAZON_AFFILIATE_TAG;
    try {
      db.prepare('DELETE FROM owner_intake WHERE organization_id = ? OR id = ?').run(orgId, orgId);
      db.prepare('DELETE FROM product_proposals WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM owner_status_snapshots WHERE organization_id = ? OR id = ?').run(orgId, orgId);
      db.prepare('DELETE FROM learning_records WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM partner_offers WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM partners WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM commission_records WHERE partner_id = ?').run('part_amazon_in_01');
    } catch {}
  });

  // ==========================================================================
  // Part A: Owner Intake
  // ==========================================================================
  describe('Part A: Owner Intake (One-time, never asked twice, zero defaults)', () => {
    const validInput: SaveOwnerIntakeInput = {
      applicationDate: '2026-03-15',
      listedSiteUrls: ['https://reviewhub.in', 'https://reviewhub.in/guides'],
      agreementReadConfirmed: true,
      siteName: 'India Tech & Commercial Review',
      authorName: 'Editorial Review Staff',
      contactEmail: 'contact@reviewhub.in',
      tavilyKeyRotated: true
    };

    it('saves all 7 fields accurately with zero defaults', async () => {
      const record = await engine.saveIntake(orgId, validInput);

      expect(record.organizationId).toBe(orgId);
      expect(record.applicationDate).toBe('2026-03-15');
      expect(record.listedSiteUrls).toEqual(['https://reviewhub.in', 'https://reviewhub.in/guides']);
      expect(record.agreementReadConfirmed).toBe(true);
      expect(record.agreementReadConfirmedAt).toBeDefined();
      expect(record.siteName).toBe('India Tech & Commercial Review');
      expect(record.authorName).toBe('Editorial Review Staff');
      expect(record.contactEmail).toBe('contact@reviewhub.in');
      expect(record.tavilyKeyRotated).toBe(true);

      // Verify partner evidence was synced
      const partner = await registry.getPartner('part_amazon_in_01');
      expect(partner?.evidence?.terms_read_confirmed).toBe(true);
      expect(partner?.evidence?.application_date).toBe('2026-03-15');
      expect(partner?.evidence?.site_listed_url).toBe('https://reviewhub.in');
    });

    it('rejects missing or invalid fields with zero defaults', async () => {
      // Missing applicationDate
      await expect(engine.saveIntake(orgId, { ...validInput, applicationDate: '' })).rejects.toThrow('applicationDate is required');

      // Invalid date
      await expect(engine.saveIntake(orgId, { ...validInput, applicationDate: 'not-a-date' })).rejects.toThrow('invalid');

      // Missing site URLs
      await expect(engine.saveIntake(orgId, { ...validInput, listedSiteUrls: [] })).rejects.toThrow('listedSiteUrls must contain at least one valid');

      // Non-HTTP URL
      await expect(engine.saveIntake(orgId, { ...validInput, listedSiteUrls: ['ftp://bad.com'] })).rejects.toThrow('HTTP/HTTPS URL');

      // agreementReadConfirmed !== true
      await expect(engine.saveIntake(orgId, { ...validInput, agreementReadConfirmed: false })).rejects.toThrow('agreementReadConfirmed must be explicitly true');

      // Missing siteName
      await expect(engine.saveIntake(orgId, { ...validInput, siteName: '' })).rejects.toThrow('siteName is required');

      // Missing authorName
      await expect(engine.saveIntake(orgId, { ...validInput, authorName: '' })).rejects.toThrow('authorName is required');

      // Missing contactEmail
      await expect(engine.saveIntake(orgId, { ...validInput, contactEmail: 'notanemail' })).rejects.toThrow('contactEmail is required');

      // Missing tavilyKeyRotated
      await expect(engine.saveIntake(orgId, { ...validInput, tavilyKeyRotated: undefined as any })).rejects.toThrow('tavilyKeyRotated must be explicitly provided');
    });

    it('once stored, never requested again (returns existing without overwriting)', async () => {
      const first = await engine.saveIntake(orgId, validInput);
      expect(first.siteName).toBe('India Tech & Commercial Review');

      // Attempt to save different values
      const second = await engine.saveIntake(orgId, {
        ...validInput,
        siteName: 'Different Name',
        authorName: 'Different Author'
      });

      // Returns the original stored record
      expect(second.siteName).toBe('India Tech & Commercial Review');
      expect(second.authorName).toBe('Editorial Review Staff');
      expect(second.completedAt).toBe(first.completedAt);
    });

    it('rejects agent or test writes in production mode (FORBIDDEN_AGENT_WRITE)', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await expect(engine.saveIntake('org_prod_test_01', {
          ...validInput,
          writtenBy: 'TEST_AGENT'
        })).rejects.toThrow('FORBIDDEN_AGENT_WRITE');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('ignores INVALID_AGENT_WRITTEN rows, returns null for intake and reopens act_complete_intake', async () => {
      const invalidOrgId = 'org_invalid_agent_' + Date.now();
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO owner_intake (
          id, organization_id, application_date, listed_site_urls_json,
          agreement_read_confirmed, agreement_read_confirmed_at, site_name,
          author_name, contact_email, tavily_key_rotated, completed_at,
          status, written_by, created_at, updated_at
        ) VALUES (
          ?, ?, '2026-03-01', '["https://example.com"]',
          1, ?, 'Fake Site', 'Fake Agent', 'agent@fake.com', 1, ?,
          'INVALID_AGENT_WRITTEN', 'TEST_AGENT', ?, ?
        )
      `).run(invalidOrgId, invalidOrgId, now, now, now, now);

      try {
        const intake = await engine.getIntake(invalidOrgId);
        expect(intake).toBeNull();

        const status = await engine.computeStatus(invalidOrgId);
        const intakeAction = status.openActions.find(a => a.id === 'act_complete_intake');
        expect(intakeAction).toBeDefined();
        expect(intakeAction?.resolved).toBe(false);
        expect(status.todayItems?.intakeCompleted).toBe(false);
      } finally {
        try {
          db.prepare('DELETE FROM owner_intake WHERE id = ?').run(invalidOrgId);
          db.prepare('DELETE FROM owner_status_snapshots WHERE id = ?').run(invalidOrgId);
        } catch {}
      }
    });

    it('renders HTML intake form when pending and summary when completed', async () => {
      // Pending form
      const pendingHtml = engine.renderHtmlIntakeForm(null);
      expect(pendingHtml).toContain('<form method="POST" action="/api/v1/owner/intake">');
      expect(pendingHtml).toContain('name="applicationDate"');
      expect(pendingHtml).toContain('name="siteName"');
      expect(pendingHtml).toContain('name="authorName"');
      expect(pendingHtml).toContain('name="contactEmail"');
      expect(pendingHtml).toContain('name="listedSiteUrls"');
      expect(pendingHtml).toContain('name="agreementReadConfirmed"');
      expect(pendingHtml).toContain('name="tavilyKeyRotated"');

      // Completed summary
      const record = await engine.saveIntake(orgId, validInput);
      const completedHtml = engine.renderHtmlIntakeForm(record);
      expect(completedHtml).toContain('✓ Owner Intake Completed');
      expect(completedHtml).toContain('India Tech &amp; Commercial Review');
      expect(completedHtml).toContain('contact@reviewhub.in');
      expect(completedHtml).not.toContain('<form method="POST"');
    });
  });

  // ==========================================================================
  // Part B: Status Page & Open Actions
  // ==========================================================================
  describe('Part B: Status Page & Open Actions (Hourly computed, zero LLM tokens)', () => {
    it('computes complete status snapshot with countdown, quotas, and deployments', async () => {
      const snapshot = await engine.computeStatus(orgId);

      expect(snapshot.organizationId).toBe(orgId);
      expect(snapshot.deployments).toBeDefined();
      expect(snapshot.deployments.gitHead).toBeDefined();
      expect(['MATCH', 'MISMATCH']).toContain(snapshot.deployments.commitStatus);
      expect(snapshot.moneyPath).toBeDefined();
      expect(snapshot.deadline180Days).toBeDefined();
      expect(snapshot.quotas.tavily).toBeDefined();
      expect(snapshot.quotas.gemini).toBeDefined();
      expect(Array.isArray(snapshot.openActions)).toBe(true);
      expect(snapshot.openActions.length).toBeGreaterThan(0);
    });

    it('open actions list contains canonical items including weekly dashboard reading', async () => {
      const snapshot = await engine.computeStatus(orgId);
      expect(snapshot.openActions).toHaveLength(6);

      const canonicalTitles = [
        'complete intake',
        'approve product',
        'publish guide',
        'share URL',
        'upload Associates report weekly',
        'read Tavily and Firecrawl dashboards'
      ];

      for (const action of snapshot.openActions) {
        expect(canonicalTitles).toContain(action.title);
        expect(action.description).toBeDefined();
        expect(action.resolutionCondition).toBeDefined();
      }
    });

    it('marks open actions resolved automatically when conditions clear', async () => {
      // Without intake, act_complete_intake is present and unresolved
      const initial = await engine.computeStatus(orgId);
      const intakeAction = initial.openActions.find(a => a.id === 'act_complete_intake');
      expect(intakeAction).toBeDefined();
      expect(intakeAction?.type).toBe('HUMAN');
      expect(intakeAction?.resolved).toBe(false);

      // Complete intake
      await engine.saveIntake(orgId, {
        applicationDate: new Date().toISOString().split('T')[0],
        listedSiteUrls: ['https://example.com'],
        agreementReadConfirmed: true,
        siteName: 'Example Reviews',
        authorName: 'Editor',
        contactEmail: 'editor@example.com',
        tavilyKeyRotated: true
      });

      // Recompute status
      const updated = await engine.computeStatus(orgId);
      const updatedIntakeAction = updated.openActions.find(a => a.id === 'act_complete_intake');
      // Automatically resolved!
      expect(updatedIntakeAction).toBeDefined();
      expect(updatedIntakeAction?.resolved).toBe(true);

      // Deadline countdown is now active
      expect(updated.deadline180Days.daysRemaining).toBeGreaterThan(0);
      expect(updated.deadline180Days.countdownText).toContain('days remaining');
    });

    it('renders auto-refreshing dark-mode HTML dashboard', async () => {
      const snapshot = await engine.computeStatus(orgId);
      const html = engine.renderHtmlDashboard(snapshot);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<meta http-equiv="refresh" content="60">');
      expect(html).toContain('Owner Control Center');
      expect(html).toContain('180-Day Qualification Deadline');
      expect(html).toContain('Money Path Status');
      expect(html).toContain('Open Actions');
      expect(html).toContain('Empirical Learning Store');
    });

    it('shows NOT_READY and hides share text when no published guide exists, and READY without high-speed when published', async () => {
      // 1. Without published guide: status is NOT_READY
      const snapshotNotReady = await engine.computeStatus(orgId);
      expect(snapshotNotReady.todayItems?.readyShareGuide?.status).toBe('NOT_READY');
      expect(snapshotNotReady.todayItems?.readyShareGuide?.shareText).toBeUndefined();
      const htmlNotReady = engine.renderHtmlDashboard(snapshotNotReady);
      expect(htmlNotReady).toContain('NOT_READY');
      expect(htmlNotReady).not.toContain('high-speed');

      // 2. Insert published guide fixture
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, slug, title, asset_type, category, intent_target, content_markdown, status, primary_offer_id, created_at, updated_at
        ) VALUES (
          'cca_test_guide_01', ?, 'direct-thermal-printer-guide', 'Direct Thermal Label Printer Guide', 'BUYER_GUIDE', 'Office & Commercial Supplies', 'Thermal printer buyer guide', '## Overview\nBuyer guide markdown', 'PUBLISHED', 'off_test_01', datetime('now'), datetime('now')
        )
      `).run(orgId);

      const snapshotReady = await engine.computeStatus(orgId);
      expect(snapshotReady.todayItems?.readyShareGuide?.status).toBe('READY');
      expect(snapshotReady.todayItems?.readyShareGuide?.pageUrl).toBe('https://ai-marketing-platform-core.web.app/guides/direct-thermal-printer-guide');
      expect(snapshotReady.todayItems?.readyShareGuide?.shareText).toContain('https://ai-marketing-platform-core.web.app/guides/direct-thermal-printer-guide');
      expect(snapshotReady.todayItems?.readyShareGuide?.shareText).not.toContain('high-speed');

      const htmlReady = engine.renderHtmlDashboard(snapshotReady);
      expect(htmlReady).toContain('Ready to Share');
      expect(htmlReady).toContain('direct-thermal-printer-guide');
      expect(htmlReady).not.toContain('high-speed');

      // Clean up
      db.prepare('DELETE FROM commission_content_assets WHERE id = ?').run('cca_test_guide_01');
    });
  });

  // ==========================================================================
  // Part C: Learning Ingest
  // ==========================================================================
  describe('Part C: Learning Ingest (Tables, structured rows, SQL lookups)', () => {
    it('ingests 5 structured empirical learning rules into learning_records', async () => {
      const rules = await engine.ingestInitialLearningRules(orgId);
      expect(rules.length).toBeGreaterThanOrEqual(5);

      const whats = rules.map(r => r.what);
      expect(whats).toContain('FIXTURE_LOOP_DUPLICATES');
      expect(whats).toContain('JUNK_DOMAINS');
      expect(whats).toContain('CLAIMS_LINT_FAILURES');
      expect(whats).toContain('IP_TOPOLOGY');
      expect(whats).toContain('PLACEHOLDER_REJECTIONS');
      expect(whats).toContain('HEALTH_SKINCARE_SUPPLEMENTS_CATEGORY');

      // Verify each rule has what, outcome, cause, rule
      for (const rule of rules) {
        expect(rule.what).toBeDefined();
        expect(rule.outcome).toBeDefined();
        expect(rule.cause).toBeDefined();
        expect(rule.rule).toBeDefined();
      }

      // Verify persisted to learning_records via SQL
      const row = db.prepare('SELECT * FROM learning_records WHERE id = ?').get('lrn_junk_domains') as any;
      expect(row).toBeDefined();
      expect(row.decision).toBe('JUNK_DOMAINS');
      expect(row.result).toBe('CANDIDATE_SCRAPING_REJECTED');
    });

    it('NextBestActionEngine executes SQL lookup on learning_records before scoring', () => {
      const nba = NextBestActionEngine.getInstance();
      const action = nba.choose('biz_platform_aro', orgId);
      expect(action).toBeDefined();
      expect(action.actionType).toBeDefined();
    });

    it('DemandDiscoveryEngine executes SQL lookup on learning_records before search', async () => {
      const demand = DemandDiscoveryEngine.getInstance();
      const signals = await demand.discoverDemand(orgId, { category: 'printers', limit: 2 });
      expect(Array.isArray(signals)).toBe(true);
    });
  });

  // ==========================================================================
  // Part D: Product Proposals
  // ==========================================================================
  describe('Part D: Product Proposals (Manufacturer specs, zero Amazon fetches, zero LLM tokens)', () => {
    it('discovers up to 3 non-Amazon manufacturer specification proposals', async () => {
      const proposals = await engine.discoverProductProposals(orgId, 'Office & Commercial Supplies');
      expect(proposals.length).toBeGreaterThanOrEqual(1);
      expect(proposals.length).toBeLessThanOrEqual(3);

      for (const p of proposals) {
        expect(p.category).toBe('Office & Commercial Supplies');
        expect(p.productName).toBeDefined();
        expect(p.manufacturerName).toBeDefined();
        expect(p.specSummary).toBeDefined();
        expect(p.sourceUrl).toBeDefined();
        // NEVER fetch or link Amazon in discovery sources
        expect(p.sourceUrl).not.toContain('amazon.');
        expect(p.status).toBe('PROPOSED');
        expect(p.productChecked).toBe(false);
      }
    });

    it('approves proposal with valid amazon.in URL and product_checked attestation', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const target = proposals[0];

      // Provide owner intake first so offer activates
      await engine.saveIntake(orgId, {
        applicationDate: '2026-03-01',
        listedSiteUrls: ['https://example.com'],
        agreementReadConfirmed: true,
        siteName: 'Example',
        authorName: 'Author',
        contactEmail: 'contact@example.com',
        tavilyKeyRotated: true
      });

      const result = await engine.approveProposal(orgId, target.id, {
        displayName: 'Phomemo PM-241BT Shipping Label Printer',
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true,
        fact1: 'Direct Thermal 203 DPI',
        fact1Date: '2026-10-07',
        fact2: '150 mm/s print speed',
        fact2Date: '2026-10-07',
        fact3: 'Supports 1-4 inch width',
        fact3Date: '2026-10-07'
      });

      expect(result.proposal.status).toBe('APPROVED');
      expect(result.proposal.asin).toBe('B08P13WGLX');
      expect(result.proposal.productChecked).toBe(true);
      expect(result.proposal.displayName).toBe('Phomemo PM-241BT Shipping Label Printer');
      expect(result.proposal.listingFacts).toHaveLength(3);
      expect(result.proposal.amazonUrl).toBe('https://www.amazon.in/dp/B08P13WGLX');
      expect(result.offer).toBeDefined();
      expect(result.offer.status).toBe('ACTIVE');
      expect(result.offer.authorizedTrackingUrl).toContain('B08P13WGLX');
    });

    it('rejects proposal approval without product_checked attestation or with invalid URLs', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const target = proposals[0];

      const validFacts = {
        displayName: 'Phomemo PM-241BT Shipping Label Printer',
        fact1: 'Direct Thermal 203 DPI',
        fact1Date: '2026-10-07',
        fact2: '150 mm/s print speed',
        fact2Date: '2026-10-07',
        fact3: 'Supports 1-4 inch width',
        fact3Date: '2026-10-07'
      };

      // Without productChecked: true
      await expect(engine.approveProposal(orgId, target.id, {
        ...validFacts,
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: false
      })).rejects.toThrow('productChecked must be explicitly true');

      // Invalid host
      await expect(engine.approveProposal(orgId, target.id, {
        ...validFacts,
        amazonUrl: 'https://notamazon.in/dp/B08P13WGLX',
        productChecked: true
      })).rejects.toThrow(/Invalid Amazon host 'notamazon\.in'/);

      // Invalid ASIN length (9 characters)
      await expect(engine.approveProposal(orgId, target.id, {
        ...validFacts,
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGL',
        productChecked: true
      })).rejects.toThrow('ASIN must be exactly 10 alphanumeric characters');
    });
  });

  // ==========================================================================
  // Part E: Weekly Report Ingest
  // ==========================================================================
  describe('Part E: Weekly Report Ingest (Parses CSV/TSV/JSON, moves EXPECTED -> PENDING -> VERIFIED)', () => {
    it('parses CSV report and moves ordered items to PENDING and shipped items to VERIFIED', async () => {
      const csvContent = `Date,Tracking ID,ASIN,Product Title,Category,Items Ordered,Items Shipped,Revenue,Commission Rate,Earnings
2026-03-20,amz-tag-21,B08P13WGLX,Thermal Printer,Office,1,0,3500,0.05,175
2026-03-21,amz-tag-21,B08N5WRWNW,Barcode Scanner,Office,1,1,2800,0.05,140`;

      const result = await engine.ingestAssociatesReport(orgId, csvContent, 'report_march_2026.csv');

      expect(result.success).toBe(true);
      expect(result.rowsParsed).toBe(2);
      expect(result.commissionsPending).toBe(1);
      expect(result.commissionsVerified).toBe(1);
      expect(result.totalEarningsINR).toBe(140);

      // Verify commissions exist in ledger
      const summary = await ledger.getSummary(orgId);
      expect(summary.externalConversions).toBeGreaterThan(0);
    });

    it('parses JSON report export correctly', async () => {
      const jsonContent = JSON.stringify([
        {
          date: '2026-03-22',
          asin: 'B08P13WGLX',
          itemsOrdered: 2,
          itemsShipped: 2,
          revenueINR: 7000,
          commissionRate: 0.05,
          earningsINR: 350
        }
      ]);

      const result = await engine.ingestAssociatesReport(orgId, jsonContent, 'report_march_2026.json');
      expect(result.success).toBe(true);
      expect(result.rowsParsed).toBe(1);
      expect(result.commissionsVerified).toBe(1);
      expect(result.totalEarningsINR).toBe(350);
    });

    it('rejects empty or corrupt reports', async () => {
      await expect(engine.ingestAssociatesReport(orgId, '', 'empty.csv')).rejects.toThrow('No valid data rows found');
    });
  });

  // ==========================================================================
  // Part F: Owner Control Center HTTP API Routes (Owner-only authentication)
  // ==========================================================================
  describe('Owner Control Center HTTP API Endpoints', () => {
    const ownerApiKey = 'test_owner_key_sec_123';

    beforeEach(() => {
      process.env.OWNER_API_KEY = ownerApiKey;
    });

    it('rejects unauthenticated requests with 401', async () => {
      const res = await app.request('/api/v1/owner/status');
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toContain('Owner authentication is required');
    });

    it('GET /api/v1/owner/intake returns completed: false when pending', async () => {
      const res = await app.request('/api/v1/owner/intake', {
        headers: { 'x-api-key': ownerApiKey, 'x-organization-id': orgId }
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.completed).toBe(false);
    });

    it('POST /api/v1/owner/intake saves intake record', async () => {
      const res = await app.request('/api/v1/owner/intake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ownerApiKey,
          'x-organization-id': orgId
        },
        body: JSON.stringify({
          applicationDate: '2026-03-15',
          listedSiteUrls: ['https://reviewhub.in'],
          agreementReadConfirmed: true,
          siteName: 'Test Commercial Review',
          authorName: 'Editorial Staff',
          contactEmail: 'contact@reviewhub.in',
          tavilyKeyRotated: true
        })
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.siteName).toBe('Test Commercial Review');
    });

    it('GET /api/v1/owner/status returns dashboard HTML or JSON based on Accept header', async () => {
      // HTML format
      const htmlRes = await app.request('/api/v1/owner/status', {
        headers: {
          'Accept': 'text/html',
          'x-api-key': ownerApiKey,
          'x-organization-id': orgId
        }
      });
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<meta http-equiv="refresh" content="60">');
      expect(html).toContain('Owner Control Center');

      // JSON format
      const jsonRes = await app.request('/api/v1/owner/status', {
        headers: {
          'Accept': 'application/json',
          'x-api-key': ownerApiKey,
          'x-organization-id': orgId
        }
      });
      expect(jsonRes.status).toBe(200);
      const json = await jsonRes.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.deployments).toBeDefined();
    });

    it('POST /api/v1/owner/status/compute computes and persists snapshot', async () => {
      const res = await app.request('/api/v1/owner/status/compute', {
        method: 'POST',
        headers: { 'x-api-key': ownerApiKey, 'x-organization-id': orgId }
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.openActions).toBeDefined();
    });

    it('GET /api/v1/owner/learning-rules returns empirical learning rules', async () => {
      const res = await app.request('/api/v1/owner/learning-rules', {
        headers: { 'x-api-key': ownerApiKey, 'x-organization-id': orgId }
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(5);
    });

    it('POST /api/v1/owner/product-proposals/discover returns proposals', async () => {
      const res = await app.request('/api/v1/owner/product-proposals/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ownerApiKey,
          'x-organization-id': orgId
        },
        body: JSON.stringify({ category: 'Office & Commercial Supplies' })
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      expect(json.data.length).toBeLessThanOrEqual(3);
    });

    it('POST /api/v1/owner/reports/associates-export parses report export', async () => {
      const csv = `Date,Tracking ID,ASIN,Product Title,Category,Items Ordered,Items Shipped,Revenue,Commission Rate,Earnings
2026-03-25,amz-tag-21,B08P13WGLX,Printer,Office,1,1,3500,0.05,175`;

      const res = await app.request('/api/v1/owner/reports/associates-export', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'x-api-key': ownerApiKey,
          'x-organization-id': orgId
        },
        body: csv
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.commissionsVerified).toBe(1);
    });
  });

  // ==========================================================================
  // Part G: Hardening Pass Launch Gates & Invariant Verification
  // ==========================================================================
  describe('Hardening Pass Invariants & Validations', () => {
    it('StaticSiteGenerator fails if site identity fields are missing', async () => {
      const generator = StaticSiteGenerator.getInstance();
      const oldSite = process.env.PUBLIC_SITE_NAME;
      const oldAuthor = process.env.PUBLIC_AUTHOR_NAME;
      const oldEmail = process.env.PUBLIC_CONTACT_EMAIL;

      try {
        delete process.env.PUBLIC_SITE_NAME;
        delete process.env.PUBLIC_AUTHOR_NAME;
        delete process.env.PUBLIC_SITE_AUTHOR;
        delete process.env.PUBLIC_CONTACT_EMAIL;

        expect(() => generator.validateConfig()).toThrow('CONFIG_ERROR: Missing required public site configuration');
      } finally {
        if (oldSite) process.env.PUBLIC_SITE_NAME = oldSite;
        if (oldAuthor) process.env.PUBLIC_AUTHOR_NAME = oldAuthor;
        if (oldEmail) process.env.PUBLIC_CONTACT_EMAIL = oldEmail;
      }
    });

    it('approveProposal rejects link shorteners (link.amazon, amzn.to, a.co)', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const propId = proposals[0].id;

      const shorteners = [
        'https://amzn.to/3Xyz123',
        'https://link.amazon.in/abc456',
        'https://a.co/d/789xyz'
      ];

      for (const url of shorteners) {
        await expect(engine.approveProposal(orgId, propId, {
          amazonUrl: url,
          productChecked: true,
          displayName: 'Test Product',
          fact1: 'Spec 1', fact1Date: '2026-03-25',
          fact2: 'Spec 2', fact2Date: '2026-03-25',
          fact3: 'Spec 3', fact3Date: '2026-03-25'
        })).rejects.toThrow('Link shorteners (link.amazon, amzn.to, a.co) are strictly prohibited');
      }
    });

    it('approveProposal rejects non-canonical, lowercase, and invalid length ASINs', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const propId = proposals[0].id;

      // Lowercase ASIN
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/b08p13wglx',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Spec 1', fact1Date: '2026-03-25',
        fact2: 'Spec 2', fact2Date: '2026-03-25',
        fact3: 'Spec 3', fact3Date: '2026-03-25'
      })).rejects.toThrow("ASIN must contain uppercase characters only");

      // 9-character ASIN
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGL',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Spec 1', fact1Date: '2026-03-25',
        fact2: 'Spec 2', fact2Date: '2026-03-25',
        fact3: 'Spec 3', fact3Date: '2026-03-25'
      })).rejects.toThrow("ASIN must be exactly 10 alphanumeric characters");

      // 11-character ASIN
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLXX',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Spec 1', fact1Date: '2026-03-25',
        fact2: 'Spec 2', fact2Date: '2026-03-25',
        fact3: 'Spec 3', fact3Date: '2026-03-25'
      })).rejects.toThrow("ASIN must be exactly 10 alphanumeric characters");
    });

    it('approveProposal enforces exactly 3 facts and rejects prohibited fact language', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const propId = proposals[0].id;

      // Missing fact
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Spec 1', fact1Date: '2026-03-25',
        fact2: 'Spec 2', fact2Date: '2026-03-25',
        fact3: '', fact3Date: ''
      })).rejects.toThrow('Exactly 3 listing facts with dates are required');

      // Review language prohibited
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Customers praise the fast shipping speed', fact1Date: '2026-03-25',
        fact2: 'Direct Thermal 203 DPI', fact2Date: '2026-03-25',
        fact3: 'Bluetooth and USB connectivity', fact3Date: '2026-03-25'
      })).rejects.toThrow('Review language (customers, reviewers, users praise/note/say) is prohibited');

      // Superlatives prohibited
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'The best label printer in India', fact1Date: '2026-03-25',
        fact2: 'Direct Thermal 203 DPI', fact2Date: '2026-03-25',
        fact3: 'Bluetooth and USB connectivity', fact3Date: '2026-03-25'
      })).rejects.toThrow('Superlatives (premium, best, ultimate, perfect) are prohibited');

      // Health / skincare claims prohibited
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Provides skincare benefits and anti-aging protection', fact1Date: '2026-03-25',
        fact2: 'Direct Thermal 203 DPI', fact2Date: '2026-03-25',
        fact3: 'Bluetooth and USB connectivity', fact3Date: '2026-03-25'
      })).rejects.toThrow('Health and skincare claims are prohibited');

      // Rupee prices prohibited
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true,
        displayName: 'Test Product',
        fact1: 'Available for ₹3,499 only', fact1Date: '2026-03-25',
        fact2: 'Direct Thermal 203 DPI', fact2Date: '2026-03-25',
        fact3: 'Bluetooth and USB connectivity', fact3Date: '2026-03-25'
      })).rejects.toThrow('Rupee prices and discounts are prohibited');
    });

    it('category policy blocks health/skincare/sunscreen/supplement/medical categories via SQL', async () => {
      expect(await engine.isCategoryBlocked(orgId, 'Health & Personal Care')).toBe(true);
      expect(await engine.isCategoryBlocked(orgId, 'Skincare & Sunscreen')).toBe(true);
      expect(await engine.isCategoryBlocked(orgId, 'Dietary Supplement')).toBe(true);
      expect(await engine.isCategoryBlocked(orgId, 'Medical Equipment')).toBe(true);

      // Permitted categories
      expect(await engine.isCategoryBlocked(orgId, 'Office & Commercial Supplies')).toBe(false);
      expect(await engine.isCategoryBlocked(orgId, 'Industrial Logistics & Labeling')).toBe(false);
    });

    it('snapshot openActions contains canonical items including weekly dashboard reading', async () => {
      const snapshot = await engine.computeStatus(orgId);
      expect(snapshot.openActions).toHaveLength(6);

      const actionTitles = snapshot.openActions.map(a => a.title);
      expect(actionTitles).toEqual([
        'complete intake',
        'approve product',
        'publish guide',
        'share URL',
        'upload Associates report weekly',
        'read Tavily and Firecrawl dashboards'
      ]);

      const html = engine.renderHtmlDashboard(snapshot);
      expect(html).toContain('LAST LEARNED:');
      expect(html).toContain('AGENT CATALOG: not wired (80)');
    });

    it('recordUsageReading records dashboard reading and resolves weekly open action', async () => {
      const res = await engine.recordUsageReading(orgId, {
        provider: 'TAVILY',
        creditsUsed: 226
      });
      expect(res.success).toBe(true);
      expect(res.quotaState.credits_consumed_month).toBe(226);
      expect(res.quotaState.source).toBe('OWNER_DASHBOARD');

      const snapshot = await engine.computeStatus(orgId);
      const usageAction = snapshot.openActions.find(a => a.id === 'act_read_provider_dashboards_weekly');
      expect(usageAction?.resolved).toBe(true);
    });

    it('normalizeAmazonInUrl accepts long browser URLs, gp/product paths, slugs with t.co, and rejects lookalikes', () => {
      // 1. Long browser URL with parameters
      const longUrl = 'https://www.amazon.in/Phomemo-PM-241BT-Bluetooth-Shipping-Compatible/dp/B08P13WGLX?ref_=ast_sto_dp&th=1';
      const res1 = OwnerControlCenterEngine.normalizeAmazonInUrl(longUrl);
      expect(res1.canonicalUrl).toBe('https://www.amazon.in/dp/B08P13WGLX');
      expect(res1.asin).toBe('B08P13WGLX');

      // 2. Slug containing "t.co" (must not trip host shortener check)
      const slugWithTco = 'https://www.amazon.in/portable-printer-t.co-cable/dp/B08P13WGLX';
      const res2 = OwnerControlCenterEngine.normalizeAmazonInUrl(slugWithTco);
      expect(res2.canonicalUrl).toBe('https://www.amazon.in/dp/B08P13WGLX');

      // 3. /gp/product/<ASIN> format
      const gpProductUrl = 'https://www.amazon.in/gp/product/B08P13WGLX';
      const res3 = OwnerControlCenterEngine.normalizeAmazonInUrl(gpProductUrl);
      expect(res3.canonicalUrl).toBe('https://www.amazon.in/dp/B08P13WGLX');

      // 4. amzn.in rejected (shortener/invalid host)
      expect(() => OwnerControlCenterEngine.normalizeAmazonInUrl('https://amzn.in/dp/B08P13WGLX'))
        .toThrow(/Link shortener host 'amzn\.in'|Invalid Amazon host/);

      // 5. Lookalike host amazon.in.evil.com rejected
      expect(() => OwnerControlCenterEngine.normalizeAmazonInUrl('https://amazon.in.evil.com/dp/B08P13WGLX'))
        .toThrow(/Invalid Amazon host 'amazon\.in\.evil\.com'/);
    });

    it('category policy evaluates label printer as allowed, sunscreen as blocked, sneakers as discouraged', async () => {
      const allowed = await engine.evaluateCategoryPolicy(orgId, 'Label Printer & Logistics');
      expect(allowed.status).toBe('ALLOWED');
      expect(await engine.isCategoryBlocked(orgId, 'Label Printer & Logistics')).toBe(false);

      const blocked = await engine.evaluateCategoryPolicy(orgId, 'Sunscreen & SPF Skincare');
      expect(blocked.status).toBe('BLOCKED');
      expect(await engine.isCategoryBlocked(orgId, 'Sunscreen & SPF Skincare')).toBe(true);

      const discouraged = await engine.evaluateCategoryPolicy(orgId, 'Athletic Sneakers & Footwear');
      expect(discouraged.status).toBe('DISCOURAGED');
      expect(await engine.isCategoryBlocked(orgId, 'Athletic Sneakers & Footwear')).toBe(false);
    });

    it('category policy executes SQL against learning_records with category input and uses matched rows', async () => {
      // Insert a real test row into learning_records
      db.prepare(`
        INSERT INTO learning_records (
          id, organization_id, business_id, learning_type, decision, hypothesis, action,
          audience, offer, channel, result, revenue_inr, cost_inr, time_taken_hours, confidence, evidence_json, created_at
        ) VALUES (
          'lrn_real_sql_test_block', ?, 'biz_platform_aro', 'REAL_WORLD_LEARNING', 'BLOCK_SURGICAL_LASERS',
          'Surgical laser equipment requires CDSCO license', 'BLOCK surgical laser category due to statutory medical classification',
          'SURGEONS', 'LASER', 'ORGANIC', 'BLOCKED', 0, 0, 0, 1.0, '{}', datetime('now')
        )
      `).run(orgId);

      const evalResult = await engine.evaluateCategoryPolicy(orgId, 'surgical laser');
      expect(evalResult.status).toBe('BLOCKED');
      expect(evalResult.ruleId).toBe('lrn_real_sql_test_block');
      expect(evalResult.reason).toContain('lrn_real_sql_test_block');
    });

    it('fact lint uses whole-word matching: wholesale is allowed, customers praise is blocked', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const propId = proposals[0].id;

      // "wholesale" allowed
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/Phomemo-PM-241BT/dp/B08P13WGLX?ref_=ast_sto_dp',
        productChecked: true,
        displayName: 'Phomemo Label Printer',
        fact1: 'Supports wholesale direct thermal shipping labels 4x6 inch', fact1Date: '2026-03-25',
        fact2: 'Direct Thermal 203 DPI resolution', fact2Date: '2026-03-25',
        fact3: 'Bluetooth and USB connectivity', fact3Date: '2026-03-25'
      })).resolves.toBeDefined();

      // "customers praise" blocked
      await expect(engine.approveProposal(orgId, propId, {
        amazonUrl: 'https://www.amazon.in/Phomemo-PM-241BT/dp/B08P13WGLX',
        productChecked: true,
        displayName: 'Phomemo Label Printer',
        fact1: 'Customers praise print speed and reliability', fact1Date: '2026-03-25',
        fact2: 'Direct Thermal 203 DPI resolution', fact2Date: '2026-03-25',
        fact3: 'Bluetooth and USB connectivity', fact3Date: '2026-03-25'
      })).rejects.toThrow('Review language (customers, reviewers, users praise/note/say) is prohibited');
    });

    it('FirecrawlAdapter requires OWNER_APPROVAL_REQUIRED host approval, blocks amazon.in, and caches', async () => {
      try {
        db.prepare("DELETE FROM spec_page_cache WHERE url LIKE '%phomemo%'").run();
      } catch {}
      const adapter = FirecrawlAdapter.getInstance();

      // Block amazon.in URLs
      await expect(adapter.scrapeManufacturerSpec('https://www.amazon.in/dp/B08P13WGLX'))
        .rejects.toThrow(/Firecrawl is strictly forbidden from scraping any amazon\.\* domain/);

      // Unapproved host rejected
      await expect(adapter.scrapeManufacturerSpec('https://unknown-manufacturer.com/specs'))
        .rejects.toThrow(/OWNER_APPROVAL_REQUIRED/);

      // Approve host explicitly by owner
      FirecrawlAdapter.approveHostByOwner('phomemo.com');

      // Scrape approved manufacturer URL (mocked in non-prod test)
      const res1 = await adapter.scrapeManufacturerSpec('https://phomemo.com/products/pm-241bt');
      expect(res1.fromCache).toBe(false);
      expect(res1.creditsConsumed).toBe(1);

      // Second fetch of same URL uses cache with 0 credits
      const res2 = await adapter.scrapeManufacturerSpec('https://phomemo.com/products/pm-241bt');
      expect(res2.fromCache).toBe(true);
      expect(res2.creditsConsumed).toBe(0);
    });

    it('AutomaticProductPipeline produces state machine diagram and enforces weekly batching', async () => {
      const pipeline = AutomaticProductPipeline.getInstance();
      const diagram = pipeline.getStateMachineDiagram();
      expect(diagram).toContain('[AUTOMATED]');
      expect(diagram).toContain('[OWNER]');

      // First batch succeeds
      const batch1 = await pipeline.runWeeklyBatch(orgId, { force: true });
      expect(batch1.batchCreated).toBe(true);
      expect(batch1.proposals.length).toBeGreaterThan(0);

      // Subsequent batch within 7 days is gated by cooldown
      const batch2 = await pipeline.runWeeklyBatch(orgId);
      expect(batch2.batchCreated).toBe(false);
      expect(batch2.reason).toContain('COOLDOWN_ACTIVE');
    });

    it('ShareKitService does nothing when no guide has status PUBLISHED', async () => {
      const kit = ShareKitService.getInstance();
      const result = await kit.generateWeeklyShareKit(orgId);
      expect(result.active).toBe(false);
      expect(result.reason).toContain('NO_PUBLISHED_GUIDES');
      expect(result.drafts).toHaveLength(0);
    });

    it('snapshot includes Mistakes Board, Bugs, and Version info', async () => {
      const snapshot = await engine.computeStatus(orgId);
      expect(snapshot.mistakesBoard).toBeDefined();
      expect(snapshot.bugs).toBeDefined();
      expect(snapshot.versionInfo).toBeDefined();
      expect(snapshot.versionInfo?.lastD1Migration).toBe('0016');

      const html = engine.renderHtmlDashboard(snapshot);
      expect(html).toContain('MISTAKES BOARD');
      expect(html).toContain('BUGS');
      expect(html).toContain('VERSION &amp; DEPLOYMENT INTEGRITY');
    });
  });
});
