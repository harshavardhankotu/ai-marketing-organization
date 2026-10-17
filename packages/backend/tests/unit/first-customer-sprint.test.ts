import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { ReplyDeskService, assessPublicSignal } from '../../src/revenue/reply-desk.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('First Real Customer Sprint — Commercial Feasibility & Measurement Integrity', () => {
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;
  const replyDesk = ReplyDeskService.getInstance();
  const proposalEngine = ProposalEngine.getInstance();

  const resetDb = () => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM reply_desk_query_runs`).run();
      db.prepare(`DELETE FROM reply_desk_drafts WHERE source_url LIKE '%test%'`).run();
      db.prepare(`DELETE FROM proposals WHERE prospect_id LIKE 'prospect_sprint_%'`).run();
      db.prepare(`DELETE FROM sales_pipeline WHERE prospect_id LIKE 'prospect_sprint_%'`).run();
      db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'prospect_sprint_%' OR id LIKE 'prospect_offer_%'`).run();
      db.prepare(`DELETE FROM customer_journeys WHERE customer_name LIKE '%Sprint%'`).run();
      db.prepare(`DELETE FROM leads WHERE full_name LIKE '%Sprint%'`).run();
      db.prepare(`DELETE FROM referrals WHERE landing_page = '/offer' AND source = 'direct_test'`).run();
    } catch {}
  };

  beforeEach(resetDb);
  afterEach(resetDb);

  describe('1. Revenue Funnel Measurement Integrity & 3 Dedicated Workflows', () => {
    it('guarantees zero unbacked revenue on marketing assets and unapproved stages', async () => {
      const res = await app.request('/api/v1/revenue/funnel', {
        method: 'GET',
        headers: {
          'x-organization-id': orgId
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.stages).toBeDefined();

      const stageMap = new Map(json.data.stages.map((s: any) => [s.stageKey, s]));

      // 1. Marketing / Discovered / Published assets must have STRICTLY ₹0 amountINR
      expect(stageMap.get('DISCOVERED')?.amountINR).toBe(0);
      expect(stageMap.get('QUALIFIED')?.amountINR).toBe(0);
      expect(stageMap.get('VERIFIED')?.amountINR).toBe(0);
      expect(stageMap.get('PUBLISHED')?.amountINR).toBe(0);
      expect(stageMap.get('VISITS')?.amountINR).toBe(0);
      expect(stageMap.get('OUTBOUND_CLICKS')?.amountINR).toBe(0);

      // 2. Proves the 3 dedicated workflows exist in response
      expect(json.data.directSalesWorkflow).toBeDefined();
      expect(json.data.directSalesWorkflow.name).toContain('Direct Sales');
      expect(json.data.directSalesWorkflow.targetNiche).toContain('Dental Clinics');
      expect(Array.isArray(json.data.directSalesWorkflow.stages)).toBe(true);

      expect(json.data.contentAudienceWorkflow).toBeDefined();
      expect(json.data.contentAudienceWorkflow.name).toContain('Content & Audience');
      expect(Array.isArray(json.data.contentAudienceWorkflow.stages)).toBe(true);

      expect(json.data.affiliateWorkflow).toBeDefined();
      expect(json.data.affiliateWorkflow.name).toContain('Affiliate');
      expect(Array.isArray(json.data.affiliateWorkflow.stages)).toBe(true);
    });

    it('derives DRAFTED and APPROVED pipeline amounts strictly from real proposals', async () => {
      const db = getDb();

      // Insert a real prospect with schema constraints satisfied
      db.prepare(`
        INSERT OR REPLACE INTO platform_prospects (
          id, business_name, prospect_business_name, vertical, prospect_vertical,
          city, prospect_city, status, fit_score, created_at, updated_at
        )
        VALUES (
          'prospect_sprint_01', 'SmileSprint Dental Care', 'SmileSprint Dental Care', 'dental', 'dental',
          'Hyderabad', 'Hyderabad', 'QUALIFIED', 0.85, datetime('now'), datetime('now')
        )
      `).run();

      // Create a commercial proposal
      const proposal = proposalEngine.createProposal({
        organizationId: orgId,
        businessId: bizId,
        prospectId: 'prospect_sprint_01',
        title: 'SmileSprint Dental Care — 24/7 WhatsApp Lead Triage',
        customerProblem: 'Clinic loses after-hours implant inquiries when doctors are treating patients.',
        proposedSolution: 'Automated 2-minute WhatsApp triage bot with FAQ resolution and calendar booking.',
        deliverables: ['Custom WhatsApp bot', 'Google Business Profile integration', 'Calendar booking link'],
        timelineDays: 5,
        setupPriceINR: 15000,
        monthlyPriceINR: 8000,
        paymentTerms: '100% setup fee before launch with 14-day performance guarantee.',
        scopeBoundary: 'Covers WhatsApp and GBP lead triage.',
        nextStep: 'Approve proposal and create payment link.'
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.setupPriceINR).toBe(15000);

      // Set to DRAFT to test AWAITING_APPROVAL stage
      db.prepare(`UPDATE proposals SET status = 'DRAFT' WHERE id = ?`).run(proposal.id);

      const resAfterDraft = await app.request('/api/v1/revenue/funnel', {
        headers: { 'x-organization-id': orgId }
      });
      const jsonAfterDraft = await resAfterDraft.json() as any;
      const stageMapDraft = new Map(jsonAfterDraft.data.stages.map((s: any) => [s.stageKey, s]));

      // DRAFTED and AWAITING_APPROVAL now reflect the real proposal setup amount
      expect(stageMapDraft.get('DRAFTED')?.amountINR).toBeGreaterThanOrEqual(15000);
      expect(stageMapDraft.get('AWAITING_APPROVAL')?.amountINR).toBeGreaterThanOrEqual(15000);

      // Now accept the proposal
      proposalEngine.acceptProposal(proposal.id);

      const resAfterAccept = await app.request('/api/v1/revenue/funnel', {
        headers: { 'x-organization-id': orgId }
      });
      const jsonAfterAccept = await resAfterAccept.json() as any;
      const stageMapAccept = new Map(jsonAfterAccept.data.stages.map((s: any) => [s.stageKey, s]));

      // APPROVED now reflects the accepted proposal amount
      expect(stageMapAccept.get('APPROVED')?.amountINR).toBeGreaterThanOrEqual(15000);
    });
  });

  describe('2. Reply Desk Intent Sourcing & Directory Filtering', () => {
    it('assesses public signals and filters aggregator directories and listicles', () => {
      // 1. Directory URL rejected
      const practoSignal = assessPublicSignal(
        'Best Dentist in Hyderabad - Top 10 Clinics',
        'Find verified dental clinics and read reviews',
        'https://practo.com/hyderabad/dentists'
      );
      expect(practoSignal.qualified).toBe(false);
      expect(practoSignal.intentClass).toBe('JUNK');
      expect(practoSignal.reason).toContain('Aggregator or directory');

      // 2. Listicle title rejected
      const listicleSignal = assessPublicSignal(
        'Top 10 Dental Clinics in Bangalore for Dental Implants',
        'Compare prices and features of various dental clinics',
        'https://blog.healthguide.in/top-10-dental-clinics'
      );
      expect(listicleSignal.qualified).toBe(false);
      expect(listicleSignal.intentClass).toBe('JUNK');
      expect(listicleSignal.reason).toContain('Directory listicle');

      // 3. Genuine inquiry classified as HIGH_INTENT
      const genuineSignal = assessPublicSignal(
        'How do dental clinics handle missed calls outside clinic hours in India?',
        'We get 10-15 inquiries every evening after 8 PM on WhatsApp booking but patients go cold before morning receptionist responds.',
        'https://dentistry-forum.in/questions/after-hours-inquiries-7749'
      );
      expect(genuineSignal.qualified).toBe(true);
      expect(genuineSignal.intentClass).toBe('HIGH_INTENT');
      expect(genuineSignal.reason).toContain('High intent');
    });

    it('records query run telemetry and stores structured drafts for qualified signals', async () => {
      const today = '2026-10-17';
      const mockSearch = async (query: string) => [
        {
          title: 'Practo Dental Clinic Directory',
          snippet: 'Find doctors in your city',
          url: 'https://practo.com/hyderabad/directory',
          date: today
        },
        {
          title: 'Clinic asking about automated WhatsApp response & missed calls',
          snippet: 'Looking for after hours triage tool that answers patient FAQs and schedules bookings automatically',
          url: `https://dental-community.org/inquiry-test-${Date.now()}`,
          date: today
        }
      ];

      const res = await replyDesk.discoverAndDraftReplies(today, mockSearch);
      expect(res.queriesRun).toBeGreaterThan(0);

      // Verify query run telemetry recorded in DB
      const db = getDb();
      const runs = db.prepare(`SELECT * FROM reply_desk_query_runs WHERE run_date = ?`).all(today) as any[];
      expect(runs.length).toBeGreaterThan(0);
      expect(runs[0].provider).toBe('TAVILY');
      expect(runs[0].success).toBe(1);
      expect(runs[0].result_count).toBe(2);
      expect(typeof runs[0].execution_time_ms).toBe('number');

      // Verify only qualified signal was drafted (Practo directory was rejected)
      const drafts = replyDesk.getRecentDrafts(5);
      expect(drafts.length).toBeGreaterThan(0);

      const draftedUrls = drafts.map(d => d.sourceUrl);
      expect(draftedUrls.some(u => u.includes('practo.com'))).toBe(false);
      expect(draftedUrls.some(u => u.includes('dental-community.org'))).toBe(true);

      const dentalDraft = drafts.find(d => d.sourceUrl.includes('dental-community.org'));
      expect(dentalDraft?.status).toBe('DRAFT');
      expect(dentalDraft?.draftAnswer).toContain('automated WhatsApp qualification bot');
    });
  });

  describe('3. Offer Landing Page & Inquiry Intake Integration', () => {
    it('renders interactive lead intake form on GET /offer when unattested', async () => {
      const res = await app.request('/offer');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Form elements present
      expect(html).toContain('Request Lead Triage Demonstration');
      expect(html).toContain('id="lead-inquiry-form"');
      expect(html).toContain('id="cust-name"');
      expect(html).toContain('id="cust-phone"');
      expect(html).toContain('id="cust-service"');
      expect(html).toContain('/api/v1/offer/inquiry');
      expect(html).toContain('/api/v1/referrals/beacon');
    });

    it('records inquiry from offer page via POST /api/v1/offer/inquiry into sales pipeline', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Sprint Kumar',
          customerPhone: '9876543210',
          customerEmail: 'sprint.kumar@dentalcare.in',
          serviceOfInterest: 'Sprint Multispeciality Dental, Bengaluru',
          notes: 'Losing 20+ weekend patient inquiries on WhatsApp. Need 24/7 automated FAQ triage.',
          source: 'offer_page_inquiry',
          channel: 'WHATSAPP'
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.journeyId).toBeDefined();

      // Verify persisted in database
      const db = getDb();
      const journey = db.prepare(`SELECT * FROM customer_journeys WHERE id = ?`).get(json.journeyId) as any;
      expect(journey).toBeDefined();
      expect(journey.customer_name).toBe('Dr. Sprint Kumar');
      expect(journey.first_touch_channel).toBe('WHATSAPP');
      expect(journey.touchpoints_json).toContain('offer_page_inquiry');

      const pipeline = db.prepare(`SELECT * FROM sales_pipeline WHERE journey_id = ?`).get(json.journeyId) as any;
      expect(pipeline).toBeDefined();
      expect(pipeline.stage).toBe('LEAD');
    });
  });
});
