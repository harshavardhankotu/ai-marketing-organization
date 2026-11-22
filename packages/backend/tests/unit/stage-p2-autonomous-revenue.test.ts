import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { D1Client, FINANCIAL_TABLES, isFinancialSql } from '../../src/db/d1-client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { InstagramBusinessAdapter } from '../../src/integrations/instagram-business-adapter.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { getDb } from '../../src/db/client.js';
import { DurableEventBus } from '../../src/revenue/durable-event-bus.js';
import { AutonomousSystemDoctor } from '../../src/automation/autonomous-system-doctor.js';

describe('Stage P.2 — Zero-Touch Autonomous Revenue Engine & Production Durability Lock', () => {
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

  describe('Task 1: Narrow Cloudflare D1 Daily Quota Classifier', () => {
    it('1.1: Only true Cloudflare free tier daily row limit error trips circuit breaker', () => {
      const client = D1Client.getInstance();

      // Exact Cloudflare free tier daily row read/write exhaustion strings DO trip
      expect(client.isDailyQuotaError(400, "Your account has exceeded D1's free tier daily row read limit")).toBe(true);
      expect(client.isDailyQuotaError(400, "Your account has exceeded D1’s free tier daily row write limit")).toBe(true);
      expect(client.isDailyQuotaError(400, "Error: Your account has exceeded D1's free tier daily row read limit: upgrade to workers paid")).toBe(true);

      // Bare HTTP 429, generic quota, 7429 overloaded, 7500 storage, or schema errors do NOT trip
      expect(client.isDailyQuotaError(429, '{"error":"Too many requests"}')).toBe(false);
      expect(client.isDailyQuotaError(429, 'Rate limit exceeded: 1200 req/min')).toBe(false);
      expect(client.isDailyQuotaError(429, 'daily quota exceeded')).toBe(false);
      expect(client.isDailyQuotaError(400, 'Error 7429: Cloudflare D1 is temporarily overloaded')).toBe(false);
      expect(client.isDailyQuotaError(400, 'Error 7500: storage engine unavailable')).toBe(false);
      expect(client.isDailyQuotaError(400, 'Error 7500: no such table: non_existent')).toBe(false);
      expect(client.isDailyQuotaError(400, 'sqlite_error: UNIQUE constraint failed: orders.id')).toBe(false);
    });
  });

  describe('Task 2 & 3: Financial Table Isolation & Fail-Closed Sequential Batch', () => {
    it('2.1: FINANCIAL_TABLES includes all critical tables and isFinancialSql detects them', () => {
      expect(FINANCIAL_TABLES).toEqual([
        'payment_requests',
        'manual_upi_claims',
        'orders',
        'universal_orders',
        'payment_orders',
        'transactions',
        'durable_events',
        'commission_ledger',
        'delivery_tasks',
        'payout_records'
      ]);

      for (const tbl of FINANCIAL_TABLES) {
        expect(isFinancialSql(`INSERT INTO ${tbl} (id) VALUES ('123')`)).toBe(true);
      }
      expect(isFinancialSql('INSERT INTO analytics_events (id) VALUES (\'1\')')).toBe(false);
    });

    it('2.2: D1RevenueRepository executeWrite does not mirror financial tables to local SQLite when remote D1 succeeds', async () => {
      const repo = D1RevenueRepository.getInstance();
      const client = D1Client.getInstance();

      vi.spyOn(client, 'isRemoteD1WriteAllowed').mockReturnValue(true);
      const querySpy = vi.spyOn(client, 'executeQuery').mockResolvedValue({
        results: [],
        rowsAffected: 1,
        source: 'CLOUDFLARE_D1'
      });

      const db = getDb();
      const prepareSpy = vi.spyOn(db, 'prepare');

      const res = await repo.executeWrite('orders', "INSERT INTO orders (id, amount) VALUES ('ord_test_01', 500)");
      expect(res.source).toBe('CLOUDFLARE_D1');
      expect(querySpy).toHaveBeenCalled();
      // db.prepare should NOT have been called to mirror 'orders' to local SQLite
      expect(prepareSpy).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO orders'));
    });

    it('3.1: executeBatch throws D1_DURABLE_WRITE_UNAVAILABLE at index 0 on failure', async () => {
      const client = D1Client.getInstance();
      vi.spyOn(client, 'isRemoteD1WriteAllowed').mockReturnValue(true);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

      await expect(
        client.executeBatch([
          { sql: "INSERT INTO orders (id, amount) VALUES ('ord_1', 100)" }
        ])
      ).rejects.toThrow(/D1_DURABLE_WRITE_UNAVAILABLE/);
    });

    it('3.2: executeBatch throws D1_AMBIGUOUS_OUTCOME on network timeout during financial batch', async () => {
      const client = D1Client.getInstance();
      vi.spyOn(client, 'isRemoteD1WriteAllowed').mockReturnValue(true);
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed: The operation was aborted due to timeout'));

      await expect(
        client.executeBatch([
          { sql: "INSERT INTO payment_requests (id, amount) VALUES ('pr_1', 500)" }
        ])
      ).rejects.toThrow(/D1_AMBIGUOUS_OUTCOME/);
    });
  });

  describe('Task 4: Atomic Nonce Consumption for Instagram OAuth', () => {
    it('4.1: Atomic nonce insertion prevents check-then-act replay attacks', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const secret = 'test_secret_for_instagram_oauth_12345';
      process.env.INSTAGRAM_APP_SECRET = secret;
      process.env.AUTH_SECRET = secret;

      const state = InstagramBusinessAdapter.generateSignedState();
      const adapter = InstagramBusinessAdapter.getInstance();
      const handleSpy = vi.spyOn(adapter, 'handleOAuthCallback').mockResolvedValue({
        ok: true,
        handle: '@bestdeals0162',
        igUserId: '17841400000000000',
        expiresAt: '60 days'
      });

      // First call succeeds
      const firstRes = await app.request(`/api/v1/integrations/instagram/oauth/callback?code=AQD_first_code&state=${encodeURIComponent(state)}`);
      expect(firstRes.status).toBe(200);

      // Immediate replayed call with identical nonce is rejected with 400 and OAUTH_STATE_REPLAY_DETECTED
      const replayRes = await app.request(`/api/v1/integrations/instagram/oauth/callback?code=AQD_second_code&state=${encodeURIComponent(state)}`);
      expect(replayRes.status).toBe(400);
      const replayJson = (await replayRes.json()) as any;
      expect(replayJson.error).toBe('OAUTH_STATE_REPLAY_DETECTED');

      handleSpy.mockRestore();
    });
  });

  describe('Task 5: Atomic Pre-Dispatch Claim for Instagram Replies', () => {
    it('5.1: claimInstagramReplyAtomically locks reply and prevents double-send', async () => {
      const adapter = InstagramBusinessAdapter.getInstance();
      const itemId = `test_item_${Date.now()}`;

      // First claim succeeds
      const firstClaim = await adapter.claimInstagramReplyAtomically('comment', itemId);
      expect(firstClaim).toBe(true);

      // Second claim returns false (already claimed)
      const secondClaim = await adapter.claimInstagramReplyAtomically('comment', itemId);
      expect(secondClaim).toBe(false);

      // isItemReplied returns true
      const replied = await adapter.isItemReplied(`comment:${itemId}`);
      expect(replied).toBe(true);
    });

    it('5.2: pollAndReplyInstagramCommentsAndDms returns structured errors when fetch fails', async () => {
      process.env.INSTAGRAM_ACCESS_TOKEN = 'test_access_token_12345';
      process.env.INSTAGRAM_USER_ID = '17841400000000000';
      const adapter = InstagramBusinessAdapter.getInstance();
      const mockFetch = vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 }));

      const res = await adapter.pollAndReplyInstagramCommentsAndDms(mockFetch as any);
      expect(res.executed).toBe(false);
      expect(res.commentFetchError).toContain('HTTP_502');
      expect(res.dmFetchError).toContain('HTTP_502');
    });
  });

  describe('Task 6: Stateless Streamable MCP 2026-07-28 Specification', () => {
    it('6.1: GET /api/v1/mcp returns HTTP 405 Method Not Allowed with Allow: POST', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
      const res = await app.request('/api/v1/mcp', {
        headers: { Authorization: `Bearer ${session.token}` }
      });

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
      const json = (await res.json()) as any;
      expect(json.error?.code).toBe(-32601);
      expect(json.error?.message).toContain('Method Not Allowed');
    });

    it('6.2: POST /api/v1/mcp rejects untrusted browser Origin with HTTP 403 Forbidden', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
      const res = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
          Origin: 'https://evil-hacker-site.com'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      });

      expect(res.status).toBe(403);
      const json = (await res.json()) as any;
      expect(json.error?.code).toBe(-32003);
      expect(json.error?.message).toContain('Forbidden: untrusted Origin');
    });

    it('6.3: POST /api/v1/mcp server/discover returns protocol versions 2026-07-28 & 2025-03-26', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
      const res = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
          'MCP-Protocol-Version': '2026-07-28'
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'req_disc_01', method: 'server/discover' })
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('MCP-Protocol-Version')).toBe('2026-07-28');
      const json = (await res.json()) as any;
      expect(json.result?.protocolVersions).toEqual(['2026-07-28', '2025-03-26']);
      expect(json.result?.serverInfo?.name).toBe('ai-marketing-organization-mcp');
      expect(json.result?.cacheHints?.ttlMs).toBe(3600000);
    });

    it('6.4: POST /api/v1/mcp tools/list returns deterministic sorted tools', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
      const res = await app.request('/api/v1/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      const names = json.result?.tools?.map((t: any) => t.name);
      expect(names).toEqual([
        'get_top_verified_deals',
        'check_fair_price',
        'get_ready_sitefix_audits',
        'get_autonomy_and_doctor_status'
      ]);
    });
  });

  describe('Task 7: Autonomous Brevo Outreach Loop', () => {
    it('7.1: Outreach autopilot health reports humanGateSatisfied: true', () => {
      const doctor = AutonomousSystemDoctor.getInstance();
      const health = doctor.getOutreachAutopilotHealth();
      expect(health.humanGateSatisfied).toBe(true);
      expect(health.dailyCap).toBe(10);
    });
  });

  describe('Task 8: Razorpay Auto-Capture Payment Link & Deliverables', () => {
    it('8.1: SiteFix checkout returns paymentLink and order configuration', async () => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_mock_key_id';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_test_mock_secret';
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
      delete process.env.RENDER;

      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/tools/site-audit/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auditId: 'audit_test_domain_com',
          customerEmail: 'buyer@example.com'
        })
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.orderId).toBeDefined();
      expect(json.amountINR).toBe(499);
      expect(json.order).toBeDefined();
    });
  });
});
