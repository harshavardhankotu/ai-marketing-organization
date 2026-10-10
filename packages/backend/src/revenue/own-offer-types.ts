/**
 * Own Offer and Manual Razorpay Types
 * Phase 2 Task 5: Zero API Access / Manual Link Mode
 */

export interface OwnOffer {
  id: string;
  organizationId: string;
  offerType: 'OWN_OFFER';
  paymentMode: 'MANUAL_LINK';
  name: string;
  oneSentencePromise: string;
  priceINR: number;
  priceSetDate: string; // ISO date string when owner typed price
  refundPolicyText: string;
  deliveryMethod: 'OWNER_MANUAL';
  paymentLinkUrl: string; // strictly rzp.io or razorpay.com
  categoryAttestation: boolean; // owner attestation that offer matches Razorpay account category
  whatBuyerGets: string[];
  whoItIsFor: string[];
  whoShouldNotBuy: string[];
  contactEmail: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OwnOfferClickEvent {
  id: string;
  offerId: string;
  refId: string;
  timestamp: string;
  ipHash: string;
  userAgent?: string;
  isRevenue: false; // Invariant: Outbound clicks are never revenue
}

export interface RazorpayPaymentExportRow {
  paymentId: string;
  amountINR: number;
  status: 'captured' | 'failed' | 'authorized' | 'refunded';
  captured: boolean;
  settled?: boolean;
  createdAt: string;
  email?: string;
  contact?: string;
  method?: string;
  isTest?: boolean;
  notes?: Record<string, string>;
}

export interface ManualReconciliationResult {
  rowsProcessed: number;
  verifiedCount: number;
  verifiedRevenueINR: number;
  paidCount: number;
  paidRevenueINR: number;
  refundedCount: number;
  refundedRevenueINR: number;
  testRowsExcluded: number;
  errors: string[];
}
