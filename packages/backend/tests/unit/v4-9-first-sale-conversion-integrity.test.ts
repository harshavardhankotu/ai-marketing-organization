import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { classifyTraffic } from '../../src/commission/referral-tracking.js';

describe('V4.9 First Sale Conversion Integrity & Attribution Suite', () => {
  let app: Hono;
  let engine: AutonomousDealDiscoveryEngine;
  let syncMgr: CuelinksSyncManager;

  beforeEach(() => {
    process.env.CUELINKS_API_KEY = 'test_cuelinks_api_key_v49';
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    AutonomousDealDiscoveryEngine.resetInstance();
    engine = AutonomousDealDiscoveryEngine.getInstance();
    syncMgr = CuelinksSyncManager.getInstance();

    app = new Hono();
    app.route('/api/v1', apiRouter);
    app.route('/', apiRouter);
  });

  describe('1. Deal Identity, Deterministic Slug & Cold-Start Persistence (Phase 1)', () => {
    it('generates a deterministic slug from brand, title, and model', () => {
      const slug = AutonomousDealDiscoveryEngine.generateDealSlug(
        'boAt Airdopes 141 ANC True Wireless Earbuds',
        'boAt',
        '141-ANC'
      );
      expect(slug).toBe('boat-airdopes-141-anc-true-wireless-earbuds');
    });

    it('persists a deal with slug, survives cold-start restart, and resolves by slug and canonical ID', async () => {
      const testSlug = `boat-airdopes-141-anc-coldstart-${Date.now()}`;
      const { deal } = await engine.registerDeal({
        title: 'boAt Airdopes 141 ANC',
        brand: 'boAt',
        merchant: 'boAt Official Store',
        category: 'Personal Audio',
        productUrl: 'https://boat-lifestyle.com/products/airdopes-141-anc',
        currentPriceINR: 1399,
        referencePriceINR: 5990,
        slug: testSlug,
        canonicalSlug: testSlug,
        sourceUrl: 'https://boat-lifestyle.com/products/airdopes-141-anc',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        discountVerificationType: 'MERCHANT_CLAIMED',
        availability: 'IN_STOCK'
      });

      expect(deal).toBeDefined();
      expect(deal.slug).toBe(testSlug);
      const canonicalId = deal.id;

      // Simulate application cold-start restart: wipe in-memory instance
      AutonomousDealDiscoveryEngine.resetInstance();
      const freshEngine = AutonomousDealDiscoveryEngine.getInstance();

      // In-memory cache is empty
      expect(freshEngine.getDealById(testSlug)).toBeNull();

      // Cold-start resolution via D1/SQLite fallback
      const resolvedBySlug = await freshEngine.resolveDeal(testSlug);
      expect(resolvedBySlug).not.toBeNull();
      expect(resolvedBySlug?.id).toBe(canonicalId);
      expect(resolvedBySlug?.currentPriceINR).toBe(1399);

      // Resolve by canonical ID
      const resolvedById = await freshEngine.resolveDeal(canonicalId);
      expect(resolvedById).not.toBeNull();
      expect(resolvedById?.slug).toBe(testSlug);
    });

    it('returns HTTP 404 for unknown deals and HTTP 410 for expired offers', async () => {
      // 1. Unknown deal -> 404
      const resUnknown = await app.request('/public/deals/non-existent-deal-slug-99999');
      expect(resUnknown.status).toBe(404);

      // 2. Expired deal -> 410
      const expiredSlug = `expired-deal-${Date.now()}`;
      await engine.registerDeal({
        title: 'Expired boAt Deal',
        brand: 'boAt',
        merchant: 'boAt Store',
        category: 'Electronics',
        productUrl: 'https://boat-lifestyle.com/products/expired',
        currentPriceINR: 999,
        slug: expiredSlug,
        canonicalSlug: expiredSlug,
        expiryDate: '2023-01-01T00:00:00.000Z',
        sourceUrl: 'https://boat-lifestyle.com/products/expired',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND'
      });

      const resExpired = await app.request(`/public/deals/${expiredSlug}`);
      expect(resExpired.status).toBe(410);

      const resExpiredRedirect = await app.request(`/public/deals/${expiredSlug}/redirect`);
      expect(resExpiredRedirect.status).toBe(410);
    });
  });

  describe('2. Visitor-Level Cuelinks Link Conversion & Sub-ID Separation (Phase 2)', () => {
    it('strictly separates full tracking_url from short_url in convertLink response', async () => {
      const mockClient = new CuelinksV3Client({
        apiKey: 'test-key',
        publisherId: '281897',
        fetchFn: async (url, opts) => {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                url: 'https://boat-lifestyle.com/products/airdopes-141-anc',
                tracking_url: 'https://linksredirect.com/?cid=4232&subid=clk_test_01&url=https%3A%2F%2Fboat-lifestyle.com',
                short_url: 'https://clnk.in/DYw4',
                affiliated: true,
                campaign: { id: 4232, name: 'boAt Lifestyle' }
              }
            })
          } as any;
        }
      });

      const res = await mockClient.convertLink({
        url: 'https://boat-lifestyle.com/products/airdopes-141-anc',
        channel_id: 331585,
        subid: 'clk_test_01',
        subid2: 'SECTOR_B_ELECTRONICS',
        subid3: '4232',
        subid4: 'boat-airdopes-141-anc',
        subid5: 'deal_redirect',
        shorten: false
      });

      expect(res.affiliated).toBe(true);
      expect(res.tracking_url).toBe('https://linksredirect.com/?cid=4232&subid=clk_test_01&url=https%3A%2F%2Fboat-lifestyle.com');
      expect(res.short_url).toBe('https://clnk.in/DYw4');
      expect(res.channel_id).toBe(331585);
    });

    it('fails closed when Cuelinks returns affiliated: false or invalid domain', async () => {
      const mockClient = new CuelinksV3Client({
        apiKey: 'test-key',
        publisherId: '281897',
        fetchFn: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              url: 'https://unauthorized-store.com/item',
              tracking_url: 'https://unauthorized-store.com/item',
              affiliated: false
            }
          })
        } as any)
      });

      const res = await mockClient.convertLink({
        url: 'https://unauthorized-store.com/item'
      });

      expect(res.affiliated).toBe(false);
      expect(res.tracking_url).toBe('https://unauthorized-store.com/item');
      expect(res.short_url).toBeUndefined();
    });
  });

  describe('3. Public Redirect Safety & Atomic Attribution (Phase 3)', () => {
    it('classifies browser user-agent as browser_candidate and never confirmed human', () => {
      const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const trafficClass = classifyTraffic(browserUA, '103.21.244.1');
      expect(trafficClass).toBe('browser_candidate');
      expect(trafficClass).not.toBe('human');
    });

    it('classifies bots accurately without attributing clicks', () => {
      expect(classifyTraffic('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBe('known_bot');
      expect(classifyTraffic('curl/7.88.1')).toBe('suspected_bot');
      expect(classifyTraffic('vitest/1.0')).toBe('test');
    });

    it('issues HTTP 302 to provider tracking URL and persists referral and click events atomically', async () => {
      const dealSlug = `boat-redirect-test-${Date.now()}`;
      await engine.registerDeal({
        title: 'boAt Airdopes 161',
        brand: 'boAt',
        merchant: 'boAt Store',
        category: 'Personal Audio',
        productUrl: 'https://boat-lifestyle.com/products/airdopes-161',
        currentPriceINR: 899,
        slug: dealSlug,
        canonicalSlug: dealSlug,
        sourceUrl: 'https://boat-lifestyle.com/products/airdopes-161',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232'
      });

      // Inject mock client with successful conversion
      const client = CuelinksV3Client.getInstance();
      (client as any).fetchFn = async (urlStr: string, opts: any) => {
        if (urlStr.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 331585, name: 'ARO Deals', status: 'approved', is_default: true, url: 'https://ai-marketing-organization.onrender.com' }
              ]
            })
          };
        }
        const body = JSON.parse(opts?.body || '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              url: body.url,
              tracking_url: `https://linksredirect.com/?cid=4232&subid=${body.subid}&url=${encodeURIComponent(body.url)}`,
              short_url: 'https://clnk.in/DYw4',
              affiliated: true,
              campaign: { id: 4232, name: 'boAt' }
            }
          })
        };
      };

      const testDb = getDb();
      testDb.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer,
          destination_url, authorized_tracking_url, active, status
        ) VALUES (
          ?, 'part_cuelinks', 'org_owner_primary', 'boAt Airdopes 161', ?, 'Personal Audio', 'Shoppers',
          'https://boat-lifestyle.com/products/airdopes-161', 'https://linksredirect.com/?cid=4232', 1, 'ACTIVE'
        )
      `).run(`deal_${dealSlug}`, dealSlug);

      const res = await app.request(`/public/deals/${dealSlug}/redirect?utm_source=telegram`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36'
        }
      });

      expect(res.status).toBe(302);
      const location = res.headers.get('location');
      expect(location).toContain('https://linksredirect.com/?cid=4232');
      expect(location).toContain('subid=clk_');

      // Verify that local referral and click records were atomically persisted
      const db = getDb();
      const clickEvent = db.prepare('SELECT * FROM referral_click_events WHERE campaign = ? ORDER BY created_at DESC LIMIT 1').get('4232') as any;
      expect(clickEvent).toBeDefined();
      expect(clickEvent.click_id).toMatch(/^clk_/);
      expect(clickEvent.device_class).toBe('browser_candidate');

      const referral = db.prepare('SELECT * FROM referrals WHERE click_id = ?').get(clickEvent.click_id) as any;
      expect(referral).toBeDefined();
      expect(referral.destination_url).toBe(location);
    });

    it('returns HTTP 503 and suppresses redirect when link conversion is unavailable', async () => {
      const unmonetizedSlug = `unmonetized-deal-${Date.now()}`;
      await engine.registerDeal({
        title: 'Unmonetized Store Deal',
        brand: 'Generic',
        merchant: 'Unmonetized Shop',
        category: 'Lifestyle',
        productUrl: 'https://unmonetized-shop.in/item',
        currentPriceINR: 500,
        slug: unmonetizedSlug,
        sourceUrl: 'https://unmonetized-shop.in/item',
        sourceDomain: 'unmonetized-shop.in',
        sourceType: 'RETAILER_BRAND',
        isMonetizable: false
      });

      const res = await app.request(`/public/deals/${unmonetizedSlug}/redirect`);
      expect(res.status).toBe(503);
    });
  });

  describe('4. Multi-Page Incremental Reconciliation & Sub-ID Matching (Phase 4)', () => {
    it('paginates beyond 50 records, matches Sub-IDs to local clicks, and separates financial buckets', async () => {
      const db = getDb();
      const testClickId = `clk_match_${Date.now()}`;
      const testReferralId = `ref_${testClickId}`;

      // Insert a known referral in the database to match against
      db.prepare(`
        INSERT INTO referrals (id, click_id, destination_url, organization_id, offer_id, partner_id, created_at)
        VALUES (?, ?, 'https://linksredirect.com/test', 'org_owner_primary', 'deal_boat_test', 'part_cuelinks', datetime('now'))
      `).run(testReferralId, testClickId);

      const client = CuelinksV3Client.getInstance();

      // Mock multi-page getTransactions returning 110 transactions total across 2 pages
      (client as any).fetchFn = async (urlStr: string) => {
        const url = new URL(urlStr);
        const page = Number(url.searchParams.get('page') || 1);

        if (page === 1) {
          // Page 1: 100 transactions
          const txs = Array.from({ length: 100 }, (_, i) => ({
            id: `tx_p1_${i + 1}`,
            campaign_id: 4232,
            channel_id: 331585,
            sub_id: i === 0 ? testClickId : `clk_unmatched_${i}`,
            user_commission: 83.94,
            currency: 'INR',
            status: i === 0 ? 'paid' : (i < 20 ? 'validated' : 'pending')
          }));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: txs,
              meta: { total: 110, total_pages: 2, page: 1 }
            })
          };
        } else {
          // Page 2: 10 transactions
          const txs = Array.from({ length: 10 }, (_, i) => ({
            id: `tx_p2_${i + 1}`,
            campaign_id: 4232,
            channel_id: 331585,
            sub_id: `clk_unmatched_p2_${i}`,
            user_commission: 50.00,
            currency: 'INR',
            status: 'invoice_raised'
          }));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: txs,
              meta: { total: 110, total_pages: 2, page: 2 }
            })
          };
        }
      };

      syncMgr = CuelinksSyncManager.getInstance(client);

      const metrics = await syncMgr.reconcileTransactionsIncremental({
        channel_id: 331585,
        campaign_id: 4232,
        maxPages: 5
      });

      // Verify all 110 transactions were ingested across both pages
      expect(metrics.providerAttributedClicks).toBe(110);
      expect(metrics.reportedConversions).toBe(110);

      // Verify matched transaction was updated in commission_records with referral_id
      const matchedComm = db.prepare('SELECT * FROM commission_records WHERE referral_id = ?').get(testReferralId) as any;
      expect(matchedComm).toBeDefined();
      expect(matchedComm.external_status).toBe('paid');
      expect(matchedComm.received_commission_inr).toBe(83.94);

      // Verify Non-Negotiable Rule 8: discrete financial buckets
      expect(metrics.providerPaidCommissionINR).toBe(83.94);
      expect(metrics.invoicedCommissionINR).toBe(500.00); // 10 * 50
      expect(metrics.cashReceivedINR).toBe(0); // Strictly 0 until bank statement proof
      expect(metrics.unmatchedTransactionsCount).toBe(109);
    });
  });

  describe('5. Source Health & Discovery Failure Truth (Phase 5)', () => {
    it('records lastHttpStatus = 500 and failure count when an offer page fails', async () => {
      const client = CuelinksV3Client.getInstance();

      // Mock searchCampaigns succeeding, but getOffers throwing HTTP 500 on page 1
      (client as any).fetchFn = async (urlStr: string) => {
        if (urlStr.includes('/ping')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'success',
              publisher: { id: 281897, email: 'test@example.com' },
              api_key: { scopes: ['read:campaigns', 'read:offers', 'write:links', 'read:transactions', 'read:reports'] }
            })
          };
        }
        if (urlStr.includes('/campaigns')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 4232, name: 'boAt Lifestyle', status: 'active', access_status: 'open' }],
              meta: { total: 1, total_pages: 1, page: 1 }
            })
          };
        }
        if (urlStr.includes('/offers')) {
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error'
          };
        }
        if (urlStr.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 331585, name: 'ARO Deals', status: 'approved', is_default: true, url: 'https://ai-marketing-organization.onrender.com' }
              ]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      };

      await engine.executeAutonomousCycle('deal_cycle_failure_test');

      const src = engine.getSources().find(s => s.domain === 'cuelinks.com');
      expect(src).toBeDefined();
      expect(src?.lastHttpStatus).toBe(500);
      expect(src?.failureCount).toBeGreaterThan(0);
      expect(src?.lastError).toContain('Offer page');
    });
  });

  describe('6. Positive End-to-End Commercial Flow (Phase 9 & 11 Acceptance)', () => {
    it('executes positive commercial journey from deal -> redirect -> click -> transaction match', async () => {
      const db = getDb();
      const pilotSlug = `boat-e2e-pilot-${Date.now()}`;

      // 1. Registered deal
      const { deal } = await engine.registerDeal({
        title: 'boAt Airdopes 161',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Personal Audio',
        productUrl: 'https://boat-lifestyle.com/products/airdopes-161',
        currentPriceINR: 899,
        referencePriceINR: 2490,
        slug: pilotSlug,
        canonicalSlug: pilotSlug,
        sourceUrl: 'https://boat-lifestyle.com/products/airdopes-161',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232'
      });

      // 2. Mock Cuelinks link conversion
      let capturedSubId: string | undefined = undefined;
      const client = CuelinksV3Client.getInstance();
      (client as any).fetchFn = async (urlStr: string, opts: any) => {
        if (urlStr.includes('/links/convert')) {
          const body = JSON.parse(opts?.body || '{}');
          capturedSubId = body.subid;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                url: body.url,
                tracking_url: `https://linksredirect.com/?cid=4232&subid=${body.subid}&subid2=${body.subid2}&subid3=4232&url=${encodeURIComponent(body.url)}`,
                short_url: 'https://clnk.in/DYw4',
                affiliated: true,
                campaign: { id: 4232, name: 'boAt Lifestyle' }
              }
            })
          };
        }
        if (urlStr.includes('/transactions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: 'tx_e2e_boat_001',
                  campaign_id: 4232,
                  channel_id: 331585,
                  sub_id: capturedSubId,
                  sub_id_2: 'SECTOR_B_ELECTRONICS',
                  sub_id_3: '4232',
                  sub_id_4: pilotSlug,
                  sub_id_5: 'deal_redirect',
                  order_amount: 1399,
                  user_commission: 83.94,
                  currency: 'INR',
                  status: 'validated'
                }
              ],
              meta: { total: 1, total_pages: 1, page: 1 }
            })
          };
        }
        if (urlStr.includes('/channels')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: 331585, name: 'ARO Deals', status: 'approved', is_default: true, url: 'https://ai-marketing-organization.onrender.com' }
              ]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      };

      db.prepare(`
        INSERT OR REPLACE INTO partner_offers (
          id, partner_id, organization_id, title, offer_slug, category, target_customer,
          destination_url, authorized_tracking_url, active, status
        ) VALUES (
          ?, 'part_cuelinks', 'org_owner_primary', 'boAt Airdopes 161', ?, 'Personal Audio', 'Shoppers',
          'https://boat-lifestyle.com/products/airdopes-161', 'https://linksredirect.com/?cid=4232', 1, 'ACTIVE'
        )
      `).run(`deal_${pilotSlug}`, pilotSlug);

      // 3. Visitor hits public redirect
      const redirectRes = await app.request(`/public/deals/${pilotSlug}/redirect?utm_source=telegram`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36'
        }
      });
      expect(redirectRes.status).toBe(302);
      expect(capturedSubId).toBeDefined();

      // 4. Verify click record persisted
      const clickEvent = db.prepare('SELECT * FROM referral_click_events WHERE click_id = ?').get(capturedSubId) as any;
      expect(clickEvent).toBeDefined();
      expect(clickEvent.device_class).toBe('browser_candidate');

      // 5. Cuelinks transaction report arrives and sync runs
      syncMgr = CuelinksSyncManager.getInstance(client);
      const syncResult = await syncMgr.reconcileTransactionsIncremental({
        channel_id: 331585,
        campaign_id: 4232
      });

      expect(syncResult.validatedCommissionINR).toBe(83.94);
      expect(syncResult.unmatchedTransactionsCount).toBe(0);

      // 6. Verify matched commission record in database
      const commRecord = db.prepare('SELECT * FROM commission_records WHERE external_transaction_id = ?').get('tx_e2e_boat_001') as any;
      expect(commRecord).toBeDefined();
      expect(commRecord.referral_id).toBe(clickEvent.referral_id);
      expect(commRecord.verified_commission_inr).toBe(83.94);
      expect(commRecord.status).toBe('COMMISSION_APPROVED');
    });
  });
});
