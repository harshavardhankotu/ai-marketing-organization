import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
vi.hoisted(() => {
  process.env.DATABASE_PATH = ':memory:';
});
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

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(() => {
    try {
      const db = getDb();
      db.prepare(`DELETE FROM automation_jobs`).run();
      db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    } catch {}
  });

  it('a) suppresses Cuelinks convertLink & 302 redirect for suspected_bot, known_bot, and test while allowing human/browser_candidate, and suppresses /r/:slug/:ref for x-internal-admin', async () => {
    const db = getDb();
    db.prepare(`DELETE FROM referral_click_events WHERE offer_id = 'deal_pr106_test'`).run();
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

    // 4. Internal/admin request to /r/:offerSlug/:referralId suppresses affiliate conversion and 302
    const rInternalRes = await apiRouter.request('/r/plum-15-vit-c-pr106/ref_internal_106', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'x-internal-admin': 'true',
        'x-forwarded-for': '203.0.113.14'
      }
    });
    expect(rInternalRes.status).toBe(200);
    const rInternalJson = await rInternalRes.json() as any;
    expect(rInternalJson.redirectSuppressed).toBe(true);
    expect(rInternalJson.trafficClass).toBe('internal');
    expect(convertSpy).not.toHaveBeenCalled();

    // Verify diagnostic referral_click_events were recorded without linksredirect.com for /public/deals/:id/redirect
    const diagRows = db.prepare(`SELECT device_class, destination_url FROM referral_click_events WHERE offer_id = 'deal_pr106_test' AND device_class IN ('suspected_bot', 'known_bot', 'test')`).all() as any[];
    expect(diagRows.length).toBe(3);
    expect(diagRows.every(r => !String(r.destination_url).includes('linksredirect.com'))).toBe(true);

    // 5. human / browser_candidate proceeds to convertLink + 302
    const humanRes = await apiRouter.request('/public/deals/deal_pr106_test/redirect', {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'x-forwarded-for': '203.0.113.13' }
    });
    expect(humanRes.status).toBe(302);
    expect(humanRes.headers.get('location')).toContain('linksredirect.com');
    expect(convertSpy).toHaveBeenCalledTimes(1);
  });

  it('b) bounds recoverStaleAndBlockedJobs + enqueueJobsBatch under 2500-row cap, prevents duplicate enqueue past 50 newer rows, and uses indexed query plan', async () => {
    const db = getDb();
    const queue = DurableJobQueue.getInstance();
    const d1Client = D1Client.getInstance();

    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    // Seed 1 older active job for affiliate_offer_reconciliation + 60 newer jobs for other workflows
    db.prepare(`
      INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
      VALUES ('older_active_recon', 'affiliate_offer_reconciliation', 'biz_platform_aro', 'org_owner_primary', 'older_active_key', 'QUEUED', 0, '{}', '{}', 0, 3, datetime('now', '-30 minutes'), '{}', datetime('now', '-30 minutes'), datetime('now', '-30 minutes'))
    `).run();

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
      VALUES (?, 'daily_market_demand_research', 'biz_platform_aro', 'org_owner_primary', ?, 'QUEUED', 1, '{}', '{}', 0, 3, datetime('now'), '{}', datetime('now'), datetime('now'))
    `);
    for (let i = 0; i < 60; i++) {
      insertStmt.run(`newer_job_${i}`, `newer_key_${i}`);
    }

    // Verify EXPLAIN QUERY PLAN uses index idx_auto_jobs_due (zero full-table SCAN)
    const statsPlan = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT status, COUNT(*) as cnt
      FROM automation_jobs
      WHERE status IN ('QUEUED', 'RETRY_WAIT', 'RUNNING', 'BLOCKED')
      GROUP BY status
    `).all() as any[];
    const planText = statsPlan.map(r => r.detail).join(' | ');
    expect(planText).toMatch(/USING (?:COVERING )?INDEX idx_auto_jobs_/i);
    expect(planText).not.toMatch(/\bSCAN\s+automation_jobs\b/i);

    // Enqueue with a new idempotency key: must NOT re-enqueue affiliate_offer_reconciliation because older_active_recon is still QUEUED
    const batchRes = await queue.enqueueJobsBatch([
      { workflowId: 'affiliate_offer_reconciliation', idempotencyKey: `pr106_dup_guard_${Date.now()}`, priority: 0 }
    ]);
    expect(batchRes.enqueuedCount).toBe(0);

    d1Client.startBackgroundCycle(D1Client.PER_CYCLE_READ_BUDGET_CAP);
    const recovery = await queue.recoverStaleAndBlockedJobs({
      skipSystemDoctor: true,
      activeWorkflowIds: ['affiliate_offer_reconciliation']
    });
    const claimed = await queue.claimDueJob('test_cron', 60);
    const usage = d1Client.endBackgroundCycle();

    expect(recovery.queueStatsAfter).toBeDefined();
    expect(usage.budgetStopped).toBe(false);
    expect(usage.rowsRead).toBeLessThan(500);
    expect(claimed).not.toBeNull();
    expect(claimed?.workflowId).toBe('affiliate_offer_reconciliation');
  });

  it('c) matches AFFILIATE_VERIFIED deals with frozen clock (2026-11-27), updates Black Friday off SOFTWARE_SAAS, and puts seasonal_demand_research in morning catch-up only', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T06:00:00.000Z'));

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
        lastVerifiedAt: '2026-11-27T05:00:00Z'
      }
    ], 30);

    const bf = report.opportunities.find(o => o.festivalId === 'fest_black_friday_india_2026');
    expect(bf).toBeDefined();
    expect(bf?.verifiedDealCount).toBe(1);

    const morning = CommercialSchedulePolicy.getCronCatchupWorkflowIds(new Date('2026-11-27T04:30:00Z'));
    const evening = CommercialSchedulePolicy.getCronCatchupWorkflowIds(new Date('2026-11-27T16:30:00Z'));
    expect(morning).toContain('seasonal_demand_research');
    expect(evening).not.toContain('seasonal_demand_research');
  });

  it('d) excludes test payments from sync/async owner totals, handles revenue_records without is_test, and marks commerceAutopilotStatus INACTIVE_UNPROVEN without completed commercial runs', async () => {
    const db = getDb();
    db.prepare(`DROP TABLE IF EXISTS cost_ledger`).run();
    db.prepare(`DROP TABLE IF EXISTS brevo_daily_quota`).run();
    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    db.prepare(`DELETE FROM public_deals`).run();

    // Seed AFFILIATE_VERIFIED deal inventory but ZERO completed commercial workflows
    db.prepare(`
      INSERT INTO public_deals (id, slug, canonical_slug, title, brand, merchant, category, sector_code, product_url, affiliate_url, current_price_inr, currency, availability, verification_status, deal_kind, evidence_json, is_monetizable, product_verified, affiliate_verified)
      VALUES ('deal_inv_1', 'deal-inv-1', 'deal-inv-1', 'Verified Serum', 'Plum', 'Plum', 'Health & Beauty', 'SECTOR_G_LIFESTYLE', 'https://plumgoodness.com/p/1', 'https://linksredirect.com/?cid=331585', 599, 'INR', 'IN_STOCK', 'AFFILIATE_VERIFIED', 'PRODUCT', '{}', 1, 1, 1)
    `).run();

    // Seed yesterday real payment + test-marked payment (adapting to whether revenue_records has is_test)
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    db.prepare(`DELETE FROM revenue_records`).run();
    const revCols = (db.prepare(`PRAGMA table_info(revenue_records)`).all() as any[]).map(c => c.name);
    if (revCols.includes('is_test')) {
      db.prepare(`
        INSERT INTO revenue_records (id, organization_id, business_id, revenue_type, source, transaction_id, amount_inr, currency, verified, verification_method, classification, is_test, timestamp)
        VALUES
          ('rev_real_106', 'org_owner_primary', 'biz_platform_aro', 'OWN_OFFER_SALES', 'RAZORPAY_EXPORT', 'tx_real_106', 1999, 'INR', 1, 'MANUAL_EXPORT', 'REAL', 0, ?),
          ('rev_test_106', 'org_owner_primary', 'biz_platform_aro', 'OWN_OFFER_SALES', 'RAZORPAY_EXPORT', 'tx_test_106', 5000, 'INR', 1, 'MANUAL_EXPORT', 'REAL', 1, ?),
          ('rev_sandbox_106', 'org_owner_primary', 'biz_platform_aro', 'OWN_OFFER_SALES', 'SANDBOX', 'tx_sb_106', 7000, 'INR', 1, 'TEST', 'REAL', 0, ?)
      `).run(`${yest}T10:00:00Z`, `${yest}T11:00:00Z`, `${yest}T12:00:00Z`);
    } else {
      db.prepare(`
        INSERT INTO revenue_records (id, organization_id, business_id, revenue_type, source, transaction_id, amount_inr, currency, verified, verification_method, classification, timestamp)
        VALUES
          ('rev_real_106', 'org_owner_primary', 'biz_platform_aro', 'OWN_OFFER_SALES', 'RAZORPAY_EXPORT', 'tx_real_106', 1999, 'INR', 1, 'MANUAL_EXPORT', 'REAL', ?),
          ('rev_test_106', 'org_owner_primary', 'biz_platform_aro', 'OWN_OFFER_SALES', 'RAZORPAY_EXPORT', 'tx_test_106', 5000, 'INR', 1, 'TEST', 'TEST', ?),
          ('rev_sandbox_106', 'org_owner_primary', 'biz_platform_aro', 'OWN_OFFER_SALES', 'SANDBOX', 'tx_sb_106', 7000, 'INR', 1, 'TEST', 'REAL', ?)
      `).run(`${yest}T10:00:00Z`, `${yest}T11:00:00Z`, `${yest}T12:00:00Z`);
    }

    const prevBrevo = process.env.BREVO_API_KEY;
    delete process.env.BREVO_API_KEY;
    expect(BrevoMcpClient.getInstance().getQuotaStatus().status).toBe('UNCONFIGURED');
    expect(await BrevoMcpClient.getInstance().getDailySendCount()).toBe(0);

    const digestService = OwnerDigestService.getInstance();
    const syncDigest = digestService.generateDigest();
    expect(syncDigest.yesterdayMetrics.payments).toBe(1999);
    expect(syncDigest.commerceAutopilotStatus?.eligibleDealInventoryCount).toBe(1);
    expect(syncDigest.commerceAutopilotStatus?.latestSuccessfulCommercialWorkflow).toBeNull();
    expect(syncDigest.commerceAutopilotStatus?.active).toBe(false);
    expect(syncDigest.commerceAutopilotStatus?.status).toBe('INACTIVE_UNPROVEN');

    const asyncDigest = await digestService.generateDigestAsync();
    expect(asyncDigest.yesterdayMetrics.payments).toBe(1999);

    // Also verify async revenue query succeeds cleanly on a revenue_records schema lacking is_test (D1 0050 parity)
    const d1Repo = (digestService as any).d1Repo;
    const origQueryOne = d1Repo.queryOne.bind(d1Repo);
    const hasColSpy = vi.spyOn(digestService as any, 'hasColumn').mockResolvedValue(false);
    const d1QuerySpy = vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: any, sql: any, params: any) => {
      if (table === 'revenue_records') {
        expect(String(sql)).not.toContain('is_test');
        return { total: 1999 };
      }
      return origQueryOne(table, sql, params);
    });

    const payRow = await (digestService as any).d1Repo.queryOne(
      'revenue_records',
      `SELECT SUM(amount_inr) as total FROM revenue_records WHERE ${(digestService as any).buildRealPaymentPredicate(await (digestService as any).hasColumn('revenue_records', 'is_test'))} AND timestamp LIKE ?`,
      [`${yest}%`]
    );
    expect(payRow.total).toBe(1999);
    hasColSpy.mockRestore();
    d1QuerySpy.mockRestore();

    const aros = await digestService.getArosControlCenterSummary();
    expect(aros.commercialPerformance.operatingExpensesINR.sourceTag).toBe('UNAVAILABLE');
    expect(aros.commercialPerformance.operatingExpensesINR.value).toBeNull();

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

  it('f) restores terminal queue counters, newest >50 payload retention, newest-due compaction, ordered lastSuccess, and beacon exclusions', async () => {
    const db = getDb();
    const queue = DurableJobQueue.getInstance();
    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();

    // 1. >50 queued jobs for one workflow: newest payload must be retained after recovery
    for (let i = 0; i < 55; i++) {
      const minsAgo = 180 - i; // i=54 is newest (126 mins ago)
      db.prepare(`
        INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
        VALUES (?, 'affiliate_offer_reconciliation', 'biz_platform_aro', 'org_owner_primary', ?, 'QUEUED', 0, ?, '{}', 0, 3, datetime('now', '-' || ? || ' minutes'), '{}', datetime('now', '-' || ? || ' minutes'), datetime('now', '-' || ? || ' minutes'))
      `).run(`stale_seq_${i}`, `stale_seq_key_${i}`, JSON.stringify({ seq: i }), minsAgo, minsAgo, minsAgo);
    }
    await queue.recoverStaleAndBlockedJobs({ skipSystemDoctor: true, activeWorkflowIds: ['affiliate_offer_reconciliation'] });
    const retained = db.prepare(`SELECT id, status FROM automation_jobs WHERE workflow_id = 'affiliate_offer_reconciliation' AND status = 'QUEUED'`).all() as any[];
    expect(retained.length).toBe(1);
    expect(retained[0].id).toBe('stale_seq_54');

    // 2. Mixed future-scheduled and already-due jobs: due job must NOT be displaced by future job
    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    db.prepare(`
      INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
      VALUES
        ('job_future_old', 'daily_market_demand_research', 'biz_platform_aro', 'org_owner_primary', 'k_fut', 'QUEUED', 1, '{}', '{}', 0, 3, datetime('now', '+2 hours'), '{}', datetime('now', '-10 minutes'), datetime('now', '-10 minutes')),
        ('job_due_new', 'daily_market_demand_research', 'biz_platform_aro', 'org_owner_primary', 'k_due', 'QUEUED', 1, '{}', '{}', 0, 3, datetime('now', '-1 minute'), '{}', datetime('now', '-1 minute'), datetime('now', '-1 minute'))
    `).run();
    await queue.compactStaleDuplicateQueueJobs();
    const dueRow = db.prepare(`SELECT status FROM automation_jobs WHERE id = 'job_due_new'`).get() as any;
    const futRow = db.prepare(`SELECT status FROM automation_jobs WHERE id = 'job_future_old'`).get() as any;
    expect(dueRow.status).toBe('QUEUED');
    expect(futRow.status).toBe('NO_ACTION_DUE');

    // 3. Terminal counters & ordered lastSuccess
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    db.prepare(`
      INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, completed_at, created_at, updated_at)
      VALUES
        ('job_fail_perm', 'quota_health_checks', 'biz_platform_aro', 'org_owner_primary', 'k_fp', 'FAILED_PERMANENTLY', 1, '{}', '{}', 3, 3, datetime('now'), '{}', '2026-11-26 10:00:00', datetime('now'), datetime('now')),
        ('job_comp_old', 'seasonal_demand_research', 'biz_platform_aro', 'org_owner_primary', 'k_co', 'COMPLETED', 1, '{}', '{}', 1, 3, datetime('now'), '{}', '2026-11-26 08:00:00', datetime('now'), datetime('now')),
        ('job_comp_new', 'affiliate_offer_reconciliation', 'biz_platform_aro', 'org_owner_primary', 'k_cn', 'COMPLETED', 0, '{}', '{}', 1, 3, datetime('now'), '{}', '2026-11-27 12:00:00', datetime('now'), datetime('now'))
    `).run();
    const stats = await queue.getQueueStats();
    expect(stats.failedPermanently).toBe(1);
    expect(stats.completed).toBe(2);
    expect(stats.lastSuccessfulExecutionAt).toBe('2026-11-27 12:00:00');

    // 4. Diagnostic beacons excluded from genuine human outbound clicks across sync digest, AROS, and async digest
    db.prepare(`DELETE FROM referral_click_events`).run();
    db.prepare(`
      INSERT INTO referral_click_events (id, referral_id, click_id, organization_id, offer_id, partner_id, placement, source, medium, device_class, destination_url, created_at)
      VALUES
        ('clk_h1', 'ref_h1', 'cid_h1', 'org_owner_primary', 'deal_1', 'part_cuelinks', 'deal_card', 'deals_page', 'cpc_affiliate', 'browser_candidate', 'https://linksredirect.com/?cid=331585', datetime('now')),
        ('clk_b1', 'ref_b1', 'cid_b1', 'org_owner_primary', 'deal_1', 'part_cuelinks', 'direct_beacon', 'deals_page', 'cpc_affiliate', 'browser_candidate', 'https://example.com', datetime('now')),
        ('clk_b2', 'ref_b2', 'cid_b2', 'org_owner_primary', 'deal_1', 'part_cuelinks', 'deal_card', 'direct_beacon', 'beacon', 'browser_candidate', 'https://example.com', datetime('now'))
    `).run();

    const digestService = OwnerDigestService.getInstance();
    const syncDigest = digestService.generateDigest();
    const aros = await digestService.getArosControlCenterSummary();
    const asyncDigest = await digestService.generateDigestAsync();
    expect(syncDigest.commerceAutopilotStatus?.genuineHumanOutboundClicks).toBe(1);
    expect(syncDigest.commerceAutopilotStatus?.latestSuccessfulCommercialWorkflow).toBe('affiliate_offer_reconciliation');
    expect(aros.commercialPerformance.outboundClicks.value).toBe(1);
    expect(asyncDigest.commerceAutopilotStatus?.genuineHumanOutboundClicks).toBe(1);
  });

  it('g) protects lastSuccessfulExecutionAt from FAILED_PERMANENTLY/PARTIAL/DEFERRED, handles >100 queued compaction boundary, and bounds terminal getQueueStats() reads', async () => {
    const db = getDb();
    const queue = DurableJobQueue.getInstance();

    // 1. Success-vs-failure timestamp: COMPLETED at 12:00 + FAILED_PERMANENTLY/PARTIAL/DEFERRED at 13:00 -> stays 12:00
    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    db.prepare(`
      INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, completed_at, created_at, updated_at)
      VALUES
        ('ts_ok', 'affiliate_offer_reconciliation', 'biz_platform_aro', 'org_owner_primary', 'ts_ok', 'COMPLETED', 0, '{}', '{}', 1, 3, datetime('now'), '{}', '2026-11-27 12:00:00', datetime('now'), datetime('now')),
        ('ts_fail', 'quota_health_checks', 'biz_platform_aro', 'org_owner_primary', 'ts_fail', 'FAILED_PERMANENTLY', 1, '{}', '{}', 3, 3, datetime('now'), '{}', '2026-11-27 13:00:00', datetime('now'), datetime('now')),
        ('ts_part', 'daily_market_demand_research', 'biz_platform_aro', 'org_owner_primary', 'ts_part', 'PARTIAL', 1, '{}', '{}', 1, 3, datetime('now'), '{}', '2026-11-27 13:15:00', datetime('now'), datetime('now')),
        ('ts_def', 'seasonal_demand_research', 'biz_platform_aro', 'org_owner_primary', 'ts_def', 'DEFERRED', 1, '{}', '{}', 1, 3, datetime('now'), '{}', '2026-11-27 13:30:00', datetime('now'), datetime('now'))
    `).run();

    const tsStats = await queue.getQueueStats();
    expect(tsStats.lastSuccessfulExecutionAt).toBe('2026-11-27 12:00:00');

    // Also verify live transition to FAILED_PERMANENTLY never overwrites 12:00:00
    db.prepare(`
      INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
      VALUES ('ts_run_fail', 'quota_health_checks', 'biz_platform_aro', 'org_owner_primary', 'ts_rf', 'RUNNING', 1, '{}', '{}', 3, 3, datetime('now'), '{}', datetime('now'), datetime('now'))
    `).run();
    await queue.failAttempt('ts_run_fail', 'HARD_FAIL', false);
    const tsStatsAfterFail = await queue.getQueueStats();
    expect(tsStatsAfterFail.failedPermanently).toBe(2);
    expect(tsStatsAfterFail.lastSuccessfulExecutionAt).toBe('2026-11-27 12:00:00');

    // 2. >100 queued jobs boundary + mixed due and future-scheduled jobs
    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    for (let i = 0; i < 105; i++) {
      const minsAgo = 200 - i;
      db.prepare(`
        INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
        VALUES (?, 'affiliate_offer_reconciliation', 'biz_platform_aro', 'org_owner_primary', ?, 'QUEUED', 0, '{}', '{}', 0, 3, datetime('now', '-' || ? || ' minutes'), '{}', datetime('now', '-' || ? || ' minutes'), datetime('now', '-' || ? || ' minutes'))
      `).run(`q105_${i}`, `qk_${i}`, minsAgo, minsAgo, minsAgo);
    }
    db.prepare(`
      INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, created_at, updated_at)
      VALUES ('q_future_106', 'affiliate_offer_reconciliation', 'biz_platform_aro', 'org_owner_primary', 'qk_fut', 'QUEUED', 0, '{}', '{}', 0, 3, datetime('now', '+2 hours'), '{}', datetime('now', '-500 minutes'), datetime('now', '-500 minutes'))
    `).run();

    let compactionRowsRead = 0;
    const origPrepare = db.prepare.bind(db);
    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = origPrepare(sql);
      const origAll = stmt.all.bind(stmt);
      stmt.all = (...args: any[]) => {
        const res = origAll(...args);
        if (sql.includes('FROM automation_jobs')) compactionRowsRead += Array.isArray(res) ? res.length : 0;
        return res;
      };
      return stmt;
    });

    await queue.compactStaleDuplicateQueueJobs();
    prepareSpy.mockRestore();

    const newestDue = db.prepare(`SELECT status FROM automation_jobs WHERE id = 'q105_104'`).get() as any;
    const futJob = db.prepare(`SELECT status FROM automation_jobs WHERE id = 'q_future_106'`).get() as any;
    expect(newestDue.status).toBe('QUEUED');
    expect(futJob.status).toBe('NO_ACTION_DUE');
    expect(compactionRowsRead).toBeLessThanOrEqual(150);

    // 3. Bounded terminal stats on 300+ historical terminal rows
    db.prepare(`DELETE FROM automation_jobs`).run();
    db.prepare(`DELETE FROM cron_telemetry WHERE id = 'queue_terminal_summary'`).run();
    for (let i = 0; i < 310; i++) {
      const st = i < 10 ? 'FAILED_PERMANENTLY' : i < 25 ? 'PARTIAL' : i < 50 ? 'DEFERRED' : 'COMPLETED';
      db.prepare(`
        INSERT INTO automation_jobs (id, workflow_id, business_id, organization_id, idempotency_key, status, priority, payload_json, checkpoint_json, attempts, max_attempts, available_at, result_json, completed_at, created_at, updated_at)
        VALUES (?, 'daily_market_demand_research', 'biz_platform_aro', 'org_owner_primary', ?, ?, 1, '{}', '{}', 1, 3, datetime('now'), '{}', '2026-11-27 12:00:00', datetime('now'), datetime('now'))
      `).run(`term300_${i}`, `tk_${i}`, st);
    }

    const initialStats = await queue.getQueueStats();
    expect(initialStats.failedPermanently).toBe(10);
    expect(initialStats.partial).toBe(15);
    expect(initialStats.deferred).toBe(25);
    expect(initialStats.completed).toBe(260);

    let steadyRowsRead = 0;
    const statsSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = origPrepare(sql);
      const origAll = stmt.all.bind(stmt);
      const origGet = stmt.get.bind(stmt);
      stmt.all = (...args: any[]) => {
        const res = origAll(...args);
        steadyRowsRead += Array.isArray(res) ? res.length : 0;
        return res;
      };
      stmt.get = (...args: any[]) => {
        const res = origGet(...args);
        if (res) steadyRowsRead += 1;
        return res;
      };
      return stmt;
    });

    const steadyStats = await queue.getQueueStats();
    statsSpy.mockRestore();

    expect(steadyStats.failedPermanently).toBe(10);
    expect(steadyStats.completed).toBe(260);
    expect(steadyRowsRead).toBeLessThanOrEqual(10);
    console.log(`PR106_MEASURED_READS: compactionRowsRead=${compactionRowsRead} steadyTerminalStatsRowsRead=${steadyRowsRead}`);
  });
});
