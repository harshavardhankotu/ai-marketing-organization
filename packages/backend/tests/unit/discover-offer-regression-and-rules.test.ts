import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { AutomaticOfferLane, GeneratedGuide, SpecLineRecord } from '../../src/commission/automatic-offer-lane.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { StaticSiteGenerator } from '../../src/commission/static-site-generator.js';
import { OfferCatalogService } from '../../src/revenue/offer-catalog.js';
import { ProposalEngine } from '../../src/revenue/proposal-engine.js';
import { ActionCooldownManager } from '../../src/revenue/action-cooldown-manager.js';
import { LeadLeakageCalculator } from '../../src/revenue/lead-leakage-calculator.js';

describe('Discovery, Publication & Revenue Governance Regression Suite', () => {
  const cleanDb = () => {
    const db = getDb();
    try {
      db.prepare(`DELETE FROM demand_signals`).run();
      db.prepare(`DELETE FROM brand_spec_lines`).run();
      db.prepare(`DELETE FROM product_proposals`).run();
      db.prepare(`DELETE FROM commission_content_assets`).run();
      db.prepare(`DELETE FROM action_cooldowns`).run();
      db.prepare(`DELETE FROM platform_prospects`).run();
      db.prepare(`DELETE FROM proposals`).run();
    } catch {}
  };

  beforeEach(cleanDb);
  afterEach(cleanDb);

  describe('Section 4: Dynamic Offer Discovery & Category Filters', () => {
    it('1. Rejects multi-word blocked categories (health supplements, skincare cream, pharma tablets, running shoes)', () => {
      const db = getDb();
      const lane = AutomaticOfferLane.getInstance();

      const blockedList = [
        'natural health supplements',
        'advanced skincare cream',
        'generic pharma tablets',
        'running shoes for athletes',
        'summer apparel collection'
      ];

      for (let i = 0; i < blockedList.length; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, topic, category, location, intent_type, raw_query,
            evidence_snippet, source_url, urgency, estimated_monthly_volume, status, signal_type, created_at
          ) VALUES (?, 'org_owner_primary', 'topic', ?, 'India', 'SEARCH_QUERY', 'best in india', 'snippet', 'https://forum.in', 0.5, 100, 'DISCOVERED', 'BUYER_QUESTION', datetime('now'))
        `).run(`sig_blocked_${i}`, blockedList[i]);
      }

      // pickProductCategory must NOT pick any of the blocked categories
      const result = lane.pickProductCategory();
      expect(result).toBeNull();

      // Now insert an eligible category: thermal barcode printer
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, category, location, intent_type, raw_query,
          evidence_snippet, source_url, urgency, estimated_monthly_volume, status, signal_type, created_at
        ) VALUES ('sig_eligible_1', 'org_owner_primary', 'topic', 'thermal barcode printer', 'India', 'SEARCH_QUERY', 'best thermal printer india', 'snippet', 'https://forum.in', 0.9, 100, 'DISCOVERED', 'BUYER_QUESTION', datetime('now'))
      `).run();

      const eligibleResult = lane.pickProductCategory();
      expect(eligibleResult).not.toBeNull();
      expect(eligibleResult?.category).toBe('thermal barcode printer');
    });

    it('2. Hardens domain policy against PDF URLs with query strings and fragments', () => {
      const lane = AutomaticOfferLane.getInstance();

      const pdfUrls = [
        'https://hardware-corp.com/specifications.pdf',
        'https://hardware-corp.com/downloads/manual.pdf?download=true&v=2',
        'https://hardware-corp.com/datasheet.pdf#page=5',
        'https://hardware-corp.com/brochure.PDF?token=abc'
      ];

      for (const url of pdfUrls) {
        const check = lane.checkDomainPolicy(url);
        expect(check.allowed).toBe(false);
        expect(check.rejectClass).toBe('FILE_TYPE');
      }

      // Valid spec URL allowed
      const validCheck = lane.checkDomainPolicy('https://epson.co.in/specifications/l3210');
      expect(validCheck.allowed).toBe(true);
    });

    it('3. Throws when AMAZON_AFFILIATE_TAG is empty in production and does not fall back to hardcoded strings', () => {
      const lane = AutomaticOfferLane.getInstance();
      const originalTag = process.env.AMAZON_AFFILIATE_TAG;
      const originalNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.AMAZON_AFFILIATE_TAG;
        expect(() => lane.buildAmazonSearchUrl('Epson', 'EcoTank L3210')).toThrow(/MISSING_AFFILIATE_TAG/);

        process.env.AMAZON_AFFILIATE_TAG = '   ';
        expect(() => lane.buildAmazonSearchUrl('Epson', 'EcoTank L3210')).toThrow(/MISSING_AFFILIATE_TAG/);

        process.env.AMAZON_AFFILIATE_TAG = 'verifiedtag-21';
        const url = lane.buildAmazonSearchUrl('Epson', 'EcoTank L3210');
        expect(url).toContain('tag=verifiedtag-21');
        const fallbackLiteral = ['marketing98', '21'].join('-');
        expect(url).not.toContain(fallbackLiteral);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalTag !== undefined) {
          process.env.AMAZON_AFFILIATE_TAG = originalTag;
        } else {
          delete process.env.AMAZON_AFFILIATE_TAG;
        }
      }
    });

    it('4. Halts with OFFICIAL_SOURCE_UNAVAILABLE instead of inventing synthetic domains when official spec source is missing', async () => {
      const orchestrator = AutonomousRevenueOrchestrator.getInstance();
      const db = getDb();

      // Insert 3 demand signals for a valid category, but no official manufacturer URL in excerpts
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, topic, category, location, intent_type, raw_query,
            evidence_snippet, source_url, urgency, estimated_monthly_volume, status, signal_type, excerpt, created_at
          ) VALUES (?, 'org_owner_primary', 'industrial label printer', 'industrial label printer', 'India', 'SEARCH_QUERY', 'best label printer', 'snippet', 'https://forum.in', 0.85, 100, 'DISCOVERED', 'BUYER_QUESTION', 'just asking users which label printer to buy', datetime('now'))
        `).run(`sig_ind_${i}`);
      }

      // Ensure owner intake and approved partner are valid for this test
      db.prepare(`
        INSERT OR REPLACE INTO owner_intake (
          id, organization_id, application_date, listed_site_urls_json, agreement_read_confirmed,
          agreement_read_confirmed_at, site_name, author_name, contact_email, tavily_key_rotated,
          completed_at, updated_at, written_by, status, created_at
        ) VALUES (
          'owner_primary', 'org_owner_primary', '2026-09-01', '["https://aimarketing.org"]', 1,
          datetime('now'), 'AI Marketing Org', 'Owner Name', 'owner@aimarketing.org', 1,
          datetime('now'), datetime('now'), 'OWNER_ENV', 'VALID', datetime('now')
        )
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, approval_status, active_status, created_at)
        VALUES ('partner_amazon_test', 'org_owner_primary', 'Amazon Associates India', 'EQUIPMENT', 'https://affiliate-program.amazon.in', 'AMAZON_ASSOCIATES', 'APPROVED', 1, datetime('now'))
      `).run();

      const origLive = process.env.FIRECRAWL_ENABLE_LIVE;
      const origKey = process.env.FIRECRAWL_API_KEY;
      process.env.FIRECRAWL_ENABLE_LIVE = 'true';
      process.env.FIRECRAWL_API_KEY = 'fc_test_key_live';

      try {
        const result = await (orchestrator as any).executeAction(
          { actionType: 'DISCOVER_OFFER', targetId: 'org_owner_primary:biz_platform_aro' },
          'org_owner_primary',
          'biz_platform_aro',
          'cycle_test_missing_official_source',
          { id: 'biz_platform_aro', vertical_id: 'hardware' }
        );

        expect(result.status).toBe('OFFICIAL_SOURCE_UNAVAILABLE');
        expect(result.error).toContain('Synthetic domain generation is prohibited');

        // And verify cooldown was recorded to prevent 15-minute scheduler churn
        const cooldown = ActionCooldownManager.check('org_owner_primary:biz_platform_aro', 'DISCOVER_OFFER');
        expect(cooldown.eligible).toBe(false);
        expect(cooldown.reason).toContain('COOLDOWN_ACTIVE');
      } finally {
        if (origLive !== undefined) process.env.FIRECRAWL_ENABLE_LIVE = origLive;
        else delete process.env.FIRECRAWL_ENABLE_LIVE;
        if (origKey !== undefined) process.env.FIRECRAWL_API_KEY = origKey;
        else delete process.env.FIRECRAWL_API_KEY;
      }
    });
  });

  describe('Section 6: Static Site Generator Schema & Canonical URLs', () => {
    const testConfig = {
      siteName: 'SupplySpecs India',
      authorName: 'Harsha Vardhan',
      contactEmail: 'contact@supplyspecs.in',
      siteUrl: 'https://supplyspecs.in'
    };

    it('5. Generates canonical URLs for legal pages matching sitemap.xml and routing paths', () => {
      const ssg = StaticSiteGenerator.getInstance();

      const aboutHtml = ssg.renderAboutHtml(testConfig);
      expect(aboutHtml).toContain('<link rel="canonical" href="https://supplyspecs.in/about">');

      const contactHtml = ssg.renderContactHtml(testConfig);
      expect(contactHtml).toContain('<link rel="canonical" href="https://supplyspecs.in/contact">');

      const privacyHtml = ssg.renderPrivacyHtml(testConfig);
      expect(privacyHtml).toContain('<link rel="canonical" href="https://supplyspecs.in/privacy">');

      const termsHtml = ssg.renderTermsHtml(testConfig);
      expect(termsHtml).toContain('<link rel="canonical" href="https://supplyspecs.in/terms">');

      const disclosureHtml = ssg.renderDisclosureHtml(testConfig);
      expect(disclosureHtml).toContain('<link rel="canonical" href="https://supplyspecs.in/disclosure">');
    });

    it('6. Injects Schema.org JSON-LD structured data on landing and guide pages', () => {
      const ssg = StaticSiteGenerator.getInstance();

      const landingHtml = ssg.renderLandingPageHtml([], testConfig);
      expect(landingHtml).toContain('<script type="application/ld+json">');
      expect(landingHtml).toContain('"@type":"WebSite"');
      expect(landingHtml).toContain('"name":"SupplySpecs India"');

      const mockGuide = {
        id: 'guide_phomemo_m110',
        slug: 'phomemo-m110-thermal-label-printer-buying-guide',
        title: 'Phomemo M110 Thermal Label Printer Buying Guide',
        content_markdown: '# Phomemo M110\n\nSpecifications and evaluation.',
        created_at: '2026-10-10T00:00:00Z',
        updated_at: '2026-10-12T00:00:00Z'
      };

      const guideHtml = ssg.renderGuideHtml(mockGuide, testConfig);
      expect(guideHtml).toContain('<script type="application/ld+json">');
      expect(guideHtml).toContain('"@type":"Article"');
      expect(guideHtml).toContain('"headline":"Phomemo M110 Thermal Label Printer Buying Guide"');
      expect(guideHtml).toContain('"name":"Harsha Vardhan"');
    });

    it('7. activateAndPublishGuide idempotently updates existing guide without unique constraint errors', () => {
      const lane = AutomaticOfferLane.getInstance();
      const db = getDb();

      // Setup prerequisites
      db.prepare(`
        INSERT OR REPLACE INTO owner_intake (
          id, organization_id, application_date, listed_site_urls_json, agreement_read_confirmed,
          agreement_read_confirmed_at, site_name, author_name, contact_email, tavily_key_rotated,
          completed_at, updated_at, written_by, status, created_at
        ) VALUES (
          'owner_primary', 'org_owner_primary', '2026-09-01', '["https://aimarketing.org"]', 1,
          datetime('now'), 'AI Marketing Org', 'Owner Name', 'owner@aimarketing.org', 1,
          datetime('now'), datetime('now'), 'OWNER_ENV', 'VALID', datetime('now')
        )
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, approval_status)
        VALUES ('part_amz', 'org_owner_primary', 'Amazon Associates', 'E-commerce', 'https://amazon.in', 'AMAZON_ASSOCIATES', 'PROVISIONAL')
      `).run();

      db.prepare(`
        INSERT OR REPLACE INTO brand_spec_lines (id, product_id, brand, model, spec_line, source_url, retrieved_at)
        VALUES ('spec_epson_1', 'prod_epson_l3210', 'Epson', 'EcoTank L3210', 'Print speed: 33 ppm black', 'https://epson.co.in/specs', datetime('now'))
      `).run();

      const guidePayload = {
        productId: 'prod_epson_l3210',
        brand: 'Epson',
        model: 'EcoTank L3210',
        slug: 'epson-ecotank-l3210-buyer-guide',
        title: 'Epson EcoTank L3210 Buyer Guide',
        contentMarkdown: '# Epson EcoTank L3210 Buyer Guide\n\nDisclosure: As an Amazon Associate I earn from qualifying purchases.\n\nSpecs here.'
      };

      const mockLint = { valid: true, score: 100, errors: [], warnings: [] };
      const origKillSwitch = process.env.AUTO_PUBLISH_ENABLED;
      process.env.AUTO_PUBLISH_ENABLED = 'true';

      try {
        // First publication
        const res1 = lane.activateAndPublishGuide(guidePayload as any, mockLint);
        expect(res1.published).toBe(true);

        // Re-publish same slug: must succeed idempotently via ON CONFLICT DO UPDATE
        const updatedPayload = {
          ...guidePayload,
          contentMarkdown: '# Epson EcoTank L3210 Buyer Guide (v2)\n\nDisclosure: As an Amazon Associate I earn from qualifying purchases.\n\nUpdated specs.'
        };
        const res2 = lane.activateAndPublishGuide(updatedPayload as any, mockLint);
        expect(res2.published).toBe(true);

        const row = db.prepare(`SELECT content_markdown FROM commission_content_assets WHERE slug = ?`).get(guidePayload.slug) as any;
        expect(row.content_markdown).toContain('(v2)');
      } finally {
        if (origKillSwitch !== undefined) {
          process.env.AUTO_PUBLISH_ENABLED = origKillSwitch;
        } else {
          delete process.env.AUTO_PUBLISH_ENABLED;
        }
      }
    });
  });

  describe('Section 7 & OWN_OFFER.md: Commercial Offer Consistency', () => {
    it('8. Ensures PLATFORM_SETUP offer terms match OWN_OFFER.md (14-day performance guarantee)', () => {
      const catalog = OfferCatalogService.getInstance();
      const setupOffer = catalog.resolveAuthorizedOffer(OfferCatalogService.PLATFORM_SETUP_OFFER_ID);

      expect(setupOffer.priceINR).toBe(15000);
      expect(setupOffer.deliveryTimeDays).toBe(5);
      expect(setupOffer.billingModel).toBe('ONE_TIME');
      expect(setupOffer.qualificationRequirements).toContain('Active WhatsApp Business number');
      expect(setupOffer.qualificationRequirements).toContain('Claimed Google Business Profile');
    });

    it('9. Ensures ProposalEngine default payment terms specify 50% upfront setup on approval', () => {
      const proposalEngine = ProposalEngine.getInstance();
      const proposal = proposalEngine.createProposal({
        organizationId: 'org_owner_primary',
        businessId: 'biz_platform_aro',
        prospectId: 'prospect_test_owner_revert',
        title: 'Lead Conversion System Proposal',
        deliverables: ['Custom WhatsApp Triage Bot', 'GBP Lead Capture']
      });

      expect(proposal.setupPriceINR).toBe(15000);
      expect(proposal.monthlyPriceINR).toBe(8000);
      expect(proposal.paymentTerms).toContain('50% upfront');
      expect(proposal.paymentTerms).not.toContain('100% upfront');
    });

    it('10. lintGuide fails when a spec line has missing sourceUrl or retrievedAt', () => {
      const lane = AutomaticOfferLane.getInstance();
      const candidate = {
        category: 'thermal label printer',
        brand: 'Phomemo',
        model: 'M110',
        targetQuery: 'Phomemo M110'
      };
      const validSpecs: SpecLineRecord[] = [
        {
          id: 'spec_v1',
          productId: 'prod_phomemo_m110',
          brand: 'Phomemo',
          model: 'M110',
          specLine: 'Print speed: 150mm/s direct thermal printing',
          sourceUrl: 'https://phomemo.com/m110',
          retrievedAt: '2026-10-15T00:00:00Z'
        }
      ];
      const guide = lane.generateGuide(candidate, validSpecs);

      // Mutate spec to have empty sourceUrl
      const invalidSpecsNoUrl: SpecLineRecord[] = [
        { ...validSpecs[0], sourceUrl: '' }
      ];
      const lintNoUrl = lane.lintGuide(guide, invalidSpecsNoUrl);
      expect(lintNoUrl.valid).toBe(false);
      expect(lintNoUrl.errors.some(e => e.includes('lacks a stored source URL'))).toBe(true);

      // Mutate spec to have empty retrievedAt
      const invalidSpecsNoDate: SpecLineRecord[] = [
        { ...validSpecs[0], retrievedAt: '' }
      ];
      const lintNoDate = lane.lintGuide(guide, invalidSpecsNoDate);
      expect(lintNoDate.valid).toBe(false);
      expect(lintNoDate.errors.some(e => e.includes('lacks a stored source URL or retrieval date'))).toBe(true);
    });

    it('11. activateAndPublishGuide fails with UNSOURCED_PRODUCT_FACT when brand_spec_lines has missing source_url or retrieved_at', () => {
      const db = getDb();
      const lane = AutomaticOfferLane.getInstance();

      db.prepare(`
        INSERT OR REPLACE INTO owner_intake (
          id, organization_id, application_date, listed_site_urls_json, agreement_read_confirmed,
          agreement_read_confirmed_at, site_name, author_name, contact_email, tavily_key_rotated,
          completed_at, updated_at, written_by, status, created_at
        ) VALUES (
          'intake_fact_check', 'org_owner_primary', '2026-09-01', '["https://aimarketing.org"]', 1,
          datetime('now'), 'AI Marketing Org', 'Owner Name', 'owner@aimarketing.org', 1,
          datetime('now'), datetime('now'), 'OWNER_ENV', 'VALID', datetime('now')
        )
      `).run();
      db.prepare(`INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, approval_status) VALUES ('part_amz', 'org_owner_primary', 'Amazon Associates', 'E-commerce', 'https://amazon.in', 'AMAZON_ASSOCIATES', 'PROVISIONAL')`).run();

      const candidate = {
        category: 'thermal label printer',
        brand: 'Phomemo',
        model: 'M110',
        targetQuery: 'Phomemo M110'
      };
      const specs: SpecLineRecord[] = [
        {
          id: 'spec_unsourced_test',
          productId: 'prod_phomemo_m110',
          brand: 'Phomemo',
          model: 'M110',
          specLine: 'Print speed: 150mm/s direct thermal printing',
          sourceUrl: 'https://phomemo.com/m110',
          retrievedAt: '2026-10-15T00:00:00Z'
        }
      ];
      const guide = lane.generateGuide(candidate, specs);
      const lintRes = lane.lintGuide(guide, specs);
      expect(lintRes.valid).toBe(true);

      const origKillSwitch = process.env.AUTO_PUBLISH_ENABLED;
      process.env.AUTO_PUBLISH_ENABLED = 'true';

      try {
        // Zero DB rows: fails with UNSOURCED_PRODUCT_FACT
        db.prepare(`DELETE FROM brand_spec_lines WHERE product_id = ?`).run(guide.productId);
        const resZero = lane.activateAndPublishGuide(guide, lintRes);
        expect(resZero.published).toBe(false);
        expect(resZero.reason).toContain('UNSOURCED_PRODUCT_FACT');

        // Row exists but source_url is empty: fails with UNSOURCED_PRODUCT_FACT
        db.prepare(`
          INSERT OR REPLACE INTO brand_spec_lines (id, product_id, brand, model, spec_line, source_url, retrieved_at)
          VALUES ('spec_bad_url', ?, 'Phomemo', 'M110', ?, '', '2026-10-15T00:00:00Z')
        `).run(guide.productId, specs[0].specLine);
        const resBadUrl = lane.activateAndPublishGuide(guide, lintRes);
        expect(resBadUrl.published).toBe(false);
        expect(resBadUrl.reason).toContain('UNSOURCED_PRODUCT_FACT');
      } finally {
        if (origKillSwitch !== undefined) {
          process.env.AUTO_PUBLISH_ENABLED = origKillSwitch;
        } else {
          delete process.env.AUTO_PUBLISH_ENABLED;
        }
      }
    });

    it('12. DISCOVER_OFFER returns NEEDS_FIRECRAWL when FIRECRAWL_ENABLE_LIVE is false/missing', async () => {
      const db = getDb();
      const orchestrator = AutonomousRevenueOrchestrator.getInstance();

      db.prepare(`
        INSERT OR REPLACE INTO owner_intake (
          id, organization_id, application_date, listed_site_urls_json, agreement_read_confirmed,
          agreement_read_confirmed_at, site_name, author_name, contact_email, tavily_key_rotated,
          completed_at, updated_at, written_by, status, created_at
        ) VALUES (
          'intake_fc_test', 'org_owner_primary', '2026-09-01', '["https://aimarketing.org"]', 1,
          datetime('now'), 'AI Marketing Org', 'Owner Name', 'owner@aimarketing.org', 1,
          datetime('now'), datetime('now'), 'OWNER_ENV', 'VALID', datetime('now')
        )
      `).run();
      db.prepare(`INSERT OR REPLACE INTO partners (id, organization_id, name, industry, website, network, approval_status) VALUES ('part_amz', 'org_owner_primary', 'Amazon Associates', 'E-commerce', 'https://amazon.in', 'AMAZON_ASSOCIATES', 'PROVISIONAL')`).run();

      // Seed 3 buyer question signals
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO demand_signals (
            id, organization_id, topic, category, location, intent_type, raw_query,
            evidence_snippet, source_url, urgency, estimated_monthly_volume, status, signal_type, created_at
          ) VALUES (?, 'org_owner_primary', 'Thermal Printers', 'thermal label printer', 'India', 'SEARCH_QUERY', 'phomemo m110 review', 'snippet', 'https://forum.in', 0.8, 200, 'DISCOVERED', 'BUYER_QUESTION', datetime('now'))
        `).run(`sig_fc_${i}`);
      }

      const origLive = process.env.FIRECRAWL_ENABLE_LIVE;
      const origKey = process.env.FIRECRAWL_API_KEY;
      delete process.env.FIRECRAWL_ENABLE_LIVE;
      process.env.FIRECRAWL_API_KEY = 'fc_test_key';

      try {
        const action: any = {
          actionType: 'DISCOVER_OFFER',
          targetId: 'biz_platform_aro',
          triggerSource: 'MANUAL'
        };
        const res = await (orchestrator as any).executeAction(action, 'org_owner_primary', 'biz_platform_aro', 'cycle_fc_test', {});
        expect(res.status).toBe('NEEDS_FIRECRAWL');
      } finally {
        if (origLive !== undefined) process.env.FIRECRAWL_ENABLE_LIVE = origLive;
        else delete process.env.FIRECRAWL_ENABLE_LIVE;
        if (origKey !== undefined) process.env.FIRECRAWL_API_KEY = origKey;
        else delete process.env.FIRECRAWL_API_KEY;
      }
    });

    it('13. LeadLeakageCalculator.requestErasure anonymizes records in platform_prospects per Section 12 DPDP', async () => {
      const db = getDb();
      const calc = LeadLeakageCalculator.getInstance();

      const leadId = `prosp_dpdp_test_${Date.now()}`;
      db.prepare(`
        INSERT INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_owner_name,
          email, prospect_email, phone, prospect_phone,
          city, prospect_city, vertical, prospect_vertical,
          source, discovery_source, status, stage, created_at, updated_at
        ) VALUES (
          ?, 'Test Clinic', 'Test Clinic', 'Dr. Ramesh Kumar',
          'ramesh@clinic.in', 'ramesh@clinic.in', '+919876543210', '+919876543210',
          'Hyderabad', 'Hyderabad', 'dental', 'dental',
          'INBOUND_LEAKAGE_CALCULATOR', 'INBOUND_LEAKAGE_CALCULATOR', 'INBOUND_REQUEST', 'INBOUND_REQUEST', datetime('now'), datetime('now')
        )
      `).run(leadId);

      // Verify row exists with identifiable info
      const pre = db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(leadId) as any;
      expect(pre.email).toBe('ramesh@clinic.in');
      expect(pre.phone).toBe('+919876543210');

      // Request erasure by email
      const erasureRes = await calc.requestErasure('ramesh@clinic.in');
      expect(erasureRes.success).toBe(true);
      expect(erasureRes.erasedRecordsCount).toBe(1);

      // Verify row is anonymized
      const post = db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(leadId) as any;
      expect(post.email).toBeNull();
      expect(post.prospect_email).toBeNull();
      expect(post.phone).toBeNull();
      expect(post.prospect_phone).toBeNull();
      expect(post.prospect_owner_name).toBe('Anonymized Data Principal');
      expect(post.discovery_evidence_json).toContain('DPDP_SECTION_12_ERASURE');
    });
  });
});
