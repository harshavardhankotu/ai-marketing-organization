/**
 * Autonomous Commission & Referral Revenue Engine (Phase 1)
 * Domain Types and State Models
 */

export type PartnerType = 'AFFILIATE' | 'REFERRAL' | 'CPL' | 'CLOSED_SALE';
export type CommissionType = 'PERCENTAGE' | 'FIXED' | 'HYBRID';
export type QualifyingEvent = 'PURCHASE' | 'QUALIFIED_LEAD' | 'APPLICATION' | 'BOOKING';
export type PartnerApprovalStatus =
  | 'NOT_APPLIED'
  | 'APPLICATION_SUBMITTED'
  | 'TRACKING_ID_ISSUED'
  | 'QUALIFYING_SALES_IN_PROGRESS'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'PROVISIONAL'
  | 'PENDING';

/** Phase 2: monetization network identity */
export type PartnerNetwork =
  | 'AMAZON_ASSOCIATES'
  | 'EBAY_PARTNER_NETWORK'
  | 'DIRECT_REFERRAL'
  | 'CPL_PARTNER'
  | 'VCOMMISSION'
  | 'CUELINKS'
  | 'EARNKARO'
  | 'OTHER_AUTHORIZED_PARTNER';

/** Phase 2: how attribution is carried to the provider */
export type PartnerTrackingType =
  | 'AFFILIATE_LINK'
  | 'REFERRAL_LINK'
  | 'COUPON_CODE'
  | 'API_ATTRIBUTION';

/** Phase 2: explicit authorization — AI discovery alone never authorizes */
export type PartnerAuthorizationStatus = 'AUTHORIZED' | 'PENDING_REVIEW' | 'REVOKED';

export interface Partner {
  id: string;
  organizationId: string;
  name: string;
  industry: string;
  country: string;
  city?: string;
  website: string;
  partnerType: PartnerType;
  programName?: string;
  commissionType: CommissionType;
  commissionRate?: number;
  fixedCommissionINR?: number;
  cookieWindowDays: number;
  qualifyingEvent: QualifyingEvent;
  approvalStatus: PartnerApprovalStatus;
  activeStatus: number; // 1 = active, 0 = inactive
  source: string;
  termsUrl?: string;
  disclosureRequired: number; // 1 = required, 0 = optional
  // Phase 2 production-grade fields
  network: PartnerNetwork;
  trackingType: PartnerTrackingType;
  authorizationStatus: PartnerAuthorizationStatus;
  programUrl?: string;
  coverage: string;
  category?: string;
  destinationRequirements?: string;
  evidence: Record<string, any>;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Phase 2: offer lifecycle — only ACTIVE is usable in production */
export type PartnerOfferStatus =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'PAUSED'
  | 'EXPIRED'
  | 'REJECTED';

export interface PartnerOffer {
  id: string;
  partnerId: string;
  organizationId: string;
  title: string;
  offerSlug: string;
  category: string;
  targetCustomer: string;
  priceINR?: number;
  priceRange?: string;
  commissionModel: 'PERCENTAGE' | 'FIXED';
  commissionAmountINR: number;
  conversionAction: string;
  destinationUrl: string;
  authorizedTrackingUrl: string;
  geographicAvailability: string;
  evidence: Record<string, any>;
  active: number; // 1 = active, 0 = inactive (legacy mirror of status)
  // Phase 2 production-grade fields
  status: PartnerOfferStatus;
  description: string;
  currency: string;
  availability: string;
  lastVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Referral {
  id: string;
  partnerId: string;
  offerId: string;
  organizationId: string;
  anonymousSessionId?: string;
  clickId: string;
  trackingParameters: Record<string, string>;
  landingPage?: string;
  source?: string;
  campaign?: string;
  destinationUrl: string;
  // Phase 2 first-class attribution (anonymous, no PII)
  ip?: string;
  userAgent?: string;
  referer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  contentAssetId?: string;
  placement?: string;
  deviceClass?: string;
  country?: string;
  keyword?: string;
  createdAt: string;
}

/** Phase 2: immutable append-only referral click event (never updated) */
export interface ReferralClickEvent {
  id: string;
  referralId: string;
  clickId: string;
  organizationId: string;
  offerId: string;
  partnerId: string;
  contentAssetId?: string;
  placement?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  keyword?: string;
  referrer?: string;
  deviceClass?: string;
  country?: string;
  destinationUrl: string;
  createdAt: string;
}

/**
 * Explicit Commercial State Lifecycle (§ 3, Phase 2 Task 10).
 * CLICKED / EXPECTED / CONVERSION_REPORTED carry ₹0 realized revenue.
 * COMMISSION_PENDING is not realized revenue.
 * Only COMMISSION_APPROVED (verified) and COMMISSION_PAID (cash) are revenue.
 */
export type CommissionStatus =
  | 'CLICKED'
  | 'EXPECTED'
  | 'CONVERSION_REPORTED'
  | 'DISCOVERED'
  | 'QUALIFIED_DEMAND'
  | 'RECOMMENDATION_PRESENTED'
  | 'REFERRAL_CLICKED'
  | 'EXTERNAL_CONVERSION_PENDING'
  | 'COMMISSION_PENDING'
  | 'COMMISSION_APPROVED'
  | 'COMMISSION_PAID'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'CHARGEBACK'
  | 'UNVERIFIED';

export type VerificationSource =
  | 'PARTNER_API'
  | 'WEBHOOK'
  | 'DASHBOARD_EXPORT'
  | 'MANUAL_VERIFICATION'
  | 'REFERENCE_CODE';

export interface CommissionRecord {
  id: string;
  referralId?: string;
  partnerId: string;
  offerId?: string;
  organizationId: string;
  externalTransactionId?: string;
  eventType: string;
  externalStatus: string;
  expectedCommissionINR: number;
  verifiedCommissionINR: number;
  receivedCommissionINR: number;
  verificationSource: VerificationSource;
  evidence: Record<string, any>;
  status: CommissionStatus;
  createdAt: string;
  verifiedAt?: string;
  paidAt?: string;
  updatedAt: string;
}

export type ContentAssetType =
  | 'COMPARISON'
  | 'RECOMMENDATION'
  | 'GUIDE'
  | 'SERVICE_DIRECTORY'
  | 'OFFER_DETAIL';

export interface ContentAsset {
  id: string;
  organizationId: string;
  slug: string;
  assetType: ContentAssetType;
  title: string;
  category: string;
  location?: string;
  intentTarget: string;
  contentMarkdown: string;
  primaryOfferId?: string;
  matchedOfferIds: string[];
  disclosureMarkdown: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'PUBLISH_READY';
  viewCount: number;
  referralClickCount: number;
  createdAt: string;
  updatedAt: string;
}

export type DemandIntentType = 'SEARCH_QUERY' | 'PROBLEM_DESCRIPTION' | 'PRODUCT_COMPARISON';

/** Phase 2 Task 12: commercial intent classes for demand signals */
export type DemandIntentClass =
  | 'RESEARCH'
  | 'COMPARISON'
  | 'PRICE'
  | 'PURCHASE'
  | 'LOCAL_SERVICE'
  | 'URGENT'
  | 'SUBSCRIPTION'
  | 'B2B'
  | 'LOW_INTENT'
  | 'HIGH_INTENT';

export interface DemandSignal {
  id: string;
  organizationId: string;
  topic: string;
  category: string;
  location?: string;
  intentType: DemandIntentType;
  rawQuery: string;
  evidenceSnippet: string;
  sourceUrl: string;
  urgency: number;
  estimatedMonthlyVolume: number;
  status: 'DISCOVERED' | 'MATCHED' | 'ADDRESSED' | 'QUARANTINED';
  // Phase 2 Task 12: classified commercial intent
  intentClass: DemandIntentClass;
  commercialScore: number;
  createdAt: string;
}

export interface DemandMatchResult {
  offer: PartnerOffer;
  partner: Partner;
  matchScore: number;
  relevanceScore: number;
  expectedNetRevenueINR: number;
  reason: string;
  evidence: string;
  disclosureRequired: boolean;
}

export interface CommissionLedgerSummary {
  clicks: number;
  qualifiedReferrals: number;
  externalConversions: number;
  pendingCommissionsCount: number;
  approvedCommissionsCount: number;
  paidCommissionsCount: number;
  rejectedCommissionsCount: number;
  refundedCommissionsCount: number;

  /** Predicted / expected earnings — never counted as revenue */
  expectedCommissionINR: number;

  /** Confirmed by provider/network — REAL revenue */
  verifiedRevenueINR: number;

  /** Cash received into bank account */
  receivedCashINR: number;

  commissionPerReferralINR: number;
  commissionConversionRate: number;
  revenuePer1000VisitorsINR: number;
}
