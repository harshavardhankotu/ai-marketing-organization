/**
 * Cuelinks V3 API & MCP Integration Test Suite
 * Tests client methods, SSRF safety, link conversion, sub-IDs, channel management,
 * offer ingestion, performance reconciliation, and zero-downtime unconfigured fallback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksAdapter } from '../../src/commission/affiliate-adapters.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { apiRouter } from '../../src/routes/api.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Cuelinks V3 Monetization API & MCP Integration (Spec §§ 1–10)', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';
  let app: Hono;

  beforeEach(() => {
    vi.restoreAllMocks();
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    app = new Hono();
    app.route('/api/v1', apiRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Client Configuration & Authentication Boundary', () => {
    it('fails closed when CUELINKS_API_KEY is unset and does not crash the system', async () => {
      const client = new CuelinksV3Client({ apiKey: '' });
      expect(client.isConfigured()).toBe(false);

      const ping = await client.ping();
      expect(ping.connected).toBe(false);
      expect(ping.message).toContain('CUELINKS_API_KEY is unset');

      await expect(client.searchCampaigns()).rejects.toThrow('CUELINKS_UNCONFIGURED');
    });

    it('injects Authorization: Token <key> and handles 401 unauthorized gracefully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Invalid authentication token'
      });

      const client = new CuelinksV3Client({
        apiKey: 'invalid_token_xyz',
        fetchFn: mockFetch as any
      });

      expect(client.isConfigured()).toBe(true);
      const ping = await client.ping();
      expect(ping.connected).toBe(false);
      expect(ping.message).toContain('CUELINKS_UNAUTHORIZED');

      // Verify request had correct Authorization header and called /pub_api/v3/ping
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ping'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Token invalid_token_xyz'
          })
        })
      );
    });

    it('calls official GET /pub_api/v3/ping and returns publisher metadata and scopes safely', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          publisher_id: 84920,
          email: 'publisher@example.com',
          scopes: [
            'read:campaigns',
            'read:offers',
            'write:links',
            'read:channels',
            'write:channels',
            'read:reports',
            'read:transactions'
          ]
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'valid_test_token',
        fetchFn: mockFetch as any
      });

      const ping = await client.ping();
      expect(ping.connected).toBe(true);
      expect(ping.publisherId).toBe(84920);
      expect(ping.email).toBe('publisher@example.com');
      expect(ping.scopes).toContain('read:campaigns');
      expect(ping.scopes).toContain('write:links');
      expect(ping.scopes).toContain('read:transactions');

      // Never expose raw API key in ping result
      expect(JSON.stringify(ping)).not.toContain('valid_test_token');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ping'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Token valid_test_token'
          })
        })
      );
    });
  });

  describe('2. Campaign Search & Offer Retrieval', () => {
    it('searches campaigns with access_status and sorts by epc_7d', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 4821,
              name: 'Flipkart India',
              url: 'https://www.flipkart.com',
              status: 'active',
              access_status: 'open',
              payout: '4.50%',
              epc_7d: '3.21',
              tracking_url: 'https://clnk.in/xY7z'
            }
          ],
          meta: { total: 1 }
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const result = await client.searchCampaigns({
        access_status: 'open',
        sort: 'epc_7d',
        order: 'desc'
      });

      expect(result.total).toBe(1);
      expect(result.campaigns[0].name).toBe('Flipkart India');
      expect(result.campaigns[0].access_status).toBe('open');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('access_status=open&sort=epc_7d&order=desc'),
        expect.anything()
      );
    });

    it('retrieves live promotional offers and coupons across campaigns', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 9912,
              campaign_id: 4821,
              campaign_name: 'Flipkart India',
              title: 'Flipkart Electronics Sale - Up to 50% Off',
              url: 'https://www.flipkart.com/offers/electronics',
              coupon_code: 'FLIP50',
              discount: '50% off',
              terms: 'Applicable on select audio brands',
              current_price_inr: 1499,
              reference_price_inr: 2999
            }
          ],
          meta: { total: 1 }
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const result = await client.getOffers({ campaign_id: 4821 });
      expect(result.total).toBe(1);
      expect(result.offers[0].coupon_code).toBe('FLIP50');
      expect(result.offers[0].current_price_inr).toBe(1499);
    });
  });

  describe('3. Link Conversion, SSRF Defense & Sub-ID Tracking', () => {
    it('blocks SSRF internal and metadata destinations before issuing link conversion', async () => {
      const client = new CuelinksV3Client({ apiKey: 'test_token' });

      // Loopback
      await expect(client.convertLink({ url: 'http://127.0.0.1:8080/admin' })).rejects.toThrow('SSRF_REJECTED');
      // Cloud metadata
      await expect(client.convertLink({ url: 'http://169.254.169.254/latest/meta-data/' })).rejects.toThrow('SSRF_REJECTED');
      // Private subnet
      await expect(client.convertLink({ url: 'http://192.168.1.100/deals' })).rejects.toThrow('SSRF_REJECTED');
    });

    it('converts safe public URLs with 5-level sub-IDs', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          short_url: 'https://clnk.in/wP99',
          url: 'https://linksredirect.com/?cid=4821&subid=aro_deal_123',
          affiliated: true,
          campaign: { id: 4821, name: 'Flipkart India' }
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const result = await client.convertLink({
        url: 'https://www.flipkart.com/item/laptop-deal',
        subid: 'aro_deal_123',
        subid2: 'electronics',
        subid3: 'buying_guide_v1',
        subid4: 'google_organic',
        subid5: 'user_session_456'
      });

      expect(result.affiliated).toBe(true);
      expect(result.short_url).toBe('https://clnk.in/wP99');
      expect(result.tracking_url).toBe('https://clnk.in/wP99');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/links/convert'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            url: 'https://www.flipkart.com/item/laptop-deal',
            shorten: true,
            subid: 'aro_deal_123',
            subid2: 'electronics',
            subid3: 'buying_guide_v1',
            subid4: 'google_organic',
            subid5: 'user_session_456'
          })
        })
      );
    });

    it('enforces affiliated: true as mandatory for monetization; falls back to direct URL when affiliated: false', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          short_url: 'https://clnk.in/unaffiliated',
          url: 'https://linksredirect.com/?cid=0',
          affiliated: false,
          campaign: null
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const directMerchantUrl = 'https://www.unaffiliatedmerchant.com/product/123';
      const result = await client.convertLink({
        url: directMerchantUrl,
        shorten: true
      });

      expect(result.affiliated).toBe(false);
      // Preserves original direct merchant URL
      expect(result.tracking_url).toBe(directMerchantUrl);
      expect(result.url).toBe(directMerchantUrl);
      expect(result.short_url).toBeUndefined();
    });

    it('treats missing/undefined affiliated on response as false (fail-safe)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tracking_url: 'https://linksredirect.com/?cid=123'
          // affiliated is omitted
        })
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const directMerchantUrl = 'https://www.example.com/product';
      const result = await client.convertLink({
        url: directMerchantUrl
      });

      expect(result.affiliated).toBe(false);
      expect(result.tracking_url).toBe(directMerchantUrl);
    });

    it('CuelinksAdapter handles clnk.in and branded subdomains like *.clnk.in', () => {
      const adapter = new CuelinksAdapter();
      expect(adapter.handles('clnk.in')).toBe(true);
      expect(adapter.handles('www.clnk.in')).toBe(true);
      expect(adapter.handles('crma.clnk.in')).toBe(true);
      expect(adapter.handles('deal.clnk.in')).toBe(true);
      expect(adapter.handles('subdomain.clnk.in')).toBe(true);
      expect(adapter.handles('linksredirect.com')).toBe(true);
      expect(adapter.handles('www.linksredirect.com')).toBe(true);
      expect(adapter.handles('cuelinks.com')).toBe(true);
      expect(adapter.handles('www.cuelinks.com')).toBe(true);
      expect(adapter.handles('fakeclnk.in')).toBe(false);
      expect(adapter.handles('notclnk.in')).toBe(false);
      expect(adapter.handles('amazon.in')).toBe(false);

      const tracked = adapter.buildTrackedDestination({
        baseUrl: 'https://crma.clnk.in/abc123',
        clickId: 'click_crma_999'
      });
      expect(tracked).toBe('https://crma.clnk.in/abc123?subid=click_crma_999');
    });
  });

  describe('4. Publisher Channel Management', () => {
    it('discovers existing channel or registers canonical public application channel', async () => {
      const mockFetch = vi.fn()
        // First call: getChannels (empty)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [] })
        })
        // Second call: createChannel
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: 701,
              name: 'AI Marketing Organization Deals & Buying Guides',
              url: 'https://gen-lang-client-0916255372.web.app',
              status: 'active'
            }
          })
        });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const channel = await client.createChannel(
        'AI Marketing Organization Deals & Buying Guides',
        'https://gen-lang-client-0916255372.web.app'
      );

      expect(channel.id).toBe(701);
      expect(channel.status).toBe('active');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Transaction Performance Reconciliation & Commission Accounting', () => {
    it('reconciles transactions into pending, validated, paid, and ₹0.00 cash received', async () => {
      const mockFetch = vi.fn()
        // Ping endpoint check
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            publisher_id: 701,
            email: 'partner@ai-marketing.org',
            scopes: [
              'read:campaigns',
              'read:offers',
              'write:links',
              'read:channels',
              'write:channels',
              'read:reports',
              'read:transactions'
            ]
          })
        })
        // Channels check for getChannels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 701, url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }]
          })
        })
        // Campaigns
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], meta: { total: 0 } })
        })
        // Offers
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], meta: { total: 0 } })
        })
        // Transactions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'tx_1', campaign_id: 1, campaign_name: 'Flipkart', commission_amount: 150, status: 'pending', transaction_date: '2026-10-24' },
              { id: 'tx_2', campaign_id: 1, campaign_name: 'Flipkart', commission_amount: 350, status: 'approved', transaction_date: '2026-10-23' },
              { id: 'tx_3', campaign_id: 2, campaign_name: 'Myntra', commission_amount: 100, status: 'rejected', transaction_date: '2026-10-22' },
              { id: 'tx_4', campaign_id: 1, campaign_name: 'Flipkart', commission_amount: 500, status: 'paid', transaction_date: '2026-10-20' }
            ],
            meta: { total: 4 }
          })
        })
        // Reports
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ clicks: 24, conversions: 3, commission: 500, epc: 20.83 }]
          })
        });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const syncManager = new CuelinksSyncManager(client);
      const syncResult = await syncManager.syncCuelinks(orgId, bizId);

      expect(syncResult.success).toBe(true);
      const rec = syncResult.status.reconciliation;
      expect(rec.pendingCommissionINR).toBe(150);
      expect(rec.validatedCommissionINR).toBe(350);
      expect(rec.reversedCommissionINR).toBe(100);
      expect(rec.paidCommissionINR).toBe(500);
      // Strictly ₹0.00 until bank confirmed
      expect(rec.cashReceivedINR).toBe(0);
      expect(rec.providerAttributedClicks).toBe(24);
      expect(rec.reportedConversions).toBe(3);
    });

    it('sets isMonetizable: false and preserves direct merchant URL when offer conversion has affiliated: false', async () => {
      const mockFetch = vi.fn()
        // Ping
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            publisher_id: 701,
            email: 'partner@ai-marketing.org',
            scopes: ['read:campaigns', 'read:offers', 'write:links', 'read:channels', 'write:channels', 'read:reports', 'read:transactions']
          })
        })
        // Channels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 701, url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }] })
        })
        // Campaigns
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 5001, name: 'Brand Store', status: 'active', access_status: 'open' }],
            meta: { total: 1 }
          })
        })
        // Offers
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{
              id: 99,
              campaign_id: 5001,
              title: 'Non Affiliated Deal',
              url: 'https://www.directmerchant.com/deal/xyz',
              current_price_inr: 500
            }],
            meta: { total: 1 }
          })
        })
        // Convert link returns affiliated: false
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            url: 'https://www.directmerchant.com/deal/xyz',
            affiliated: false
          })
        })
        // Transactions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], meta: { total: 0 } })
        })
        // Reports
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [] })
        });

      const client = new CuelinksV3Client({
        apiKey: 'test_token',
        fetchFn: mockFetch as any
      });

      const syncManager = new CuelinksSyncManager(client);
      const res = await syncManager.syncCuelinks(orgId, bizId);

      expect(res.success).toBe(true);
      expect(res.dealCandidates.length).toBe(1);
      const deal = res.dealCandidates[0];
      expect(deal.isMonetizable).toBe(false);
      expect(deal.productUrl).toBe('https://www.directmerchant.com/deal/xyz');
      expect(deal.trackingUrl).toBeUndefined();
      expect(deal.affiliateNetwork).toBeUndefined();
      expect(res.status.linksConverted).toBe(0);
    });

    it('verifies all 8 distinct accounting counters and strictly ₹0.00 unverified cash', async () => {
      const mockFetch = vi.fn()
        // Ping
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: 'success', publisher_id: 101 })
        })
        // Channels
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 101, url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }] })
        })
        // Campaigns
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], meta: { total: 0 } })
        })
        // Offers
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [], meta: { total: 0 } })
        })
        // Transactions
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 't1', campaign_id: 1, commission_amount: 1000, status: 'paid' }
            ],
            meta: { total: 1 }
          })
        })
        // Reports
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ clicks: 150, conversions: 12, commission: 1000, epc: 6.67 }]
          })
        });

      const client = new CuelinksV3Client({ apiKey: 'test_token', fetchFn: mockFetch as any });
      const syncManager = new CuelinksSyncManager(client);
      const res = await syncManager.syncCuelinks(orgId, bizId);

      const r = res.status.reconciliation;
      // Counter 1: localClicks
      expect(typeof r.localClicks).toBe('number');
      // Counter 2: providerAttributedClicks
      expect(r.providerAttributedClicks).toBe(150);
      // Counter 3: reportedConversions
      expect(r.reportedConversions).toBe(12);
      // Counter 4: pendingCommissionINR
      expect(r.pendingCommissionINR).toBe(0);
      // Counter 5: validatedCommissionINR
      expect(r.validatedCommissionINR).toBe(0);
      // Counter 6: reversedCommissionINR
      expect(r.reversedCommissionINR).toBe(0);
      // Counter 7: paidCommissionINR
      expect(r.paidCommissionINR).toBe(1000);
      // Counter 8: cashReceivedINR (STRICTLY 0.00 until bank statement confirmed)
      expect(r.cashReceivedINR).toBe(0);
    });
  });

  describe('6. Zero-Downtime Unconfigured Fallback in Deal Discovery Engine', () => {
    it('executes deal discovery cycle cleanly when Cuelinks is unconfigured without throwing', async () => {
      // Ensure CUELINKS_API_KEY is not set
      delete process.env.CUELINKS_API_KEY;
      delete process.env.CUELINKS_TOKEN;
      CuelinksV3Client.resetInstance();
      CuelinksSyncManager.resetInstance();

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const cycle = await engine.runDiscoveryCycle(orgId, bizId);

      expect(cycle.activeDealsTotal).toBeGreaterThanOrEqual(1);
      expect(cycle.sourcesScanned).toBeGreaterThanOrEqual(10);

      const metrics = engine.getDealEngineMetrics();
      expect(metrics.cuelinksSync).toBeDefined();
      expect(metrics.cuelinksSync?.configured).toBe(false);
      expect(metrics.cuelinksSync?.status).toBe('BLOCKED_AUTHORIZATION');
      expect(metrics.cuelinksSync?.ownerActionRequired).toContain('Provide CUELINKS_API_KEY');
    });
  });

  describe('7. Secured HTTP Endpoints for Owner Observability', () => {
    it('rejects anonymous access to GET /api/v1/owner/cuelinks/status with 401', async () => {
      const res = await app.request('/api/v1/owner/cuelinks/status');
      expect(res.status).toBe(401);
    });

    it('rejects anonymous access to POST /api/v1/owner/cuelinks/sync with 401', async () => {
      const res = await app.request('/api/v1/owner/cuelinks/sync', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('allows authenticated owner access to GET /api/v1/owner/cuelinks/status', async () => {
      const auth = OwnerAuthService.getInstance();
      const session = await auth.createSessionAsync(orgId);

      const res = await app.request('/api/v1/owner/cuelinks/status', {
        headers: {
          Authorization: `Bearer ${session.token}`,
          'x-organization-id': orgId
        }
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.status).toBeDefined();
      expect(json.data.reconciliation).toBeDefined();
    });
  });

  describe('8. Error Classification & Credential Redaction Boundary', () => {
    it('classifies HTTP 401 as CUELINKS_UNAUTHORIZED and redacts credentials', async () => {
      const secretKey = 'my_secret_cuelinks_key_888';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => `Unauthorized: Token ${secretKey} is invalid`
      });

      const client = new CuelinksV3Client({ apiKey: secretKey, fetchFn: mockFetch as any });

      await expect(client.searchCampaigns()).rejects.toThrow('CUELINKS_UNAUTHORIZED');
      try {
        await client.searchCampaigns();
      } catch (err: any) {
        expect(err.message).toContain('CUELINKS_UNAUTHORIZED');
        expect(err.message).not.toContain(secretKey);
        expect(err.message).toContain('[REDACTED]');
      }
    });

    it('classifies HTTP 403 as CUELINKS_FORBIDDEN (missing scope/forbidden) and redacts credentials', async () => {
      const secretKey = 'my_secret_key_403';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => `Forbidden: Token ${secretKey} lacks scope write:links`
      });

      const client = new CuelinksV3Client({ apiKey: secretKey, fetchFn: mockFetch as any });

      try {
        await client.convertLink({ url: 'https://www.flipkart.com/item' });
        expect.unreachable();
      } catch (err: any) {
        expect(err.message).toContain('CUELINKS_FORBIDDEN');
        expect(err.message).not.toContain(secretKey);
        expect(err.message).toContain('[REDACTED]');
      }
    });

    it('classifies HTTP 422 as CUELINKS_UNPROCESSABLE_ENTITY and redacts credentials', async () => {
      const secretKey = 'my_secret_key_422';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: async () => `Unprocessable Entity: invalid parameter for key ${secretKey}`
      });

      const client = new CuelinksV3Client({ apiKey: secretKey, fetchFn: mockFetch as any });

      try {
        await client.convertLink({ url: 'https://www.flipkart.com/item' });
        expect.unreachable();
      } catch (err: any) {
        expect(err.message).toContain('CUELINKS_UNPROCESSABLE_ENTITY');
        expect(err.message).not.toContain(secretKey);
        expect(err.message).toContain('[REDACTED]');
      }
    });

    it('classifies HTTP 429 as CUELINKS_RATE_LIMITED and redacts credentials', async () => {
      const secretKey = 'my_secret_key_429';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => `Too many requests for Token ${secretKey}`
      });

      const client = new CuelinksV3Client({ apiKey: secretKey, fetchFn: mockFetch as any });

      try {
        await client.searchCampaigns();
        expect.unreachable();
      } catch (err: any) {
        expect(err.message).toContain('CUELINKS_RATE_LIMITED');
        expect(err.message).not.toContain(secretKey);
        expect(err.message).toContain('[REDACTED]');
      }
    });

    it('classifies HTTP 5xx as CUELINKS_SERVER_ERROR and redacts credentials', async () => {
      const secretKey = 'my_secret_key_500';
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => `Service Unavailable for Token ${secretKey}`
      });

      const client = new CuelinksV3Client({ apiKey: secretKey, fetchFn: mockFetch as any });

      try {
        await client.searchCampaigns();
        expect.unreachable();
      } catch (err: any) {
        expect(err.message).toContain('CUELINKS_SERVER_ERROR');
        expect(err.message).not.toContain(secretKey);
        expect(err.message).toContain('[REDACTED]');
      }
    });
  });
});
