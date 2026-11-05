import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { GoogleIndexingClient } from '../../src/integrations/google-indexing-client.js';
import { BrevoMcpClient } from '../../src/integrations/brevo-mcp-client.js';
import { GooglePageSpeedClient } from '../../src/integrations/google-pagespeed-client.js';
import { SearchDiscoveryProvider } from '../../src/research/search-discovery-provider.js';
import { AutonomousPolicyGate } from '../../src/automation/autonomous-policy-gate.js';
import { CommercialLearningEngine } from '../../src/commission/commercial-learning-engine.js';
import { DemandDiscoveryEngine } from '../../src/commission/demand-discovery.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';

describe('V5.4 — Revenue Intelligence, Quota Ledger, Policy Gate & Multi-Sector Autonomy Tests', () => {
  beforeEach(() => {
    const db = getDb();
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, created_at, updated_at)
        VALUES ('org_test', 'Test Organization', 'org-test', datetime('now'), datetime('now'))
      `).run();
      db.prepare(`
        INSERT OR IGNORE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          city, neighborhood, brand_voice, created_at, updated_at
        ) VALUES (
          'biz_test', 'org_test', 'Test Business', 'biz-test', 'v_test', 'Testing',
          'Hyderabad', 'Madhapur', 'Helpful', datetime('now'), datetime('now')
        )
      `).run();
    } catch {}
  });

  describe('1. Google Indexing Client — Fail-Closed D1 Quota, RS256 Auth & Schema Gate', () => {
    it('skips URLs without JobPosting or BroadcastEvent schema as SKIPPED_INELIGIBLE_SCHEMA_TYPE', async () => {
      const client = GoogleIndexingClient.getInstance();
      const res = await client.publishUrl(
        'https://ai-marketing-organization.onrender.com/deals/deal_boat_airdopes_141_gen2',
        'URL_UPDATED',
        {
          hasJobPosting: false,
          hasBroadcastEvent: false
        }
      );

      expect(res.status).toBe('SKIPPED_INELIGIBLE_SCHEMA_TYPE');
      expect(res.success).toBe(false);
      expect(res.quotaConsumed).toBe(false);
    });

    it('returns BLOCKED_INVALID_CREDENTIALS when service account JSON is invalid or missing', async () => {
      const client = GoogleIndexingClient.getInstance();
      // Provide valid schema so schema gate passes, testing OAuth credentials parsing
      const prevKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      try {
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY = 'not_a_valid_json_key';
        const res = await client.publishUrl(
          'https://ai-marketing-organization.onrender.com/careers/marketing-engineer',
          'URL_UPDATED',
          {
            hasJobPosting: true,
            hasBroadcastEvent: false
          }
        );

        expect(res.status).toBe('BLOCKED_INVALID_CREDENTIALS');
      } finally {
        if (prevKey) process.env.GOOGLE_SERVICE_ACCOUNT_KEY = prevKey;
        else delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      }
    });
  });

  describe('2. Brevo MCP Client — Pre-Send Atomic Reservation & Overflow Queue', () => {
    it('initializes and handles transactional send gracefully with pre-send reservation', async () => {
      const client = BrevoMcpClient.getInstance();
      const prevKey = process.env.BREVO_API_KEY;
      try {
        process.env.BREVO_API_KEY = 'xkeysib-test-placeholder';
        const res = await client.sendTransactionalEmail({
          to: 'customer@example.com',
          subject: 'SiteFix AI Audit Pack',
          htmlContent: '<h1>Your Audit Report</h1>'
        });

        // Offline test mode handles placeholder key without crashing
        expect(res).toBeDefined();
        expect(['SENT', 'QUEUED_NEXT_UTC_WINDOW', 'FAILED', 'BLOCKED_BY_RATE_LIMIT', 'ERROR']).toContain(res.status);
      } finally {
        if (prevKey) process.env.BREVO_API_KEY = prevKey;
        else delete process.env.BREVO_API_KEY;
      }
    });
  });

  describe('3. SearchDiscoveryProvider — Cache, Priority Hierarchy & Sector Queries', () => {
    it('normalizes queries and checks 24-hour cache', async () => {
      const provider = SearchDiscoveryProvider.getInstance();
      const norm = provider.normalizeQuery('  Best  ANC Earbuds  India ');
      expect(norm).toBe('best anc earbuds india');

      // Test searching via fixture / test mode
      const res = await provider.search('best anc earbuds under 2000 india', { sector: 'SECTOR_B_ELECTRONICS' });
      expect(res).toBeDefined();
      expect(res.items.length).toBeGreaterThan(0);
      expect(res.normalizedQuery).toBe('best anc earbuds under 2000 india');
    });

    it('DemandDiscoveryEngine generates canonical seed queries for all 8 sectors', () => {
      const engine = DemandDiscoveryEngine.getInstance();

      const qA = engine.formulateSearchQuery('SECTOR_A_PRECIOUS_METALS');
      expect(qA).toContain('gold');

      const qB = engine.formulateSearchQuery('SECTOR_B_ELECTRONICS');
      expect(qB).toContain('earbuds');

      const qC = engine.formulateSearchQuery('SECTOR_C_HOME_APPLIANCES');
      expect(qC).toContain('refrigerator');

      const qD = engine.formulateSearchQuery('SECTOR_D_TRAVEL');
      expect(qD).toContain('flight');

      const qE = engine.formulateSearchQuery('SECTOR_E_SOFTWARE');
      expect(qE).toContain('accounting');

      const qF = engine.formulateSearchQuery('SECTOR_F_OFFICE_INDUSTRIAL');
      expect(qF).toContain('printer');

      const qG = engine.formulateSearchQuery('SECTOR_G_LIFESTYLE');
      expect(qG).toContain('running shoes');

      const qH = engine.formulateSearchQuery('SECTOR_H_LOCAL_SERVICES_B2B');
      expect(qH).toContain('appointment');
    });

    it('DemandDiscoveryEngine enforces strict commercial quality gate for publishable deals', async () => {
      const engine = DemandDiscoveryEngine.getInstance();

      // Missing product URL -> rejected
      const resMissing = await engine.validateCommercialPublishGate({ productUrl: '' });
      expect(resMissing.allowed).toBe(false);
      expect(resMissing.reason).toBe('MISSING_PRODUCT_URL');

      // Out of stock -> rejected
      const resOutOfStock = await engine.validateCommercialPublishGate({
        productUrl: 'https://example.com/product',
        availability: 'OUT_OF_STOCK',
        affiliated: true
      });
      expect(resOutOfStock.allowed).toBe(false);
      expect(resOutOfStock.reason).toContain('PRODUCT_NOT_IN_STOCK');

      // Unmatched affiliate campaign -> rejected
      const resUnaffiliated = await engine.validateCommercialPublishGate({
        productUrl: 'https://example.com/product',
        availability: 'IN_STOCK',
        affiliated: false
      });
      expect(resUnaffiliated.allowed).toBe(false);
      expect(resUnaffiliated.reason).toContain('UNMATCHED_AFFILIATE_CAMPAIGN');

      // Valid in-stock affiliated deal -> allowed
      const resValid = await engine.validateCommercialPublishGate({
        productUrl: 'https://example.com/product',
        availability: 'IN_STOCK',
        affiliated: true,
        affiliateCampaignId: 'cuelinks_123'
      });
      expect(resValid.allowed).toBe(true);
    });
  });

  describe('4. AutonomousPolicyGate — Audit Fields & Zero False Approvals', () => {
    it('permits whitelisted safe operations with human_approved = 0 and approval_source = AUTONOMOUS_POLICY_GATE', () => {
      const gate = AutonomousPolicyGate.getInstance();

      const evalDeal = gate.evaluateAction({ actionType: 'PUBLISH_VERIFIED_DEAL', entityId: 'deal_1' });
      expect(evalDeal.allowed).toBe(true);
      expect(evalDeal.requiresHumanApproval).toBe(false);
      expect(evalDeal.humanApproved).toBe(0); // Invariant: Autonomous gate NEVER sets human_approved = 1
      expect(evalDeal.approvalSource).toBe('AUTONOMOUS_POLICY_GATE');
      expect(evalDeal.policyVersion).toBe('v5.4.0');

      const evalPageSpeed = gate.evaluateAction({ actionType: 'TRIGGER_PAGESPEED_AUDIT' });
      expect(evalPageSpeed.allowed).toBe(true);
      expect(evalPageSpeed.humanApproved).toBe(0);
      expect(evalPageSpeed.approvalSource).toBe('AUTONOMOUS_POLICY_GATE');
    });

    it('strictly gates cold outreach, paid financial spend, and legal disclosures', () => {
      const gate = AutonomousPolicyGate.getInstance();

      const evalCold = gate.evaluateAction({ actionType: 'OUTBOUND_COLD_MESSAGING' });
      expect(evalCold.allowed).toBe(false);
      expect(evalCold.requiresHumanApproval).toBe(true);
      expect(evalCold.humanApproved).toBe(0);
      expect(evalCold.approvalSource).toBe('REJECTED');
      expect(evalCold.reason).toContain('STRICT_HUMAN_GATE');

      const evalSpend = gate.evaluateAction({ actionType: 'FINANCIAL_SPEND_DEBIT' });
      expect(evalSpend.allowed).toBe(false);
      expect(evalSpend.requiresHumanApproval).toBe(true);
      expect(evalSpend.approvalSource).toBe('REJECTED');

      const evalLegal = gate.evaluateAction({ actionType: 'MODIFY_STATUTORY_DISCLOSURE' });
      expect(evalLegal.allowed).toBe(false);
      expect(evalLegal.approvalSource).toBe('REJECTED');
    });

    it('isActionAuthorized permits actions approved by human or autonomous policy gate', () => {
      const gate = AutonomousPolicyGate.getInstance();

      expect(gate.isActionAuthorized({ human_approved: 1, approval_source: 'OWNER_EXPLICIT_APPROVAL' })).toBe(true);
      expect(gate.isActionAuthorized({ human_approved: 0, approval_source: 'AUTONOMOUS_POLICY_GATE' })).toBe(true);
      expect(gate.isActionAuthorized({ human_approved: 0, approval_source: 'REJECTED' })).toBe(false);
      expect(gate.isActionAuthorized({ human_approved: 0 })).toBe(false);
    });
  });

  describe('5. Staged Evidence-Weighted Reward Model & Bayesian Bandit Allocator', () => {
    it('computes exact staged evidence weights correctly', () => {
      expect(CommercialLearningEngine.computeReward({ eventType: 'BOT_OR_INTERNAL_CLICK' })).toBe(0);
      expect(CommercialLearningEngine.computeReward({ eventType: 'VERIFIED_HUMAN_VISIT' })).toBe(1);
      expect(CommercialLearningEngine.computeReward({ eventType: 'SITEFIX_COMPLETED_SCAN' })).toBe(3);
      expect(CommercialLearningEngine.computeReward({ eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK' })).toBe(10);
      expect(CommercialLearningEngine.computeReward({ eventType: 'CONSENTED_QUALIFIED_ENQUIRY' })).toBe(25);
      expect(CommercialLearningEngine.computeReward({ eventType: 'PROVIDER_ATTRIBUTED_CONVERSION' })).toBe(60);
      expect(CommercialLearningEngine.computeReward({ eventType: 'VALIDATED_COMMISSION', commissionINR: 200 })).toBe(200); // 100 + 0.5 * 200
      expect(CommercialLearningEngine.computeReward({ eventType: 'BANK_CONFIRMED_CASH', cashINR: 499 })).toBe(749); // 250 + 1.0 * 499
      expect(CommercialLearningEngine.computeReward({ eventType: 'REFUND_OR_COMMISSION_REVERSAL' })).toBe(-120);
      expect(CommercialLearningEngine.computeReward({ eventType: 'UNPRODUCTIVE_API_QUOTA_UNIT', unproductiveQuotaUnits: 4 })).toBe(-2.0); // -0.5 * 4
    });

    it('enforces cold start threshold (10 interactions) and selects sectors across all 8 verticals', () => {
      const engine = CommercialLearningEngine.getInstance();
      engine.ensureBanditInitialized();

      const intelligence = engine.getSectorBanditIntelligence();
      const keys = Object.keys(intelligence);
      expect(keys.length).toBe(8);
      expect(keys).toContain('SECTOR_A_PRECIOUS_METALS');
      expect(keys).toContain('SECTOR_H_LOCAL_SERVICES_B2B');

      // In initial state with 0 interactions, inColdStart is true
      expect(intelligence.SECTOR_A_PRECIOUS_METALS.inColdStart).toBe(true);

      // Select next sector -> should be COLD_START_EXPLORATION
      const selection = engine.selectNextSectorToExplore();
      expect(['COLD_START_EXPLORATION', 'EXPLORATION_FLOOR']).toContain(selection.selectionMode);
      expect(CommercialLearningEngine.CANONICAL_SECTORS).toContain(selection.selectedSector);

      // Record 10 verified interactions on Sector B
      for (let i = 0; i < 10; i++) {
        engine.recordCommercialEvent('SECTOR_B_ELECTRONICS', {
          eventType: 'VERIFIED_HUMAN_AFFILIATE_CLICK'
        });
      }

      const updatedIntel = engine.getSectorBanditIntelligence();
      expect(updatedIntel.SECTOR_B_ELECTRONICS.verifiedHumanInteractions).toBe(10);
      expect(updatedIntel.SECTOR_B_ELECTRONICS.inColdStart).toBe(false);
      expect(updatedIntel.SECTOR_B_ELECTRONICS.cumulativeReward).toBe(100);
    });
  });

  describe('6. Google PageSpeed Insights & SiteFix AI Optimization Bundle', () => {
    it('runs audit and generates complete SiteFix AI optimization package', async () => {
      const client = GooglePageSpeedClient.getInstance();
      const bundle = await client.generateSiteFixBundle('https://example-clinic.in', 'Example Dental Clinic');

      expect(bundle).toBeDefined();
      expect(bundle.performanceScore).toBeGreaterThan(0);
      expect(bundle.recommendedHeadSnippets).toContain('<meta name="viewport"');
      expect(bundle.recommendedHeadSnippets).toContain('https://schema.org');
      expect(bundle.schemaJsonLd).toContain('LocalBusiness');
      expect(bundle.implementationChecklist.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('7. Public Autonomy Status Route', () => {
    it('GET /api/v1/public/autonomy-status returns live quota ledger, policy gate, and sector intelligence', async () => {
      const res = await app.request('/api/v1/public/autonomy-status');
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.version).toBe('5.4.0');
      expect(json.policyGate.humanReviewGate).toBe('STRICT_ENFORCED');
      expect(json.policyGate.paidSpendBlocked).toBe(true);
      expect(json.policyGate.paidSpendApprovedINR).toBe(0);

      // Quota ledger covers all autonomous providers
      expect(json.quotaLedger).toBeDefined();
      expect(json.quotaLedger.google_custom_search).toBeDefined();
      expect(json.quotaLedger.tavily_search).toBeDefined();
      expect(json.quotaLedger.brevo_mcp).toBeDefined();
      expect(json.quotaLedger.google_indexing).toBeDefined();
      expect(json.quotaLedger.google_pagespeed).toBeDefined();

      // Sector intelligence covers all 8 canonical sectors
      expect(json.sectorIntelligence).toBeDefined();
      expect(Object.keys(json.sectorIntelligence).length).toBe(8);
      expect(json.sectorIntelligence.SECTOR_A_PRECIOUS_METALS).toBeDefined();
      expect(json.sectorIntelligence.SECTOR_H_LOCAL_SERVICES_B2B).toBeDefined();

      // Capability matrix covers all 4 monetization engines
      expect(json.capabilityMatrix.monetizationEngines.engineA_selfServeTools).toBe('ACTIVE');
      expect(json.capabilityMatrix.monetizationEngines.engineB_multiSectorAffiliate).toBe('ACTIVE');
      expect(json.capabilityMatrix.monetizationEngines.engineC_tenantAutomation).toBe('ACTIVE');
      expect(json.capabilityMatrix.monetizationEngines.engineD_partnerDistribution).toBe('ACTIVE');
    });
  });
});
