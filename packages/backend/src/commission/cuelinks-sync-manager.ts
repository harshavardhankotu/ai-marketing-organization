/**
 * Cuelinks Synchronization & Monetization Manager
 * Orchestrates autonomous campaign discovery, channel registration, offer ingestion,
 * authorized link conversion, and transactional performance reconciliation.
 * Reuses Cloudflare D1 workflows table (workflow_type = 'CUELINKS_SYNC', 'CUELINKS_CAMPAIGN').
 */

import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { CuelinksV3Client } from './cuelinks-v3-client.js';
import {
  CuelinksSyncStatus,
  CuelinksSyncStatusCode,
  CuelinksCampaign,
  CuelinksOffer,
  CuelinksChannel,
  CuelinksReconciliationMetrics,
  CuelinksErrorClass,
  CuelinksPaginationCursor,
  CuelinksPaginatedSyncOptions,
  CuelinksPaginatedSyncResult,
  CuelinksTelemetryRecord,
  CuelinksCapabilityState,
  CuelinksCapabilitiesMap,
  CUELINKS_REQUIRED_SCOPES
} from './cuelinks-v3-types.js';
import { DealCandidate } from './deal-types.js';

export { CUELINKS_REQUIRED_SCOPES };

export interface VerifiedScopeResult {
  connected: boolean;
  channelId?: number;
  channelStatus?: string;
  hasRequiredScopes: boolean;
  isEmpiricallyVerified: boolean;
  scopes: string[];
  missingScopes: string[];
  forbiddenScopes: string[];
  scopeErrorReason?: string;
}

export class CuelinksSyncManager {
  private static instance: CuelinksSyncManager | null = null;
  private client: CuelinksV3Client;
  private syncStatus: CuelinksSyncStatus;
  private attemptCount: number = 0;
  private empiricallyVerifiedScopes: Set<string> = new Set();
  private forbiddenScopes: Set<string> = new Set();
  private scopeErrorReasons: Map<string, string> = new Map();
  private lastReconciledSince?: string;
  private capabilities: CuelinksCapabilitiesMap = {
    campaignDiscovery: 'NOT_TESTED',
    linkConversion: 'NOT_TESTED',
    offerPagination: 'NOT_TESTED',
    channelVerification: 'NOT_TESTED',
    transactionReconciliation: 'NOT_TESTED',
    reporting: 'NOT_TESTED'
  };

  public getCapabilities(): CuelinksCapabilitiesMap {
    return { ...this.capabilities };
  }

  public updateCapability(cap: keyof CuelinksCapabilitiesMap, state: CuelinksCapabilityState): void {
    this.capabilities[cap] = state;
  }

  public async verifyLinkConversionCapability(testUrl: string = 'https://www.boat-lifestyle.com/products/airdopes-141'): Promise<boolean> {
    try {
      const channelRes = await this.getApprovedChannel();
      if (!channelRes.approved || !channelRes.channel?.id) {
        this.updateCapability('linkConversion', 'PERMISSION_MISSING');
        return false;
      }
      const convRes = await this.client.convertLink({
        url: testUrl,
        channel_id: Number(channelRes.channel.id),
        subid: 'cap_verify_test',
        shorten: false
      });
      if (convRes && convRes.affiliated && convRes.tracking_url && CuelinksV3Client.isAllowedTrackingUrl(convRes.tracking_url)) {
        this.recordScopeSuccess('write:links');
        this.updateCapability('linkConversion', 'AVAILABLE');
        return true;
      }
      this.updateCapability('linkConversion', 'PROVIDER_ERROR');
      return false;
    } catch (err: any) {
      if (err.statusCode === 403 || err.code === 'CUELINKS_FORBIDDEN') {
        this.recordScopeForbidden('write:links', err.message);
        this.updateCapability('linkConversion', 'PERMISSION_MISSING');
      } else if (err.statusCode === 401 || err.code === 'CUELINKS_UNAUTHORIZED') {
        this.updateCapability('linkConversion', 'AUTH_FAILURE');
      } else {
        this.updateCapability('linkConversion', 'PROVIDER_ERROR');
      }
      return false;
    }
  }

  public recordScopeSuccess(scope: string): void {
    this.empiricallyVerifiedScopes.add(scope);
    this.forbiddenScopes.delete(scope);
    this.scopeErrorReasons.delete(scope);
    if (!this.syncStatus.scopes) {
      this.syncStatus.scopes = [];
    }
    if (!this.syncStatus.scopes.includes(scope)) {
      this.syncStatus.scopes.push(scope);
    }
  }

  public recordScopeForbidden(scope: string, reason?: string): void {
    this.forbiddenScopes.add(scope);
    this.empiricallyVerifiedScopes.delete(scope);
    if (reason) {
      this.scopeErrorReasons.set(scope, reason);
    }
    if (this.syncStatus && this.syncStatus.scopes) {
      this.syncStatus.scopes = this.syncStatus.scopes.filter(s => s !== scope);
    }
  }

  public verifyNetworkScopes(rawStatus: {
    connected?: boolean;
    channelId?: number;
    channelStatus?: string;
    hasScopes?: boolean;
    scopes?: string[];
  }): VerifiedScopeResult {
    const pingScopes = Array.isArray(rawStatus.scopes) && rawStatus.scopes.length > 0 ? rawStatus.scopes : [];
    const hasPingScopes = pingScopes.length > 0;

    const effectiveScopes = new Set<string>([...pingScopes, ...this.empiricallyVerifiedScopes]);
    for (const f of this.forbiddenScopes) {
      effectiveScopes.delete(f);
    }

    const missingScopes = CUELINKS_REQUIRED_SCOPES.filter(
      s => !effectiveScopes.has(s) || this.forbiddenScopes.has(s)
    );

    const isEmpiricallyVerified = this.empiricallyVerifiedScopes.size > 0 && !hasPingScopes;
    const hasRequiredScopes = (rawStatus.hasScopes === true || (this.forbiddenScopes.size === 0 && missingScopes.length === 0)) && this.forbiddenScopes.size === 0 && missingScopes.length === 0;

    const reasons = Array.from(this.scopeErrorReasons.values());
    const scopeErrorReason = reasons.length > 0 ? reasons.join('; ') : undefined;

    return {
      connected: Boolean(rawStatus.connected),
      channelId: rawStatus.channelId,
      channelStatus: rawStatus.channelStatus,
      hasRequiredScopes,
      isEmpiricallyVerified,
      scopes: Array.from(effectiveScopes),
      missingScopes,
      forbiddenScopes: Array.from(this.forbiddenScopes),
      scopeErrorReason
    };
  }

  constructor(client?: CuelinksV3Client) {
    this.client = client || CuelinksV3Client.getInstance();
    const isConf = this.client.isConfigured();
    this.syncStatus = {
      configured: isConf,
      connected: false,
      channel: { status: 'UNKNOWN' },
      campaignsDiscovered: 0,
      eligibleCampaignsCount: 0,
      offersRetrieved: 0,
      linksConverted: 0,
      lastSyncTimestamp: 'NEVER',
      status: isConf ? 'IDLE' : 'BLOCKED_CONFIGURATION',
      reconciliation: {
        localClicks: 0,
        providerAttributedClicks: 0,
        reportedConversions: 0,
        pendingCommissionINR: 0,
        validatedCommissionINR: 0,
        reversedCommissionINR: 0,
        paidCommissionINR: 0,
        cashReceivedINR: 0
      },
      ownerActionRequired: isConf
        ? undefined
        : 'Provide CUELINKS_API_KEY in environment variables or Render dashboard to enable automated Cuelinks campaign discovery and affiliate link conversion.',
      telemetry: {
        attemptCount: 0,
        errorClass: undefined,
        lastError: undefined,
        nextRetryAt: undefined,
        status: isConf ? 'IDLE' : 'BLOCKED_CONFIGURATION'
      }
    };
  }

  public static getInstance(client?: CuelinksV3Client): CuelinksSyncManager {
    if (!CuelinksSyncManager.instance) {
      CuelinksSyncManager.instance = new CuelinksSyncManager(client);
    } else if (client) {
      CuelinksSyncManager.instance.client = client;
    }
    return CuelinksSyncManager.instance;
  }

  public static resetInstance(): void {
    CuelinksSyncManager.instance = null;
  }

  public getStatus(): CuelinksSyncStatus {
    this.syncStatus.configured = this.client.isConfigured();
    const effectiveScopes = this.syncStatus.scopes || Array.from(this.empiricallyVerifiedScopes);
    return {
      ...this.syncStatus,
      scopes: effectiveScopes,
      capabilities: this.getCapabilities()
    };
  }

  public getAttemptCount(): number {
    return this.attemptCount;
  }

  public resetAttemptCount(): void {
    this.attemptCount = 0;
  }

  /**
   * Record a local deal card click beacon event (Stage 3).
   * Strictly tracks locally observed clicks independently from provider reporting.
   */
  public recordLocalClick(): void {
    this.syncStatus.reconciliation.localClicks++;
  }

  /**
   * Reset reconciliation metrics to clean state (for hermetic test isolation).
   */
  public resetReconciliation(): void {
    this.syncStatus.reconciliation = {
      localClicks: 0,
      providerAttributedClicks: 0,
      reportedConversions: 0,
      pendingCommissionINR: 0,
      validatedCommissionINR: 0,
      payableCommissionINR: 0,
      invoicedCommissionINR: 0,
      providerPaidCommissionINR: 0,
      reversedCommissionINR: 0,
      paidCommissionINR: 0,
      cashReceivedINR: 0
    };
  }

  /**
   * Update or inject reconciliation metrics (for synchronized cycle updates).
   * Invariant: cashReceivedINR is strictly ₹0.00 until bank statement proof.
   */
  public setReconciliationMetrics(metrics: Partial<CuelinksReconciliationMetrics>): void {
    this.syncStatus.reconciliation = {
      ...this.syncStatus.reconciliation,
      ...metrics,
      cashReceivedINR: 0 // strictly ₹0.00 until bank confirmed
    };
  }

  /**
   * Classify errors into canonical operational classes (WORKSTREAM D).
   */
  public classifyError(err: any): CuelinksErrorClass {
    if (!err) return 'INVALID_RESPONSE';
    const msg = (typeof err === 'string' ? err : (err.message || String(err))).toUpperCase();
    const code = (err.code || '').toUpperCase();
    const status = typeof err.statusCode === 'number' ? err.statusCode : (typeof err.status === 'number' ? err.status : 0);

    if (
      status === 401 ||
      code === 'CUELINKS_UNAUTHORIZED' ||
      msg.includes('UNAUTHORIZED') ||
      msg.includes('401') ||
      msg.includes('TOKEN') ||
      msg.includes('AUTH_FAILURE')
    ) {
      return 'AUTH_FAILURE';
    }
    if (
      status === 403 ||
      code === 'CUELINKS_FORBIDDEN' ||
      msg.includes('FORBIDDEN') ||
      msg.includes('SCOPE') ||
      msg.includes('403') ||
      msg.includes('PERMISSION_MISSING')
    ) {
      return 'PERMISSION_MISSING';
    }
    if (
      status === 429 ||
      code === 'CUELINKS_RATE_LIMITED' ||
      msg.includes('RATE_LIMIT') ||
      msg.includes('TOO MANY REQUESTS') ||
      msg.includes('429')
    ) {
      return 'RATE_LIMITED';
    }
    if (
      (status >= 500 && status <= 599) ||
      code === 'CUELINKS_SERVER_ERROR' ||
      msg.includes('SERVER_ERROR') ||
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503')
    ) {
      return 'PROVIDER_SERVER_ERROR';
    }
    if (code === 'CUELINKS_TIMEOUT' || msg.includes('TIMEOUT') || msg.includes('ABORT') || status === 408) {
      return 'NETWORK_TIMEOUT';
    }
    if (code === 'CUELINKS_EMPTY_RESULTS' || msg.includes('EMPTY_RESULTS')) {
      return 'EMPTY_RESULTS';
    }
    if (
      code === 'CUELINKS_UNPROCESSABLE_ENTITY' ||
      status === 422 ||
      msg.includes('UNPROCESSABLE') ||
      msg.includes('MALFORMED') ||
      msg.includes('INVALID')
    ) {
      return 'INVALID_RESPONSE';
    }
    if (msg.includes('NETWORK') || msg.includes('FETCH')) {
      return 'NETWORK_TIMEOUT';
    }
    return 'INVALID_RESPONSE';
  }

  /**
   * Calculate exponential backoff with jitter (WORKSTREAM D).
   * Backs off exponentially based on attemptCount: baseDelay * 2^(attempt-1), bounded by maxDelaySec.
   * Full jitter is applied up to 25% of delay to avoid thundering herds.
   */
  public calculateBackoffWithJitter(attempt: number, baseDelaySec: number = 60, maxDelaySec: number = 3600): {
    delaySec: number;
    nextRetryAt: string;
  } {
    const exponent = Math.max(0, Math.min(attempt - 1, 8));
    const rawDelay = Math.min(maxDelaySec, baseDelaySec * Math.pow(2, exponent));
    const jitter = Math.floor(Math.random() * (rawDelay * 0.25));
    const delaySec = rawDelay + jitter;
    const nextRetryAt = new Date(Date.now() + delaySec * 1000).toISOString();
    return { delaySec, nextRetryAt };
  }

  /**
   * Process raw offers into validated, truthful DealCandidate objects (WORKSTREAM B).
   * Rules:
   * 1. Accept currentPriceINR only when explicitly provided by provider data (number > 0).
   * 2. Missing reference price must remain undefined (never synthesized from discount).
   * 3. Never synthesize current price from reference price and claimed discount.
   * 4. Never infer price history from current execution timestamp.
   * 5. Never invent an expiry date: if offer.end_date is omitted, expiryDate remains undefined.
   * 6. Default discountVerificationType to 'MERCHANT_CLAIMED'.
   * 7. Support coupon-only opportunities: retain with dealKind: 'COUPON' and currentPriceINR: undefined.
   * 8. Require explicit provider confirmation (affiliated: true AND allowlisted tracking domain)
   *    before classifying a link as monetizable.
   * 9. Preserve direct merchant links when affiliated: false.
   */
  private async processOffersToCandidates(
    rawOffers: CuelinksOffer[],
    eligibleCampaigns: CuelinksCampaign[]
  ): Promise<DealCandidate[]> {
    const dealCandidates: DealCandidate[] = [];

    for (const offer of rawOffers) {
      const campaign = eligibleCampaigns.find(c => String(c.id) === String(offer.campaign_id));
      const merchantName = offer.campaign_name || campaign?.merchant_name || campaign?.name || 'Authorized Merchant';

      // Clean merchant destination: extract URL from tracking_url parameter or campaign (Finding 1)
      let merchantUrl = offer.url || '';
      if (!merchantUrl && offer.tracking_url) {
        try {
          const parsed = new URL(offer.tracking_url);
          const dec = parsed.searchParams.get('url') || parsed.searchParams.get('dest') || parsed.searchParams.get('redirect');
          if (dec && /^https?:\/\//i.test(dec)) {
            merchantUrl = decodeURIComponent(dec);
          }
        } catch {}
      }
      if (!merchantUrl && campaign?.url && /^https?:\/\//i.test(campaign.url)) {
        merchantUrl = campaign.url;
      }

      // If merchantUrl is still empty or is itself a Cuelinks tracking URL, skip
      // A tracking URL alone without destination is not merchant SKU evidence (Finding 1)
      if (!merchantUrl || !offer.title) continue;
      if (CuelinksV3Client.isAllowedTrackingUrl(merchantUrl)) continue;

      // Rule: Accept currentPriceINR only when explicitly provided by provider data (> 0)
      let currentPrice: number | undefined = undefined;
      if (typeof offer.discount_price === 'number' && offer.discount_price > 0) {
        currentPrice = offer.discount_price;
      } else if (typeof offer.discount_price === 'string' && !isNaN(Number(offer.discount_price)) && Number(offer.discount_price) > 0) {
        currentPrice = Number(offer.discount_price);
      } else if (typeof offer.current_price_inr === 'number' && offer.current_price_inr > 0) {
        currentPrice = offer.current_price_inr;
      }

      // Rule: Missing reference price must remain undefined (never synthesized)
      let refPrice: number | undefined = undefined;
      if (typeof offer.original_price === 'number' && offer.original_price > 0) {
        refPrice = offer.original_price;
      } else if (typeof offer.original_price === 'string' && !isNaN(Number(offer.original_price)) && Number(offer.original_price) > 0) {
        refPrice = Number(offer.original_price);
      } else if (typeof offer.reference_price_inr === 'number' && offer.reference_price_inr > 0) {
        refPrice = offer.reference_price_inr;
      }

      // Provider claimed discount
      let claimedDiscount: number | undefined = undefined;
      if (typeof offer.percent_off === 'number' && offer.percent_off > 0) {
        claimedDiscount = Math.round(offer.percent_off);
      } else if (typeof offer.percent_off === 'string' && !isNaN(Number(offer.percent_off)) && Number(offer.percent_off) > 0) {
        claimedDiscount = Math.round(Number(offer.percent_off));
      } else if (offer.discount) {
        const discMatch = offer.discount.match(/(\d+)%/);
        if (discMatch) {
          claimedDiscount = Number(discMatch[1]);
        }
      }

      // Rule: Support coupon-only opportunities: If an offer has a coupon_code or discount terms
      // but no current_price_inr, set dealKind: 'COUPON' and retain it as a valid coupon opportunity
      // with currentPriceINR: undefined without inventing a fake price!
      const cleanCouponCode = offer.coupon_code ? offer.coupon_code.trim() : undefined;
      const hasCouponOrDiscount = Boolean(cleanCouponCode || claimedDiscount || offer.terms || offer.description || offer.offer_type === 'coupon');
      let dealKind: 'PRODUCT' | 'COUPON' = 'PRODUCT';

      if (!currentPrice) {
        if (hasCouponOrDiscount) {
          dealKind = 'COUPON';
        } else {
          // No price and no coupon terms -> cannot represent a valid offer without guessing
          continue;
        }
      } else {
        dealKind = (offer.offer_type === 'coupon' || cleanCouponCode) ? 'COUPON' : 'PRODUCT';
      }

      // Category extraction
      let categoryName = 'Retail Deals';
      if (Array.isArray(offer.categories) && offer.categories.length > 0) {
        const c0 = offer.categories[0];
        categoryName = typeof c0 === 'string' ? c0 : (c0?.name || 'Retail Deals');
      } else if (offer.category) {
        categoryName = offer.category;
      }

      // Rule: Never invent an expiry date: if offer.end_date is omitted, expiryDate remains undefined.
      let expiryDate: string | undefined = undefined;
      if (offer.end_date) {
        const parsed = Date.parse(offer.end_date);
        if (!isNaN(parsed)) {
          expiryDate = new Date(parsed).toISOString();
        }
      }

      let offerStart: string | undefined = undefined;
      if (offer.start_date) {
        const parsed = Date.parse(offer.start_date);
        if (!isNaN(parsed)) {
          offerStart = new Date(parsed).toISOString();
        }
      }

      // Rule: Require explicit provider confirmation (affiliated: true AND allowlisted tracking domain)
      // before classifying a link as monetizable. Preserve direct merchant links when affiliated: false.
      // Strict conversion gate: Never shortcut or trust raw unverified offer.tracking_url!
      let trackingUrl = merchantUrl;
      let isMonetizable = false;

      if (this.client.isConfigured()) {
        try {
          const convertRes = await this.client.convertLink({
            url: merchantUrl,
            channel_id: this.syncStatus.channel?.id,
            shorten: true,
            subid: `aro_cl_${offer.id}`,
            subid2: String(offer.campaign_id),
            subid3: 'cuelinks_feed',
            subid4: 'catalog_v2'
          });

          const candidateUrl = convertRes.short_url || convertRes.tracking_url;
          if (
            convertRes.affiliated === true &&
            candidateUrl &&
            CuelinksV3Client.isAllowedTrackingUrl(candidateUrl)
          ) {
            trackingUrl = candidateUrl;
            isMonetizable = true;
            this.syncStatus.linksConverted++;
          } else {
            trackingUrl = merchantUrl;
            isMonetizable = false;
          }
        } catch {
          trackingUrl = merchantUrl;
          isMonetizable = false;
        }
      }

      const candidate: DealCandidate = {
        title: offer.title.trim(),
        brand: merchantName,
        merchant: merchantName,
        category: categoryName,
        productUrl: merchantUrl,
        currentPriceINR: currentPrice,
        referencePriceINR: refPrice,
        claimedDiscountPercent: claimedDiscount,
        discountVerificationType: 'MERCHANT_CLAIMED',
        dealKind,
        couponCode: cleanCouponCode,
        couponConditions: offer.terms?.trim() || offer.description?.trim() || undefined,
        offerStart,
        expiryDate,
        sourceUrl: merchantUrl,
        sourceDomain: 'cuelinks.com',
        sourceType: 'AFFILIATE_NETWORK',
        trackingUrl: isMonetizable ? trackingUrl : undefined,
        affiliateNetwork: isMonetizable ? 'CUELINKS' : undefined,
        affiliateCampaignId: String(offer.campaign_id),
        isMonetizable
      };

      dealCandidates.push(candidate);
    }

    return dealCandidates;
  }

  /**
   * Run full Cuelinks autonomous cycle:
   * 1. Auth & Channel verification
   * 2. Campaign discovery
   * 3. Offer discovery & candidate conversion
   * 4. Performance reconciliation
   * 5. Accurate failure tracking & D1 telemetry persistence (WORKSTREAM D)
   */
  public async syncCuelinks(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro',
    options?: { skipOfferFetch?: boolean; reconciliationOnly?: boolean }
  ): Promise<{
    success: boolean;
    reason?: string;
    status: CuelinksSyncStatus;
    dealCandidates: DealCandidate[];
    errorClass?: CuelinksErrorClass;
  }> {
    if (!this.client.isConfigured()) {
      this.syncStatus.configured = false;
      this.syncStatus.connected = false;
      this.syncStatus.status = 'BLOCKED_CONFIGURATION';
      this.syncStatus.ownerActionRequired =
        'Provide CUELINKS_API_KEY in environment variables or Render dashboard to enable automated Cuelinks campaign discovery and affiliate link conversion.';
      return {
        success: false,
        reason: 'CUELINKS_API_KEY_UNSET',
        status: this.getStatus(),
        dealCandidates: []
      };
    }

    this.syncStatus.status = 'SYNCING';
    let dealCandidates: DealCandidate[] = [];

    try {
      // 1. Ping / Connection test
      let pingRes;
      try {
        pingRes = await this.client.ping();
      } catch (pingErr: any) {
        this.attemptCount++;
        const errorClass = this.classifyError(pingErr);
        const { nextRetryAt } = this.calculateBackoffWithJitter(this.attemptCount);
        const nextStatus: CuelinksSyncStatusCode = (this.attemptCount >= 5 && errorClass === 'AUTH_FAILURE') ? 'FAILED_PERMANENTLY' : 'RETRY_WAIT';
        this.syncStatus.connected = false;
        this.syncStatus.status = nextStatus;
        this.syncStatus.ownerActionRequired = `Cuelinks authentication failed: ${pingErr.message}. Check CUELINKS_API_KEY.`;
        this.syncStatus.telemetry = {
          attemptCount: this.attemptCount,
          errorClass,
          lastError: pingErr.message,
          nextRetryAt,
          status: nextStatus
        };
        await this.persistTelemetryD1(organizationId, businessId, this.syncStatus.telemetry);
        return {
          success: false,
          reason: pingErr.message,
          status: this.getStatus(),
          dealCandidates: [],
          errorClass
        };
      }

      if (!pingRes.connected) {
        this.attemptCount++;
        const errorClass = this.classifyError(pingRes.message || 'AUTH_FAILURE');
        const { nextRetryAt } = this.calculateBackoffWithJitter(this.attemptCount);
        const nextStatus: CuelinksSyncStatusCode = (this.attemptCount >= 5 && errorClass === 'AUTH_FAILURE') ? 'FAILED_PERMANENTLY' : 'RETRY_WAIT';
        this.syncStatus.connected = false;
        this.syncStatus.status = nextStatus;
        this.syncStatus.ownerActionRequired = `Cuelinks authentication failed: ${pingRes.message}. Check CUELINKS_API_KEY.`;
        this.syncStatus.telemetry = {
          attemptCount: this.attemptCount,
          errorClass,
          lastError: pingRes.message,
          nextRetryAt,
          status: nextStatus
        };
        await this.persistTelemetryD1(organizationId, businessId, this.syncStatus.telemetry);
        return {
          success: false,
          reason: pingRes.message,
          status: this.getStatus(),
          dealCandidates: [],
          errorClass
        };
      }

      this.syncStatus.connected = true;
      if (pingRes.publisherId) this.syncStatus.publisherId = pingRes.publisherId;
      if (pingRes.email) this.syncStatus.email = pingRes.email;
      if (pingRes.scopes) this.syncStatus.scopes = pingRes.scopes;
      if (pingRes.hasRequiredScopes !== undefined) this.syncStatus.hasRequiredScopes = pingRes.hasRequiredScopes;
      if (pingRes.missingScopes) this.syncStatus.missingScopes = pingRes.missingScopes;

      const empiricallyVerifiedScopes = new Set<string>(pingRes.scopes || []);
      const forbiddenScopes = new Set<string>();

      // 2. Channel inspection & registration
      try {
        const canonicalUrl = 'https://ai-marketing-organization.onrender.com';
        const channels = await this.client.getChannels();
        empiricallyVerifiedScopes.add('read:channels');
        this.updateCapability('channelVerification', 'AVAILABLE');
        let targetChannel = channels.find(c => {
          const chUrl = (c.source_url || c.url || '').toLowerCase();
          return chUrl.includes('onrender.com') || chUrl.includes('gen-lang-client');
        }) || channels.find(c => c.is_default);

        if (!targetChannel) {
          targetChannel = await this.client.createChannel(
            'ARO Deals',
            canonicalUrl,
            'website'
          );
        }

        this.syncStatus.channel = {
          id: targetChannel?.id,
          name: targetChannel?.name,
          url: targetChannel?.source_url || targetChannel?.url,
          status: targetChannel?.status || 'active'
        };
      } catch (channelErr: any) {
        if (channelErr.statusCode === 403 || channelErr.code === 'CUELINKS_FORBIDDEN') {
          forbiddenScopes.add('read:channels');
          this.updateCapability('channelVerification', 'PERMISSION_MISSING');
        } else if (channelErr.statusCode === 401 || channelErr.code === 'CUELINKS_UNAUTHORIZED') {
          this.updateCapability('channelVerification', 'AUTH_FAILURE');
        } else {
          this.updateCapability('channelVerification', 'PROVIDER_ERROR');
        }
        console.warn(`[CuelinksSync] Channel inspection notice: ${channelErr.message}`);
      }

      // Track individual phase errors for accurate failure reporting (WORKSTREAM D)
      let campaignError: any = null;
      let offerError: any = null;
      const partialFailureReasons: string[] = [];

      // 3. Campaign discovery (Prioritizing India country_id: 252, open access, sorted by EPC)
      let eligibleCampaigns: CuelinksCampaign[] = [];
      if (!options?.reconciliationOnly) {
        try {
          const campaignSearch = await this.client.searchCampaigns({
            country_id: 252,
            access_status: 'approved',
            sort: 'epc_7d',
            order: 'desc',
            per_page: 30
          });

          empiricallyVerifiedScopes.add('read:campaigns');
          this.updateCapability('campaignDiscovery', 'AVAILABLE');
          this.syncStatus.campaignsDiscovered = campaignSearch.total;
          eligibleCampaigns = (campaignSearch.campaigns || []).filter(
            c => (!c.status || c.status === 'active') && (c.access_status === 'approved' || c.access_status === 'open')
          );
          this.syncStatus.eligibleCampaignsCount = eligibleCampaigns.length;

          // Note: write:links is strictly NOT inferred from campaign discovery!

          // Persist discovered campaigns to D1
          await this.persistCampaignsD1(organizationId, businessId, eligibleCampaigns);
        } catch (campErr: any) {
          if (campErr.statusCode === 403 || campErr.code === 'CUELINKS_FORBIDDEN') {
            forbiddenScopes.add('read:campaigns');
            this.updateCapability('campaignDiscovery', 'PERMISSION_MISSING');
          } else if (campErr.statusCode === 401 || campErr.code === 'CUELINKS_UNAUTHORIZED') {
            this.updateCapability('campaignDiscovery', 'AUTH_FAILURE');
          } else {
            this.updateCapability('campaignDiscovery', 'PROVIDER_ERROR');
          }
          campaignError = campErr;
          partialFailureReasons.push(`Campaign search failed: ${campErr.message}`);
          console.warn(`[CuelinksSync] Campaign search error: ${campErr.message}`);
        }
      }

      // 4. Offer discovery across eligible campaigns (skipped if skipOfferFetch or reconciliationOnly)
      if (!options?.skipOfferFetch && !options?.reconciliationOnly) {
        try {
          const offersRes = await this.client.getOffers({ per_page: 30 });
          empiricallyVerifiedScopes.add('read:offers');
          this.updateCapability('offerPagination', 'AVAILABLE');
          const rawOffers = offersRes.offers || [];
          this.syncStatus.offersRetrieved = rawOffers.length;

          dealCandidates = await this.processOffersToCandidates(rawOffers, eligibleCampaigns);
        } catch (offErr: any) {
          if (offErr.statusCode === 403 || offErr.code === 'CUELINKS_FORBIDDEN') {
            forbiddenScopes.add('read:offers');
            this.updateCapability('offerPagination', 'PERMISSION_MISSING');
          } else if (offErr.statusCode === 401 || offErr.code === 'CUELINKS_UNAUTHORIZED') {
            this.updateCapability('offerPagination', 'AUTH_FAILURE');
          } else {
            this.updateCapability('offerPagination', 'PROVIDER_ERROR');
          }
          offerError = offErr;
          partialFailureReasons.push(`Offer retrieval failed: ${offErr.message}`);
          console.warn(`[CuelinksSync] Offer retrieval error: ${offErr.message}`);
        }
      }

      // 5. Performance reconciliation (Transactions & Reports)
      try {
        const targetChannelId = this.syncStatus.channel?.id;
        const reconciliationResult = await this.reconcileTransactionsIncremental({
          channel_id: targetChannelId,
          maxPages: 5
        });
        empiricallyVerifiedScopes.add('read:transactions');
        this.updateCapability('transactionReconciliation', 'AVAILABLE');

        let providerClicks = reconciliationResult.providerAttributedClicks;
        let reportedConversions = reconciliationResult.reportedConversions;

        try {
          const perfRes = await this.client.getPerformanceReport({
            start_date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
            end_date: new Date().toISOString().split('T')[0],
            channel_id: targetChannelId,
            per_page: 50
          });
          empiricallyVerifiedScopes.add('read:reports');
          this.updateCapability('reporting', 'AVAILABLE');
          const pClicks = perfRes.totals
            ? Number(perfRes.totals.clicks || 0)
            : perfRes.data.reduce((acc, r) => acc + (Number(r.clicks) || 0), 0);
          const pConvs = perfRes.totals
            ? Number(perfRes.totals.transactions ?? (perfRes.totals as any).conversions ?? 0)
            : perfRes.data.reduce((acc, r) => acc + (Number(r.transactions ?? (r as any).conversions) || 0), 0);
          if (pClicks > 0) providerClicks = pClicks;
          if (pConvs > 0) reportedConversions = pConvs;
        } catch {
          // Gracefully fall back to transactional totals if report API not granted
        }

        this.syncStatus.reconciliation = {
          ...reconciliationResult,
          localClicks: this.syncStatus.reconciliation.localClicks,
          providerAttributedClicks: providerClicks,
          reportedConversions: reportedConversions,
          cashReceivedINR: 0 // strictly ₹0.00 until bank statement proof
        };
      } catch (recErr: any) {
        if (recErr.statusCode === 403 || recErr.code === 'CUELINKS_FORBIDDEN') {
          forbiddenScopes.add('read:reports');
          forbiddenScopes.add('read:transactions');
          this.updateCapability('transactionReconciliation', 'PERMISSION_MISSING');
          this.updateCapability('reporting', 'PERMISSION_MISSING');
        } else if (recErr.statusCode === 401 || recErr.code === 'CUELINKS_UNAUTHORIZED') {
          this.updateCapability('transactionReconciliation', 'AUTH_FAILURE');
          this.updateCapability('reporting', 'AUTH_FAILURE');
        } else {
          this.updateCapability('transactionReconciliation', 'PROVIDER_ERROR');
          this.updateCapability('reporting', 'PROVIDER_ERROR');
        }
        console.warn(`[CuelinksSync] Reconciliation notice: ${recErr.message}`);
      }

      // Merge with instance empirically verified scopes
      for (const s of this.empiricallyVerifiedScopes) {
        empiricallyVerifiedScopes.add(s);
      }
      for (const f of forbiddenScopes) {
        this.forbiddenScopes.add(f);
      }
      for (const s of empiricallyVerifiedScopes) {
        this.empiricallyVerifiedScopes.add(s);
      }
      for (const f of this.forbiddenScopes) {
        empiricallyVerifiedScopes.delete(f);
      }

      // Reconcile scopes: Priority to pingRes.scopes if explicitly provided by provider.
      // If ping omitted scopes, use empirically verified capabilities from successful provider responses.
      if (Array.isArray(pingRes.scopes) && pingRes.scopes.length > 0) {
        const combined = new Set<string>([...pingRes.scopes, ...empiricallyVerifiedScopes]);
        for (const f of this.forbiddenScopes) combined.delete(f);
        this.syncStatus.scopes = Array.from(combined);
        const missing = CUELINKS_REQUIRED_SCOPES.filter(req => !this.syncStatus.scopes!.includes(req));
        this.syncStatus.missingScopes = missing;
        this.syncStatus.hasRequiredScopes = missing.length === 0;
      } else {
        const missing = CUELINKS_REQUIRED_SCOPES.filter(
          s => !empiricallyVerifiedScopes.has(s) || this.forbiddenScopes.has(s)
        );
        this.syncStatus.scopes = Array.from(empiricallyVerifiedScopes);
        this.syncStatus.missingScopes = missing;
        this.syncStatus.hasRequiredScopes = missing.length === 0;
      }

      // Determine Sync Outcome (WORKSTREAM D)
      // Fix failure masking: If campaign search fails OR offer retrieval fails, do NOT report total sync SUCCESS!
      if (campaignError && offerError) {
        this.attemptCount++;
        const primaryError = campaignError || offerError;
        const errorClass = this.classifyError(primaryError);
        const { nextRetryAt } = this.calculateBackoffWithJitter(this.attemptCount);
        const nextStatus: CuelinksSyncStatusCode = (errorClass === 'RATE_LIMITED' || errorClass === 'NETWORK_TIMEOUT' || errorClass === 'PROVIDER_SERVER_ERROR')
          ? 'RETRY_WAIT'
          : (this.attemptCount >= 5 ? 'FAILED_PERMANENTLY' : 'RETRY_WAIT');

        this.syncStatus.status = nextStatus;
        this.syncStatus.ownerActionRequired = `Cuelinks cycle failure: ${primaryError.message}`;
        this.syncStatus.telemetry = {
          attemptCount: this.attemptCount,
          errorClass,
          lastError: primaryError.message,
          nextRetryAt,
          status: nextStatus,
          partialFailureReasons
        };
        await this.persistTelemetryD1(organizationId, businessId, this.syncStatus.telemetry);

        return {
          success: false,
          reason: primaryError.message,
          status: this.getStatus(),
          dealCandidates: [],
          errorClass
        };
      }

      if (campaignError || offerError) {
        // Partial success (one succeeded while the other failed)
        this.attemptCount++;
        const failingErr = campaignError || offerError;
        const errorClass = this.classifyError(failingErr);
        const { nextRetryAt } = this.calculateBackoffWithJitter(this.attemptCount);

        this.syncStatus.status = 'PARTIAL_SUCCESS';
        this.syncStatus.lastSyncTimestamp = new Date().toISOString();
        this.syncStatus.ownerActionRequired = `Partial Cuelinks sync: ${partialFailureReasons.join('; ')}`;
        this.syncStatus.telemetry = {
          attemptCount: this.attemptCount,
          errorClass,
          lastError: failingErr.message,
          nextRetryAt,
          status: 'PARTIAL_SUCCESS',
          partialFailureReasons
        };

        await this.persistSyncD1(organizationId, businessId);
        await this.persistTelemetryD1(organizationId, businessId, this.syncStatus.telemetry);

        return {
          success: false,
          reason: `PARTIAL_SUCCESS: ${failingErr.message}`,
          status: this.getStatus(),
          dealCandidates,
          errorClass
        };
      }

      // Total SUCCESS
      this.attemptCount = 0;
      this.syncStatus.status = 'SUCCESS';
      this.syncStatus.lastSyncTimestamp = new Date().toISOString();
      this.syncStatus.ownerActionRequired = undefined;
      this.syncStatus.telemetry = {
        attemptCount: 0,
        errorClass: undefined,
        lastError: undefined,
        nextRetryAt: undefined,
        status: 'SUCCESS'
      };

      await this.persistSyncD1(organizationId, businessId);
      await this.persistTelemetryD1(organizationId, businessId, this.syncStatus.telemetry);

      return {
        success: true,
        status: this.getStatus(),
        dealCandidates
      };
    } catch (err: any) {
      this.attemptCount++;
      const errorClass = this.classifyError(err);
      const { nextRetryAt } = this.calculateBackoffWithJitter(this.attemptCount);
      const nextStatus: CuelinksSyncStatusCode = (errorClass === 'RATE_LIMITED' || errorClass === 'NETWORK_TIMEOUT' || errorClass === 'PROVIDER_SERVER_ERROR')
        ? 'RETRY_WAIT'
        : (this.attemptCount >= 5 ? 'FAILED_PERMANENTLY' : 'RETRY_WAIT');

      this.syncStatus.status = nextStatus;
      this.syncStatus.ownerActionRequired = `Cuelinks cycle failure: ${err.message}`;
      this.syncStatus.telemetry = {
        attemptCount: this.attemptCount,
        errorClass,
        lastError: err.message,
        nextRetryAt,
        status: nextStatus
      };
      await this.persistTelemetryD1(organizationId, businessId, this.syncStatus.telemetry);

      return {
        success: false,
        reason: err.message,
        status: this.getStatus(),
        dealCandidates: [],
        errorClass
      };
    }
  }

  /**
   * Reconciles transaction commissions and performance metrics without re-crawling offers.
   * Useful when deal discovery has already ingested offers in the current commercial cycle.
   */
  public async syncReconciliationOnly(organizationId: string = 'org_owner_primary', businessId: string = 'biz_platform_aro') {
    return this.syncCuelinks(organizationId, businessId, { skipOfferFetch: true, reconciliationOnly: true });
  }

  /**
   * Retrieves verified approved publisher channel.
   * If expectedId is provided, matches that ID first; otherwise matches canonical URL or default channel.
   * Returns approved: true ONLY when the matched channel is 'approved' or 'active'.
   * Never falls back to a hardcoded ID when not found or unapproved.
   */
  public async getApprovedChannel(expectedId?: string | number): Promise<{ channel: CuelinksChannel | null; approved: boolean }> {
    try {
      const channels = await this.client.getChannels();
      const ch = (expectedId ? channels.find(c => String(c.id) === String(expectedId)) : undefined) ||
        channels.find(c => {
          const u = (c.source_url || c.url || '').toLowerCase();
          return u.includes('onrender.com') || u.includes('gen-lang-client');
        }) ||
        channels.find(c => c.is_default);
      if (ch && (ch.status === 'approved' || ch.status === 'active')) {
        return { channel: ch, approved: true };
      }
      return { channel: null, approved: false };
    } catch {
      return { channel: null, approved: false };
    }
  }

  /**
   * Incremental multi-page transaction reconciliation & Sub-ID matching (Phase 4).
   * - Bounded pagination up to maxPages (or total_pages).
   * - Incremental sync via updated_since.
   * - Sub-ID click matching into commission_records.
   * - Strict financial status disaggregation (Rule 8).
   * - Currency safety: checks currency === 'INR'.
   */
  public async reconcileTransactionsIncremental(options?: {
    channel_id?: number | string;
    campaign_id?: number | string;
    maxPages?: number;
    updated_since?: string;
  }): Promise<CuelinksReconciliationMetrics> {
    const d1Repo = D1RevenueRepository.getInstance();
    let updatedSince = options?.updated_since;

    if (!updatedSince) {
      try {
        const cursorRecord = await d1Repo.queryOne<{ outputs_json: string }>(
          'workflows',
          "SELECT outputs_json FROM workflows WHERE id = 'wf_cuelinks_reconciliation_cursor' LIMIT 1"
        );
        if (cursorRecord?.outputs_json) {
          const parsed = JSON.parse(cursorRecord.outputs_json);
          if (parsed.lastReconciledSince) {
            updatedSince = parsed.lastReconciledSince;
          }
        }
      } catch (err: any) {
        console.warn(`[CuelinksSync] Could not load durable reconciliation cursor: ${err.message}`);
      }
    }

    if (!updatedSince) {
      updatedSince = this.lastReconciledSince;
    }

    const maxPages = options?.maxPages || 5;
    let page = 1;
    let hasNext = true;
    const allTransactions: any[] = [];

    while (page <= maxPages && hasNext) {
      const transRes = await this.client.getTransactions({
        channel_id: options?.channel_id,
        campaign_id: options?.campaign_id,
        updated_since: updatedSince,
        page,
        per_page: 100
      });

      const txList = Array.isArray(transRes?.transactions) ? transRes.transactions : [];
      allTransactions.push(...txList);

      if (!transRes.total_pages || page >= transRes.total_pages || txList.length < 100) {
        hasNext = false;
      } else {
        page++;
      }
    }

    let pending = 0;
    let validated = 0;
    let payable = 0;
    let invoiced = 0;
    let providerPaid = 0;
    let reversed = 0;
    let unmatchedCount = 0;
    let currencyUnclassifiedCount = 0;
    let hasFailedWrites = false;

    for (const tx of allTransactions) {
      const curr = tx.currency ? String(tx.currency).toUpperCase().trim() : undefined;
      const isExplicitInr = curr === 'INR';
      if (!isExplicitInr) {
        console.warn(`[CuelinksSync] Notice: Non-INR or unspecified currency '${curr || 'UNSPECIFIED'}' on transaction '${tx.id}'. Isolating from INR metrics.`);
        currencyUnclassifiedCount++;
      }

      const amt = Number(tx.user_commission ?? tx.commission_amount) || 0;
      const status = (tx.status || '').toLowerCase().trim();

      if (isExplicitInr) {
        if (status === 'pending') {
          pending += amt;
        } else if (status === 'validated' || status === 'approved') {
          validated += amt;
        } else if (status === 'payable') {
          payable += amt;
        } else if (status === 'invoice_raised' || status === 'invoiced') {
          invoiced += amt;
        } else if (status === 'paid' || status === 'provider_paid') {
          providerPaid += amt;
        } else if (status === 'rejected' || status === 'cancelled') {
          reversed += amt;
        }
      }

      const subId = tx.sub_id || tx.subid || tx.sub_id_1 || tx.subid1;
      let matchedReferralId: string | undefined = undefined;

      if (subId) {
        try {
          const refRows = await d1Repo.query<any>('referrals', 'SELECT id, offer_id, partner_id FROM referrals WHERE click_id = ? LIMIT 1', [subId]);
          if (refRows && refRows.length > 0) {
            matchedReferralId = refRows[0].id;
          }
        } catch {}
      }

      if (!matchedReferralId) {
        unmatchedCount++;
      }

      try {
        const commId = `comm_${tx.id}`;
        const externalTxId = String(tx.id || tx.transaction_id);
        const verifiedCommission = (isExplicitInr && ['validated', 'approved', 'payable', 'invoice_raised', 'paid'].includes(status)) ? amt : 0;
        const receivedCommission = (isExplicitInr && status === 'paid') ? amt : 0;
        const evidenceJson = JSON.stringify({
          subids: [tx.sub_id, tx.sub_id_2, tx.sub_id_3, tx.sub_id_4, tx.sub_id_5],
          campaign_id: tx.campaign_id,
          channel_id: tx.channel_id,
          order_amount: tx.order_amount,
          currency: tx.currency
        });

        const upsertSql = `
          INSERT INTO commission_records (
            id, referral_id, partner_id, organization_id, external_transaction_id,
            event_type, external_status, expected_commission_inr, verified_commission_inr,
            received_commission_inr, verification_source, evidence_json, status, created_at, updated_at
          ) VALUES (?, ?, 'part_cuelinks', 'org_owner_primary', ?, 'PURCHASE', ?, ?, ?, ?, 'CUELINKS_API', ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(partner_id, external_transaction_id) DO UPDATE SET
            referral_id = COALESCE(excluded.referral_id, commission_records.referral_id),
            external_status = excluded.external_status,
            expected_commission_inr = excluded.expected_commission_inr,
            verified_commission_inr = excluded.verified_commission_inr,
            received_commission_inr = excluded.received_commission_inr,
            evidence_json = excluded.evidence_json,
            status = excluded.status,
            updated_at = datetime('now')
        `;
        const mappedStatus = matchedReferralId ? (status === 'paid' ? 'COMMISSION_PAID' : (['validated', 'approved', 'payable', 'invoice_raised'].includes(status) ? 'COMMISSION_APPROVED' : (status === 'rejected' ? 'COMMISSION_REJECTED' : 'COMMISSION_PENDING'))) : 'UNMATCHED';

        const params = [
          commId,
          matchedReferralId || null,
          externalTxId,
          status,
          isExplicitInr ? amt : 0,
          verifiedCommission,
          receivedCommission,
          evidenceJson,
          mappedStatus
        ];

        await d1Repo.executeWrite('commission_records', upsertSql, params);
      } catch (saveErr: any) {
        console.warn(`[CuelinksSync] Error persisting transaction '${tx.id}': ${saveErr.message}`);
        hasFailedWrites = true;
      }
    }

    const newCursor = new Date().toISOString();
    if (!hasFailedWrites) {
      this.lastReconciledSince = newCursor;
      try {
        const cursorSql = `
          INSERT INTO workflows (
            id, organization_id, business_id, workflow_type, status, current_step,
            last_successful_checkpoint, retry_count, max_retries, inputs_json, outputs_json, updated_at
          ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'CUELINKS_RECONCILIATION_CURSOR', 'COMPLETED', 'RECONCILED', ?, 0, 3, '{}', ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            current_step = excluded.current_step,
            last_successful_checkpoint = excluded.last_successful_checkpoint,
            outputs_json = excluded.outputs_json,
            updated_at = datetime('now')
        `;
        const cursorPayload = JSON.stringify({
          lastReconciledSince: newCursor,
          lastRunAt: newCursor,
          transactionsCount: allTransactions.length
        });
        await d1Repo.executeWrite('workflows', cursorSql, [
          'wf_cuelinks_reconciliation_cursor',
          newCursor,
          cursorPayload
        ]);
      } catch (cursorErr: any) {
        console.warn(`[CuelinksSync] Error saving durable reconciliation cursor: ${cursorErr.message}`);
      }
    } else {
      console.warn(`[CuelinksSync] Failed writes detected during reconciliation; cursor NOT advanced to protect reconciliation integrity.`);
    }

    return {
      localClicks: this.syncStatus.reconciliation.localClicks,
      providerAttributedClicks: allTransactions.length,
      reportedConversions: allTransactions.filter(t => !['rejected', 'cancelled'].includes((t.status || '').toLowerCase())).length,
      pendingCommissionINR: Math.round(pending * 100) / 100,
      validatedCommissionINR: Math.round(validated * 100) / 100,
      payableCommissionINR: Math.round(payable * 100) / 100,
      invoicedCommissionINR: Math.round(invoiced * 100) / 100,
      providerPaidCommissionINR: Math.round(providerPaid * 100) / 100,
      paidCommissionINR: Math.round(providerPaid * 100) / 100,
      reversedCommissionINR: Math.round(reversed * 100) / 100,
      unmatchedTransactionsCount: unmatchedCount,
      currencyUnclassifiedCount,
      cashReceivedINR: 0
    };
  }

  /**
   * Resumable, bounded paginated Cuelinks sync (WORKSTREAM D).
   * Traverses campaign and offer pages safely with bounded cursor and maximum page limits.
   */
  public async syncCuelinksPaginated(options: CuelinksPaginatedSyncOptions = {}): Promise<CuelinksPaginatedSyncResult> {
    const orgId = options.organizationId || 'org_owner_primary';
    const bizId = options.businessId || 'biz_platform_aro';
    const batchSize = Math.min(Math.max(1, options.batchSize || 30), 100);

    const cursor: CuelinksPaginationCursor = options.cursor ? { ...options.cursor } : {
      campaignPage: 1,
      offerPage: 1,
      hasMoreCampaigns: true,
      hasMoreOffers: true
    };

    if (!this.client.isConfigured()) {
      this.syncStatus.status = 'BLOCKED_CONFIGURATION';
      return {
        success: false,
        status: this.getStatus(),
        dealCandidates: [],
        hasMore: false,
        reason: 'CUELINKS_API_KEY_UNSET'
      };
    }

    const allCandidates: DealCandidate[] = [];
    let campaignPage = cursor.campaignPage;
    let offerPage = cursor.offerPage;
    let primaryErrorClass: CuelinksErrorClass | undefined;
    let hadError = false;

    // 1. Fetch campaigns for this page
    let eligibleCampaigns: CuelinksCampaign[] = [];
    try {
      if (cursor.hasMoreCampaigns) {
        const campRes = await this.client.searchCampaigns({
          country_id: 252,
          access_status: 'approved',
          sort: 'epc_7d',
          order: 'desc',
          page: campaignPage,
          per_page: batchSize
        });

        eligibleCampaigns = (campRes.campaigns || []).filter(
          c => (!c.status || c.status === 'active') && (c.access_status === 'approved' || c.access_status === 'open')
        );

        this.syncStatus.campaignsDiscovered = campRes.total;
        this.syncStatus.eligibleCampaignsCount = eligibleCampaigns.length;

        const totalCampaigns = campRes.total || 0;
        if (totalCampaigns > 0 && campaignPage * batchSize >= totalCampaigns) {
          campaignPage = 1; // Wrap around to rotate from start
          cursor.hasMoreCampaigns = true;
        } else {
          campaignPage++;
          cursor.hasMoreCampaigns = true;
        }
      }
    } catch (campErr: any) {
      hadError = true;
      primaryErrorClass = this.classifyError(campErr);
    }

    // 2. Fetch offers for this page
    try {
      if (cursor.hasMoreOffers) {
        const offRes = await this.client.getOffers({
          page: offerPage,
          per_page: batchSize
        });

        const totalOffers = offRes.total || 0;
        if (totalOffers > 0 && offerPage * batchSize >= totalOffers) {
          offerPage = 1; // Wrap around to rotate from start
          cursor.hasMoreOffers = true;
        } else {
          offerPage++;
          cursor.hasMoreOffers = true;
        }

        const candidates = await this.processOffersToCandidates(offRes.offers || [], eligibleCampaigns);
        allCandidates.push(...candidates);
      }
    } catch (offErr: any) {
      hadError = true;
      primaryErrorClass = primaryErrorClass || this.classifyError(offErr);
    }

    const nextCursor: CuelinksPaginationCursor = {
      campaignPage,
      offerPage,
      hasMoreCampaigns: cursor.hasMoreCampaigns,
      hasMoreOffers: cursor.hasMoreOffers,
      lastUpdated: new Date().toISOString()
    };

    const hasMore = Boolean(nextCursor.hasMoreCampaigns || nextCursor.hasMoreOffers);
    const syncStatus: CuelinksSyncStatusCode = hadError ? 'PARTIAL_SUCCESS' : 'SUCCESS';
    this.syncStatus.status = syncStatus;

    return {
      success: !hadError,
      status: this.getStatus(),
      dealCandidates: allCandidates,
      nextCursor: hasMore ? nextCursor : undefined,
      hasMore,
      errorClass: primaryErrorClass
    };
  }

  /**
   * Persist discovered campaigns into D1 workflows table
   */
  private async persistCampaignsD1(organizationId: string, businessId: string, campaigns: CuelinksCampaign[]): Promise<void> {
    try {
      const d1Repo = D1RevenueRepository.getInstance();
      for (const camp of campaigns.slice(0, 30)) {
        // Extract clean canonical merchant domain
        let merchantDomain = '';
        if (camp.url) {
          try {
            merchantDomain = new URL(camp.url).hostname.replace(/^www\./i, '').toLowerCase();
          } catch {
            merchantDomain = String(camp.url || '').toLowerCase();
          }
        }
        if (!merchantDomain) {
          merchantDomain = (camp.name || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
        }

        const campSql = `
          INSERT INTO cuelinks_campaigns (
            campaign_id, name, merchant_domain, status, payout_model, payout_rate, cookie_days, category, verification_source, last_provider_sync_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CUELINKS_API_V3', datetime('now'), datetime('now'))
          ON CONFLICT(campaign_id) DO UPDATE SET
            name = excluded.name,
            merchant_domain = excluded.merchant_domain,
            status = excluded.status,
            payout_model = excluded.payout_model,
            payout_rate = excluded.payout_rate,
            cookie_days = excluded.cookie_days,
            category = excluded.category,
            verification_source = 'CUELINKS_API_V3',
            last_provider_sync_at = datetime('now'),
            updated_at = datetime('now')
        `;

        if (isProduction() && !process.env.VITEST) {
          await d1Repo.executeWrite('cuelinks_campaigns', campSql, [
            String(camp.id),
            camp.name || 'Cuelinks Merchant',
            merchantDomain,
            camp.status === 'active' ? 'ACTIVE' : 'INACTIVE',
            (camp as any).payout_model || (camp as any).payout_type || 'CPS',
            camp.payout || '',
            (camp as any).cookie_days || 30,
            (camp as any).category || (camp.categories?.[0] ? String(camp.categories[0]) : 'General')
          ]);
        } else {
          try {
            const { getDb } = await import('../db/client.js');
            getDb().prepare(campSql).run(
              String(camp.id),
              camp.name || 'Cuelinks Merchant',
              merchantDomain,
              camp.status === 'active' ? 'ACTIVE' : 'INACTIVE',
              (camp as any).payout_model || (camp as any).payout_type || 'CPS',
              camp.payout || '',
              (camp as any).cookie_days || 30,
              (camp as any).category || (camp.categories?.[0] ? String(camp.categories[0]) : 'General')
            );
          } catch {}
        }

        const id = `wf_camp_${camp.id}`;
        const sql = `INSERT INTO workflows (
            id, organization_id, business_id, campaign_id, workflow_type,
            status, current_step, inputs_json, outputs_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            outputs_json = excluded.outputs_json,
            updated_at = datetime('now')`;
        await d1Repo.executeWrite('workflows', sql, [
          id,
          organizationId,
          businessId,
          String(camp.id),
          'CUELINKS_CAMPAIGN',
          camp.status === 'active' ? 'COMPLETED' : 'BLOCKED',
          'DISCOVER',
          JSON.stringify({ name: camp.name, url: camp.url, access_status: camp.access_status }),
          JSON.stringify({ payout: camp.payout, epc_7d: camp.epc_7d, terms: camp.terms })
        ]);
      }
    } catch (err: any) {
      if (!isProduction()) {
        console.warn(`[CuelinksSync] D1 campaign persistence notice: ${err.message}`);
      }
    }
  }

  /**
   * Persist sync status into D1 workflows table
   */
  private async persistSyncD1(organizationId: string, businessId: string): Promise<void> {
    try {
      const d1Repo = D1RevenueRepository.getInstance();
      const id = 'wf_cuelinks_sync_latest';
      const sql = `INSERT INTO workflows (
          id, organization_id, business_id, campaign_id, workflow_type,
          status, current_step, inputs_json, outputs_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')`;
      await d1Repo.executeWrite('workflows', sql, [
        id,
        organizationId,
        businessId,
        'CUELINKS_ALL',
        'CUELINKS_SYNC',
        this.syncStatus.status === 'SUCCESS' ? 'COMPLETED' : 'BLOCKED',
        'RECONCILE',
        JSON.stringify({ channel: this.syncStatus.channel }),
        JSON.stringify({
          campaignsDiscovered: this.syncStatus.campaignsDiscovered,
          eligibleCampaignsCount: this.syncStatus.eligibleCampaignsCount,
          offersRetrieved: this.syncStatus.offersRetrieved,
          linksConverted: this.syncStatus.linksConverted,
          reconciliation: this.syncStatus.reconciliation
        })
      ]);
    } catch (err: any) {
      if (!isProduction()) {
        console.warn(`[CuelinksSync] D1 sync persistence notice: ${err.message}`);
      }
    }
  }

  /**
   * Persist sync telemetry and failure records into D1 workflows table under wf_cuelinks_sync_telemetry (WORKSTREAM D).
   */
  public async persistTelemetryD1(
    organizationId: string,
    businessId: string,
    telemetry: CuelinksTelemetryRecord
  ): Promise<void> {
    try {
      const d1Repo = D1RevenueRepository.getInstance();
      const id = 'wf_cuelinks_sync_telemetry';
      const sql = `INSERT INTO workflows (
          id, organization_id, business_id, campaign_id, workflow_type,
          status, current_step, inputs_json, outputs_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')`;
      await d1Repo.executeWrite('workflows', sql, [
        id,
        organizationId,
        businessId,
        'CUELINKS_TELEMETRY',
        'CUELINKS_SYNC',
        telemetry.status === 'SUCCESS' ? 'COMPLETED' : (telemetry.status === 'FAILED_PERMANENTLY' ? 'FAILED' : 'BLOCKED'),
        'TELEMETRY',
        JSON.stringify({
          attemptCount: telemetry.attemptCount,
          errorClass: telemetry.errorClass
        }),
        JSON.stringify({
          errorClass: telemetry.errorClass,
          attemptCount: telemetry.attemptCount,
          lastError: telemetry.lastError,
          nextRetryAt: telemetry.nextRetryAt,
          status: telemetry.status,
          partialFailureReasons: telemetry.partialFailureReasons,
          recordedAt: new Date().toISOString()
        })
      ]);
    } catch (err: any) {
      if (!isProduction()) {
        console.warn(`[CuelinksSync] D1 telemetry persistence notice: ${err.message}`);
      }
    }
  }
}
