import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { D1Client, FINANCIAL_TABLES, isFinancialSql } from '../../src/db/d1-client.js';
import { InstagramBusinessAdapter } from '../../src/integrations/instagram-business-adapter.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { getDb } from '../../src/db/client.js';
import { DurableEventBus } from '../../src/revenue/durable-event-bus.js';
import { generateBuyerIntentHubs } from '../../src/commission/static-site-generator.js';

describe('Stage P.1 — Low-Level D1 Financial Integrity, Instagram Hardening & MCP Interoperability', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    InstagramBusinessAdapter.resetInstance();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    InstagramBusinessAdapter.resetInstance();
    vi.restoreAllMocks();
  });

  describe('Task 1: D1 Quota Classifier vs HTTP 429 & Fail-Closed Financial Writes', () => {
    it('1.1: HTTP 429 rate limit without daily quota text does NOT trip circuit breaker; daily limit DOES trip', () => {
      const client = D1Client.getInstance();

      // Standard HTTP 429 concurrency / request rate throttling should NOT trip circuit breaker
      expect(client.isDailyQuotaError(429, '{"error":"Too many requests. Please slow down."}')).toBe(false);
      expect(client.isDailyQuotaError(429, 'Rate limit exceeded: 1200 req/min')).toBe(false);

      // Narrow Cloudflare D1 daily quota classifier (Spec Stage P.2):
      // True Cloudflare daily limit strings DO trip
      expect(client.isDailyQuotaError(400, "Your account has exceeded D1's free tier daily row read limit")).toBe(true);
      expect(client.isDailyQuotaError(400, "Your account has exceeded D1’s free tier daily row write limit")).toBe(true);

      // Generic quota, query, or rate limits without the exact message do NOT trip
      expect(client.isDailyQuotaError(429, 'Rate limit exceeded: daily row read limit reached')).toBe(false);
      expect(client.isDailyQuotaError(400, 'Cloudflare D1: exceeded d1 free tier write limit')).toBe(false);
      expect(client.isDailyQuotaError(400, 'Error 7500: daily quota limit exceeded')).toBe(false);
      expect(client.isDailyQuotaError(400, 'Error 7429: daily query limit exceeded')).toBe(false);

      // Schema and execution errors wrapped with 7500 do NOT trip
      expect(client.isDailyQuotaError(400, 'Error 7500: no such table: non_existent_tbl')).toBe(false);
      expect(client.isDailyQuotaError(400, 'sqlite_error: UNIQUE constraint failed: orders.id')).toBe(false);
    });

    it('1.2: isFinancialSql accurately identifies all 7 critical financial tables', () => {
      expect(FINANCIAL_TABLES).toEqual([
        'payment_requests',
        'manual_upi_claims',
        'orders',
        'universal_orders',
        'commission_ledger',
        'delivery_tasks',
        'payout_records'
      ]);

      expect(isFinancialSql('INSERT INTO orders (id, amount) VALUES (1, 500)')).toBe(true);
      expect(isFinancialSql('UPDATE payment_requests SET status = "PAID" WHERE id = ?')).toBe(true);
      expect(isFinancialSql('INSERT INTO manual_upi_claims (utr) VALUES (?)')).toBe(true);
      expect(isFinancialSql('INSERT INTO universal_orders (id) VALUES (?)')).toBe(true);
      expect(isFinancialSql('INSERT INTO commission_ledger (id, amt) VALUES (?, ?)')).toBe(true);
      expect(isFinancialSql('INSERT INTO delivery_tasks (id) VALUES (?)')).toBe(true);
      expect(isFinancialSql('INSERT INTO payout_records (id) VALUES (?)')).toBe(true);

      expect(isFinancialSql('INSERT INTO analytics_events (event) VALUES (?)')).toBe(false);
      expect(isFinancialSql('SELECT * FROM site_audits WHERE id = ?')).toBe(false);
    });

    it('1.3: D1Client.executeQuery on Render fails closed for financial writes when circuit breaker is active', async () => {
      process.env.RENDER = 'true';
      const client = D1Client.getInstance();
      client.tripQuotaCircuitBreakerPublic('Daily read limit reached');

      await expect(
        client.executeQuery('INSERT INTO orders (id, amount) VALUES (?, ?)', ['ord_123', 499], true, 'P0')
      ).rejects.toThrow('D1_DURABLE_WRITE_UNAVAILABLE');

      await expect(
        client.executeQuery('INSERT INTO payout_records (id, amount) VALUES (?, ?)', ['po_123', 100], true, 'P0')
      ).rejects.toThrow('D1_DURABLE_WRITE_UNAVAILABLE');
    });

    it('1.4: D1Client.executeBatch aborts local replay with D1_PARTIAL_BATCH_FAILURE when financial statement fails mid-batch', async () => {
      process.env.RENDER = 'true';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'cf_acc_123';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'cf_db_123';
      process.env.CLOUDFLARE_D1_API_TOKEN = 'cf_tok_123';
      delete process.env.VITEST; // allow remote write simulation

      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
        callCount++;
        if (callCount === 1) {
          // Statement 0 succeeds remotely
          return new Response(JSON.stringify({ result: [{ meta: { rows_written: 1 } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        // Statement 1 fails remotely
        return new Response('Remote network timeout / 500 error', { status: 500 });
      });

      const client = D1Client.getInstance();
      await expect(
        client.executeBatch([
          { sql: 'INSERT INTO orders (id, amount) VALUES (?, ?)', params: ['ord_0', 499] },
          { sql: 'INSERT INTO payout_records (id, amount) VALUES (?, ?)', params: ['po_1', 100] }
        ])
      ).rejects.toThrow('D1_PARTIAL_BATCH_FAILURE: Statement at index 1 failed after earlier statements committed. Local replay aborted.');

      fetchSpy.mockRestore();
    });
  });

  describe('Task 2: Instagram OAuth Single-Use Replay Protection, Production Secret & Hourly Cadence', () => {
    it('2.1: InstagramBusinessAdapter.resolveOAuthSecret requires >= 16 char secret in production', () => {
      process.env.RENDER = 'true';
      delete process.env.INSTAGRAM_APP_SECRET;
      delete process.env.AUTH_SECRET;
      delete process.env.OWNER_API_KEY;

      expect(() => InstagramBusinessAdapter.resolveOAuthSecret()).toThrow('INSTAGRAM_OAUTH_NOT_CONFIGURED');
      expect(() => InstagramBusinessAdapter.resolveOAuthSecret('short')).toThrow('INSTAGRAM_OAUTH_NOT_CONFIGURED');
      expect(() => InstagramBusinessAdapter.resolveOAuthSecret('ig_oauth_secret')).toThrow('INSTAGRAM_OAUTH_NOT_CONFIGURED');

      const strongSecret = 'super_secret_instagram_key_2026';
      expect(InstagramBusinessAdapter.resolveOAuthSecret(strongSecret)).toBe(strongSecret);
    });

    it('2.2: GET /integrations/instagram/oauth/authorize returns 503 if secret unconfigured in production', async () => {
      process.env.RENDER = 'true';
      delete process.env.INSTAGRAM_APP_SECRET;
      delete process.env.AUTH_SECRET;
      delete process.env.OWNER_API_KEY;

      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/integrations/instagram/oauth/authorize');
      expect(res.status).toBe(503);
      const json = (await res.json()) as any;
      expect(json.error).toBe('INSTAGRAM_OAUTH_NOT_CONFIGURED');
    });

    it('2.3: OAuth callback enforces single-use nonce replay defense (second callback fails with HTTP 400)', async () => {
      const authSecret = 'stage_p1_secure_oauth_secret_32bytes';
      process.env.INSTAGRAM_APP_SECRET = authSecret;

      const state = InstagramBusinessAdapter.generateSignedState(authSecret);

      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      // Mock adapter handleOAuthCallback so code exchange doesn't fail on external network
      const handleSpy = vi.spyOn(InstagramBusinessAdapter.getInstance(), 'handleOAuthCallback').mockResolvedValue({
        ok: true,
        handle: 'bestdeals0162',
        igUserId: '17841400',
        expiresAt: '2026-12-31'
      } as any);

      // First callback with signed state succeeds
      const firstRes = await app.request(`/api/v1/integrations/instagram/oauth/callback?code=mock_code&state=${encodeURIComponent(state)}`);
      expect(firstRes.status).toBe(200);

      // Replayed callback with identical state and nonce is rejected
      const replayRes = await app.request(`/api/v1/integrations/instagram/oauth/callback?code=mock_code&state=${encodeURIComponent(state)}`);
      expect(replayRes.status).toBe(400);
      const replayJson = (await replayRes.json()) as any;
      expect(replayJson.error).toBe('OAUTH_STATE_REPLAY_DETECTED');

      handleSpy.mockRestore();
    });

    it('2.4: POST /webhooks/instagram requires INSTAGRAM_APP_SECRET in production', async () => {
      process.env.RENDER = 'true';
      delete process.env.INSTAGRAM_APP_SECRET;

      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/webhooks/instagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry: [] })
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error).toContain('INSTAGRAM_APP_SECRET is required in production');
    });

    it('2.5: Instagram isItemReplied fails closed when D1 check fails', async () => {
      const adapter = new InstagramBusinessAdapter();
      const { D1RevenueRepository } = await import('../../src/db/d1-revenue-repository.js');
      const repo = D1RevenueRepository.getInstance();

      const querySpy = vi.spyOn(repo, 'queryOne').mockRejectedValue(new Error('D1 read timeout'));
      await expect(adapter.isItemReplied('comment_xyz_123')).rejects.toThrow('IG_REPLY_CHECK_FAILED');
      querySpy.mockRestore();
    });
  });

  describe('Task 3: Category Filtering & Streamable MCP JSON-RPC 2.0 Interoperability', () => {
    it('3.1: generateBuyerIntentHubs strictly requires category match and omits hubs with < 2 items', () => {
      const deals = [
        {
          id: 'deal_tech_1',
          title: 'boAt Rockerz 450 Bluetooth Headphone',
          merchant: 'boAt Lifestyle',
          category: 'Audio',
          currentPriceINR: 1499,
          productVerified: true,
          affiliateVerified: true,
          isMonetizable: true,
          availability: 'IN_STOCK',
          affiliateNetwork: 'CUELINKS'
        },
        {
          id: 'deal_tech_2',
          title: 'Portronics SoundDrum 1 10W TWS Portable Speaker',
          merchant: 'Portronics',
          category: 'Audio',
          currentPriceINR: 999,
          productVerified: true,
          affiliateVerified: true,
          isMonetizable: true,
          availability: 'IN_STOCK',
          affiliateNetwork: 'CUELINKS'
        }
      ];

      const hubs = generateBuyerIntentHubs(deals, 'https://ai-marketing-organization.onrender.com', 10);
      // Grooming hub should NOT exist because no perfume/grooming deals match
      const groomingHub = hubs.find(h => h.intentSlug === 'grooming-and-perfume-bundles-under-1000');
      expect(groomingHub).toBeUndefined();
    });

    it('3.2: GET /best/:intentSlug returns 404 with Insufficient verified category inventory when omitted', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/best/grooming-and-perfume-bundles-under-1000');
      // When catalog does not have 2 verified grooming deals, returns 404
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toContain('Insufficient verified category inventory');
    });

    it('3.3: POST /api/v1/mcp fully adheres to JSON-RPC 2.0 with Owner Authentication across all 4 tools', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'MCP_Test_Agent');
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`
      };

      // 1. initialize
      const initRes = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      });
      expect(initRes.status).toBe(200);
      const initJson = (await initRes.json()) as any;
      expect(initJson.jsonrpc).toBe('2.0');
      expect(initJson.id).toBe(1);
      expect(initJson.result?.serverInfo?.name).toBe('ai-marketing-organization-mcp');

      // 2. tools/list
      const listRes = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      });
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as any;
      const toolNames = listJson.result?.tools?.map((t: any) => t.name);
      expect(toolNames).toContain('get_top_verified_deals');
      expect(toolNames).toContain('check_fair_price');
      expect(toolNames).toContain('get_ready_sitefix_audits');
      expect(toolNames).toContain('get_autonomy_and_doctor_status');

      // 3. tools/call: get_top_verified_deals
      const dealsCall = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'get_top_verified_deals', arguments: { limit: 2 } }
        })
      });
      expect(dealsCall.status).toBe(200);
      const dealsJson = (await dealsCall.json()) as any;
      expect(dealsJson.result?.content?.[0]?.type).toBe('text');
      expect(dealsJson.result?.structuredContent).toBeDefined();

      // 4. tools/call: check_fair_price
      const priceCall = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'check_fair_price', arguments: { query: 'boAt Rockerz 450' } }
        })
      });
      expect(priceCall.status).toBe(200);
      const priceJson = (await priceCall.json()) as any;
      expect(priceJson.result?.content?.[0]?.type).toBe('text');

      // 5. tools/call: get_ready_sitefix_audits
      const auditsCall = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'get_ready_sitefix_audits', arguments: { limit: 2 } }
        })
      });
      expect(auditsCall.status).toBe(200);
      const auditsJson = (await auditsCall.json()) as any;
      expect(auditsJson.result?.content?.[0]?.type).toBe('text');

      // 6. tools/call: get_autonomy_and_doctor_status
      const doctorCall = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: { name: 'get_autonomy_and_doctor_status', arguments: {} }
        })
      });
      expect(doctorCall.status).toBe(200);
      const doctorJson = (await doctorCall.json()) as any;
      expect(doctorJson.result?.content?.[0]?.type).toBe('text');
      expect(doctorJson.result?.structuredContent?.systemDoctorSummary).toBeDefined();
    });
  });
});
