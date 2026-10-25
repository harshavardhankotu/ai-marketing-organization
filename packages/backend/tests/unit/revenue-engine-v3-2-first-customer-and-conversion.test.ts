/**
 * Revenue Engine V3.2 Test Suite — First Customer, Real Payments & Commercial Conversion
 *
 * Verifies:
 * 1. Autonomous Commercial Engine:
 *    - Task prioritization: Due tasks execute before candidate discovery.
 *    - Checkpoint retention & unstarvation across cycles.
 *    - Native Render hosting unblocked (no MISSING_DEPLOYMENT_CREDENTIALS blocker).
 *    - Real referral tracking link creation & redirect verification in VERIFYING lifecycle.
 * 2. Cuelinks Sync Manager:
 *    - Empirical scope verification across operational endpoints when /ping omits scopes array.
 *    - 403 Forbidden correctly captured in forbiddenScopes and blocks hasRequiredScopes.
 * 3. Public Storefront & Offer Page (GET / and GET /offer):
 *    - Public homepage (GET /) serves B2B AI Inbound Lead Triage storefront.
 *    - Displays specific problem (8 PM - 8 AM dark hours, GBP chat shutdown).
 *    - Displays defined deliverables (24/7 WhatsApp triage, top 10 quick replies, calendar booking, tracking sheet).
 *    - Interactive demonstration with sample data explicitly labelled (SAMPLE DATA ONLY — INBOUND PATIENT TRIAGE PREVIEW).
 *    - Transparent commercial terms (starting from ₹15,000 pilot fee; 100% free client-owned tools).
 *    - Contact / enquiry form with DPDP Act 2023 consent and honeypot trap.
 *    - Segregated consumer affiliate links to /deals, /guides, and /revenue.
 *    - GET /deals serves standalone verified deals directory.
 * 4. Researched Indian Healthcare & Dental SMB Prospects Batch:
 *    - 10 real, deduplicated Indian healthcare practices persisted across D1/SQLite tables.
 *    - Personalized outreach drafts persisted in direct_outreach_log with human_approved = 0 and dispatched = 0.
 * 5. Owner Review Queue (/owner/today & OwnerDigestService):
 *    - Surfaces pending outreach drafts with strict human gate intact.
 *    - Provides one-click WhatsApp and Email review links.
 * 6. Proposal Checkout & Payment Truth (/proposals/:id/checkout):
 *    - Renders approved deliverables, Method A Razorpay link generator, and Method B UPI QR.
 *    - Submitting UTR logs PAYMENT_CLAIMED with ₹0.00 cash recognized until owner confirmation.
 * 7. Transparent Revenue Funnel & Cost Accounting:
 *    - /api/v1/public/revenue-funnel and /revenue expose B2B funnel, ₹0 operating costs, and net contribution.
 *    - Bank cash strictly ₹0.00 until bank statement reconciliation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { CuelinksSyncManager, CUELINKS_REQUIRED_SCOPES } from '../../src/commission/cuelinks-sync-manager.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { ReferralTrackingEngine } from '../../src/commission/referral-tracking.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';

describe('Revenue Engine V3.2 — First Customer & Commercial Conversion', () => {
  beforeEach(async () => {
    seedDatabase();
    process.env.PUBLIC_SITE_NAME = 'AI Marketing Organization';
    process.env.PUBLIC_SITE_URL = 'https://ai-marketing-organization.onrender.com';
    delete process.env.OWN_OFFER_CONFIRMED;
    delete process.env.DIRECT_OFFER_TERMS_SHA256;
  });

  describe('1. Autonomous Commercial Engine Execution & Task Prioritization', () => {
    it('executes due tasks first and does not starve them with candidate discovery', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      
      // Inject a due commercial task at READY stage
      const dueTask = engine.createCommercialTask({
        network: 'CUELINKS',
        domain: 'travel',
        targetKeyword: 'Student flight discounts India 2026',
        targetAudience: 'Indian students traveling for university admissions'
      });
      await engine.persistTask(dueTask);

      expect(dueTask.status).toBe('READY');

      // Run cycle with due tasks present
      const cycleResult = await engine.runCycle();
      expect(cycleResult.tasksDue).toBeGreaterThanOrEqual(1);
      expect(cycleResult.tasksProcessed).toBeGreaterThanOrEqual(1);

      // Verify task progressed to at least EXECUTING, VALIDATING, DEPLOYING, VERIFYING, or COMPLETED
      const updatedTask = await engine.getCommercialTask(dueTask.id);
      expect(updatedTask).toBeDefined();
      expect(['EXECUTING', 'VALIDATING', 'DEPLOYING', 'VERIFYING', 'COMPLETED']).toContain(updatedTask!.status);
      expect(updatedTask!.checkpoint).toBeDefined();
    });

    it('unblocks native Render guide deployment without requiring Firebase credentials', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      delete process.env.FIREBASE_SERVICE_ACCOUNT;

      const task = engine.createCommercialTask({
        network: 'CUELINKS',
        domain: 'travel',
        targetKeyword: 'Air India student baggage discount',
        targetAudience: 'Indian domestic and international flight passengers'
      });

      // Force task to DEPLOYING stage with drafted content
      task.status = 'DEPLOYING';
      task.stage = 'DEPLOYING';
      task.checkpoint = 'DEPLOYING';
      task.outputs.guideSlug = 'student-flight-discounts-india';
      task.outputs.draftArticle = '<h1>Complete Guide to Student Airfares</h1><p>Verified baggage allowances.</p>';

      await engine.executeDeployingStep(task);

      // Must succeed natively on Render and advance to VERIFYING
      expect(task.status).toBe('VERIFYING');
      expect(task.errorInfo?.blockerType).toBeUndefined();
      expect(task.outputs.deployedUrl).toContain('/guides/');
    });

    it('creates real referral tracking links and verifies HTTP redirect resolution in VERIFYING', async () => {
      const engine = AutonomousCommercialEngine.getInstance();
      
      const task = engine.createCommercialTask({
        network: 'CUELINKS',
        domain: 'travel',
        targetKeyword: 'Akasa Air domestic student fares',
        targetAudience: 'Domestic student travelers'
      });

      task.status = 'VERIFYING';
      task.stage = 'VERIFYING';
      task.checkpoint = 'VERIFYING';
      task.outputs.publicUrl = 'https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india';

      await engine.executeVerifyingStep(task);

      expect(task.status).toBe('COMPLETED');
      expect(task.outputs.trackingVerified).toBe(true);
      expect(task.outputs.outcomeAchieved).toBe(true);
      expect(task.outputs.verifiedTrackingUrl).toBeDefined();
      expect(task.outputs.verifiedTrackingUrl).toMatch(/\/r\/.+\/ref_/);
    });
  });

  describe('2. Cuelinks Scope Interpretation & Verification', () => {
    it('empirically verifies scopes across successful provider endpoint calls when /ping omits scopes array', async () => {
      const syncManager = CuelinksSyncManager.getInstance();

      // Simulate a ping response with null/omitted scopes array
      const rawStatus = {
        connected: true,
        channelId: 331585,
        channelStatus: 'approved',
        hasScopes: false,
        scopes: [] as string[]
      };

      // Before empirical verification, hasRequiredScopes is false
      const unverified = syncManager.verifyNetworkScopes(rawStatus);
      expect(unverified.hasRequiredScopes).toBe(false);

      // Now record successful operational calls for the required scopes
      for (const scope of CUELINKS_REQUIRED_SCOPES) {
        syncManager.recordScopeSuccess(scope);
      }

      // After successful operations, empirical verification confirms scopes
      const verified = syncManager.verifyNetworkScopes(rawStatus);
      expect(verified.hasRequiredScopes).toBe(true);
      expect(verified.isEmpiricallyVerified).toBe(true);
      expect(verified.missingScopes).toHaveLength(0);
    });

    it('captures 403 Forbidden on restricted endpoints and marks scope forbidden', () => {
      const syncManager = CuelinksSyncManager.getInstance();
      syncManager.recordScopeForbidden('write:links', 'HTTP 403 Forbidden: Publisher channel does not have link shortening authorization');

      const status = syncManager.verifyNetworkScopes({
        connected: true,
        channelId: 331585,
        channelStatus: 'approved',
        hasScopes: false,
        scopes: []
      });

      expect(status.hasRequiredScopes).toBe(false);
      expect(status.forbiddenScopes).toContain('write:links');
      expect(status.scopeErrorReason).toContain('HTTP 403');
    });
  });

  describe('3. Public Storefront & Offer Page (GET / and GET /offer)', () => {
    it('serves B2B AI Inbound Lead Triage storefront on GET /', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Positioning & Headline
      expect(html).toContain('Never Lose Another Evening Patient Inquiry');
      expect(html).toContain('AI Inbound Lead Conversion System');

      // Problem description
      expect(html).toContain('8 PM to 8 AM Inquiry Gap');
      expect(html).toContain('Competitor Leakage');

      // Defined Deliverables
      expect(html).toContain('24/7 WhatsApp Instant Away Triage');
      expect(html).toContain('Top 10 Practice Quick Replies');
      expect(html).toContain('Direct Calendar Appointment Booking');
      expect(html).toContain('Shared Real-Time Inquiry Tracking Sheet');

      // Interactive Demonstration with Sample Data Explicitly Labelled
      expect(html).toContain('Interactive Demonstration: Inbound Patient Triage');
      expect(html).toContain('SAMPLE DATA ONLY — INBOUND PATIENT TRIAGE PREVIEW');
      expect(html).toContain('Apex Dental Triage Assistant');

      // Transparent Commercial Terms
      expect(html).toContain('Introductory Pilot Implementation');
      expect(html).toContain('Zero Mandatory Third-Party SaaS Fees');

      // DPDP Enquiry Form
      expect(html).toContain('id="lead-inquiry-form-home"');
      expect(html).toContain('cust-consent-h');
      expect(html).toContain('name="website_trap"');

      // Segregated Consumer Deals and Travel Guide links
      expect(html).toContain('href="/deals"');
      expect(html).toContain('href="/guides/student-flight-discounts-india"');
      expect(html).toContain('href="/revenue"');

      // Statutory Affiliate Disclosure
      expect(html).toContain('Statutory Affiliate Disclosure:');
    });

    it('serves standalone verified deals page on GET /deals without SPA login redirect', async () => {
      const res = await app.request('/deals');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Verified Deals');
      expect(html).toContain('price-card');
      expect(html).not.toContain('Sign In to Owner Portal');
    });

    it('serves safe overview on GET /offer with sample data labelled preview and zero unconfirmed prices', async () => {
      const res = await app.request('/offer');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Configuration Pending Owner Attestation');
      expect(html).toContain('noindex, nofollow');
      expect(html).toContain('SAMPLE DATA ONLY — INBOUND PATIENT TRIAGE PREVIEW');
      expect(html).toContain('Scope of Technical Deliverables');
      expect(html).toContain('href="/deals"');
    });

    it('processes inbound lead inquiry through POST /api/v1/offer/inquiry and returns DPDP deletion code', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Ramesh Sharma',
          customerPhone: '9849198491',
          customerEmail: 'ramesh@careplusdental.com',
          serviceOfInterest: 'CarePlus Dental, Hyderabad',
          notes: 'High patient inquiry volume after 8 PM; need automated WhatsApp triage.',
          consentGiven: true,
          source: 'homepage_b2b_inquiry',
          channel: 'WHATSAPP'
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.deletionCode).toBeDefined();
      expect(json.deletionCode).toMatch(/^del_/);

      // Verify persisted in platform_prospects
      const db = getDb();
      const row = db.prepare(`SELECT * FROM platform_prospects WHERE email = 'ramesh@careplusdental.com'`).get() as any;
      expect(row).toBeDefined();
      expect(row.phone).toContain('9849198491');
    });

    it('rejects bot submissions that fill the honeypot website_trap field', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Spam Bot',
          customerPhone: '9849198491',
          serviceOfInterest: 'Spam Practice',
          website_trap: 'http://spam-link.ru',
          consentGiven: true
        })
      });

      // Honeypot silently discards bot submission with 200 generic message so bots are not alerted
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);

      // Verify NO spam lead was saved to platform_prospects
      const db = getDb();
      const spamLead = db.prepare(`SELECT * FROM platform_prospects WHERE prospect_owner_name = 'Spam Bot'`).get();
      expect(spamLead).toBeUndefined();
    });
  });

  describe('4. Researched Indian Healthcare SMB Prospects Batch', () => {
    it('persists curated batch of 10 genuine Indian healthcare practices with complete attribution', async () => {
      const engine = PlatformProspectDiscoveryEngine.getInstance();
      await engine.ensureCuratedQualifiedProspectBatch();

      const db = getDb();
      const prospects = db.prepare(`SELECT * FROM platform_prospects WHERE prospect_vertical = 'dental' AND is_test = 0 AND website_url IS NOT NULL`).all() as any[];
      expect(prospects.length).toBeGreaterThanOrEqual(10);

      const names = prospects.map(p => p.business_name || p.prospect_business_name);
      expect(names).toContain('Partha Dental Skin Hair Clinic');
      expect(names).toContain('FMS Dental Hospitals');
      expect(names).toContain("Dr. Gowd's Dental Hospitals");
      expect(names).toContain('The Dental Specialists');
      expect(names).toContain('Clove Dental Clinic & Implant Center');
      expect(names).toContain('Apex Dental Care & Implant Centre');

      // Verify each prospect has verified evidence JSON with source URLs
      for (const p of prospects) {
        expect(p.website_url).toMatch(/^https?:\/\//);
        expect(p.discovery_evidence_json).toBeDefined();
        const ev = JSON.parse(p.discovery_evidence_json);
        expect(ev.evidenceSourceUrl).toMatch(/^https?:\/\//);
        expect(ev.observedGap).toBeDefined();
      }
    });

    it('creates personalized outreach drafts in direct_outreach_log behind human approval gate (human_approved = 0)', async () => {
      const engine = PlatformProspectDiscoveryEngine.getInstance();
      await engine.ensureCuratedQualifiedProspectBatch();

      const db = getDb();
      const drafts = db.prepare(`SELECT * FROM direct_outreach_log WHERE segment = 'HEALTHCARE_DENTAL_SMB'`).all() as any[];
      expect(drafts.length).toBeGreaterThanOrEqual(10);

      for (const d of drafts) {
        expect(d.human_approved).toBe(0); // STRICT GATE
        expect(d.dispatched).toBe(0); // NEVER auto-sent
        expect(d.compliance_checked).toBe(1);
        expect(d.message_draft).toContain('24/7 WhatsApp Lead Triage system');
        expect(d.message_draft).toContain('https://ai-marketing-organization.onrender.com/#interactive-demo');
      }
    });

    it('is deduplicated across multiple runs without creating duplicate records', async () => {
      const engine = PlatformProspectDiscoveryEngine.getInstance();
      const firstRun = await engine.ensureCuratedQualifiedProspectBatch();
      const secondRun = await engine.ensureCuratedQualifiedProspectBatch();
      expect(secondRun).toHaveLength(0); // Deduplicated, skips already-existing
    });
  });

  describe('5. Owner Review Queue (/owner/today & OwnerDigestService)', () => {
    it('surfaces pending outreach drafts with one-click WhatsApp and Email review links', async () => {
      const engine = PlatformProspectDiscoveryEngine.getInstance();
      await engine.ensureCuratedQualifiedProspectBatch();

      const digest = await OwnerDigestService.getInstance().generateDigestAsync();
      expect(digest.pendingOutreachDrafts.length).toBeGreaterThanOrEqual(10);

      const firstDraft = digest.pendingOutreachDrafts[0];
      expect(firstDraft.humanApproved).toBe(false);
      expect(firstDraft.dispatched).toBe(false);
      expect(firstDraft.oneClickWhatsAppUrl).toMatch(/^https:\/\/wa\.me\//);
      expect(firstDraft.oneClickEmailUrl).toMatch(/^mailto:\?subject=/);

      // Verify HTML dashboard rendering
      const html = OwnerDigestService.getInstance().renderHtml(digest);
      expect(html).toContain('Researched Prospects &amp; Outreach Drafts Awaiting Owner Approval');
      expect(html).toContain('STRICT HUMAN GATE: ZERO AUTO DISPATCH');
      expect(html).toContain('Review &amp; Send via WhatsApp');
      expect(html).toContain('Review &amp; Send via Email');
    });

    it('serves rich HTML dashboard on GET /owner/today for browser inspection', async () => {
      const res = await app.request('/owner/today', {
        headers: { 'Accept': 'text/html' }
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Daily Owner Digest &amp; Control Dashboard');
      expect(html).toContain('Researched Prospects &amp; Outreach Drafts Awaiting Owner Approval');
    });
  });

  describe('6. Proposal Checkout & Payment Truth (/proposals/:id/checkout)', () => {
    it('creates commercial proposal and serves checkout page with Method A and Method B', async () => {
      const pe = ProposalEngine.getInstance();
      const proposal = await pe.createProposalAsync({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        prospectId: 'ppros_partha_dental',
        title: 'AI Inbound Lead Triage Implementation for Partha Dental',
        customerProblem: 'Evening inquiries outside clinic hours (8 PM - 8 AM) wait 14 hours for response.',
        proposedSolution: '24/7 AI-driven WhatsApp away triage, Top 10 treatment quick replies, and Google Calendar integration.',
        deliverables: [
          '24/7 WhatsApp Away Triage Integration',
          'Top 10 Treatment & Consultation Quick Replies',
          'Direct Google Calendar Consultation Link',
          'Real-time Shared Google Sheets Inquiry Tracker',
          '14-Day Performance Handover & Receptionist Training'
        ],
        setupPriceINR: 15000,
        monthlyPriceINR: 8000,
        timelineDays: 5
      });

      expect(proposal.id).toBeDefined();

      const res = await app.request(`/proposals/${proposal.id}/checkout`);
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('Approved Proposal Checkout');
      expect(html).toContain('AI Inbound Lead Triage Implementation for Partha Dental');
      expect(html).toContain('₹15,000');
      expect(html).toContain('Method A — Razorpay Payment Link');
      expect(html).toContain('Method B — Scan &amp; Pay via UPI QR');
      expect(html).toContain('Report Paid UPI Transaction (UTR)');
    });

    it('strict payment truth: submitting UTR registers PAYMENT_CLAIMED with ₹0.00 cash recognized until bank verification', async () => {
      const db = getDb();
      const testUtr = '429188' + String(Date.now()).slice(-6);

      const pe = ProposalEngine.getInstance();
      const prop = await pe.createProposalAsync({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        prospectId: 'ppros_partha_dental',
        title: 'AI Inbound Lead Triage Implementation for Partha Dental',
        customerProblem: 'Evening inquiries outside clinic hours (8 PM - 8 AM) wait 14 hours for response.',
        proposedSolution: '24/7 AI-driven WhatsApp away triage, Top 10 treatment quick replies, and Google Calendar integration.',
        deliverables: [
          '24/7 WhatsApp Away Triage Integration',
          'Top 10 Treatment & Consultation Quick Replies'
        ],
        setupPriceINR: 15000,
        monthlyPriceINR: 8000,
        timelineDays: 5
      });

      const claimRes = await app.request('/api/v1/payments/manual-upi/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          proposalId: prop.id,
          payerName: 'Dr. Rajesh Sharma',
          payerPhone: '9849123456',
          amountINR: 15000,
          utr: testUtr,
          serviceRendered: 'AI Inbound Lead Triage Setup'
        })
      });

      expect(claimRes.status).toBe(201);
      const claimJson = await claimRes.json() as any;
      expect(claimJson.status).toBe('PAYMENT_CLAIMED');

      // Verify that NO revenue record was created as verified cash
      const revRecord = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id = ?`).get(testUtr) as any;
      expect(revRecord).toBeUndefined();

      // Check revenue funnel endpoint: bank cash must remain strictly ₹0.00
      const funnelRes = await app.request('/api/v1/public/revenue-funnel');
      const funnelJson = await funnelRes.json() as any;
      expect(funnelJson.data.funnel.bankCashReceivedINR).toBe(0.00);
      expect(funnelJson.data.profitability.bankCashReceivedINR).toBe(0.00);
    });
  });

  describe('7. Revenue Funnel & Transparent Operating Costs', () => {
    it('/api/v1/public/revenue-funnel returns B2B funnel, ₹0 operating costs, and net contribution', async () => {
      const res = await app.request('/api/v1/public/revenue-funnel');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);

      // B2B Funnel instrumentation
      expect(json.data.b2bFunnel).toBeDefined();
      expect(typeof json.data.b2bFunnel.prospectsResearched).toBe('number');
      expect(typeof json.data.b2bFunnel.inquiriesReceived).toBe('number');
      expect(typeof json.data.b2bFunnel.outreachDraftsPrepared).toBe('number');
      expect(typeof json.data.b2bFunnel.proposalsSent).toBe('number');
      expect(typeof json.data.b2bFunnel.verifiedClientPaymentsINR).toBe('number');

      // Operating Costs instrumentation (₹0 outflow rule)
      expect(json.data.operatingCosts).toBeDefined();
      expect(json.data.operatingCosts.hostingCostINR).toBe(0.00);
      expect(json.data.operatingCosts.databaseCostINR).toBe(0.00);
      expect(json.data.operatingCosts.aiModelCostINR).toBe(0.00);
      expect(json.data.operatingCosts.paidToolCostINR).toBe(0.00);
      expect(json.data.operatingCosts.totalOperatingCostINR).toBe(0.00);

      // Profitability accounting
      expect(json.data.profitability).toBeDefined();
      expect(json.data.profitability.laborExclusionNote).toContain('Owner engineering and commercial operations labor is excluded');
    });

    it('/revenue renders B2B conversion funnel, operating cost breakdown, and partner table', async () => {
      const res = await app.request('/revenue');
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('Public Commercial Funnel');
      expect(html).toContain('Direct B2B Lead Conversion Funnel');
      expect(html).toContain('Researched Prospects');
      expect(html).toContain('Inbound Inquiries');
      expect(html).toContain('Operating Costs &amp; Cash Profitability');
      expect(html).toContain('Hosting (Render)');
      expect(html).toContain('Database (Cloudflare D1)');
      expect(html).toContain('AI Inference (Gemini)');
      expect(html).toContain('Akasa Air');
      expect(html).toContain('Air India Express');
    });
  });
});
