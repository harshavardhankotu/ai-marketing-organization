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
  ): Promise<QualificationResult & { recommendedOffers: CustomerOffer[] }> {
    const offers = await this.getOffersForBusiness(businessId);

    if (offers.length === 0) {
      return {
        status: 'INELIGIBLE',
        fitScore: 0,
        reasons: ['No active offers configured for this business'],
        missingFields: [],
        eligibleOfferIds: [],
        suggestedAction: 'REQUEST_MORE_INFO',
        recommendedOffers: []
      };
    }

    const scoredOffers: { offer: CustomerOffer; score: number; reasons: string[] }[] = [];
    const intentText = (
      `${intent.problem || ''} ${intent.serviceOrProduct || ''} ${intent.rawText || ''}`
    ).toLowerCase();

    for (const offer of offers) {
      let score = 0.5; // Baseline score
      const reasons: string[] = [];

      // Keyword match with title & description
      const offerTitle = offer.title.toLowerCase();
      const offerDesc = offer.description.toLowerCase();
      
      const keywords = intentText.split(/\s+/).filter(w => w.length > 2);
      let matches = 0;
      for (const kw of keywords) {
        if (offerTitle.includes(kw) || offerDesc.includes(kw)) {
          matches++;
        }
      }

      if (matches > 0) {
        score += Math.min(0.35, matches * 0.1);
        reasons.push(`Matched ${matches} keywords in offer title/description`);
      }

      // Budget evaluation
      if (intent.budgetRange) {
        const { minMinor, maxMinor } = intent.budgetRange;
        if (maxMinor !== undefined && offer.priceMinor <= maxMinor) {
          score += 0.15;
          reasons.push('Offer price is within customer budget limit');
        } else if (maxMinor !== undefined && offer.priceMinor > maxMinor) {
          score -= 0.25;
          reasons.push('Offer price exceeds customer budget ceiling');
        }
        if (minMinor !== undefined && offer.priceMinor >= minMinor) {
          score += 0.05;
        }
      }

      // Customer segment evaluation
      if (intent.customerType && offer.targetSegment) {
        if (offer.targetSegment.toLowerCase().includes(intent.customerType.toLowerCase())) {
          score += 0.1;
          reasons.push(`Matches target segment (${intent.customerType})`);
        }
      }

      // Urgency boost
      if (intent.urgency === 'IMMEDIATE' || intent.urgency === 'HIGH') {
        score += 0.05;
      }

      const clampedScore = Math.max(0.1, Math.min(1.0, score));
      scoredOffers.push({ offer, score: clampedScore, reasons });
    }

    // Sort descending by match score
    scoredOffers.sort((a, b) => b.score - a.score);

    const eligible = scoredOffers.filter(s => s.score >= 0.5);
    const topOffer = eligible[0]?.offer;

    let status: QualificationResult['status'] = 'QUALIFIED';
    let suggestedAction = 'BOOK_APPOINTMENT';

    if (eligible.length === 0) {
      status = 'NEEDS_INFORMATION';
      suggestedAction = 'REQUEST_MORE_INFO';
    } else if (topOffer?.fulfillmentType === 'DIGITAL' || topOffer?.billingModel === 'ONE_TIME') {
      suggestedAction = topOffer.priceMinor > 0 ? 'INSTANT_PURCHASE' : 'BOOK_APPOINTMENT';
    }

    return {
      status,
      fitScore: eligible[0]?.score || 0.4,
      reasons: eligible[0]?.reasons || ['Default offer recommendation based on catalog availability'],
      missingFields: !intent.problem && !intent.serviceOrProduct ? ['problem_description'] : [],
      eligibleOfferIds: eligible.map(e => e.offer.id),
      suggestedAction,
      recommendedOffers: eligible.map(e => e.offer)
    };
  }
}
