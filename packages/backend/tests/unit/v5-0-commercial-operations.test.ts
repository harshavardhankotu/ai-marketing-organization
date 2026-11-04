import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { apiRouter } from '../../src/routes/api.js';

describe('Stage 4 — Affiliate Redirect & Atomic Parameterized Attribution Tests', () => {
  let app: Hono;
  let cuelinksClient: CuelinksV3Client;
  let syncMgr: CuelinksSyncManager;
  let dealEngine: AutonomousDealDiscoveryEngine;
  let d1Repo: D1RevenueRepository;

  const sampleDeal = {
    id: 'deal_test_airdopes_141',
    title: 'boAt Airdopes 141 Bluetooth Truly Wireless Earbuds',
    brand: 'boAt',
    merchant: 'boAt Lifestyle',
    category: 'Audio',
    productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
    currentPriceINR: 999,
    referencePriceINR: 4490,
    claimedDiscountPercent: 78,
    availability: 'IN_STOCK',
    isMonetizable: true,
    affiliateNetwork: 'CUELINKS',
    affiliateCampaignId: '4232',
    canonicalSlug: 'boat-airdopes-141-anc',
    trackingUrl: 'https://linksredirect.com/?cid=331585&subid=fake_static'
  };

  beforeEach(() => {
    process.env.CUELINKS_API_KEY = 'test_key_redirect';
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    cuelinksClient = CuelinksV3Client.getInstance();
    syncMgr = CuelinksSyncManager.getInstance(cuelinksClient);
    dealEngine = AutonomousDealDiscoveryEngine.getInstance();
    d1Repo = D1RevenueRepository.getInstance();

    // Mock resolveDeal on dealEngine
    vi.spyOn(dealEngine, 'resolveDeal').mockResolvedValue(sampleDeal as any);

    app = new Hono();
    app.route('/api/v1', apiRouter);
  });

  it('fails closed with HTTP 503 if publisher channel is unverified/unapproved', async () => {
    vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
      channel: null,
      approved: false
    });

    const res = await app.request('/api/v1/public/deals/deal_test_airdopes_141/redirect');
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toMatch(/channel.*not.*verified|suppressed/i);
  });

  it('fails closed with HTTP 503 if dynamic conversion returns affiliated: false or fails', async () => {
    vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
      channel: { id: 12345, name: 'Active Channel', status: 'approved' },
      approved: true
    });
    vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
      url: sampleDeal.productUrl,
      affiliated: false,
      channel_id: 12345
    });

    const res = await app.request('/api/v1/public/deals/deal_test_airdopes_141/redirect');
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toMatch(/monetization.*unavailable|conversion failed|suppressed/i);
  });

  it('fails closed with HTTP 503 if tracking URL is not on allowlisted domain', async () => {
    vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
      channel: { id: 12345, name: 'Active Channel', status: 'approved' },
      approved: true
    });
    vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
      url: sampleDeal.productUrl,
      affiliated: true,
      channel_id: 12345,
      tracking_url: 'https://attacker.evil.com/phish'
    });

    const res = await app.request('/api/v1/public/deals/deal_test_airdopes_141/redirect');
    expect(res.status).toBe(503);
  });

  it('fails closed with HTTP 503 if attribution persistence fails', async () => {
    vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
      channel: { id: 12345, name: 'Active Channel', status: 'approved' },
      approved: true
    });
    vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
      url: sampleDeal.productUrl,
      affiliated: true,
      channel_id: 12345,
      tracking_url: 'https://linksredirect.com/?cid=12345&subid=clk_test'
    });
    vi.spyOn(d1Repo, 'executeBatch').mockRejectedValue(new Error('D1 Persistence Down'));

    const res = await app.request('/api/v1/public/deals/deal_test_airdopes_141/redirect');
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toMatch(/persistence failed|redirect suppressed/i);
  });

  it('successfully redirects with HTTP 302 and valid tracking URL when conversion and attribution succeed', async () => {
    vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
      channel: { id: 12345, name: 'Active Channel', status: 'approved' },
      approved: true
    });
    vi.spyOn(cuelinksClient, 'convertLink').mockResolvedValue({
      url: sampleDeal.productUrl,
      affiliated: true,
      channel_id: 12345,
      tracking_url: 'https://linksredirect.com/?cid=12345&subid=clk_test_valid',
      campaign: { id: 4232, name: 'boAt Lifestyle' }
    });
    vi.spyOn(d1Repo, 'executeBatch').mockResolvedValue({ rowsAffected: 2, source: 'PERSISTENT_SQLITE' });

    const { getDb } = await import('../../src/db/client.js');
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category, target_customer,
        destination_url, authorized_tracking_url, active, status
      ) VALUES (
        'deal_test_airdopes_141', 'part_cuelinks', 'org_owner_primary', 'boAt Airdopes 141', 'boat-airdopes-141-anc', 'Audio', 'Shoppers',
        'https://www.boat-lifestyle.com/products/airdopes-141', 'https://linksredirect.com/?cid=12345', 1, 'ACTIVE'
      )
    `).run();

    const res = await app.request('/api/v1/public/deals/deal_test_airdopes_141/redirect?placement=homepage_hero');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://linksredirect.com/?cid=12345&subid=clk_test_valid');
  });
});
