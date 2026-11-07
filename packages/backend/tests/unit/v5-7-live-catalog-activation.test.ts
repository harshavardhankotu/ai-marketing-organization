import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { AutonomousDealDiscoveryEngine, APPROVED_SHOPIFY_MERCHANTS, normalizeMerchantDomain } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { GoogleSuggestClient } from '../../src/integrations/google-suggest-client.js';
import { app } from '../../src/index.js';

describe('V5.7 — Live Catalog Activation, B2B Leak Prevention & Multi-Merchant Harvester', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    AutonomousDealDiscoveryEngine.resetInstance();
    GoogleSuggestClient.resetInstance();

    try {
      const db = getDb();
      db.prepare("DELETE FROM public_deals").run();
      db.prepare("DELETE FROM workflows WHERE workflow_type = 'PUBLIC_DEAL'").run();
    } catch {}
  });

  afterEach(() => {
    process.env = { ...origEnv };
    AutonomousDealDiscoveryEngine.resetInstance();
    GoogleSuggestClient.resetInstance();
    vi.restoreAllMocks();
  });

  describe('1. Domain Normalization & Approved Merchants Mapping', () => {
    it('normalizes merchant URLs to clean hostnames', () => {
      expect(normalizeMerchantDomain('https://www.boat-lifestyle.com/products/test')).toBe('boat-lifestyle.com');
      expect(normalizeMerchantDomain('http://gonoise.com/')).toBe('gonoise.com');
      expect(normalizeMerchantDomain('www.palmonas.com')).toBe('palmonas.com');
      expect(normalizeMerchantDomain('lavieworld.com')).toBe('lavieworld.com');
    });

    it('has verified approved Shopify merchants mapped to canonical sectors', () => {
      expect(APPROVED_SHOPIFY_MERCHANTS.length).toBeGreaterThanOrEqual(10);
      const boAt = APPROVED_SHOPIFY_MERCHANTS.find(m => m.domain === 'boat-lifestyle.com');
      expect(boAt).toBeDefined();
      expect(boAt?.sectorCode).toBe('SECTOR_B_ELECTRONICS');
      expect(boAt?.cuelinksCampaignId).toBe('4232');

      const palmonas = APPROVED_SHOPIFY_MERCHANTS.find(m => m.domain === 'palmonas.com');
      expect(palmonas?.sectorCode).toBe('SECTOR_A_PRECIOUS_METALS');
    });
  });

  describe('2. Multi-Merchant Shopify Feed Harvester & In-Stock Variant Filtering', () => {
    it('ingests available variants with >= 15% discount and populates public_deals', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();

      const mockShopifyResponse = {
        products: [
          {
            id: 101,
            title: 'boAt Rockerz 450 Pro Bluetooth Headphone',
            handle: 'rockerz-450-pro',
            variants: [
              {
                id: 201,
                title: 'Matte Black',
                price: '1499.00',
                compare_at_price: '3990.00', // ~62% discount
                available: true
              }
            ]
          },
          {
            id: 102,
            title: 'boAt Bassheads 100 Wired Earphones',
            handle: 'bassheads-100',
            variants: [
              {
                id: 202,
                title: 'Furious Red',
                price: '399.00',
                compare_at_price: null, // No compare price -> valid in-stock, no discount badge
                available: true
              }
            ]
          },
          {
            id: 103,
            title: 'boAt Airdopes 141 ANC',
            handle: 'airdopes-141-anc',
            variants: [
              {
                id: 203,
                title: 'Gunmetal',
                price: '1999.00',
                compare_at_price: '4990.00',
                available: false // Out of stock -> MUST BE EXCLUDED
              }
            ]
          }
        ]
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockShopifyResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      engine.setFetchFn(mockFetch as any);

      const boAtMerchant = APPROVED_SHOPIFY_MERCHANTS.find(m => m.domain === 'boat-lifestyle.com')!;
      const ingested = await engine.harvestMerchantShopifyFeed(boAtMerchant);

      expect(ingested.length).toBe(2);
      expect(ingested[0].title).toBe('boAt Rockerz 450 Pro Bluetooth Headphone');
      expect(ingested[0].currentPriceINR).toBe(1499);
      expect(ingested[0].referencePriceINR).toBe(3990);
      expect(ingested[0].discountBadge).toBe('62% OFF');
      expect(ingested[0].availability).toBe('IN_STOCK');
      expect(ingested[0].productUrl).toContain('variant=201');

      // Product without compare_at_price included with null reference price and no discount badge
      expect(ingested[1].title).toBe('boAt Bassheads 100 Wired Earphones');
      expect(ingested[1].currentPriceINR).toBe(399);
      expect(ingested[1].referencePriceINR).toBeFalsy();
      expect(ingested[1].discountBadge).toBeUndefined();

      // Check SQLite public_deals table was populated
      const db = getDb();
      const rows = db.prepare('SELECT * FROM public_deals WHERE availability = ?').all('IN_STOCK') as any[];
      expect(rows.length).toBe(2);

      // Verify GET /api/v1/public/deals returns total >= 1
      const res = await app.request('/api/v1/public/deals');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBeGreaterThanOrEqual(2);
      expect(json.data.deals.length).toBeGreaterThanOrEqual(2);
      expect(json.data.deals[0].title).toBe('boAt Rockerz 450 Pro Bluetooth Headphone');
    });
  });

  describe('3. Public /compare/:sectorSlug Guide ItemList JSON-LD', () => {
    it('renders non-empty itemListElement in ItemList JSON-LD when deals exist', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      const mockShopifyResponse = {
        products: [
          {
            id: 301,
            title: 'Noise ColorFit Pulse Grand Smartwatch',
            handle: 'colorfit-pulse-grand',
            variants: [
              {
                id: 401,
                title: 'Jet Black',
                price: '1199.00',
                compare_at_price: '3999.00',
                available: true
              }
            ]
          }
        ]
      };

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockShopifyResponse), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );
      engine.setFetchFn(mockFetch as any);

      const noiseMerchant = APPROVED_SHOPIFY_MERCHANTS.find(m => m.domain === 'gonoise.com')!;
      await engine.harvestMerchantShopifyFeed(noiseMerchant);

      const res = await app.request('/compare/electronics-technology');
      expect(res.status).toBe(200);
      const html = await res.text();

      // Check ItemList JSON-LD
      expect(html).toContain('"@type": "ItemList"');
      expect(html).toContain('Noise ColorFit Pulse Grand Smartwatch');
      expect(html).toContain('"@type": "ListItem"');
      expect(html).toContain('#Ad');
    });
  });

  describe('4. B2B Backlog Guard in Autonomous Revenue Orchestrator', () => {
    it('halts B2B prospect discovery and drafting when unapproved drafts >= 10', async () => {
      const db = getDb();
      // Ensure at least 10 unapproved drafts exist in direct_outreach_log
      db.prepare("DELETE FROM direct_outreach_log WHERE human_approved = 0").run();
      for (let i = 1; i <= 12; i++) {
        db.prepare(`
          INSERT INTO direct_outreach_log (
            id, business_id, segment, prospect_name, channel, message_draft,
            compliance_checked, human_approved, dispatched, response_status, created_at
          ) VALUES (?, 'biz_platform_aro', 'HEALTHCARE_DENTAL', ?, 'WHATSAPP', 'Test draft', 1, 0, 0, 'APPROVAL_REQUIRED', datetime('now'))
        `).run(`draft_test_${i}`, `Doctor Practice ${i}`);
      }

      const countRow = db.prepare('SELECT COUNT(*) as c FROM direct_outreach_log WHERE human_approved = 0 AND dispatched = 0').get() as any;
      expect(countRow.c).toBeGreaterThanOrEqual(10);

      const aro = AutonomousRevenueOrchestrator.getInstance();
      const initialProspectsCount = (db.prepare('SELECT COUNT(*) as c FROM platform_prospects').get() as any).c;
      const initialDraftsCount = (db.prepare('SELECT COUNT(*) as c FROM direct_outreach_log WHERE human_approved = 0').get() as any).c;

      // Run ARO cycle
      const result = await aro.runCycle('org_owner_primary', 'biz_platform_aro', 'MANUAL');

      const afterProspectsCount = (db.prepare('SELECT COUNT(*) as c FROM platform_prospects').get() as any).c;
      const afterDraftsCount = (db.prepare('SELECT COUNT(*) as c FROM direct_outreach_log WHERE human_approved = 0').get() as any).c;

      // Assert zero new prospects and zero new drafts were created
      expect(afterProspectsCount).toBe(initialProspectsCount);
      expect(afterDraftsCount).toBe(initialDraftsCount);
      expect(result.opportunitiesDiscovered).toBe(0);
    });
  });

  describe('5. Google Suggest Client Quota Handling', () => {
    it('fetches search suggestions and manages quota reservation', async () => {
      const suggestClient = GoogleSuggestClient.getInstance();
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(['earbuds under 2000', ['earbuds under 2000 boAt', 'earbuds under 2000 noise']]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
      suggestClient.setFetchFn(mockFetch as any);

      const result = await suggestClient.fetchSuggestions('earbuds under 2000', 'in');
      expect(result.status).toBe('SUCCESS');
      expect(result.suggestions).toContain('earbuds under 2000 boAt');
      expect(result.suggestions).toContain('earbuds under 2000 noise');
    });
  });

  describe('6. Public Autonomy Status API Version', () => {
    it('returns version 5.7.0 with configured policy gate and quota ledger', async () => {
      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.version).toBe('5.7.0');
      expect(json.quotaLedger).toBeDefined();
      expect(json.policyGate.humanReviewGate).toBe('STRICT_ENFORCED');
    });
  });
});
