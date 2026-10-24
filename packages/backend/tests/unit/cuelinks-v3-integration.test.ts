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

      // Verify request had correct Authorization header
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/channels'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Token invalid_token_xyz'
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
            short_url: true,
            subid: 'aro_deal_123',
            subid2: 'electronics',
            subid3: 'buying_guide_v1',
            subid4: 'google_organic',
            subid5: 'user_session_456'
          })
        })
      );
    });

    it('CuelinksAdapter handles clnk.in short links natively', () => {
      const adapter = new CuelinksAdapter();
      expect(adapter.handles('clnk.in')).toBe(true);
      expect(adapter.handles('www.clnk.in')).toBe(true);
      expect(adapter.handles('linksredirect.com')).toBe(true);
      expect(adapter.handles('cuelinks.com')).toBe(true);
      expect(adapter.handles('amazon.in')).toBe(false);

      const tracked = adapter.buildTrackedDestination({
        baseUrl: 'https://clnk.in/abc123',
        clickId: 'click_test_888'
      });
      expect(tracked).toContain('subid=click_test_888');
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
        // Channels check for ping
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 701, url: 'https://gen-lang-client-0916255372.web.app', status: 'active' }]
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
});
