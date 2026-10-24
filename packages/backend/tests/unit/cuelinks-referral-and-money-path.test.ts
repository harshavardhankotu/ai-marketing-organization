import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAllowlistedRedirectHost,
  ALLOWED_REDIRECT_HOSTS_BY_NETWORK,
  ReferralTrackingEngine
} from '../../src/commission/referral-tracking.js';
import { CuelinksAdapter } from '../../src/commission/affiliate-adapters.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { app } from '../../src/index.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Cuelinks Referral Tracking, Host Allowlist & Money-Path Verification', () => {
  const originalEnv = { ...process.env };
  const ORG = 'org_owner_primary';

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AMAZON_AFFILIATE_TAG;
    delete process.env.CUELINKS_CAMPAIGN_ID;
    resetDbForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Exact HTTPS Host Allowlist & Anti-Spoofing Security', () => {
    it('allows valid HTTPS Cuelinks and LinksRedirect hostnames', () => {
      expect(isAllowlistedRedirectHost('https://cuelinks.com/campaign/123')).toBe(true);
      expect(isAllowlistedRedirectHost('https://www.cuelinks.com/campaign/123')).toBe(true);
      expect(isAllowlistedRedirectHost('https://linksredirect.com/?cid=12345&subid=test')).toBe(true);
      expect(isAllowlistedRedirectHost('https://www.linksredirect.com/?cid=12345')).toBe(true);
    });

    it('rejects unencrypted HTTP URLs even on allowlisted hostnames', () => {
      expect(isAllowlistedRedirectHost('http://cuelinks.com/campaign/123')).toBe(false);
      expect(isAllowlistedRedirectHost('http://linksredirect.com/?cid=12345')).toBe(false);
      expect(isAllowlistedRedirectHost('http://www.amazon.in/dp/B08XYZ')).toBe(false);
    });

    it('rejects domain spoofing, subdomains on hostile domains, and open redirects', () => {
      expect(isAllowlistedRedirectHost('https://cuelinks.com.bad-actor.example/phish')).toBe(false);
      expect(isAllowlistedRedirectHost('https://linksredirect.com.attacker.com/malware')).toBe(false);
      expect(isAllowlistedRedirectHost('https://evil-cuelinks.com/test')).toBe(false);
      expect(isAllowlistedRedirectHost('https://amazon.in.attacker.org/steal')).toBe(false);
      expect(isAllowlistedRedirectHost('not-a-valid-url')).toBe(false);
    });

    it('enforces network-specific host validation when network is provided', () => {
      // Cuelinks network accepts Cuelinks hosts but rejects Amazon hosts
      expect(isAllowlistedRedirectHost('https://linksredirect.com/?cid=100', 'CUELINKS')).toBe(true);
      expect(isAllowlistedRedirectHost('https://amazon.in/dp/B08XYZ', 'CUELINKS')).toBe(false);

      // Amazon network accepts Amazon hosts but rejects Cuelinks hosts
      expect(isAllowlistedRedirectHost('https://www.amazon.in/dp/B08XYZ', 'AMAZON_ASSOCIATES')).toBe(true);
      expect(isAllowlistedRedirectHost('https://linksredirect.com/?cid=100', 'AMAZON_ASSOCIATES')).toBe(false);
    });
  });

  describe('2. CuelinksAdapter Provider-Issued URL Bypass & subid Injection', () => {
    const adapter = new CuelinksAdapter();

    it('handles exact cuelinks and linksredirect domains', () => {
      expect(adapter.handles('linksredirect.com')).toBe(true);
      expect(adapter.handles('www.linksredirect.com')).toBe(true);
      expect(adapter.handles('cuelinks.com')).toBe(true);
      expect(adapter.handles('www.cuelinks.com')).toBe(true);
      expect(adapter.handles('attacker.com')).toBe(false);
    });

    it('preserves provider-issued tracking URL without requiring trackingTemplate', () => {
      const providerUrl = 'https://linksredirect.com/?cid=998877&url=https%3A%2F%2Fstore.in%2Fitem';
      const result = adapter.buildTrackedDestination({
        baseUrl: providerUrl,
        clickId: 'clk_test_subid_001'
      });

      expect(result).toContain('subid=clk_test_subid_001');
      expect(result).toContain('cid=998877');
    });

    it('preserves existing subid if already set in provider URL', () => {
      const providerUrl = 'https://linksredirect.com/?cid=998877&subid=existing_subid';
      const result = adapter.buildTrackedDestination({
        baseUrl: providerUrl,
        clickId: 'clk_test_subid_002'
      });

      expect(result).toContain('subid=existing_subid');
    });

    it('confirms attribution when provider-issued hostname is present', () => {
      const url = new URL('https://linksredirect.com/?cid=998877');
      expect(adapter.hasAttribution(url)).toBe(true);
    });
  });

  describe('3. Unverified Partner Creation Defaults to UNDER_REVIEW in Production', () => {
    it('sets UNDER_REVIEW, activeStatus 0, and PENDING_REVIEW for unverified partners in production', async () => {
      process.env.NODE_ENV = 'production';
      const registry = PartnerRegistryEngine.getInstance();

      const partner = await registry.createPartner({
        organizationId: ORG,
        name: 'Unverified Test Affiliate',
        industry: 'retail',
        website: 'https://cuelinks.com'
      });

      expect(partner.approvalStatus).toBe('UNDER_REVIEW');
      expect(partner.activeStatus).toBe(0);
      expect(partner.authorizationStatus).toBe('PENDING_REVIEW');
      expect(registry.isPartnerAuthorizedForProduction(partner)).toBe(false);
    });
  });

  describe('4. Network Money-Path Evaluator', () => {
    it('evaluates Cuelinks money path stages accurately', async () => {
      const registry = PartnerRegistryEngine.getInstance();

      // Stage 1: No partner configured
      const s1 = await registry.evaluateNetworkMoneyPath(ORG, 'CUELINKS');
      expect(s1.moneyPath).toBe('BLOCKED');
      expect(s1.singleBiggestBlocker).toBe('PARTNER_APPROVAL');

      // Stage 2: Partner approved and authorized, but no tracking ID
      const partner = await registry.createPartner({
        organizationId: ORG,
        name: 'Cuelinks India Commercial',
        industry: 'ecommerce',
        website: 'https://cuelinks.com',
        network: 'CUELINKS',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED'
      });
      // In test mode, activeStatus will be 1 when approvalStatus is APPROVED
      expect(registry.isPartnerAuthorizedForProduction(partner)).toBe(true);

      const s2 = await registry.evaluateNetworkMoneyPath(ORG, 'CUELINKS');
      expect(s2.moneyPath).toBe('BLOCKED');
      expect(s2.singleBiggestBlocker).toBe('AFFILIATE_ID');

      // Stage 3: Tracking ID configured via CUELINKS_CAMPAIGN_ID, but no active offer
      process.env.CUELINKS_CAMPAIGN_ID = 'cue_camp_test_123';
      const s3 = await registry.evaluateNetworkMoneyPath(ORG, 'CUELINKS');
      expect(s3.moneyPath).toBe('BLOCKED');
      expect(s3.singleBiggestBlocker).toBe('NO_ACTIVE_OFFER');

      // Stage 4: Active offer created with provider tracking URL on allowlisted host
      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: ORG,
        title: 'Thermal Label Printer Cuelinks',
        offerSlug: 'thermal-label-printer-cuelinks',
        category: 'electronics',
        targetCustomer: 'E-commerce sellers',
        priceINR: 3499,
        commissionAmountINR: 175,
        destinationUrl: 'https://linksredirect.com/?cid=12345',
        authorizedTrackingUrl: 'https://linksredirect.com/?cid=12345',
        status: 'ACTIVE'
      });
      expect(offer.status).toBe('ACTIVE');

      const s4 = await registry.evaluateNetworkMoneyPath(ORG, 'CUELINKS');
      expect(s4.moneyPath).toBe('BLOCKED');
      expect(s4.singleBiggestBlocker).toBe('NO_PUBLIC_CONTENT');

      // Stage 5: Content guide published
      const db = getDb();
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, title, slug, content_markdown, primary_offer_id, status, asset_type, category, intent_target, created_at, updated_at
        ) VALUES (
          'cnt_cuelinks_guide_01', ?, 'Top Thermal Label Printers 2026', 'thermal-printers-guide',
          'Comprehensive buyer guide with statutory disclosure.', ?, 'PUBLISHED', 'BUYER_GUIDE', 'electronics', 'Best thermal printer', datetime('now'), datetime('now')
        )
      `).run(ORG, offer.id);

      const s5 = await registry.evaluateNetworkMoneyPath(ORG, 'CUELINKS');
      expect(s5.moneyPath).toBe('READY');
      expect(s5.singleBiggestBlocker).toBe('NONE_DRIVE_TRAFFIC');
    });
  });

  describe('4. Unified Launch-Checklist and Money-Path Multi-Network Verification', () => {
    it('evaluates Cuelinks launch checklist via GET /api/v1/commission/launch-checklist?network=CUELINKS', async () => {
      const session = OwnerAuthService.getInstance().createSession('usr_owner_01', ORG);

      // Stage 1: Empty state for Cuelinks
      const resUnauth = await app.request('/api/v1/commission/launch-checklist?network=CUELINKS');
      expect(resUnauth.status).toBe(401);

      const res1 = await app.request('/api/v1/commission/launch-checklist?network=CUELINKS', {
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': ORG }
      });
      expect(res1.status).toBe(200);
      const data1 = (await res1.json() as any).data;
      expect(data1.moneyPath).toBe('BLOCKED');
      expect(data1.recommendedFirstPartner.name).toBe('Cuelinks India');
      expect(data1.recommendedFirstPartner.network).toBe('CUELINKS');
      expect(data1.recommendedFirstPartner.payoutThresholdINR).toBe(500);
      expect(data1.singleBiggestBlocker).toBe('PARTNER_APPROVAL');
      expect(data1.codeActionRequired).toContain('Awaiting partner authorization');
      expect(data1.codeActionRequired).not.toContain('None. The code is ready');

      // Stage 2: Register Cuelinks Partner
      const registry = PartnerRegistryEngine.getInstance();
      const partner = await registry.createPartner({
        organizationId: ORG,
        name: 'Cuelinks India Commercial',
        industry: 'ecommerce',
        website: 'https://cuelinks.com',
        network: 'CUELINKS',
        approvalStatus: 'APPROVED',
        authorizationStatus: 'AUTHORIZED'
      });

      const res2 = await app.request('/api/v1/commission/launch-checklist?network=CUELINKS', {
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': ORG }
      });
      const data2 = (await res2.json() as any).data;
      expect(data2.singleBiggestBlocker).toBe('AFFILIATE_ID');
      expect(data2.codeActionRequired).toContain('Tracking credential missing');

      // Stage 3: Set tracking credential
      process.env.CUELINKS_CAMPAIGN_ID = 'cue_campaign_777';
      const res3 = await app.request('/api/v1/commission/launch-checklist?network=CUELINKS', {
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': ORG }
      });
      const data3 = (await res3.json() as any).data;
      expect(data3.singleBiggestBlocker).toBe('NO_ACTIVE_OFFER');
      expect(data3.codeActionRequired).toContain('Offer catalog entry required');

      // Stage 4: Register Offer
      const offer = await registry.createOffer({
        partnerId: partner.id,
        organizationId: ORG,
        title: 'Thermal Label Printer Cuelinks',
        offerSlug: 'thermal-label-printer-cuelinks-chk',
        category: 'electronics',
        targetCustomer: 'E-commerce sellers',
        priceINR: 3499,
        commissionAmountINR: 175,
        destinationUrl: 'https://linksredirect.com/?cid=777',
        authorizedTrackingUrl: 'https://linksredirect.com/?cid=777',
        status: 'ACTIVE'
      });

      const res4 = await app.request('/api/v1/commission/launch-checklist?network=CUELINKS', {
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': ORG }
      });
      const data4 = (await res4.json() as any).data;
      expect(data4.singleBiggestBlocker).toBe('NO_PUBLIC_CONTENT');
      expect(data4.codeActionRequired).toContain('Content publishing required');

      // Stage 5: Publish Guide
      const db = getDb();
      db.prepare(`
        INSERT INTO commission_content_assets (
          id, organization_id, title, slug, content_markdown, primary_offer_id, status, asset_type, category, intent_target, created_at, updated_at
        ) VALUES (
          'cnt_cuelinks_guide_chk', ?, 'Top Thermal Label Printers 2026', 'thermal-printers-guide-chk',
          'Comprehensive buyer guide with statutory disclosure.', ?, 'PUBLISHED', 'BUYER_GUIDE', 'electronics', 'Best thermal printer', datetime('now'), datetime('now')
        )
      `).run(ORG, offer.id);

      const res5 = await app.request('/api/v1/commission/launch-checklist?network=CUELINKS', {
        headers: { 'Authorization': `Bearer ${session.token}`, 'x-organization-id': ORG }
      });
      const data5 = (await res5.json() as any).data;
      expect(data5.moneyPath).toBe('READY');
      expect(data5.singleBiggestBlocker).toBe('NONE_DRIVE_TRAFFIC');
      expect(data5.codeActionRequired).toContain('None. The code and infrastructure are ready');
      expect(data5.checklist.find((i: any) => i.item === 'PARTNER APPROVAL').status).toBe('PROVISIONAL');
      expect(data5.checklist.find((i: any) => i.item === 'AFFILIATE ID').status).toBe('CONFIGURED_UNVERIFIED');
      expect(data5.checklist.find((i: any) => i.item === 'OFFER').status).toBe('READY');
      expect(data5.checklist.find((i: any) => i.item === 'TRACKING').status).toBe('READY');
      expect(data5.checklist.find((i: any) => i.item === 'PUBLIC PAGE').status).toBe('READY');
    });
  });
});
