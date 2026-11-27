import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
});
