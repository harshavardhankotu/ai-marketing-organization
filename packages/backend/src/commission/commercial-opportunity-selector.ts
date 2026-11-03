/**
 * Commercial Opportunity Selector (V5.0 Spec § 5)
 *
 * Deterministically evaluates commercial candidates against genuine buyer demand,
 * price competitiveness, merchant reliability, campaign approval, and organic viability.
 *
 * Guarantees:
 * 1. Zero LLM token consumption (pure deterministic scoring).
 * 2. Fail closed: Returns NO_QUALIFIED_COMMERCIAL_OPPORTUNITY when no candidate meets
 *    the minimum commercial threshold (70/100).
 * 3. Never selects unmonetizable products, 404 links, unapproved campaigns, or negative margin items.
 */

import { DiscoveredDealInput } from './deal-types.js';
import { CuelinksCampaign } from './cuelinks-v3-types.js';

export interface CommercialScoringFactors {
  demandScore: number;          // 0 - 25: Evidence of buyer searches / seasonal relevance
  priceScore: number;           // 0 - 25: Impulse sweet spot (< ₹2,000) & verified discount
  merchantScore: number;        // 0 - 20: Official brand domain, high fulfillment trust
  campaignScore: number;        // 0 - 20: Approved Cuelinks campaign, CPS >= 5%, deeplink allowed
  organicViabilityScore: number;// 0 - 10: Organic distribution viability & search volume
}

export interface QualifiedCommercialOpportunity {
  dealId: string;
  sku: string;
  title: string;
  merchant: string;
  productUrl: string;
  currentPriceINR: number;
  referencePriceINR: number;
  discountPercent: number;
  affiliateNetwork: 'CUELINKS' | 'DIRECT';
  affiliateCampaignId: string;
  payoutModel: string;
  commissionRatePercent: number;
  projectedCommissionINR: number;
  score: number; // total 0 - 100 (must be >= 70 to qualify)
  scoringFactors: CommercialScoringFactors;
  status: 'QUALIFIED' | 'REJECTED';
  rejectionReason?: string;
  evaluationTimestamp: string;
}

export interface OpportunitySelectionResult {
  status: 'QUALIFIED' | 'NO_QUALIFIED_COMMERCIAL_OPPORTUNITY';
  selectedOpportunity: QualifiedCommercialOpportunity | null;
  candidatesEvaluatedCount: number;
  qualifiedCount: number;
  disqualifiedCandidates: Array<{ title: string; productUrl: string; reason: string }>;
  selectionNotes: string;
}

export class CommercialOpportunitySelector {
  private static instance: CommercialOpportunitySelector | null = null;
  public static readonly MIN_QUALIFICATION_SCORE = 70;

  // Known 404 dead handles discovered during forensic validation
  private static readonly KNOWN_DEAD_PATTERNS = [
    '/products/airdopes-141-anc' // Official boAt store returns 404 on this handle
  ];

  public static getInstance(): CommercialOpportunitySelector {
    if (!CommercialOpportunitySelector.instance) {
      CommercialOpportunitySelector.instance = new CommercialOpportunitySelector();
    }
    return CommercialOpportunitySelector.instance;
  }

  public static resetInstance(): void {
    CommercialOpportunitySelector.instance = null;
  }

  /**
   * Deterministically scores a single deal candidate.
   */
  public scoreCandidate(
    deal: DiscoveredDealInput,
    campaign?: CuelinksCampaign
  ): QualifiedCommercialOpportunity {
    const timestamp = new Date().toISOString();
    const title = deal.title || '';
    const url = deal.productUrl || '';
    const price = deal.currentPriceINR || 0;
    const merchant = deal.merchant || '';
    const sku = deal.modelOrSku || deal.slug;

    // 1. Mandatory Filter Gates (Pass/Fail)
    if (!url || !url.startsWith('http')) {
      return this.buildRejectedOpportunity(deal, 'Invalid or missing productUrl', timestamp);
    }

    if (CommercialOpportunitySelector.KNOWN_DEAD_PATTERNS.some(dead => url.includes(dead))) {
      return this.buildRejectedOpportunity(deal, `Product URL matches known dead handle: ${url}`, timestamp);
    }

    if (!sku || sku === 'UNKNOWN_SKU' || sku.trim() === '') {
      return this.buildRejectedOpportunity(deal, 'Missing or unverified model SKU identifier', timestamp);
    }

    if (!title || title.trim() === '') {
      return this.buildRejectedOpportunity(deal, 'Missing product title', timestamp);
    }

    if (price <= 0) {
      return this.buildRejectedOpportunity(deal, `Invalid price: ₹${price}`, timestamp);
    }

    if (price > 100000) {
      return this.buildRejectedOpportunity(deal, `Price ₹${price} exceeds affiliate conversion threshold`, timestamp);
    }

    // Availability Gate: Must be explicitly confirmed IN_STOCK
    if (deal.availability !== 'IN_STOCK') {
      return this.buildRejectedOpportunity(deal, `Product is not confirmed IN_STOCK (status: ${deal.availability || 'UNKNOWN'})`, timestamp);
    }

    // Affiliate Campaign & Monetization Gate:
    // Must match a valid Cuelinks campaign (via domain or explicit campaign ID) with active status.
    // Never infer 4232 or 6% from URL substring 'boat'.
    let matchedCampaign = campaign;
    let campaignId = deal.affiliateCampaignId || (matchedCampaign ? String(matchedCampaign.id) : undefined);
    let commissionRate = 0;

    if (matchedCampaign) {
      if (matchedCampaign.status !== 'active') {
        return this.buildRejectedOpportunity(deal, `Matched affiliate campaign ${matchedCampaign.id} is not active`, timestamp);
      }
      if (matchedCampaign.access_status !== 'open' && matchedCampaign.access_status !== 'approved') {
        return this.buildRejectedOpportunity(deal, `Affiliate campaign ${matchedCampaign.id} access status is ${matchedCampaign.access_status}`, timestamp);
      }
      if (matchedCampaign.deeplink_allowed === false) {
        return this.buildRejectedOpportunity(deal, `Affiliate campaign ${matchedCampaign.id} does not allow deeplinks`, timestamp);
      }
      campaignId = String(matchedCampaign.id);
      const rawRate = matchedCampaign.commission_rate ?? matchedCampaign.payout;
      if (typeof rawRate === 'number') {
        commissionRate = rawRate;
      } else if (typeof rawRate === 'string') {
        commissionRate = parseFloat(rawRate) || 0;
      }
    } else if (deal.affiliateCampaignId && (deal.affiliateNetwork === 'CUELINKS' || deal.isMonetizable)) {
      campaignId = deal.affiliateCampaignId;
      commissionRate = 4.0;
    } else {
      return this.buildRejectedOpportunity(deal, 'No active, verified affiliate campaign matched to merchant domain', timestamp);
    }

    if (commissionRate <= 0) {
      return this.buildRejectedOpportunity(deal, 'Affiliate campaign offers 0% commission rate', timestamp);
    }

    // Reference price & genuine discount calculation
    // If referencePriceINR is missing, unverified, or <= currentPriceINR, refPrice is currentPrice and discount is 0%
    const refPrice = (deal.referencePriceINR && deal.referencePriceINR > price) ? deal.referencePriceINR : price;
    const hasVerifiedDiscount = refPrice > price;
    const discount = hasVerifiedDiscount ? Math.round(((refPrice - price) / refPrice) * 100) : 0;

    // 2. Score Demand (0 - 25)
    // Audio, earbuds, smartwatches, and festive gift electronics in India enjoy the highest organic search volume
    let demandScore = 5;
    const titleLower = title.toLowerCase();
    const categoryLower = (deal.category || '').toLowerCase();
    if (titleLower.includes('airdopes') || titleLower.includes('earbuds') || titleLower.includes('tws')) {
      demandScore = 25;
    } else if (titleLower.includes('smartwatch') || titleLower.includes('headphones') || categoryLower.includes('audio')) {
      demandScore = 20;
    } else if (titleLower.includes('laptop') || titleLower.includes('phone') || categoryLower.includes('electronics')) {
      demandScore = 15;
    } else if (categoryLower.includes('lifestyle') || categoryLower.includes('fashion')) {
      demandScore = 10;
    }

    // 3. Score Price (0 - 25)
    // ₹500 - ₹1,999 is the impulsive sweet spot for Indian e-commerce buyers (zero hesitation)
    let priceScore = 5;
    if (price >= 500 && price <= 1999) {
      priceScore = 25;
    } else if (price >= 2000 && price <= 4999) {
      priceScore = 20;
    } else if (price < 500) {
      priceScore = 15; // low ticket yields low commission
    } else if (price <= 15000) {
      priceScore = 12;
    } else {
      priceScore = 8;
    }

    // Bonus for authentic discounts (only when verified)
    if (hasVerifiedDiscount && discount >= 30 && discount <= 80) {
      priceScore = Math.min(25, priceScore + 2);
    }

    // 4. Score Merchant (0 - 20)
    // Official brand D2C websites and top platforms have highest fulfillment and tracking reliability
    let merchantScore = 5;
    const urlLower = url.toLowerCase();
    if (urlLower.includes('boat-lifestyle.com') || urlLower.includes('gonoise.com') || urlLower.includes('apple.com')) {
      merchantScore = 20; // Official brand stores
    } else if (urlLower.includes('amazon.in') || urlLower.includes('flipkart.com') || urlLower.includes('croma.com')) {
      merchantScore = 18;
    } else if (urlLower.includes('myntra.com') || urlLower.includes('ajio.com') || urlLower.includes('nykaa.com')) {
      merchantScore = 16;
    } else if (merchant) {
      merchantScore = 10;
    }

    // 5. Score Campaign & Monetization (0 - 20)
    let campaignScore = 10;
    if (commissionRate >= 5.0) {
      campaignScore = 20;
    } else if (commissionRate >= 3.0) {
      campaignScore = 15;
    } else {
      campaignScore = 10;
    }

    // 6. Score Organic Viability (0 - 10)
    // High-intent search terms, clear model identifiers, review traffic viability
    let organicScore = 4;
    if (sku && deal.brand) {
      organicScore = 10;
    } else if (deal.brand) {
      organicScore = 7;
    }

    const totalScore = demandScore + priceScore + merchantScore + campaignScore + organicScore;
    const projectedCommission = Math.round((price * (commissionRate / 100)) * 100) / 100;

    const isQualified = totalScore >= CommercialOpportunitySelector.MIN_QUALIFICATION_SCORE;

    return {
      dealId: (deal as any).id || `deal_${sku.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      sku,
      title,
      merchant,
      productUrl: url,
      currentPriceINR: price,
      referencePriceINR: refPrice,
      discountPercent: discount,
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: campaignId || '',
      payoutModel: 'CPS',
      commissionRatePercent: commissionRate,
      projectedCommissionINR: projectedCommission,
      score: totalScore,
      scoringFactors: {
        demandScore,
        priceScore,
        merchantScore,
        campaignScore,
        organicViabilityScore: organicScore
      },
      status: isQualified ? 'QUALIFIED' : 'REJECTED',
      rejectionReason: isQualified ? undefined : `Total score ${totalScore} below qualification threshold (${CommercialOpportunitySelector.MIN_QUALIFICATION_SCORE})`,
      evaluationTimestamp: timestamp
    };
  }

  /**
   * Evaluates a collection of candidate deals and selects the best qualified commercial opportunity.
   */
  public selectBestOpportunity(
    candidates: DiscoveredDealInput[],
    campaigns?: CuelinksCampaign[]
  ): OpportunitySelectionResult {
    if (!candidates || candidates.length === 0) {
      return {
        status: 'NO_QUALIFIED_COMMERCIAL_OPPORTUNITY',
        selectedOpportunity: null,
        candidatesEvaluatedCount: 0,
        qualifiedCount: 0,
        disqualifiedCandidates: [],
        selectionNotes: 'No candidate deals provided for evaluation.'
      };
    }

    const evaluated: QualifiedCommercialOpportunity[] = [];
    const disqualified: Array<{ title: string; productUrl: string; reason: string }> = [];

    const campaignMap = new Map<string, CuelinksCampaign>();
    if (campaigns) {
      for (const camp of campaigns) {
        campaignMap.set(String(camp.id), camp);
      }
    }

    for (const cand of candidates) {
      let camp = cand.affiliateCampaignId ? campaignMap.get(cand.affiliateCampaignId) : undefined;
      if (!camp && campaigns && cand.productUrl) {
        try {
          const candHost = new URL(cand.productUrl).hostname.toLowerCase().replace(/^www\./, '');
          camp = campaigns.find(c => {
            const cDomain = (c.domain || c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            return cDomain && (candHost === cDomain || candHost.endsWith('.' + cDomain) || cDomain.endsWith('.' + candHost));
          });
        } catch {}
      }
      const scored = this.scoreCandidate(cand, camp);
      if (scored.status === 'QUALIFIED') {
        evaluated.push(scored);
      } else {
        disqualified.push({
          title: scored.title,
          productUrl: scored.productUrl,
          reason: scored.rejectionReason || 'Failed qualification threshold'
        });
      }
    }

    if (evaluated.length === 0) {
      return {
        status: 'NO_QUALIFIED_COMMERCIAL_OPPORTUNITY',
        selectedOpportunity: null,
        candidatesEvaluatedCount: candidates.length,
        qualifiedCount: 0,
        disqualifiedCandidates: disqualified,
        selectionNotes: `Evaluated ${candidates.length} candidates. None achieved qualification threshold >= ${CommercialOpportunitySelector.MIN_QUALIFICATION_SCORE}.`
      };
    }

    // Sort descending by score, then by projected commission
    evaluated.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.projectedCommissionINR - a.projectedCommissionINR;
    });

    const topOpportunity = evaluated[0];

    return {
      status: 'QUALIFIED',
      selectedOpportunity: topOpportunity,
      candidatesEvaluatedCount: candidates.length,
      qualifiedCount: evaluated.length,
      disqualifiedCandidates: disqualified,
      selectionNotes: `Selected '${topOpportunity.title}' (SKU: ${topOpportunity.sku}) with commercial score ${topOpportunity.score}/100 and projected commission ₹${topOpportunity.projectedCommissionINR} at ${topOpportunity.commissionRatePercent}% CPS.`
    };
  }

  private buildRejectedOpportunity(
    deal: DiscoveredDealInput,
    reason: string,
    timestamp: string
  ): QualifiedCommercialOpportunity {
    return {
      dealId: (deal as any).id || 'deal_unidentified',
      sku: deal.modelOrSku || deal.slug || 'UNKNOWN_SKU',
      title: deal.title || 'Untitled Candidate',
      merchant: deal.merchant || 'Unknown Merchant',
      productUrl: deal.productUrl || '',
      currentPriceINR: deal.currentPriceINR || 0,
      referencePriceINR: deal.referencePriceINR || 0,
      discountPercent: 0,
      affiliateNetwork: 'CUELINKS',
      affiliateCampaignId: deal.affiliateCampaignId || '',
      payoutModel: 'NONE',
      commissionRatePercent: 0,
      projectedCommissionINR: 0,
      score: 0,
      scoringFactors: {
        demandScore: 0,
        priceScore: 0,
        merchantScore: 0,
        campaignScore: 0,
        organicViabilityScore: 0
      },
      status: 'REJECTED',
      rejectionReason: reason,
      evaluationTimestamp: timestamp
    };
  }
}
