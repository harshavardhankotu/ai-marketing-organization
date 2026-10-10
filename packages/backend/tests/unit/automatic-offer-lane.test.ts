import { describe, it, expect, beforeEach } from 'vitest';
import { AutomaticOfferLane, GeneratedGuide, SpecLineRecord } from '../../src/commission/automatic-offer-lane.js';
import { getDb } from '../../src/db/client.js';

describe('Step 3: Automatic Offer Lane Verification Suite', () => {
  const lane = AutomaticOfferLane.getInstance();

  beforeEach(() => {
    const db = getDb();
    // Ensure domain_policy table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS domain_policy (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL UNIQUE,
        policy TEXT NOT NULL DEFAULT 'REJECT',
        reject_class TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS brand_spec_lines (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        spec_line TEXT NOT NULL,
        source_url TEXT NOT NULL,
        retrieved_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS demand_signals (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        category TEXT NOT NULL,
        location TEXT,
        intent_type TEXT NOT NULL DEFAULT 'SEARCH_QUERY',
        raw_query TEXT NOT NULL,
        evidence_snippet TEXT NOT NULL,
        source_url TEXT NOT NULL,
        urgency REAL NOT NULL DEFAULT 0.5,
        estimated_monthly_volume INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'DISCOVERED',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        signal_type TEXT NOT NULL DEFAULT 'BUYER_QUESTION'
      );
    `);
  });

  it('rejects a marketplace domain as a brand source (Step 3b, 3i)', () => {
    const marketplaceUrls = [
      'https://www.amazon.in/dp/B08L5WH529',
      'https://amazon.com/product/123',
      'https://www.flipkart.com/item/123',
      'https://snapdeal.com/product/456',
      'https://specifications.pdf'
    ];

    for (const url of marketplaceUrls) {
      const res = lane.checkDomainPolicy(url);
      expect(res.allowed).toBe(false);
      expect(res.rejectClass).toBeDefined();
    }
  });

  it('accepts legitimate brand domain as a brand source (Step 3b)', () => {
    const brandUrls = [
      'https://phomemo.com/products/m110-label-printer',
      'https://brother-usa.com/products/ptd210'
    ];

    for (const url of brandUrls) {
      const res = lane.checkDomainPolicy(url);
      expect(res.allowed).toBe(true);
    }
  });

  it('skips a product when no spec page is found (Step 3c, 3i)', async () => {
    // Attempting to generate a guide with 0 spec lines throws NO_SPEC_LINES error
    expect(() => {
      lane.generateGuide(
        {
          category: 'label printer',
          brand: 'UnknownBrand',
          model: 'GhostModel',
          targetQuery: 'UnknownBrand GhostModel'
        },
        [] // empty spec lines
      );
    }).toThrow(/NO_SPEC_LINES/);
  });

  it('fails the lint when a guide contains an unsourced product fact (Step 3f, 3i)', () => {
    const verifiedSpecs: SpecLineRecord[] = [
      {
        id: 'spec_1',
        productId: 'prod_test',
        brand: 'Phomemo',
        model: 'M110',
        specLine: 'Print speed: 150mm/s direct thermal printing',
        sourceUrl: 'https://phomemo.com/m110',
        retrievedAt: new Date().toISOString()
      }
    ];

    const guide: GeneratedGuide = {
      productId: 'prod_test',
      title: 'Guide: Phomemo M110',
      slug: 'guide-phomemo-m110',
      disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
      amazonSearchUrl: 'https://www.amazon.in/s?k=Phomemo+M110&tag=marketing98-21',
      disclaimer: 'Notice: This link opens Amazon.in search results.',
      contentMarkdown: 'As an Amazon Associate I earn from qualifying purchases.\n\n# Guide\n- Print speed: 150mm/s direct thermal printing\n- Fabricated battery capacity: 50,000 mAh',
      specLines: [
        'Print speed: 150mm/s direct thermal printing',
        'Fabricated battery capacity: 50,000 mAh' // NOT in verifiedSpecs!
      ],
      createdAt: new Date().toISOString()
    };

    const lintRes = lane.lintGuide(guide, verifiedSpecs);
    expect(lintRes.valid).toBe(false);
    expect(lintRes.errors.some(e => e.includes('Unsourced product fact'))).toBe(true);
  });

  it('fails the lint when review language, superlatives, or prices are present (Step 3f)', () => {
    const verifiedSpecs: SpecLineRecord[] = [
      {
        id: 'spec_1',
        productId: 'prod_test',
        brand: 'Phomemo',
        model: 'M110',
        specLine: 'Print speed: 150mm/s',
        sourceUrl: 'https://phomemo.com/m110',
        retrievedAt: new Date().toISOString()
      }
    ];

    const guideWithSuperlative: GeneratedGuide = {
      productId: 'prod_test',
      title: 'Guide: Phomemo M110',
      slug: 'guide-phomemo-m110',
      disclosure: 'As an Amazon Associate I earn from qualifying purchases.',
      amazonSearchUrl: 'https://www.amazon.in/s?k=Phomemo+M110&tag=marketing98-21',
      disclaimer: 'Notice: This link opens Amazon.in search results.',
      contentMarkdown: 'As an Amazon Associate I earn from qualifying purchases.\n\n# The Best Printer Ever\nIn our testing, it costs ₹2,999.',
      specLines: ['Print speed: 150mm/s'],
      createdAt: new Date().toISOString()
    };

    const lintRes = lane.lintGuide(guideWithSuperlative, verifiedSpecs);
    expect(lintRes.valid).toBe(false);
    expect(lintRes.errors.some(e => e.includes('superlative'))).toBe(true);
    expect(lintRes.errors.some(e => e.includes('review language'))).toBe(true);
    expect(lintRes.errors.some(e => e.includes('Price claims'))).toBe(true);
  });

  it('proves the code never calls fetch on an amazon.* host (Step 3i)', async () => {
    // The buildAmazonSearchUrl creates an outbound link string without performing fetch
    const url = lane.buildAmazonSearchUrl('Phomemo', 'M110');
    expect(url).toBe('https://www.amazon.in/s?k=Phomemo%20M110&tag=marketing98-21');

    // Attempting to fetch an amazon.* host via fetchAndStoreBrandSpecs throws AMAZON_FETCH_FORBIDDEN
    await expect(
      lane.fetchAndStoreBrandSpecs('prod_test', 'Amazon', 'Echo', 'https://www.amazon.in/dp/B08L5WH529')
    ).rejects.toThrow(/DOMAIN_REJECTED|AMAZON_FETCH_FORBIDDEN/);
  });
});
