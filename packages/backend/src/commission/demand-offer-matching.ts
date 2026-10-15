import { PartnerRegistryEngine } from './partner-registry.js';
import { PartnerOffer, Partner, DemandMatchResult } from './types.js';

export interface MatchDemandInput {
  organizationId: string;
  intent: string;
  category?: string;
  location?: string;
  budgetINR?: number;
  urgency?: number;
  limit?: number;
}

export class DemandOfferMatchingEngine {
  private static instance: DemandOfferMatchingEngine;
  private registry = PartnerRegistryEngine.getInstance();

  public static getInstance(): DemandOfferMatchingEngine {
    if (!DemandOfferMatchingEngine.instance) {
      DemandOfferMatchingEngine.instance = new DemandOfferMatchingEngine();
    }
    return DemandOfferMatchingEngine.instance;
  }

  /**
   * Matches consumer / business demand to verified partner commercial offers.
   * Multi-objective ranking formula (§ 11):
   *   Score = UserIntent × OfferRelevance × ConversionProbability × VerifiedPartnerQuality × ExpectedNetRevenue
   *
   * Fails closed: Rejects inactive offers, unapproved partners, or broken tracking URLs.
   */
  public async matchDemand(input: MatchDemandInput): Promise<DemandMatchResult[]> {
    const limit = input.limit || 3;
    const category = input.category?.toLowerCase();

    // Fetch active offers
    const allOffers = await this.registry.listOffers(input.organizationId, {
      activeOnly: true,
      category
    });

    if (allOffers.length === 0) {
      return [];
    }

    const matches: DemandMatchResult[] = [];
    const queryTokens = this.tokenize(input.intent);

    for (const offer of allOffers) {
      // Phase 2 production gate: only ACTIVE offers from explicitly authorized partners.
      if (offer.status !== 'ACTIVE' || offer.active !== 1) continue;
      const partner = await this.registry.getPartner(offer.partnerId);
      if (!partner || !this.registry.isPartnerAuthorizedForProduction(partner)) {
        continue;
      }

      // Check destination and tracking URL integrity
      if (!this.registry.isValidUrl(offer.destinationUrl) || !this.registry.isValidUrl(offer.authorizedTrackingUrl)) {
        continue;
      }

      // 1. Offer relevance score (0.0 to 1.0)
      const offerTokens = this.tokenize(`${offer.title} ${offer.category} ${offer.targetCustomer}`);
      const overlap = queryTokens.filter(t => offerTokens.includes(t)).length;
      const relevanceScore = Math.min(1.0, 0.4 + (overlap * 0.15));

      // 2. Verified partner quality factor (0.5 to 1.0)
      const partnerQuality = partner.approvalStatus === 'APPROVED' ? 1.0 : 0.5;

      // 3. Conversion probability: NEVER fabricate static probabilities.
      // Retain null (UNKNOWN) unless verified empirical conversion data exists.
      const conversionProbability: number | null = null;
      const conversionProvenance = 'UNKNOWN';

      // 4. Expected Net Revenue in INR: strictly from verified inputs only (no arbitrary 500 fallback)
      let expectedNetRevenueINR = 0;
      let expectedRevenueProvenance: 'OBSERVED' | 'UNKNOWN' = 'UNKNOWN';

      if (typeof offer.commissionAmountINR === 'number' && offer.commissionAmountINR > 0) {
        expectedNetRevenueINR = offer.commissionAmountINR;
        expectedRevenueProvenance = 'OBSERVED';
      } else if (typeof offer.priceINR === 'number' && offer.priceINR > 0 && typeof partner.commissionRate === 'number' && partner.commissionRate > 0) {
        expectedNetRevenueINR = Math.round(offer.priceINR * partner.commissionRate);
        expectedRevenueProvenance = 'OBSERVED';
      }

      // Composite multi-objective score (§ 11): driven by genuine relevance, partner quality, and verified economics
      const matchScore =
        relevanceScore *
        partnerQuality *
        (expectedNetRevenueINR > 0 ? Math.log10(Math.max(10, expectedNetRevenueINR)) : 1.0);

      matches.push({
        offer,
        partner,
        matchScore,
        relevanceScore,
        expectedNetRevenueINR,
        expectedRevenueProvenance,
        conversionProbability,
        conversionProvenance,
        reason: `Matched intent '${input.intent.slice(0, 40)}' with ${partner.name}'s verified offer '${offer.title}' (category: ${offer.category}). Expected commission: ${expectedRevenueProvenance === 'OBSERVED' ? `₹${expectedNetRevenueINR}` : 'UNKNOWN'}.`,
        evidence: `Verified partner active since ${partner.createdAt.slice(0, 10)}. Validated tracking destination.`,
        disclosureRequired: partner.disclosureRequired === 1
      });
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);
    return matches.slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }
}
