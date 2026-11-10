import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { AutonomousDealDiscoveryEngine } from '../../src/commission/autonomous-deal-discovery-engine.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import {
  CommercialSchedulePolicy,
  CONTINUOUS_HOURLY_WORKFLOWS,
  MORNING_0900_WORKFLOWS,
  EVENING_2100_WORKFLOWS
} from '../../src/automation/commercial-schedule-policy.js';
import {
  WORKFLOW_DEFINITIONS
} from '../../src/automation/automation-registry-engine.js';

describe('Stage D & Stage E — Autonomous Daily Deals and Production Conversion Integrity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CUELINKS_CHANNEL_ID = '331585';
    process.env.PUBLIC_SITE_URL = 'https://ai-marketing-organization.onrender.com';
  });

  describe('1. Commercial Schedule Policy & Cadence Alignment', () => {
    it('sets affiliate_offer_reconciliation and daily_market_demand_research as continuous hourly workflows', () => {
      expect(CONTINUOUS_HOURLY_WORKFLOWS).toContain('affiliate_offer_reconciliation');
      expect(CONTINUOUS_HOURLY_WORKFLOWS).toContain('daily_market_demand_research');

      // Low-value workflows must NOT be in continuous hourly to prevent cron starvation
      expect(CONTINUOUS_HOURLY_WORKFLOWS).not.toContain('authorized_outreach_dispatch');
      expect(CONTINUOUS_HOURLY_WORKFLOWS).not.toContain('new_inquiry_processing');
      expect(CONTINUOUS_HOURLY_WORKFLOWS).not.toContain('reply_classification_followup');
    });

    it('aligns workflow definitions with 60-minute commercial cadence and 360-minute low-value backoff', () => {
      const affiliateWf = WORKFLOW_DEFINITIONS.find(w => w.id === 'affiliate_offer_reconciliation');
      const demandWf = WORKFLOW_DEFINITIONS.find(w => w.id === 'daily_market_demand_research');
      const outreachWf = WORKFLOW_DEFINITIONS.find(w => w.id === 'authorized_outreach_dispatch');
      const inquiryWf = WORKFLOW_DEFINITIONS.find(w => w.id === 'new_inquiry_processing');
      const replyWf = WORKFLOW_DEFINITIONS.find(w => w.id === 'reply_classification_followup');
      const proposalWf = WORKFLOW_DEFINITIONS.find(w => w.id === 'proposal_prep_followup');

      expect(affiliateWf).toBeDefined();
      expect(affiliateWf?.defaultCadenceMinutes).toBe(60);
      expect(affiliateWf?.priority).toBe(0);

      expect(demandWf).toBeDefined();
      expect(demandWf?.defaultCadenceMinutes).toBe(60);
      expect(demandWf?.priority).toBe(0);

      expect(outreachWf?.defaultCadenceMinutes).toBe(360);
      expect(inquiryWf?.defaultCadenceMinutes).toBe(360);
      expect(replyWf?.defaultCadenceMinutes).toBe(360);
      expect(proposalWf?.defaultCadenceMinutes).toBe(360);
    });

    it('returns affiliate_offer_reconciliation as eligible in every hourly window', () => {
      // Test across morning, afternoon, and evening hours
      const morningTime = new Date('2026-11-10T03:30:00.000Z'); // 09:00 IST
      const afternoonTime = new Date('2026-11-10T08:30:00.000Z'); // 14:00 IST
      const eveningTime = new Date('2026-11-10T15:30:00.000Z'); // 21:00 IST

      const morningEligible = CommercialSchedulePolicy.getEligibleWorkflowIds(morningTime);
      const afternoonEligible = CommercialSchedulePolicy.getEligibleWorkflowIds(afternoonTime);
      const eveningEligible = CommercialSchedulePolicy.getEligibleWorkflowIds(eveningTime);

      expect(morningEligible).toContain('affiliate_offer_reconciliation');
      expect(afternoonEligible).toContain('affiliate_offer_reconciliation');
      expect(eveningEligible).toContain('affiliate_offer_reconciliation');

      expect(morningEligible).toContain('daily_market_demand_research');
      expect(afternoonEligible).toContain('daily_market_demand_research');
      expect(eveningEligible).toContain('daily_market_demand_research');
    });
  });

  describe('2. Autonomous Deal Candidate Reconciliation', () => {
    let dealEngine: AutonomousDealDiscoveryEngine;

    beforeEach(() => {
      dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      const db = getDb();
      db.prepare("DELETE FROM public_deals WHERE id LIKE 'deal_staged_%'").run();
      db.prepare("DELETE FROM workflows WHERE id LIKE 'deal_staged_%'").run();
    });

    it('reconciles unmonetized candidate deals with strict affiliated === true verification', async () => {
      const db = getDb();

      // Seed candidate in public_deals
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, created_at, updated_at
        ) VALUES (
          'deal_staged_test_1',
          'boat-rockerz-430-gen2-test',
          'boat-rockerz-430-gen2-test',
          'boAt Rockerz 430 Gen 2 Wireless Headphones',
          'boAt',
          'boAt Lifestyle',
          'Electronics',
          'ELECTRONICS',
          'https://boat-lifestyle.com/products/boat-rockerz-430-gen-2?variant=50910456053858',
          1199,
          'IN_STOCK',
          'CANDIDATE',
          'PRODUCT',
          0,
          1,
          0,
          datetime('now'),
          datetime('now')
        )
      `).run();

      // Mock Cuelinks client with successful affiliation
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: vi.fn().mockResolvedValue({
          url: 'https://boat-lifestyle.com/products/boat-rockerz-430-gen-2?variant=50910456053858',
          tracking_url: 'https://linksredirect.com/?cid=331585&subid=aro_test&url=https%3A%2F%2Fboat-lifestyle.com',
          short_url: 'https://clnk.in/staged_1',
          affiliated: true,
          campaign: { id: 4232, name: 'boAt Lifestyle' },
          channel_id: 331585
        })
      } as any;

      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);

      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(result.reconciled).toBeGreaterThanOrEqual(1);
      expect(result.failed).toBe(0);

      // Verify row updated in public_deals
      const updated = db.prepare("SELECT * FROM public_deals WHERE id = 'deal_staged_test_1'").get() as any;
      expect(updated.affiliate_verified).toBe(1);
      expect(updated.is_monetizable).toBe(1);
      expect(updated.verification_status).toBe('AFFILIATE_VERIFIED');
      expect(updated.affiliate_url).toBe('https://clnk.in/staged_1');

      const evidence = JSON.parse(updated.evidence_json);
      expect(evidence.cuelinksAffiliated).toBe(true);
      expect(evidence.channelId).toBe(331585);
    });

    it('fails closed when Cuelinks reports affiliated === false', async () => {
      const db = getDb();

      // Seed candidate in public_deals
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, created_at, updated_at
        ) VALUES (
          'deal_staged_test_2',
          'unaffiliated-product-test',
          'unaffiliated-product-test',
          'Unaffiliated Store Product',
          'BrandX',
          'BrandX Store',
          'Electronics',
          'ELECTRONICS',
          'https://brandxstore.com/products/sample-gadget',
          499,
          'IN_STOCK',
          'CANDIDATE',
          'PRODUCT',
          0,
          1,
          0,
          datetime('now'),
          datetime('now')
        )
      `).run();

      // Mock Cuelinks client returning affiliated === false
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: vi.fn().mockResolvedValue({
          url: 'https://brandxstore.com/products/sample-gadget',
          tracking_url: 'https://brandxstore.com/products/sample-gadget',
          short_url: undefined,
          affiliated: false,
          campaign: null,
          channel_id: 331585
        })
      } as any;

      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);

      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(result.reconciled).toBe(0);
      expect(result.failed).toBeGreaterThanOrEqual(1);

      // Verify row updated as unmonetized with recheck cooldown
      const updated = db.prepare("SELECT * FROM public_deals WHERE id = 'deal_staged_test_2'").get() as any;
      expect(updated.affiliate_verified).toBe(0);
      expect(updated.is_monetizable).toBe(0);
      expect(updated.verification_status).toBe('PRODUCT_ONLY_UNMONETIZED');
      expect(updated.affiliate_url).toBeNull();
      expect(updated.next_recheck_at).toBeDefined();

      const evidence = JSON.parse(updated.evidence_json);
      expect(evidence.cuelinksAffiliated).toBe(false);
      expect(evidence.failureReason).toBe('CUELINKS_NOT_AFFILIATED');
    });

    it('rejects candidates that violate SSRF public URL safety rules', async () => {
      const db = getDb();

      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, created_at, updated_at
        ) VALUES (
          'deal_staged_test_3',
          'ssrf-attack-test',
          'ssrf-attack-test',
          'Internal Target URL',
          'Attack',
          'Internal Host',
          'Electronics',
          'ELECTRONICS',
          'http://127.0.0.1:8080/admin/deal',
          100,
          'IN_STOCK',
          'CANDIDATE',
          'PRODUCT',
          0,
          1,
          0,
          datetime('now'),
          datetime('now')
        )
      `).run();

      const convertMock = vi.fn().mockResolvedValue({
        url: 'https://boat-lifestyle.com/products/airdopes-161',
        tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fboat-lifestyle.com',
        short_url: 'https://clnk.in/staged_boat',
        affiliated: true,
        campaign: { id: 4232, name: 'boAt Lifestyle' },
        channel_id: 331585
      });
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: convertMock
      } as any;

      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);

      expect(convertMock).not.toHaveBeenCalledWith(expect.objectContaining({
        url: 'http://127.0.0.1:8080/admin/deal'
      }));
      expect(result.failed).toBeGreaterThanOrEqual(1);

      const updated = db.prepare("SELECT * FROM public_deals WHERE id = 'deal_staged_test_3'").get() as any;
      expect(updated.verification_status).toBe('REJECTED');
      expect(updated.affiliate_verified).toBe(0);
      expect(updated.is_monetizable).toBe(0);
    });

    it('reconciles candidates sourced directly from workflows table when public_deals is unpopulated', async () => {
      const db = getDb();
      // Clear test deals from public_deals
      db.prepare("DELETE FROM public_deals WHERE id = 'deal_staged_test_wf_1'").run();

      // Seed candidate in workflows
      db.prepare(`
        INSERT INTO workflows (
          id, organization_id, business_id, workflow_type, status, current_step,
          last_successful_checkpoint, retry_count, max_retries, inputs_json, outputs_json, error_info, updated_at
        ) VALUES (
          'deal_staged_test_wf_1',
          'org_owner_primary',
          'biz_platform_aro',
          'PUBLIC_DEAL',
          'VERIFIED',
          'Electronics',
          'VERIFICATION',
          0,
          5,
          json(?),
          json('{}'),
          NULL,
          datetime('now')
        )
      `).run(JSON.stringify({
        dealKind: 'PRODUCT',
        title: 'boAt Airdopes Plus 221 Wireless Earbuds',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        productUrl: 'https://boat-lifestyle.com/products/boat-airdopes-plus-221?variant=50900357644386',
        currentPriceINR: 1099,
        availability: 'IN_STOCK',
        productVerified: true,
        modelOrSku: '50900357644386',
        slug: 'boat-airdopes-plus-221-50900357644386'
      }));

      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: vi.fn().mockResolvedValue({
          url: 'https://boat-lifestyle.com/products/boat-airdopes-plus-221?variant=50900357644386',
          tracking_url: 'https://linksredirect.com/?cid=331585&subid=aro_50900357644386&url=https%3A%2F%2Fboat-lifestyle.com',
          short_url: 'https://clnk.in/staged_wf_1',
          affiliated: true,
          campaign: { id: 4232, name: 'boAt Lifestyle' },
          channel_id: 331585
        })
      } as any;

      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);

      expect(result.processed).toBeGreaterThanOrEqual(1);
      expect(result.reconciled).toBeGreaterThanOrEqual(1);

      // Verify deal was created in public_deals with verified status
      const created = db.prepare("SELECT * FROM public_deals WHERE id = 'deal_staged_test_wf_1'").get() as any;
      expect(created).toBeDefined();
      expect(created.affiliate_verified).toBe(1);
      expect(created.is_monetizable).toBe(1);
      expect(created.affiliate_url).toBe('https://clnk.in/staged_wf_1');
    });
  });

  describe('3. Stage E — Conversion Funnel Integrity & Commercial Truth', () => {
    let dealEngine: AutonomousDealDiscoveryEngine;

    beforeEach(() => {
      dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      const db = getDb();
      db.prepare("DELETE FROM public_deals WHERE id LIKE 'deal_stage_e_%'").run();
      db.prepare("DELETE FROM workflows WHERE id LIKE 'deal_stage_e_%'").run();
      db.prepare("DELETE FROM partner_offers WHERE id LIKE 'deal_stage_e_%'").run();
      process.env.CUELINKS_CHANNEL_ID = '331585';
      process.env.PUBLIC_SITE_URL = 'https://ai-marketing-organization.onrender.com';
    });

    it('fails closed when CUELINKS_CHANNEL_ID environment variable is missing', async () => {
      delete process.env.CUELINKS_CHANNEL_ID;
      const convertMock = vi.fn();
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: convertMock
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);
      expect(result.processed).toBe(0);
      expect(result.reconciled).toBe(0);
      expect(result.failed).toBe(0);
      expect(convertMock).not.toHaveBeenCalled();
    });

    it('fails closed when Cuelinks channel resolution returns unapproved channel', async () => {
      process.env.CUELINKS_CHANNEL_ID = '331585';
      const convertMock = vi.fn();
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'pending', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: convertMock
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);
      expect(result.processed).toBe(0);
      expect(result.reconciled).toBe(0);
      expect(result.failed).toBe(0);
      expect(convertMock).not.toHaveBeenCalled();
    });

    it('fails closed when Cuelinks channel ID does not match configured channel', async () => {
      process.env.CUELINKS_CHANNEL_ID = '331585';
      const convertMock = vi.fn();
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 999999, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: convertMock
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);
      expect(result.processed).toBe(0);
      expect(result.reconciled).toBe(0);
      expect(convertMock).not.toHaveBeenCalled();
    });

    it('fails closed when channel lookup throws an unexpected network error', async () => {
      process.env.CUELINKS_CHANNEL_ID = '331585';
      const convertMock = vi.fn();
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockRejectedValue(new Error('Network offline')),
        convertLink: convertMock
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);
      expect(result.processed).toBe(0);
      expect(result.reconciled).toBe(0);
      expect(convertMock).not.toHaveBeenCalled();
    });

    it('provisions matching partner_offers and partners records atomically on successful reconciliation', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, created_at, updated_at
        ) VALUES (
          'deal_stage_e_provision_1',
          'noise-kore-smartwatch-stage-e',
          'noise-kore-smartwatch-stage-e',
          'Noise Kore Smartwatch',
          'Noise',
          'Noise India',
          'Electronics',
          'ELECTRONICS',
          'https://gonoise.com/products/noise-kore',
          1299,
          'IN_STOCK',
          'CANDIDATE',
          'PRODUCT',
          0,
          1,
          0,
          datetime('now'),
          datetime('now')
        )
      `).run();

      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: vi.fn().mockResolvedValue({
          url: 'https://gonoise.com/products/noise-kore',
          tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fgonoise.com',
          short_url: 'https://clnk.in/stage_e_noise',
          affiliated: true,
          campaign: { id: 7788, name: 'Noise' },
          channel_id: 331585
        })
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);
      expect(result.reconciled).toBeGreaterThanOrEqual(1);

      // Verify matching partner_offers row exists and is ACTIVE
      const offer = db.prepare("SELECT * FROM partner_offers WHERE id = 'deal_stage_e_provision_1'").get() as any;
      expect(offer).toBeDefined();
      expect(offer.partner_id).toBe('part_cuelinks');
      expect(offer.active).toBe(1);
      expect(offer.status).toBe('ACTIVE');
      expect(offer.authorized_tracking_url).toBe('https://clnk.in/stage_e_noise');

      // Verify part_cuelinks in partners is AUTHORIZED and APPROVED
      const partner = db.prepare("SELECT * FROM partners WHERE id = 'part_cuelinks'").get() as any;
      expect(partner).toBeDefined();
      expect(partner.authorization_status).toBe('AUTHORIZED');
      expect(partner.approval_status).toBe('APPROVED');
      expect(partner.active_status).toBe(1);
    });

    it('preserves valid affiliate tracking URL when transient error occurs for already-verified deal', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, affiliate_url, created_at, updated_at
        ) VALUES (
          'deal_stage_e_transient_1',
          'boat-airdopes-transient-test',
          'boat-airdopes-transient-test',
          'boAt Airdopes Transient Earbuds',
          'boAt',
          'boAt Lifestyle',
          'Electronics',
          'ELECTRONICS',
          'https://boat-lifestyle.com/products/airdopes-transient',
          1099,
          'IN_STOCK',
          'AFFILIATE_VERIFIED',
          'PRODUCT',
          0,
          1,
          1,
          'https://clnk.in/transient_keep_me',
          datetime('now'),
          datetime('now')
        )
      `).run();

      // Transient failure from provider: affiliated === false
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: vi.fn().mockResolvedValue({
          url: 'https://boat-lifestyle.com/products/airdopes-transient',
          tracking_url: 'https://boat-lifestyle.com/products/airdopes-transient',
          affiliated: false,
          campaign: null,
          channel_id: 331585
        })
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      const result = await dealEngine.reconcileExistingDealCandidates(5);
      expect(result.reconciled).toBeGreaterThanOrEqual(1);

      // Verify the valid tracking URL was NOT deleted
      const deal = db.prepare("SELECT * FROM public_deals WHERE id = 'deal_stage_e_transient_1'").get() as any;
      expect(deal.affiliate_url).toBe('https://clnk.in/transient_keep_me');
      expect(deal.affiliate_verified).toBe(1);
    });

    it('does not coerce productVerified to true when reconciling deal candidate', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, created_at, updated_at
        ) VALUES (
          'deal_stage_e_no_coerce_1',
          'sample-gadget-test',
          'sample-gadget-test',
          'Sample Gadget',
          'GadgetBrand',
          'GadgetStore',
          'Electronics',
          'ELECTRONICS',
          'https://gadgetstore.com/products/sample',
          999,
          'IN_STOCK',
          'CANDIDATE',
          'PRODUCT',
          0,
          1,
          0,
          datetime('now'),
          datetime('now')
        )
      `).run();

      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: vi.fn().mockResolvedValue({
          url: 'https://gadgetstore.com/products/sample',
          tracking_url: 'https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fgadgetstore.com',
          short_url: 'https://clnk.in/stage_e_gadget',
          affiliated: true,
          campaign: { id: 101, name: 'GadgetStore' },
          channel_id: 331585
        })
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      await dealEngine.reconcileExistingDealCandidates(5);

      const deal = db.prepare("SELECT * FROM public_deals WHERE id = 'deal_stage_e_no_coerce_1'").get() as any;
      expect(deal.affiliate_verified).toBe(1);
      expect(deal.verification_status).toBe('AFFILIATE_VERIFIED');
    });

    it('filters out candidates where product_verified = 0 or availability is OUT_OF_STOCK', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, current_price_inr, availability, verification_status,
          deal_kind, is_monetizable, product_verified, affiliate_verified, created_at, updated_at
        ) VALUES (
          'deal_stage_e_unverified_product',
          'unverified-product',
          'unverified-product',
          'Unverified Product',
          'Unverified',
          'Store',
          'Electronics',
          'ELECTRONICS',
          'https://store.com/products/unverified',
          999,
          'IN_STOCK',
          'UNCONFIRMED',
          'PRODUCT',
          0,
          0,
          0,
          datetime('now'),
          datetime('now')
        )
      `).run();

      const convertMock = vi.fn();
      const mockClient = {
        isConfigured: () => true,
        getChannels: vi.fn().mockResolvedValue([
          { id: 331585, status: 'approved', url: 'https://ai-marketing-organization.onrender.com' }
        ]),
        convertLink: convertMock
      } as any;
      dealEngine.setCuelinksClient(mockClient);

      await dealEngine.reconcileExistingDealCandidates(5);
      expect(convertMock).not.toHaveBeenCalledWith(expect.objectContaining({
        url: 'https://store.com/products/unverified'
      }));
    });

    it('organic distribution generates buyingGuideUrl with query parameter /deals?dealId=...', async () => {
      const { OrganicDistributionEngine } = await import('../../src/commission/organic-distribution-engine.js');
      const organic = OrganicDistributionEngine.getInstance();
      const pkg = organic.generateDistributionPackage({
        dealId: 'deal_test_boat_430',
        sku: 'boat-rockerz-430',
        title: 'boAt Rockerz 430 Gen 2',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        currentPriceINR: 1199,
        referencePriceINR: 3990,
        discountPercent: 70,
        currency: 'INR',
        authorizedTrackingUrl: 'https://clnk.in/D8C9',
        buyerValueScore: 85
      });

      expect(pkg.buyingGuideUrl).toBe('https://ai-marketing-organization.onrender.com/deals?dealId=deal_test_boat_430');
      expect(pkg.shareKit[0].canonicalUrl).toBe('https://ai-marketing-organization.onrender.com/api/v1/public/deals/deal_test_boat_430/redirect?placement=organic_guide');
    });

    it('has BASELINE_ELECTRONICS_BUYING_GUIDE defined for boAt and Noise inventory', async () => {
      const { BASELINE_ELECTRONICS_BUYING_GUIDE } = await import('../../src/db/seed.js');
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE).toBeDefined();
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE.id).toBe('guide_electronics_audio_wearables_2026');
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE.slug).toBe('best-wireless-audio-smartwatches-india');
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE.category).toBe('Electronics');
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE.contentMarkdown).toContain('boAt Rockerz 430 Gen 2');
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE.contentMarkdown).toContain('Noise Kore Smartwatch');
      expect(BASELINE_ELECTRONICS_BUYING_GUIDE.disclosureMarkdown).toContain('Affiliate & Commercial Disclosure');
    });
  });
});
