/**
 * Cuelinks V3 API & MCP Integration Types
 * Specification: Cuelinks V3 Monetization API (https://developers.cuelinks.com/docs)
 * Scopes: read:campaigns, read:offers, write:links, read:transactions, read:reports, read:channels, write:channels
 */

export type CuelinksScope =
  | 'read:campaigns'
  | 'read:offers'
  | 'write:links'
  | 'read:transactions'
  | 'read:reports'
  | 'read:channels'
  | 'write:channels'
  | 'read:invoices'
  | 'read:missing_transactions'
  | 'write:missing_transactions';

export const CUELINKS_STANDARD_SCOPES: CuelinksScope[] = [
  'read:campaigns',
  'read:offers',
  'write:links',
  'read:channels',
  'write:channels',
  'read:reports',
  'read:transactions'
];

export interface CuelinksPingResponse {
  status?: string;
  publisher_id?: string | number;
  email?: string;
  scopes?: CuelinksScope[] | string[];
  message?: string;
  [key: string]: any;
}

export interface CuelinksPingResult {
  connected: boolean;
  message: string;
  publisherId?: string | number;
  email?: string;
  scopes?: string[];
}

export interface CuelinksCampaign {
  id: number | string;
  name: string;
  merchant_name?: string;
  domain?: string;
  url: string;
  status: 'active' | 'paused' | 'inactive' | 'closed';
  access_status: 'open' | 'applied' | 'approved' | 'rejected' | 'restricted';
  payout?: string;
  payout_type?: string;
  epc_7d?: string | number;
  categories?: string[];
  countries?: string[];
  terms?: string;
  tracking_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CuelinksOffer {
  id: number | string;
  campaign_id: number | string;
  campaign_name?: string;
  title: string;
  url: string;
  coupon_code?: string;
  discount?: string;
  discount_type?: string;
  start_date?: string;
  end_date?: string;
  terms?: string;
  status?: string;
  category?: string;
  current_price_inr?: number;
  reference_price_inr?: number;
  image_url?: string;
}

export interface CuelinksLinkConvertRequest {
  url: string;
  channel_id?: number | string;
  subid?: string;
  subid2?: string;
  subid3?: string;
  subid4?: string;
  subid5?: string;
  shorten?: boolean;
  /** @deprecated Official Cuelinks V3 uses `shorten`. Kept for backward compatibility. */
  short_url?: boolean;
}

export interface CuelinksLinkConvertResponse {
  short_url?: string;
  url?: string;
  tracking_url?: string;
  affiliated: boolean;
  campaign?: {
    id: number | string;
    name: string;
  };
}

export interface CuelinksChannel {
  id: number | string;
  name: string;
  url: string;
  type?: string;
  status: 'active' | 'pending' | 'rejected';
  created_at?: string;
}

export interface CuelinksTransaction {
  id: string;
  campaign_id: number | string;
  campaign_name: string;
  subid?: string;
  subid2?: string;
  subid3?: string;
  order_amount?: number;
  commission_amount: number;
  currency: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  transaction_date: string;
  validation_date?: string;
  payout_date?: string;
}

export interface CuelinksReport {
  date?: string;
  campaign_id?: number | string;
  campaign_name?: string;
  clicks: number;
  conversions: number;
  commission: number;
  epc: number;
}

export interface CuelinksCategory {
  id: number | string;
  name: string;
  slug?: string;
}

export interface CuelinksCountry {
  id: number | string;
  name: string;
  code: string;
}

export interface CuelinksReconciliationMetrics {
  localClicks: number;
  providerAttributedClicks: number;
  reportedConversions: number;
  pendingCommissionINR: number;
  validatedCommissionINR: number;
  reversedCommissionINR: number;
  paidCommissionINR: number;
  cashReceivedINR: number;
}

export interface CuelinksSyncStatus {
  configured: boolean;
  connected: boolean;
  publisherId?: string | number;
  email?: string;
  scopes?: string[];
  channel: {
    id?: string | number;
    name?: string;
    url?: string;
    status: string;
  };
  campaignsDiscovered: number;
  eligibleCampaignsCount: number;
  offersRetrieved: number;
  linksConverted: number;
  lastSyncTimestamp: string;
  status: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'BLOCKED_AUTHORIZATION' | 'ERROR';
  reconciliation: CuelinksReconciliationMetrics;
  ownerActionRequired?: string;
}
