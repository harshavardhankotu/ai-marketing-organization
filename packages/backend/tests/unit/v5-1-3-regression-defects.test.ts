import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CommercialOpportunitySelector } from '../../src/commission/commercial-opportunity-selector.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { getDb } from '../../src/db/client.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';

describe('V5.1.3 — Regression Defects & Commercial Truth Suite', () => {
  let app: Hono;
  let d1Repo: D1RevenueRepository;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    d1Repo = D1RevenueRepository.getInstance();
    vi.spyOn(DurableRateLimiter.getInstance(), 'checkRateLimit').mockResolvedValue({
      allowed: true,
      count: 1,
      limit: 100,
      windowSeconds: 600,
      retryAfterSeconds: 0
    });
    app = new Hono();
    // Mount apiRouter under /api/v1
    app.route('/api/v1', apiRouter);
    // Mimic the top-level forwarding from packages/backend/src/index.ts for /owner/*
    app.all('/owner/*', async (c) => {
      const targetPath = '/api/v1' + c.req.path;
      const newReq = new Request(new URL(targetPath, c.req.url).toString(), {
        method: c.req.method,
        headers: c.req.raw.headers,
        body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.raw.clone().blob()
      });
      return app.fetch(newReq);
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Group 1: Priority Zero (Owner Route Authentication Lockdown & Safe Login HTML)
  // --------------------------------------------------------------------------
  describe('Priority Zero: Owner Route Lockdown & Zero-PII Login Protection', () => {
    const ownerEndpoints = [
      '/owner/today',
      '/api/v1/owner/today',
      '/owner/deals',
      '/owner/automation',
      '/owner/proposal'
    ];

    for (const ep of ownerEndpoints) {
      it(`blocks unauthenticated anonymous request to ${ep} with HTTP 401 and zero PII`, async () => {
        const res = await app.request(ep, {
          method: 'GET',
          headers: {
            'Accept': ep.startsWith('/api/') ? 'application/json' : 'text/html'
          }
        });

        expect(res.status).toBe(401);
        const text = await res.text();
        // Verify zero PII leaks
        expect(text).not.toContain('INR');
        expect(text).not.toContain('₹');
        expect(text).not.toContain('prospect_');
        expect(text).not.toContain('draft');
        expect(text).not.toContain('opportunity');
        expect(text).not.toContain('phone');

        if (ep.startsWith('/api/')) {
          const json = JSON.parse(text);
          expect(json.success).toBe(false);
          expect(json.error).toMatch(/unauthorized|authentication/i);
        } else {
          // Browser HTML receives the safe login screen
          expect(text).toContain('Owner Authentication Required');
          expect(text).toContain('name="apiKey"');
        }
      });
    }

    it('permits authenticated owner request with valid credentials', async () => {
      const res = await app.request('/owner/today', {
        method: 'GET',
        headers: {
          'x-user-id': 'usr_owner_primary',
          'Accept': 'text/html'
        }
      });

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Daily Owner Digest');
    });
  });

  // --------------------------------------------------------------------------
  // Group 2: Priority One (All 10 Variant Stock Proof Tests)
  // --------------------------------------------------------------------------
  describe('Priority One: 10 Variant Stock Proof Scenarios', () => {
    const selector = CommercialOpportunitySelector.getInstance();
    const productBase = 'https://www.boat-lifestyle.com/products/airdopes-141';

    // 1. Requested variant in stock
    it('1. Requested variant in stock -> status IN_STOCK', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: true, price: 99900, compare_at_price: 199900, sku: 'SKU111' },
              { id: '222', available: false, price: 99900, compare_at_price: 199900, sku: 'SKU222' }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>In Stock</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(`${productBase}?variant=111`, mockFetch as any);
      expect(res.status).toBe('IN_STOCK');
      expect(res.available).toBe(true);
      expect(res.variantId).toBe('111');
      expect(res.priceINR).toBe(999);
      expect(res.referencePriceINR).toBe(1999);
    });

    // 2. Requested variant out of stock
    it('2. Requested variant out of stock -> DEAD_OR_OUT_OF_STOCK', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: true, price: 99900, compare_at_price: 199900 },
              { id: '222', available: false, price: 99900, compare_at_price: 199900 }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>OK</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(`${productBase}?variant=222`, mockFetch as any);
      expect(res.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(res.available).toBe(false);
      expect(res.error).toContain('is sold out or unavailable');
    });

    // 3. Requested variant ID missing while another is in stock (no fallback allowed)
    it('3. Requested variant ID missing while another is in stock -> rejects fallback', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: true, price: 99900, compare_at_price: 199900 }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>OK</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(`${productBase}?variant=999`, mockFetch as any);
      expect(res.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(res.available).toBe(false);
      expect(res.error).toContain('fallback rejected');
    });

    // 4. All variants out of stock (no variant specified)
    it('4. All variants out of stock -> DEAD_OR_OUT_OF_STOCK', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: false, price: 99900 },
              { id: '222', available: false, price: 99900 }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>OK</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(productBase, mockFetch as any);
      expect(res.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(res.available).toBe(false);
      expect(res.error).toContain('All variants sold out');
    });

    // 5. Product available: true but all variants false
    it('5. Product available: true but variants available: false -> DEAD_OR_OUT_OF_STOCK', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            available: true,
            variants: [
              { id: '111', available: false, price: 99900 }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>OK</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(productBase, mockFetch as any);
      expect(res.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(res.available).toBe(false);
    });

    // 6. Zero or NaN price
    it('6. Zero or non-positive price -> rejects with DEAD_OR_OUT_OF_STOCK', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: true, price: 0 }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>OK</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(productBase, mockFetch as any);
      expect(res.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(res.available).toBe(false);
      expect(res.error).toContain('Invalid or non-positive price');
    });

    // 7. HTML restocking badge present
    it('7. HTML restocking badge present -> DEAD_OR_OUT_OF_STOCK', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: true, price: 99900, compare_at_price: 199900 }
            ]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body><button class="restocking-cta">Restocking soon!</button></body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(productBase, mockFetch as any);
      expect(res.status).toBe('DEAD_OR_OUT_OF_STOCK');
      expect(res.available).toBe(false);
      expect(res.error).toContain('Restocking soon');
    });

    // 8. Secondary HTML check network error/timeout -> UNVERIFIED
    it('8. Secondary HTML check network error -> UNVERIFIED (fail safe)', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response(JSON.stringify({
            title: 'boAt Airdopes 141',
            variants: [
              { id: '111', available: true, price: 99900, compare_at_price: 199900 }
            ]
          }), { status: 200 }));
        }
        return Promise.reject(new Error('ETIMEDOUT'));
      });

      const res = await selector.probeMerchantProduct(productBase, mockFetch as any);
      expect(res.status).toBe('UNVERIFIED');
      expect(res.available).toBe(false);
      expect(res.error).toContain('recheck required');
    });

    // 9. Malformed JSON from merchant -> UNVERIFIED
    it('9. Malformed JSON from merchant -> UNVERIFIED', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('.js')) {
          return Promise.resolve(new Response('INVALID_JSON_BODY', { status: 200 }));
        }
        return Promise.resolve(new Response('<html><body>OK</body></html>', { status: 200 }));
      });

      const res = await selector.probeMerchantProduct(productBase, mockFetch as any);
      expect(res.status).toBe('UNVERIFIED');
      expect(res.available).toBe(false);
      expect(res.error).toContain('Malformed JSON');
    });

    // 10. Public deal listing excludes unverified/restocking deals
    it('10. Public deal query strictly filters out UNVERIFIED and out of stock deals', () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      engine.injectDealForTesting({
        id: 'deal_in_stock_proof',
        slug: 'deal-in-stock-proof',
        canonicalSlug: 'deal-in-stock-proof',
        title: 'In Stock Earbuds Proof',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/earbuds-proof',
        currentPriceINR: 999,
        currency: 'INR',
        referencePriceINR: 1999,
        claimedDiscountPercent: 50,
        verifiedDiscountPercent: 50,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 86400000).toISOString(),
        lastCheckedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        sourceUrl: 'https://www.boat-lifestyle.com/products/earbuds-proof',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'VERIFIED',
        confidenceScore: 90,
        buyerValueScore: 85,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        isMonetizable: true
      });

      engine.injectDealForTesting({
        id: 'deal_unverified_proof',
        slug: 'deal-unverified-proof',
        canonicalSlug: 'deal-unverified-proof',
        title: 'Unverified Earbuds Proof',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/unverified-proof',
        currentPriceINR: 999,
        currency: 'INR',
        referencePriceINR: 1999,
        claimedDiscountPercent: 50,
        verifiedDiscountPercent: 50,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        availability: 'UNVERIFIED' as any,
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 86400000).toISOString(),
        lastCheckedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        sourceUrl: 'https://www.boat-lifestyle.com/products/unverified-proof',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'RECHECK_REQUIRED' as any,
        confidenceScore: 40,
        buyerValueScore: 40,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        isMonetizable: true
      });

      const result = engine.queryPublicDeals();
      const inStockFound = result.deals.some(d => d.id === 'deal_in_stock_proof');
      const unverifiedFound = result.deals.some(d => d.id === 'deal_unverified_proof');
      expect(inStockFound).toBe(true);
      expect(unverifiedFound).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Group 3: Priority Two (Redirect Invariants)
  // --------------------------------------------------------------------------
  describe('Priority Two: Redirect Invariants & Fail-Closed Guards', () => {
    it('returns HTTP 503 if Cuelinks approved channel is null or unapproved', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      vi.spyOn(engine, 'resolveDeal').mockResolvedValue({
        id: 'deal_redirect_test',
        slug: 'deal-redirect-test',
        canonicalSlug: 'deal-redirect-test',
        title: 'Redirect Test Deal',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Consumer Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/test',
        currentPriceINR: 999,
        currency: 'INR',
        referencePriceINR: 1999,
        claimedDiscountPercent: 50,
        verifiedDiscountPercent: 50,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 86400000).toISOString(),
        lastCheckedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        sourceUrl: 'https://www.boat-lifestyle.com/products/test',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'VERIFIED',
        confidenceScore: 90,
        buyerValueScore: 85,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        isMonetizable: true
      });

      const syncMgr = CuelinksSyncManager.getInstance();
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        approved: false,
        channel: null
      });

      const res = await app.request('/api/v1/public/deals/deal_redirect_test/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('Affiliate monetization path temporarily unavailable');
    });

    it('returns HTTP 503 if Cuelinks returns null campaign or campaign mismatch', async () => {
      const engine = AutonomousDealDiscoveryEngine.getInstance();
      vi.spyOn(engine, 'resolveDeal').mockResolvedValue({
        id: 'deal_mismatch_test',
        slug: 'deal-mismatch-test',
        canonicalSlug: 'deal-mismatch-test',
        title: 'Mismatch Test Deal',
        brand: 'boAt',
        merchant: 'boAt',
        category: 'Consumer Electronics',
        productUrl: 'https://www.boat-lifestyle.com/products/test',
        currentPriceINR: 999,
        currency: 'INR',
        referencePriceINR: 1999,
        claimedDiscountPercent: 50,
        verifiedDiscountPercent: 50,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        offerStart: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 86400000).toISOString(),
        lastCheckedAt: new Date().toISOString(),
        observedAt: new Date().toISOString(),
        sourceUrl: 'https://www.boat-lifestyle.com/products/test',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'VERIFIED',
        confidenceScore: 90,
        buyerValueScore: 85,
        affiliateNetwork: 'CUELINKS',
        affiliateCampaignId: '4232',
        isMonetizable: true
      });

      const syncMgr = CuelinksSyncManager.getInstance();
      vi.spyOn(syncMgr, 'getApprovedChannel').mockResolvedValue({
        approved: true,
        channel: { id: 331585, name: 'AI Marketing' } as any
      });

      const client = CuelinksV3Client.getInstance();
      vi.spyOn(client, 'convertLink').mockResolvedValue({
        affiliated: true,
        tracking_url: 'https://linksredirect.com/?cid=123&url=https%3A%2F%2Fwww.boat-lifestyle.com',
        campaign: { id: 9999, name: 'Different Merchant' } // Mismatch
      } as any);

      const res = await app.request('/api/v1/public/deals/deal_mismatch_test/redirect');
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('campaign ID mismatch');
    });
  });

  // --------------------------------------------------------------------------
  // Group 4: Priority Three (B2B Prospect Truth & Quarantine Guard)
  // --------------------------------------------------------------------------
  describe('Priority Three: Prospect Quarantine & Digest Truth', () => {
    it('excludes ENTERPRISE_CHAIN_DEFERRED, QUARANTINED, and REJECTED from pending outreach drafts', async () => {
      const digestService = OwnerDigestService.getInstance();
      const db = getDb();

      // Clean test table state
      db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'test_prospect_p3_%'`).run();
      db.prepare(`DELETE FROM direct_outreach_log WHERE id LIKE 'test_draft_p3_%'`).run();

      const insertProspect = db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_owner_name, phone, prospect_phone,
          city, prospect_city, vertical, prospect_vertical, status, stage, fit_score, is_test, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Hyderabad', 'Hyderabad', 'dental', 'dental', ?, ?, 0.9, 0, datetime('now'), datetime('now'))
      `);

      const bizRow = db.prepare(`SELECT id FROM businesses LIMIT 1`).get() as any;
      const bizId = bizRow ? bizRow.id : 'biz_test';

      const insertDraft = db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel, message_draft,
          compliance_checked, human_approved, dispatched, response_status, created_at
        ) VALUES (?, ?, 'dental', ?, 'WHATSAPP', 'Hello doctor', 1, 0, 0, ?, datetime('now'))
      `);

      // 1 valid candidate
      insertProspect.run('test_prospect_p3_valid', 'Valid Clinic', 'Valid Clinic', 'Dr. Valid', '9999900001', '9999900001', 'PENDING_OUTREACH', 'RESEARCH');
      insertDraft.run('test_draft_p3_valid', bizId, 'Valid Clinic', 'PENDING');

      // 3 quarantined candidates
      insertProspect.run('test_prospect_p3_partha', 'Partha Dental', 'Partha Dental', 'Dr. Partha', '9999900002', '9999900002', 'ENTERPRISE_CHAIN_DEFERRED', 'RESEARCH');
      insertDraft.run('test_draft_p3_partha', bizId, 'Partha Dental', 'ENTERPRISE_CHAIN_DEFERRED');

      insertProspect.run('test_prospect_p3_roots', 'Roots Dental', 'Roots Dental', 'Dr. Roots', '9999900003', '9999900003', 'QUARANTINED', 'RESEARCH');
      insertDraft.run('test_draft_p3_roots', bizId, 'Roots Dental', 'QUARANTINED');

      insertProspect.run('test_prospect_p3_fms', 'FMS Dental', 'FMS Dental', 'Dr. FMS', '9999900004', '9999900004', 'REJECTED', 'RESEARCH');
      insertDraft.run('test_draft_p3_fms', bizId, 'FMS Dental', 'REJECTED');

      const digest = await digestService.generateDigestAsync();
      const pendingNames = digest.pendingOutreachDrafts.map(d => d.prospectName);

      expect(pendingNames).toContain('Valid Clinic');
      expect(pendingNames).not.toContain('Partha Dental');
      expect(pendingNames).not.toContain('Roots Dental');
      expect(pendingNames).not.toContain('FMS Dental');

      // Cleanup
      db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'test_prospect_p3_%'`).run();
      db.prepare(`DELETE FROM direct_outreach_log WHERE id LIKE 'test_draft_p3_%'`).run();
    });
  });

  // --------------------------------------------------------------------------
  // Group 5: Priority Four (DOM XSS, Input Validation, RFC 5545 .ics & CSV Formula Injection)
  // --------------------------------------------------------------------------
  describe('Priority Four: DOM XSS, Phone/Email Validation, RFC 5545 Escaping & CSV Injection', () => {
    it('rejects phone number shorter than 10 digits or longer than 15 digits', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Short Phone',
          customerPhone: '12345', // only 5 digits
          consentGiven: true
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('10 to 15 digit');
    });

    it('rejects invalid email address format', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Bad Email',
          customerPhone: '9849012345',
          customerEmail: 'not-an-email',
          consentGiven: true
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Invalid email address');
    });

    it('sets initial status to PENDING_OWNER_REVIEW (never auto-QUALIFIED)', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Real Inquiry',
          customerPhone: '9849098490',
          customerEmail: 'real@clinic.com',
          serviceOfInterest: 'Real Clinic, Hyderabad',
          notes: 'High volume after 8 PM',
          consentGiven: true
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.status).toBe('PENDING_OWNER_REVIEW');
      expect(json.status).not.toBe('QUALIFIED');
    });

    it('sanitizes CSV formula injection characters (=, +, -, @) and sets status PENDING_OWNER_REVIEW', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: '=cmd|’ /C calc’!A0', // formula injection attempt
          customerPhone: '9849098490',
          serviceOfInterest: '+Formula Clinic Hyderabad',
          notes: '@admin please approve',
          consentGiven: true
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verify CSV cell values are prefixed with single quote
      expect(json.csvRow).toContain("'=cmd");
      expect(json.csvRow).toContain("'+Formula Clinic");
      expect(json.csvRow).toContain("'@admin please approve");
      expect(json.csvRow).toContain('PENDING_OWNER_REVIEW');
    });

    it('escapes RFC 5545 special characters (\\, ;, ,, newlines) and sets STATUS:TENTATIVE in .ics', async () => {
      const res = await app.request('/api/v1/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Kumar; MD, PhD',
          customerPhone: '9849098490',
          serviceOfInterest: 'Hyderabad\\Secunderabad Dental, Care',
          notes: 'Line 1\nLine 2; special, note',
          consentGiven: true
        })
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      const ics = json.calendarIcs;
      expect(ics).toContain('STATUS:TENTATIVE');
      expect(ics).not.toContain('STATUS:CONFIRMED');
      // Verify escaped characters
      expect(ics).toContain('\\;');
      expect(ics).toContain('\\,');
      expect(ics).toContain('\\\\');
      expect(ics).toContain('\\n');
    });
  });
});
