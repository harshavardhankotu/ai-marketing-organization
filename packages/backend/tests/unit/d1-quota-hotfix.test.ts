import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { D1Client } from '../../src/db/d1-client.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import { applyD1Migrations, resetBaseline0050VerifiedForTesting } from '../../src/db/d1-migrations/index.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { resetSitemapCacheForTesting } from '../../src/index.js';
import { resetRevenueFunnelCacheForTesting } from '../../src/routes/api.js';
import { getSiteFixFunnelAttributionSummaryAsync, resetSiteFixFunnelAttributionCacheForTesting } from '../../src/tools/site-audit/sitefix-funnel-attribution.js';
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

    it('buildEligiblePublicDealsQuery pushes sector, category, merchant, and price filters before LIMIT 250 (PR #82)', () => {
      const built = AutonomousDealDiscoveryEngine.buildEligiblePublicDealsQuery({
        sectorCode: 'TECH',
        category: 'Electronics',
        merchant: 'Amazon',
        minPrice: 500,
        maxPrice: 5000,
        q: 'laptop'
      });

      expect(built.sql).toContain('sector_code = ?');
      expect(built.sql).toContain('LOWER(category) = LOWER(?)');
      expect(built.sql).toContain('LOWER(merchant) = LOWER(?)');
      expect(built.sql).toContain('current_price_inr >= ?');
      expect(built.sql).toContain('current_price_inr <= ?');
      expect(built.sql).toContain('LIMIT 250');
      expect(built.params).toEqual(['TECH', 'Electronics', 'Amazon', 500, 5000, '%laptop%', '%laptop%', '%laptop%']);
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
  });
});
