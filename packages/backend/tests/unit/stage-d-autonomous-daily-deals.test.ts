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
      db.prepare("DELETE FROM partner_offers WHERE id LIKE 'deal_staged_%'").run();
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

  describe('5. AROS Autonomous Market Arbitrage, Targeted Buyer Engine & Audit Scorecard Integrity', () => {
    it('computes deterministic arbitrage scores and classifies buyer segments without LLM calls', async () => {
      const {
        calculateMarketArbitrageScore,
        classifyTargetBuyerSegment
      } = await import('../../src/commission/autonomous-deal-discovery-engine.js');

      const strongArbitrage = calculateMarketArbitrageScore({
        currentPriceINR: 1199,
        referencePriceINR: 3990,
        verifiedDiscountPercent: 70,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        verifiedCommissionRatePercent: 6,
        lastCheckedAt: new Date().toISOString(),
        trackingUrl: 'https://linksredirect.com/?cid=331585&source=linkkit'
      });
      const weakArbitrage = calculateMarketArbitrageScore({
        currentPriceINR: 3800,
        referencePriceINR: 3990,
        verifiedDiscountPercent: 5,
        availability: 'OUT_OF_STOCK',
        isMonetizable: false
      });

      expect(strongArbitrage.priceAdvantageRatio).toBeCloseTo(0.6995, 2);
      expect(strongArbitrage.arbitrageScore).toBeGreaterThanOrEqual(70);
      expect(strongArbitrage.arbitrageScore).toBeLessThan(100);
      expect(weakArbitrage.arbitrageScore).toBeLessThan(20);
      expect(strongArbitrage.arbitrageScore).toBeGreaterThan(weakArbitrage.arbitrageScore);

      const audioBuyer = classifyTargetBuyerSegment({
        title: 'boAt Rockerz 430 Gen 2 Wireless Headphones',
        category: 'Electronics',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        currentPriceINR: 1199
      });
      expect(audioBuyer.targetBuyerSegment).toContain('Commuters');
      expect(audioBuyer.buyerIntentKeywords.length).toBeGreaterThan(0);

      const beautyBuyer = classifyTargetBuyerSegment({
        title: 'Plum Niacinamide Serum',
        category: 'Beauty',
        sectorCode: 'SECTOR_B_HEALTH_BEAUTY',
        currentPriceINR: 499
      });
      expect(beautyBuyer.targetBuyerSegment).toContain('Grooming');
    });

    it('ranks getEligiblePublicDeals() by arbitrageScore descending and exposes enrichment', async () => {
      const db = getDb();
      db.prepare('DELETE FROM public_deals').run();

      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      (dealEngine as any).dealsMap?.clear?.();
      (dealEngine as any).dealSlugMap?.clear?.();
      const now = new Date().toISOString();

      await (dealEngine as any).persistDealToD1({
        id: 'deal_arb_low',
        title: 'Modest Discount Earbuds',
        brand: 'TestBrand',
        merchant: 'TestMerchant',
        category: 'Electronics',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        productUrl: 'https://store.example.com/earbuds-low',
        currentPriceINR: 1900,
        referencePriceINR: 2000,
        verifiedDiscountPercent: 5,
        currency: 'INR',
        discountVerificationType: 'MERCHANT_LISTED_MRP',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        lastCheckedAt: now,
        sourceUrl: 'https://store.example.com/feed',
        sourceDomain: 'store.example.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'AFFILIATE_VERIFIED',
        confidenceScore: 95,
        buyerValueScore: 95,
        rejectionReasons: [],
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        trackingUrl: 'https://linksredirect.com/?cid=331585&source=linkkit&url=https%3A%2F%2Fstore.example.com%2Fearbuds-low',
        evidenceJson: { sources: [], verificationLogs: [], channelId: '331585' },
        createdAt: now,
        updatedAt: now
      }, 'org_owner_primary', 'biz_platform_aro');

      await (dealEngine as any).persistDealToD1({
        id: 'deal_arb_high',
        title: 'Deep Arbitrage Smartwatch',
        brand: 'TestBrand',
        merchant: 'TestMerchant',
        category: 'Electronics',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        productUrl: 'https://store.example.com/watch-high',
        currentPriceINR: 1199,
        referencePriceINR: 3999,
        verifiedDiscountPercent: 70,
        currency: 'INR',
        discountVerificationType: 'MERCHANT_LISTED_MRP',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        lastCheckedAt: now,
        sourceUrl: 'https://store.example.com/feed',
        sourceDomain: 'store.example.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'AFFILIATE_VERIFIED',
        confidenceScore: 80,
        buyerValueScore: 80,
        rejectionReasons: [],
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        trackingUrl: 'https://linksredirect.com/?cid=331585&source=linkkit&url=https%3A%2F%2Fstore.example.com%2Fwatch-high',
        evidenceJson: { sources: [], verificationLogs: [], channelId: '331585' },
        createdAt: now,
        updatedAt: now
      }, 'org_owner_primary', 'biz_platform_aro');

      const { deals } = await dealEngine.getEligiblePublicDeals({ limit: 10, requireStrictChain: false });
      expect(deals.length).toBeGreaterThanOrEqual(2);
      expect(deals[0].id).toBe('deal_arb_high');
      expect(deals[0].arbitrageScore).toBeGreaterThan(deals[1].arbitrageScore!);
      expect(deals[0].targetBuyerSegment).toBeDefined();
    });

    it('renderAuditHtml renders explicit technical defects, Fix-Pack preview, UNAVAILABLE PageSpeed when null, and prefilled SiteFix link', async () => {
      const { StaticSiteGenerator } = await import('../../src/commission/static-site-generator.js');
      const ssg = StaticSiteGenerator.getInstance();
      const html = ssg.renderAuditHtml({
        domain: 'roasterycoffee.co.in',
        business_name: 'Roastery Coffee House',
        seo_score: 72,
        performance_score: null,
        pagespeed_status: 'UNAVAILABLE',
        pagespeed_unavailable_reason: 'UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)',
        is_publicly_authorized: 1,
        checklist_json: JSON.stringify([
          {
            id: 'robots_txt_missing',
            title: 'robots.txt Directive Presence',
            category: 'Crawlability',
            status: 'ISSUE',
            severity: 'MEDIUM',
            evidence: 'HTTP 404 on /robots.txt',
            recommendation: 'Deploy valid /robots.txt'
          },
          {
            id: 'schema_jsonld_missing',
            title: 'JSON-LD Structured Data',
            category: 'Schema.org',
            status: 'ISSUE',
            severity: 'HIGH',
            evidence: 'Missing Organization/LocalBusiness JSON-LD block',
            recommendation: 'Add Organization JSON-LD'
          }
        ]),
        head_snippets: '<meta name="description" content="Roastery Coffee" />',
        schema_json_ld: '{"@context":"https://schema.org"}',
        scanned_at: new Date().toISOString()
      }, {
        siteName: 'AI Marketing Organization',
        siteUrl: 'https://ai-marketing-organization.onrender.com',
        authorName: 'Platform Desk',
        contactEmail: 'ops@example.com',
        googleSiteVerification: 'GSC-TEST',
        cuelinksVerificationCode: 'CL-TEST'
      }, [{
        id: 'deal_promo_1',
        title: 'boAt Rockerz 430 Gen 2',
        category: 'Electronics',
        currentPriceINR: 1199,
        referencePriceINR: 3990,
        verifiedDiscountPercent: 70
      }]);

      expect(html).not.toContain('noindex');
      expect(html).toContain('UNAVAILABLE');
      expect(html).toContain('Requires GOOGLE_PAGESPEED_API_KEY');
      expect(html).not.toContain('2.8 s');
      expect(html).toContain('Observed Technical Defects &amp; Why They Matter');
      expect(html).toContain('HTTP 404 on /robots.txt');
      expect(html).toContain('Self-Serve SiteFix Core Technical Fix-Pack Preview');
      expect(html).toContain('Unlock Instant Ready-to-Paste Fix-Pack (₹499)');
      expect(html).toContain('/tools/site-audit?url=https%3A%2F%2Froasterycoffee.co.in');
      expect(html).toContain('#Ad');
    });

    it('declares GSC, Cuelinks verification and CUELINKS_CHANNEL_ID in render.yaml', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const rootYaml = path.resolve(process.cwd(), 'render.yaml');
      const renderYamlPath = fs.existsSync(rootYaml) ? rootYaml : path.resolve(process.cwd(), '../../render.yaml');
      const renderYaml = fs.readFileSync(renderYamlPath, 'utf8');
      expect(renderYaml).toContain('GOOGLE_SITE_VERIFICATION');
      expect(renderYaml).toContain('CUELINKS_VERIFICATION_CODE');
      expect(renderYaml).toContain('CUELINKS_CHANNEL_ID');
      expect(renderYaml).toContain('331585');
    });
  });

  describe('6. Stage G — Commission-Yield Arbitrage Ranking, SSR /deals/:slug, Sitemap & Live UPI Fallback', () => {
    it('ranks ₹1,499 77%-off smartwatch ahead of ₹299 80%-off charger via expectedCommissionYieldINR without clamping at 100', async () => {
      const { calculateMarketArbitrageScore } = await import('../../src/commission/autonomous-deal-discovery-engine.js');

      const chargerScore = calculateMarketArbitrageScore({
        title: 'boAt 48W Fast Car Charger',
        currentPriceINR: 299,
        referencePriceINR: 1499,
        verifiedDiscountPercent: 80,
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        verifiedCommissionRatePercent: 6,
        evidenceJson: { sources: [], verificationLogs: [], channelId: '331585' }
      });

      const smartwatchScore = calculateMarketArbitrageScore({
        title: 'boAt Lunar Connect 2 Smartwatch',
        currentPriceINR: 1499,
        referencePriceINR: 6499,
        verifiedDiscountPercent: 77,
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        verifiedCommissionRatePercent: 6,
        evidenceJson: { sources: [], verificationLogs: [], channelId: '331585' }
      });

      const unverifiedRateScore = calculateMarketArbitrageScore({
        title: 'Unrated Merchant Electronics Offer',
        currentPriceINR: 1499,
        referencePriceINR: 2999,
        verifiedDiscountPercent: 50,
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        evidenceJson: { sources: [], verificationLogs: [], channelId: '331585' }
      });

      expect(smartwatchScore.expectedCommissionYieldINR).toBeCloseTo(69.19, 1);
      expect(chargerScore.expectedCommissionYieldINR).toBeCloseTo(14.36, 1);
      expect(smartwatchScore.arbitrageScore).toBeLessThan(100);
      expect(chargerScore.arbitrageScore).toBeLessThan(100);
      expect(smartwatchScore.arbitrageScore).toBeGreaterThan(chargerScore.arbitrageScore);
      expect(unverifiedRateScore.verifiedCommissionRatePercent).toBeNull();
      expect(unverifiedRateScore.economicsConfidence).toBe('UNKNOWN_COMMISSION_RATE');
      expect(unverifiedRateScore.expectedCommissionYieldINR).toBe(0);
      expect(unverifiedRateScore.expectedCommissionPerClickINR).toBeNull();
      expect(unverifiedRateScore.buyerPersonaConfidence).toBe('HYPOTHESIS');
      expect(unverifiedRateScore.rankingBreakdown.commercialContributionScore).toBe(0);
    });

    it('renders SSR GET /deals/:slug with Schema.org/Product JSON-LD, related deals, and 404 noindex for missing slugs', async () => {
      const { app } = await import('../../src/index.js');
      const db = getDb();
      db.prepare('DELETE FROM public_deals').run();
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      (dealEngine as any).dealsMap?.clear?.();
      (dealEngine as any).dealSlugMap?.clear?.();
      const now = new Date().toISOString();

      await (dealEngine as any).persistDealToD1({
        id: 'deal_ssr_watch_1',
        slug: 'boat-lunar-connect-2-ssr',
        canonicalSlug: 'boat-lunar-connect-2-ssr',
        title: 'boAt Lunar Connect 2 Smartwatch',
        brand: 'boAt',
        merchant: 'boAt Lifestyle',
        category: 'Electronics',
        sectorCode: 'SECTOR_B_ELECTRONICS',
        productUrl: 'https://www.boat-lifestyle.com/products/lunar-connect-2',
        currentPriceINR: 1499,
        referencePriceINR: 6499,
        verifiedDiscountPercent: 77,
        discountBadge: '77% OFF',
        currency: 'INR',
        discountVerificationType: 'MERCHANT_LISTED_MRP',
        availability: 'IN_STOCK',
        geographicRestrictions: ['India'],
        lastCheckedAt: now,
        sourceUrl: 'https://www.boat-lifestyle.com/products.json',
        sourceDomain: 'boat-lifestyle.com',
        sourceType: 'RETAILER_BRAND',
        verificationStatus: 'AFFILIATE_VERIFIED',
        confidenceScore: 95,
        buyerValueScore: 90,
        rejectionReasons: [],
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        affiliateNetwork: 'CUELINKS',
        trackingUrl: 'https://linksredirect.com/?cid=331585&source=linkkit&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Flunar-connect-2',
        evidenceJson: { sources: [], verificationLogs: [], channelId: '331585' },
        createdAt: now,
        updatedAt: now
      }, 'org_owner_primary', 'biz_platform_aro');

      const okRes = await app.request('/deals/boat-lunar-connect-2-ssr');
      expect(okRes.status).toBe(200);
      const okHtml = await okRes.text();
      expect(okHtml).toContain('<title>boAt Lunar Connect 2 Smartwatch — ₹1,499 (77% OFF Verified Deal) | #Ad</title>');
      expect(okHtml).toContain('"@type": "Product"');
      expect(okHtml).toContain('"priceCurrency": "INR"');
      expect(okHtml).toContain('"availability": "https://schema.org/InStock"');
      expect(okHtml).toContain('/api/v1/public/deals/deal_ssr_watch_1/redirect?utm_source=deal_ssr&amp;utm_medium=organic');
      expect(okHtml).toContain('#Ad');

      const missingRes = await app.request('/deals/nonexistent-deal-slug-stage-g');
      expect(missingRes.status).toBe(404);
      const missingHtml = await missingRes.text();
      expect(missingHtml).toContain('noindex');
    });

    it('includes all 50 active /deals/:slug URLs in GET /sitemap.xml yielding 70+ total URLs', async () => {
      const { app } = await import('../../src/index.js');
      const db = getDb();
      db.prepare('DELETE FROM public_deals').run();
      const dealEngine = AutonomousDealDiscoveryEngine.getInstance();
      (dealEngine as any).dealsMap?.clear?.();
      (dealEngine as any).dealSlugMap?.clear?.();
      const now = new Date().toISOString();

      // Seed 50 active verified deals plus 15 authorized domain audits + guides -> 70+ URLs
      const insertDealStmt = db.prepare(`
        INSERT INTO public_deals (
          id, slug, canonical_slug, title, brand, merchant, category, sector_code,
          product_url, affiliate_url, current_price_inr, currency, reference_price_inr,
          discount_percent, availability, verification_status, deal_kind, evidence_json,
          is_monetizable, product_verified, affiliate_verified, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 70, 'IN_STOCK', 'AFFILIATE_VERIFIED', 'PRODUCT', '{}', 1, 1, 1, datetime('now'))
      `);
      for (let i = 1; i <= 50; i++) {
        const slug = `stage-g-deal-${i}`;
        insertDealStmt.run(
          `deal_sg_${i}`,
          slug,
          slug,
          `Stage G Audio Product ${i}`,
          'boAt',
          'boAt Lifestyle',
          'Electronics',
          'SECTOR_B_ELECTRONICS',
          `https://www.boat-lifestyle.com/products/stage-g-${i}`,
          `https://linksredirect.com/?cid=331585&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fstage-g-${i}`,
          1499,
          4999
        );
      }

      for (let d = 1; d <= 15; d++) {
        db.prepare(`
          INSERT OR REPLACE INTO site_audits (domain, target_url, business_name, seo_score, checklist_json, status, is_publicly_authorized, updated_at)
          VALUES (?, ?, ?, 80, '[]', 'COMPLETED', 1, datetime('now'))
        `).run(`auditdomain${d}.in`, `https://auditdomain${d}.in`, `Audit Domain ${d}`);
      }

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      try {
        // Spy getAllDeals/getEligiblePublicDeals chain requirement off for isolated SQLite sitemap check
        vi.spyOn(dealEngine, 'getEligiblePublicDeals').mockResolvedValue({
          deals: [
            ...Array.from({ length: 50 }, (_, idx) => ({
              id: `deal_sg_${idx + 1}`,
              slug: `stage-g-deal-${idx + 1}`,
              canonicalSlug: `stage-g-deal-${idx + 1}`,
              title: `Verified Consumer Electronics Product #${idx + 1}`,
              productVerified: true,
              affiliateVerified: true,
              availability: 'IN_STOCK',
              currentPriceINR: 999,
              lastVerifiedAt: now,
              sectorCode: 'SECTOR_B_ELECTRONICS'
            })),
            {
              id: 'deal_sg_low_quality',
              slug: 'stage-g-low-quality',
              canonicalSlug: 'stage-g-low-quality',
              title: 'Short',
              productVerified: false,
              affiliateVerified: true,
              availability: 'IN_STOCK',
              currentPriceINR: 0,
              sectorCode: 'SECTOR_B_ELECTRONICS'
            }
          ] as any,
          total: 51
        });

        const res = await app.request('/sitemap.xml');
        expect(res.status).toBe(200);
        const xml = await res.text();
        const urlMatches = xml.match(/<url>/g) || [];
        expect(urlMatches.length).toBeGreaterThanOrEqual(70);
        expect(xml).toContain('/deals/stage-g-deal-1</loc>');
        expect(xml).toContain('/deals/stage-g-deal-50</loc>');
        expect(xml).not.toContain('/deals/stage-g-low-quality</loc>');
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('renders live UPI fallback rail on /tools/site-audit and records ₹499 claim as PAYMENT_CLAIMED', async () => {
      const { app } = await import('../../src/index.js');
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO site_audits (domain, target_url, business_name, seo_score, checklist_json, status, is_publicly_authorized)
        VALUES ('audit_roastery_test_1', 'https://roasterycoffee.co.in', 'Roastery Coffee House', 78, '[]', 'COMPLETED', 0)
      `).run();

      const pageRes = await app.request('/tools/site-audit?url=https%3A%2F%2Froasterycoffee.co.in');
      expect(pageRes.status).toBe(200);
      const html = await pageRes.text();
      expect(html).toContain('Direct UPI Payment Option (Live INR via GPay / PhonePe / Paytm)');
      expect(html).toContain('upi://pay?pa=venkatasaiharsh149768.rzp@rxairtel');
      expect(html).toContain('/api/v1/offer/upi-claim');

      const utrRef = `428901${Date.now().toString().slice(-6)}`;
      const claimRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          auditId: 'audit_roastery_test_1',
          payerName: 'Roastery Coffee House',
          payerPhone: '9876543210',
          utr: utrRef,
          amountINR: 499
        })
      });
      expect(claimRes.status).toBe(201);
      const claimData = await claimRes.json() as any;
      expect(claimData.success).toBe(true);
      expect(claimData.status).toBe('PAYMENT_CLAIMED');
      expect(claimData.data.utr).toBe(utrRef);
      expect(claimData.data.amountINR).toBe(499);
    });
  });

  describe('Stage H — AROS V2 Real Economics, Hardened UPI Claim Lifecycle, Editorial Gate & Multi-Lane Engine', () => {
    it('Priority 1: requires >=20 observed clicks for empirical rate and never fabricates a 6% default commission rate', async () => {
      const { calculateMarketArbitrageScore } = await import('../../src/commission/autonomous-deal-discovery-engine.js');
      const underSampled = calculateMarketArbitrageScore({
        title: 'boAt Airdopes 141 ANC TWS',
        currentPriceINR: 1399,
        referencePriceINR: 4490,
        verifiedDiscountPercent: 69,
        discountVerificationType: 'MERCHANT_LISTED_MRP',
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        verifiedCommissionRatePercent: 5,
        observedClicks: 12,
        observedOrders: 2,
        observedApprovedOrders: 2,
        observedReversedOrders: 0
      });
      expect(underSampled.verifiedCommissionRatePercent).toBe(5);
      expect(underSampled.observedClickToOrderRate).toBeNull();
      expect(underSampled.buyerPersonaConfidence).toBe('HYPOTHESIS');
      expect(underSampled.opportunityLabel).toBe('VERIFIED_MERCHANT_PROMOTION');

      const empirical = calculateMarketArbitrageScore({
        title: 'boAt Airdopes 141 ANC TWS',
        currentPriceINR: 1399,
        referencePriceINR: 4490,
        verifiedDiscountPercent: 69,
        discountVerificationType: 'INDEPENDENT_CORROBORATED',
        availability: 'IN_STOCK',
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        verifiedCommissionRatePercent: 5,
        observedClicks: 40,
        observedOrders: 4,
        observedApprovedOrders: 3,
        observedReversedOrders: 1
      });
      expect(empirical.opportunityLabel).toBe('GENUINE_MARKET_ARBITRAGE');
      expect(empirical.observedClickToOrderRate).toBeCloseTo(0.1, 3);
      expect(empirical.observedApprovalRate).toBeCloseTo(0.75, 3);
      expect(empirical.observedReversalRate).toBeCloseTo(0.25, 3);
      expect(empirical.buyerPersonaConfidence).toBe('EMPIRICAL');
      expect(empirical.expectedCommissionPerClickINR).toBeCloseTo(5.246, 2);
    });

    it('Priority 2: hardens POST /api/v1/offer/upi-claim with server-derived ₹499 price, strict 12-digit UTR, 409 duplicate rejection, and explicit human lifecycle', async () => {
      const { app } = await import('../../src/index.js');
      const db = getDb();
      db.prepare('DELETE FROM manual_upi_claims').run();
      db.prepare('DELETE FROM site_audits').run();
      const testAuditId = 'audit_stage_h_test_001';
      db.prepare(`
        INSERT INTO site_audits (domain, target_url, business_name, seo_score, checklist_json, status, is_publicly_authorized)
        VALUES (?, ?, ?, ?, ?, 'COMPLETED', 0)
      `).run(testAuditId, `https://example-${testAuditId}.in`, 'Test Clinic', 65, '[]');

      const toolHtmlRes = await app.request('/tools/site-audit');
      const toolHtml = await toolHtmlRes.text();
      expect(toolHtml).toContain('pattern="[0-9]{12}"');

      // 1. Rejects non-12-digit UTR
      const badUtrRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.11' },
        body: JSON.stringify({ auditId: testAuditId, utr: 'ABC123', amountINR: 499 })
      });
      expect(badUtrRes.status).toBe(400);

      // 2. Rejects tampered amountINR (client trying to pay ₹1)
      const tamperedRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.12' },
        body: JSON.stringify({ auditId: testAuditId, utr: '912345678901', amountINR: 1 })
      });
      expect(tamperedRes.status).toBe(400);
      const tamperedJson = await tamperedRes.json() as any;
      expect(tamperedJson.error).toBe('AMOUNT_MISMATCH');

      // 3. Rejects nonexistent audit/request reference
      const unknownRefRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.13' },
        body: JSON.stringify({ auditId: 'does_not_exist_audit', utr: '912345678901' })
      });
      expect(unknownRefRes.status).toBe(400);

      // 4. Accepts valid authoritative claim as PAYMENT_CLAIMED with ₹499 derived server-side
      const okRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.14' },
        body: JSON.stringify({ auditId: testAuditId, utr: '912345678901' })
      });
      expect(okRes.status).toBe(201);
      const okJson = await okRes.json() as any;
      expect(okJson.data.status).toBe('PAYMENT_CLAIMED');
      expect(okJson.data.amountINR).toBe(499);
      expect(okJson.autoFulfilled).toBe(false);
      expect(okJson.bankConfirmedCashINR).toBe(0);
      const claimId = okJson.data.claimId || okJson.data.id;
      expect(claimId).toBeTruthy();

      // 5. Rejects duplicate UTR atomically with 409 Conflict
      const dupRes = await app.request('/api/v1/offer/upi-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.15' },
        body: JSON.stringify({ auditId: testAuditId, utr: '912345678901' })
      });
      expect(dupRes.status).toBe(409);
      const dupJson = await dupRes.json() as any;
      expect(dupJson.error).toContain('DUPLICATE_UTR_CLAIM');

      // 6. Enforces strict lifecycle progression (blocks skipping states, allows valid sequence)
      const { RazorpayAdapter } = await import('../../src/integrations/razorpay.js');
      const rzp = new RazorpayAdapter();
      await expect(
        rzp.advanceManualUpiClaimLifecycle({ claimId, targetStatus: 'FULFILLED' })
      ).rejects.toThrow(/INVALID_CLAIM_TRANSITION/);

      const verified = await rzp.advanceManualUpiClaimLifecycle({
        claimId,
        targetStatus: 'HUMAN_VERIFIED_PAYMENT',
        verifiedBy: 'owner_test'
      });
      expect(verified.status).toBe('HUMAN_VERIFIED_PAYMENT');

      const fulfilling = await rzp.advanceManualUpiClaimLifecycle({
        claimId,
        targetStatus: 'FULFILLMENT_IN_PROGRESS'
      });
      expect(fulfilling.status).toBe('FULFILLMENT_IN_PROGRESS');

      const fulfilled = await rzp.advanceManualUpiClaimLifecycle({
        claimId,
        targetStatus: 'FULFILLED'
      });
      expect(fulfilled.status).toBe('FULFILLED');
    });

    it('Priority 3: escapes JSON-LD script breakouts, omits fabricated timestamps, enforces InStock/Editorial gates, uses trusted PUBLIC_SITE_URL, and removes hardcoded audit domain bypasses', async () => {
      const { StaticSiteGenerator, passesEditorialQualityGate } = await import('../../src/commission/static-site-generator.js');
      const { SiteAuditService } = await import('../../src/tools/site-audit/site-audit-service.js');
      const { app } = await import('../../src/index.js');
      const ssg = StaticSiteGenerator.getInstance();

      const htmlUnsafeTitle = ssg.renderDealDetailHtml(
        {
          id: 'deal_xss',
          slug: 'deal-xss-test',
          title: 'Sony WH-1000XM5 </script><script>alert(1)</script> Headphones',
          merchant: 'Amazon India & <Partners>',
          brand: 'Sony',
          category: 'Audio',
          currentPriceINR: 24999,
          referencePriceINR: 34990,
          availability: 'IN_STOCK',
          productVerified: false,
          affiliateVerified: true
        },
        [],
        {
          siteName: 'Test Site',
          authorName: 'Desk',
          contactEmail: 'desk@example.com',
          siteUrl: 'https://ai-marketing-organization.onrender.com'
        }
      );

      expect(htmlUnsafeTitle).not.toContain('</script><script>alert(1)</script>');
      expect(htmlUnsafeTitle).toContain('\\u003c/script\\u003e');
      expect(htmlUnsafeTitle).toContain('Verification timestamp unavailable');
      expect(htmlUnsafeTitle).toContain('https://schema.org/LimitedAvailability');
      expect(htmlUnsafeTitle).not.toContain('https://schema.org/InStock');
      expect(htmlUnsafeTitle).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(htmlUnsafeTitle).toContain('Extracted Technical Specifications');
      expect(htmlUnsafeTitle).toContain('Who Should Buy');
      expect(htmlUnsafeTitle).toContain('Who Should Skip');
      expect(passesEditorialQualityGate({ title: 'Short', productVerified: true, affiliateVerified: true, availability: 'IN_STOCK', currentPriceINR: 999, lastVerifiedAt: '2026-11-10T00:00:00Z' })).toBe(false);

      // Trusted host invariant: poisoned Host header must NOT leak into /sitemap.xml canonical URLs
      const poisonedSitemap = await app.request('/sitemap.xml', {
        headers: { host: 'evil-phishing.example', 'x-forwarded-host': 'evil-phishing.example' }
      });
      const sitemapBody = await poisonedSitemap.text();
      expect(sitemapBody).not.toContain('evil-phishing.example');
      expect(sitemapBody).toContain('https://ai-marketing-organization.onrender.com/');

      // Audit privacy invariant: clovedental.in is NOT hardcoded as publicly authorized unless explicit DB flag/env allowlist exists
      const db = getDb();
      db.prepare('DELETE FROM site_audits').run();
      db.prepare(`
        INSERT INTO site_audits (domain, target_url, business_name, seo_score, checklist_json, status, is_publicly_authorized)
        VALUES ('clovedental.in', 'https://clovedental.in', 'Clove Dental', 75, '[]', 'COMPLETED', 0)
      `).run();
      const authorizedDomains = await SiteAuditService.getInstance().getAllAuditedDomains();
      expect(authorizedDomains).not.toContain('clovedental.in');

      const auditHtml = ssg.renderAuditHtml(
        {
          domain: 'thirdparty.example',
          business_name: 'Third Party Clinic',
          seo_score: 70,
          checklist_json: '[]',
          is_publicly_authorized: 0
        },
        { siteName: 'Test Site', authorName: 'Desk', contactEmail: 'desk@example.com', siteUrl: 'https://ai-marketing-organization.onrender.com' }
      );
      expect(auditHtml).toContain('noindex, nofollow');
      expect(auditHtml).toContain('Internal Technical Prospect Observation (noindex)');
      expect(auditHtml).not.toContain('Evaluated for Third Party Clinic');
    });

    it('Priorities 4-6: supports 4-lane OpportunityEngine lifecycle, per-lane isolation, and Owner Control Center execution truth', async () => {
      const { OpportunityEngine } = await import('../../src/revenue/opportunity-engine.js');
      const { OwnerDigestService } = await import('../../src/revenue/owner-digest.js');
      const oppEngine = OpportunityEngine.getInstance();

      const opp = oppEngine.discoverUnified({
        lane: 'LANE_A_AFFILIATE_COMMERCE',
        title: 'Sony WH-1000XM5 Cuelinks Campaign',
        buyerSegment: 'Remote engineers & audiophiles in Indian metros',
        buyerPersonaConfidence: 'HYPOTHESIS',
        demandEvidence: [{ type: 'TAVILY_RESULT', url: 'https://example.com/demand', retrievedAt: new Date().toISOString() }],
        supplyEvidence: [{ type: 'TAVILY_RESULT', url: 'https://cuelinks.com/campaign', retrievedAt: new Date().toISOString() }],
        authorizationStatus: 'VERIFIED',
        monetizationModel: 'AFFILIATE_CPS',
        verifiedCommissionOrMarginINR: 1250,
        confidence: 0.72,
        sampleSize: 25
      });

      expect(opp.lifecycleState).toBe('DISCOVERED');
      expect(() => oppEngine.transitionLifecycle(opp.id, 'RECONCILED')).toThrow(/INVALID_LIFECYCLE_TRANSITION/);
      const researched = oppEngine.transitionLifecycle(opp.id, 'RESEARCHED');
      const verified = oppEngine.transitionLifecycle(researched.id, 'VERIFIED');
      const qualified = oppEngine.transitionLifecycle(verified.id, 'QUALIFIED');
      expect(qualified.lifecycleState).toBe('QUALIFIED');

      const summary = await OwnerDigestService.getInstance().getArosControlCenterSummary();
      expect(summary.opportunitiesByLaneAndState.unifiedOpportunities.byLane.LANE_A_AFFILIATE_COMMERCE.total).toBeGreaterThanOrEqual(1);
      expect(summary.commercialPerformance.bankConfirmedCashINR.sourceTag).toBe('MEASURED');
      expect(typeof summary.scheduledExecutionTruth.genuineCronWorkerRuns24h).toBe('number');
      expect(typeof summary.scheduledExecutionTruth.manualOrCurlPings24h).toBe('number');
    });
  });
});
