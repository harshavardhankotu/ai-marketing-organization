import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createHmac, randomUUID } from 'crypto';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { FINANCIAL_TABLES, isFinancialSql } from '../../src/db/d1-client.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { TelegramBotAdapter } from '../../src/integrations/telegram-adapter.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { getDb } from '../../src/db/client.js';

describe('Stage P.3 — Revenue Integrity, D1 Ledger Durability, Slug Collision Safety & Cron Ping Reliability', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    TelegramBotAdapter.resetInstance();
    CuelinksSyncManager.resetInstance();
    try {
      getDb().prepare("DELETE FROM workflows WHERE id = 'wf_cuelinks_reconciliation_cursor'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    TelegramBotAdapter.resetInstance();
    CuelinksSyncManager.resetInstance();
    vi.restoreAllMocks();
  });

  describe('Task 1: Razorpay Paired Credentials & SKU Price Integrity', () => {
    it('1.1: Resolves matched paired credentials and rejects mismatched pairs', () => {
      const adapter = RazorpayStandardAdapter.getInstance();

      // Test with valid live pair
      process.env.NODE_ENV = 'production';
      process.env.RAZORPAY_KEY_ID = 'rzp_live_test_key_123';
      process.env.RAZORPAY_KEY_SECRET = 'live_secret_real_456';
      process.env.RAZORPAY_TEST_KEY_ID = '';
      process.env.RAZORPAY_TEST_KEY_SECRET = '';

      const livePair = adapter.getCredentialPair();
      expect(livePair.isLive).toBe(true);
      expect(livePair.keyId).toBe('rzp_live_test_key_123');
      expect(livePair.keySecret).toBe('live_secret_real_456');

      // Live key ID with missing or placeholder secret falls back to test or fails
      process.env.RAZORPAY_KEY_SECRET = '';
      process.env.RAZORPAY_TEST_KEY_ID = 'rzp_test_valid_key_789';
      process.env.RAZORPAY_TEST_KEY_SECRET = 'test_secret_real_012';

      const testPair = adapter.getCredentialPair();
      expect(testPair.isLive).toBe(false);
      expect(testPair.keyId).toBe('rzp_test_valid_key_789');
      expect(testPair.keySecret).toBe('test_secret_real_012');

      // In production with neither valid pair -> throws PAYMENT_PROVIDER_NOT_CONFIGURED
      process.env.RAZORPAY_KEY_ID = 'rzp_live_orphan';
      process.env.RAZORPAY_KEY_SECRET = '';
      process.env.RAZORPAY_TEST_KEY_ID = '';
      process.env.RAZORPAY_TEST_KEY_SECRET = '';

      expect(() => adapter.getCredentialPair()).toThrow(/PAYMENT_PROVIDER_NOT_CONFIGURED/);
    });

    it('1.2: Server-authoritative SKU pricing: rejects unknown SKUs and client-tampered amounts', () => {
      const adapter = RazorpayStandardAdapter.getInstance();

      // Valid SKUs
      const core = adapter.resolveAuthoritativePrice('sitefix_core_499');
      expect(core.amountINR).toBe(499);
      expect(core.amountPaise).toBe(49900);
      expect(core.canonicalSku).toBe('SITEFIX_AI_PACK_V1');

      const coreWithMatch = adapter.resolveAuthoritativePrice('sitefix_core_499', 499);
      expect(coreWithMatch.amountINR).toBe(499);

      const competitor = adapter.resolveAuthoritativePrice('sitefix_competitor_keyword_pack');
      expect(competitor.amountINR).toBe(1999);
      expect(competitor.amountPaise).toBe(199900);
      expect(competitor.canonicalSku).toBe('sitefix_competitor_keyword_pack');

      // Client price tampering: passing amount 1 for a 499 SKU
      expect(() => adapter.resolveAuthoritativePrice('sitefix_core_499', 1)).toThrow(/INVALID_SKU: Client-tampered amount/);
      expect(() => adapter.resolveAuthoritativePrice('sitefix_competitor_keyword_pack', 500)).toThrow(/INVALID_SKU: Client-tampered amount/);

      // Unknown SKU rejected
      expect(() => adapter.resolveAuthoritativePrice('unauthorized_cheap_pack')).toThrow(/INVALID_SKU: Unknown SKU/);
    });

    it('1.3: createStandardOrder fails closed if D1 ledger persistence fails', async () => {
      const adapter = RazorpayStandardAdapter.getInstance();
      process.env.NODE_ENV = 'test';

      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'executeWrite').mockRejectedValueOnce(new Error('D1 storage quota exceeded'));

      await expect(
        adapter.createStandardOrder({
          sku: 'sitefix_core_499',
          domainOrUrl: 'test-failing-domain.com',
          buyerEmail: 'buyer@example.com'
        })
      ).rejects.toThrow(/D1_ORDER_PERSISTENCE_FAILED/);
    });
  });

  describe('Task 2: Financial Table Isolation & Slug Collision Safety', () => {
    it('2.1: FINANCIAL_TABLES includes transactions and protects it from SQLite mirroring', () => {
      expect(FINANCIAL_TABLES).toEqual([
        'payment_requests',
        'manual_upi_claims',
        'orders',
        'universal_orders',
        'transactions',
        'commission_ledger',
        'delivery_tasks',
        'payout_records'
      ]);

      expect(isFinancialSql('INSERT INTO transactions (id, amount_inr) VALUES (?, ?)')).toBe(true);
      expect(isFinancialSql('SELECT * FROM transactions WHERE id = ?')).toBe(true);
      expect(isFinancialSql('INSERT INTO non_financial_logs (id) VALUES (?)')).toBe(false);
    });

    it('2.2: Generates collision-free deterministic slugs across merchants for identical product titles', () => {
      const title = 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones';
      const brand = 'Sony';
      const model = 'WH1000XM5';

      const slugAmazon = AutonomousDealDiscoveryEngine.generateDealSlug(
        title,
        brand,
        model,
        'Amazon India|https://amazon.in/dp/B09XS7JWHH'
      );
      const slugCroma = AutonomousDealDiscoveryEngine.generateDealSlug(
        title,
        brand,
        model,
        'Croma|https://croma.com/p/250123'
      );

      expect(slugAmazon).not.toBe(slugCroma);
      expect(slugAmazon).toContain('sony-wh-1000xm5-wireless-noise-cancelling-headphones');
      expect(slugCroma).toContain('sony-wh-1000xm5-wireless-noise-cancelling-headphones');
      // Both have a 6-character hex hash suffix
      expect(slugAmazon).toMatch(/-[a-f0-9]{6}$/);
      expect(slugCroma).toMatch(/-[a-f0-9]{6}$/);
    });
  });

  describe('Task 3: Cuelinks Attribution Truth & Approval Gates', () => {
    it('3.1: reconcileTransactionsIncremental separates clicks from transactions and sets paginationIncomplete', async () => {
      const syncMgr = CuelinksSyncManager.getInstance();

      // Mock CuelinksV3Client.getTransactions
      const fakeTx = [
        { id: 'tx_101', user_commission: 50, currency: 'INR', status: 'approved' },
        { id: 'tx_102', user_commission: 75, currency: 'INR', status: 'pending' }
      ];

      (syncMgr as any).client = {
        isConfigured: () => true,
        getTransactions: vi.fn().mockResolvedValue({
          transactions: fakeTx,
          meta: { total_pages: 3, next_page: 2 }
        })
      };

      const result = await syncMgr.reconcileTransactionsIncremental({ maxPages: 1, channel_id: 10 });

      // Transactions must NOT be reported as providerAttributedClicks!
      expect(result.providerAttributedClicks).toBe(0);
      expect(result.reportedConversions).toBe(2);
      expect(result.paginationIncomplete).toBe(true); // More pages remain
    });

    it('3.2: verify5StateAuthorization strictly requires access_status === approved', async () => {
      const syncMgr = CuelinksSyncManager.getInstance();

      (syncMgr as any).client = {
        isConfigured: () => true,
        ping: vi.fn().mockResolvedValue({ connected: true, hasRequiredScopes: true }),
        getApprovedChannel: vi.fn().mockResolvedValue({ approved: true, channel: { id: 10, name: 'Prod Channel', status: 'approved' } }),
        getCampaignDetails: vi.fn().mockResolvedValue({ id: 500, status: 'active', access_status: 'pending' }) // pending!
      };
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        approved: true,
        channel: { id: 10, name: 'Prod Channel', status: 'approved' } as any
      });

      const res = await syncMgr.verify5StateAuthorization({ campaignId: 500, destinationUrl: 'https://partner.com/deal' });
      expect(res.authorized).toBe(false);
      expect(res.blockerCode).toBe('BLOCKED_CAMPAIGN_NOT_APPROVED');
    });
  });

  describe('Task 4: Brevo Webhook Auth, Outreach Consent & Telegram D1 Durability', () => {
    it('4.1: TelegramBotAdapter status reports LIVE_ENABLED only when chatId is resolved', async () => {
      const tg = TelegramBotAdapter.getInstance();
      process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_123';
      process.env.TELEGRAM_CHANNEL_ID = '';

      // Without chatId, status must be READY_AWAITING_BOT_TOKEN
      vi.spyOn(tg, 'getChatId').mockResolvedValue('');
      const statusNoChat = await tg.getStatus();
      expect(statusNoChat.chatIdConfigured).toBe(false);
      expect(statusNoChat.status).toBe('READY_AWAITING_BOT_TOKEN');

      // With chatId, status becomes LIVE_ENABLED
      vi.spyOn(tg, 'getChatId').mockResolvedValue('-100123456789');
      const statusWithChat = await tg.getStatus();
      expect(statusWithChat.chatIdConfigured).toBe(true);
      expect(statusWithChat.status).toBe('LIVE_ENABLED');
    });

    it('4.2: Enforces Telegram daily post limit of 3 using durable rate limiter', async () => {
      const tg = TelegramBotAdapter.getInstance();
      process.env.TELEGRAM_BOT_TOKEN = 'mock_bot_token_123';
      process.env.TELEGRAM_CHANNEL_ID = '-100123456789';

      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ cnt: 3 });

      const mockFetch = vi.fn();
      const res = await tg.postPublishedGuide({
        guideTitle: 'Over-limit Deal',
        guideUrl: 'https://sitefix.com/deals/deal-1',
        fetchFn: mockFetch as any
      });

      expect(res.posted).toBe(false);
      expect(res.reason).toContain('DAILY_LIMIT_EXCEEDED');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('4.3: Brevo webhook rejects requests when secret is missing or invalid in production', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      process.env.NODE_ENV = 'production';
      process.env.BREVO_WEBHOOK_SECRET = 'brevo_secret_prod_999';

      // Missing token
      const resMissing = await app.request('/api/v1/integrations/brevo/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'delivered', email: 'test@domain.com' })
      });
      expect(resMissing.status).toBe(401);

      // Invalid token
      const resInvalid = await app.request('/api/v1/integrations/brevo/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong_token'
        },
        body: JSON.stringify({ event: 'delivered', email: 'test@domain.com' })
      });
      expect(resInvalid.status).toBe(401);

      // Valid token
      const resValid = await app.request('/api/v1/integrations/brevo/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer brevo_secret_prod_999'
        },
        body: JSON.stringify({ event: 'delivered', email: 'test@domain.com' })
      });
      expect(resValid.status).toBe(200);
      const json = await resValid.json();
      expect(json.success).toBe(true);
    });
  });

  describe('Task 5: Cloudflare Worker Cron Ping Reliability', () => {
    it('5.1: POST /api/v1/cron/ping immediately records telemetry and responds 200 within timeout budget', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const d1Repo = D1RevenueRepository.getInstance();
      vi.spyOn(d1Repo, 'executeWrite').mockResolvedValue({ success: true } as any);

      const res = await app.request('/api/v1/cron/ping', {
        method: 'POST',
        headers: {
          'X-Cron-Secret': 'cron_ping_fixture_dev',
          'User-Agent': 'cloudflare-cron-worker'
        }
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.telemetryRecorded).toBe(true);
      expect(data.triggerSource).toBe('CLOUDFLARE_CRON');
    });

    it('5.2: POST /api/v1/payments/razorpay/create-order returns HTTP 400 on price tampering', async () => {
      const { apiRouter } = await import('../../src/routes/api.js');
      const app = new Hono();
      app.route('/api/v1', apiRouter);

      const res = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: 'sitefix_core_499',
          amountINR: 1, // Tampered price!
          domainOrUrl: 'test-tamper.com'
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('INVALID_SKU');
    });
  });
});
