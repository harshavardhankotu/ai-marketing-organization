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
    providerAttributedConversions: number;
    confirmedCommissionsINR: number;
    cashReceivedINR: number;
  };
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
