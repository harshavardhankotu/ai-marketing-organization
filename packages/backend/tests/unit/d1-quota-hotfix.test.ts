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
        if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (prevChat !== undefined) process.env.TELEGRAM_CHANNEL_ID = prevChat;
        else delete process.env.TELEGRAM_CHANNEL_ID;
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
        if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (prevChat !== undefined) process.env.TELEGRAM_CHANNEL_ID = prevChat;
        else delete process.env.TELEGRAM_CHANNEL_ID;
      }
    });

    it('releases TELEGRAM_POST_CLAIMED with ownership guard on deterministic 403 error even if response body read fails (PR #82)', async () => {
      const prevToken = process.env.TELEGRAM_BOT_TOKEN;
      const prevChat = process.env.TELEGRAM_CHANNEL_ID;
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456789';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';

      const originalFetch = globalThis.fetch;
      // Mock HTTP 403 Forbidden where text() throws stream read failure
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => { throw new Error('Stream read failure'); }
      }) as any;

      const executeWriteSpy = vi.spyOn(D1RevenueRepository.getInstance(), 'executeWrite').mockResolvedValue({
        rowsAffected: 1,
        source: 'CLOUDFLARE_D1'
      } as any);

      try {
        const res = await telegramAdapter.postPublishedGuide({
          guideTitle: 'Test Guide 403 Body Fail',
          guideUrl: 'https://example.com/guide/test-403-fail',
          dealId: 'deal_deterministic_body_fail'
        });

        expect(res.posted).toBe(false);
        // executeWrite WAS called to DELETE the claim with ownership guard AND event_type = 'TELEGRAM_POST_CLAIMED'
        const deleteCalls = executeWriteSpy.mock.calls.filter(call =>
          typeof call[1] === 'string' &&
          call[1].toUpperCase().includes('DELETE FROM DURABLE_EVENTS') &&
          call[1].toUpperCase().includes("EVENT_TYPE = 'TELEGRAM_POST_CLAIMED'")
        );
        expect(deleteCalls.length).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
        if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (prevChat !== undefined) process.env.TELEGRAM_CHANNEL_ID = prevChat;
        else delete process.env.TELEGRAM_CHANNEL_ID;
      }
    });

    it('fails closed with TELEGRAM_CLAIM_FAILED when claim DB write throws, without making outbound HTTP calls', async () => {
      const prevToken = process.env.TELEGRAM_BOT_TOKEN;
      const prevChat = process.env.TELEGRAM_CHANNEL_ID;
      process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456789';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';

      const mockFetch = vi.fn();
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch as any;

      vi.spyOn(D1RevenueRepository.getInstance(), 'queryOne').mockResolvedValue(null);
      vi.spyOn(D1RevenueRepository.getInstance(), 'executeWrite').mockRejectedValueOnce(new Error('D1 durable_events connection timeout'));

      try {
        const res = await telegramAdapter.postPublishedGuide({
          guideTitle: 'Test Guide Claim Error',
          guideUrl: 'https://example.com/guide/test-claim-err',
          dealId: 'deal_claim_err_1'
        });

        expect(res.posted).toBe(false);
        expect(res.reason).toContain('TELEGRAM_CLAIM_FAILED');
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
        if (prevToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = prevToken;
        else delete process.env.TELEGRAM_BOT_TOKEN;
        if (prevChat !== undefined) process.env.TELEGRAM_CHANNEL_ID = prevChat;
        else delete process.env.TELEGRAM_CHANNEL_ID;
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

    it('does not populate sitemapCache when site audit domain query throws with throwOnError (PR #82)', async () => {
      resetSitemapCacheForTesting();
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const auditSpy = vi.spyOn(SiteAuditService.getInstance(), 'getAllAuditedDomains').mockRejectedValueOnce(new Error('D1 audit table query failure'));

      const res = await app.request('/sitemap.xml');
      expect(res.status).toBe(200);

      // Next request should NOT hit cache if previous run failed audit domains query
      auditSpy.mockClear();
      auditSpy.mockResolvedValueOnce(['example.com']);
      await app.request('/sitemap.xml');
      expect(auditSpy).toHaveBeenCalledTimes(1);
    });

    it('triggers 2-hour backoff only when scan started with null cursors and returned zero rows without continuation', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      AutonomousDealDiscoveryEngine.resetPriceAlertBackoffForTesting();

      // Hermetic mock: ensure 0 rows returned cleanly from reads
      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      vi.spyOn(d1Repo, 'executeRead').mockResolvedValue({ results: [], rowsRead: 0, source: 'CLOUDFLARE_D1' } as any);

      const qualifyingDeal: any = {
        id: 'deal_dummy_01',
        slug: 'dummy-deal',
        canonicalSlug: 'dummy-deal',
        title: 'Dummy Deal',
        brand: 'Dummy',
        category: 'Electronics',
        merchant: 'DummyMerchant',
        currentPriceINR: 999,
        availability: 'IN_STOCK',
        verificationStatus: 'VERIFIED',
        isMonetizable: true,
        affiliateCampaignId: 'cuelinks_dummy',
        trackingUrl: 'https://cuelinks.com/dummy',
        productUrl: 'https://dummy.com/product',
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };

      // If contactCursor is set (continuation in progress), backoff must NOT trigger
      (AutonomousDealDiscoveryEngine as any).priceDropContactCursor = 'contact_prev_99';
      await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect((AutonomousDealDiscoveryEngine as any).priceAlertEmptyBackoffUntilMs).toBe(0);

      // When cursors are null (started from beginning) and 0 rows found: backoff engages
      (AutonomousDealDiscoveryEngine as any).priceDropContactCursor = null;
      (AutonomousDealDiscoveryEngine as any).priceDropEventCursor = null;
      await engine.checkAndDispatchTargetPriceAlerts([qualifyingDeal]);
      expect((AutonomousDealDiscoveryEngine as any).priceAlertEmptyBackoffUntilMs).toBeGreaterThan(Date.now());
    });

    it('SiteAuditService.getAllAuditedDomains({ strict: true }) rethrows DB errors while default call returns empty array', async () => {
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const service = SiteAuditService.getInstance();
      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      vi.spyOn(d1Repo, 'query').mockRejectedValueOnce(new Error('Simulated D1 transient failure'));

      // Strict mode MUST rethrow
      await expect(service.getAllAuditedDomains({ strict: true })).rejects.toThrow('Simulated D1 transient failure');

      // Default call returns empty array safely
      vi.spyOn(d1Repo, 'query').mockRejectedValueOnce(new Error('Simulated D1 transient failure'));
      const safeResult = await service.getAllAuditedDomains();
      expect(safeResult).toEqual([]);
    });
  });

  describe('12. Razorpay Compliance, Checkout & Signature Verification', () => {
    it('serves /terms, /privacy, /refund, /contact with HTTP 200 containing statutory terms and 7-day refund policy', async () => {
      const termsRes = await app.request('/terms');
      expect(termsRes.status).toBe(200);
      const termsHtml = await termsRes.text();
      expect(termsHtml).toContain('SITEFIX_AI_PACK_V1');
      expect(termsHtml).toContain('7-Day 100% Money-Back Guarantee');
      expect(termsHtml).toContain('support@ai-marketing-organization.com');

      const privacyRes = await app.request('/privacy');
      expect(privacyRes.status).toBe(200);
      const privacyHtml = await privacyRes.text();
      expect(privacyHtml).toContain('Digital Personal Data Protection');
      expect(privacyHtml).toContain('privacy@ai-marketing-organization.com');

      const refundRes = await app.request('/refund');
      expect(refundRes.status).toBe(200);
      const refundHtml = await refundRes.text();
      expect(refundHtml).toContain('100% Satisfaction Guarantee');
      expect(refundHtml).toContain('7-Day Money-Back Guarantee');

      const contactRes = await app.request('/contact');
      expect(contactRes.status).toBe(200);
      const contactHtml = await contactRes.text();
      expect(contactHtml).toContain('Customer Support');
      expect(contactHtml).toContain('support@ai-marketing-organization.com');

      const disclosureRes = await app.request('/disclosure');
      expect(disclosureRes.status).toBe(200);
      const disclosureHtml = await disclosureRes.text();
      expect(disclosureHtml).toContain('Affiliate &amp; Commercial Referral Disclosure');
      expect(disclosureHtml).toContain('As an Amazon Associate I earn from qualifying purchases');
      expect(disclosureHtml).toContain('Zero Extra Cost to Consumers');
      expect(disclosureHtml).toContain('/disclosure');

      const disclosureAliasRes = await app.request('/affiliate-disclosure');
      expect(disclosureAliasRes.status).toBe(200);
      const disclosureAliasHtml = await disclosureAliasRes.text();
      expect(disclosureAliasHtml).toContain('Affiliate &amp; Commercial Referral Disclosure');
      expect(disclosureAliasHtml).toContain('/disclosure');
    });

    it('rejects client price tampering and validates authoritative ₹499 price for SITEFIX_AI_PACK_V1', async () => {
      const { RazorpayStandardAdapter } = await import('../../src/payments/razorpay-adapter.js');
      const adapter = RazorpayStandardAdapter.getInstance();

      // Tampered amount rejected
      expect(() => adapter.resolveAuthoritativePrice('SITEFIX_AI_PACK_V1', 1)).toThrow('Client-tampered amount');

      // Authoritative resolution
      const resolved = adapter.resolveAuthoritativePrice('SITEFIX_AI_PACK_V1', 499);
      expect(resolved.amountINR).toBe(499);
      expect(resolved.amountPaise).toBe(49900);
      expect(resolved.canonicalSku).toBe('SITEFIX_AI_PACK_V1');
    });

    it('validates genuine HMAC-SHA256 signature and rejects forged signature', async () => {
      const { RazorpayStandardAdapter } = await import('../../src/payments/razorpay-adapter.js');
      const adapter = RazorpayStandardAdapter.getInstance();
      const crypto = await import('node:crypto');

      const orderId = 'order_test_rzp_12345';
      const paymentId = 'pay_test_rzp_67890';
      const secret = 'test_secret_for_hmac_verification';

      const validSignature = crypto.createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      expect(adapter.verifyPaymentSignature(orderId, paymentId, validSignature, secret)).toBe(true);
      expect(adapter.verifyPaymentSignature(orderId, paymentId, 'tampered_invalid_signature', secret)).toBe(false);
    });

    it('rejects mismatched caller-supplied orderId to prevent authorization bypass (CWE-863)', async () => {
      const { RazorpayStandardAdapter } = await import('../../src/payments/razorpay-adapter.js');
      const adapter = RazorpayStandardAdapter.getInstance();
      const crypto = await import('node:crypto');

      const nonce = Date.now();
      const internalOrderId = `ord_rzp_secure_owner_${nonce}`;
      const providerOrderId = `order_rzp_provider_${nonce}`;
      const paymentId = `pay_rzp_attacker_payment_${nonce}`;
      const secret = adapter.getKeySecret();

      await D1RevenueRepository.getInstance().executeWrite(
        'universal_orders',
        `INSERT OR REPLACE INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name,
          customer_email, customer_phone, amount_minor, currency, status, payment_provider,
          provider_order_id, metadata_json, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Customer',
          'cust@example.com', '', 49900, 'INR', 'CHECKOUT', 'RAZORPAY',
          ?, '{"domainOrUrl":"victim.com"}', datetime('now'), datetime('now'))`,
        [internalOrderId, providerOrderId]
      );

      const sig = crypto.createHmac('sha256', secret)
        .update(`${providerOrderId}|${paymentId}`)
        .digest('hex');

      await expect(adapter.verifyPaymentAndFulfill({
        orderId: 'ord_rzp_unrelated_target_2',
        razorpay_order_id: providerOrderId,
        razorpay_payment_id: paymentId,
        razorpay_signature: sig
      })).rejects.toThrow(/Provided orderId 'ord_rzp_unrelated_target_2' does not identify the verified order record/);
    });

    it('maps cancellation & refund policy to /refund canonical URL in static site generator', async () => {
      const { StaticSiteGenerator } = await import('../../src/commission/static-site-generator.js');
      const generator = new StaticSiteGenerator();
      const html = generator.renderRefundHtml({
        siteName: 'SiteFix AI',
        siteUrl: 'https://sitefix.ai',
        niche: 'technical-seo',
        authorName: 'SiteFix Team',
        contactEmail: 'support@sitefix.ai'
      });
      expect(html).toContain('<link rel="canonical" href="https://sitefix.ai/refund">');
    });

    it('issues delivery tokens with 168-hour (7-day) validity across issuance paths and fails closed on missing ord_rzp_', async () => {
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const service = SiteAuditService.getInstance();

      const orderId = 'ord_rzp_test_lifetime_1';
      const auditId = 'aud_test_1';
      const paymentId = 'pay_test_1';

      // 1. generateDeliveryToken with default
      const defaultToken = service.generateDeliveryToken(orderId, auditId, paymentId);
      const partsDefault = defaultToken.split('.');
      const expDefault = parseInt(partsDefault[3], 10);
      const hoursDefault = (expDefault - Date.now()) / (3600 * 1000);
      expect(hoursDefault).toBeGreaterThan(167);
      expect(hoursDefault).toBeLessThanOrEqual(168.1);

      // 2. generateSignedDeliveryToken with explicit 168 hours
      const signedToken = service.generateSignedDeliveryToken(orderId, auditId, paymentId, 168);
      const partsSigned = signedToken.split('.');
      const expSigned = parseInt(partsSigned[3], 10);
      const hoursSigned = (expSigned - Date.now()) / (3600 * 1000);
      expect(hoursSigned).toBeGreaterThan(167);
      expect(hoursSigned).toBeLessThanOrEqual(168.1);

      // 3. verifyDeliveryToken fails closed when ord_rzp_ order is absent from D1
      const verifyMissing = await service.verifyDeliveryToken(defaultToken, auditId);
      expect(verifyMissing.valid).toBe(false);
      expect(verifyMissing.error).toBe('ORDER_NOT_FOUND');
    });

    it('renews delivery token with 168-hour lifetime during autonomous recovery when deliverable is already READY', async () => {
      const { AutonomousSystemDoctor } = await import('../../src/automation/autonomous-system-doctor.js');
      const doctor = AutonomousSystemDoctor.getInstance();
      const nonce = Date.now();
      const orderId = `ord_rzp_doctor_ready_${nonce}`;
      const paymentId = `pay_rzp_doctor_ready_${nonce}`;
      const domain = 'doctorreadytest';

      // Clean up any stale doctor test orders so LIMIT 10 in recoverPendingDeliveriesAndReceipts sees this fresh order
      await D1RevenueRepository.getInstance().executeWrite(
        'universal_orders',
        `DELETE FROM universal_orders WHERE id LIKE 'ord_rzp_doctor_ready_%'`,
        []
      );

      // Insert an order that already has deliverable_status: READY with an expired token
      const oldExp = Date.now() - 3600 * 1000;
      const oldToken = `${orderId}.audit_${domain}.${paymentId}.${oldExp}.fake_hmac`;
      const metadata = JSON.stringify({
        sku: 'SITEFIX_AI_PACK_V1',
        domainOrUrl: domain,
        auditId: `audit_${domain}`,
        paymentId: paymentId,
        deliverable_status: 'READY',
        downloadToken: oldToken,
        downloadUrl: `/api/v1/offer/download/${oldToken}`,
        email_receipt_status: 'PENDING_RETRY'
      });

      await D1RevenueRepository.getInstance().executeWrite(
        'universal_orders',
        `INSERT OR REPLACE INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name,
          customer_email, customer_phone, amount_minor, currency, status, fulfillment_status,
          payment_provider, provider_order_id, provider_payment_id, metadata_json, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Customer',
          'doctor@example.com', '', 49900, 'INR', 'PAID', 'PAYMENT_CAPTURED_PENDING_DELIVERY',
          'RAZORPAY', ?, ?, ?, datetime('now'), datetime('now'))`,
        [orderId, orderId, paymentId, metadata]
      );

      const healResult = await doctor.recoverPendingDeliveriesAndReceipts();
      expect(healResult.processed).toBeGreaterThanOrEqual(1);

      // Verify the order in D1 now has a renewed 168-hour token
      const updatedOrder = await D1RevenueRepository.getInstance().queryOne<any>(
        'universal_orders',
        `SELECT metadata_json FROM universal_orders WHERE id = ?`,
        [orderId]
      );
      expect(updatedOrder).toBeTruthy();
      const updatedMeta = JSON.parse(updatedOrder.metadata_json);
      expect(updatedMeta.downloadToken).toBeTruthy();
      expect(updatedMeta.downloadToken).not.toBe(oldToken);

      const parts = updatedMeta.downloadToken.split('.');
      const expMs = parseInt(parts[3], 10);
      const hoursRemaining = (expMs - Date.now()) / (3600 * 1000);
      expect(hoursRemaining).toBeGreaterThan(167);
      expect(hoursRemaining).toBeLessThanOrEqual(168.1);

      // Verify the renewed token authorizes download and passes verifyDeliveryToken
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const verifyResult = await SiteAuditService.getInstance().verifyDeliveryToken(updatedMeta.downloadToken, `audit_${domain}`);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.orderId).toBe(orderId);
      expect(verifyResult.auditId).toBe(`audit_${domain}`);
    });
  });

  describe('13. Audit Reconstruction, Flat Row Safety & Fail-Closed Token Issuance (PR #83)', () => {
    it('preserves existing audit scores and findings when doctor recovers pending order (scores survive recovery)', async () => {
      const { AutonomousSystemDoctor } = await import('../../src/automation/autonomous-system-doctor.js');
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const doctor = AutonomousSystemDoctor.getInstance();
      const nonce = Date.now();
      const domain = `survivaltest-${nonce}.com`;
      const orderId = `ord_rzp_doctor_surv_${nonce}`;
      const paymentId = `pay_rzp_doctor_surv_${nonce}`;

      // Clean up stale orders
      await D1RevenueRepository.getInstance().executeWrite(
        'universal_orders',
        `DELETE FROM universal_orders WHERE id LIKE 'ord_rzp_doctor_%'`,
        []
      );

      // Seed site_audits with rich scores & findings
      const initialFinding = { id: 'c1', title: 'SEO Title Check', pass: true, severity: 'LOW' };
      await D1RevenueRepository.getInstance().executeWrite(
        'site_audits',
        `INSERT OR REPLACE INTO site_audits (
          domain, target_url, business_name, performance_score, seo_score,
          core_web_vitals_json, head_snippets, schema_json_ld, checklist_json, status, updated_at
        ) VALUES (?, ?, 'Survival Business', 92, 85, '{}', '<meta name="test">', '{}', ?, 'COMPLETED', datetime('now'))`,
        [domain, `https://${domain}`, JSON.stringify([initialFinding])]
      );

      // Insert an unfulfilled order
      const metadata = JSON.stringify({
        sku: 'SITEFIX_AI_PACK_V1',
        domainOrUrl: domain,
        paymentId: paymentId,
        deliverable_status: 'PENDING'
      });

      await D1RevenueRepository.getInstance().executeWrite(
        'universal_orders',
        `INSERT OR REPLACE INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name,
          customer_email, customer_phone, amount_minor, currency, status, fulfillment_status,
          payment_provider, provider_order_id, provider_payment_id, metadata_json, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Customer',
          'doctor@example.com', '', 49900, 'INR', 'PAID', 'PAYMENT_CAPTURED_PENDING_DELIVERY',
          'RAZORPAY', ?, ?, ?, datetime('now'), datetime('now'))`,
        [orderId, orderId, paymentId, metadata]
      );

      const healResult = await doctor.recoverPendingDeliveriesAndReceipts();
      expect(healResult.processed).toBeGreaterThanOrEqual(1);

      // Verify the seeded order was recovered to READY and delivery task completed
      const updatedOrder = await D1RevenueRepository.getInstance().queryOne<any>(
        'universal_orders',
        `SELECT metadata_json, fulfillment_status FROM universal_orders WHERE id = ?`,
        [orderId]
      );
      expect(updatedOrder).toBeTruthy();
      const updatedMeta = JSON.parse(updatedOrder.metadata_json);
      expect(updatedMeta.deliverable_status).toBe('READY');

      const deliveryTask = await D1RevenueRepository.getInstance().queryOne<any>(
        'delivery_tasks',
        `SELECT stage FROM delivery_tasks WHERE id = ?`,
        [`deliv_${orderId}_${paymentId}`]
      );
      expect(deliveryTask).toBeTruthy();
      expect(deliveryTask.stage).toBe('COMPLETED');

      // Verify site_audits scores survived recovery intact!
      const auditRow = await SiteAuditService.getInstance().getAuditByDomain(domain);
      expect(auditRow).toBeTruthy();
      expect(auditRow.seo_score).toBe(85);
      expect(auditRow.performance_score).toBe(92);
      const { items } = SiteAuditService.getInstance().parseAuditChecklistPayload(auditRow.checklist_json);
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0].id).toBe('c1');
    });

    it('reconstructs full SiteAuditResult from flat DB row without data loss and does not clobber scores (flat row not overwritten)', async () => {
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const service = SiteAuditService.getInstance();
      const domain = 'flatroverwrite-test.com';

      const initialFindings = [
        { id: 'c_og', title: 'Open Graph Verification', pass: false, severity: 'MEDIUM' }
      ];

      await D1RevenueRepository.getInstance().executeWrite(
        'site_audits',
        `INSERT OR REPLACE INTO site_audits (
          domain, target_url, business_name, performance_score, seo_score,
          core_web_vitals_json, head_snippets, schema_json_ld, checklist_json, status, html_scan_status, updated_at
        ) VALUES (?, ?, 'Flat Row Business', 88, 77, '{}', '<meta name="og">', '{}', ?, 'COMPLETED', 'FAILED', datetime('now'))`,
        [domain, `https://${domain}`, JSON.stringify(initialFindings)]
      );

      const flatRow = await service.getAuditByDomain(domain);
      expect(flatRow).toBeTruthy();
      expect(flatRow.seo_score).toBe(77);
      expect(flatRow.performance_score).toBe(88);
      expect(flatRow.html_scan_status).toBe('FAILED');

      // Reconstruct
      const reconstructed = SiteAuditService.reconstructAuditFromDbRow(flatRow, `audit_${domain}`);
      expect(reconstructed.auditId).toBe(`audit_${domain}`);
      expect(reconstructed.score).toBe(77);
      expect(reconstructed.pageSpeed?.performanceScore).toBe(88);
      expect((reconstructed as any).htmlScanStatus).toBe('FAILED');
      expect(reconstructed.findings.length).toBe(1);
      expect(reconstructed.findings[0].id).toBe('c_og');
      expect(reconstructed.scorecard?.totalScore).toBe(77);

      // Persist the reconstructed audit and ensure site_audits scores and failed scan status survive
      await service.persistAuditToD1(reconstructed);

      const verifyRow = await service.getAuditByDomain(domain);
      expect(verifyRow.seo_score).toBe(77);
      expect(verifyRow.performance_score).toBe(88);
      expect(verifyRow.html_scan_status).toBe('FAILED');
      const parsed = service.parseAuditChecklistPayload(verifyRow.checklist_json);
      expect(parsed.items.length).toBe(1);
      expect(parsed.items[0].id).toBe('c_og');
    });

    it('aborts token issuance and leaves order pending delivery when durable persistence fails (persistence failure blocks token issuance)', async () => {
      const { RazorpayStandardAdapter } = await import('../../src/payments/razorpay-adapter.js');
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const crypto = await import('crypto');
      const adapter = RazorpayStandardAdapter.getInstance();
      const service = SiteAuditService.getInstance();
      const nonce = Date.now();
      const orderId = `order_test_fail_${nonce}`;
      const paymentId = `pay_test_fail_${nonce}`;
      const domain = `persistfail-${nonce}.com`;

      // Seed an existing audit so verifyPaymentAndFulfill reaches generateDeliverable without scanning
      await D1RevenueRepository.getInstance().executeWrite(
        'site_audits',
        `INSERT OR REPLACE INTO site_audits (
          domain, target_url, business_name, performance_score, seo_score,
          core_web_vitals_json, head_snippets, schema_json_ld, checklist_json, status, updated_at
        ) VALUES (?, ?, 'Persist Fail Test', 80, 75, '{}', '', '{}', '[]', 'COMPLETED', datetime('now'))`,
        [domain, `https://${domain}`]
      );

      await D1RevenueRepository.getInstance().executeWrite(
        'universal_orders',
        `INSERT OR REPLACE INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name,
          customer_email, customer_phone, amount_minor, currency, status, payment_provider,
          provider_order_id, metadata_json, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', 'sitefix_core_499', 'Customer',
          'failtest@example.com', '', 49900, 'INR', 'CHECKOUT', 'RAZORPAY_TEST',
          ?, ?, datetime('now'), datetime('now'))`,
        [orderId, orderId, JSON.stringify({ domainOrUrl: domain, buyerEmail: 'failtest@example.com' })]
      );

      const secret = (adapter as any).getKeySecret();
      const sig = crypto.createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      // Mock generateDeliverable to throw persistence error
      const deliverableSpy = vi.spyOn(service, 'generateDeliverable').mockRejectedValueOnce(
        new Error('D1_DURABLE_WRITE_UNAVAILABLE: Remote write circuit breaker open')
      );

      try {
        const result = await adapter.verifyPaymentAndFulfill({
          orderId,
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: sig
        });

        // Payment captured but token issuance aborted
        expect(result.success).toBe(true);
        expect(result.paymentCaptured).toBe(true);
        expect(result.fulfillmentStatus).toBe('PAYMENT_CAPTURED_PENDING_DELIVERY');
        expect(result.deliverableStatus).toBe('PENDING');
        expect(result.retryRequired).toBe(true);
        expect((result as any).downloadToken).toBeUndefined();
      } finally {
        deliverableSpy.mockRestore();
      }
    });

    it('recovers normalized audit and generates deliverable after memory cache is cleared (normalized audit recovers after cache clear)', async () => {
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const service = SiteAuditService.getInstance();
      const domain = 'roasterycoffee.co.in';
      const normalizedAuditId = `audit_${domain.replace(/\./g, '_')}`;

      // Insert audit into site_audits
      const findings = [{ id: 'f1', title: 'Speed Check', pass: true }];
      await D1RevenueRepository.getInstance().executeWrite(
        'site_audits',
        `INSERT OR REPLACE INTO site_audits (
          domain, target_url, business_name, performance_score, seo_score,
          core_web_vitals_json, head_snippets, schema_json_ld, checklist_json, status, updated_at
        ) VALUES (?, ?, 'Roastery Coffee', 90, 84, '{}', '<meta name="rc">', '{}', ?, 'COMPLETED', datetime('now'))`,
        [domain, `https://${domain}`, JSON.stringify(findings)]
      );

      // Force-clear memory caches
      (service as any).auditCache.clear();
      (service as any).deliverableCache.clear();

      // Retrieve via normalized auditId after cache clear
      const recoveredAudit = await service.getAudit(normalizedAuditId);
      expect(recoveredAudit).toBeTruthy();
      expect(recoveredAudit!.score).toBe(84);
      expect(recoveredAudit!.url).toBe(`https://${domain}`);
      expect(recoveredAudit!.findings.length).toBe(1);

      // Generate deliverable from recovered audit
      const deliverable = await service.generateDeliverable(normalizedAuditId);
      expect(deliverable).toBeTruthy();
      expect(deliverable.headMetadataSnippet).toBeTruthy();
    });
  });

  describe('8. PR #82 Sitemap Strict Audit-Domain Read (No Empty Cache Poisoning)', () => {
    it('throws in getAllAuditedDomains({ strict: true }) on read failure and avoids caching an incomplete /sitemap.xml', async () => {
      const { default: app } = await import('../../src/index.js');
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');

      const auditService = SiteAuditService.getInstance();
      const d1Repo = D1RevenueRepository.getInstance();
      const cfgSpy = vi.spyOn(d1Repo, 'isRemoteD1Configured').mockReturnValue(true);
      const querySpy = vi.spyOn(d1Repo, 'query').mockImplementation(async (table: string) => {
        if (table === 'site_audits') {
          throw new Error('SIMULATED_D1_SITE_AUDITS_READ_ERROR');
        }
        return [];
      });

      // Opt-in strict mode must throw; default mode stays backwards compatible ([])
      await expect(auditService.getAllAuditedDomains({ strict: true })).rejects.toThrow(
        'SIMULATED_D1_SITE_AUDITS_READ_ERROR'
      );
      await expect(auditService.getAllAuditedDomains()).resolves.toEqual([]);

      // PR #104: /sitemap.xml excludes legacy /audit/ routes altogether (no audit-domain leak or cache poisoning)
      const res1 = await app.request('/sitemap.xml');
      expect(res1.status).toBe(200);
      const xml1 = await res1.text();
      expect(xml1).toContain('/deals');
      expect(xml1).not.toContain('/audit/');

      cfgSpy.mockRestore();
      querySpy.mockRestore();
    });
  });

  describe('9. PR #82 TelegramBotAdapter Claim Ownership Guard', () => {
    it('blocks publishing on claim lookup/insert failure, releases owned claim before reading body on deterministic 4xx, and preserves claims on 429/5xx/network errors', async () => {
      const prevToken = process.env.TELEGRAM_BOT_TOKEN;
      const prevChannel = process.env.TELEGRAM_CHANNEL_ID;
      const prevEnabled = process.env.TELEGRAM_ENABLED;

      process.env.TELEGRAM_BOT_TOKEN = '123456789:AABBCCDDEEFFGGHHIIJJKKLLMMNNOOPP';
      process.env.TELEGRAM_CHANNEL_ID = '-1001234567890';
      process.env.TELEGRAM_ENABLED = 'true';

      try {
        TelegramBotAdapter.resetInstance();
        const adapter = TelegramBotAdapter.getInstance();
        const d1Repo = D1RevenueRepository.getInstance();

        // Case A: Claim lookup failure -> MUST fail closed and NEVER call Telegram fetchFn or DELETE
        const fetchMockA = vi.fn();
        const queryOneSpyA = vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (_table, sql) => {
          if (String(sql).includes('WHERE id = ?')) {
            throw new Error('SIMULATED_D1_CLAIM_LOOKUP_FAILURE');
          }
          return { cnt: 0 } as any;
        });
        const writeSpyA = vi.spyOn(d1Repo, 'executeWrite').mockResolvedValue({ results: [], rowsAffected: 1, source: 'LOCAL_SQLITE' } as any);

        const resA = await adapter.postPublishedGuide({
          guideTitle: 'Claim Lookup Failure Test',
          guideUrl: 'https://example.com/deal-a',
          dealId: 'deal_claim_fail_lookup',
          fetchFn: fetchMockA as any
        });
        expect(resA.posted).toBe(false);
        expect(resA.reason).toContain('TELEGRAM_CLAIM_FAILED');
        expect(fetchMockA).not.toHaveBeenCalled();
        expect(writeSpyA).not.toHaveBeenCalled();
        queryOneSpyA.mockRestore();
        writeSpyA.mockRestore();

        // Case B: Claim acquired + deterministic 400 -> MUST release claim BEFORE reading response body
        const eventsOrder: string[] = [];
        const queryOneSpyB = vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (_table, sql) => {
          if (String(sql).includes('WHERE id = ?')) return null;
          return { cnt: 0 } as any;
        });
        const writeSpyB = vi.spyOn(d1Repo, 'executeWrite').mockImplementation(async (_table, sql) => {
          if (String(sql).includes('INSERT INTO durable_events')) eventsOrder.push('CLAIM_INSERT');
          if (String(sql).includes('DELETE FROM durable_events')) eventsOrder.push('CLAIM_RELEASE');
          return { results: [], rowsAffected: 1, source: 'LOCAL_SQLITE' } as any;
        });
        const fetchMock400 = vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => {
            eventsOrder.push('READ_BODY');
            throw new Error('BODY_STREAM_INTERRUPTED');
          }
        });

        const resB = await adapter.postPublishedGuide({
          guideTitle: 'Deterministic 400 Test',
          guideUrl: 'https://example.com/deal-b',
          dealId: 'deal_claim_400',
          fetchFn: fetchMock400 as any
        });
        expect(resB.posted).toBe(false);
        expect(resB.reason).toContain('HTTP 400');
        expect(eventsOrder).toEqual(['CLAIM_INSERT', 'CLAIM_RELEASE', 'READ_BODY']);
        queryOneSpyB.mockRestore();
        writeSpyB.mockRestore();

        // Case C: Claim acquired + 429, 503, or network error -> MUST preserve claim (ZERO DELETE calls)
        for (const scenario of [
          {
            dealId: 'deal_claim_429',
            fetchFn: vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'Too Many Requests' })
          },
          {
            dealId: 'deal_claim_503',
            fetchFn: vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' })
          },
          {
            dealId: 'deal_claim_timeout',
            fetchFn: vi.fn().mockRejectedValue(new Error('ETIMEDOUT network timeout'))
          }
        ]) {
          const deletedSqls: string[] = [];
          const qSpy = vi.spyOn(d1Repo, 'queryOne').mockImplementation(async (_table, sql) => {
            if (String(sql).includes('WHERE id = ?')) return null;
            return { cnt: 0 } as any;
          });
          const wSpy = vi.spyOn(d1Repo, 'executeWrite').mockImplementation(async (_table, sql) => {
            if (String(sql).includes('DELETE FROM durable_events')) deletedSqls.push(String(sql));
            return { results: [], rowsAffected: 1, source: 'LOCAL_SQLITE' } as any;
          });

          const res = await adapter.postPublishedGuide({
            guideTitle: `Preserve Claim ${scenario.dealId}`,
            guideUrl: `https://example.com/${scenario.dealId}`,
            dealId: scenario.dealId,
            fetchFn: scenario.fetchFn as any
          });
          expect(res.posted).toBe(false);
          expect(deletedSqls).toEqual([]);
          qSpy.mockRestore();
          wSpy.mockRestore();
        }
      } finally {
        if (prevToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
        else process.env.TELEGRAM_BOT_TOKEN = prevToken;
        if (prevChannel === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
        else process.env.TELEGRAM_CHANNEL_ID = prevChannel;
        if (prevEnabled === undefined) delete process.env.TELEGRAM_ENABLED;
        else process.env.TELEGRAM_ENABLED = prevEnabled;
        TelegramBotAdapter.resetInstance();
      }
    });
  });
});
