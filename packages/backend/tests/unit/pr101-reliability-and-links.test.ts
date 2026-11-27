import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { StaticSiteGenerator, generateComparisonPairs, generateBuyerIntentHubs } from '../../src/commission/static-site-generator.js';
import { createVerifiedLiveSkincareSerums } from '../../src/commission/starter-deals.js';

describe('PR #101 — D1 Baseline 0050 Compatibility, Rel Attributes & UTM Attribution', () => {
  beforeEach(() => {
    CommercialLearningEngine.resetInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    CommercialLearningEngine.resetInstance();
  });

  it('1. CommercialLearningEngine skips remote D1 writes cleanly when optional tables are absent in sqlite_master', async () => {
    const d1Repo = D1RevenueRepository.getInstance();
    vi.spyOn(d1Repo, 'isRemoteD1WriteAllowed').mockReturnValue(true);
    const querySpy = vi.spyOn(d1Repo, 'query').mockResolvedValue([]);
    const writeSpy = vi.spyOn(d1Repo, 'executeWrite').mockResolvedValue({ rowsAffected: 0, source: 'CLOUDFLARE_D1' });

    const engine = CommercialLearningEngine.getInstance();
    engine.ensureBanditInitialized();
    const reward = engine.recordCommercialEvent('SECTOR_G_LIFESTYLE', {
      eventId: `evt_pr101_skip_${Date.now()}`,
      eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK',
      sourceClickId: 'clk_pr101_skip'
    });
    expect(reward).toBe(10);

    engine.selectNextSectorToExplore();

    // Flush async remote write microtasks
    await new Promise(resolve => setTimeout(resolve, 25));

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0][1]).toContain('sqlite_master');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('2. CommercialLearningEngine writes to remote D1 when tables exist and surfaces non-missing-table write errors', async () => {
    const d1Repo = D1RevenueRepository.getInstance();
    vi.spyOn(d1Repo, 'isRemoteD1WriteAllowed').mockReturnValue(true);
    vi.spyOn(d1Repo, 'query').mockResolvedValue([
      { name: 'sector_bandit_states' },
      { name: 'commercial_reward_events' }
    ]);
    const writeSpy = vi.spyOn(d1Repo, 'executeWrite').mockRejectedValue(new Error('D1_DURABLE_WRITE_UNAVAILABLE: quota exceeded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const engine = CommercialLearningEngine.getInstance();
    engine.ensureBanditInitialized();
    engine.recordCommercialEvent('SECTOR_G_LIFESTYLE', {
      eventId: `evt_pr101_err_${Date.now()}`,
      eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK',
      sourceClickId: 'clk_pr101_err'
    });

    await new Promise(resolve => setTimeout(resolve, 25));

    expect(writeSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Remote D1 write failed'));
  });

  it('3. GET /api/v1/cron/status handles revenue_records without is_test column (D1 baseline 0050 parity)', async () => {
    const d1Repo = D1RevenueRepository.getInstance();
    vi.spyOn(d1Repo, 'isRemoteD1ReadAllowed').mockReturnValue(true);

    const seenRevenueSqls: string[] = [];
    vi.spyOn(d1Repo, 'query').mockImplementation(async (table: string, sql: string) => {
      if (table === 'revenue_records' && /pragma_table_info/i.test(sql)) {
        // Simulate baseline 0050 revenue_records without is_test column
        return [];
      }
      return [];
    });
    vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (table: string, sql: string) => {
      if (table === 'revenue_records') {
        seenRevenueSqls.push(sql);
        if (/\bis_test\b/i.test(sql)) {
          throw new Error('no such column: is_test at offset 89');
        }
        return { total: 499 } as any;
      }
      return { cnt: 0, count: 0, total: 0 } as any;
    });

    const res = await app.request('/api/v1/cron/status');
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(seenRevenueSqls.length).toBeGreaterThan(0);
    for (const s of seenRevenueSqls) {
      expect(s).not.toMatch(/\bis_test\b/i);
      expect(s).toContain("COALESCE(classification, 'REAL') != 'TEST'");
    }
    expect(json.data.metrics).toBeDefined();
  });

  it('4. All outbound affiliate <a> links on /deals, /deals/:slug, /best/:slug, and /vs/:slug use rel="sponsored noopener noreferrer"', () => {
    const serums = createVerifiedLiveSkincareSerums('2026-11-25T15:00:00.000Z');
    const cfg = {
      siteName: 'AI Marketing Organization',
      authorName: 'Editorial Desk',
      contactEmail: 'editorial@ai-marketing-organization.onrender.com',
      siteUrl: 'https://ai-marketing-organization.onrender.com'
    };

    const ssg = StaticSiteGenerator.getInstance();
    const pairs = generateComparisonPairs(serums, 5);
    const hubs = generateBuyerIntentHubs(serums, cfg.siteUrl, 5);
    const niaHub = hubs.find(h => h.intentSlug === 'niacinamide-serums-india')!;

    const pages = [
      { name: '/deals', html: ssg.renderDealsHtml(serums, cfg) },
      { name: '/deals/:slug', html: ssg.renderDealDetailHtml(serums[0], serums.slice(1, 3), cfg) },
      { name: '/vs/:slug', html: ssg.renderComparisonHtml(pairs[0], cfg, pairs) },
      { name: '/best/niacinamide-serums-india', html: ssg.renderBuyerGuideHtml(niaHub, hubs, pairs, cfg, { attribution: { utmSource: 'yt_short_1' } }) }
    ];

    for (const page of pages) {
      const anchors = [...page.html.matchAll(/<a\b[^>]*>/gi)].map(m => m[0]);
      const affiliateAnchors = anchors.filter(a => /\/redirect|amazon-redirect|linksredirect|clnk\.in/i.test(a));
      expect(affiliateAnchors.length, `${page.name} must contain affiliate anchors`).toBeGreaterThan(0);
      for (const a of affiliateAnchors) {
        expect(a, `${page.name} affiliate anchor: ${a}`).toContain('rel="sponsored noopener noreferrer"');
        expect(a).not.toContain('rel="sponsored nofollow noopener"');
      }
    }
  });

  it('5. GET /best/niacinamide-serums-india?utm_source=yt_short_1 preserves utm_source across Hono forwarding and records it in referral_click_events', async () => {
    const prevTag = process.env.AMAZON_AFFILIATE_TAG;
    process.env.AMAZON_AFFILIATE_TAG = 'testtag-21';
    const { AutonomousDealDiscoveryEngine } = await import('../../src/commission/autonomous-deal-discovery-engine.js');
    const serums = createVerifiedLiveSkincareSerums('2026-11-25T15:00:00.000Z');
    vi.spyOn(AutonomousDealDiscoveryEngine.getInstance(), 'getEligiblePublicDeals').mockResolvedValue({
      deals: serums,
      source: 'TEST_MOCK'
    } as any);

    try {
      const res = await app.request('/best/niacinamide-serums-india?utm_source=yt_short_1');
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain('rel="sponsored noopener noreferrer"');
      expect(html).toContain('utm_source=yt_short_1');
      expect(html).toContain('placement=best_hub_pick');
      expect(html).toContain('placement=best_hub_table');
      expect(html).not.toContain('utm_source=best_hub_pick');
      expect(html).not.toContain('utm_source=best_hub_table');

      // Exercise /api/v1/public/amazon-redirect?utm_source=yt_short_1&dealId=... to verify D1 referral_click_events source attribution
      const redirRes = await app.request(
        '/api/v1/public/amazon-redirect?q=Asaya+10%25+Niacinamide&dealId=deal_asaya_10_niacinamide_serum_30ml&utm_source=yt_short_1&placement=best_hub_pick',
        { headers: { 'x-test-traffic': 'true' } }
      );
      expect(redirRes.status).toBe(200);

      const row = getDb().prepare(
        `SELECT offer_id, placement, source, device_class FROM referral_click_events WHERE offer_id = ? AND source = ? ORDER BY created_at DESC LIMIT 1`
      ).get('deal_asaya_10_niacinamide_serum_30ml', 'yt_short_1') as any;

      expect(row).toBeDefined();
      expect(row.source).toBe('yt_short_1');
      expect(row.placement).toBe('best_hub_pick');
      expect(row.device_class).toBe('test');
    } finally {
      if (prevTag === undefined) delete process.env.AMAZON_AFFILIATE_TAG;
      else process.env.AMAZON_AFFILIATE_TAG = prevTag;
    }
  });

  it('6. Hides all /api/v1/public/amazon-redirect buttons across /deals, /deals/:slug, /vs/, and /best/ when AMAZON_AFFILIATE_TAG is unset', () => {
    const prevTag = process.env.AMAZON_AFFILIATE_TAG;
    delete process.env.AMAZON_AFFILIATE_TAG;
    try {
      const serums = createVerifiedLiveSkincareSerums('2026-11-25T15:00:00.000Z');
      const cfg = {
        siteName: 'AI Marketing Organization',
        authorName: 'Editorial Desk',
        contactEmail: 'editorial@ai-marketing-organization.onrender.com',
        siteUrl: 'https://ai-marketing-organization.onrender.com'
      };
      const ssg = StaticSiteGenerator.getInstance();
      const pairs = generateComparisonPairs(serums, 5);
      const hubs = generateBuyerIntentHubs(serums, cfg.siteUrl, 5);
      const niaHub = hubs.find(h => h.intentSlug === 'niacinamide-serums-india')!;

      const rendered = [
        ssg.renderDealsHtml(serums, cfg),
        ssg.renderDealDetailHtml(serums[0], serums.slice(1, 3), cfg),
        ssg.renderComparisonHtml(pairs[0], cfg, pairs),
        ssg.renderBuyerGuideHtml(niaHub, hubs, pairs, cfg, { attribution: { utmSource: 'yt_short_1' } })
      ];

      for (const html of rendered) {
        expect(html).not.toContain('/api/v1/public/amazon-redirect');
        expect(html).toContain('/api/v1/public/deals/');
        expect(html).toContain('rel="sponsored noopener noreferrer"');
      }
    } finally {
      if (prevTag !== undefined) process.env.AMAZON_AFFILIATE_TAG = prevTag;
    }
  });
});
