import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import app from '../../src/index.js';
import { EXACT_ROUTE_POLICY } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { B2BPilotService } from '../../src/revenue/b2b-pilot-service.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { CommercialSchedulePolicy } from '../../src/automation/commercial-schedule-policy.js';
import { GrowthExperimentTracker } from '../../src/commission/growth-experiment-tracker.js';
import { AutonomousSystemDoctor } from '../../src/automation/autonomous-system-doctor.js';
import { batchLookupProspectsByName } from '../../src/revenue/outreach-prospect-lookup.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('PR #97: Coherent Storefront, /demo, Security Hardening, D1 Read Containment & .agents/', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    B2BPilotService.resetInstance();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. Cohesive Public Storefront, /demo, /offer & Legal Hygiene', () => {
    it('serves focused AI Buying Assistant storefront on GET / with upfront #Affiliate disclosure, OG/JSON-LD, and compact mobile nav', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('AI Buying Assistant');
      expect(html).toContain('#Affiliate');
      expect(html).toContain('property="og:title"');
      expect(html).toContain('application/ld+json');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/refund"');
      expect(html).toContain('href="/contact"');

      // Primary nav must exclude legacy B2B/SiteFix/tools routes
      const navMatch = html.match(/<nav class="top-nav"[\s\S]*?<\/nav>/);
      expect(navMatch).not.toBeNull();
      const navHtml = navMatch![0];
      expect(navHtml).toContain('href="/"');
      expect(navHtml).toContain('href="/deals"');
      expect(navHtml).toContain('href="/contact"');
      expect(navHtml).not.toContain('/tools/site-audit');
      expect(navHtml).not.toContain('/demo');
      expect(navHtml).not.toContain('/offer');

      // Must never leak internal paths, clinic copy, or "not an offer to contract"
      expect(html).not.toMatch(/not an offer to contract|DIRECT_OFFER\.md|OWN_OFFER\.md|Apex Dental|Dr\. Rajesh Sharma/i);
    });

    it('registers /demo in EXACT_ROUTE_POLICY.PUBLIC and marks legacy /offer SSR as noindex', async () => {
      expect(EXACT_ROUTE_POLICY.PUBLIC).toContain('/demo');

      const offerRes = await app.request('/offer');
      expect(offerRes.status).toBe(200);
      const offerHtml = await offerRes.text();
      expect(offerHtml).toContain('<nav class="top-nav"');
      expect(offerHtml).toContain('noindex');
      expect(offerHtml).toContain('property="og:title"');
      expect(offerHtml).toContain('application/ld+json');
      expect(offerHtml).toContain('href="/terms"');
      expect(offerHtml).toContain('href="/privacy"');
      expect(offerHtml).toContain('href="/refund"');
      expect(offerHtml).toContain('href="/contact"');
      expect(offerHtml).not.toMatch(/not an offer to contract|DIRECT_OFFER\.md|OWN_OFFER\.md/i);
    });

    it('ships PublicDemoPage.tsx, clean PublicOfferPage.tsx, clean PublicComparisonPage.tsx, and grouped Sidebar.tsx', () => {
      const demoPath = path.join(REPO_ROOT, 'packages/frontend/src/pages/PublicDemoPage.tsx');
      const offerPath = path.join(REPO_ROOT, 'packages/frontend/src/pages/PublicOfferPage.tsx');
      const compPath = path.join(REPO_ROOT, 'packages/frontend/src/pages/PublicComparisonPage.tsx');
      const sidebarPath = path.join(REPO_ROOT, 'packages/frontend/src/components/layout/Sidebar.tsx');
      const indexHtmlPath = path.join(REPO_ROOT, 'packages/frontend/index.html');

      const demoSrc = fs.readFileSync(demoPath, 'utf8');
      expect(demoSrc).toContain('SAMPLE DEMO');
      expect(demoSrc).toContain('wa.me');
      expect(demoSrc).toContain('Demo Scheduled');

      const offerSrc = fs.readFileSync(offerPath, 'utf8');
      expect(offerSrc).not.toMatch(/Dr\. Rajesh Sharma|Apex Dental|clinicName|practiceName|patient/i);
      expect(offerSrc).toContain('/refund');

      const compSrc = fs.readFileSync(compPath, 'utf8');
      expect(compSrc).not.toContain('href="/tools/site-audit"');

      const sidebarSrc = fs.readFileSync(sidebarPath, 'utf8');
      expect(sidebarSrc).toContain("title: 'Business'");
      expect(sidebarSrc).toContain("title: 'Customers'");
      expect(sidebarSrc).toContain("title: 'Marketing'");
      expect(sidebarSrc).toContain("title: 'System'");
      expect(sidebarSrc).toContain('Advanced');
      expect(sidebarSrc).toContain('80-Agent Directory');

      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      expect(indexHtml).not.toContain('href="https://ai-marketing-organization.onrender.com/deals"');
    });

    it('adds <meta name="description"> and <link rel="canonical"> to B2BPilotService HTML pages', () => {
      const service = B2BPilotService.getInstance();
      const baseProposal: any = {
        proposalId: 'b2b_meta_1',
        targetUrl: 'https://institute.example.in',
        businessName: 'Test Institute',
        packageId: 'WEBSITE_ENQUIRY_CONVERSION_SETUP',
        packageName: 'Website & Admissions Enquiry Conversion Setup',
        scannedAt: new Date().toISOString(),
        status: 'OWNER_APPROVED',
        approvalStatus: 'OWNER_APPROVED',
        ownerApproved: true,
        priceINR: 1999,
        approvedPriceINR: 1999,
        scopeNotes: null,
        approvedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        checkoutUrl: 'https://ai-marketing-organization.onrender.com/b2b/checkout/b2b_meta_1',
        contactEmail: null,
        verifiedFindings: []
      };

      const propHtml = service.renderProposalHtml(baseProposal);
      expect(propHtml).toContain('<meta name="description"');
      expect(propHtml).toContain('<link rel="canonical"');

      const checkoutHtml = service.renderB2BCheckoutHtml(baseProposal);
      expect(checkoutHtml).toContain('<meta name="description"');
      expect(checkoutHtml).toContain('<link rel="canonical"');
    });
  });

  describe('2. Security Hardening (Cookies, CSRF, CSP, OAuth postMessage, B2B Pilot Limits, Hooks)', () => {
    it('hardens CSP (no unsafe-eval, object-src none, base-uri self, Report-Only strict script-src)', async () => {
      const res = await app.request('/');
      const csp = res.headers.get('content-security-policy') || '';
      const cspRo = res.headers.get('content-security-policy-report-only') || '';

      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain('https://checkout.razorpay.com');

      const roScriptSrc = cspRo.split(';').find(d => d.trim().startsWith('script-src')) || '';
      expect(roScriptSrc).toContain("script-src 'self' https://checkout.razorpay.com https://*.razorpay.com");
      expect(roScriptSrc).not.toContain("'unsafe-inline'");
      expect(roScriptSrc).not.toContain("'unsafe-eval'");
    });

    it('uses SameSite=Lax on same-origin HTTPS login and SameSite=None; Secure; Partitioned for iframe/cross-origin', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'pr97_owner_secret_key_for_cookie_tests';

      const sameOriginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': 'ai-marketing-organization.onrender.com',
          'Origin': 'https://ai-marketing-organization.onrender.com',
          'x-forwarded-proto': 'https'
        },
        body: JSON.stringify({ apiKey: process.env.OWNER_API_KEY })
      });
      expect(sameOriginRes.status).toBe(200);
      const sameCookie = sameOriginRes.headers.get('set-cookie') || '';
      expect(sameCookie).toContain('SameSite=Lax');
      expect(sameCookie).toContain('HttpOnly');
      expect(sameCookie).toContain('Secure');
      expect(sameCookie).not.toContain('SameSite=None');

      const iframeRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': 'ai-marketing-organization.onrender.com',
          'Origin': 'https://ai-marketing-organization.onrender.com',
          'x-forwarded-proto': 'https',
          'sec-fetch-dest': 'iframe'
        },
        body: JSON.stringify({ apiKey: process.env.OWNER_API_KEY })
      });
      expect(iframeRes.status).toBe(200);
      const iframeCookie = iframeRes.headers.get('set-cookie') || '';
      expect(iframeCookie).toContain('SameSite=None');
      expect(iframeCookie).toContain('Partitioned');
    });

    it('enforces CSRF Origin/Referer checks on /auth/owner/logout and non-public mutating methods (PUT/DELETE)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'pr97_owner_secret_key_for_csrf_tests';
      const session = OwnerAuthService.getInstance().createSession('127.0.0.1');

      const badLogout = await app.request('/api/v1/auth/owner/logout', {
        method: 'POST',
        headers: {
          'Origin': 'https://evil-attacker.example',
          'Cookie': `owner_session=${session.token}`
        }
      });
      expect(badLogout.status).toBe(403);

      const badPut = await app.request('/api/v1/business', {
        method: 'PUT',
        headers: {
          'Referer': 'https://evil-attacker.example/csrf.html',
          'Cookie': `owner_session=${session.token}`
        }
      });
      expect(badPut.status).toBe(403);
    });

    it('requires authorizedToScan === true and rate-limits /api/v1/b2b/pilot-proposal', async () => {
      vi.spyOn(SiteAuditScanner.prototype, 'scanUrl').mockResolvedValue({
        auditId: 'aud_pr97',
        url: 'https://institute-pr97.in',
        domain: 'institute-pr97.in',
        scannedAt: new Date().toISOString(),
        overallStatus: 'NEEDS_IMPROVEMENT',
        score: 70,
        scoreExplanation: 'Mock',
        metrics: { httpStatus: 200, responseTimeMs: 50, htmlSizeBytes: 500, contentType: 'text/html', redirectChain: [], hasRobotsTxt: true, hasSitemap: true, jsonLdTypesFound: [], contactChannelsFound: [] },
        findings: [],
        preview: { title: 'Test', metaDescription: 'Test', canonicalUrl: 'https://institute-pr97.in', ogTitle: '', ogImage: '', fixPackSnippetPreview: '' },
        disclosures: { notFullCrawl: true, noRankGuarantee: true, noWebVitalsClaim: true },
        rawHtml: '<html><body><h1>Test</h1></body></html>'
      });

      const missingAuthPost = await app.request('/api/v1/b2b/pilot-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://institute-pr97.in', businessName: 'Test' })
      });
      expect(missingAuthPost.status).toBe(400);
      const errJson = await missingAuthPost.json() as any;
      expect(errJson.error).toBe('AUTHORIZATION_ATTESTATION_REQUIRED');

      const missingAuthGet = await app.request('/api/v1/b2b/pilot-proposal?url=https://institute-pr97.in&format=json');
      expect(missingAuthGet.status).toBe(400);
    });

    it('removes wildcard postMessage and enforces exact origin/source checks in Instagram OAuth', () => {
      const apiSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages/backend/src/routes/api.ts'), 'utf8');
      expect(apiSrc).not.toContain("window.opener.postMessage(${messagePayload},'*')");

      const fsccSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'packages/frontend/src/components/dashboard/FirstSaleCommandCenter.tsx'),
        'utf8'
      );
      expect(fsccSrc).toContain('event.source !== oauthPopupRef.current');
      expect(fsccSrc).toContain('window.open(');
      expect(fsccSrc).not.toContain("!origin.endsWith('.onrender.com')");
      expect(fsccSrc).not.toContain("!origin.endsWith('.run.app')");
    });

    it('fails CLOSED in protect-and-sanitize.cjs on malformed JSON and blocks rzp-key.csv / edit_file', () => {
      const hookPath = path.join(REPO_ROOT, '.agents/scripts/protect-and-sanitize.cjs');
      const malformed = spawnSync(process.execPath, [hookPath], {
        input: '{bad-json',
        encoding: 'utf8'
      });
      expect(malformed.status).toBe(0);
      expect(JSON.parse(malformed.stdout.trim()).decision).toBe('deny');

      const empty = spawnSync(process.execPath, [hookPath], {
        input: '',
        encoding: 'utf8'
      });
      expect(empty.status).toBe(0);
      expect(JSON.parse(empty.stdout.trim()).decision).toBe('deny');

      const rzpEdit = spawnSync(process.execPath, [hookPath], {
        input: JSON.stringify({
          toolCall: {
            name: 'edit_file',
            args: { Path: 'rzp-key.csv' }
          }
        }),
        encoding: 'utf8'
      });
      expect(JSON.parse(rzpEdit.stdout.trim()).decision).toBe('deny');
    });
  });

  describe('3. D1 Read Containment, Schedule Alignment & Zero Migration Drift', () => {
    it('preserves D1 baseline at migration 0050 with zero new .sql files', () => {
      const migDir = path.join(REPO_ROOT, 'packages/backend/src/db/d1-migrations');
      const sqlFiles = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
      expect(sqlFiles[sqlFiles.length - 1]).toMatch(/^0050_/);
    });

    it('eliminates direct_outreach_log LEFT JOIN platform_prospects OR queries and uses bounded batch lookup', async () => {
      const filesToCheck = [
        'packages/backend/src/automation/autonomous-system-doctor.ts',
        'packages/backend/src/automation/automation-registry-engine.ts',
        'packages/backend/src/revenue/owner-digest.ts',
        'packages/backend/src/routes/api.ts'
      ];
      for (const rel of filesToCheck) {
        const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        expect(src).not.toMatch(/LEFT JOIN platform_prospects\s+p\s+ON\s+d\.prospect_name\s*=\s*p\.prospect_business_name\s+OR/i);
      }

      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO platform_prospects (
          id, business_name, prospect_business_name,
          phone, email, city, prospect_city, prospect_vertical, stage, status, created_at, updated_at
        ) VALUES (
          'pros_pr97_batch_1', 'PR97 Batch Academy', 'PR97 Batch Academy',
          '9849098490', 'batch@pr97.in', 'Hyderabad', 'Hyderabad', 'tuition',
          'DISCOVERED', 'NEW', datetime('now'), datetime('now')
        )
      `).run();

      const map = await batchLookupProspectsByName(['PR97 Batch Academy'], {
        useRemoteD1: false,
        d1Repo: D1RevenueRepository.getInstance(),
        db
      });
      const matched = map.get('pr97 batch academy');
      expect(matched).toBeDefined();
      expect(matched?.email).toBe('batch@pr97.in');
    });

    it('rewrites GrowthExperimentTracker.hydrateFromDb to bounded PK range scan and aligns CommercialSchedulePolicy to twice-daily IST buckets', async () => {
      const trackerSrc = fs.readFileSync(
        path.join(REPO_ROOT, 'packages/backend/src/commission/growth-experiment-tracker.ts'),
        'utf8'
      );
      expect(trackerSrc).toContain("id >= 'wf_gexp_'");
      expect(trackerSrc).toContain('LIMIT 100');

      const tracker = GrowthExperimentTracker.getInstance();
      const count = await tracker.hydrateFromDb('org_owner_primary', { force: true });
      expect(count).toBeGreaterThanOrEqual(0);

      // Verify twice-daily idempotency buckets (0900 and 2100) and bounded cron catch-up list <= 5
      const morning = new Date('2026-11-25T03:30:00.000Z'); // 09:00 IST
      const afternoon = new Date('2026-11-25T08:30:00.000Z'); // 14:00 IST
      const evening = new Date('2026-11-25T15:30:00.000Z'); // 21:00 IST

      expect(CommercialSchedulePolicy.getIdempotencyKey('affiliate_offer_reconciliation', morning)).toContain('_0900_');
      expect(CommercialSchedulePolicy.getIdempotencyKey('affiliate_offer_reconciliation', afternoon)).toContain('_0900_');
      expect(CommercialSchedulePolicy.getIdempotencyKey('affiliate_offer_reconciliation', evening)).toContain('_2100_');
      expect(CommercialSchedulePolicy.getCronCatchupWorkflowIds(morning).length).toBeLessThanOrEqual(5);
      expect(CommercialSchedulePolicy.getCronCatchupWorkflowIds(evening).length).toBeLessThanOrEqual(5);

      const doctorRes = await AutonomousSystemDoctor.getInstance().repairOutreachChannelsAndQualifyTargets(undefined, { force: true });
      expect(doctorRes).toBeDefined();
    });
  });

  describe('4. .agents/ Subagents, Workflows & Schedule Hygiene', () => {
    it('ships all 5 read-only auditor subagents, public-site-qa workflow, on-demand Amazon skill, and fixed daily-owner-status.json', () => {
      const subagents = [
        'product-ux-auditor.md',
        'security-auditor.md',
        'reliability-d1-auditor.md',
        'commercial-revenue-auditor.md',
        'independent-verifier.md'
      ];
      for (const file of subagents) {
        const p = path.join(REPO_ROOT, '.agents/agents', file);
        expect(fs.existsSync(p)).toBe(true);
        const content = fs.readFileSync(p, 'utf8');
        expect(content).toContain('Read-Only Constraints');
        expect(content).toContain('PASS');
      }

      const qaWorkflow = path.join(REPO_ROOT, '.agents/workflows/public-site-qa.md');
      expect(fs.existsSync(qaWorkflow)).toBe(true);
      expect(fs.readFileSync(qaWorkflow, 'utf8')).toContain('run_workflow');

      const amzSkill = path.join(REPO_ROOT, '.agents/skills/amazon-associates-compliance/SKILL.md');
      expect(fs.existsSync(amzSkill)).toBe(true);

      const schedJson = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, '.agents/scheduled/daily-owner-status.json'), 'utf8')
      );
      expect(JSON.stringify(schedJson)).toContain('/api/v1/owner/status');
      expect(JSON.stringify(schedJson)).toContain('/api/v1/owner/today');
      expect(JSON.stringify(schedJson)).toContain('curl.exe -m 30');
    });
  });
});
