import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { ContentAssetEngine } from '../../src/commission/content-asset-engine.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Phase 4: Commercial Launch & Money-Path Verification (Spec §§ 1–30)', () => {
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;

  const cleanup = () => {
    const db = getDb();
    try {
      db.prepare('DELETE FROM commission_records WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM referrals WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM commission_content_assets WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM partner_offers WHERE organization_id = ?').run(orgId);
      db.prepare('DELETE FROM partners WHERE organization_id = ?').run(orgId);
    } catch {}
  };

  beforeEach(cleanup);
  afterAll(cleanup);

  it('1. GET /api/v1/commission/money-path requires owner authentication', async () => {
    // 1. Unauthenticated request returns 401
    const unauthRes = await app.request('/api/v1/commission/money-path');
    expect(unauthRes.status).toBe(401);

    // 2. Owner authenticated request returns 200 with checklist
    const session = OwnerAuthService.getInstance().createSession();
    const res = await app.request('/api/v1/commission/money-path', {
      headers: { 'Authorization': `Bearer ${session.token}` }
    });
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.moneyPath).toBe('BLOCKED');
    expect(json.data.reason).toContain('No approved affiliate/partner account');
    expect(json.data.singleBiggestBlocker).toBe('PARTNER_APPROVAL');
    expect(json.data.humanActionRequired).toBeDefined();
    expect(json.data.checklist).toBeInstanceOf(Array);
    expect(json.data.checklist.length).toBe(11);

    // Check checklist items (§ 3)
    const items = json.data.checklist.map((c: any) => c.item);
    expect(items).toContain('PARTNER APPROVAL');
    expect(items).toContain('AFFILIATE ID');
    expect(items).toContain('PARTNER TERMS');
    expect(items).toContain('OFFER');
    expect(items).toContain('TRACKING');
    expect(items).toContain('PUBLIC PAGE');
    expect(items).toContain('TRAFFIC');
    expect(items).toContain('REFERRAL');
    expect(items).toContain('CONVERSION');
    expect(items).toContain('COMMISSION');
    expect(items).toContain('PAYOUT');

    const partnerCheck = json.data.checklist.find((c: any) => c.item === 'PARTNER APPROVAL');
    expect(partnerCheck.status).toBe('REQUIRES HUMAN');
  });

  it('2. GET /api/v1/commission/launch-checklist requires owner authentication', async () => {
    // 1. Unauthenticated request returns 401
    const unauthRes = await app.request('/api/v1/commission/launch-checklist');
    expect(unauthRes.status).toBe(401);

    // 2. Owner authenticated request returns 200 with checklist
    const session = OwnerAuthService.getInstance().createSession();
    const res = await app.request('/api/v1/commission/launch-checklist', {
      headers: { 'Authorization': `Bearer ${session.token}` }
    });
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.moneyPath).toBe('BLOCKED');
    expect(json.data.recommendedFirstPartner).toBeDefined();
    expect(json.data.recommendedFirstPartner.name).toContain('Amazon Associates');
    expect(json.data.singleBiggestBlocker).toBe('PARTNER_APPROVAL');
    expect(json.data.codeActionRequired).toContain('The code is ready');
  });

  it('3. GET /robots.txt serves valid robots instructions and sitemap link', async () => {
    const res = await app.request('/robots.txt');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Allow: /');
    expect(text).toContain('Sitemap:');
  });

  it('4. GET /sitemap.xml serves valid sitemap XML with public pages', async () => {
    const res = await app.request('/sitemap.xml');
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('/public/disclosure');
  });

  it('5. Money-path dynamically transitions to READY once partner, offer, and content are active', async () => {
    const registry = PartnerRegistryEngine.getInstance();
    const contentEngine = ContentAssetEngine.getInstance();

    // Step 1: Create approved partner with affiliate tag evidence
    const partner = await registry.createPartner({
      organizationId: orgId,
      name: 'Amazon India Associates',
      industry: 'E-Commerce',
      country: 'India',
      website: 'https://www.amazon.in',
      approvalStatus: 'APPROVED',
      authorizationStatus: 'AUTHORIZED',
      network: 'AMAZON_ASSOCIATES',
      evidence: { affiliateTag: 'aimktg-21' }
    });

    // Step 2: Create active offer with tracking
    const offer = await registry.createOffer({
      partnerId: partner.id,
      organizationId: orgId,
      title: 'Best Accounting Software',
      offerSlug: 'best-accounting-software',
      category: 'software',
      targetCustomer: 'Small businesses in India',
      commissionAmountINR: 500,
      destinationUrl: 'https://www.amazon.in/dp/B00EXAMPLE',
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B00EXAMPLE?tag=aimktg-21',
      status: 'ACTIVE'
    });

    // Step 3: Publish genuine commercial content (passes 300+ chars quality gate)
    await contentEngine.createAsset({
      organizationId: orgId,
      slug: 'accounting-guide-2026',
      assetType: 'GUIDE',
      title: 'Top Accounting Software Guide for Indian Businesses',
      category: 'software',
      location: 'India',
      intentTarget: 'small business accounting',
      contentMarkdown: 'As an Amazon Associate I earn from qualifying purchases.\n\nWhen selecting accounting software for Indian small businesses, owners need GST compliance, invoicing automation, and multi-user support. This guide compares leading options based on pricing, ease of use, bank reconciliation, and local customer service to help you choose a suitable solution for your business.',
      primaryOfferId: offer.id
    });

    // Re-check money-path
    const session = OwnerAuthService.getInstance().createSession();
    const res = await app.request('/api/v1/commission/money-path', {
      headers: { 'Authorization': `Bearer ${session.token}` }
    });
    expect(res.status).toBe(200);

    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.moneyPath).toBe('READY');
    expect(json.data.metrics.partners.authorized).toBeGreaterThanOrEqual(1);
    expect(json.data.metrics.offers.active).toBeGreaterThanOrEqual(1);
    expect(json.data.metrics.content.published).toBeGreaterThanOrEqual(1);
  });

  it('6. Publish blocker: rejects publication if content contains OPERATOR_TO_FILL in any letter case', async () => {
    const registry = PartnerRegistryEngine.getInstance();
    const contentEngine = ContentAssetEngine.getInstance();

    const partner = await registry.createPartner({
      organizationId: orgId,
      name: 'Amazon India Associates',
      industry: 'E-Commerce',
      country: 'India',
      website: 'https://www.amazon.in',
      approvalStatus: 'APPROVED',
      authorizationStatus: 'AUTHORIZED',
      network: 'AMAZON_ASSOCIATES',
      evidence: { affiliateTag: 'aimktg-21' }
    });

    const offer = await registry.createOffer({
      partnerId: partner.id,
      organizationId: orgId,
      title: 'Valid Thermal Printer',
      offerSlug: 'valid-thermal-printer-blocker',
      category: 'hardware',
      targetCustomer: 'Retail shopkeepers',
      commissionAmountINR: 50,
      destinationUrl: 'https://www.amazon.in/dp/B00PRINTER',
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B00PRINTER?tag=aimktg-21',
      status: 'ACTIVE'
    });

    const cases = [
      'OPERATOR_TO_FILL',
      'operator_to_fill',
      'Operator_To_Fill',
      'oPeRaToR_tO_fIlL'
    ];

    for (let i = 0; i < cases.length; i++) {
      const placeholder = cases[i];
      const markdown = `A comprehensive guide for retail shopkeepers. `.repeat(10) +
        `\n\n## Models worth checking: ${placeholder}\n\nWe may earn an affiliate commission.`;

      const gate = await contentEngine.validateForPublish({
        organizationId: orgId,
        slug: `test-placeholder-${i}`,
        assetType: 'GUIDE',
        title: 'Thermal Printer Guide for Indian Retail',
        category: 'hardware',
        intentTarget: 'thermal receipt printer billing',
        contentMarkdown: markdown,
        primaryOfferId: offer.id
      });

      expect(gate.passed).toBe(false);
      expect(gate.checks.noUnfilledPlaceholders).toBe(false);
      expect(gate.failures).toContain('UNFILLED_PLACEHOLDER: content contains OPERATOR_TO_FILL markers and cannot be published.');

      // Verify createAsset sets status to DRAFT
      const asset = await contentEngine.createAsset({
        organizationId: orgId,
        slug: `test-placeholder-asset-${i}`,
        assetType: 'GUIDE',
        title: 'Thermal Printer Guide for Indian Retail',
        category: 'hardware',
        intentTarget: 'thermal receipt printer billing',
        contentMarkdown: markdown,
        primaryOfferId: offer.id
      });
      expect(asset.status).toBe('DRAFT');
    }
  });

  it('7. Publish blocker: rejects publication if an Amazon link is missing the affiliate tag', async () => {
    const registry = PartnerRegistryEngine.getInstance();
    const contentEngine = ContentAssetEngine.getInstance();

    const partner = await registry.createPartner({
      organizationId: orgId,
      name: 'Amazon India Associates',
      industry: 'E-Commerce',
      country: 'India',
      website: 'https://www.amazon.in',
      approvalStatus: 'APPROVED',
      authorizationStatus: 'AUTHORIZED',
      network: 'AMAZON_ASSOCIATES',
      evidence: { affiliateTag: 'aimktg-21' }
    });

    const offer = await registry.createOffer({
      partnerId: partner.id,
      organizationId: orgId,
      title: 'Valid Thermal Printer',
      offerSlug: 'valid-thermal-printer-tagged',
      category: 'hardware',
      targetCustomer: 'Retail shopkeepers',
      commissionAmountINR: 50,
      destinationUrl: 'https://www.amazon.in/dp/B00PRINTER',
      authorizedTrackingUrl: 'https://www.amazon.in/dp/B00PRINTER?tag=aimktg-21',
      status: 'ACTIVE'
    });

    // Content with untagged Amazon URL
    const untaggedMarkdown = `A comprehensive guide for retail shopkeepers. `.repeat(10) +
      `\n\n[Check on Amazon](https://www.amazon.in/dp/B08XYZ1234)\n\nWe may earn an affiliate commission.`;

    const gate = await contentEngine.validateForPublish({
      organizationId: orgId,
      slug: 'test-untagged-amazon',
      assetType: 'GUIDE',
      title: 'Thermal Printer Guide for Indian Retail',
      category: 'hardware',
      intentTarget: 'thermal receipt printer billing',
      contentMarkdown: untaggedMarkdown,
      primaryOfferId: offer.id
    });

    expect(gate.passed).toBe(false);
    expect(gate.checks.noUntaggedAmazonLinks).toBe(false);
    expect(gate.failures).toContain('UNTAGGED_AMAZON_LINK: Amazon links in content must include an authorized affiliate tag.');

    const draftAsset = await contentEngine.createAsset({
      organizationId: orgId,
      slug: 'test-untagged-amazon-asset',
      assetType: 'GUIDE',
      title: 'Thermal Printer Guide for Indian Retail',
      category: 'hardware',
      intentTarget: 'thermal receipt printer billing',
      contentMarkdown: untaggedMarkdown,
      primaryOfferId: offer.id
    });
    expect(draftAsset.status).toBe('DRAFT');

    // Tagged Amazon URL passes this check
    const taggedMarkdown = `A comprehensive guide for retail shopkeepers. `.repeat(10) +
      `\n\n[Check on Amazon](https://www.amazon.in/dp/B08XYZ1234?tag=aimktg-21)\n\nWe may earn an affiliate commission.`;

    const passedGate = await contentEngine.validateForPublish({
      organizationId: orgId,
      slug: 'test-tagged-amazon',
      assetType: 'GUIDE',
      title: 'Thermal Printer Guide for Indian Retail',
      category: 'hardware',
      intentTarget: 'thermal receipt printer billing',
      contentMarkdown: taggedMarkdown,
      primaryOfferId: offer.id
    });
    expect(passedGate.checks.noUntaggedAmazonLinks).toBe(true);
  });
});
