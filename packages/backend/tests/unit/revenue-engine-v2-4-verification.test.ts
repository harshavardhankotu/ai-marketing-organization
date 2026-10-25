import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';

describe('Revenue Engine V2.4 — Verification & Defect Fixes Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Finding 4: ping() Scope Verification & Missing Scope Authorization Blocker', () => {
    it('reports connected: true and authorized: true when all required scopes are granted', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          publisher: { id: 281897, name: 'Publisher', currency: 'INR' },
          api_key: {
            scopes: [
              'read:campaigns',
              'read:offers',
              'write:links',
              'read:transactions',
              'read:reports',
              'read:channels'
            ]
          }
        })
      });

      const client = new CuelinksV3Client({ apiKey: 'valid_key', fetchFn: mockFetch as any });
      const ping = await client.ping();

      expect(ping.connected).toBe(true);
      expect(ping.authorized).toBe(true);
      expect(ping.missingScopes).toEqual([]);
    });

    it('reports authorized: false and identifies missing required scopes without false green', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          publisher: { id: 281897, name: 'Publisher', currency: 'INR' },
          api_key: {
            scopes: ['read:campaigns', 'read:offers'] // missing write:links, read:transactions, etc.
          }
        })
      });

      const client = new CuelinksV3Client({ apiKey: 'partial_key', fetchFn: mockFetch as any });
      const ping = await client.ping();

      expect(ping.connected).toBe(true);
      expect(ping.authorized).toBe(false);
      expect(ping.missingScopes).toContain('write:links');
      expect(ping.missingScopes).toContain('read:transactions');
      expect(ping.missingScopes).toContain('read:reports');
      expect(ping.message).toContain('lacks required scopes');
    });
  });

  describe('Finding 1: Destination URL Extraction without Redirect Loops', () => {
    it('extracts merchant URL from tracking_url parameter before converting', async () => {
      let passedBody: any = null;
      const mockFetch = vi.fn().mockImplementation(async (url: string, init: any) => {
        if (url.includes('/links/convert')) {
          passedBody = JSON.parse(init.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                affiliated: true,
                tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fmerchant.com%2Fdeal',
                short_url: 'https://clnk.in/XYZ'
              }
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      });

      const client = new CuelinksV3Client({ apiKey: 'test_key', fetchFn: mockFetch as any });
      const res = await client.convertLink({
        url: 'https://linksredirect.com/?cid=999&url=https%3A%2F%2Fmerchant.com%2Fdeal',
        subid: 'test'
      });

      expect(res.affiliated).toBe(true);
      expect(passedBody.url).toBe('https://merchant.com/deal');
      expect(passedBody.url).not.toContain('linksredirect.com');
    });

    it('refuses to pass raw Cuelinks tracking URL into convertLink when destination cannot be unwrapped', async () => {
      const mockFetch = vi.fn();
      const client = new CuelinksV3Client({ apiKey: 'test_key', fetchFn: mockFetch as any });

      const res = await client.convertLink({
        url: 'https://clnk.in/cannot_unwrap_opaque_shortlink',
        subid: 'test'
      });

      expect(res.affiliated).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Finding 3: Official Performance Reports and Transactions Contract', () => {
    it('queries /reports/performance.json and returns official totals and daily data', async () => {
      let calledUrl = '';
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                date: '2026-10-24',
                clicks: 15,
                transactions: 2,
                commission: '240.50',
                sale_amount: '3200.00',
                cr: '13.33',
                epc: '16.03',
                currency: 'INR'
              }
            ],
            totals: {
              clicks: 15,
              transactions: 2,
              commission: '240.50',
              sale_amount: '3200.00',
              cr: '13.33',
              epc: '16.03',
              currency: 'INR'
            },
            meta: { page: 1, per_page: 30, total: 1, total_pages: 1 }
          })
        };
      });

      const client = new CuelinksV3Client({ apiKey: 'test_key', fetchFn: mockFetch as any });
      const report = await client.getPerformanceReport();

      expect(calledUrl).toContain('/reports/performance');
      expect(report.data.length).toBe(1);
      expect(report.totals?.clicks).toBe(15);
      expect(report.totals?.commission).toBe('240.50');
    });

    it('queries /transactions.json supporting updated_since parameter', async () => {
      let calledUrl = '';
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'tx_84920',
                transaction_id: 'TX84920',
                campaign_id: 5555,
                campaign_name: 'Jaipur Rugs',
                status: 'validated',
                user_commission: 150.00,
                sale_amount: 1500.00,
                currency: 'INR',
                transaction_date: '2026-10-24'
              }
            ],
            meta: { total: 1, total_pages: 1, page: 1 }
          })
        };
      });

      const client = new CuelinksV3Client({ apiKey: 'test_key', fetchFn: mockFetch as any });
      const txRes = await client.getTransactions({ updated_since: '2026-10-20T00:00:00Z' });

      expect(calledUrl).toContain('/transactions');
      expect(calledUrl).toContain('updated_since');
      expect(txRes.transactions.length).toBe(1);
      expect(txRes.transactions[0].user_commission).toBe(150);
      expect(txRes.transactions[0].status).toBe('validated');
    });
  });

  describe('Objective B: Market-Wide Opportunity Registry & Segregated Ledgers', () => {
    it('registers all 19 sources with separate ledgers for price intelligence and commodities', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.resetSources();
      const sources = engine.getSources();

      expect(sources.length).toBe(19);

      // Verify distinct ledgers
      const fuelSource = sources.find(s => s.id === 'src_ppac_fuel_intelligence');
      expect(fuelSource).toBeDefined();
      expect(fuelSource?.sourceClass).toBe('PRICE_INTELLIGENCE_UTILITY');
      expect(fuelSource?.monetizationLedger).toBe('PRICE_INTELLIGENCE_UTILITY');

      const commoditySource = sources.find(s => s.id === 'src_ogd_essential_commodities');
      expect(commoditySource).toBeDefined();
      expect(commoditySource?.sourceClass).toBe('OPEN_GOVERNMENT_DATA');
      expect(commoditySource?.monetizationLedger).toBe('CONSUMER_UTILITY');

      const travelSource = sources.find(s => s.id === 'src_travel_transit_deals');
      expect(travelSource?.monetizationLedger).toBe('AFFILIATE_COMMISSION');

      const telecomSource = sources.find(s => s.id === 'src_telecom_broadband_deals');
      expect(telecomSource?.monetizationLedger).toBe('AFFILIATE_COMMISSION');

      const financeSource = sources.find(s => s.id === 'src_compliant_finance_referrals');
      expect(financeSource?.monetizationLedger).toBe('AFFILIATE_COMMISSION');
      expect(financeSource?.complianceRisk).toContain('Zero unlicensed financial advice');
    });
  });

  describe('Autonomous Commercial Engine Blocker Clearance', () => {
    it('unblocks MISSING_OWNER_AUTHORIZATION when Cuelinks API key is configured and valid tracking link is present', async () => {
      const commercialEngine = AutonomousCommercialEngine.getInstance();
      const task: any = {
        id: 'wf_comm_test_cuelinks',
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        workflowType: 'COMMERCIAL_AFFILIATE_ACTIVATION',
        status: 'BLOCKED',
        currentStep: 'QUALIFY',
        inputs: {
          network: 'CUELINKS',
          trackingUrl: 'https://linksredirect.com/?cid=12345&url=https%3A%2F%2Fmerchant.in'
        },
        outputs: {},
        errorInfo: {
          blockerType: 'MISSING_OWNER_AUTHORIZATION',
          message: 'Awaiting operator-confirmed registration'
        }
      };

      // Mock CuelinksV3Client to simulate configured state
      vi.spyOn(CuelinksV3Client.prototype, 'isConfigured').mockReturnValue(true);

      const isCleared = await (commercialEngine as any).checkIfBlockerCleared(task, 'org_owner_primary');
      expect(isCleared).toBe(true);
    });
  });
});
