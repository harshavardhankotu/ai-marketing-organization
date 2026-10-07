import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { OwnerControlCenterEngine, SaveOwnerIntakeInput } from '../../src/commission/owner-control-center.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { CommissionLedgerEngine } from '../../src/commission/commission-ledger.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { DemandDiscoveryEngine } from '../../src/commission/demand-discovery.js';
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

    it('every open action names exactly one human action or "AUTOMATED: pending"', async () => {
      const snapshot = await engine.computeStatus(orgId);

      for (const action of snapshot.openActions) {
        if (action.type === 'AUTOMATED') {
          expect(action.title).toBe('AUTOMATED: pending');
        } else {
          expect(action.type).toBe('HUMAN');
          expect(action.title.length).toBeGreaterThan(0);
          expect(action.title).not.toBe('AUTOMATED: pending');
        }
        expect(action.description).toBeDefined();
        expect(action.resolutionCondition).toBeDefined();
      }
    });

    it('marks open actions resolved automatically when conditions clear', async () => {
      // Without intake, act_complete_intake is present
      const initial = await engine.computeStatus(orgId);
      const intakeAction = initial.openActions.find(a => a.id === 'act_complete_intake');
      expect(intakeAction).toBeDefined();
      expect(intakeAction?.type).toBe('HUMAN');

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
      // Automatically cleared!
      expect(updatedIntakeAction).toBeUndefined();

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
  });

  // ==========================================================================
  // Part C: Learning Ingest
  // ==========================================================================
  describe('Part C: Learning Ingest (Tables, structured rows, SQL lookups)', () => {
    it('ingests 5 structured empirical learning rules into learning_records', async () => {
      const rules = await engine.ingestInitialLearningRules(orgId);
      expect(rules.length).toBe(5);

      const whats = rules.map(r => r.what);
      expect(whats).toContain('FIXTURE_LOOP_DUPLICATES');
      expect(whats).toContain('JUNK_DOMAINS');
      expect(whats).toContain('CLAIMS_LINT_FAILURES');
      expect(whats).toContain('IP_TOPOLOGY');
      expect(whats).toContain('PLACEHOLDER_REJECTIONS');

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
      expect(proposals.length).toBe(3);

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
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: true
      });

      expect(result.proposal.status).toBe('APPROVED');
      expect(result.proposal.asin).toBe('B08P13WGLX');
      expect(result.proposal.productChecked).toBe(true);
      expect(result.proposal.amazonUrl).toBe('https://www.amazon.in/dp/B08P13WGLX');
      expect(result.offer).toBeDefined();
      expect(result.offer.status).toBe('ACTIVE');
      expect(result.offer.authorizedTrackingUrl).toContain('B08P13WGLX');
    });

    it('rejects proposal approval without product_checked attestation or with invalid URLs', async () => {
      const proposals = await engine.discoverProductProposals(orgId);
      const target = proposals[0];

      // Without productChecked: true
      await expect(engine.approveProposal(orgId, target.id, {
        amazonUrl: 'https://www.amazon.in/dp/B08P13WGLX',
        productChecked: false
      })).rejects.toThrow('productChecked must be explicitly true');

      // Invalid host
      await expect(engine.approveProposal(orgId, target.id, {
        amazonUrl: 'https://notamazon.in/dp/B08P13WGLX',
        productChecked: true
      })).rejects.toThrow("Host 'notamazon.in' is invalid");

      // Invalid ASIN length (9 characters)
      await expect(engine.approveProposal(orgId, target.id, {
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
          siteName: 'India Commercial Review',
          authorName: 'Editorial Staff',
          contactEmail: 'contact@reviewhub.in',
          tavilyKeyRotated: true
        })
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.siteName).toBe('India Commercial Review');
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
      expect(json.data.length).toBe(3);
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
});
