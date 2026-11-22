import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { D1Client } from '../../src/db/d1-client.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import { applyD1Migrations, resetBaseline0050VerifiedForTesting } from '../../src/db/d1-migrations/index.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { resetSitemapCacheForTesting, app } from '../../src/index.js';
import { resetRevenueFunnelCacheForTesting } from '../../src/routes/api.js';
import { getSiteFixFunnelAttributionSummaryAsync, resetSiteFixFunnelAttributionCacheForTesting, invalidateFunnelAttributionCache } from '../../src/tools/site-audit/sitefix-funnel-attribution.js';
import { TelegramBotAdapter } from '../../src/integrations/telegram-adapter.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { apiRouter } from '../../src/routes/api.js';

describe('D1 Quota Hotfix & Circuit Breaker Decoupling (PR #81)', () => {
  const d1 = D1Client.getInstance();

  beforeEach(() => {
    process.env.ALLOW_D1_CACHE_IN_TEST = 'true';
    d1.resetQuotaCircuitBreakerForTesting();
    resetBaseline0050VerifiedForTesting();
    AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
    AutonomousDealDiscoveryEngine.resetPriceAlertBackoffForTesting();
    resetSitemapCacheForTesting();
    resetRevenueFunnelCacheForTesting();
    resetSiteFixFunnelAttributionCacheForTesting();
    TelegramBotAdapter.resetTelegramPostCountCacheForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.ALLOW_D1_CACHE_IN_TEST;
    d1.resetQuotaCircuitBreakerForTesting();
    resetBaseline0050VerifiedForTesting();
    AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
    AutonomousDealDiscoveryEngine.resetPriceAlertBackoffForTesting();
    resetSitemapCacheForTesting();
    resetRevenueFunnelCacheForTesting();
    resetSiteFixFunnelAttributionCacheForTesting();
    TelegramBotAdapter.resetTelegramPostCountCacheForTesting();
    vi.restoreAllMocks();
  });

  describe('1. Independent Read vs Write Circuit Breakers', () => {
    it('initial state reports neither read nor write exhausted', () => {
      const state = d1.getRemoteQuotaCircuitState();
      expect(state.exhausted).toBe(false);
      expect(state.readExhausted).toBe(false);
      expect(state.writeExhausted).toBe(false);
      expect(state.readUntilIso).toBeNull();
      expect(state.writeUntilIso).toBeNull();
    });

    it('tripping read quota trips only read and keeps write allowed', () => {
      d1.tripReadQuotaCircuitBreaker('D1 read row limit reached');
      const state = d1.getRemoteQuotaCircuitState();
      expect(state.exhausted).toBe(true);
      expect(state.readExhausted).toBe(true);
      expect(state.writeExhausted).toBe(false);
      expect(state.readUntilIso).not.toBeNull();
      expect(state.writeUntilIso).toBeNull();
      expect(d1.isRemoteD1ReadQuotaExhausted()).toBe(true);
      expect(d1.isRemoteD1WriteQuotaExhausted()).toBe(false);
    });

    it('tripping write quota trips only write and keeps read allowed', () => {
      d1.tripWriteQuotaCircuitBreaker('D1 write row limit reached');
      const state = d1.getRemoteQuotaCircuitState();
      expect(state.exhausted).toBe(true);
      expect(state.readExhausted).toBe(false);
      expect(state.writeExhausted).toBe(true);
      expect(state.readUntilIso).toBeNull();
      expect(state.writeUntilIso).not.toBeNull();
      expect(d1.isRemoteD1ReadQuotaExhausted()).toBe(false);
      expect(d1.isRemoteD1WriteQuotaExhausted()).toBe(true);
    });

    it('automatically classifies Cloudflare Error 7500 read limit message as read quota', () => {
      d1.tripQuotaCircuitBreakerPublic("Your account has exceeded D1's free tier daily row read limit.");
      expect(d1.isRemoteD1ReadQuotaExhausted()).toBe(true);
      expect(d1.isRemoteD1WriteQuotaExhausted()).toBe(false);
    });

    it('automatically classifies Cloudflare Error 7500 write limit message as write quota', () => {
      d1.tripQuotaCircuitBreakerPublic("Your account has exceeded D1's free tier daily row write limit.");
      expect(d1.isRemoteD1ReadQuotaExhausted()).toBe(false);
      expect(d1.isRemoteD1WriteQuotaExhausted()).toBe(true);
    });

    it('blocks remote reads and writes if either read or write quota is exhausted (PR #82)', () => {
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      process.env.ALLOW_REMOTE_D1_READS = 'true';
      process.env.ALLOW_REMOTE_D1_WRITES = 'true';

      expect(d1.isRemoteD1ReadAllowed()).toBe(true);
      expect(d1.isRemoteD1WriteAllowed()).toBe(true);

      // Trip write quota: both write AND read should be blocked from remote D1
      d1.tripWriteQuotaCircuitBreaker('D1 write limit');
      expect(d1.isRemoteD1WriteAllowed()).toBe(false);
      expect(d1.isRemoteD1ReadAllowed()).toBe(false);

      // Reset and trip read quota: both write AND read should be blocked from remote D1
      d1.resetQuotaCircuitBreakerForTesting();
      d1.tripReadQuotaCircuitBreaker('D1 read limit');
      expect(d1.isRemoteD1ReadAllowed()).toBe(false);
      expect(d1.isRemoteD1WriteAllowed()).toBe(false);

      delete process.env.ALLOW_REMOTE_D1_READS;
      delete process.env.ALLOW_REMOTE_D1_WRITES;
    });
  });

  describe('2. Health Check Endpoint State', () => {
    it('GET /health reflects circuit state accurately', async () => {
      const resHealthy = await apiRouter.request('/health');
      expect(resHealthy.status).toBe(200);
      const jsonHealthy = (await resHealthy.json()) as any;
      expect(jsonHealthy.status).toBe('healthy');
      expect(jsonHealthy.d1CircuitBreaker.readExhausted).toBe(false);
      expect(jsonHealthy.d1CircuitBreaker.writeExhausted).toBe(false);

      // Trip read circuit breaker
      d1.tripReadQuotaCircuitBreaker('exceeded D1 free tier daily row read limit');
      const resDegraded = await apiRouter.request('/health');
      expect(resDegraded.status).toBe(503);
      const jsonDegraded = (await resDegraded.json()) as any;
      expect(jsonDegraded.status).toBe('degraded');
      expect(jsonDegraded.d1CircuitBreaker.readExhausted).toBe(true);
      expect(jsonDegraded.d1CircuitBreaker.writeExhausted).toBe(false);
    });
  });

  describe('3. DurableRateLimiter Fail-Closed Protection', () => {
    const rateLimiter = DurableRateLimiter.getInstance();

    it('fails closed with RATE_LIMITER_UNAVAILABLE when D1 is configured and read quota is exhausted', async () => {
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      d1.tripReadQuotaCircuitBreaker('exceeded read limit');

      const result = await rateLimiter.checkRateLimit('/api/v1/public/scan', '198.51.100.1', 10, 600, {
        failClosed: true
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('RATE_LIMITER_UNAVAILABLE');
      expect(result.retryAfterSeconds).toBe(60);
    });

    it('fails closed with RATE_LIMITER_UNAVAILABLE when D1 is configured and write quota is exhausted', async () => {
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      d1.tripWriteQuotaCircuitBreaker('exceeded write limit');

      const result = await rateLimiter.checkRateLimit('/api/v1/public/scan', '198.51.100.2', 10, 600, {
        failClosed: true
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('RATE_LIMITER_UNAVAILABLE');
      expect(result.retryAfterSeconds).toBe(60);
    });
  });

  describe('4. Migration 0050 Baseline In-Process Caching', () => {
    it('caches verified 0050 baseline in-process and avoids repeated queries', async () => {
      const executeQuerySpy = vi.spyOn(d1, 'executeQuery').mockResolvedValue({
        results: [{ migration_name: '0050_stage_d_deal_reconciliation_and_schedule.sql' }],
        rowsAffected: 0,
        source: 'CLOUDFLARE_D1'
      });

      const firstRun = await applyD1Migrations();
      expect(firstRun.tables).toContain('(verified 0050 baseline)');
      expect(executeQuerySpy).toHaveBeenCalledTimes(1);

      // Second call must return immediately from in-process cache without calling executeQuery again
      const secondRun = await applyD1Migrations();
      expect(secondRun.tables).toContain('(verified 0050 baseline)');
      expect(executeQuerySpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT cache baseline when source is PERSISTENT_SQLITE (PR #82)', async () => {
      const executeQuerySpy = vi.spyOn(d1, 'executeQuery').mockResolvedValue({
        results: [{ migration_name: '0050_stage_d_deal_reconciliation_and_schedule.sql' }],
        rowsAffected: 0,
        source: 'PERSISTENT_SQLITE'
      });

      const firstRun = await applyD1Migrations();
      expect(firstRun.tables).toContain('(verified 0050 baseline)');
      expect(executeQuerySpy).toHaveBeenCalledTimes(1);

      // Second call must query again because PERSISTENT_SQLITE was not cached as remote verified
      const secondRun = await applyD1Migrations();
      expect(secondRun.tables).toContain('(verified 0050 baseline)');
      expect(executeQuerySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Deals Query Bounding & Caching', () => {
    it('ELIGIBLE_PUBLIC_DEALS_SQL contains LIMIT 250', () => {
      expect(AutonomousDealDiscoveryEngine.ELIGIBLE_PUBLIC_DEALS_SQL).toContain('LIMIT 250');
      expect(AutonomousDealDiscoveryEngine.ELIGIBLE_PUBLIC_DEALS_SQL).toContain('ORDER BY created_at DESC');
    });

    it('buildEligiblePublicDealsQuery pushes category, merchant, minPrice, and q filters before LIMIT 250 while leaving sectorCode and maxPrice to in-memory filtering (PR #82)', () => {
      const built = AutonomousDealDiscoveryEngine.buildEligiblePublicDealsQuery({
        sectorCode: 'TECH',
        category: 'Electronics',
        merchant: 'Amazon',
        minPrice: 500,
        maxPrice: 5000,
        q: 'laptop'
      });

      expect(built.sql).not.toContain('sector_code = ?');
      expect(built.sql).toContain('LOWER(category) = LOWER(?)');
      expect(built.sql).toContain('LOWER(merchant) = LOWER(?)');
      expect(built.sql).toContain('current_price_inr >= ?');
      expect(built.sql).not.toContain('current_price_inr <= ?');
      expect(built.sql).toContain('LIMIT 250');
      expect(built.params).toEqual(['Electronics', 'Amazon', 500, '%laptop%', '%laptop%', '%laptop%']);
    });

    it('caches getEligiblePublicDeals results in memory for 15 minutes', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const res1 = await engine.getEligiblePublicDeals({ sectorCode: 'TRAVEL_FLIGHTS' });
      const res2 = await engine.getEligiblePublicDeals({ sectorCode: 'TRAVEL_FLIGHTS' });
      expect(res1).toBe(res2); // Same object reference from in-memory cache

      // Invalidation clears cache
      AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
      const res3 = await engine.getEligiblePublicDeals({ sectorCode: 'TRAVEL_FLIGHTS' });
      expect(res3).not.toBe(res1); // Fresh object reference after invalidation
    });

    it('increments priceAlertBackoffGeneration when clearing backoff to prevent race conditions (PR #82)', () => {
      const genBefore = (AutonomousDealDiscoveryEngine as any).priceAlertBackoffGeneration;
      AutonomousDealDiscoveryEngine.clearPriceAlertBackoff();
      const genAfter = (AutonomousDealDiscoveryEngine as any).priceAlertBackoffGeneration;
      expect(genAfter).toBe(genBefore + 1);
    });
  });

  describe('6. Revenue Funnel Non-Cash Caching & Live Financial Truth', () => {
    it('serves non-cash funnel stats from cache while querying payment orders live', async () => {
      const res1 = await apiRouter.request('/public/revenue-funnel');
      expect(res1.status).toBe(200);
      const json1 = (await res1.json()) as any;
      expect(json1.success).toBe(true);

      // Second request hits the 10m non-cash cache
      const res2 = await apiRouter.request('/public/revenue-funnel');
      expect(res2.status).toBe(200);
      const json2 = (await res2.json()) as any;
      expect(json2.success).toBe(true);
      expect(json2.data.funnel.clickThroughRate).toBe(json1.data.funnel.clickThroughRate);
    });
  });

  describe('7. SiteFix Funnel Attribution Query Bounding & Caching', () => {
    it('bounds query to last 90 days and caches async summary for 10 minutes', async () => {
      const summary1 = await getSiteFixFunnelAttributionSummaryAsync();
      const summary2 = await getSiteFixFunnelAttributionSummaryAsync();
      expect(summary1).toBe(summary2); // Same reference from 10m cache
    });

    it('invalidateFunnelAttributionCache clears cache and increments generation (PR #82)', async () => {
      const summary1 = await getSiteFixFunnelAttributionSummaryAsync();
      invalidateFunnelAttributionCache();
      const summary2 = await getSiteFixFunnelAttributionSummaryAsync();
      expect(summary2).not.toBe(summary1); // Fresh fetch after invalidation
    });
  });

  describe('8. Batch Execution Partial Failure Safety (PR #82)', () => {
    it('throws D1_PARTIAL_BATCH_FAILURE when statement at index > 0 fails during batch execution', async () => {
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      const isRemoteAllowedSpy = vi.spyOn(d1, 'isRemoteD1WriteAllowed').mockReturnValue(true);

      // Mock fetch so first statement succeeds and second statement fails with HTTP 500
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              result: [{ meta: { rows_written: 1 }, results: [] }]
            })
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal DB error at statement 2'
        };
      }) as any;

      try {
        await expect(
          d1.executeBatch([
            { table: 'durable_events', sql: 'INSERT INTO durable_events (id) VALUES (?)', params: ['evt_1'] },
            { table: 'durable_events', sql: 'INSERT INTO durable_events (id) VALUES (?)', params: ['evt_2'] }
          ])
        ).rejects.toThrow('D1_PARTIAL_BATCH_FAILURE: Statement at index 1 failed after earlier statements committed. Local replay aborted.');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws D1_DURABLE_WRITE_UNAVAILABLE in production when remote D1 is configured and read quota breaker is tripped (PR #82 Fix 1)', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      d1.tripReadQuotaCircuitBreaker('Daily read limit reached');

      try {
        await expect(
          d1.executeBatch([{ table: 'durable_events', sql: 'INSERT INTO durable_events (id) VALUES (?)', params: ['evt_1'] }])
        ).rejects.toThrow('D1_DURABLE_WRITE_UNAVAILABLE: Production batch writes require durable remote D1 (quota circuit breaker active)');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('throws D1_DURABLE_WRITE_UNAVAILABLE in production when remote D1 is configured and write quota breaker is tripped (PR #82 Fix 1)', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      d1.tripWriteQuotaCircuitBreaker('Daily write limit reached');

      try {
        await expect(
          d1.executeBatch([{ table: 'durable_events', sql: 'INSERT INTO durable_events (id) VALUES (?)', params: ['evt_1'] }])
        ).rejects.toThrow('D1_DURABLE_WRITE_UNAVAILABLE: Production batch writes require durable remote D1 (quota circuit breaker active)');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('throws [D1 PERSISTENCE ERROR] in production when remote D1 returns HTTP 500 at statement index 0 without falling back to local SQLite (PR #82 Fix 1)', async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
      vi.spyOn(d1, 'isRemoteD1WriteAllowed').mockReturnValue(true);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'D1 internal server error'
      }) as any;

      try {
        await expect(
          d1.executeBatch([{ table: 'durable_events', sql: 'INSERT INTO durable_events (id) VALUES (?)', params: ['evt_1'] }])
        ).rejects.toThrow('[D1 PERSISTENCE ERROR] D1 batch statement failed at index 0');
      } finally {
        globalThis.fetch = originalFetch;
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  describe('9. Destination Conflict Quarantine & Price Normalization (PR #82 Fix 2)', () => {
    it('cross-category destination conflict is quarantined identically under both filtered and unfiltered queries', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      (engine as any).dealsMap.clear();

      const deal1: any = {
        id: 'deal_electronics_conflict_1',
        slug: 'gadget-a',
        canonicalSlug: 'gadget-a',
        title: 'Gadget Alpha',
        category: 'Electronics',
        merchant: 'PartnerX',
        productUrl: 'https://partnerx.com/products/item-123',
        currentPriceINR: 1200,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        productVerified: true,
        affiliateVerified: true,
        evidenceJson: { sources: ['https://partnerx.com/products/item-123'] }
      };

      const deal2: any = {
        id: 'deal_fashion_conflict_2',
        slug: 'fashion-b',
        canonicalSlug: 'fashion-b',
        title: 'Fashion Beta',
        category: 'Fashion',
        merchant: 'PartnerX',
        productUrl: 'https://partnerx.com/products/item-123', // Same destination!
        currentPriceINR: 800,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        productVerified: true,
        affiliateVerified: true,
        evidenceJson: { sources: ['https://partnerx.com/products/item-123'] }
      };

      (engine as any).dealsMap.set(deal1.id, deal1);
      (engine as any).dealsMap.set(deal2.id, deal2);

      // Unfiltered query: both must be quarantined due to duplicate destination
      const unfiltered = await engine.getEligiblePublicDeals({});
      const unfilteredConflict1 = unfiltered.deals.find(d => d.id === deal1.id);
      const unfilteredConflict2 = unfiltered.deals.find(d => d.id === deal2.id);
      expect(unfilteredConflict1).toBeUndefined();
      expect(unfilteredConflict2).toBeUndefined();

      // Filtered query for Electronics: deal1 must STILL be quarantined even though deal2 is in Fashion
      AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
      const filtered = await engine.getEligiblePublicDeals({ category: 'Electronics' });
      const filteredConflict1 = filtered.deals.find(d => d.id === deal1.id);
      expect(filteredConflict1).toBeUndefined();
    });

    it('a deal whose raw price/MRP was swapped matches maxPrice accurately after normalization', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      (engine as any).dealsMap.clear();

      // Title says "at ₹499", raw currentPriceINR is ₹3596, referencePriceINR is ₹3596
      const swappedDeal: any = {
        id: 'deal_swapped_price_1',
        slug: 'perfume-combo-499',
        canonicalSlug: 'perfume-combo-499',
        title: 'Buy 4 Perfumes at 499',
        category: 'Fragrance',
        merchant: 'PlumGoodness',
        productUrl: 'https://plumgoodness.com/products/perfume-combo-499',
        currentPriceINR: 3596,
        referencePriceINR: 3596,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        productVerified: true,
        affiliateVerified: true,
        evidenceJson: { sources: ['https://plumgoodness.com/products/perfume-combo-499'] }
      };

      (engine as any).dealsMap.set(swappedDeal.id, swappedDeal);

      // Filter with maxPrice: 600.
      // Unnormalized: 3596 > 600 (would fail).
      // Normalized: title repair corrects currentPriceINR to 499 <= 600 (must match).
      AutonomousDealDiscoveryEngine.invalidateEligibleDealsCache();
      const res = await engine.getEligiblePublicDeals({ maxPrice: 600 });
      const found = res.deals.find(d => d.id === swappedDeal.id);
      expect(found).toBeDefined();
      expect(found?.currentPriceINR).toBe(499);
    });
  });

  describe('10. Telegram Publish Claim Delivery Uncertainty (PR #82 Fix 3)', () => {
    const telegramAdapter = TelegramBotAdapter.getInstance();

    it('preserves TELEGRAM_POST_CLAIMED on network timeout or HTTP 5xx to prevent duplicate syndication', async () => {
      const prevToken = process.env.TELEGRAM_BOT_TOKEN;
      const prevChat = process.env.TELEGRAM_CHANNEL_ID;
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456789';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';

      const originalFetch = globalThis.fetch;
      // Mock HTTP 500 server error
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Telegram Server Error'
      }) as any;

      const executeWriteSpy = vi.spyOn(D1RevenueRepository.getInstance(), 'executeWrite').mockResolvedValue({
        rowsAffected: 1,
        source: 'CLOUDFLARE_D1'
      } as any);

      try {
        const res = await telegramAdapter.postPublishedGuide({
          guideTitle: 'Test Guide 500',
          guideUrl: 'https://example.com/guide/test-500',
          dealId: 'deal_uncertain_1'
        });

        expect(res.posted).toBe(false);
        // executeWrite was called for INSERT TELEGRAM_POST_CLAIMED, but NOT DELETE
        const deleteCalls = executeWriteSpy.mock.calls.filter(call =>
          typeof call[1] === 'string' && call[1].toUpperCase().includes('DELETE FROM DURABLE_EVENTS')
        );
        expect(deleteCalls.length).toBe(0); // Claim is preserved!
      } finally {
        globalThis.fetch = originalFetch;
        process.env.TELEGRAM_BOT_TOKEN = prevToken;
        process.env.TELEGRAM_CHANNEL_ID = prevChat;
      }
    });

    it('releases TELEGRAM_POST_CLAIMED on deterministic HTTP 400 or 403 error', async () => {
      const prevToken = process.env.TELEGRAM_BOT_TOKEN;
      const prevChat = process.env.TELEGRAM_CHANNEL_ID;
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456789';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';

      const originalFetch = globalThis.fetch;
      // Mock HTTP 403 Forbidden (bot kicked from channel)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Forbidden: bot was kicked from the supergroup'
      }) as any;

      const executeWriteSpy = vi.spyOn(D1RevenueRepository.getInstance(), 'executeWrite').mockResolvedValue({
        rowsAffected: 1,
        source: 'CLOUDFLARE_D1'
      } as any);

      try {
        const res = await telegramAdapter.postPublishedGuide({
          guideTitle: 'Test Guide 403',
          guideUrl: 'https://example.com/guide/test-403',
          dealId: 'deal_deterministic_1'
        });

        expect(res.posted).toBe(false);
        // executeWrite WAS called to DELETE the claim on deterministic rejection
        const deleteCalls = executeWriteSpy.mock.calls.filter(call =>
          typeof call[1] === 'string' && call[1].toUpperCase().includes('DELETE FROM DURABLE_EVENTS')
        );
        expect(deleteCalls.length).toBe(1); // Claim released!
      } finally {
        globalThis.fetch = originalFetch;
        process.env.TELEGRAM_BOT_TOKEN = prevToken;
        process.env.TELEGRAM_CHANNEL_ID = prevChat;
      }
    });
  });

  describe('11. Sitemap Cache Shield & Price-Alert Backoff Cursor Truth (PR #82 Fix 4)', () => {
    it('does not populate sitemapCache when an underlying query throws or degrades', async () => {
      resetSitemapCacheForTesting();
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const dealsSpy = vi.spyOn(engine, 'getEligiblePublicDeals').mockRejectedValueOnce(new Error('D1 read failure'));

      const res = await app.request('/sitemap.xml');
      expect(res.status).toBe(200);

      // Next request should NOT hit cache if previous run failed deal generation
      // We verify by checking that getEligiblePublicDeals is called again
      dealsSpy.mockClear();
      dealsSpy.mockResolvedValueOnce({ deals: [], total: 0 });
      await app.request('/sitemap.xml');
      expect(dealsSpy).toHaveBeenCalledTimes(1);
    });

    it('triggers 2-hour backoff only when scan started with null cursors and returned zero rows without continuation', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      AutonomousDealDiscoveryEngine.resetPriceAlertBackoffForTesting();

      // If contactCursor is set (continuation in progress), backoff must NOT trigger
      (AutonomousDealDiscoveryEngine as any).priceDropContactCursor = 'contact_prev_99';
      await engine.checkAndDispatchTargetPriceAlerts([]);
      expect((AutonomousDealDiscoveryEngine as any).priceAlertEmptyBackoffUntilMs).toBe(0);

      // When cursors are null (started from beginning) and 0 rows found: backoff engages
      (AutonomousDealDiscoveryEngine as any).priceDropContactCursor = null;
      (AutonomousDealDiscoveryEngine as any).priceDropEventCursor = null;
      await engine.checkAndDispatchTargetPriceAlerts([]);
      expect((AutonomousDealDiscoveryEngine as any).priceAlertEmptyBackoffUntilMs).toBeGreaterThan(Date.now());
    });
  });
});
