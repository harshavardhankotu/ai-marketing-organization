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

export interface CuelinksPingPublisher {
  id?: number | string;
  publisher_id?: number | string;
  currency?: string;
  name?: string;
  email?: string;
}

export interface CuelinksPingApiKey {
  scopes?: string[] | CuelinksScope[];
  last_used_at?: string;
}

export interface CuelinksPingResponse {
  status?: string;
  message?: string;
  publisher?: CuelinksPingPublisher;
  api_key?: CuelinksPingApiKey;
  // Legacy flat fields for backward compatibility
  publisher_id?: string | number;
  email?: string;
  scopes?: CuelinksScope[] | string[];
  name?: string;
  currency?: string;
  last_used_at?: string;
  [key: string]: any;
}

export interface CuelinksPingResult {
  connected: boolean;
  message: string;
  publisherId?: string | number;
  publisherName?: string;
  currency?: string;
  email?: string;
  scopes?: string[];
  lastUsedAt?: string;
  publisher?: CuelinksPingPublisher;
  apiKey?: CuelinksPingApiKey;
}

export interface CuelinksPaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  next_page: number | null;
  prev_page: number | null;
}

export interface CuelinksOfferCategory {
  id: number | string;
  name: string;
}

export interface CuelinksCampaign {
  id: number | string;
  name: string;
  merchant_name?: string;
  domain?: string;
  url: string;
  status: 'active' | 'paused' | 'inactive' | 'closed';
  access_status: 'open' | 'applied' | 'approved' | 'rejected' | 'restricted' | 'not_applied';
  payout?: string;
  payout_type?: string;
  payout_currency?: string;
  campaign_type?: string;
  reporting_type?: string;
  epc_7d?: string | number;
  epc_90d?: string | number;
  categories?: Array<CuelinksOfferCategory | string>;
  countries?: Array<{ id: number; iso: string; name: string } | string>;
  deeplink_allowed?: boolean;
  sub_ids_allowed?: boolean;
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
  description?: string | null;
  terms?: string | null;
  coupon_code?: string | null;
  offer_type?: string | null;
  categories?: CuelinksOfferCategory[] | string[];
  tracking_url?: string;
  status?: string;
  start_date?: string | null;
  end_date?: string | null;
  original_price?: number | string | null;
  discount_price?: number | string | null;
  percent_off?: number | string | null;
  shipping_charge?: number | string | null;
  valid_on?: string | null;
  created_at?: string;
  updated_at?: string;

  // Backward compatibility fields for mock tests
  url?: string;
  category?: string;
  current_price_inr?: number;
  reference_price_inr?: number;
  discount?: string;
  discount_type?: string;
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

export type CuelinksSyncStatusCode =
  | 'IDLE'
  | 'SYNCING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'RETRY_WAIT'
  | 'BLOCKED_CONFIGURATION'
  | 'FAILED_PERMANENTLY'
  | 'BLOCKED_AUTHORIZATION'
  | 'ERROR';

export type CuelinksErrorClass =
  | 'AUTH_FAILURE'
  | 'PERMISSION_MISSING'
  | 'RATE_LIMITED'
  | 'PROVIDER_SERVER_ERROR'
  | 'NETWORK_TIMEOUT'
  | 'EMPTY_RESULTS'
  | 'INVALID_RESPONSE';

export interface CuelinksTelemetryRecord {
  errorClass?: CuelinksErrorClass;
  attemptCount: number;
  lastError?: string;
  nextRetryAt?: string;
  status?: string;
  recordedAt?: string;
  partialFailureReasons?: string[];
}

export interface CuelinksPaginationCursor {
  campaignPage: number;
  offerPage: number;
  hasMoreCampaigns?: boolean;
  hasMoreOffers?: boolean;
  lastUpdated?: string;
}

export interface CuelinksPaginatedSyncOptions {
  cursor?: CuelinksPaginationCursor;
  batchSize?: number;
  maxPages?: number;
  organizationId?: string;
  businessId?: string;
}

export interface CuelinksPaginatedSyncResult {
  success: boolean;
  reason?: string;
  status: CuelinksSyncStatus;
  dealCandidates: any[];
  nextCursor?: CuelinksPaginationCursor;
  hasMore: boolean;
  errorClass?: CuelinksErrorClass;
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
  status: 'IDLE' | 'SYNCING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'RETRY_WAIT' | 'BLOCKED_CONFIGURATION' | 'FAILED_PERMANENTLY' | 'BLOCKED_AUTHORIZATION' | 'ERROR';
  reconciliation: CuelinksReconciliationMetrics;
  ownerActionRequired?: string;
  telemetry?: CuelinksTelemetryRecord;
}
