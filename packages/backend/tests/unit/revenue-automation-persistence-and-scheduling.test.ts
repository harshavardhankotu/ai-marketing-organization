import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplyDeskService } from '../../src/revenue/reply-desk.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { validateSiteIdentityFacts, resolveSiteIdentity } from '../../src/config/owner-env-intake.js';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';

describe('Mission Automation: Discovery Persistence, Scheduling Parity & Identity Defaults', () => {
  const db = getDb();
  const d1Repo = D1RevenueRepository.getInstance();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    try {
      db.prepare(`DELETE FROM reply_desk_query_runs`).run();
      db.prepare(`DELETE FROM reply_desk_drafts`).run();
      db.prepare(`DELETE FROM partner_offers WHERE organization_id LIKE 'org_test_%' OR id LIKE 'test_%'`).run();
      db.prepare(`DELETE FROM partners WHERE organization_id LIKE 'org_test_%' OR id LIKE 'test_%'`).run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      db.prepare(`DELETE FROM reply_desk_query_runs`).run();
      db.prepare(`DELETE FROM reply_desk_drafts`).run();
      db.prepare(`DELETE FROM partner_offers WHERE organization_id LIKE 'org_test_%' OR id LIKE 'test_%'`).run();
      db.prepare(`DELETE FROM partners WHERE organization_id LIKE 'org_test_%' OR id LIKE 'test_%'`).run();
    } catch {}
    vi.restoreAllMocks();
  });

  it('1. ReplyDeskService persists query runs and drafts to Cloudflare D1 in production', async () => {
    process.env.NODE_ENV = 'production';
    const replyDesk = ReplyDeskService.getInstance();

    const writes: Array<{ table: string; sql: string; params: any[] }> = [];
    vi.spyOn(d1Repo, 'executeWrite').mockImplementation(async (table, sql, params) => {
      writes.push({ table, sql, params });
      return { rowsAffected: 1, source: 'CLOUDFLARE_D1' };
    });

    const mockSearch = async () => [
      {
        title: 'Need help with missed patient calls in dental clinic whatsapp India',
        snippet: 'How can our dental clinic avoid inquiry delay and handle missed calls on whatsapp outside hours?',
        url: 'https://test_mission_forum.in/q/12345',
        date: '2026-10-19'
      }
    ];

    const result = await replyDesk.discoverAndDraftReplies('2026-10-19', mockSearch);

    expect(result.queriesRun).toBeGreaterThan(0);
    expect(result.newDraftsCount).toBeGreaterThanOrEqual(1);

    // Verify D1 executeWrite was called for reply_desk_query_runs
    const queryRunWrites = writes.filter(w => w.table === 'reply_desk_query_runs');
    expect(queryRunWrites.length).toBeGreaterThan(0);
    expect(queryRunWrites[0].sql).toContain("'TAVILY'");
    expect(queryRunWrites[0].params[1]).toContain('dental clinic');
    expect(queryRunWrites[0].params[2]).toBe('2026-10-19');

    // Verify D1 executeWrite was called for reply_desk_drafts with is_test = 0
    const draftWrites = writes.filter(w => w.table === 'reply_desk_drafts');
    expect(draftWrites.length).toBeGreaterThanOrEqual(1);
    expect(draftWrites[0].params[1]).toContain('test_mission_forum.in');
    expect(draftWrites[0].sql).toContain('is_test');
  });

  it('2. ReplyDeskService syncs query runs from D1 to SQLite on wake', async () => {
    process.env.NODE_ENV = 'production';
    const replyDesk = ReplyDeskService.getInstance();

    const mockD1Runs = [
      {
        id: 'run_test_mission_sync_1',
        query: 'test_mission sync query 1',
        run_date: '2026-10-19',
        provider: 'TAVILY',
        execution_time_ms: 120,
        success: 1,
        result_count: 2,
        error_message: null,
        created_at: '2026-10-19T02:00:00Z'
      }
    ];

    vi.spyOn(d1Repo, 'query').mockImplementation(async (table) => {
      if (table === 'reply_desk_query_runs') {
        return mockD1Runs;
      }
      return [];
    });

    await replyDesk.syncFromD1Async();

    const localRow = db.prepare('SELECT * FROM reply_desk_query_runs WHERE id = ?').get('run_test_mission_sync_1') as any;
    expect(localRow).toBeDefined();
    expect(localRow.query).toBe('test_mission sync query 1');
  });

  it('3. NextBestActionEngine ranks REPLY_DESK_DISCOVER without requiring direct offer attestation', () => {
    delete process.env.OWN_OFFER_CONFIRMED;
    delete process.env.DIRECT_OFFER_TERMS_SHA256;

    const nba = NextBestActionEngine.getInstance();
    const actions = nba.rankAll('biz_platform_aro', 'org_owner_primary', { ignoreCooldown: true });

    const replyAction = actions.find(a => a.actionType === 'REPLY_DESK_DISCOVER');
    expect(replyAction).toBeDefined();
    expect(replyAction?.priorityTier).toBe('P0');
    expect(replyAction?.score).toBe(950);

    // Assert composeDraftAnswer outputs internal evidence summary without unapproved claims or prices
    const draftAnswer = ReplyDeskService.getInstance().composeDraftAnswer(
      'Inquiry regarding missed patient calls dental clinic',
      'How can our dental clinic avoid inquiry delay and handle missed calls on whatsapp outside hours?'
    );
    expect(draftAnswer).toContain('[INTERNAL EVIDENCE SUMMARY]');
    expect(draftAnswer).toContain('Inquiry regarding missed patient calls dental clinic');
    expect(draftAnswer).not.toContain('under 2 minutes');
    expect(draftAnswer).not.toContain('₹0 additional advertising spend');
    expect(draftAnswer).not.toContain('calendar routing');
    expect(draftAnswer).not.toContain('15000');
    expect(draftAnswer).not.toContain('8000');
  });

  it('3b. /offer page disables direct online checkout when unattested', async () => {
    delete process.env.OWN_OFFER_CONFIRMED;
    delete process.env.DIRECT_OFFER_TERMS_SHA256;

    const req = new Request('http://localhost/offer', { method: 'GET' });
    const res = await apiRouter.fetch(req);
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('Direct online checkout is disabled until commercial terms are attested by the owner');
    expect(html).not.toContain('rzp.io');
    expect(html).not.toContain('Buy Now');
    expect(html).not.toContain('Pay ₹');
  });

  it('3c. DISCOVER_OFFER only wins when an authorized partner genuinely exists with 0 offers', () => {
    const testOrg = 'org_test_bootstrap';
    const testBiz = 'biz_test_bootstrap';

    try {
      const nba = NextBestActionEngine.getInstance();

      // 1. Zero partners -> DISCOVER_OFFER should NOT be generated
      let actions = nba.rankAll(testBiz, testOrg, { ignoreCooldown: true });
      expect(actions.find(a => a.actionType === 'DISCOVER_OFFER')).toBeUndefined();

      // 2. Insert an APPROVED, AUTHORIZED partner with 0 offers
      db.prepare(`
        INSERT INTO partners (id, organization_id, name, industry, website, partner_type, approval_status, authorization_status, active_status)
        VALUES ('test_part_approved', ?, 'Test Approved Partner', 'Technology', 'https://example.com', 'AFFILIATE', 'APPROVED', 'AUTHORIZED', 1)
      `).run(testOrg);

      actions = nba.rankAll(testBiz, testOrg, { ignoreCooldown: true });
      const discoverAction = actions.find(a => a.actionType === 'DISCOVER_OFFER');
      expect(discoverAction).toBeDefined();
      expect(discoverAction?.priorityTier).toBe('P0');
      expect(discoverAction?.score).toBe(950);

      // 3. Now add an ACTIVE offer for this partner
      db.prepare(`
        INSERT INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer,
          destination_url, authorized_tracking_url, active, status
        ) VALUES (
          'test_off_active', 'test_part_approved', ?, 'Test Offer', 'test-offer-slug-bootstrap', 'Technology', 'Businesses',
          'https://example.com/item', 'https://example.com/track', 1, 'ACTIVE'
        )
      `).run(testOrg);

      actions = nba.rankAll(testBiz, testOrg, { ignoreCooldown: true });
      // With activeOffersCount > 0, the zero-offer bootstrap DISCOVER_OFFER (score 950) must NOT be generated
      const bootstrapAction = actions.find(a => a.actionType === 'DISCOVER_OFFER' && a.score === 950);
      expect(bootstrapAction).toBeUndefined();
    } finally {
      db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(testOrg);
      db.prepare(`DELETE FROM partners WHERE organization_id = ?`).run(testOrg);
    }
  });

  it('4. /api/v1/cron/status reports */15 * * * * schedule and distinct pipeline metrics', async () => {
    const req = new Request('http://localhost/cron/status', { method: 'GET' });
    const res = await apiRouter.fetch(req);
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.cronExpression).toBe('*/15 * * * *');
    expect(json.data.cadenceMinutes).toBe(15);

    const metrics = json.data.metrics;
    expect(metrics).toBeDefined();
    expect(typeof metrics.scheduledWakeUps).toBe('number');
    expect(typeof metrics.successfulOrchestrationCycles).toBe('number');
    expect(typeof metrics.discoveryAttempts).toBe('number');
    expect(typeof metrics.successfulProviderQueries).toBe('number');
    expect(typeof metrics.evidenceBackedSignals).toBe('number');
    expect(typeof metrics.qualifiedProspects).toBe('number');
    expect(typeof metrics.contentTasks).toBe('number');
    expect(typeof metrics.ownerApprovalsPending).toBe('number');
    expect(typeof metrics.publishedAssets).toBe('number');
    expect(typeof metrics.customerInquiries).toBe('number');
    expect(typeof metrics.proposals).toBe('number');
    expect(typeof metrics.paymentAttempts).toBe('number');
    expect(typeof metrics.verifiedRevenueINR).toBe('number');
    expect(typeof metrics.idleCycleSharePercent).toBe('number');
  });

  it('5. OwnerDigestService queries autonomous_cycle_log and reports accurate idle cycle rate', () => {
    const digestService = OwnerDigestService.getInstance();
    const digest = digestService.generateDigest();

    const blocker2 = digest.topPainPoints.find(p => p.rank === 2);
    expect(blocker2).toBeDefined();
    expect(blocker2?.title).toBe('Idle Autonomous Cycle Share');
    expect(blocker2?.metric).toMatch(/idle cycles/);
  });

  it('6. validateSiteIdentityFacts supports inferable organization defaults without breaking strict validation', () => {
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;

    // Strict validation fails without defaults
    const strictRes = validateSiteIdentityFacts();
    expect(strictRes.valid).toBe(false);
    expect(strictRes.missingFields).toContain('PUBLIC_SITE_NAME');
    expect(strictRes.missingFields).toContain('PUBLIC_AUTHOR_NAME');
    expect(strictRes.missingFields).toContain('PUBLIC_CONTACT_EMAIL');

    // Inferable defaults succeed with organization identity and contact route
    const inferableRes = validateSiteIdentityFacts(process.env, { allowInferableDefaults: true });
    expect(inferableRes.valid).toBe(true);
    expect(inferableRes.facts?.siteName).toBe('AI Marketing Organization');
    expect(inferableRes.facts?.authorName).toBe('AI Marketing Organization');
    expect(inferableRes.facts?.contactRoute).toBe('/offer#inquiry');
    expect(inferableRes.facts?.contactEmail).toBeUndefined(); // never fabricates an unverified email address

    // resolveSiteIdentity helper
    const resolved = resolveSiteIdentity();
    expect(resolved.siteName).toBe('AI Marketing Organization');
    expect(resolved.contactRoute).toBe('/offer#inquiry');
  });

  it('7. prepareDeployGuides handles zero published guides as a skipped no-op when allowEmpty is true', async () => {
    const { prepareDeployGuides } = await import('../../../../scripts/prepare-deploy-guides.mjs');

    // Without allowEmpty: must reject with NO_PUBLISHED_GUIDE
    await expect(
      prepareDeployGuides({ dryRun: true, mockGuides: [] })
    ).rejects.toThrow(/NO_PUBLISHED_GUIDE/);

    // With allowEmpty: must succeed with skipped: true and 0 publishedCount
    const res = await prepareDeployGuides({ dryRun: true, mockGuides: [], allowEmpty: true });
    expect(res.publishedCount).toBe(0);
    expect(res.skipped).toBe(true);
  });
});
