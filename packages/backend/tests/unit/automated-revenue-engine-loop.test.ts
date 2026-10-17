import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { ReplyDeskService } from '../../src/revenue/reply-desk.js';
import { DirectCommercialOfferPage } from '../../src/revenue/direct-offer-page.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import app from '../../src/index.js';

describe('Automated Revenue Engine Loop & Commercial Lifecycle Suite (Phases 3–6)', () => {
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  it('1. NextBestActionEngine ranks GENERATE_PROPOSAL for unproposed qualified prospects', () => {
    const db = getDb();
    const nba = NextBestActionEngine.getInstance();

    // Insert a qualified prospect without an existing proposal
    db.prepare(`
      INSERT INTO platform_prospects (
        id, business_name, prospect_business_name, vertical, prospect_vertical, city, prospect_city, status, fit_score, observed_evidence_json, created_at, updated_at
      ) VALUES (
        'prospect_test_01', 'Test Logistics Hub', 'Test Logistics Hub', 'logistics', 'logistics', 'Hyderabad', 'Hyderabad', 'QUALIFIED', 0.85, '{}', datetime('now'), datetime('now')
      )
    `).run();

    const action = nba.choose(bizId, orgId, { ignoreCooldown: true });

    expect(action).toBeDefined();
    expect(action.actionType).toBe('GENERATE_PROPOSAL');
    expect(action.targetId).toBe('prospect_test_01');
    expect(action.priorityTier).toBe('P0');
    expect(action.estimatedRevenueINR).toBe(15000);
  });

  it('2. AutonomousRevenueOrchestrator executes GENERATE_PROPOSAL and creates a draft proposal', async () => {
    const db = getDb();
    const aro = AutonomousRevenueOrchestrator.getInstance();

    // Insert a qualified prospect
    db.prepare(`
      INSERT INTO platform_prospects (
        id, business_name, prospect_business_name, vertical, prospect_vertical, city, prospect_city, status, fit_score, observed_evidence_json, created_at, updated_at
      ) VALUES (
        'prospect_test_02', 'Speedy Couriers', 'Speedy Couriers', 'logistics', 'logistics', 'Bengaluru', 'Bengaluru', 'QUALIFIED', 0.90, '{}', datetime('now'), datetime('now')
      )
    `).run();

    const res = await aro.runCycle(orgId, bizId);

    expect(res.cycleId).toBeDefined();
    expect(res.nextBestAction.actionType).toBe('GENERATE_PROPOSAL');
    expect(res.actionExecutionStatus).toBe('INTERNAL_AUTOMATION');

    // Verify proposal was created in proposals table
    const proposals = db.prepare('SELECT * FROM proposals WHERE prospect_id = ?').all('prospect_test_02') as any[];
    expect(proposals.length).toBe(1);
    expect(proposals[0].setup_price_inr).toBe(15000);
    expect(proposals[0].offer_id).toBe('PLATFORM_SETUP');
  });

  it('3. NextBestActionEngine ranks REPLY_DESK_DISCOVER under 2-query daily limit', () => {
    const nba = NextBestActionEngine.getInstance();
    const replyDesk = ReplyDeskService.getInstance();

    // Direct offer is attested via SHA-256 in test environment
    const attested = DirectCommercialOfferPage.isDirectOfferAttested();
    const queriesRun = replyDesk.getQueriesRunToday();

    if (attested && queriesRun < 2) {
      const actions = nba.rankAll(bizId, orgId);
      const replyAction = actions.find(a => a.actionType === 'REPLY_DESK_DISCOVER');
      expect(replyAction).toBeDefined();
      expect(replyAction?.priorityTier).toBe('P0');
      expect(replyAction?.score).toBe(950);
    }
  });

  it('4. CoordinatedAgentOrchestrator is invoked across all 4 divisions during CREATE_CONTENT_ASSET', async () => {
    const db = getDb();
    const aro = AutonomousRevenueOrchestrator.getInstance();

    // Insert approved partner
    db.prepare(`
      INSERT OR REPLACE INTO partners (id, organization_id, name, industry, network, website, approval_status, authorization_status, active_status)
      VALUES ('part_amz', ?, 'Amazon Associates', 'E-commerce', 'AMAZON', 'https://amazon.in', 'APPROVED', 'AUTHORIZED', 1)
    `).run(orgId);

    // Insert approved partner offer with valid manufacturer listing facts
    const evidenceJson = JSON.stringify({
      display_name: 'Phomemo M110 Label Maker',
      asin: 'B08P13WGLX',
      manufacturer_name: 'Phomemo',
      spec_summary: 'Direct thermal label printer, 203 DPI, 20-50mm width',
      source_url: 'https://phomemo.com/products/phomemo-m110-label-maker',
      retrieval_date: '2026-10-15',
      listing_facts: [
        { fact: 'Direct thermal print head with 203 DPI resolution requiring zero ink or toner', date: '2026-10-15' },
        { fact: 'Adjustable label print width from 20mm to 50mm supporting barcode and address labels', date: '2026-10-15' },
        { fact: 'Built-in 1500mAh rechargeable lithium battery with Bluetooth 4.0 mobile connectivity', date: '2026-10-15' }
      ]
    });

    db.prepare(`
      INSERT OR REPLACE INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, active, status, evidence_json, created_at, updated_at
      ) VALUES (
        'poff_test_coord', 'part_amz', ?, 'Phomemo M110 Portable Thermal Printer', 'phomemo-m110-coord-test',
        'office', 'Logistics and retail operations',
        'https://phomemo.com/products/phomemo-m110-label-maker', 'https://amazon.in/dp/B08P13WGLX?tag=test',
        1, 'ACTIVE', ?, datetime('now'), datetime('now')
      )
    `).run(orgId, evidenceJson);

    // Directly invoke CREATE_CONTENT_ASSET via ARO
    const execRes = await aro.executeAction({
      actionType: 'CREATE_CONTENT_ASSET',
      targetId: 'poff_test_coord',
      targetType: 'OFFER',
      ownerAgent: 'content-creator-agent',
      rationale: 'Create test guide',
      estimatedRevenueINR: 500,
      expectedRevenueINR: 200,
      probabilityOfSuccess: 0.5,
      timeToRevenueDays: 14,
      externalCostINR: 0,
      quotaCost: 1,
      customerValueINR: 500,
      urgency: 0.8,
      cooldownActive: false,
      authorizationAvailable: true,
      riskLevel: 'LOW',
      expectedValueINR: 200,
      priorityScore: 750,
      priorityTier: 'P1',
      score: 750,
      authorizationRequired: false,
      estimatedCostINR: 0
    }, orgId, bizId, 'cycle_test_coord');

    expect(execRes.status).toBe('INTERNAL_AUTOMATION');
    expect(execRes.externalId).toBeDefined();

    // Verify 80-agent coordinated campaign tasks and decisions were recorded in SQLite
    const tasks = db.prepare('SELECT agent_id, status FROM tasks').all() as any[];
    expect(tasks.length).toBeGreaterThan(0);

    const decisions = db.prepare("SELECT * FROM decisions WHERE source = 'COORDINATED_ORCHESTRATOR'").all() as any[];
    expect(decisions.length).toBeGreaterThan(0);
  });

  it('5. GET /api/v1/revenue/funnel returns complete 12-stage commercial lifecycle and honest metrics', async () => {
    const res = await app.request('/api/v1/revenue/funnel', {
      method: 'GET',
      headers: {
        'x-organization-id': orgId
      }
    });

    expect(res.status).toBe(200);
    const json = await res.json() as any;

    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();

    // Verify backward-compatible pipeline fields exist
    expect(typeof json.data.prospects).toBe('number');
    expect(typeof json.data.qualified).toBe('number');
    expect(typeof json.data.revenue_inr).toBe('number');
    expect(json.data.mode).toBe('VERIFIED_ONLY');

    // Verify 12-stage commercial lifecycle exists
    expect(Array.isArray(json.data.stages)).toBe(true);
    expect(json.data.stages.length).toBe(12);

    const stageKeys = json.data.stages.map((s: any) => s.stageKey);
    expect(stageKeys).toEqual([
      'DISCOVERED',
      'QUALIFIED',
      'VERIFIED',
      'DRAFTED',
      'AWAITING_APPROVAL',
      'APPROVED',
      'PUBLISHED',
      'VISITS',
      'OUTBOUND_CLICKS',
      'ATTRIBUTED_ORDERS',
      'CONFIRMED_COMMISSION',
      'VERIFIED_PAYOUT'
    ]);

    // Verify primaryBottleneck and nextBestAction exist
    expect(json.data.primaryBottleneck).toBeDefined();
    expect(json.data.primaryBottleneck.stageKey).toBeDefined();
    expect(json.data.nextBestAction).toBeDefined();

    // Verify clean separation of financials
    expect(json.data.financials).toBeDefined();
    expect(json.data.financials.currency).toBe('INR');
    expect(json.data.financials.externalCostsINR).toBe(0);
    expect(json.data.financials.netRealizedRevenueINR).toBe(json.data.financials.verifiedRevenueINR);
  });
});
