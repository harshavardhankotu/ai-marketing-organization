/**
 * Autonomous Deal Discovery Engine V1.1 — Domain Types & Data Models
 * Broad Internet Coverage · Real Verification · Zero Routine Owner Input
 */

export type DealSourceClass =
  | 'RETAILER_BRAND'             // Class A: Direct merchant / brand site (Croma, boAt, Lenovo, etc.)
  | 'AFFILIATE_NETWORK'           // Class B: Authorized network catalog / feed (Cuelinks, Admitad, etc.)
  | 'PUBLIC_DEAL_FEED'            // Class C: Public deal aggregators & coupon feeds (DesiDime, etc.)
  | 'FREE_TECHNICAL_DISCOVERY';   // Class D: RSS/Atom feeds, Sitemaps, Schema.org JSON-LD

import { CuelinksSyncStatus } from './cuelinks-v3-types.js';

export type DealVerificationStatus =
  | 'DISCOVERED'                  // Discovered from source, pending verification
  | 'PENDING_VERIFICATION'        // Queued for Level 1–5 cross-checking
  | 'VERIFIED'                    // Verified price, merchant, stock, and reference baseline
  | 'VERIFIED_WITH_CONDITIONS'    // Verified but requires coupon, card, or minimum order
  | 'UNCONFIRMED'                 // Observed, but reference discount is only merchant-claimed
  | 'UNVERIFIED'                  // Unverified key claims; kept out of public ranking
  | 'EXPIRED'                     // Offer expiry date has passed; removed from active rankings
  | 'OUT_OF_STOCK'                // Product confirmed out of stock
  | 'REJECTED'                    // Failed security, currency, or pricing sanity gates
  | 'RECHECK_REQUIRED';           // Stale observation requiring fresh fetch

export type DiscountVerificationType =
  | 'INDEPENDENT_CORROBORATED'    // Backed by multi-source reference price or verifiable historical MRP
  | 'MERCHANT_CLAIMED'            // Discount claimed by merchant against unsupported reference price
  | 'UNCONFIRMED';                // No reliable reference price found; ordinary current price

export type DealAvailability = 'IN_STOCK' | 'LIMITED_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';

export interface DealSourceRecord {
  id: string;
  domain: string;
  name: string;
  sourceClass: DealSourceClass;
  country: string;               // e.g. 'India'
  categories: string[];
  accessMethod: 'RSS_FEED' | 'JSON_LD_STRUCTURED' | 'OFFICIAL_FEED' | 'PUBLIC_PROMOTION' | 'API';
  documentationUrl?: string;
  permissionStatus: 'ALLOWED' | 'CONDITIONAL' | 'BLOCKED' | 'UNSUPPORTED';
  rateLimitPerMinute: number;
  trustScore: number;            // 0 to 100
  lastScanAt?: string;
  lastAttemptAt?: string;
  scanFrequencyHours: number;
  lastHttpStatus?: number;
  totalOffersFound: number;
  totalOffersRejected: number;
  failureCount: number;
  nextRetryAt?: string;
  exclusionReason?: string;
}

export interface DiscoveredDealInput {
  title: string;
  brand: string;
  merchant: string;
  category: string;
  productUrl: string;
  currentPriceINR: number;
  referencePriceINR?: number;
  claimedDiscountPercent?: number;
  couponCode?: string;
  couponConditions?: string;
  availability?: DealAvailability;
  geographicRestrictions?: string[];
  membershipRestrictions?: string;
  paymentRestrictions?: string;
  offerStart?: string;
  expiryDate?: string;
  observedAt?: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: DealSourceClass;
  rawSpecs?: Record<string, string>;
  modelOrSku?: string;
  isMonetizable?: boolean;
  trackingUrl?: string;
  affiliateNetwork?: string;
  affiliateCampaignId?: string;
}

export type DealCandidate = DiscoveredDealInput;

export interface NormalizedDeal {
  id: string;
  title: string;
  brand: string;
  merchant: string;
  category: string;
  productUrl: string;
  currentPriceINR: number;
  currency: 'INR';
  referencePriceINR?: number;
  claimedDiscountPercent?: number;
  verifiedDiscountPercent?: number;
  discountVerificationType: DiscountVerificationType;
  couponCode?: string;
  couponConditions?: string;
  availability: DealAvailability;
  geographicRestrictions: string[];
  membershipRestrictions?: string;
  paymentRestrictions?: string;
  offerStart?: string;
  expiryDate?: string;
  observedAt?: string;
  lastCheckedAt: string;
  sourceUrl: string;
  sourceDomain: string;
  sourceType: DealSourceClass;
  verificationStatus: DealVerificationStatus;
  confidenceScore: number;       // 0 to 100
  buyerValueScore: number;        // 0 to 100
  rejectionReasons: string[];
  isMonetizable: boolean;
  affiliateNetwork?: string;
  trackingUrl?: string;
  affiliateCampaignId?: string;
  modelOrSku?: string;
  evidenceJson: {
    sources: string[];
    priceHistory?: Array<{ price: number; observedAt: string }>;
    verificationLogs: string[];
    rawSpecs?: Record<string, string>;
    lastCorroboratedAt?: string;
    observedAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface DealQueryParams {
  q?: string;
  category?: string;
  merchant?: string;
  minPrice?: number;
  maxPrice?: number;
  verifiedOnly?: boolean;
  hasCoupon?: boolean;
  sortBy?: 'buyer_value' | 'freshness' | 'price_asc' | 'discount';
  page?: number;
  limit?: number;
}

// ==========================================
// 7-STAGE EVIDENCE-BASED COMMERCIAL FUNNEL (Spec §§ 1–15)
// DISCOVERY → PAGE VISIT → DEAL CLICK → PROVIDER CLICK → REPORTED CONVERSION → VALIDATED COMMISSION → PAID COMMISSION
// Strict separation of each counter; NO metric inferred or assumed from any other.
// ==========================================

export type CommercialFunnelStage =
  | 'DISCOVERY'
  | 'PAGE_VISIT'
  | 'DEAL_CLICK'
  | 'PROVIDER_CLICK'
  | 'REPORTED_CONVERSION'
  | 'VALIDATED_COMMISSION'
  | 'PAID_COMMISSION';

export interface FunnelStageDetail {
  stage: CommercialFunnelStage;
  name: string;
  countOrAmount: number;
  unit: 'COUNT' | 'INR';
  evidenceSource: string;
  description: string;
  status: 'ACTIVE' | 'ZERO' | 'BLOCKED';
}

export interface SevenStageCommercialFunnel {
  // Stage 1: Discovery impressions / collected offers
  discoveryImpressions: number;
  // Stage 2: Public page visits (via referral beacon / pageviews)
  publicPageVisits: number;
  // Stage 3: Deal card clicks (local click beacon)
  dealCardClicks: number;
  // Stage 4: Provider-attributed clicks (from Cuelinks /reports)
  providerAttributedClicks: number;
  // Stage 5: Reported conversions (from Cuelinks /transactions)
  reportedConversions: number;
  // Stage 6: Validated commissions in INR
  validatedCommissionsINR: number;
  // Stage 7: Paid commissions in INR
  paidCommissionsINR: number;

  // Supplementary strictly separated accounting counters
  pendingCommissionsINR: number;
  reversedCommissionsINR: number; // Reversed / rejected commissions in INR
  cashReceivedINR: number; // Strictly ₹0.00 until bank statement proof

  lastUpdated: string;
  stageBreakdown: Record<CommercialFunnelStage, FunnelStageDetail>;
}

// ==========================================
// STRUCTURED GROWTH EXPERIMENT TRACKING MODEL
// Tracks hypotheses, changes tested, categories/campaigns targeted,
// observed outcomes over 6-hour commercial cycles, and automated decisions (scale, refine, halt).
// ==========================================

export type GrowthExperimentDecision = 'SCALE' | 'REFINE' | 'HALT' | 'INCONCLUSIVE';

export type GrowthExperimentStatus = 'DRAFT' | 'ACTIVE' | 'CONCLUDED' | 'PAUSED';

export type GrowthExperimentChangeType =
  | 'COPY'                   // Offer title, hook, or call to action copy
  | 'BADGE'                  // Verification badge, discount pill, coupon tag
  | 'RANKING_WEIGHT'         // Weight of discount vs merchant trust in buyer-value algorithm
  | 'CATEGORY_FOCUS'         // Highlighting specific categories (e.g. Electronics vs Audio)
  | 'PRICING_ANCHOR'         // Reference MRP vs recent observed average price
  | 'PROMO_CODE_EXPOSURE';   // Prominent one-click copy vs condition disclaimer

export interface GrowthExperimentChange {
  changeType: GrowthExperimentChangeType;
  description: string;
  baselineConfig: Record<string, any>;
  treatmentConfig: Record<string, any>;
}

export interface CommercialCycleMetricBucket {
  discoveryImpressions: number;
  pageVisits: number;
  dealClicks: number;
  providerClicks: number;
  conversions: number;
  validatedCommissionINR: number;
}

export interface CommercialCycleOutcome {
  cycleId: string;
  cycleNumber: number;
  startTime: string;
  endTime: string;
  durationHours: number; // 6 hours
  baseline: CommercialCycleMetricBucket;
  treatment: CommercialCycleMetricBucket;
  observedMetrics: {
    baselineCtrPercent: number;      // dealClicks / pageVisits
    treatmentCtrPercent: number;     // dealClicks / pageVisits
    ctrUpliftPercent: number;
    baselineEpcINR: number;          // validatedCommissionINR / providerClicks
    treatmentEpcINR: number;         // validatedCommissionINR / providerClicks
    epcUpliftPercent: number;
    statisticalConfidence: number;   // 0.0 to 1.0
  };
  notes?: string;
}

export interface GrowthExperimentRecord {
  id: string;
  organizationId: string;
  businessId: string;
  title: string;
  hypothesis: string;
  changeTested: GrowthExperimentChange;
  targetCategories: string[];
  targetCampaignIds: string[];
  targetMerchants?: string[];
  status: GrowthExperimentStatus;
  minimumEvidenceRequirement: number;
  currentCycleCount: number;
  createdAt: string;
  startedAt?: string;
  concludedAt?: string;
  cycleOutcomes: CommercialCycleOutcome[];
  cumulativeMetrics: {
    baselineTotalVisits: number;
    treatmentTotalVisits: number;
    baselineTotalClicks: number;
    treatmentTotalClicks: number;
    baselineTotalConversions: number;
    treatmentTotalConversions: number;
    baselineTotalCommissionINR: number;
    treatmentTotalCommissionINR: number;
    overallCtrUpliftPercent: number;
    overallConversionUpliftPercent: number;
    overallEpcUpliftPercent: number;
  };
  automatedDecision: {
    decision: GrowthExperimentDecision;
    decidedAt?: string;
    rationale: string;
    actionTaken?: string;
    confidence: number;
  };
}

export interface CreateGrowthExperimentInput {
  organizationId?: string;
  businessId?: string;
  title: string;
  hypothesis: string;
  changeTested: GrowthExperimentChange;
  targetCategories: string[];
  targetCampaignIds: string[];
  targetMerchants?: string[];
  minimumEvidenceRequirement?: number;
}

export interface CycleObservationInput {
  cycleId: string;
  cycleNumber?: number;
  startTime?: string;
  endTime?: string;
  durationHours?: number; // Defaults to 6
  baseline: CommercialCycleMetricBucket;
  treatment: CommercialCycleMetricBucket;
  notes?: string;
}

export interface DealEngineObservabilityMetrics {
  sources: {
    totalDiscovered: number;
    allowed: number;
    conditional: number;
    blocked: number;
    unsupported: number;
    scannedSuccessfully: number;
    failing: number;
    failureReasons: Record<string, number>;
  };
  offers: {
    rawCollected: number;
    uniqueProducts: number;
    uniqueOffers: number;
    verified: number;
    verifiedWithConditions: number;
    unconfirmed: number;
    rejected: number;
    expired: number;
    outOfStock: number;
    duplicateRatePercent: number;
    staleRatePercent: number;
    primaryMerchantSourcePercent: number;
    independentCorroborationPercent: number;
  };
  monetization: {
    affiliateEligible: number;
    withAuthorizedTracking: number;
    directMerchantLinks: number;
    publishedDealPages: number;
    clicksRecorded: number;
    providerAttributedClicks?: number;
    providerAttributedConversions: number;
    confirmedCommissionsINR: number;
    reversedCommissionsINR?: number;
    paidCommissionsINR?: number;
    cashReceivedINR: number; // Strictly ₹0.00 until bank statement proof
  };
  funnel: SevenStageCommercialFunnel;
  growthExperiments?: GrowthExperimentRecord[];
  execution: {
    lastCycleId: string;
    lastScanAt: string;
    nextScheduledRun: string;
    durationMs: number;
    activeBlockersCount: number;
    status: string;
  };
  cuelinksSync?: CuelinksSyncStatus;
}
