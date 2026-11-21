import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      'RAZORPAY_WEBHOOK_SECRET',
      'PUBLIC_MCP_ENABLED'
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
  describe('8. Isolated Public MCP (/api/v1/public/mcp), PUBLIC_MCP_ENABLED Guard, /.well-known/mcp.json & server.json', () => {
    it('fails closed by default (PUBLIC_MCP_ENABLED unset/false) with HTTP 503, JSON-RPC -32000, enabled: false manifest, and keeps owner /api/v1/mcp 401-gated', async () => {
      delete process.env.PUBLIC_MCP_ENABLED;

      const listDisabledRes = await app.request('/api/v1/public/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      });
      expect(listDisabledRes.status).toBe(503);
      const listDisabledJson = await listDisabledRes.json() as any;
      expect(listDisabledJson.error.code).toBe(-32000);
      expect(listDisabledJson.error.message).toContain('PUBLIC_MCP_DISABLED');

      process.env.PUBLIC_MCP_ENABLED = 'false';
      const callDisabledRes = await app.request('/api/v1/public/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'sitefix_check_url', arguments: { url: 'https://example.com', confirmAuthorized: true } }
        })
      });
      expect(callDisabledRes.status).toBe(503);
      const callDisabledJson = await callDisabledRes.json() as any;
      expect(callDisabledJson.error.code).toBe(-32000);
      expect(callDisabledJson.error.message).toContain('PUBLIC_MCP_DISABLED');

      const wkDisabledRes = await app.request('/.well-known/mcp.json');
      expect(wkDisabledRes.status).toBe(200);
      const wkDisabled = await wkDisabledRes.json() as any;
      expect(wkDisabled.enabled).toBe(false);
      expect(wkDisabled.status).toBe('DISABLED');
      expect(wkDisabled.remotes).toEqual([]);
      expect(wkDisabled.tools).toEqual([]);
      expect(wkDisabled.authentication.type).toBe('disabled');

      // Owner /api/v1/mcp stays strictly auth-gated (401 unauthenticated)
      const ownerMcpRes = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
      });
      expect(ownerMcpRes.status).toBe(401);
    });

    it('when PUBLIC_MCP_ENABLED=true exposes ONLY the 3 safe SiteFix tools on POST /api/v1/public/mcp and rejects owner tools with -32601', async () => {
      process.env.PUBLIC_MCP_ENABLED = 'true';

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

    it('when PUBLIC_MCP_ENABLED=true serves /.well-known/mcp.json (enabled: true) and schema-valid root server.json with GitHub-verifiable namespace and remotes', async () => {
      process.env.PUBLIC_MCP_ENABLED = 'true';

      const wellKnownRes = await app.request('/.well-known/mcp.json');
      expect(wellKnownRes.status).toBe(200);
      const wk = await wellKnownRes.json() as any;
      expect(wk.enabled).toBe(true);
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

  describe('9. Zero-Install Local CLI (packages/cli), Prebuilt Action Entrypoint (action-dist/cli.mjs) & action.yml', () => {
    it('fails closed (exit 2, zero HTTP calls) without --confirm-authorized, runs locally via sitefix-core, and contacts backend ONLY for --unlock', async () => {
      const sampleHtml = `<!doctype html>
<html>
<head>
  <title>Launch Demo</title>
  <script type="application/ld+json">{ invalid json }</script>
</head>
<body><h1>Hello Launch Demo</h1></body>
</html>`;

      const requestedUrls: string[] = [];
      const fakeFetch = (async (input: any) => {
        const urlStr = typeof input === 'string' ? input : input?.url || String(input);
        requestedUrls.push(urlStr);
        if (urlStr.endsWith('/robots.txt')) {
          return new Response('User-agent: *\nAllow: /\n', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        if (urlStr.endsWith('/sitemap.xml')) {
          return new Response('Not Found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        if (urlStr.includes('/api/v1/offer/download/tok_paid_123')) {
          return new Response(
            JSON.stringify({
              success: true,
              deliverable: {
                auditId: 'aud_paid_1',
                orderId: 'ord_paid_1',
                generatedAt: new Date().toISOString(),
                targetUrl: 'https://launch-demo.dev',
                headMetadataSnippet: '<title>Launch Demo</title>',
                openGraphSnippet: '<meta property="og:title" content="Launch Demo">',
                twitterCardSnippet: '<meta name="twitter:card" content="summary_large_image">',
                schemaJsonLdSnippet: '<script type="application/ld+json">{}</script>',
                robotsTxtSnippet: 'User-agent: *\nAllow: /',
                sitemapXmlSnippet: '<urlset></urlset>',
                canonicalUrlRecommendation: 'https://launch-demo.dev/',
                checklistMarkdown: '# Checklist',
                fullReportJson: {},
                disclosure: 'No ranking guarantee.'
              }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(sampleHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }) as unknown as typeof fetch;

      // 1. Missing --confirm-authorized MUST fail closed with exit 2 and ZERO network calls
      const resUnauth = await runSitefixCheck(['https://launch-demo.dev', '--fail-on-critical'], fakeFetch, {});
      expect(resUnauth.exitCode).toBe(2);
      expect(resUnauth.stderr).toContain(AUTHORIZATION_REQUIRED_MESSAGE);
      expect(requestedUrls.length).toBe(0);

      // 2. Local scan with --confirm-authorized and --fail-on-critical -> runs locally (ZERO Render backend calls) and exits 1 on CRITICAL JSON-LD defect
      const resFail = await runSitefixCheck(
        ['https://launch-demo.dev', '--confirm-authorized', '--fail-on-critical'],
        fakeFetch,
        {}
      );
      expect(resFail.exitCode).toBe(1);
      expect(resFail.criticalCount).toBeGreaterThanOrEqual(1);
      expect(resFail.stdout).toContain('check_schema_jsonld_syntax_error_1');
      expect(resFail.stdout).toContain('Execution: LOCAL — Zero Backend Latency');
      expect(resFail.stdout).toContain('Fix-Pack Preview');
      expect(resFail.stdout).toContain(
        'https://ai-marketing-organization.onrender.com/tools/site-audit?url=https%3A%2F%2Flaunch-demo.dev&source=cli'
      );
      // Confirm ZERO Render backend API scan calls occurred
      expect(requestedUrls.some(u => u.includes('ai-marketing-organization.onrender.com'))).toBe(false);

      // 3. Explicit --source action overrides default cli attribution in JSON output
      const resAction = await runSitefixCheck(
        ['https://launch-demo.dev', '--confirm-authorized', '--source', 'action', '--json'],
        fakeFetch,
        {}
      );
      expect(resAction.exitCode).toBe(0);
      const parsedActionJson = JSON.parse(resAction.stdout);
      expect(parsedActionJson.executionMode).toBe('LOCAL');
      expect(parsedActionJson.source).toBe('action');
      expect(parsedActionJson.checkoutUrl).toContain('&source=action');
      expect(parsedActionJson.fixPackPreview?.headMetadataPreview).toBeTruthy();

      // 4. Env fallback SITEFIX_CONFIRM_AUTHORIZED=true succeeds cleanly without --fail-on-critical
      const resPass = await runSitefixCheck(['https://launch-demo.dev'], fakeFetch, {
        SITEFIX_CONFIRM_AUTHORIZED: 'true'
      });
      expect(resPass.exitCode).toBe(0);

      // 5. --unlock <orderToken> contacts backend download endpoint ONLY and writes files when --out <dir> is provided
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sitefix-unlock-out-'));
      try {
        const resUnlock = await runSitefixCheck(
          ['--unlock', 'tok_paid_123', '--out', outDir, '--api-url', 'https://api.example.test'],
          fakeFetch,
          {}
        );
        expect(resUnlock.exitCode).toBe(0);
        expect(requestedUrls).toContain('https://api.example.test/api/v1/offer/download/tok_paid_123');
        expect(fs.existsSync(path.join(outDir, 'head-metadata.html'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'fix-pack.json'))).toBe(true);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }

      const mockAudit: CliAuditResult = resAction.audit!;
      const table = formatAuditTable(mockAudit);
      expect(table).toContain('SITEFIX_AI_PACK_V1');
      const md = formatMarkdownSummary(mockAudit);
      expect(md).toContain('## SiteFix Launch Gate');
      expect(md).toContain('check_schema_jsonld_syntax_error_1');
    });

    it('root action.yml and packages/cli/README.md document local execution, --unlock, and link cleanly to all 4 owner tool pages', () => {
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
      expect(actionYml).toContain('--source action');
      expect(actionYml).not.toContain('npm --prefix');
      expect(actionYml).toContain('/tools/whatsapp-link-preview-checker');
      expect(actionYml).toContain('/tools/open-graph-checker');
      expect(actionYml).toContain('/tools/robots-and-sitemap-validator');
      expect(actionYml).toContain('/tools/json-ld-tester');

      const cliReadme = fs.readFileSync(path.join(REPO_ROOT, 'packages', 'cli', 'README.md'), 'utf8');
      expect(cliReadme).toContain('--unlock');
      expect(cliReadme).toContain('/tools/whatsapp-link-preview-checker');
      expect(cliReadme).toContain('/tools/open-graph-checker');
      expect(cliReadme).toContain('/tools/robots-and-sitemap-validator');
      expect(cliReadme).toContain('/tools/json-ld-tester');
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
      const sampleHtmlFile = path.join(isolatedDir, 'index.html');
      fs.copyFileSync(actionBundlePath, isolatedBundle);
      fs.writeFileSync(
        sampleHtmlFile,
        `<!doctype html><html><head><title>Isolated Local Scan Page Title For QA</title><meta name="description" content="A clean deterministic local HTML scan fixture that runs with zero node_modules and zero Render cold starts."><link rel="canonical" href="https://isolated.example/"><meta property="og:title" content="Isolated QA"><meta property="og:description" content="Clean preview"><meta property="og:image" content="https://isolated.example/og.png"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Isolated QA","url":"https://isolated.example/"}</script></head><body><h1>Isolated QA</h1></body></html>`,
        'utf8'
      );

      // Spin up a local loopback mock ONLY for --unlock download verification
      const server = http.createServer((req, res) => {
        if (req.url === '/api/v1/offer/download/tok_iso_99') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              deliverable: {
                auditId: 'aud_iso_99',
                targetUrl: 'https://isolated.example/',
                generatedAt: new Date().toISOString(),
                headMetadataSnippet: '<title>Isolated QA</title>',
                openGraphSnippet: '<meta property="og:title" content="Isolated QA">',
                twitterCardSnippet: '<meta name="twitter:card" content="summary_large_image">',
                schemaJsonLdSnippet: '<script type="application/ld+json">{}</script>',
                canonicalUrlRecommendation: 'https://isolated.example/',
                checklistMarkdown: '# Checklist',
                fullReportJson: {},
                disclosure: 'No ranking guarantee.'
              }
            })
          );
          return;
        }
        res.writeHead(404);
        res.end();
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

        // 2. SSRF guard blocks private loopback target in isolated standalone bundle
        const ssrfRun = spawnSync('node', [isolatedBundle, 'https://127.0.0.1', '--confirm-authorized'], {
          cwd: isolatedDir,
          encoding: 'utf8',
          env: { PATH: process.env.PATH }
        });
        expect(ssrfRun.status).toBe(2);
        expect(ssrfRun.stderr).toMatch(/SSRF|Blocked|private|loopback|reserved/i);

        // 3. Runs local deterministic scan via --html-file with zero node_modules and zero network
        const { stdout: localOut } = await execFileAsync(
          'node',
          [isolatedBundle, 'https://isolated.example/', '--confirm-authorized', '--html-file', sampleHtmlFile, '--json'],
          {
            cwd: isolatedDir,
            encoding: 'utf8',
            env: { PATH: process.env.PATH }
          }
        );
        const parsedLocal = JSON.parse(localOut);
        expect(parsedLocal.executionMode).toBe('LOCAL');
        expect(parsedLocal.canonicalSku).toBe('SITEFIX_AI_PACK_V1');
        expect(parsedLocal.score).toBeGreaterThanOrEqual(70);
        expect(parsedLocal.fixPackPreview?.headMetadataPreview).toContain('<title>');

        // 4. --unlock contacts backend API cleanly from isolated temp dir
        const { stdout: unlockOut } = await execFileAsync(
          'node',
          [isolatedBundle, '--unlock', 'tok_iso_99', '--api-url', `http://127.0.0.1:${port}`, '--json'],
          {
            cwd: isolatedDir,
            encoding: 'utf8',
            env: { PATH: process.env.PATH }
          }
        );
        const parsedUnlock = JSON.parse(unlockOut);
        expect(parsedUnlock.success).toBe(true);
        expect(parsedUnlock.deliverable.auditId).toBe('aud_iso_99');
      } finally {
        server.close();
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // PART 3 — SOURCE ATTRIBUTION ('cli' | 'action' | 'web' | 'mcp') & PROBE EXCLUSION
  // =========================================================================
  describe('10. Source Attribution (cli/action/web/mcp) & X-Diagnostic-Probe / CI UA Exclusion on /api/v1/owner/today', () => {
    it('persists explicit source across preview_open and checkout_start and excludes X-Diagnostic-Probe and CI UAs from /api/v1/owner/today', async () => {
      const db = getDb();
      db.prepare(`DELETE FROM durable_events WHERE event_type = 'SITEFIX_FUNNEL_EVENT'`).run();

      // 1. Genuine external web preview open (?source=cli from CLI checkout link)
      const extPreviewRes = await app.request('/tools/site-audit?url=https%3A%2F%2Fexternal-user.dev&source=cli', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36' }
      });
      expect(extPreviewRes.status).toBe(200);

      // 2. Genuine external checkout_start from action source
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_attr_001';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_test_attr_secret';
      const extOrderRes = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          sku: 'SITEFIX_AI_PACK_V1',
          domainOrUrl: 'external-user.dev',
          buyerEmail: 'founder@external-user.dev',
          source: 'action'
        })
      });
      expect(extOrderRes.status).toBe(200);
      const extOrderJson = await extOrderRes.json() as any;
      expect(extOrderJson.source).toBe('action');

      // 3. Diagnostic probe request (X-Diagnostic-Probe: true) MUST be excluded from external counts
      const probeRes = await app.request('/tools/site-audit?url=https%3A%2F%2Fprobe-check.dev&source=web', {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'X-Diagnostic-Probe': 'true'
        }
      });
      expect(probeRes.status).toBe(200);

      // 4. Repository CI User-Agent MUST be excluded from external counts
      const ciRes = await app.request('/tools/site-audit?url=https%3A%2F%2Fci-smoke.dev&source=action', {
        headers: {
          'User-Agent': 'GitHub-Actions/sitefix-ci-probe'
        }
      });
      expect(ciRes.status).toBe(200);

      // 5. Verify /api/v1/owner/today aggregates external events by source and excludes probes/CI
      const ownerSession = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const todayRes = await app.request('/api/v1/owner/today', {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
      });
      expect(todayRes.status).toBe(200);
      const todayJson = await todayRes.json() as any;
      const attr = todayJson.data?.sitefixFunnelAttribution;
      expect(attr).toBeDefined();
      expect(attr.totals.preview_open).toBe(1);
      expect(attr.bySource.cli.preview_open).toBe(1);
      expect(attr.totals.checkout_start).toBe(1);
      expect(attr.bySource.action.checkout_start).toBe(1);
      expect(attr.bySource.web.preview_open).toBe(0);
      expect(attr.excludedProbesCount).toBe(2);

      // Clean up test events
      db.prepare(`DELETE FROM durable_events WHERE event_type = 'SITEFIX_FUNNEL_EVENT'`).run();
    });
  });

  // =========================================================================
  // PASS 2 — PURE @ai-marketing/sitefix-core, HARDENED POST /api/v1/public/scan, & 4 OWNER TOOL PAGES
  // =========================================================================
  describe('11. Pass 2: Pure @ai-marketing/sitefix-core, Hardened POST /api/v1/public/scan & 4 Owner Diagnostic Pages', () => {
    it('pure @ai-marketing/sitefix-core extracts OG/WhatsApp, Twitter Card, robots/sitemap, and JSON-LD diagnostics without inventing business info', async () => {
      const {
        SiteAuditScanner,
        SiteAuditFixPackGenerator,
        WHATSAPP_CACHE_NOTICE
      } = await import('@ai-marketing/sitefix-core');

      const mockHtml = `<!doctype html>
<html>
<head>
  <title>Acme Bakery Mumbai</title>
  <meta name="robots" content="noindex, follow">
  <meta property="og:title" content="Acme Bakery">
  <meta property="og:image" content="http://acmebakery.example/cake.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme Bakery"}</script>
  <script type="application/ld+json">{ broken json </script>
</head>
<body><h1>Acme Bakery</h1></body>
</html>`;

      const injectedFetch = (async (input: any) => {
        const u = String(typeof input === 'string' ? input : input?.url);
        if (u.endsWith('/robots.txt')) {
          return new Response('User-agent: *\nDisallow: /\nSitemap: https://acmebakery.example/sitemap.xml\n', {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
          });
        }
        if (u.endsWith('/sitemap.xml')) {
          return new Response('<?xml version="1.0"?><urlset></urlset>', {
            status: 200,
            headers: { 'Content-Type': 'application/xml' }
          });
        }
        return new Response(mockHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }) as unknown as typeof fetch;

      const scanner = new SiteAuditScanner(injectedFetch);
      const audit = await scanner.scanUrl(
        { url: 'https://acmebakery.example', userConfirmedOwnership: true },
        undefined,
        { fetchImpl: injectedFetch, skipDnsForInjectedFetch: true }
      );

      expect(audit.diagnostics?.openGraph.ogTitle).toBe('Acme Bakery');
      expect(audit.diagnostics?.openGraph.ogImageIsHttps).toBe(false);
      expect(audit.diagnostics?.openGraph.whatsappCacheNotice).toBe(WHATSAPP_CACHE_NOTICE);
      expect(audit.diagnostics?.robotsAndSitemap.metaRobotsNoindex).toBe(true);
      expect(audit.diagnostics?.robotsAndSitemap.robotsTxtDisallowsAll).toBe(true);
      expect(audit.diagnostics?.robotsAndSitemap.sitemapReachable).toBe(true);
      expect(audit.diagnostics?.jsonLd.blockCount).toBe(2);
      expect(audit.diagnostics?.jsonLd.validBlockCount).toBe(1);
      expect(audit.diagnostics?.jsonLd.invalidBlockCount).toBe(1);
      expect(audit.diagnostics?.jsonLd.blocks[0].missingRecommendedFields.some(m => m.field === 'url')).toBe(true);

      const fixPack = new SiteAuditFixPackGenerator().generateFixPack(audit);
      expect(fixPack.headMetadataSnippet).toContain('[INSERT_META_DESCRIPTION]');
      expect(fixPack.schemaJsonLdSnippet).toContain('REPLACE_WITH_YOUR_');
      expect(fixPack.missingFieldsRequiringOwnerInput?.length).toBeGreaterThan(0);
    });

    it('POST /api/v1/public/scan enforces strict confirmAuthorized boolean, SSRF blocks, per-IP/global daily caps, 24h cache, and 4 web tool sources', async () => {
      const {
        clearPublicScanCacheForTesting,
        PUBLIC_SCAN_CACHE_EVENT_TYPE,
        normalizeUrlForPublicCache
      } = await import('../../src/tools/site-audit/public-scan-service.js');

      const db = getDb();
      clearPublicScanCacheForTesting();
      db.prepare(`DELETE FROM durable_events WHERE event_type IN (?, 'SITEFIX_FUNNEL_EVENT')`).run(
        PUBLIC_SCAN_CACHE_EVENT_TYPE
      );

      // 1. Missing or non-boolean confirmAuthorized MUST return 400
      const noAuthRes = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', confirmAuthorized: 'true', source: 'web_whatsapp_preview' })
      });
      expect(noAuthRes.status).toBe(400);
      const noAuthJson = await noAuthRes.json() as any;
      expect(noAuthJson.code).toBe('CONFIRM_AUTHORIZED_REQUIRED');

      // 2. Private/loopback/metadata SSRF URLs MUST fail closed with 400
      for (const badUrl of ['http://127.0.0.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:3000']) {
        const ssrfRes = await app.request('/api/v1/public/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: badUrl, confirmAuthorized: true, source: 'web_open_graph' })
        });
        expect(ssrfRes.status).toBe(400);
        const ssrfJson = await ssrfRes.json() as any;
        expect(ssrfJson.success).toBe(false);
      }

      // 3. Seed a 24h durable_events cache row and verify cache hit returns cached: true + source attribution + checkoutUrl
      const normalized = normalizeUrlForPublicCache('https://cached-owner-site.example');
      const cacheHash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24);
      const cachedPayload = {
        normalizedUrl: normalized,
        cachedAt: new Date().toISOString(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        result: {
          auditId: 'aud_cached_24h',
          url: normalized,
          scannedAt: new Date().toISOString(),
          overallStatus: 'NEEDS_IMPROVEMENT',
          score: 74,
          scoreExplanation: 'Cached deterministic test result',
          findings: [],
          metrics: {
            httpStatus: 200,
            responseTimeMs: 42,
            htmlSizeBytes: 512,
            contentType: 'text/html',
            redirectChain: [normalized],
            hasRobotsTxt: true,
            hasSitemap: true,
            jsonLdTypesFound: ['WebSite'],
            contactChannelsFound: []
          },
          preview: {
            title: 'Cached Owner Site',
            metaDescription: 'Cached description',
            canonicalUrl: normalized,
            ogTitle: 'Cached Owner Site',
            ogImage: 'https://cached-owner-site.example/og.png',
            fixPackSnippetPreview: '<meta property="og:title" content="Cached Owner Site">'
          },
          disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true }
        },
        fixPackPreview: {
          canonicalSku: 'SITEFIX_AI_PACK_V1',
          priceINR: 499,
          snippetPreview: '<meta property="og:title" content="Cached Owner Site">',
          deliverablesIncluded: ['Open Graph tags'],
          missingFieldsRequiringOwnerInput: [],
          disclosure: 'No ranking guarantee.'
        }
      };

      db.prepare(
        `INSERT INTO durable_events (id, event_type, organization_id, payload_json, created_at)
         VALUES (?, ?, 'org_owner_primary', ?, datetime('now'))`
      ).run(`sfx_cache_${cacheHash}_unit0001`, PUBLIC_SCAN_CACHE_EVENT_TYPE, JSON.stringify(cachedPayload));

      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_pubscan_01';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'rzp_test_pubscan_secret_01';

      const cachedRes = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36'
        },
        body: JSON.stringify({
          url: 'https://cached-owner-site.example',
          confirmAuthorized: true,
          source: 'web_whatsapp_preview'
        })
      });
      expect(cachedRes.status).toBe(200);
      const cachedJson = await cachedRes.json() as any;
      expect(cachedJson.success).toBe(true);
      expect(cachedJson.cached).toBe(true);
      expect(cachedJson.cacheStatus).toBe('HIT_D1');
      expect(cachedJson.authorizationMode).toBe('SELF_DECLARED_AUTHORIZATION');
      expect(cachedJson.cacheTtlHours).toBe(24);
      expect(cachedJson.source).toBe('web_whatsapp_preview');
      expect(cachedJson.canonicalSku).toBe('SITEFIX_AI_PACK_V1');
      expect(cachedJson.priceINR).toBe(499);
      expect(cachedJson.ownerOfferAttested).toBe(true);
      expect(cachedJson.checkoutLocked).toBe(false);
      expect(cachedJson.checkoutUrl).toContain('source=web_whatsapp_preview');

      delete process.env.SITE_AUDIT_TERMS_ATTESTED;
      delete process.env.RAZORPAY_TEST_KEY_ID;
      delete process.env.RAZORPAY_TEST_KEY_SECRET;

      // 4. Verify per-IP daily cap and global daily cap return HTTP 429 when enforced
      process.env.ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST = 'true';
      process.env.PUBLIC_SCAN_IP_DAILY_CAP = '2';
      process.env.PUBLIC_SCAN_GLOBAL_DAILY_CAP = '5';
      try {
        db.prepare(`DELETE FROM durable_rate_limits`).run();
        const r1 = await app.request('/api/v1/public/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
          body: JSON.stringify({ url: 'https://cached-owner-site.example', confirmAuthorized: true, source: 'web_open_graph' })
        });
        const r2 = await app.request('/api/v1/public/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
          body: JSON.stringify({ url: 'https://cached-owner-site.example', confirmAuthorized: true, source: 'web_robots_sitemap' })
        });
        const r3 = await app.request('/api/v1/public/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
          body: JSON.stringify({ url: 'https://cached-owner-site.example', confirmAuthorized: true, source: 'web_json_ld' })
        });
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(429);
        const r3Json = await r3.json() as any;
        expect(r3Json.code).toBe('IP_DAILY_RATE_LIMIT_EXCEEDED');
      } finally {
        delete process.env.ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST;
        delete process.env.PUBLIC_SCAN_IP_DAILY_CAP;
        delete process.env.PUBLIC_SCAN_GLOBAL_DAILY_CAP;
        clearPublicScanCacheForTesting();
        db.prepare(`DELETE FROM durable_events WHERE event_type IN (?, 'SITEFIX_FUNNEL_EVENT')`).run(
          PUBLIC_SCAN_CACHE_EVENT_TYPE
        );
      }
    });

    it('all 4 owner diagnostic pages render HTTP 200 with unique copy, WhatsApp cache notice, cold-start auto-retry, ₹499 CTA + fallback, and Firebase CORS', async () => {
      const routes: Array<{ path: string; source: string; mustContain: string[] }> = [
        {
          path: '/tools/whatsapp-link-preview-checker',
          source: 'web_whatsapp_preview',
          mustContain: [
            'WhatsApp Link Preview Checker',
            'cannot guarantee WhatsApp',
            'SITEFIX_AI_PACK_V1',
            '₹499',
            '/api/v1/public/scan',
            'attempt 2 of 2',
            'Razorpay Hosted Payment Link'
          ]
        },
        {
          path: '/tools/open-graph-checker',
          source: 'web_open_graph',
          mustContain: [
            'Open Graph &amp; Social Share Card Checker',
            'twitter:card',
            'SITEFIX_AI_PACK_V1',
            '₹499',
            '/api/v1/public/scan',
            'attempt 2 of 2'
          ]
        },
        {
          path: '/tools/robots-and-sitemap-validator',
          source: 'web_robots_sitemap',
          mustContain: [
            'Robots.txt &amp; Sitemap Validator',
            'noindex',
            'sitemap.xml',
            'SITEFIX_AI_PACK_V1',
            '₹499',
            '/api/v1/public/scan'
          ]
        },
        {
          path: '/tools/json-ld-tester',
          source: 'web_json_ld',
          mustContain: [
            'JSON-LD Structured Data Tester',
            'application/ld+json',
            'Organization',
            'WebSite',
            'Product',
            'SITEFIX_AI_PACK_V1',
            '₹499'
          ]
        }
      ];

      for (const rt of routes) {
        const res = await app.request(rt.path, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(rt.source);
        for (const snippet of rt.mustContain) {
          expect(html).toContain(snippet);
        }
      }

      // Verify exact Firebase Hosting origin is allowlisted via CORS (no wildcard)
      const corsRes = await app.request('/api/v1/public/scan', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://gen-lang-client-0916255372.web.app',
          'Access-Control-Request-Method': 'POST'
        }
      });
      expect(corsRes.headers.get('access-control-allow-origin')).toBe(
        'https://gen-lang-client-0916255372.web.app'
      );

      // Verify static HTML files were emitted to both Firebase Hosting dist and public/tools
      for (const slug of [
        'whatsapp-link-preview-checker',
        'open-graph-checker',
        'robots-and-sitemap-validator',
        'json-ld-tester'
      ]) {
        const distHtmlPath = path.join(REPO_ROOT, 'packages', 'frontend', 'dist', 'tools', slug, 'index.html');
        const publicHtmlPath = path.join(REPO_ROOT, 'public', 'tools', slug, 'index.html');
        expect(fs.existsSync(distHtmlPath)).toBe(true);
        expect(fs.existsSync(publicHtmlPath)).toBe(true);
        const staticHtml = fs.readFileSync(distHtmlPath, 'utf8');
        expect(staticHtml).toContain('https://ai-marketing-organization.onrender.com');
        expect(staticHtml).toContain('/api/v1/public/scan');
        expect(staticHtml).toContain('SITEFIX_AI_PACK_V1');
      }
    });
  });

  // =========================================================================
  // PASS 2.2 — FUNNEL WRITE OBSERVABILITY, DAILY-SALTED TRUSTED FINGERPRINTS
  //            & HONEST REPORTING WINDOW LABELING
  // =========================================================================
  describe('12. Pass 2.2: Funnel Write Observability & Honest Visitor/Window Labeling', () => {
    it('returns { persisted: false, storageStatus: WRITE_FAILED } on simulated DB/D1 failure and surfaces funnelWriteFailureCount + persistenceWarning on /api/v1/owner/today', async () => {
      const {
        recordSiteFixFunnelEvent,
        resetSiteFixFunnelWriteMetricsForTesting,
        getSiteFixFunnelWriteMetrics
      } = await import('../../src/tools/site-audit/sitefix-funnel-attribution.js');

      resetSiteFixFunnelWriteMetricsForTesting();
      const db = getDb();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const origPrepare = db.prepare.bind(db);
      const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        if (String(sql).includes('INSERT OR IGNORE INTO durable_events')) {
          throw new Error('SIMULATED_FUNNEL_DB_WRITE_OUTAGE');
        }
        return origPrepare(sql);
      }) as any);

      try {
        const result = await recordSiteFixFunnelEvent({
          stage: 'scan',
          source: 'web_whatsapp_preview',
          isProbe: false,
          url: 'https://failed-write-check.example',
          userAgent: 'Mozilla/5.0'
        });

        expect(result.persisted).toBe(false);
        expect(result.storageStatus).toBe('WRITE_FAILED');
        expect(result.error).toContain('SIMULATED_FUNNEL_DB_WRITE_OUTAGE');
        expect(warnSpy).toHaveBeenCalledWith(
          '[SiteFixFunnelAttribution] WRITE_FAILED',
          expect.stringContaining('SIMULATED_FUNNEL_DB_WRITE_OUTAGE')
        );
        expect(getSiteFixFunnelWriteMetrics().funnelWriteFailureCount).toBe(1);
      } finally {
        prepareSpy.mockRestore();
        warnSpy.mockRestore();
      }

      // Verify /api/v1/owner/today surfaces non-zero funnelWriteFailureCount & persistenceWarning
      const ownerSession = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const todayRes = await app.request('/api/v1/owner/today', {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
      });
      expect(todayRes.status).toBe(200);
      const todayJson = (await todayRes.json()) as any;
      const attr = todayJson.data?.sitefixFunnelAttribution;
      expect(attr).toBeDefined();
      expect(attr.funnelWriteFailureCount).toBeGreaterThanOrEqual(1);
      expect(typeof attr.persistenceWarning).toBe('string');
      expect(attr.persistenceWarning).toContain('funnel event write failure');

      // Also verify simulated remote D1 failure path returns WRITE_FAILED cleanly
      const prevNodeEnv = process.env.NODE_ENV;
      const prevVitest = process.env.VITEST;
      const { D1RevenueRepository } = await import('../../src/db/d1-revenue-repository.js');
      const d1Repo = D1RevenueRepository.getInstance();
      const cfgSpy = vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      const execSpy = vi
        .spyOn(d1Repo, 'executeWrite')
        .mockRejectedValue(new Error('SIMULATED_REMOTE_D1_WRITE_ERROR'));
      const warnSpy2 = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      try {
        const d1FailResult = await recordSiteFixFunnelEvent({
          stage: 'preview_open',
          source: 'cli',
          isProbe: false,
          url: 'https://d1-fail-check.example',
          userAgent: 'Mozilla/5.0'
        });
        expect(d1FailResult.persisted).toBe(false);
        expect(d1FailResult.storageStatus).toBe('WRITE_FAILED');
        expect(d1FailResult.error).toContain('SIMULATED_REMOTE_D1_WRITE_ERROR');
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        if (prevVitest !== undefined) process.env.VITEST = prevVitest;
        cfgSpy.mockRestore();
        execSpy.mockRestore();
        warnSpy2.mockRestore();
        resetSiteFixFunnelWriteMetricsForTesting();
      }
    });

    it('rotates daily-salted SHA-256 visitor fingerprints across UTC dates, prefers trusted req.ip over spoofable X-Forwarded-For, and exposes distinctVisitorFingerprints + LATEST_5000_EVENTS on /api/v1/owner/today', async () => {
      const {
        classifySiteFixProbe,
        extractTrustedVisitorIp,
        hashFunnelVisitorKey,
        recordSiteFixFunnelEvent,
        resetSiteFixFunnelWriteMetricsForTesting
      } = await import('../../src/tools/site-audit/sitefix-funnel-attribution.js');

      resetSiteFixFunnelWriteMetricsForTesting();
      const db = getDb();
      db.prepare(`DELETE FROM durable_events WHERE event_type = 'SITEFIX_FUNNEL_EVENT'`).run();

      // 1. Daily salt rotation: identical IP+UA yields different SHA-256 fingerprints on different UTC dates,
      //    and NEVER equals an unsalted sha256(ip|ua) hash
      const rawKey = '203.0.113.55|Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)';
      const unsalted = crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 16);
      const day1 = hashFunnelVisitorKey(rawKey, '2026-11-20');
      const day1Repeat = hashFunnelVisitorKey(rawKey, '2026-11-20');
      const day2 = hashFunnelVisitorKey(rawKey, '2026-11-21');
      expect(day1).toBeTruthy();
      expect(day1).toBe(day1Repeat);
      expect(day1).not.toBe(day2);
      expect(day1).not.toBe(unsalted);
      expect(day2).not.toBe(unsalted);

      // 2. Trusted IP extraction prefers framework-trusted req.ip over spoofable X-Forwarded-For headers
      const reqWithTrustedIpAndSpoofedXff = {
        ip: '203.0.113.77',
        headers: {
          'x-forwarded-for': '198.51.100.99, 198.51.100.88',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        }
      };
      const reqWithSameTrustedIpDifferentSpoof = {
        ip: '203.0.113.77',
        headers: {
          'x-forwarded-for': '192.0.2.250',
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
        }
      };
      expect(extractTrustedVisitorIp(reqWithTrustedIpAndSpoofedXff)).toBe('203.0.113.77');
      const p1 = classifySiteFixProbe(reqWithTrustedIpAndSpoofedXff, '2026-11-21');
      const p2 = classifySiteFixProbe(reqWithSameTrustedIpDifferentSpoof, '2026-11-21');
      expect(p1.visitorHash).toBe(p2.visitorHash);

      // 3. When behind reverse proxies without req.ip, trailing proxy hops are stripped and leftmost spoofed XFF is ignored
      const reqBehindProxy = {
        headers: {
          'x-forwarded-for': '198.51.100.1, 203.0.113.88, 10.0.0.12',
          'user-agent': 'Mozilla/5.0'
        }
      };
      expect(extractTrustedVisitorIp(reqBehindProxy)).toBe('203.0.113.88');

      // 4. Persisted funnel events appear under distinctVisitorFingerprints + LATEST_5000_EVENTS on /api/v1/owner/today
      const okWrite = await recordSiteFixFunnelEvent({
        stage: 'scan',
        source: 'web_open_graph',
        isProbe: false,
        url: 'https://window-label-check.example',
        userAgent: 'Mozilla/5.0',
        visitorHash: p1.visitorHash
      });
      expect(okWrite).toEqual({ persisted: true, storageStatus: 'PERSISTED_LOCAL' });

      const ownerSession = OwnerAuthService.getInstance().createSession('127.0.0.1');
      const todayRes = await app.request('/api/v1/owner/today', {
        headers: { Authorization: `Bearer ${ownerSession.token}` }
      });
      expect(todayRes.status).toBe(200);
      const todayJson = (await todayRes.json()) as any;
      const attr = todayJson.data?.sitefixFunnelAttribution;
      expect(attr).toBeDefined();
      expect(attr.reportingWindow).toBe('LATEST_5000_EVENTS');
      expect(attr.eventLimitReached).toBe(false);
      expect(attr.funnelWriteFailureCount).toBe(0);
      expect(attr.persistenceWarning).toBeNull();
      expect(attr.totals.distinctVisitorFingerprints).toBe(1);
      expect(attr.bySource.web_open_graph.distinctVisitorFingerprints).toBe(1);
      expect((attr.totals as any).uniqueVisitors).toBeUndefined();

      db.prepare(`DELETE FROM durable_events WHERE event_type = 'SITEFIX_FUNNEL_EVENT'`).run();
    });
  });
});
