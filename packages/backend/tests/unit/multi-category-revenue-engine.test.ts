import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { ProductOpportunityPipeline } from '../../src/commission/product-opportunity-pipeline.js';
import { ShareKitService } from '../../src/commission/share-kit-service.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { resolveAffiliateAdapter, PARTNER_OFFICIAL_SIGNUP_DIRECTORY } from '../../src/commission/affiliate-adapters.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import app from '../../src/index.js';

const ORG = 'org_owner_primary';

describe('Multi-Category Revenue Engine Suite (Real Money Only)', () => {
  beforeEach(async () => {
    resetDbForTesting();
    seedDatabase();
    ProductOpportunityPipeline.resetInstanceForTesting();
    ShareKitService.resetInstanceForTesting();
  });

  afterEach(() => {
    delete process.env.AMAZON_AFFILIATE_TAG;
  });

  describe('1. Multi-Category Product Opportunity Pipeline', () => {
    it('evaluates categories without inventing fake revenue or probabilities', async () => {
      const pipeline = ProductOpportunityPipeline.getInstance();
      const db = getDb();

      // Seed 4 buyer question signals for Electronics & Accessories
      for (let i = 1; i <= 4; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, evidence_snippet, source_url, signal_type,
            urgency, estimated_monthly_volume, status, created_at
          ) VALUES (?, ?, 'Electronics & Accessories', ?, ?, 'spec evidence', 'https://techenclave.com/community/audio', 'BUYER_QUESTION', 0.8, 150, 'DISCOVERED', datetime('now'))
        `).run(`sig_elec_${i}`, ORG, `best wireless microphone vs lavalier ${i}`, `which wireless mic is best for interview ${i}`);
      }

      // Seed 2 buyer questions for Home & Kitchen (less than threshold of 3)
      for (let i = 1; i <= 2; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, evidence_snippet, source_url, signal_type,
            urgency, estimated_monthly_volume, status, created_at
          ) VALUES (?, ?, 'Home & Kitchen', ?, ?, 'spec evidence', 'https://techenclave.com/community/coffee', 'BUYER_QUESTION', 0.7, 80, 'DISCOVERED', datetime('now'))
        `).run(`sig_home_${i}`, ORG, `coffee grinder conical burr ${i}`, `best coffee grinder for espresso ${i}`);
      }

      // Seed 3 buyer questions for a prohibited category (medical / skincare)
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, category, topic, raw_query, evidence_snippet, source_url, signal_type,
            urgency, estimated_monthly_volume, status, created_at
          ) VALUES (?, ?, 'Skincare & Supplements', ?, ?, 'spec evidence', 'https://techenclave.com/community/health', 'BUYER_QUESTION', 0.9, 500, 'DISCOVERED', datetime('now'))
        `).run(`sig_med_${i}`, ORG, `best vitamin supplement ${i}`, `collagen supplement dosage ${i}`);
      }

      const report = await pipeline.evaluateOpportunities(ORG);

      expect(report.totalCategoriesEvaluated).toBeGreaterThanOrEqual(3);
      expect(report.provenance).toBe('OBSERVED');

      // Prohibited category must be BLOCKED_POLICY at stage 2
      const skinRanking = report.categories.find(c => c.category === 'Skincare & Supplements');
      expect(skinRanking).toBeDefined();
      expect(skinRanking!.status).toBe('BLOCKED_POLICY');
      expect(skinRanking!.stageReached).toBe(2);
      expect(skinRanking!.readinessScore).toBe(0);

      // Category with < 3 signals must be NEEDS_MORE_SIGNALS at stage 3
      const homeRanking = report.categories.find(c => c.category === 'Home & Kitchen');
      expect(homeRanking).toBeDefined();
      expect(homeRanking!.status).toBe('NEEDS_MORE_SIGNALS');
      expect(homeRanking!.stageReached).toBe(3);
      expect(homeRanking!.demandSignalCount).toBe(2);

      // Category with >= 3 signals and comparison keywords reaches stage 10
      const elecRanking = report.categories.find(c => c.category === 'Electronics & Accessories');
      expect(elecRanking).toBeDefined();
      expect(elecRanking!.status).toBe('READY_FOR_PROPOSAL');
      expect(elecRanking!.stageReached).toBe(10);
      expect(elecRanking!.readinessScore).toBeGreaterThanOrEqual(60);
      expect(elecRanking!.eligibleNetworks).toContain('AMAZON_ASSOCIATES');
      expect(elecRanking!.eligibleNetworks).toContain('ADMITAD');
    });
  });

  describe('2. Legitimate Affiliate Network Adapters & Directory', () => {
    it('supports Admitad and includes verified official network details', () => {
      const adapter = resolveAffiliateAdapter('https://ad.admitad.com/g/12345/?subid=test1');
      expect(adapter.network).toBe('ADMITAD');
      expect(adapter.hasAttribution(new URL('https://ad.admitad.com/g/12345/?subid=test1'))).toBe(true);

      // Verify official signup directory contains India-relevant networks
      expect(PARTNER_OFFICIAL_SIGNUP_DIRECTORY['AMAZON_ASSOCIATES']).toBeDefined();
      expect(PARTNER_OFFICIAL_SIGNUP_DIRECTORY['CUELINKS']).toBeDefined();
      expect(PARTNER_OFFICIAL_SIGNUP_DIRECTORY['ADMITAD']).toBeDefined();
      expect(PARTNER_OFFICIAL_SIGNUP_DIRECTORY['EARNKARO']).toBeDefined();
      expect(PARTNER_OFFICIAL_SIGNUP_DIRECTORY['VCOMMISSION']).toBeDefined();
    });
  });

  describe('3. Dynamic Acquisition Loop & Multi-Category Share Kit', () => {
    it('dynamically generates human-ready sharing text from guide facts, not hardcoded printer text', async () => {
      const db = getDb();
      const kit = ShareKitService.getInstance();

      // Seed a published guide in Audio / Electronics
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category,
          intent_target, content_markdown, status, created_at, updated_at
        ) VALUES (
          'guide_audio_01', ?, 'best-wireless-microphones-india', 'GUIDE',
          'Best Wireless Microphones for Creators in India', 'Audio Gear',
          'content creators', '# Wireless Mic Guide', 'PUBLISHED',
          datetime('now'), datetime('now')
        )
      `).run(ORG);

      const result = await kit.generateWeeklyShareKit(ORG);
      expect(result.active).toBe(true);
      expect(result.drafts.length).toBeGreaterThan(0);

      for (const draft of result.drafts) {
        expect(draft.guideUrl).toContain('/guides/best-wireless-microphones-india');
        expect(draft.draftAnswer).toContain(draft.guideUrl);
        // Dynamic title / category used
        expect(draft.questionText).toMatch(/Audio Gear|Wireless Microphones/i);
        // Zero Amazon links or tags
        expect(draft.draftAnswer).not.toContain('amazon.');
        expect(draft.draftAnswer).not.toContain('tag=');
        // No hardcoded thermal printer text
        expect(draft.draftAnswer).not.toContain('thermal printer');
        expect(draft.draftAnswer).not.toContain('203 DPI');
      }
    });
  });

  describe('4. Truthful NBA Revenue Economics', () => {
    it('NextBestActionEngine does not emit fabricated expected revenues or probabilities', () => {
      const engine = NextBestActionEngine.getInstance();
      const db = getDb();

      // Seed an active partner
      db.prepare(`
        INSERT OR REPLACE INTO partners (
          id, organization_id, name, industry, website, partner_type,
          approval_status, active_status, authorization_status, created_at, updated_at
        ) VALUES (
          'part_amz_test', ?, 'Amazon India Test', 'Ecommerce', 'https://amazon.in', 'AFFILIATE',
          'APPROVED', 1, 'AUTHORIZED', datetime('now'), datetime('now')
        )
      `).run(ORG);

      // Seed 0 active offers -> DISCOVER_OFFER candidate emitted
      const nextAction = engine.choose('biz_platform_aro', ORG);

      // NBA action should have 0 expected revenue, 0 probability, and score reflecting priority
      expect(nextAction.actionType).toBe('DISCOVER_OFFER');
      expect(nextAction.expectedRevenueINR).toBe(0);
      expect(nextAction.estimatedRevenueINR).toBe(0);
      expect(nextAction.probabilityOfSuccess).toBe(0);
      expect(nextAction.expectedValueINR).toBe(0);
      expect(nextAction.score).toBe(950);
    });
  });

  describe('5. Truthful 15-Stage Affiliate Funnel Endpoint', () => {
    it('GET /api/v1/commission/funnel returns 15 stages with explicit provenance and identifies top bottleneck', async () => {
      const res = await app.request('/api/v1/commission/funnel', {
        headers: {
          'x-organization-id': ORG
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.stages).toHaveLength(15);
      expect(json.data.reportingPeriod).toBe('ALL_TIME');
      expect(json.data.lastUpdatedAt).toBeDefined();

      const stages = json.data.stages;
      // All 15 stages present in sequential funnel order
      expect(stages[0].stageKey).toBe('DEMAND_SIGNALS_DISCOVERED');
      expect(stages[1].stageKey).toBe('BUYER_QUESTIONS_VALIDATED');
      expect(stages[2].stageKey).toBe('OPPORTUNITIES_EVALUATED');
      expect(stages[3].stageKey).toBe('APPROVED_PARTNERS');
      expect(stages[4].stageKey).toBe('ACTIVE_OFFERS');
      expect(stages[5].stageKey).toBe('DRAFT_GUIDES');
      expect(stages[6].stageKey).toBe('PUBLISH_READY_GUIDES');
      expect(stages[7].stageKey).toBe('OWNER_INTAKE_ATTESTED');
      expect(stages[8].stageKey).toBe('PUBLISHED_GUIDES');
      expect(stages[9].stageKey).toBe('GUIDE_VISITS');
      expect(stages[10].stageKey).toBe('OUTBOUND_CLICKS');
      expect(stages[11].stageKey).toBe('REPORTED_ORDERS');
      expect(stages[12].stageKey).toBe('PENDING_COMMISSIONS');
      expect(stages[13].stageKey).toBe('APPROVED_COMMISSIONS');
      expect(stages[14].stageKey).toBe('VERIFIED_PAYMENTS');

      // Verify provenances
      for (const st of stages) {
        expect(['OBSERVED', 'OWNER_CONFIRMED', 'UNKNOWN', 'ASSUMPTION']).toContain(st.provenance);
        expect(typeof st.count).toBe('number');
      }

      // Top bottleneck is identified
      expect(json.data.activeTopBlocker).toBeDefined();
      expect(json.data.activeTopBlocker.stageIndex).toBeGreaterThanOrEqual(1);
    });
  });
});
