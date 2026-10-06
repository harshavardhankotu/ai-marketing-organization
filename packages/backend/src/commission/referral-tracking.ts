import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { PartnerRegistryEngine } from './partner-registry.js';
import { resolveAffiliateAdapter } from './affiliate-adapters.js';
import { Referral, PartnerOffer, Partner } from './types.js';

export interface CreateReferralLinkOptions {
  source?: string;
  campaign?: string;
  medium?: string;
  anonymousSessionId?: string;
  landingPage?: string;
  customParameters?: Record<string, string>;
  // Phase 2 Task 8: first-class attribution (anonymous, no PII)
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
}

export class ReferralTrackingEngine {
  private static instance: ReferralTrackingEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private registry = PartnerRegistryEngine.getInstance();

  public static getInstance(): ReferralTrackingEngine {
    if (!ReferralTrackingEngine.instance) {
      ReferralTrackingEngine.instance = new ReferralTrackingEngine();
    }
    return ReferralTrackingEngine.instance;
  }

  /**
   * Creates an attributable referral link.
   * Does NOT count as revenue.
   */
  public async createReferralLink(
    offerId: string,
    options: CreateReferralLinkOptions = {}
  ): Promise<{
    referralId: string;
    clickId: string;
    trackingUrl: string;
    destinationUrl: string;
    offer: PartnerOffer;
    partner: Partner;
  }> {
    const offer = await this.registry.getOffer(offerId);
    if (!offer) {
      throw new Error(`OFFER_NOT_FOUND: Offer '${offerId}' does not exist.`);
    }

    if (offer.status !== 'ACTIVE' || offer.active !== 1) {
      throw new Error(`OFFER_INACTIVE: Offer '${offer.title}' is not ACTIVE (status=${offer.status}). Referral rejected.`);
    }

    const partner = await this.registry.getPartner(offer.partnerId);
    if (!partner) {
      throw new Error(`PARTNER_NOT_FOUND: Associated partner '${offer.partnerId}' not found.`);
    }

    if (!this.registry.isPartnerAuthorizedForProduction(partner)) {
      throw new Error(`PARTNER_UNAUTHORIZED: Partner '${partner.name}' is not authorized for production referrals (approval=${partner.approvalStatus}, authorization=${partner.authorizationStatus}).`);
    }

    if (!offer.authorizedTrackingUrl || !this.registry.isValidUrl(offer.authorizedTrackingUrl)) {
      throw new Error(`INVALID_TRACKING_URL: Offer '${offer.title}' does not have a valid authorized tracking URL.`);
    }

    const referralId = `ref_${randomUUID().substring(0, 10)}`;
    const clickId = `clk_${randomUUID().replace(/-/g, '').substring(0, 16)}`;

    // Preserve tracking parameters and inject click identifier
    const trackingParams: Record<string, string> = {
      source: options.source || 'organic_recommendation',
      campaign: options.campaign || 'phase1_organic',
      medium: options.medium || 'referral',
      ...(options.customParameters || {})
    };

    // Build the resolved destination URL with provider's tracking preserved
    const resolvedDestinationUrl = this.buildProviderDestinationUrl(offer.authorizedTrackingUrl, clickId, trackingParams);

    const referral: Referral = {
      id: referralId,
      partnerId: partner.id,
      offerId: offer.id,
      organizationId: offer.organizationId,
      anonymousSessionId: options.anonymousSessionId,
      clickId,
      trackingParameters: trackingParams,
      landingPage: options.landingPage,
      source: options.source || 'organic',
      campaign: options.campaign || 'inbound',
      destinationUrl: resolvedDestinationUrl,
      // Phase 2 Task 8 attribution
      ip: options.ip,
      userAgent: options.userAgent,
      referer: options.referer,
      utmSource: options.utmSource,
      utmMedium: options.utmMedium,
      utmCampaign: options.utmCampaign,
      utmTerm: options.utmTerm,
      utmContent: options.utmContent,
      contentAssetId: options.contentAssetId,
      placement: options.placement,
      deviceClass: options.deviceClass,
      country: options.country,
      keyword: options.keyword,
      createdAt: new Date().toISOString()
    };

    await this.d1Repo.executeWrite(
      'referrals',
      `INSERT INTO referrals (
        id, partner_id, offer_id, organization_id, anonymous_session_id,
        click_id, tracking_parameters_json, landing_page, source,
        campaign, destination_url,
        ip, user_agent, referer, utm_source, utm_medium, utm_campaign,
        utm_term, utm_content, content_asset_id, placement, device_class,
        country, keyword, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        referral.id,
        referral.partnerId,
        referral.offerId,
        referral.organizationId,
        referral.anonymousSessionId || null,
        referral.clickId,
        JSON.stringify(referral.trackingParameters),
        referral.landingPage || null,
        referral.source || null,
        referral.campaign || null,
        referral.destinationUrl,
        referral.ip || null,
        referral.userAgent || null,
        referral.referer || null,
        referral.utmSource || null,
        referral.utmMedium || null,
        referral.utmCampaign || null,
        referral.utmTerm || null,
        referral.utmContent || null,
        referral.contentAssetId || null,
        referral.placement || null,
        referral.deviceClass || null,
        referral.country || null,
        referral.keyword || null,
        referral.createdAt
      ]
    );

    const trackingUrl = `/r/${offer.offerSlug}/${referral.id}`;

    return {
      referralId,
      clickId,
      trackingUrl,
      destinationUrl: resolvedDestinationUrl,
      offer,
      partner
    };
  }

  /**
   * Resolves a referral click, records the visit, increments counter, and returns destination.
   * Fails closed if offer is inactive or expired.
   * CRITICAL (§ 2): This redirect action is strictly tracked attribution, NEVER recognized as revenue.
   */
  public async resolveReferralClick(
    offerSlug: string,
    referralIdOrClickId: string,
    metadata: {
      userAgent?: string;
      referer?: string;
      ip?: string;
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
      source?: string;
      medium?: string;
      campaign?: string;
    } = {}
  ): Promise<{ destinationUrl: string; referral: Referral; offer: PartnerOffer }> {
    const offer = await this.registry.getOfferBySlug(offerSlug);
    if (!offer) {
      throw new Error(`OFFER_NOT_FOUND: Offer with slug '${offerSlug}' not found.`);
    }

    if (offer.status !== 'ACTIVE' || offer.active !== 1) {
      throw new Error(`OFFER_INACTIVE: Offer '${offer.title}' is not ACTIVE (status=${offer.status}). Referral redirect rejected.`);
    }

    let referral = await this.getReferral(referralIdOrClickId);
    if (!referral) {
      // Lookup by click_id
      referral = await this.getReferralByClickId(referralIdOrClickId);
    }

    if (!referral) {
      // Create new dynamic referral on the fly for direct public links
      const created = await this.createReferralLink(offer.id, {
        source: metadata.referer ? 'inbound_web' : 'direct',
        landingPage: metadata.referer
      });
      referral = await this.getReferral(created.referralId)!;
    }

    if (!referral) {
      throw new Error('REFERRAL_RESOLUTION_FAILED: Failed to record or resolve referral click.');
    }

    // Update content asset click count if linked
    try {
      await this.d1Repo.executeWrite(
        'commission_content_assets',
        'UPDATE commission_content_assets SET referral_click_count = referral_click_count + 1 WHERE primary_offer_id = ?',
        [offer.id]
      );
    } catch {}

    // Phase 2 Task 7: immutable click event (append-only — never updated).
    // Clicks create attribution, never revenue.
    try {
      const { randomUUID: uuid } = await import('crypto');
      await this.d1Repo.executeWrite(
        'referral_click_events',
        `INSERT INTO referral_click_events (
          id, referral_id, click_id, organization_id, offer_id, partner_id,
          content_asset_id, placement, source, medium, campaign, keyword,
          referrer, device_class, country, destination_url, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `evt_${uuid().substring(0, 10)}`,
          referral.id,
          referral.clickId,
          referral.organizationId,
          offer.id,
          offer.partnerId,
          metadata.contentAssetId || (referral as any).contentAssetId || null,
          metadata.placement || (referral as any).placement || null,
          metadata.source || (referral as any).source || null,
          metadata.medium || null,
          metadata.campaign || (referral as any).campaign || null,
          metadata.keyword || (referral as any).keyword || null,
          metadata.referer || (referral as any).referer || null,
          metadata.deviceClass || (referral as any).deviceClass || null,
          metadata.country || (referral as any).country || null,
          referral.destinationUrl,
          new Date().toISOString()
        ]
      );
    } catch {}

    return {
      destinationUrl: referral.destinationUrl,
      referral,
      offer
    };
  }

  public async getReferral(id: string): Promise<Referral | null> {
    const row = await this.d1Repo.queryOne<any>('referrals', 'SELECT * FROM referrals WHERE id = ?', [id]);
    return row ? this.mapReferral(row) : null;
  }

  public async getReferralByClickId(clickId: string): Promise<Referral | null> {
    const row = await this.d1Repo.queryOne<any>('referrals', 'SELECT * FROM referrals WHERE click_id = ?', [clickId]);
    return row ? this.mapReferral(row) : null;
  }

  public async listReferrals(organizationId: string, limit: number = 50): Promise<Referral[]> {
    const rows = await this.d1Repo.query<any>(
      'referrals',
      'SELECT * FROM referrals WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?',
      [organizationId, limit]
    );
    return rows.map(r => this.mapReferral(r));
  }

  /**
   * Network-aware tracked destination (Phase 2 Task 6): delegates to the
   * registered AffiliateNetworkAdapter, then preserves our internal
   * `subid=clickId` for first-party attribution. Never invents params
   * the network does not support.
   */
  private buildProviderDestinationUrl(baseUrl: string, clickId: string, params: Record<string, string>): string {
    try {
      const adapter = resolveAffiliateAdapter(baseUrl);
      const url = new URL(adapter.buildTrackedDestination({ baseUrl, clickId }));
      // Standard affiliate subid parameters if not already present
      if (!url.searchParams.has('subid') && !url.searchParams.has('click_id') && !url.searchParams.has('ref')) {
        url.searchParams.set('subid', clickId);
      }
      return url.toString();
    } catch {
      return baseUrl;
    }
  }

  private mapReferral(row: any): Referral {
    let trackingParameters = {};
    try { trackingParameters = JSON.parse(row.tracking_parameters_json || '{}'); } catch {}
    return {
      id: row.id,
      partnerId: row.partner_id,
      offerId: row.offer_id,
      organizationId: row.organization_id,
      anonymousSessionId: row.anonymous_session_id,
      clickId: row.click_id,
      trackingParameters,
      landingPage: row.landing_page,
      source: row.source,
      campaign: row.campaign,
      destinationUrl: row.destination_url,
      ip: row.ip,
      userAgent: row.user_agent,
      referer: row.referer,
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      utmTerm: row.utm_term,
      utmContent: row.utm_content,
      contentAssetId: row.content_asset_id,
      placement: row.placement,
      deviceClass: row.device_class,
      country: row.country,
      keyword: row.keyword,
      createdAt: row.created_at
    };
  }
}
