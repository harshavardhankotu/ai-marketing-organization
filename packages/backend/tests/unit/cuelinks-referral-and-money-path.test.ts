import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isAllowlistedRedirectHost,
  ALLOWED_REDIRECT_HOSTS_BY_NETWORK,
  ReferralTrackingEngine
} from '../../src/commission/referral-tracking.js';
import { CuelinksAdapter } from '../../src/commission/affiliate-adapters.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';

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
});
