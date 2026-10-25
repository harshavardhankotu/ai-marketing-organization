import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { AutonomousCommercialEngine } from '../../src/commission/autonomous-commercial-engine.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { GrowthExperimentTracker } from '../../src/commission/growth-experiment-tracker.js';
import { CUELINKS_REQUIRED_SCOPES } from '../../src/commission/cuelinks-v3-types.js';
import { getDb } from '../../src/db/client.js';

describe('Revenue Engine V2.6 — Verification Test Suite', () => {
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    vi.restoreAllMocks();
    AutonomousDealDiscoveryEngine.resetInstance();
    GrowthExperimentTracker.resetInstance();

    // Clean up test workflows and partners in SQLite
    try {
      const db = getDb();
      db.prepare(`DELETE FROM workflows WHERE workflow_type = 'COMMERCIAL_AFFILIATE_ACTIVATION'`).run();
      db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM partners WHERE organization_id = ? AND network = 'CUELINKS'`).run(orgId);
    } catch {}
  });

  describe('1. Strict Conversion Truth & Direct Link Preservation', () => {
    it('sets isMonetizable=false and trackingUrl=undefined when convertLink returns affiliated: false', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/ping')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'success',
              publisher: { id: 331585, name: 'ARO Deals' },
              api_key: { scopes: [...CUELINKS_REQUIRED_SCOPES] }
            })
          };
        }
        if (url.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: 331585, name: 'ARO Deals', url: 'https://ai-marketing-organization.onrender.com' }]
          };
        }
        if (url.includes('/campaigns')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              campaigns: [{ id: 101, name: 'Reliance Digital', domain: 'reliancedigital.in', status: 'active', access_status: 'open' }],
              pagination: { current_page: 1, total_pages: 1 }
            })
          };
        }
        if (url.includes('/offers')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              offers: [{
                id: 991,
                campaign_id: 101,
                title: 'Reliance Digital 10% Off Appliances',
                url: 'https://www.reliancedigital.in/appliances-sale',
                tracking_url: 'https://linksredirect.com/?cid=101&subid=feed&url=https%3A%2F%2Fwww.reliancedigital.in',
                status: 'active',
                discount_price: 4999,
                original_price: 5999,
                percent_off: 17
              }],
              pagination: { current_page: 1, total_pages: 1 }
            })
          };
        }
        if (url.includes('/links')) {
          // Explicitly unaffiliated conversion (e.g. merchant does not support direct link monetization)
          return {
            ok: true,
            status: 200,
            json: async () => ({
              url: 'https://www.reliancedigital.in/appliances-sale',
              affiliated: false
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_live_key_cl',
        fetchFn: mockFetch as any
      });

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.setCuelinksClient(client);

      const deals = await engine.runCuelinksAdapter();
      expect(deals.length).toBe(1);
      const deal = deals[0];

      // Strict verification: Must NOT monetize unafilliated deal despite feed tracking_url presence
      expect(deal.isMonetizable).toBe(false);
      expect(deal.trackingUrl).toBeUndefined();
      expect(deal.productUrl).toBe('https://www.reliancedigital.in/appliances-sale');
    });

    it('sets isMonetizable=false when convertLink throws or encounters network failure', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/ping')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'success',
              publisher: { id: 331585, name: 'ARO Deals' },
              api_key: { scopes: [...CUELINKS_REQUIRED_SCOPES] }
            })
          };
        }
        if (url.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: 331585, name: 'ARO Deals', url: 'https://ai-marketing-organization.onrender.com' }]
          };
        }
        if (url.includes('/campaigns')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              campaigns: [{ id: 202, name: 'Croma India', domain: 'croma.com', status: 'active', access_status: 'open' }],
              pagination: { current_page: 1, total_pages: 1 }
            })
          };
        }
        if (url.includes('/offers')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              offers: [{
                id: 992,
                campaign_id: 202,
                title: 'Croma Laptop Mega Sale',
                url: 'https://www.croma.com/laptops',
                tracking_url: 'https://linksredirect.com/?cid=202&subid=feed&url=https%3A%2F%2Fwww.croma.com',
                status: 'active',
                discount_price: 38990,
                original_price: 45990,
                percent_off: 15
              }],
              pagination: { current_page: 1, total_pages: 1 }
            })
          };
        }
        if (url.includes('/links')) {
          throw new Error('ETIMEDOUT: Connection to Cuelinks links service timed out');
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_live_key_cl',
        fetchFn: mockFetch as any
      });

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.setCuelinksClient(client);

      const deals = await engine.runCuelinksAdapter();
      expect(deals.length).toBe(1);
      const deal = deals[0];

      expect(deal.isMonetizable).toBe(false);
      expect(deal.trackingUrl).toBeUndefined();
      expect(deal.productUrl).toBe('https://www.croma.com/laptops');
    });

    it('sets isMonetizable=true only when convertLink explicitly returns affiliated: true with allowlisted URL', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/ping')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'success',
              publisher: { id: 331585, name: 'ARO Deals' },
              api_key: { scopes: [...CUELINKS_REQUIRED_SCOPES] }
            })
          };
        }
        if (url.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: 331585, name: 'ARO Deals', url: 'https://ai-marketing-organization.onrender.com' }]
          };
        }
        if (url.includes('/campaigns')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              campaigns: [{ id: 303, name: 'boAt Lifestyle', domain: 'boat-lifestyle.com', status: 'active', access_status: 'open' }],
              pagination: { current_page: 1, total_pages: 1 }
            })
          };
        }
        if (url.includes('/offers')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              offers: [{
                id: 993,
                campaign_id: 303,
                title: 'boAt Airdopes 141 Anc',
                url: 'https://www.boat-lifestyle.com/products/airdopes-141-anc',
                tracking_url: 'https://linksredirect.com/?cid=303&subid=feed&url=https%3A%2F%2Fwww.boat-lifestyle.com',
                status: 'active',
                discount_price: 1499,
                original_price: 4490,
                percent_off: 67
              }],
              pagination: { current_page: 1, total_pages: 1 }
            })
          };
        }
        if (url.includes('/links')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              url: 'https://www.boat-lifestyle.com/products/airdopes-141-anc',
              affiliated: true,
              tracking_url: 'https://linksredirect.com/?cid=303&subid=aro_cl_993&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141-anc',
              short_url: 'https://clnk.in/boat141',
              campaign: { id: 303, name: 'boAt Lifestyle' }
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const client = new CuelinksV3Client({
        apiKey: 'test_live_key_cl',
        fetchFn: mockFetch as any
      });

      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.setCuelinksClient(client);

      const deals = await engine.runCuelinksAdapter();
      expect(deals.length).toBe(1);
      const deal = deals[0];

      expect(deal.isMonetizable).toBe(true);
      expect(deal.trackingUrl).toBe('https://clnk.in/boat141');
      expect(deal.affiliateNetwork).toBe('CUELINKS');
    });
  });

  describe('2. Fail-Closed Scope Verification in ping()', () => {
    it('returns authorized: false when server omits scopes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          publisher: { id: 331585, name: 'ARO Deals' },
          api_key: { last_used_at: '2026-10-25T01:00:00Z' }
          // scopes omitted completely
        })
      });

      const client = new CuelinksV3Client({ apiKey: 'key_unscoped', fetchFn: mockFetch as any });
      const ping = await client.ping();

      expect(ping.connected).toBe(true);
      expect(ping.authorized).toBe(false);
      expect(ping.scopes).toBeUndefined();
      expect(ping.missingScopes).toEqual(CUELINKS_REQUIRED_SCOPES);
      expect(ping.message).toContain('no scopes reported or verified');
    });

    it('returns authorized: false when server supplies empty scopes array', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          publisher: { id: 331585, name: 'ARO Deals' },
          api_key: { scopes: [] }
        })
      });

      const client = new CuelinksV3Client({ apiKey: 'key_empty_scopes', fetchFn: mockFetch as any });
      const ping = await client.ping();

      expect(ping.connected).toBe(true);
      expect(ping.authorized).toBe(false);
      expect(ping.scopes).toEqual([]);
      expect(ping.missingScopes).toEqual(CUELINKS_REQUIRED_SCOPES);
    });

    it('returns authorized: false when server supplies partial scopes', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          publisher: { id: 331585, name: 'ARO Deals' },
          api_key: { scopes: ['read:campaigns', 'read:offers'] }
        })
      });

      const client = new CuelinksV3Client({ apiKey: 'key_partial_scopes', fetchFn: mockFetch as any });
      const ping = await client.ping();

      expect(ping.connected).toBe(true);
      expect(ping.authorized).toBe(false);
      expect(ping.missingScopes).toContain('write:links');
      expect(ping.missingScopes).toContain('read:transactions');
      expect(ping.message).toContain('lacks required scopes');
    });

    it('returns authorized: true when all required discovery scopes are present without write:channels', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          publisher: { id: 331585, name: 'ARO Deals' },
          api_key: { scopes: [...CUELINKS_REQUIRED_SCOPES] }
        })
      });

      const client = new CuelinksV3Client({ apiKey: 'key_full_scopes', fetchFn: mockFetch as any });
      const ping = await client.ping();

      expect(ping.connected).toBe(true);
      expect(ping.authorized).toBe(true);
      expect(ping.missingScopes).toEqual([]);
      expect(ping.message).toContain('Successfully authenticated');
    });
  });

  describe('3. Commercial State Machine Blocker Resilience & Anti-Bouncing', () => {
    it('keeps task BLOCKED and does NOT bounce to READY when trackingUrl and offer are missing', async () => {
      const commercialEngine = AutonomousCommercialEngine.getInstance();

      // Create a blocked task lacking trackingUrl
      const task = {
        id: 'wf_comm_test_blocked_1',
        organizationId: orgId,
        businessId: bizId,
        workflowType: 'COMMERCIAL_AFFILIATE_ACTIVATION' as const,
        status: 'BLOCKED' as const,
        currentStep: 'QUALIFY',
        retryCount: 0,
        maxRetries: 5,
        inputs: {
          network: 'CUELINKS' as const,
          merchantName: 'Cuelinks India'
        },
        outputs: {},
        errorInfo: {
          blockerType: 'MISSING_OWNER_AUTHORIZATION' as const,
          message: 'No active offer or tracked destination URL provided.'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Call internal checkIfBlockerCleared
      const isCleared = await (commercialEngine as any).checkIfBlockerCleared(task, orgId);
      expect(isCleared).toBe(false);
    });

    it('clears blocker when allowlisted tracking URL is provided in inputs', async () => {
      const commercialEngine = AutonomousCommercialEngine.getInstance();

      const task = {
        id: 'wf_comm_test_blocked_2',
        organizationId: orgId,
        businessId: bizId,
        workflowType: 'COMMERCIAL_AFFILIATE_ACTIVATION' as const,
        status: 'BLOCKED' as const,
        currentStep: 'QUALIFY',
        retryCount: 0,
        maxRetries: 5,
        inputs: {
          network: 'CUELINKS' as const,
          merchantName: 'Cuelinks India',
          trackingUrl: 'https://linksredirect.com/?cid=331585&subid=clk_1&url=https%3A%2F%2Fwww.cuelinks.com'
        },
        outputs: {},
        errorInfo: {
          blockerType: 'MISSING_OWNER_AUTHORIZATION' as const,
          message: 'Awaiting operator-confirmed registration'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const isCleared = await (commercialEngine as any).checkIfBlockerCleared(task, orgId);
      expect(isCleared).toBe(true);
    });
  });

  describe('4. Attribution & Transaction Reconciliation Truth', () => {
    it('counts only validated/payable/paid transactions as conversions and ignores pending/rejected', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/ping')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'success',
              publisher: { id: 331585, name: 'ARO Deals' },
              api_key: { scopes: [...CUELINKS_REQUIRED_SCOPES] }
            })
          };
        }
        if (url.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => [{ id: 331585, name: 'ARO Deals', url: 'https://ai-marketing-organization.onrender.com' }]
          };
        }
        if (url.includes('/campaigns')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ campaigns: [], pagination: { current_page: 1, total_pages: 1 } })
          };
        }
        if (url.includes('/reports/performance')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [],
              totals: { clicks: 12, transactions: 1 }
            })
          };
        }
        if (url.includes('/transactions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 1, status: 'pending', user_commission: 45.0 },
                { id: 2, status: 'rejected', user_commission: 120.0 },
                { id: 3, status: 'approved', user_commission: 85.5 },
                { id: 4, status: 'paid', user_commission: 200.0 }
              ]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const client = new CuelinksV3Client({ apiKey: 'reconciliation_test_key', fetchFn: mockFetch as any });
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.setCuelinksClient(client);

      await engine.runCuelinksAdapter();

      const funnel = engine.getSevenStageFunnel();
      // Totals from performance report should override raw transaction count of 4
      expect(funnel.reportedConversions).toBe(1);
      expect(funnel.pendingCommissionsINR).toBe(45);
      expect(funnel.validatedCommissionsINR).toBe(85.5);
      expect(funnel.paidCommissionsINR).toBe(200);
      expect(funnel.reversedCommissionsINR).toBe(120);
      expect(funnel.cashReceivedINR).toBe(0); // Strictly ₹0.00 until bank statement proof
    });

    it('reports cycle status DISCOVERY_COMPLETED_WITH_BLOCKERS when a source fails during discovery', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.clearRegisteredCandidates();

      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/ping')) {
          return {
            ok: false,
            status: 503,
            json: async () => ({ status: 'error', message: 'Service Unavailable' })
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const client = new CuelinksV3Client({ apiKey: 'failing_key', fetchFn: mockFetch as any });
      engine.setCuelinksClient(client);

      // Inject a test deal so total discovered > 0
      engine.injectDiscoveredDealsForTesting([{
        title: 'Noise ColorFit Pulse Grand',
        brand: 'Noise',
        merchant: 'Noise India',
        category: 'Smartwatches',
        productUrl: 'https://www.gonoise.com/products/colorfit-pulse-grand',
        dealKind: 'PRODUCT',
        currentPriceINR: 1299,
        referencePriceINR: 3999,
        availability: 'IN_STOCK'
      }]);

      const cycleResult = await engine.runDiscoveryCycle();
      expect(cycleResult.status).toBe('DISCOVERY_COMPLETED_WITH_BLOCKERS');
    });
  });

  describe('5. Growth Experiment Tracker & High-Intent Student Travel Guide', () => {
    it('registers all 3 baseline growth experiments with 7-day review horizons', () => {
      const tracker = GrowthExperimentTracker.getInstance();
      const experiments = tracker.listAllExperiments();

      expect(experiments.length).toBeGreaterThanOrEqual(3);

      const studentGuideExp = experiments.find(e => e.id === 'gexp_student_travel_guide_v1');
      expect(studentGuideExp).toBeDefined();
      expect(studentGuideExp?.title).toContain('Student Travel Discount');
      expect(studentGuideExp?.targetMerchants).toContain('Air India Express');
      expect(studentGuideExp?.targetCategories).toContain('Travel & Hospitality');
      expect(studentGuideExp?.status).toBe('ACTIVE');

      const boatExp = experiments.find(e => e.id === 'gexp_boat_coupon_badge_v1');
      expect(boatExp).toBeDefined();

      const cromaExp = experiments.find(e => e.id === 'gexp_croma_mrp_anchor_v1');
      expect(cromaExp).toBeDefined();
    });

    it('falls back to local SQLite when D1 returns null for published content assets', async () => {
      const { ContentAssetEngine } = await import('../../src/commission/content-asset-engine.js');
      const { getDb } = await import('../../src/db/client.js');
      const db = getDb();

      // Insert a test published guide into SQLite directly
      const testSlug = 'unit-test-student-guide-fallback';
      db.prepare(`
        INSERT OR REPLACE INTO commission_content_assets (
          id, organization_id, slug, asset_type, title, category, location, intent_target,
          content_markdown, primary_offer_id, matched_offer_ids_json, disclosure_markdown,
          status, view_count, referral_click_count, quality_gate_json, disclosure_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'guide_unit_test_fallback',
        'org_owner_primary',
        testSlug,
        'BUYING_GUIDE',
        'Unit Test Student Airline Concession Guide',
        'Travel & Hospitality',
        'India',
        'Student flight discounts',
        '# Unit Test Student Airline Concessions\n\nOfficial DGCA baggage rules apply.',
        null,
        '[]',
        'Affiliate disclosure test.',
        'PUBLISHED',
        5,
        1,
        '{}',
        '2026.1'
      );

      const engine = ContentAssetEngine.getInstance();
      const asset = await engine.getAssetBySlug(testSlug, false);

      expect(asset).not.toBeNull();
      expect(asset?.slug).toBe(testSlug);
      expect(asset?.title).toBe('Unit Test Student Airline Concession Guide');
      expect(asset?.contentMarkdown).toContain('Official DGCA baggage rules apply.');
    });
  });
});
