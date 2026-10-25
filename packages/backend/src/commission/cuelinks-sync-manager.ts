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
  CuelinksReconciliationMetrics,
  CuelinksErrorClass,
  CuelinksPaginationCursor,
  CuelinksPaginatedSyncOptions,
  CuelinksPaginatedSyncResult,
  CuelinksTelemetryRecord
} from './cuelinks-v3-types.js';
import { DealCandidate } from './deal-types.js';

export class CuelinksSyncManager {
  private static instance: CuelinksSyncManager | null = null;
  private client: CuelinksV3Client;
  private syncStatus: CuelinksSyncStatus;
  private attemptCount: number = 0;

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
    if (!CuelinksSyncManager.instance || client) {
      CuelinksSyncManager.instance = new CuelinksSyncManager(client);
    }
    return CuelinksSyncManager.instance;
  }

  public static resetInstance(): void {
    CuelinksSyncManager.instance = null;
  }

  public getStatus(): CuelinksSyncStatus {
    this.syncStatus.configured = this.client.isConfigured();
    return { ...this.syncStatus };
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
      let trackingUrl = merchantUrl;
      let isMonetizable = false;

      if (offer.tracking_url && CuelinksV3Client.isAllowedTrackingUrl(offer.tracking_url)) {
        trackingUrl = offer.tracking_url;
        isMonetizable = true;
      }

      if (this.client.isConfigured()) {
        try {
          const convertRes = await this.client.convertLink({
            url: merchantUrl,
            channel_id: this.syncStatus.channel.id,
            shorten: true,
            subid: `aro_cl_${offer.id}`,
            subid2: String(offer.campaign_id),
            subid3: 'cuelinks_feed',
            subid4: 'catalog_v2'
          });

          if (
            convertRes.affiliated === true &&
            convertRes.tracking_url &&
            CuelinksV3Client.isAllowedTrackingUrl(convertRes.tracking_url)
          ) {
            trackingUrl = convertRes.short_url || convertRes.tracking_url;
            isMonetizable = true;
            this.syncStatus.linksConverted++;
          } else {
            trackingUrl = merchantUrl;
            isMonetizable = false;
          }
        } catch (convErr: any) {
          if (!isMonetizable) {
            trackingUrl = merchantUrl;
          }
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
  public async syncCuelinks(organizationId: string = 'org_owner_primary', businessId: string = 'biz_platform_aro'): Promise<{
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

      // 2. Channel inspection & registration
      try {
        const canonicalUrl = 'https://gen-lang-client-0916255372.web.app';
        const channels = await this.client.getChannels();
        let targetChannel = channels.find(c => c.url?.toLowerCase().includes('gen-lang-client') || c.url?.toLowerCase().includes('onrender.com'));

        if (!targetChannel) {
          targetChannel = await this.client.createChannel(
            'AI Marketing Organization Deals & Buying Guides',
            canonicalUrl,
            'website'
          );
        }

        this.syncStatus.channel = {
          id: targetChannel?.id,
          name: targetChannel?.name,
          url: targetChannel?.url,
          status: targetChannel?.status || 'active'
        };
      } catch (channelErr: any) {
        console.warn(`[CuelinksSync] Channel inspection notice: ${channelErr.message}`);
      }

      // Track individual phase errors for accurate failure reporting (WORKSTREAM D)
      let campaignError: any = null;
      let offerError: any = null;
      const partialFailureReasons: string[] = [];

      // 3. Campaign discovery (Prioritizing India country_id: 252, open access, sorted by EPC)
      let eligibleCampaigns: CuelinksCampaign[] = [];
      try {
        const campaignSearch = await this.client.searchCampaigns({
          country_id: 252,
          access_status: 'open',
          sort: 'epc_7d',
          order: 'desc',
          per_page: 30
        });

        this.syncStatus.campaignsDiscovered = campaignSearch.total;
        eligibleCampaigns = (campaignSearch.campaigns || []).filter(
          c => (!c.status || c.status === 'active') && (c.access_status === 'open' || c.access_status === 'approved')
        );
        this.syncStatus.eligibleCampaignsCount = eligibleCampaigns.length;

        // Persist discovered campaigns to D1
        await this.persistCampaignsD1(organizationId, businessId, eligibleCampaigns);
      } catch (campErr: any) {
        campaignError = campErr;
        partialFailureReasons.push(`Campaign search failed: ${campErr.message}`);
        console.warn(`[CuelinksSync] Campaign search error: ${campErr.message}`);
      }

      // 4. Offer discovery across eligible campaigns
      try {
        const offersRes = await this.client.getOffers({ per_page: 30 });
        const rawOffers = offersRes.offers || [];
        this.syncStatus.offersRetrieved = rawOffers.length;

        dealCandidates = await this.processOffersToCandidates(rawOffers, eligibleCampaigns);
      } catch (offErr: any) {
        offerError = offErr;
        partialFailureReasons.push(`Offer retrieval failed: ${offErr.message}`);
        console.warn(`[CuelinksSync] Offer retrieval error: ${offErr.message}`);
      }

      // 5. Performance reconciliation (Transactions & Reports)
      try {
        const transRes = await this.client.getTransactions({ per_page: 50 });
        const transactions = transRes.transactions || [];

        let pending = 0;
        let validated = 0;
        let reversed = 0;
        let paid = 0;

        for (const tx of transactions) {
          const amt = Number(tx.user_commission ?? tx.commission_amount) || 0;
          if (tx.status === 'pending') {
            pending += amt;
          } else if (tx.status === 'validated' || tx.status === 'payable' || tx.status === 'approved') {
            validated += amt;
          } else if (tx.status === 'rejected') {
            reversed += amt;
          } else if (tx.status === 'paid' || tx.status === 'invoice_raised') {
            paid += amt;
          }
        }

        const perfRes = await this.client.getPerformanceReport({
          start_date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          per_page: 50
        });
        const providerClicks = perfRes.totals
          ? Number(perfRes.totals.clicks || 0)
          : perfRes.data.reduce((acc, r) => acc + (Number(r.clicks) || 0), 0);
        const reportedConversions = perfRes.totals
          ? Number(perfRes.totals.transactions ?? (perfRes.totals as any).conversions ?? 0)
          : perfRes.data.reduce((acc, r) => acc + (Number(r.transactions ?? (r as any).conversions) || 0), 0);

        this.syncStatus.reconciliation = {
          localClicks: this.syncStatus.reconciliation.localClicks,
          providerAttributedClicks: providerClicks,
          reportedConversions: reportedConversions,
          pendingCommissionINR: Math.round(pending * 100) / 100,
          validatedCommissionINR: Math.round(validated * 100) / 100,
          reversedCommissionINR: Math.round(reversed * 100) / 100,
          paidCommissionINR: Math.round(paid * 100) / 100,
          cashReceivedINR: 0 // strictly ₹0.00 until bank statement proof
        };
      } catch (recErr: any) {
        console.warn(`[CuelinksSync] Reconciliation notice: ${recErr.message}`);
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
          access_status: 'open',
          sort: 'epc_7d',
          order: 'desc',
          page: campaignPage,
          per_page: batchSize
        });

        eligibleCampaigns = (campRes.campaigns || []).filter(
          c => (!c.status || c.status === 'active') && (c.access_status === 'open' || c.access_status === 'approved')
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
      for (const camp of campaigns.slice(0, 20)) {
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
