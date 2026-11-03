import { describe, it, expect, beforeEach } from 'vitest';
import { OrganicDistributionEngine } from '../../src/commission/organic-distribution-engine.js';
import { QualifiedCommercialOpportunity } from '../../src/commission/commercial-opportunity-selector.js';
import { PlatformProspectDiscoveryEngine } from '../../src/revenue/platform-prospect-discovery-engine.js';

describe('Stage 6 — Organic Distribution & Healthcare Safety Gate Tests', () => {
  let distributor: OrganicDistributionEngine;
  let prospectEngine: PlatformProspectDiscoveryEngine;

  const nonBoatOpp: QualifiedCommercialOpportunity = {
    dealId: 'deal_noise_smartwatch',
    sku: 'noise-pulse-grand',
    title: 'Noise ColorFit Pulse Grand Smart Watch',
    merchant: 'Noise Official Store',
    productUrl: 'https://www.gonoise.com/products/colorfit-pulse-grand',
    currentPriceINR: 1299,
    referencePriceINR: 3999,
    discountPercent: 67,
    affiliateNetwork: 'CUELINKS',
    affiliateCampaignId: '5566',
    payoutModel: 'CPS',
    commissionRatePercent: 4.0,
    projectedCommissionINR: 51.96,
    score: 85,
    scoringFactors: {
      demandScore: 20,
      priceScore: 25,
      merchantScore: 20,
      campaignScore: 10,
      organicViabilityScore: 10
    },
    status: 'QUALIFIED',
    evaluationTimestamp: new Date().toISOString()
  };

  beforeEach(() => {
    OrganicDistributionEngine.resetInstance();
    distributor = OrganicDistributionEngine.getInstance();
    prospectEngine = PlatformProspectDiscoveryEngine.getInstance();
  });

  describe('1. Truthful Distribution Copy & Disclosures', () => {
    it('does NOT inject hardcoded boAt earbud specs (42 hours, BEAST mode) into a non-boAt opportunity', () => {
      const pkg = distributor.generateDistributionPackage(nonBoatOpp);

      for (const post of pkg.shareKit) {
        expect(post.body).not.toContain('BEAST Mode');
        expect(post.body).not.toContain('42 hours total playback');
        expect(post.body).not.toContain('boAt Official Store');
      }

      expect(pkg.replyDeskCopy.competitorComparison).not.toContain('boAt offers genuine');
      expect(pkg.replyDeskCopy.affiliateCallToAction).toContain('Noise Official Store');
    });

    it('enforces mandatory commercial disclosure (#Ad or Affiliate Disclosure) across all distribution formats', () => {
      const pkg = distributor.generateDistributionPackage(nonBoatOpp);

      for (const post of pkg.shareKit) {
        expect(post.disclosureTag).toMatch(/#Ad|Affiliate|Commission/i);
      }
      expect(pkg.replyDeskCopy.complianceNotice).toMatch(/commission|affiliate/i);
    });

    it('tracks content lifecycle state machine and does not mark as PUBLISHED upon creation', () => {
      const pkg = distributor.generateDistributionPackage(nonBoatOpp);

      // Must start as CONTENT_GENERATED
      expect(pkg.status).toBe('CONTENT_GENERATED');
      expect(pkg.publishedUrl).toBeUndefined();
      expect(pkg.publishedAt).toBeUndefined();
    });
  });

  describe('2. Sector A Healthcare Safety Gates', () => {
    it('quarantines curated seeded clinic prospects as SEEDED_UNVERIFIED', async () => {
      const runId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const testDomain = `apollo-hosp-${runId}.in`;
      const candidates = [
        {
          businessName: `Apollo Dental Hospital ${runId}`,
          vertical: 'dental',
          city: 'Hyderabad',
          websiteUrl: `https://${testDomain}`,
          contactPhone: `+9198${Math.floor(10000000 + Math.random() * 89999999)}`,
          contactEmail: `contact@${testDomain}`,
          evidenceSourceUrl: `https://${testDomain}/contact`,
          evidenceSnippet: 'Apollo Dental Hospital verified contact details',
          observedGap: 'Manual booking without after-hours triage'
        }
      ];

      // When seeded prospects are persisted via CACHE_REUSE
      const persisted = await prospectEngine.persistCandidates(candidates, 'org_test', 'biz_test', 'CACHE_REUSE');
      expect(persisted).toBeDefined();
      expect(persisted.length).toBe(1);

      // Check DB / repository status by exact newly created prospect id
      const d1Repo = (prospectEngine as any).d1Repo;
      const rows = await d1Repo.query('platform_prospects', "SELECT status, stage FROM platform_prospects WHERE id = ?", [persisted[0].id]);
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('SEEDED_UNVERIFIED');
      expect(rows[0].stage).toBe('SEEDED_UNVERIFIED');
    });
  });
});
