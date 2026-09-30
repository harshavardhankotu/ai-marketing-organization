import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { CustomerOffer, StructuredIntent, QualificationResult, toMinorUnits } from '@ai-marketing/shared';

export class OfferDecisionEngine {
  private static instance: OfferDecisionEngine;
  private repo = D1RevenueRepository.getInstance();

  public static getInstance(): OfferDecisionEngine {
    if (!OfferDecisionEngine.instance) {
      OfferDecisionEngine.instance = new OfferDecisionEngine();
    }
    return OfferDecisionEngine.instance;
  }

  /**
   * Loads all active customer offers for a business.
   * Checks the durable customer_offers table first, with fallback to businesses.offerings_json.
   */
  public async getOffersForBusiness(businessId: string): Promise<CustomerOffer[]> {
    const rows = await this.repo.query<any>(
      'customer_offers',
      `SELECT * FROM customer_offers WHERE business_id = ? AND active = 1 ORDER BY price_minor ASC`,
      [businessId]
    );

    if (rows && rows.length > 0) {
      return rows.map(r => ({
        id: r.id,
        businessId: r.business_id,
        organizationId: r.organization_id,
        title: r.title,
        description: r.description || '',
        category: r.category || 'GENERAL',
        priceMinor: Number(r.price_minor || 0),
        currency: r.currency || 'INR',
        billingModel: r.billing_model || 'ONE_TIME',
        depositMinor: r.deposit_minor ? Number(r.deposit_minor) : undefined,
        targetSegment: r.target_segment,
        deliverables: typeof r.deliverables_json === 'string' ? JSON.parse(r.deliverables_json || '[]') : (r.deliverables_json || []),
        qualificationRules: typeof r.qualification_rules_json === 'string' ? JSON.parse(r.qualification_rules_json || '[]') : (r.qualification_rules_json || []),
        availabilityRules: typeof r.availability_rules_json === 'string' ? JSON.parse(r.availability_rules_json || '{}') : (r.availability_rules_json || {}),
        fulfillmentType: r.fulfillment_type || 'SERVICE_DELIVERY',
        active: Boolean(r.active),
        version: Number(r.version || 1),
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    }

    // Fallback: convert legacy business offerings to CustomerOffer entities
    const biz = await this.repo.queryOne<any>(
      'businesses',
      `SELECT id, organization_id, currency, offerings_json FROM businesses WHERE id = ?`,
      [businessId]
    );

    if (!biz) return [];

    const currency = biz.currency || 'INR';
    let rawOfferings: any[] = [];
    try {
      rawOfferings = typeof biz.offerings_json === 'string' ? JSON.parse(biz.offerings_json || '[]') : (biz.offerings_json || []);
    } catch {
      rawOfferings = [];
    }

    return rawOfferings.map((o: any, idx: number) => {
      const priceMinor = o.priceMinor !== undefined ? o.priceMinor : toMinorUnits(o.priceINR || 0, currency);
      return {
        id: o.id || `off_${businessId}_${idx + 1}`,
        businessId: biz.id,
        organizationId: biz.organization_id,
        title: o.title || 'Standard Service',
        description: o.description || '',
        category: 'GENERAL',
        priceMinor,
        currency,
        billingModel: 'ONE_TIME',
        targetSegment: o.targetSegment || 'General',
        deliverables: [o.description || o.title],
        qualificationRules: [],
        availabilityRules: {},
        fulfillmentType: 'SERVICE_DELIVERY',
        active: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    });
  }

  /**
   * Matches customer intent against available business offers.
   * Produces server-authoritative qualification, fit score, and recommended offers.
   */
  public async matchOffers(
    businessId: string,
    intent: StructuredIntent
  ): Promise<QualificationResult & { recommendedOffers: CustomerOffer[]; rejectedOffers: { offerId: string; reason: string }[] }> {
    const offers = await this.getOffersForBusiness(businessId);

    if (offers.length === 0) {
      return {
        status: 'INELIGIBLE',
        fitScore: 0,
        reasons: ['No active offers configured for this business'],
        missingFields: [],
        eligibleOfferIds: [],
        rejectedOffers: [],
        suggestedAction: 'REQUEST_MORE_INFO',
        recommendedOffers: []
      };
    }

    const eligibleOffers: { offer: CustomerOffer; score: number; reasons: string[] }[] = [];
    const rejectedOffers: { offerId: string; reason: string }[] = [];
    const intentText = (
      `${intent.problem || ''} ${intent.serviceOrProduct || ''} ${intent.rawText || ''}`
    ).toLowerCase();

    for (const offer of offers) {
      // ─────────────────────────────────────────────────────────────
      // Stage 1: Hard Eligibility Filters (Separated from scoring)
      // ─────────────────────────────────────────────────────────────
      if (!offer.active) {
        rejectedOffers.push({ offerId: offer.id, reason: 'OFFER_INACTIVE: Offer is marked inactive in catalog' });
        continue;
      }

      // Hard budget ceiling filter
      if (intent.budgetRange?.maxMinor !== undefined && intent.budgetRange.maxMinor > 0) {
        if (offer.priceMinor > intent.budgetRange.maxMinor * 1.5) {
          rejectedOffers.push({
            offerId: offer.id,
            reason: `BUDGET_INELIGIBLE: Offer price (${offer.priceMinor}) significantly exceeds customer budget ceiling (${intent.budgetRange.maxMinor})`
          });
          continue;
        }
      }

      // Hard location filter (if qualification rules specify required location)
      if (intent.location && Array.isArray(offer.qualificationRules)) {
        const locRule = offer.qualificationRules.find(r => r.toLowerCase().startsWith('location:'));
        if (locRule) {
          const reqLoc = locRule.substring(9).trim().toLowerCase();
          if (!intent.location.toLowerCase().includes(reqLoc)) {
            rejectedOffers.push({
              offerId: offer.id,
              reason: `LOCATION_INELIGIBLE: Offer requires service location '${reqLoc}', but lead is in '${intent.location}'`
            });
            continue;
          }
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Stage 2: Fit Scoring (Starts at 0.0, earned by evidence)
      // ─────────────────────────────────────────────────────────────
      let score = 0.0;
      const reasons: string[] = [];

      // Keyword match with title & description
      const offerTitle = offer.title.toLowerCase();
      const offerDesc = offer.description.toLowerCase();
      const keywords = intentText.split(/\s+/).filter(w => w.length > 2);
      
      let matches = 0;
      for (const kw of keywords) {
        if (offerTitle.includes(kw)) matches += 2;
        else if (offerDesc.includes(kw)) matches += 1;
      }

      if (matches > 0) {
        const keywordScore = Math.min(0.50, matches * 0.12);
        score += keywordScore;
        reasons.push(`Matched ${matches} relevance points in offer title/description (+${keywordScore.toFixed(2)})`);
      }

      // Direct service match bonus
      if (intent.serviceOrProduct && offerTitle.includes(intent.serviceOrProduct.toLowerCase())) {
        score += 0.25;
        reasons.push(`Direct service match for '${intent.serviceOrProduct}' (+0.25)`);
      }

      // Budget fit evaluation
      if (intent.budgetRange?.maxMinor !== undefined && intent.budgetRange.maxMinor > 0) {
        if (offer.priceMinor <= intent.budgetRange.maxMinor) {
          score += 0.15;
          reasons.push('Offer price is fully within customer budget limit (+0.15)');
        }
      } else if (offer.priceMinor === 0) {
        // Free consultation / triage deposit
        score += 0.10;
        reasons.push('Complimentary or low-barrier introductory offer (+0.10)');
      }

      // Customer segment evaluation
      if (intent.customerType && offer.targetSegment) {
        if (offer.targetSegment.toLowerCase().includes(intent.customerType.toLowerCase())) {
          score += 0.10;
          reasons.push(`Matches target customer segment '${intent.customerType}' (+0.10)`);
        }
      }

      // Urgency alignment
      if (intent.urgency === 'IMMEDIATE' || intent.urgency === 'HIGH') {
        score += 0.05;
        reasons.push('High intent urgency boost (+0.05)');
      }

      const clampedScore = Math.max(0.0, Math.min(1.0, score));
      if (clampedScore > 0.15) {
        eligibleOffers.push({ offer, score: clampedScore, reasons });
      } else {
        rejectedOffers.push({ offerId: offer.id, reason: 'LOW_RELEVANCE: Insufficient intent match points' });
      }
    }

    // Sort descending by earned match score
    eligibleOffers.sort((a, b) => b.score - a.score);

    const topOffer = eligibleOffers[0]?.offer;
    const topScore = eligibleOffers[0]?.score || 0;

    let status: QualificationResult['status'] = 'INELIGIBLE';
    let suggestedAction = 'REQUEST_MORE_INFO';

    if (topScore >= 0.50) {
      status = 'QUALIFIED';
      suggestedAction = topOffer?.fulfillmentType === 'APPOINTMENT' || topOffer?.fulfillmentType === 'CONSULTATION'
        ? 'BOOK_APPOINTMENT'
        : 'INSTANT_PURCHASE';
    } else if (topScore >= 0.25) {
      status = 'PARTIALLY_QUALIFIED';
      suggestedAction = 'SCHEDULE_CONSULTATION';
    } else if (eligibleOffers.length === 0 && rejectedOffers.length > 0) {
      status = 'INELIGIBLE';
      suggestedAction = 'DECLINE_OR_REFER';
    } else {
      status = 'NEEDS_INFORMATION';
      suggestedAction = 'REQUEST_MORE_INFO';
    }

    const missingFields: string[] = [];
    if (!intent.problem && !intent.serviceOrProduct) missingFields.push('problem_or_service_description');
    if (!intent.location && !intent.preferredDate) missingFields.push('scheduling_or_location_preference');

    return {
      status,
      fitScore: topScore,
      reasons: eligibleOffers[0]?.reasons || (rejectedOffers.length > 0 ? [rejectedOffers[0].reason] : ['No matching offers found']),
      missingFields,
      eligibleOfferIds: eligibleOffers.map(e => e.offer.id),
      rejectedOffers,
      suggestedAction,
      recommendedOffers: eligibleOffers.map(e => e.offer)
    };
  }
}
