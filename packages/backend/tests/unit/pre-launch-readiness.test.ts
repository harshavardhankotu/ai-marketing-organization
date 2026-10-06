import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { ReferralTrackingEngine, ALLOWED_REDIRECT_HOSTS, hashIpWithSalt, isBotTraffic, isAllowlistedRedirectHost } from '../../src/commission/referral-tracking.js';
import { ConversionVerificationAdapter } from '../../src/commission/conversion-verification.js';
import { ContentAssetEngine, lintContentAsset } from '../../src/commission/content-asset-engine.js';
import { CommissionLedgerEngine } from '../../src/commission/commission-ledger.js';

describe('Pre-Launch Readiness Audit Test Suite', () => {
  const orgId = 'org_prelaunch_audit';

  beforeEach(() => {
    const db = getDb();
    // Clean test tables
    try {
      db.prepare(`DELETE FROM referral_click_events WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM referrals WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM commission_records WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM revenue_records WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM commission_content_assets WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(orgId);
      db.prepare(`DELETE FROM partners WHERE organization_id = ?`).run(orgId);
    } catch {}
  });

  // =========================================================================
  // ITEM 1: REDIRECT SAFETY
  // =========================================================================
  describe('1. Redirect Safety', () => {
    it('verifies redirect host allowlist contains only amazon.in and www.amazon.in', () => {
      expect(ALLOWED_REDIRECT_HOSTS.has('amazon.in')).toBe(true);
      expect(ALLOWED_REDIRECT_HOSTS.has('www.amazon.in')).toBe(true);
      expect(ALLOWED_REDIRECT_HOSTS.size).toBe(2);
      expect(isAllowlistedRedirectHost('https://www.amazon.in/dp/B08XYZ1234')).toBe(true);
      expect(isAllowlistedRedirectHost('https://amazon.in/dp/B08XYZ1234')).toBe(true);
      expect(isAllowlistedRedirectHost('https://evil.com/phishing')).toBe(false);
      expect(isAllowlistedRedirectHost('https://amazon.com/dp/B08XYZ1234')).toBe(false);
      expect(isAllowlistedRedirectHost('https://evil-amazon.in/fake')).toBe(false);
    });

    it('rejects hostile inputs and non-allowlisted redirect hosts', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      const tracking = ReferralTrackingEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Hostile Test Partner',
        industry: 'E-Commerce',
        website: 'https://evil.com',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'OTHER_AUTHORIZED_PARTNER'
      });

      // Attempt creating offer pointing to an unallowlisted domain
      const hostileOffer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: orgId,
        title: 'Hostile Phishing Offer',
        offerSlug: 'hostile-phishing-offer',
        category: 'gadgets',
        targetCustomer: 'Victims',
        commissionAmountINR: 100,
        destinationUrl: 'https://evil.com/phish',
        authorizedTrackingUrl: 'https://evil.com/phish',
        status: 'ACTIVE'
      });

      // Creating a referral link with non-allowlisted destination throws UNAUTHORIZED_REDIRECT_HOST
      await expect(tracking.createReferralLink(hostileOffer.id)).rejects.toThrow('UNAUTHORIZED_REDIRECT_HOST');
    });

    it('ignores client-supplied url/redirect/next/dest parameters and never uses them', async () => {
      const registry = PartnerRegistryEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Test Partner',
        industry: 'E-Commerce',
        website: 'https://www.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: orgId,
        title: 'Allowlisted Amazon Echo',
        offerSlug: 'amazon-echo-dot',
        category: 'electronics',
        targetCustomer: 'Home owners',
        commissionAmountINR: 150,
        destinationUrl: 'https://www.amazon.in/dp/B084DWCZY6',
        authorizedTrackingUrl: 'https://www.amazon.in/dp/B084DWCZY6?tag=aro-official-21',
        status: 'ACTIVE'
      });

      const tracking = ReferralTrackingEngine.getInstance();
      const link = await tracking.createReferralLink(offer.id);

      // Call route with hostile query parameters trying open redirect
      const hostileQuery = `url=https://attacker.com&redirect=https://evil.com&next=https://malicious.org&dest=https://phish.net`;
      const res = await app.request(`/r/${offer.offerSlug}/${link.referralId}?${hostileQuery}`);
      expect(res.status).toBe(302);
      const location = res.headers.get('location') || '';
      expect(location).toContain('amazon.in');
      expect(location).not.toContain('attacker.com');
      expect(location).not.toContain('evil.com');
      expect(location).not.toContain('malicious.org');
      expect(location).not.toContain('phish.net');
    });

    it('appends affiliate tag server-side only and never logs raw tag in errors', async () => {
      // Hostile error simulation: if error contains tag=, it must be redacted
      const res404 = await app.request('/r/nonexistent-offer/ref_xyz?tag=my-secret-tag-21');
      expect(res404.status).toBe(404);
      const body = await res404.json() as any;
      expect(body.message).not.toContain('my-secret-tag-21');
    });
  });

  // =========================================================================
  // ITEM 2: CLICK RECORDING & BOT FILTERING
  // =========================================================================
  describe('2. Click Recording & Bot / Test Traffic Exclusion', () => {
    it('stores salted SHA-256 IP hash instead of raw IP', () => {
      const rawIp = '110.235.225.146';
      const hash1 = hashIpWithSalt(rawIp);
      const hash2 = hashIpWithSalt(rawIp);

      expect(hash1).toBeDefined();
      expect(hash1).toHaveLength(64); // SHA-256 hex length
      expect(hash1).toBe(hash2); // Deterministic with same salt
      expect(hash1).not.toBe(rawIp); // Never raw IP
      expect(hashIpWithSalt(undefined)).toBeNull();
      expect(hashIpWithSalt('unknown')).toBeNull();
    });

    it('identifies bot crawlers and spiders correctly', () => {
      expect(isBotTraffic('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
      expect(isBotTraffic('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true);
      expect(isBotTraffic('facebookexternalhit/1.1')).toBe(true);
      expect(isBotTraffic('DuckDuckBot/1.0')).toBe(true);
      expect(isBotTraffic('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false);
    });

    it('proves bot and TEST_TRAFFIC clicks never increment visitor clicks or expected revenue', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      const contentEngine = ContentAssetEngine.getInstance();
      const tracking = ReferralTrackingEngine.getInstance();
      const ledger = CommissionLedgerEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Click Test',
        industry: 'E-Commerce',
        website: 'https://www.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: orgId,
        title: 'Thermal Billing Device',
        offerSlug: 'thermal-billing-device',
        category: 'hardware',
        targetCustomer: 'Shops',
        commissionAmountINR: 200,
        destinationUrl: 'https://www.amazon.in/dp/B08ABC1234',
        authorizedTrackingUrl: 'https://www.amazon.in/dp/B08ABC1234?tag=aimktg-21',
        status: 'ACTIVE'
      });

      const asset = await contentEngine.createAsset({
        organizationId: orgId,
        slug: 'thermal-billing-printer-guide',
        assetType: 'GUIDE',
        title: 'Thermal Billing Printer Guide for Retail',
        category: 'hardware',
        intentTarget: 'thermal billing printer guide',
        contentMarkdown: 'As an Amazon Associate I earn from qualifying purchases.\n\nEvaluating thermal billing printers requires analyzing print resolution, roll diameter compatibility, and USB connection stability. We compare leading models to guide retail shop owners across Indian retail environments to make an informed hardware purchase decision.',
        primaryOfferId: offer.id
      });
      expect(asset.status).toBe('PUBLISHED');

      const link = await tracking.createReferralLink(offer.id);

      // 1. Simulate BOT click
      await tracking.resolveReferralClick(offer.offerSlug, link.referralId, {
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
        ip: '66.249.66.1'
      });

      // 2. Simulate TEST_TRAFFIC click
      await tracking.resolveReferralClick(offer.offerSlug, link.referralId, {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
        ip: '110.235.225.146',
        isTestTraffic: true
      });

      // Assert click counter on content asset did NOT increment
      const assetFresh = await contentEngine.getAssetBySlug(asset.slug, false);
      expect(assetFresh?.referralClickCount).toBe(0);

      // Assert ledger summary shows 0 clicks and 0 revenue
      const summary = await ledger.getSummary(orgId);
      expect(summary.approvedCommissionsCount).toBe(0);
      expect(summary.verifiedRevenueINR).toBe(0);
      expect(summary.receivedCashINR).toBe(0);
    });
  });

  // =========================================================================
  // ITEM 3: LEDGER INTEGRITY
  // =========================================================================
  describe('3. Ledger Integrity & Evidence Requirement', () => {
    it('rejects a manually entered conversion without evidence', async () => {
      const verifier = ConversionVerificationAdapter.getInstance();
      const registry = PartnerRegistryEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Ledger Test',
        industry: 'E-Commerce',
        website: 'https://www.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      // Report conversion with empty evidence -> must reject
      await expect(verifier.reportConversion({
        partnerId: partner.id,
        externalTransactionId: 'amz_tx_001',
        expectedCommissionINR: 300,
        verificationSource: 'MANUAL_VERIFICATION',
        evidence: {} // Empty evidence!
      })).rejects.toThrow('EVIDENCE_REQUIRED');
    });

    it('proves commission cannot move to VERIFIED or PAID without attached provider proof', async () => {
      const verifier = ConversionVerificationAdapter.getInstance();
      const registry = PartnerRegistryEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Proof Test',
        industry: 'E-Commerce',
        website: 'https://www.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      // Create a pending commission with initial note
      const comm = await verifier.reportConversion({
        partnerId: partner.id,
        externalTransactionId: 'amz_tx_002',
        expectedCommissionINR: 400,
        verificationSource: 'DASHBOARD_EXPORT',
        evidence: { note: 'Initial pending conversion signal' }
      });
      expect(comm.status).toBe('COMMISSION_PENDING');

      // Attempt to APPROVE without provider proof -> must fail
      await expect(verifier.reconcileCommission({
        commissionId: comm.id,
        action: 'APPROVE',
        verificationSource: 'MANUAL_VERIFICATION',
        evidence: { manualNote: 'Attempting approval without provider statement' } // Missing payoutId/reportId/transactionId
      })).rejects.toThrow('PROVIDER_PROOF_REQUIRED');

      // Attempt to PAY without provider proof -> must fail
      await expect(verifier.reconcileCommission({
        commissionId: comm.id,
        action: 'PAY',
        verificationSource: 'MANUAL_VERIFICATION',
        evidence: { internalComment: 'Owner payout claim' }
      })).rejects.toThrow('PROVIDER_PROOF_REQUIRED');

      // Succeeds when valid provider proof is attached
      const approved = await verifier.reconcileCommission({
        commissionId: comm.id,
        action: 'APPROVE',
        verificationSource: 'PROVIDER_API',
        evidence: { reportId: 'amz_associates_report_20261006', transactionId: 'amz_tx_002' }
      });
      expect(approved.status).toBe('COMMISSION_APPROVED');
      expect(approved.verifiedCommissionINR).toBe(400);

      const paid = await verifier.reconcileCommission({
        commissionId: comm.id,
        action: 'PAY',
        verificationSource: 'PROVIDER_API',
        evidence: { payoutId: 'payout_neft_oct_2026', transactionId: 'amz_tx_002' }
      });
      expect(paid.status).toBe('COMMISSION_PAID');
      expect(paid.receivedCommissionINR).toBe(400);
    });
  });

  // =========================================================================
  // ITEM 4: CONTENT GATE
  // =========================================================================
  describe('4. Content Gate Publish-Time Lint', () => {
    it('blocks old thermal-printer draft wording containing forbidden claims', () => {
      // Sample embodying historical draft defects:
      // "certified", "best", "#1", "guaranteed", "lowest price ₹1999", "in stock", "limited time", star ratings, testimonials
      const failingDraft = `
# Thermal Printer Guide for Indian Retail

We review the certified thermal printers on the market.
This model is the best #1 option available for small shops.
100% money-back guarantee with guaranteed delivery.
Lowest price ₹1,999 with 20% off during limited time festive sale.
In stock now with 4.8 stars rating.
"This transformed our store completely!" - Ramesh
      `;

      const result = lintContentAsset(failingDraft);
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('certified'))).toBe(true);
      expect(result.violations.some(v => v.includes('best'))).toBe(true);
      expect(result.violations.some(v => v.includes('#1'))).toBe(true);
      expect(result.violations.some(v => v.includes('PRICING') || v.includes('pricing'))).toBe(true);
      expect(result.violations.some(v => v.includes('in stock'))).toBe(true);
      expect(result.violations.some(v => v.includes('limited time'))).toBe(true);
      expect(result.violations.some(v => v.includes('star'))).toBe(true);
      expect(result.violations.some(v => v.includes('testimonial'))).toBe(true);
      expect(result.violations.some(v => v.includes('Mandatory disclosure required'))).toBe(true);
    });

    it('passes clean, factual comparison content with required Amazon Associates disclosure', () => {
      const cleanContent = `
As an Amazon Associate I earn from qualifying purchases.

# Comprehensive Guide to 58mm & 80mm Receipt Printers

Retail billing throughput depends heavily on thermal print speed, cutter reliability, and driver support for Indian POS software.

## Key Technical Specifications:
- Resolution: 203 DPI standard
- Interface: USB and Bluetooth options
- Roll Width: 58mm vs 80mm comparison

Before selecting hardware, shopkeepers should evaluate paper roll loading mechanisms and vendor warranty coverage.
      `;

      const result = lintContentAsset(cleanContent, { hasVerifiedRecord: true });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  // =========================================================================
  // ITEM 11: END-TO-END FIXTURE
  // =========================================================================
  describe('11. End-To-End Fixture', () => {
    it('executes full funnel: approved partner -> offer -> published page -> click via /r/ -> 302 with tag -> TEST_TRAFFIC click recorded -> ledger unchanged', async () => {
      const registry = PartnerRegistryEngine.getInstance();
      const contentEngine = ContentAssetEngine.getInstance();
      const ledger = CommissionLedgerEngine.getInstance();

      // 1. Approved fixture partner
      const partner = await registry.createPartner({
        organizationId: orgId,
        name: 'Amazon India Fixture E2E',
        industry: 'E-Commerce',
        website: 'https://www.amazon.in',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED',
        network: 'AMAZON_ASSOCIATES'
      });

      // 2. Active partner offer with authorized Amazon tracking URL
      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: orgId,
        title: 'Thermal Label Printer 80mm',
        offerSlug: 'thermal-label-printer-80mm',
        category: 'hardware',
        targetCustomer: 'Retail shopkeepers',
        commissionAmountINR: 120,
        destinationUrl: 'https://www.amazon.in/dp/B09XYZ9999',
        authorizedTrackingUrl: 'https://www.amazon.in/dp/B09XYZ9999?tag=aimktg-21',
        status: 'ACTIVE'
      });

      // 3. Published content page passing all quality gates and lint
      const asset = await contentEngine.createAsset({
        organizationId: orgId,
        slug: 'retail-thermal-printer-e2e',
        assetType: 'GUIDE',
        title: 'Thermal Printer Technical Guide for Retail',
        category: 'hardware',
        intentTarget: 'thermal printer retail guide',
        contentMarkdown: `As an Amazon Associate I earn from qualifying purchases.\n\nThermal printing mechanisms provide quiet, fast transaction receipt issuance without liquid ink cartridges. This comparison reviews 58mm and 80mm format advantages for local retail counter setups across small businesses in Indian commercial centers.`,
        primaryOfferId: offer.id
      });
      expect(asset.status).toBe('PUBLISHED');

      // 4. Click via /r/:offerSlug/:referralId with TEST_TRAFFIC headers
      const tracking = ReferralTrackingEngine.getInstance();
      const link = await tracking.createReferralLink(offer.id);

      const clickRes = await app.request(`/r/${offer.offerSlug}/${link.referralId}`, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'x-test-mode': 'true',
          'x-forwarded-for': '110.235.225.146, 172.69.86.91, 10.194.16.2'
        }
      });

      // Assert 302 redirect
      expect(clickRes.status).toBe(302);
      const redirectUrl = clickRes.headers.get('location') || '';
      expect(redirectUrl).toContain('amazon.in');
      expect(redirectUrl).toContain('tag=aimktg-21');

      // 5. Verify click was treated as TEST_TRAFFIC: asset click counter unchanged
      const refreshedAsset = await contentEngine.getAssetBySlug(asset.slug, false);
      expect(refreshedAsset?.referralClickCount).toBe(0);

      // 6. Verify ledger remains unchanged (0 revenue, 0 conversions)
      const ledgerSummary = await ledger.getSummary(orgId);
      expect(ledgerSummary.verifiedRevenueINR).toBe(0);
      expect(ledgerSummary.receivedCashINR).toBe(0);
      expect(ledgerSummary.approvedCommissionsCount).toBe(0);
      expect(ledgerSummary.externalConversions).toBe(0);
    });
  });
});
