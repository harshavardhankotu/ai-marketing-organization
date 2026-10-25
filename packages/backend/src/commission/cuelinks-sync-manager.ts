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
  CuelinksCampaign,
  CuelinksOffer,
  CuelinksReconciliationMetrics
} from './cuelinks-v3-types.js';
import { DealCandidate, NormalizedDeal } from './deal-types.js';

export class CuelinksSyncManager {
  private static instance: CuelinksSyncManager | null = null;
  private client: CuelinksV3Client;
  private syncStatus: CuelinksSyncStatus;

  constructor(client?: CuelinksV3Client) {
    this.client = client || CuelinksV3Client.getInstance();
    this.syncStatus = {
      configured: this.client.isConfigured(),
      connected: false,
      channel: { status: 'UNKNOWN' },
      campaignsDiscovered: 0,
      eligibleCampaignsCount: 0,
      offersRetrieved: 0,
      linksConverted: 0,
      lastSyncTimestamp: 'NEVER',
      status: this.client.isConfigured() ? 'IDLE' : 'BLOCKED_AUTHORIZATION',
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
      ownerActionRequired: this.client.isConfigured()
        ? undefined
        : 'Provide CUELINKS_API_KEY in environment variables or Render dashboard to enable automated Cuelinks campaign discovery and affiliate link conversion.'
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
   * Run full Cuelinks autonomous cycle:
   * 1. Auth & Channel verification
   * 2. Campaign discovery
   * 3. Offer discovery & candidate conversion
   * 4. Performance reconciliation
   */
  public async syncCuelinks(organizationId: string = 'org_owner_primary', businessId: string = 'biz_platform_aro'): Promise<{
    success: boolean;
    reason?: string;
    status: CuelinksSyncStatus;
    dealCandidates: DealCandidate[];
  }> {
    if (!this.client.isConfigured()) {
      this.syncStatus.configured = false;
      this.syncStatus.connected = false;
      this.syncStatus.status = 'BLOCKED_AUTHORIZATION';
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
    const dealCandidates: DealCandidate[] = [];

    try {
      // 1. Ping / Connection test
      const pingRes = await this.client.ping();
      if (!pingRes.connected) {
        this.syncStatus.connected = false;
        this.syncStatus.status = 'BLOCKED_AUTHORIZATION';
        this.syncStatus.ownerActionRequired = `Cuelinks authentication failed: ${pingRes.message}. Check CUELINKS_API_KEY.`;
        return {
          success: false,
          reason: pingRes.message,
          status: this.getStatus(),
          dealCandidates: []
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
          c => c.status === 'active' && (c.access_status === 'open' || c.access_status === 'approved')
        );
        this.syncStatus.eligibleCampaignsCount = eligibleCampaigns.length;

        // Persist discovered campaigns to D1
        await this.persistCampaignsD1(organizationId, businessId, eligibleCampaigns);
      } catch (campErr: any) {
        console.warn(`[CuelinksSync] Campaign search notice: ${campErr.message}`);
      }

      // 4. Offer & Deal Discovery across eligible campaigns
      try {
        const offersRes = await this.client.getOffers({ per_page: 30 });
        const rawOffers = offersRes.offers || [];
        this.syncStatus.offersRetrieved = rawOffers.length;

        // Convert candidate offers into normalized DealCandidate format
        for (const offer of rawOffers) {
          if (!offer.url || !offer.title) continue;

          // Check if offer's campaign is in eligible campaigns or active
          const campaign = eligibleCampaigns.find(c => String(c.id) === String(offer.campaign_id));
          const merchantName = offer.campaign_name || campaign?.merchant_name || campaign?.name || 'Authorized Merchant';

          // Extract pricing or discount
          let currentPrice = offer.current_price_inr;
          let refPrice = offer.reference_price_inr;
          let claimedDiscount = 0;

          if (offer.discount) {
            const discMatch = offer.discount.match(/(\d+)%/);
            if (discMatch) {
              claimedDiscount = Number(discMatch[1]);
            }
          }

          if (currentPrice && !refPrice && claimedDiscount > 0 && claimedDiscount < 90) {
            refPrice = Math.round(currentPrice / (1 - claimedDiscount / 100));
          } else if (!currentPrice && refPrice && claimedDiscount > 0) {
            currentPrice = Math.round(refPrice * (1 - claimedDiscount / 100));
          }

          // Do NOT fabricate prices or discounts. Skip offers lacking a valid positive INR price.
          if (!currentPrice || currentPrice <= 0) {
            continue;
          }

          // Authorize tracked link via convertLink if campaign is eligible
          let trackingUrl = offer.url;
          let isMonetizable = false;

          try {
            const convertRes = await this.client.convertLink({
              url: offer.url,
              channel_id: this.syncStatus.channel.id,
              shorten: true,
              subid: `aro_cl_${offer.id}`,
              subid2: String(offer.campaign_id),
              subid3: 'cuelinks_feed',
              subid4: 'catalog_v1'
            });

            // Monetization truth: strictly require affiliated: true before marking eligible to earn commission
            if (convertRes.affiliated === true && convertRes.tracking_url) {
              trackingUrl = convertRes.tracking_url;
              isMonetizable = true;
              this.syncStatus.linksConverted++;
            } else {
              // Record deal as non-monetizable and preserve original direct merchant URL
              trackingUrl = offer.url;
              isMonetizable = false;
            }
          } catch (convErr: any) {
            // Keep clean merchant direct link if conversion fails
            trackingUrl = offer.url;
            isMonetizable = false;
          }

          const candidate: DealCandidate = {
            title: offer.title,
            brand: merchantName,
            merchant: merchantName,
            category: offer.category || 'Retail Deals',
            productUrl: offer.url,
            currentPriceINR: currentPrice,
            referencePriceINR: refPrice,
            claimedDiscountPercent: claimedDiscount || undefined,
            couponCode: offer.coupon_code,
            couponConditions: offer.terms,
            sourceUrl: offer.url,
            sourceDomain: 'cuelinks.com',
            sourceType: 'AFFILIATE_NETWORK',
            trackingUrl: isMonetizable ? trackingUrl : undefined,
            affiliateNetwork: isMonetizable ? 'CUELINKS' : undefined,
            affiliateCampaignId: String(offer.campaign_id),
            isMonetizable
          };

          dealCandidates.push(candidate);
        }
      } catch (offerErr: any) {
        console.warn(`[CuelinksSync] Offer retrieval notice: ${offerErr.message}`);
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
          const amt = Number(tx.commission_amount) || 0;
          if (tx.status === 'pending') pending += amt;
          else if (tx.status === 'approved') validated += amt;
          else if (tx.status === 'rejected') reversed += amt;
          else if (tx.status === 'paid') paid += amt;
        }

        const reportsRes = await this.client.getReports({ per_page: 50 });
        const providerClicks = reportsRes.reports.reduce((acc, r) => acc + (r.clicks || 0), 0);
        
        // Strict separation of 8 accounting counters:
        // 1. Local clicks: locally observed clicks from deal clicks
        // 2. Provider-attributed clicks: derived from Cuelinks /reports
        // 3. Reported conversions: derived from Cuelinks /reports (or valid non-rejected transactions if reports empty)
        // 4. Pending commission: sum of pending transaction amounts in INR
        // 5. Validated commission: sum of approved transaction amounts in INR
        // 6. Reversed commission: sum of rejected transaction amounts in INR
        // 7. Paid commission: sum of paid transaction amounts in INR
        // 8. Cash received: strictly ₹0.00 until bank statement verified proof
        const reportsConversions = reportsRes.reports.reduce((acc, r) => acc + (r.conversions || 0), 0);
        const reportedConversions = reportsConversions > 0
          ? reportsConversions
          : (transactions.length > 0 ? transactions.filter(t => t.status !== 'rejected').length : 0);

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

      this.syncStatus.status = 'SUCCESS';
      this.syncStatus.lastSyncTimestamp = new Date().toISOString();
      this.syncStatus.ownerActionRequired = undefined;

      // Persist full sync result in D1
      await this.persistSyncD1(organizationId, businessId);

      return {
        success: true,
        status: this.getStatus(),
        dealCandidates
      };
    } catch (err: any) {
      this.syncStatus.status = 'ERROR';
      this.syncStatus.ownerActionRequired = `Cuelinks cycle failure: ${err.message}`;
      return {
        success: false,
        reason: err.message,
        status: this.getStatus(),
        dealCandidates: []
      };
    }
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
}
