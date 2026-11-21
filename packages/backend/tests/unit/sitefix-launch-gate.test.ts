import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { getDirectUpiConfig } from '../../src/config/env.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { DirectCommercialOfferPage, readVerifiedDirectOfferSnapshot } from '../../src/revenue/direct-offer-page.js';
import { OfferCatalogService } from '../../src/revenue/offer-catalog.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { getRecheckCheckId, compareAuditForRecheck } from '../../src/tools/site-audit/site-audit-scanner.js';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { renderSiteAuditPage } from '../../src/tools/site-audit/site-audit-page.js';
import { DPDPComplianceManager } from '../../src/compliance/dpdp-manager.js';
import { parseVerifiedCampaignPayout } from '../../src/commission/autonomous-deal-discovery-engine.js';
import {
  AUTHORIZATION_REQUIRED_MESSAGE,
  formatAuditTable,
  formatMarkdownSummary,
  runSitefixCheck,
  type CliAuditResult
} from '../../../cli/src/cli.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

describe('SiteFix Launch Gate — Part 1 Security/Payment/Ledger + Part 2 Pull Interfaces', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'DIRECT_UPI_VPA',
      'PLATFORM_UPI_VPA',
      'DIRECT_UPI_PAYEE_NAME',
      'DIRECT_OFFER_TERMS_SHA256',
      'OWN_OFFER_CONFIRMED',
      'OWNER_UPI_VPA',
      'RAZORPAY_WEBHOOK_SECRET'
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    const db = getDb();
    try {
      db.prepare(`DELETE FROM durable_rate_limits`).run();
    } catch {}
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // =========================================================================
  // PART 1.1 — SCRUBBED EXPOSED PAYMENT IDENTIFIER
  // =========================================================================
  describe('1. Scrubbed UPI VPA (render.yaml, env.ts, owner-auth.ts)', () => {
    it('render.yaml does not commit any personal UPI VPA and uses sync: false', () => {
      const renderYaml = fs.readFileSync(path.join(REPO_ROOT, 'render.yaml'), 'utf8');
      expect(renderYaml).not.toMatch(/@rxairtel|@okhdfcbank|@ybl/i);
      expect(renderYaml).toMatch(/key:\s*DIRECT_UPI_VPA[\r\n]+\s+sync:\s*false/);
    });

    it('getDirectUpiConfig and OwnerAuthService.PLATFORM_UPI_VPA return null/unconfigured when env is unset', () => {
      const cfgUnset = getDirectUpiConfig({});
      expect(cfgUnset.configured).toBe(false);
      expect(cfgUnset.vpa).toBeNull();
      expect(OwnerAuthService.PLATFORM_UPI_VPA).toBeNull();

      process.env.DIRECT_UPI_VPA = 'merchant-runtime@upi';
      const cfgSet = getDirectUpiConfig(process.env);
      expect(cfgSet.configured).toBe(true);
      expect(cfgSet.vpa).toBe('merchant-runtime@upi');
      expect(OwnerAuthService.PLATFORM_UPI_VPA).toBe('merchant-runtime@upi');
    });
  });

  // =========================================================================
  // PART 1.2 — DISTINCT RECHECK CHECK IDS & COMPARISON
  // =========================================================================
  describe('2. Distinct Recheck Check IDs (never collapsing schema_* checks)', () => {
    it('gives every individual schema_* finding its own stable check_<id>', () => {
      const ids = [
        'schema_jsonld_missing',
        'schema_jsonld_syntax_error_1',
        'schema_missing_business_name',
        'schema_missing_telephone',
        'schema_types_detected'
      ];
      const checkIds = ids.map(id => getRecheckCheckId(id));
      expect(checkIds).toEqual([
        'check_schema_jsonld_missing',
        'check_schema_jsonld_syntax_error_1',
        'check_schema_missing_business_name',
        'check_schema_missing_telephone',
        'check_schema_types_detected'
      ]);
      expect(new Set(checkIds).size).toBe(ids.length);
      expect(checkIds).not.toContain('check_schema_jsonld');
    });

    it('compareAuditForRecheck tracks distinct schema_* checks across resolved vs remaining', () => {
      const makeAudit = (auditId: string, score: number, findings: any[]): any => ({
        auditId,
        url: 'https://launch-test.example',
        scannedAt: new Date().toISOString(),
        overallStatus: score >= 80 ? 'OPTIMIZED' : 'ACTION_REQUIRED',
        score,
        scoreExplanation: 'deterministic',
        findings,
        metrics: {
          httpStatus: 200,
          responseTimeMs: 120,
          htmlSizeBytes: 2048,
          contentType: 'text/html',
          redirectChain: [],
          hasRobotsTxt: true,
          hasSitemap: true,
          jsonLdTypesFound: ['Organization'],
          contactChannelsFound: []
        },
        preview: { title: 'Test', metaDescription: 'Desc', canonicalUrl: 'https://launch-test.example', ogTitle: 'Test', ogImage: '', fixPackSnippetPreview: '' },
        disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true }
      });

      const baseline = makeAudit('aud_base_1', 55, [
        { id: 'schema_jsonld_syntax_error_1', category: 'STRUCTURED_DATA', title: 'JSON-LD Syntax Error #1', status: 'ISSUE', severity: 'CRITICAL', location: 'head', evidence: 'bad json', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: true, needsUserConfirmation: false },
        { id: 'schema_missing_business_name', category: 'STRUCTURED_DATA', title: 'Missing name', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: 'no name', explanation: '', recommendation: '', confidence: 95, canAutoGenerate: true, needsUserConfirmation: false }
      ]);

      const recheck = makeAudit('aud_recheck_1', 85, [
        { id: 'schema_missing_business_name', category: 'STRUCTURED_DATA', title: 'Missing name', status: 'ISSUE', severity: 'HIGH', location: 'head', evidence: 'no name', explanation: '', recommendation: '', confidence: 95, canAutoGenerate: true, needsUserConfirmation: false },
        { id: 'schema_types_detected', category: 'STRUCTURED_DATA', title: 'Valid Schema', status: 'PASS', severity: 'INFO', location: 'head', evidence: 'Organization', explanation: '', recommendation: '', confidence: 100, canAutoGenerate: false, needsUserConfirmation: false }
      ]);

      const diff = compareAuditForRecheck(baseline, recheck);
      expect(diff.resolvedChecks.map(c => c.checkId)).toEqual(['check_schema_jsonld_syntax_error_1']);
      expect(diff.remainingChecks.map(c => c.checkId)).toEqual(['check_schema_missing_business_name']);
      expect(diff.allCriticalResolved).toBe(true);
      expect(diff.scoreDelta).toBe(30);
    });
  });

  // =========================================================================
  // PART 1.3 — ATOMIC PROPOSAL PAID SYNC & 409 DUPLICATE CHECKOUT GUARD
  // =========================================================================
  describe('3. Atomic Proposal PAID Sync & Duplicate Checkout 409 Guard', () => {
    it('syncs proposals.status = PAID atomically on payment_link.paid webhook and blocks duplicate checkout with HTTP 409', async () => {
      const db = getDb();
      const pe = ProposalEngine.getInstance();
      const adapter = new RazorpayAdapter();
      const proposal = pe.createProposal({
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        prospectId: `prosp_launch_qa_${Date.now()}`,
        title: 'Launch Gate Proposal',
        setupPriceINR: 15000,
        monthlyPriceINR: 8000,
        deliverables: ['Website Launch Audit']
      });
      db.prepare(`UPDATE proposals SET status = 'APPROVED' WHERE id = ?`).run(proposal.id);

      const linkId = `plink_launch_${Date.now()}`;
      const payId = `pay_launch_${Date.now()}`;
      const eventId = `evt_launch_${Date.now()}`;

      db.prepare(`
        INSERT INTO payment_provider_links (
          id, provider, provider_link_id, organization_id, business_id, proposal_id,
          reference_id, amount_inr, currency, short_url, status, created_at
        ) VALUES (?, 'RAZORPAY', ?, ?, ?, ?, ?, 15000, 'INR', 'https://rzp.io/i/test', 'CREATED', datetime('now'))
      `).run(`ppl_${Date.now()}`, linkId, OwnerAuthService.OWNER_ORGANIZATION_ID, OwnerAuthService.PLATFORM_BUSINESS_ID, proposal.id, `ref_${Date.now()}`);

      const secret = 'test_launch_webhook_secret';
      process.env.RAZORPAY_WEBHOOK_SECRET = secret;

      const eventPayload = {
        id: eventId,
        event: 'payment_link.paid',
        payload: {
          payment_link: {
            entity: {
              id: linkId,
              amount: 1500000,
              amount_paid: 1500000,
              notes: {
                organization_id: OwnerAuthService.OWNER_ORGANIZATION_ID,
                business_id: OwnerAuthService.PLATFORM_BUSINESS_ID,
                proposal_id: proposal.id
              }
            }
          },
          payment: {
            entity: {
              id: payId,
              amount: 1500000,
              method: 'upi',
              payment_link_id: linkId,
              notes: {
                organization_id: OwnerAuthService.OWNER_ORGANIZATION_ID,
                business_id: OwnerAuthService.PLATFORM_BUSINESS_ID,
                proposal_id: proposal.id
              }
            }
          }
        }
      };
      const rawBody = JSON.stringify(eventPayload);

      const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      const webhookRes = await adapter.processWebhook({ rawBody, signature, event: eventPayload });
      expect(webhookRes.processed).toBe(true);

      // Verify proposal atomically transitioned to PAID
      const updatedProposal = db.prepare(`SELECT status FROM proposals WHERE id = ?`).get(proposal.id) as any;
      expect(updatedProposal?.status).toBe('PAID');

      // Duplicate checkout via public route MUST be blocked with HTTP 409
      const dupRes = await app.request('/api/v1/payments/public/create-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerId: 'PLATFORM_SETUP',
          proposalId: proposal.id
        })
      });
      expect(dupRes.status).toBe(409);
      const dupJson = await dupRes.json() as any;
      expect(dupJson.error).toBe('PROPOSAL_ALREADY_PAID');

      // Direct adapter createPaymentLink MUST also block duplicate checkout
      await expect(
        adapter.createPaymentLink({
          organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
          businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
          offerId: 'PLATFORM_SETUP',
          proposalId: proposal.id
        })
      ).rejects.toThrow(/PROPOSAL_ALREADY_PAID/);
    });
  });

  // =========================================================================
  // PART 1.4 — SINGLE VERIFIED DIRECT_OFFER.MD SNAPSHOT & TBD NON-PAYABLE
  // =========================================================================
  describe('4. Single Verified DIRECT_OFFER.md Snapshot & Strict TBD Non-Payable', () => {
    it('keeps TBD attested snapshot strictly non-payable with zero ₹15,000/₹8,000 fallbacks', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitefix-offer-'));
      const tbdFile = path.join(tmpDir, 'DIRECT_OFFER.md');
      fs.writeFileSync(
        tbdFile,
        [
          '# DIRECT OFFER SPEC',
          '- **Product SKU:** `SITEFIX_AI_PACK_V1`',
          '- **Product Name:** SiteFix Launch Gate Pack',
          '- **Authorized Price:** TBD',
          '- **Currency:** INR'
        ].join('\n'),
        'utf8'
      );

      try {
        const snap = readVerifiedDirectOfferSnapshot(tbdFile);
        expect(snap).not.toBeNull();
        expect(snap!.isTbd).toBe(true);
        expect(snap!.priceINR).toBeNull();

        process.env.OWN_OFFER_CONFIRMED = 'true';
        process.env.DIRECT_OFFER_TERMS_SHA256 = snap!.sha256;
        process.env.OWNER_UPI_VPA = 'merchant@upi';

        const html = DirectCommercialOfferPage.getInstance().renderOfferHtml({}, tbdFile);
        expect(html).toContain('Pricing TBD');
        expect(html).toContain('noindex, nofollow');
        expect(html).not.toContain('upi://pay');
        expect(html).not.toContain('₹15,000');
        expect(html).not.toContain('₹8,000');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('renders exact ₹499 price from attested owner/OWN_OFFER.md with zero ₹15,000/₹8,000 fallbacks', () => {
      const snap = readVerifiedDirectOfferSnapshot();
      expect(snap).not.toBeNull();
      expect(snap!.sku).toBe('SITEFIX_AI_PACK_V1');
      expect(snap!.priceINR).toBe(499);
      expect(snap!.isTbd).toBe(false);

      process.env.OWN_OFFER_CONFIRMED = 'true';
      process.env.DIRECT_OFFER_TERMS_SHA256 = snap!.sha256;

      const html = DirectCommercialOfferPage.getInstance().renderOfferHtml({});
      expect(html).toContain('SITEFIX_AI_PACK_V1');
      expect(html).toContain('₹499');
      expect(html).not.toContain('₹15,000');
      expect(html).not.toContain('₹8,000');
    });
  });

  // =========================================================================
  // PART 1.5 — TOKEN EXPIRY, INDIVIDUAL WATCH PURGE & SQLITE ERROR STATUS
  // =========================================================================
  describe('5. Embedded HMAC Token Expiry & Individual Watch Purge / SQLite Error Status', () => {
    it('site-audit-page validates embedded HMAC exp segment and defaults to DEVELOPER_LAUNCH_QA + SITEFIX_AI_PACK_V1', () => {
      const html = renderSiteAuditPage();
      expect(html).toContain('option value="DEVELOPER_LAUNCH_QA" selected');
      expect(html).not.toContain('Local Business / Clinic');
      expect(html).toContain("sku: 'SITEFIX_AI_PACK_V1'");
      expect(html).toContain('function parseEmbeddedTokenExpiry(token)');
      expect(html).toContain('function isEmbeddedRecheckTokenValid(token)');
      expect(html).toContain("localStorage.removeItem('sitefix_recheck_token')");
    });

    it('rejects expired embedded HMAC tokens at SiteAuditService.verifyFixPackRecheck', async () => {
      const service = SiteAuditService.getInstance();
      const expiredToken = service.generateDeliveryToken('order_test_1', 'aud_test_1', 'pay_test_1', -1);
      const res = await service.verifyFixPackRecheck({ token: expiredToken });
      expect(res.valid).toBe(false);
      expect(res.error).toBe('TOKEN_EXPIRED');
    });

    it('purges expired price-alert watches individually by watch.registered_at (not parent created_at) and reports SQLite ERROR explicitly', () => {
      const db = getDb();
      const mgr = DPDPComplianceManager.getInstance();
      const contactId = `oc_watch_test_${Date.now()}`;
      const oldReg = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      const freshReg = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(`
        INSERT INTO outbound_contacts (
          id, organization_id, business_id, prospect_name, prospect_email, status,
          email_authorized, is_suppressed, authorization_evidence_json, created_at
        ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'Price Alert Buyer', 'buyer@example.com', 'ACTIVE', 1, 0, ?, datetime('now'))
      `).run(
        contactId,
        JSON.stringify({
          watches: [
            { subscription_id: 'sub_old', target_deal_slug: 'old-deal', registered_at: oldReg },
            { subscription_id: 'sub_fresh', target_deal_slug: 'fresh-deal', registered_at: freshReg }
          ]
        })
      );

      const purgeRes = mgr.purgeExpiredPriceAlertWatches(30);
      expect(purgeRes.localStatus).toBe('OK');
      expect(purgeRes.watchesPurgedCount).toBeGreaterThanOrEqual(1);

      const row = db.prepare(`SELECT prospect_email, status, authorization_evidence_json FROM outbound_contacts WHERE id = ?`).get(contactId) as any;
      const ev = JSON.parse(row.authorization_evidence_json);
      expect(ev.watches.map((w: any) => w.subscription_id)).toEqual(['sub_fresh']);
      expect(row.prospect_email).toBe('buyer@example.com'); // unexpired watch keeps contact intact

      // Clean up test row
      db.prepare(`DELETE FROM outbound_contacts WHERE id = ?`).run(contactId);

      // SQLite failure explicitly reported as localStatus = 'ERROR'
      const brokenDb = {
        prepare: () => {
          throw new Error('SQLITE_INIT_SIMULATED_FAILURE');
        }
      };
      const errRes = mgr.purgeExpiredInquiries(30, brokenDb);
      expect(errRes.localStatus).toBe('ERROR');
      expect(errRes.error).toContain('SQLITE_INIT_SIMULATED_FAILURE');
    });
  });

  // =========================================================================
  // PART 1.6 — CANONICAL SKU, HOMEPAGE CLEANUP & LEGACY HEALTHCARE QUARANTINE
  // =========================================================================
  describe('6. Canonical SKU, Homepage Cleanup & Legacy Healthcare Quarantine', () => {
    it('normalizes ₹499 checkout SKU to canonical SITEFIX_AI_PACK_V1', () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      expect(adapter.resolveAuthoritativePrice('SITEFIX_AI_PACK_V1', 499).canonicalSku).toBe('SITEFIX_AI_PACK_V1');
      expect(adapter.resolveAuthoritativePrice('sitefix_core_499', 499).canonicalSku).toBe('SITEFIX_AI_PACK_V1');
    });

    it('removes legacy dental/clinic WhatsApp demo from GET / and quarantines legacy healthcare/education offers', async () => {
      const homeRes = await app.request('/');
      expect(homeRes.status).toBe(200);
      const html = await homeRes.text();
      expect(html).toContain('SiteFix Launch Gate');
      expect(html).toContain('npx sitefix-check');
      expect(html).toContain('/api/v1/public/mcp');
      expect(html).not.toMatch(/Apex Dental|chipped tooth|8 PM to 8 AM Inquiry Gap|dental clinic/i);

      const catalog = OfferCatalogService.getInstance();
      expect(() => catalog.resolveAuthorizedOffer('HEALTHCARE_SETUP')).toThrow(/QUARANTINED_LEGACY_OFFER/);
      expect(() => catalog.resolveAuthorizedOffer('HEALTHCARE_RETAINER')).toThrow(/QUARANTINED_LEGACY_OFFER/);
      expect(() => catalog.resolveAuthorizedOffer('EDUCATION_SETUP')).toThrow(/QUARANTINED_LEGACY_OFFER/);
      expect(() => catalog.resolveAuthorizedOffer('CONSULTATION_DEPOSIT')).toThrow(/QUARANTINED_LEGACY_OFFER/);
      expect(catalog.resolveAuthorizedOffer('SITEFIX_AI_PACK_V1').priceINR).toBe(499);
    });
  });

  // =========================================================================
  // PART 1.7 — COMMISSION_RECORDS MULTI-ROW LEDGER & FAIL-CLOSED PAYOUT CATEGORY
  // =========================================================================
  describe('7. commission_records Multi-Row Query & Fail-Closed Invalid Payout Category', () => {
    it('reads 0, 1, and multiple commission_records cleanly in /api/v1/public/revenue-funnel', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM commission_records`).run();

      // 0 rows -> VERIFIED_ZERO (never UNAVAILABLE_QUERY_ERROR)
      const res0 = await app.request('/api/v1/public/revenue-funnel');
      expect(res0.status).toBe(200);
      const json0 = await res0.json() as any;
      expect(json0.data.commissionBuckets.commissionLedgerStatus).toBe('VERIFIED_ZERO');
      expect(json0.data.commissionBuckets.pendingCommissionINR).toBe(0);

      // Insert 2 rows -> sums BOTH rows properly (previously queryOne failed!)
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO partners (
          id, organization_id, name, industry, website, created_at, updated_at
        ) VALUES ('part_launch_test', 'org_owner_primary', 'Launch Test Partner', 'TECH', 'https://partner.example', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO commission_records (
          id, partner_id, organization_id, external_status,
          expected_commission_inr, verified_commission_inr, received_commission_inr,
          verification_source, evidence_json, created_at
        ) VALUES
          ('cr_test_1', 'part_launch_test', 'org_owner_primary', 'pending', 120, 0, 0, 'PARTNER_API', '{"currency":"INR"}', ?),
          ('cr_test_2', 'part_launch_test', 'org_owner_primary', 'pending', 80, 0, 0, 'PARTNER_API', '{"currency":"INR"}', ?)
      `).run(now, now);

      const res2 = await app.request('/api/v1/public/revenue-funnel');
      expect(res2.status).toBe(200);
      const json2 = await res2.json() as any;
      expect(json2.data.commissionBuckets.commissionLedgerStatus).toBe('VERIFIED_ACTIVE');
      expect(json2.data.commissionBuckets.pendingCommissionINR).toBe(200);
      expect(json2.data.affiliateFunnel.pendingCommissionINR).toBe(200);

      db.prepare(`DELETE FROM commission_records WHERE id IN ('cr_test_1', 'cr_test_2')`).run();
      db.prepare(`DELETE FROM partners WHERE id = 'part_launch_test'`).run();
    });

    it('fails closed on invalid payout category strings or malformed payout_categories_json instead of falling back to General', () => {
      const badJsonRes = parseVerifiedCampaignPayout(
        { payout_categories_json: '{bad-json', payout_rate: '5%' },
        1000,
        'Electronics'
      );
      expect(badJsonRes.monetizationModel).toBe('UNKNOWN');
      expect(badJsonRes.missingPayoutReason).toBe('INVALID_PAYOUT_CATEGORY');

      const badCatRes = parseVerifiedCampaignPayout(
        { payout_categories: [{ category: 'Audio', payout: '7%' }], payout_rate: '5%' },
        1000,
        '???'
      );
      expect(badCatRes.monetizationModel).toBe('UNKNOWN');
      expect(badCatRes.missingPayoutReason).toBe('INVALID_PAYOUT_CATEGORY');

      const unmatchedTierNoDefault = parseVerifiedCampaignPayout(
        { payout_categories: [{ category: 'Audio', payout: '7%' }] },
        1000,
        'Furniture'
      );
      expect(unmatchedTierNoDefault.monetizationModel).toBe('UNKNOWN');
      expect(unmatchedTierNoDefault.missingPayoutReason).toBe('INVALID_PAYOUT_CATEGORY');
    });
  });

  // =========================================================================
  // PART 2 — THREE PULL INTERFACES (CLI, GITHUB ACTION, ISOLATED PUBLIC MCP)
  // =========================================================================
  describe('8. Isolated Public MCP (/api/v1/public/mcp), /.well-known/mcp.json & server.json', () => {
    it('exposes ONLY the 3 safe SiteFix tools on POST /api/v1/public/mcp and rejects owner tools with -32601', async () => {
      const listRes = await app.request('/api/v1/public/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      });
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json() as any;
      const toolNames = listJson.result.tools.map((t: any) => t.name);
      expect(toolNames).toEqual([
        'sitefix_check_url',
        'sitefix_get_findings',
        'sitefix_generate_fix_preview'
      ]);

      // Verify confirmAuthorized is required boolean on scan tools
      const checkTool = listJson.result.tools.find((t: any) => t.name === 'sitefix_check_url');
      const previewTool = listJson.result.tools.find((t: any) => t.name === 'sitefix_generate_fix_preview');
      expect(checkTool.inputSchema.required).toEqual(['url', 'confirmAuthorized']);
      expect(checkTool.inputSchema.properties.confirmAuthorized.type).toBe('boolean');
      expect(previewTool.inputSchema.required).toEqual(['url', 'confirmAuthorized']);
      expect(previewTool.inputSchema.properties.confirmAuthorized.type).toBe('boolean');

      // Reject missing or false confirmAuthorized with JSON-RPC -32602 BEFORE invoking SiteAuditService
      for (const scanTool of ['sitefix_check_url', 'sitefix_generate_fix_preview']) {
        for (const badArgs of [
          { url: 'https://example.com' },
          { url: 'https://example.com', confirmAuthorized: false },
          { url: 'https://example.com', confirmAuthorized: 'true' }
        ]) {
          const authErrRes = await app.request('/api/v1/public/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 10,
              method: 'tools/call',
              params: { name: scanTool, arguments: badArgs }
            })
          });
          expect(authErrRes.status).toBe(400);
          const authErrJson = await authErrRes.json() as any;
          expect(authErrJson.error.code).toBe(-32602);
          expect(authErrJson.error.message).toContain('confirmAuthorized');
        }
      }

      // Reject owner-only tools strictly
      for (const forbiddenTool of ['get_top_verified_deals', 'get_ready_sitefix_audits', 'get_autonomy_and_doctor_status', 'get_owner_today']) {
        const callRes = await app.request('/api/v1/public/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: forbiddenTool, arguments: {} }
          })
        });
        expect(callRes.status).toBe(404);
        const errJson = await callRes.json() as any;
        expect(errJson.error.code).toBe(-32601);
      }

      // Verify existing owner /api/v1/mcp remains gated (unauthorized without owner auth)
      const ownerMcpRes = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
      });
      expect(ownerMcpRes.status).toBe(401);
    });

    it('serves /.well-known/mcp.json and schema-valid root server.json with GitHub-verifiable namespace and remotes', async () => {
      const wellKnownRes = await app.request('/.well-known/mcp.json');
      expect(wellKnownRes.status).toBe(200);
      const wk = await wellKnownRes.json() as any;
      expect(wk.name).toBe('io.github.harshavardhankotu/sitefix-launch-gate');
      expect(wk.remotes[0].url).toContain('/api/v1/public/mcp');
      expect(wk.transport.url).toContain('/api/v1/public/mcp');
      expect(wk.tools.map((t: any) => t.name)).toEqual([
        'sitefix_check_url',
        'sitefix_get_findings',
        'sitefix_generate_fix_preview'
      ]);

      const serverJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'server.json'), 'utf8'));
      expect(serverJson.name).toBe('io.github.harshavardhankotu/sitefix-launch-gate');
      expect(serverJson.description.length).toBeLessThanOrEqual(100);
      expect(serverJson.remotes[0]).toEqual({
        type: 'streamable-http',
        url: 'https://ai-marketing-organization.onrender.com/api/v1/public/mcp'
      });
      expect(serverJson.tools).toBeUndefined();
    });
  });

  describe('9. Zero-Install CLI (packages/cli), Prebuilt Action Entrypoint (action-dist/cli.mjs) & action.yml', () => {
    it('fails closed (exit 2, zero HTTP calls) without --confirm-authorized and succeeds when explicitly confirmed', async () => {
      const mockAudit: CliAuditResult = {
        auditId: 'aud_cli_1',
        url: 'https://launch-demo.dev',
        overallStatus: 'ACTION_REQUIRED',
        score: 52,
        findings: [
          {
            id: 'schema_jsonld_syntax_error_1',
            category: 'STRUCTURED_DATA',
            title: 'JSON-LD Syntax Error in Block #1',
            status: 'ISSUE',
            severity: 'CRITICAL',
            evidence: 'Unexpected token }'
          },
          {
            id: 'meta_description_missing',
            category: 'HTML_METADATA',
            title: 'Missing Meta Description',
            status: 'ISSUE',
            severity: 'HIGH',
            evidence: 'No meta description tag'
          }
        ],
        metrics: {
          httpStatus: 200,
          hasRobotsTxt: true,
          hasSitemap: false,
          jsonLdTypesFound: []
        }
      };

      let fetchCallCount = 0;
      let lastRequestBody: any = null;
      const fakeFetch = (async (_url: any, init?: any) => {
        fetchCallCount++;
        lastRequestBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(JSON.stringify({ success: true, result: mockAudit }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }) as unknown as typeof fetch;

      // 1. Missing --confirm-authorized MUST fail closed with exit 2 and ZERO network calls
      const resUnauth = await runSitefixCheck(['https://launch-demo.dev', '--fail-on-critical'], fakeFetch, {});
      expect(resUnauth.exitCode).toBe(2);
      expect(resUnauth.stderr).toContain(AUTHORIZATION_REQUIRED_MESSAGE);
      expect(fetchCallCount).toBe(0);

      // 2. With --confirm-authorized and --fail-on-critical -> calls API and exits 1 on CRITICAL defect
      const resFail = await runSitefixCheck(
        ['https://launch-demo.dev', '--confirm-authorized', '--fail-on-critical'],
        fakeFetch,
        {}
      );
      expect(fetchCallCount).toBe(1);
      expect(lastRequestBody?.userConfirmedOwnership).toBe(true);
      expect(resFail.exitCode).toBe(1);
      expect(resFail.criticalCount).toBe(1);
      expect(resFail.stdout).toContain('check_schema_jsonld_syntax_error_1');
      expect(resFail.stdout).toContain(
        'https://ai-marketing-organization.onrender.com/tools/site-audit?url=https%3A%2F%2Flaunch-demo.dev'
      );

      // 3. Env fallback SITEFIX_CONFIRM_AUTHORIZED=true succeeds cleanly without --fail-on-critical
      const resPass = await runSitefixCheck(['https://launch-demo.dev'], fakeFetch, {
        SITEFIX_CONFIRM_AUTHORIZED: 'true'
      });
      expect(resPass.exitCode).toBe(0);
      expect(fetchCallCount).toBe(2);

      const table = formatAuditTable(mockAudit);
      expect(table).toContain('SITEFIX_AI_PACK_V1');
      const md = formatMarkdownSummary(mockAudit);
      expect(md).toContain('## SiteFix Launch Gate');
      expect(md).toContain('check_schema_jsonld_syntax_error_1');
    });

    it('root action.yml requires confirm-authorized and invokes prebuilt action-dist/cli.mjs with zero runtime npm build', () => {
      const actionYml = fs.readFileSync(path.join(REPO_ROOT, 'action.yml'), 'utf8');
      expect(actionYml).toContain("name: 'SiteFix Launch Gate — Pre-Deployment Website QA'");
      expect(actionYml).toContain('url:');
      expect(actionYml).toContain('confirm-authorized:');
      expect(actionYml).toContain('fail-on-critical:');
      expect(actionYml).toContain('score:');
      expect(actionYml).toContain('failed_checks:');
      expect(actionYml).toContain('GITHUB_STEP_SUMMARY');
      expect(actionYml).toContain('action-dist/cli.mjs');
      expect(actionYml).toContain('--confirm-authorized');
      expect(actionYml).not.toContain('npm --prefix');
    });

    it('committed action-dist/cli.mjs matches built CLI output and executes cleanly from an isolated temp directory with zero node_modules', async () => {
      const actionBundlePath = path.join(REPO_ROOT, 'action-dist', 'cli.mjs');
      const builtCliPath = path.join(REPO_ROOT, 'packages', 'cli', 'dist', 'cli.js');
      expect(fs.existsSync(actionBundlePath)).toBe(true);
      expect(fs.existsSync(builtCliPath)).toBe(true);

      const actionBytes = fs.readFileSync(actionBundlePath, 'utf8');
      const builtBytes = fs.readFileSync(builtCliPath, 'utf8');
      expect(actionBytes).toBe(builtBytes);

      // Verify zero external imports outside Node built-ins
      const importMatches = [...actionBytes.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
      for (const spec of importMatches) {
        expect(spec.startsWith('node:')).toBe(true);
      }

      // Copy ONLY the standalone bundle into a completely isolated temp directory (no package.json, no node_modules)
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitefix-isolated-action-'));
      const isolatedBundle = path.join(isolatedDir, 'cli.mjs');
      fs.copyFileSync(actionBundlePath, isolatedBundle);

      // Spin up a local loopback mock SiteFix API to verify end-to-end execution
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            result: {
              auditId: 'aud_isolated_1',
              url: parsed.url,
              overallStatus: 'OPTIMIZED',
              score: 96,
              findings: [
                {
                  id: 'schema_types_detected',
                  category: 'STRUCTURED_DATA',
                  title: 'Valid JSON-LD',
                  status: 'PASS',
                  severity: 'INFO',
                  evidence: 'WebSite'
                }
              ],
              metrics: { httpStatus: 200, hasRobotsTxt: true, hasSitemap: true, jsonLdTypesFound: ['WebSite'] }
            }
          }));
        });
      });

      try {
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;

        // 1. Fails closed without --confirm-authorized from isolated dir
        const unauthRun = spawnSync('node', [isolatedBundle, 'https://isolated.example'], {
          cwd: isolatedDir,
          encoding: 'utf8',
          env: { PATH: process.env.PATH }
        });
        expect(unauthRun.status).toBe(2);
        expect(unauthRun.stderr).toContain(AUTHORIZATION_REQUIRED_MESSAGE);

        // 2. Succeeds with --confirm-authorized --json against loopback API from isolated dir (async so parent HTTP server responds)
        const { stdout: authOut } = await execFileAsync(
          'node',
          [isolatedBundle, 'https://isolated.example', '--confirm-authorized', '--api-url', `http://127.0.0.1:${port}`, '--json'],
          {
            cwd: isolatedDir,
            encoding: 'utf8',
            env: { PATH: process.env.PATH }
          }
        );
        const parsedOut = JSON.parse(authOut);
        expect(parsedOut.auditId).toBe('aud_isolated_1');
        expect(parsedOut.score).toBe(96);
        expect(parsedOut.canonicalSku).toBe('SITEFIX_AI_PACK_V1');
      } finally {
        server.close();
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    });
  });
});
