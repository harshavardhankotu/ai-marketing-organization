import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { D1Client } from '../../src/db/d1-client.js';
import { DurableJobQueue } from '../../src/automation/durable-job-queue.js';
import { CommercialSchedulePolicy } from '../../src/automation/commercial-schedule-policy.js';
import { SeasonalDemandEngine, FestivalCalendar } from '../../src/commission/seasonal-demand-engine.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { apiRouter } from '../../src/routes/api.js';

describe('PR #106: Click Integrity, Cron Budget, Seasonal Matching, and D1 0050 Schema', () => {
  beforeEach(() => {
    getDb();
    vi.restoreAllMocks();
  });

  it('a) suppresses Cuelinks convertLink & 302 redirect for suspected_bot, known_bot, and test while allowing human/browser_candidate', async () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, authorization_status, approval_status, active_status, updated_at)
      VALUES ('part_cuelinks', 'org_owner_primary', 'Cuelinks', 'E-commerce', 'https://cuelinks.com', 'CUELINKS', 'AUTHORIZED', 'APPROVED', 1, datetime('now'))
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO partner_offers (id, partner_id, organization_id, title, offer_slug, category, target_customer, destination_url, authorized_tracking_url, active, status)
      VALUES ('deal_pr106_test', 'part_cuelinks', 'org_owner_primary', 'Plum 15% Vitamin C Serum', 'plum-15-vit-c-pr106', 'Health & Beauty', 'Skincare shoppers', 'https://plumgoodness.com/products/vitamin-c-face-serum', 'https://linksredirect.com/?cid=331585', 1, 'ACTIVE')
    `).run();

    const engine = AutonomousDealDiscoveryEngine.getInstance();
    vi.spyOn(engine, 'resolveDeal').mockResolvedValue({
      id: 'deal_pr106_test',
      slug: 'plum-15-vit-c-pr106',
      canonicalSlug: 'plum-15-vit-c-pr106',
      title: 'Plum 15% Vitamin C Serum',
      merchant: 'Plum Goodness',
      category: 'Health & Beauty',
      productUrl: 'https://plumgoodness.com/products/vitamin-c-face-serum',
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: '4098',
      availability: 'IN_STOCK',
      verificationStatus: 'AFFILIATE_VERIFIED',
      isMonetizable: true
    } as any);

    const cuelinksSync = CuelinksSyncManager.getInstance();
    vi.spyOn(cuelinksSync, 'getApprovedChannel').mockResolvedValue({
      approved: true,
      channel: { id: '331585', name: 'Main' }
    } as any);

    const convertSpy = vi.spyOn(CuelinksV3Client.getInstance(), 'convertLink').mockResolvedValue({
      affiliated: true,
      tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fplumgoodness.com%2Fproducts%2Fvitamin-c-face-serum',
      campaign: { id: 4098, name: 'Plum Goodness' }
    } as any);

    // 1. suspected_bot (curl)
    const botRes = await apiRouter.request('/public/deals/deal_pr106_test/redirect', {
      headers: { 'user-agent': 'curl/8.4.0', 'x-forwarded-for': '203.0.113.10' }
    });
    expect(botRes.status).toBe(200);
    const botJson = await botRes.json() as any;
    expect(botJson.redirectSuppressed).toBe(true);
    expect(botJson.trafficClass).toBe('suspected_bot');
    expect(convertSpy).not.toHaveBeenCalled();

    // 2. known_bot
    const knownBotRes = await apiRouter.request('/public/deals/deal_pr106_test/redirect', {
      headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'x-forwarded-for': '203.0.113.11' }
    });
    expect(knownBotRes.status).toBe(200);
    const knownBotJson = await knownBotRes.json() as any;
    expect(knownBotJson.redirectSuppressed).toBe(true);
    expect(knownBotJson.trafficClass).toBe('known_bot');
    expect(convertSpy).not.toHaveBeenCalled();

    // 3. test traffic
    const testRes = await apiRouter.request('/public/deals/deal_pr106_test/redirect', {
      headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0', 'x-test-mode': 'true', 'x-forwarded-for': '203.0.113.12' }
    });
    expect(testRes.status).toBe(200);
    const testJson = await testRes.json() as any;
    expect(testJson.redirectSuppressed).toBe(true);
    expect(testJson.trafficClass).toBe('test');
    expect(convertSpy).not.toHaveBeenCalled();

    // Verify diagnostic referral_click_events were recorded without linksredirect.com
    const diagRows = db.prepare(`SELECT device_class, destination_url FROM referral_click_events WHERE offer_id = 'deal_pr106_test'`).all() as any[];
    expect(diagRows.length).toBe(3);
    expect(diagRows.every(r => !String(r.destination_url).includes('linksredirect.com'))).toBe(true);

    // 4. human / browser_candidate proceeds to convertLink + 302
    const humanRes = await apiRouter.request('/public/deals/deal_pr106_test/redirect', {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'x-forwarded-for': '203.0.113.13' }
    });
    expect(humanRes.status).toBe(302);
    expect(humanRes.headers.get('location')).toContain('linksredirect.com');
    expect(convertSpy).toHaveBeenCalledTimes(1);
  });

  it('b) bounds recoverStaleAndBlockedJobs + enqueueJobsBatch under 2500-row cycle cap so queued jobs execute', async () => {
    const db = getDb();
    const queue = DurableJobQueue.getInstance();
    const d1Client = D1Client.getInstance();

    db.prepare(`DELETE FROM automation_jobs`).run();
    // Seed 300 historical completed jobs
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
      VALUES (?, 'daily_market_demand_research', 'biz_platform_aro', 'org_owner_primary', ?, 'COMPLETED', 1, '{}', '{}', 1, 3, datetime('now', '-2 days'), '{}', datetime('now', '-2 days'), datetime('now', '-2 days'))
    `);
    for (let i = 0; i < 300; i++) {
      insertStmt.run(`hist_job_${i}`, `hist_key_${i}`);
    }

    d1Client.startBackgroundCycle(D1Client.PER_CYCLE_READ_BUDGET_CAP);
    const recovery = await queue.recoverStaleAndBlockedJobs({
      skipSystemDoctor: true,
      activeWorkflowIds: ['affiliate_offer_reconciliation']
    });
    await queue.enqueueJobsBatch([
      { workflowId: 'affiliate_offer_reconciliation', idempotencyKey: `pr106_recon_${Date.now()}`, priority: 0 }
    ]);
    const claimed = await queue.claimDueJob('test_cron', 60);
    const usage = d1Client.endBackgroundCycle();

    expect(recovery.queueStatsAfter).toBeDefined();
    expect(usage.budgetStopped).toBe(false);
    expect(usage.rowsRead).toBeLessThan(500);
    expect(claimed).not.toBeNull();
    expect(claimed?.workflowId).toBe('affiliate_offer_reconciliation');
  });

  it('c) matches AFFILIATE_VERIFIED deals, updates Black Friday off SOFTWARE_SAAS, and puts seasonal_demand_research in morning catch-up only', async () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO seasonal_festivals (id, name, slug, event_date, category, shopping_lead_days, region, source_url, confidence_score, last_verified_at)
      VALUES ('fest_black_friday_india_2026', 'Black Friday & Cyber Week India', 'black-friday-cyber-week-india', '2026-11-27', 'SOFTWARE_SAAS', 14, 'All India', 'https://india.gov.in/calendar', 1.0, '2026-11-02T00:00:00Z')
    `).run();

    await FestivalCalendar.getInstance().ensureSeeded();
    const updatedRow = db.prepare(`SELECT category FROM seasonal_festivals WHERE id = 'fest_black_friday_india_2026'`).get() as any;
    expect(updatedRow.category).toBe('Electronics, Health & Beauty, Fashion');

    const report = await SeasonalDemandEngine.getInstance().runSeasonalDemandCycle([
      {
        id: 'deal_serum_1',
        title: 'Plum 15% Vitamin C Serum',
        merchant: 'Plum Goodness',
        category: 'Health & Beauty',
        verificationStatus: 'AFFILIATE_VERIFIED',
        availability: 'IN_STOCK',
        lastVerifiedAt: '2026-11-27T10:00:00Z'
      }
    ], 30);

    const bf = report.opportunities.find(o => o.festivalId === 'fest_black_friday_india_2026');
    expect(bf).toBeDefined();
    expect(bf?.verifiedDealCount).toBe(1);

    const morning = CommercialSchedulePolicy.getCronCatchupWorkflowIds(new Date('2026-11-27T04:30:00Z')); // 10:00 IST
    const evening = CommercialSchedulePolicy.getCronCatchupWorkflowIds(new Date('2026-11-27T16:30:00Z')); // 22:00 IST
    expect(morning).toContain('seasonal_demand_research');
    expect(evening).not.toContain('seasonal_demand_research');
  });

  it('d) owner-digest and brevo-mcp-client avoid missing-schema errors on strict D1 0050 schema and return UNAVAILABLE / UNCONFIGURED', async () => {
    const db = getDb();
    db.prepare(`DROP TABLE IF EXISTS cost_ledger`).run();
    db.prepare(`DROP TABLE IF EXISTS brevo_daily_quota`).run();

    const prevBrevo = process.env.BREVO_API_KEY;
    delete process.env.BREVO_API_KEY;

    const brevo = BrevoMcpClient.getInstance();
    expect(brevo.getQuotaStatus().status).toBe('UNCONFIGURED');
    expect(await brevo.getDailySendCount()).toBe(0);

    const digestService = OwnerDigestService.getInstance();
    const aros = await digestService.getArosControlCenterSummary();
    expect(aros.commercialPerformance.operatingExpensesINR.sourceTag).toBe('UNAVAILABLE');
    expect(aros.commercialPerformance.operatingExpensesINR.value).toBeNull();

    const digest = await digestService.generateDigestAsync();
    expect(digest.autopilotStatus?.outreachAutopilotActive).toBeDefined();
    expect(digest.commerceAutopilotStatus).toBeDefined();
    expect(['UNAVAILABLE', 'COMPLETED', 'QUEUED', 'RUNNING', 'COMPLETED_WITH_FINDINGS', 'COMPLETED_NO_FINDINGS', 'NO_ACTION_DUE', 'DEFERRED', 'BLOCKED', 'RETRY_WAIT', 'FAILED_PERMANENTLY', 'PARTIAL']).toContain(digest.commerceAutopilotStatus?.lastRunStatus);

    if (prevBrevo !== undefined) process.env.BREVO_API_KEY = prevBrevo;
  });

  it('e) repairCorruptObjectCategories repairs partner_offers [object Object] rows alongside public_deals', async () => {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, authorization_status, approval_status, active_status, updated_at)
      VALUES ('part_cuelinks', 'org_owner_primary', 'Cuelinks', 'E-commerce', 'https://cuelinks.com', 'CUELINKS', 'AUTHORIZED', 'APPROVED', 1, datetime('now'))
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO partner_offers (id, partner_id, organization_id, title, offer_slug, category, target_customer, destination_url, authorized_tracking_url, active, status)
      VALUES ('po_corrupt_1', 'part_cuelinks', 'org_owner_primary', 'boAt Airdopes Wireless Earbuds', 'boat-airdopes-corrupt', '[object Object]', 'Audio shoppers', 'https://boat-lifestyle.com/products/airdopes', 'https://linksredirect.com/?cid=331585', 1, 'ACTIVE')
    `).run();

    const res = await AutonomousDealDiscoveryEngine.getInstance().repairCorruptObjectCategories();
    expect(res.partnerOffersRepaired).toBeGreaterThanOrEqual(1);
    const fixed = db.prepare(`SELECT category FROM partner_offers WHERE id = 'po_corrupt_1'`).get() as any;
    expect(fixed.category).toBe('Electronics');
  });
});
