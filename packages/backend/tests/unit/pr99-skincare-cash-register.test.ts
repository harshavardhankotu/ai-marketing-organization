import { describe, it, expect } from 'vitest';
import { app } from '../../src/index.js';
import { DURABLE_REQUIRED_TABLES } from '../../src/db/d1-client.js';
import { normalizeCuelinksCategory } from '../../src/commission/cuelinks-sync-manager.js';
import { createHighIntentStarterDeals, createVerifiedLiveSkincareSerums } from '../../src/commission/starter-deals.js';
import { StaticSiteGenerator, generateComparisonPairs, generateBuyerIntentHubs, passesEditorialQualityGate } from '../../src/commission/static-site-generator.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { DEFAULT_INTEGRATIONS } from '../../../frontend/src/services/seed-defaults.js';

describe('PR #99 — Skincare Affiliate Cash Register & Hardening', () => {
  it('1. normalizeCuelinksCategory prevents [object Object] across strings, nested objects, and arrays', () => {
    expect(normalizeCuelinksCategory('[object Object]', [{ name: 'Health & Beauty' }], 'General')).toBe('Health & Beauty');
    expect(normalizeCuelinksCategory({ id: 7, name: 'Personal Care' }, [], 'General')).toBe('Personal Care');
    expect(normalizeCuelinksCategory(undefined, ['Electronics', { name: 'Audio' }], 'General')).toBe('Electronics');
    expect(normalizeCuelinksCategory('[object Object]', [], 'General')).toBe('General');
  });

  it('2. Live verified skincare catalog exposes 6 serums with cost per ml and Cuelinks campaign IDs', () => {
    const serums = createVerifiedLiveSkincareSerums('2026-11-25T15:00:00.000Z');
    expect(serums.length).toBe(6);

    for (const s of serums) {
      expect(s.isSeedFallback).toBe(false);
      expect(passesEditorialQualityGate(s)).toBe(true);
      expect(s.unitVolumeMl).toBeGreaterThan(0);
      expect(s.pricePerMlINR).toBeGreaterThan(0);
      expect(s.imageUrl).toMatch(/^https:\/\//);
    }

    const kama = serums.find(s => s.brand === 'Kama Ayurveda');
    expect(kama?.productUrl).toContain('kamaayurveda.in');
    expect(kama?.affiliateCampaignId).toBe('4161');

    const dotKey = serums.find(s => s.brand === 'Dot & Key');
    expect(dotKey?.socialMediaPublishersAllowed).toBe(false);
    expect(dotKey?.affiliateCampaignId).toBe('4879');
  });

  it('3. Same-subcategory /vs/ pairing blocks serum vs non-serum mismatches and renders unit cost & clean UX', () => {
    const serums = createVerifiedLiveSkincareSerums('2026-11-25T15:00:00.000Z');
    const mixed = [
      ...serums,
      {
        ...serums[0],
        id: 'deal_unrelated_beard_wash',
        slug: 'unrelated-beard-wash',
        canonicalSlug: 'unrelated-beard-wash',
        title: 'Ustraa Beard Wash (100 ml)',
        subCategory: 'grooming'
      }
    ];

    const pairs = generateComparisonPairs(mixed, 10);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (const p of pairs) {
      expect(p.dealA.id).not.toBe('deal_unrelated_beard_wash');
      expect(p.dealB.id).not.toBe('deal_unrelated_beard_wash');
    }

    const ssg = StaticSiteGenerator.getInstance();
    const cfg = {
      siteName: 'AI Marketing Organization',
      authorName: 'Editorial Desk',
      contactEmail: 'editorial@ai-marketing-organization.onrender.com',
      siteUrl: 'https://ai-marketing-organization.onrender.com'
    };

    const dealsHtml = ssg.renderDealsHtml(serums, cfg);
    expect(dealsHtml).not.toContain('SEED_SNAPSHOT');
    expect(dealsHtml).not.toContain('Link Monetizer');
    expect(dealsHtml).not.toContain('customer-desk-widget');
    expect(dealsHtml).toContain('#Affiliate');
    expect(dealsHtml).toContain('/ml');
    expect(dealsHtml).toContain('<meta name="robots" content="index, follow">');

    const compHtml = ssg.renderComparisonHtml(pairs[0], cfg, pairs);
    expect(compHtml).toContain('Cost/ml');
    expect(compHtml).toContain('#Affiliate');
    expect(compHtml).not.toContain('SEED_SNAPSHOT');

    const hubs = generateBuyerIntentHubs(serums, cfg.siteUrl, 10);
    const niaHub = hubs.find(h => h.intentSlug === 'niacinamide-serums-india');
    expect(niaHub).toBeDefined();
    expect(niaHub!.deals.length).toBeGreaterThanOrEqual(2);
  });

  it('4. resolveDeal resolves skincare slugs cleanly without LIKE complexity failure', async () => {
    const engine = AutonomousDealDiscoveryEngine.getInstance();
    const resolved = await engine.resolveDeal('world-of-asaya-10-niacinamide-1-alpha-arbutin-serum-30ml');
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe('deal_asaya_10_niacinamide_serum_30ml');
    expect(resolved?.currentPriceINR).toBe(439);
  });

  it('5. Security CSP allows YouTube embeds and D1 durability includes referral click tables', async () => {
    expect(DURABLE_REQUIRED_TABLES).toContain('referrals');
    expect(DURABLE_REQUIRED_TABLES).toContain('referral_click_events');

    const res = await app.request('/');
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain('https://www.youtube.com');
    expect(csp).toContain('https://www.youtube-nocookie.com');
    expect(csp).toContain('https://checkout.razorpay.com');

    const gAds = DEFAULT_INTEGRATIONS.find(i => i.provider === 'GOOGLE_ADS');
    const gSearch = DEFAULT_INTEGRATIONS.find(i => i.provider === 'GOOGLE_SEARCH_API');
    expect(gAds?.status).toBe('UNCONFIGURED');
    expect(gSearch?.status).toBe('UNCONFIGURED');
  });
});
