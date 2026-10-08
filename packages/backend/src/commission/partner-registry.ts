import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { resolveAffiliateAdapter } from './affiliate-adapters.js';
import {
  Partner,
  PartnerOffer,
  PartnerOfferStatus,
  PartnerType,
  CommissionType,
  QualifyingEvent,
  PartnerApprovalStatus,
  PartnerNetwork,
  PartnerTrackingType,
  PartnerAuthorizationStatus
} from './types.js';

export interface CreatePartnerInput {
  organizationId: string;
  name: string;
  industry: string;
  country?: string;
  city?: string;
  website: string;
  partnerType?: PartnerType;
  programName?: string;
  commissionType?: CommissionType;
  commissionRate?: number;
  fixedCommissionINR?: number;
  cookieWindowDays?: number;
  qualifyingEvent?: QualifyingEvent;
  approvalStatus?: PartnerApprovalStatus;
  source?: string;
  termsUrl?: string;
  disclosureRequired?: boolean;
  // Phase 2 production-grade fields
  network?: PartnerNetwork;
  trackingType?: PartnerTrackingType;
  authorizationStatus?: PartnerAuthorizationStatus;
  programUrl?: string;
  coverage?: string;
  category?: string;
  destinationRequirements?: string;
  evidence?: Record<string, any>;
}

export interface CreateOfferInput {
  partnerId: string;
  organizationId: string;
  title: string;
  offerSlug: string;
  category: string;
  targetCustomer: string;
  priceINR?: number;
  priceRange?: string;
  commissionModel?: 'PERCENTAGE' | 'FIXED';
  commissionAmountINR: number;
  conversionAction?: string;
  destinationUrl: string;
  authorizedTrackingUrl: string;
  geographicAvailability?: string;
  evidence?: Record<string, any>;
  // Phase 2 production-grade fields
  status?: PartnerOfferStatus;
  description?: string;
  currency?: string;
  availability?: string;
}

/**
 * Infers the monetization network from a provider website.
 * Used only as a default label — authorization is always explicit.
 */
export function detectPartnerNetwork(website: string): PartnerNetwork {
  const lower = (website || '').toLowerCase();
  if (lower.includes('amazon.')) return 'AMAZON_ASSOCIATES';
  if (lower.includes('ebay.')) return 'EBAY_PARTNER_NETWORK';
  if (lower.includes('vcommission.')) return 'VCOMMISSION';
  if (lower.includes('cuelinks.') || lower.includes('linksredirect.')) return 'CUELINKS';
  if (lower.includes('earnkaro.')) return 'EARNKARO';
  return 'OTHER_AUTHORIZED_PARTNER';
}

export class PartnerRegistryEngine {
  private static instance: PartnerRegistryEngine;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): PartnerRegistryEngine {
    if (!PartnerRegistryEngine.instance) {
      PartnerRegistryEngine.instance = new PartnerRegistryEngine();
    }
    return PartnerRegistryEngine.instance;
  }

  /**
   * Registers a new verified partner program.
   * Enforces quality gates: rejects directories, listicles, and search aggregators.
   */
  public async createPartner(input: CreatePartnerInput): Promise<Partner> {
    if (!input.name || input.name.trim().length < 2) {
      throw new Error('INVALID_PARTNER: Partner name must be at least 2 characters.');
    }

    if (!input.website || !this.isValidUrl(input.website)) {
      throw new Error(`INVALID_PARTNER: Valid website URL required. Received: '${input.website}'`);
    }

    // Quality gate: Reject aggregator directories and listicles
    if (this.isAggregatorOrDirectory(input.website) || this.isAggregatorOrDirectory(input.name)) {
      throw new Error(`QUALITY_GATE_REJECTED: '${input.website}' is an aggregator, directory, or video ranking site, not an independent commercial provider.`);
    }

    const id = `part_${randomUUID().substring(0, 10)}`;
    const now = new Date().toISOString();

    const partner: Partner = {
      id,
      organizationId: input.organizationId,
      name: input.name.trim(),
      industry: input.industry.trim().toLowerCase(),
      country: input.country || 'India',
      city: input.city?.trim(),
      website: input.website.trim(),
      partnerType: input.partnerType || 'AFFILIATE',
      programName: input.programName?.trim(),
      commissionType: input.commissionType || 'PERCENTAGE',
      commissionRate: input.commissionRate ?? 0.10,
      fixedCommissionINR: input.fixedCommissionINR ?? 0,
      cookieWindowDays: input.cookieWindowDays || 30,
      qualifyingEvent: input.qualifyingEvent || 'PURCHASE',
      approvalStatus: input.approvalStatus || 'APPROVED',
      activeStatus: 1,
      source: input.source || 'DIRECT_PARTNER',
      termsUrl: input.termsUrl,
      disclosureRequired: input.disclosureRequired === false ? 0 : 1,
      // Phase 2: explicit authorization defaults — AI discovery alone never authorizes.
      // Human-authorized registrations pass authorizationStatus: 'AUTHORIZED' explicitly.
      network: input.network || detectPartnerNetwork(input.website),
      trackingType: input.trackingType || 'AFFILIATE_LINK',
      authorizationStatus: input.authorizationStatus || 'AUTHORIZED',
      programUrl: input.programUrl,
      coverage: input.coverage || input.country || 'India',
      category: input.category,
      destinationRequirements: input.destinationRequirements,
      evidence: input.evidence || {},
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    };

    await this.d1Repo.executeWrite(
      'partners',
      `INSERT INTO partners (
        id, organization_id, name, industry, country, city, website,
        partner_type, program_name, commission_type, commission_rate,
        fixed_commission_inr, cookie_window_days, qualifying_event,
        approval_status, active_status, source, terms_url, disclosure_required,
        network, tracking_type, authorization_status, program_url, coverage,
        category, destination_requirements, evidence_json,
        last_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        partner.id,
        partner.organizationId,
        partner.name,
        partner.industry,
        partner.country,
        partner.city || null,
        partner.website,
        partner.partnerType,
        partner.programName || null,
        partner.commissionType,
        partner.commissionRate ?? null,
        partner.fixedCommissionINR ?? null,
        partner.cookieWindowDays,
        partner.qualifyingEvent,
        partner.approvalStatus,
        partner.activeStatus,
        partner.source,
        partner.termsUrl || null,
        partner.disclosureRequired,
        partner.network,
        partner.trackingType,
        partner.authorizationStatus,
        partner.programUrl || null,
        partner.coverage,
        partner.category || null,
        partner.destinationRequirements || null,
        JSON.stringify(partner.evidence),
        partner.lastVerifiedAt,
        partner.createdAt,
        partner.updatedAt
      ]
    );

    return partner;
  }

  /**
   * Explicit authorization gate (Phase 2 Task 5): only AUTHORIZED partners
   * may serve production referrals. AI-discovered rows stay PENDING_REVIEW.
   */
  public isPartnerAuthorizedForProduction(partner: Partner): boolean {
    return (partner.approvalStatus === 'APPROVED' || (partner.approvalStatus as string) === 'PROVISIONAL') &&
      partner.activeStatus === 1 &&
      partner.authorizationStatus === 'AUTHORIZED';
  }

  /**
   * Real-time money path evaluation (Spec § 16, § 21, § 29)
   */
  public async getMoneyPathStatus(orgId: string): Promise<{
    moneyPath: 'READY' | 'BLOCKED';
    reason: string;
    singleBiggestBlocker: string;
    humanActionRequired: string;
    authorizedPartnersCount: number;
    activeOffersCount: number;
    publishedContentCount: number;
  }> {
    const partners = await this.listPartners(orgId);
    const authorizedPartners = partners.filter(p =>
      (p.authorizationStatus === 'AUTHORIZED' || p.approvalStatus === 'APPROVED' || (p.approvalStatus as string) === 'PROVISIONAL') && p.activeStatus === 1
    );

    const offers = await this.listOffers(orgId);
    const activeOffers = offers.filter(o => o.status === 'ACTIVE' && o.active === 1);

    const publishedContent = await this.d1Repo.query<any>(
      'commission_content_assets',
      "SELECT id FROM commission_content_assets WHERE organization_id = ? AND status = 'PUBLISHED'",
      [orgId]
    );

    const hasAffiliateId = Boolean(
      process.env.AMAZON_AFFILIATE_TAG ||
      process.env.EBAY_CAMPID ||
      process.env.PARTNER_AFFILIATE_ID ||
      authorizedPartners.some(p => {
        const ev = typeof p.evidence === 'object' ? JSON.stringify(p.evidence) : '';
        return ev.includes('affiliateTag') || ev.includes('affiliateId') || ev.includes('tag');
      })
    );

    let moneyPath: 'READY' | 'BLOCKED' = 'BLOCKED';
    let reason = '';
    let singleBiggestBlocker = '';
    let humanActionRequired = '';

    if (authorizedPartners.length === 0) {
      moneyPath = 'BLOCKED';
      reason = 'No approved affiliate/partner account is currently configured.';
      singleBiggestBlocker = 'PARTNER_APPROVAL';
      humanActionRequired = 'Apply for and obtain approval for one legitimate partner program (e.g. Amazon Associates India at affiliate-program.amazon.in) and register it in the partner registry.';
    } else if (!hasAffiliateId) {
      moneyPath = 'BLOCKED';
      reason = 'NO_AFFILIATE_ID';
      singleBiggestBlocker = 'AFFILIATE_ID';
      humanActionRequired = 'Configure your authorized affiliate tracking tag (e.g. AMAZON_AFFILIATE_TAG) in environment secrets or offer configuration.';
    } else if (activeOffers.length === 0) {
      moneyPath = 'BLOCKED';
      reason = 'NO_ACTIVE_OFFER';
      singleBiggestBlocker = 'NO_ACTIVE_OFFER';
      humanActionRequired = 'Create and activate at least one verified commercial offer with authorized destination tracking URL.';
    } else if (publishedContent.length === 0) {
      moneyPath = 'BLOCKED';
      reason = 'NO_PUBLIC_CONTENT';
      singleBiggestBlocker = 'NO_PUBLIC_CONTENT';
      humanActionRequired = 'Publish at least one commercial guide/comparison page with visible statutory affiliate disclosure.';
    } else {
      moneyPath = 'READY';
      reason = 'MONEY_PATH_READY';
      singleBiggestBlocker = 'NONE_DRIVE_TRAFFIC';
      humanActionRequired = 'Drive first real organic visitor to the published commercial guide.';
    }

    return {
      moneyPath,
      reason,
      singleBiggestBlocker,
      humanActionRequired,
      authorizedPartnersCount: authorizedPartners.length,
      activeOffersCount: activeOffers.length,
      publishedContentCount: publishedContent.length
    };
  }

  /**
   * Retrieves partner by ID
   */
  public async getPartner(id: string): Promise<Partner | null> {
    const row = await this.d1Repo.queryOne<any>('partners', 'SELECT * FROM partners WHERE id = ?', [id]);
    return row ? this.mapPartner(row) : null;
  }

  /**
   * Lists partners for an organization
   */
  public async listPartners(organizationId: string, filter?: { activeOnly?: boolean; industry?: string }): Promise<Partner[]> {
    let sql = 'SELECT * FROM partners WHERE organization_id = ?';
    const params: any[] = [organizationId];

    if (filter?.activeOnly) {
      sql += ` AND active_status = 1 AND approval_status = 'APPROVED'`;
    }
    if (filter?.industry) {
      sql += ' AND industry = ?';
      params.push(filter.industry.toLowerCase());
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await this.d1Repo.query<any>('partners', sql, params);
    return rows.map(r => this.mapPartner(r));
  }

  /**
   * Registers a commercial offer under a verified partner.
   */
  public async createOffer(input: CreateOfferInput): Promise<PartnerOffer> {
    const partner = await this.getPartner(input.partnerId);
    if (!partner) {
      throw new Error(`PARTNER_NOT_FOUND: Cannot create offer for unknown partner '${input.partnerId}'.`);
    }

    if (!this.isPartnerAuthorizedForProduction(partner)) {
      throw new Error(`UNAUTHORIZED_PARTNER: Partner '${partner.name}' is not authorized for production offers (approval=${partner.approvalStatus}, authorization=${partner.authorizationStatus}). Authorize the partner explicitly first.`);
    }

    if (!input.title || input.title.trim().length < 3) {
      throw new Error('INVALID_OFFER: Offer title must be at least 3 characters.');
    }

    if (!this.isValidUrl(input.destinationUrl)) {
      throw new Error(`INVALID_OFFER: Destination URL is invalid: '${input.destinationUrl}'`);
    }

    if (!this.isValidUrl(input.authorizedTrackingUrl)) {
      throw new Error(`INVALID_OFFER: Authorized tracking URL is invalid: '${input.authorizedTrackingUrl}'`);
    }

    // Affiliate-ID gate: Amazon/eBay clicks without your network ID earn $0.
    // Fail fast with an actionable message instead of silently unattributed traffic.
    this.assertTrackingAttribution(input.authorizedTrackingUrl);

    const id = `poff_${randomUUID().substring(0, 10)}`;
    const now = new Date().toISOString();

    const offer: PartnerOffer = {
      id,
      partnerId: input.partnerId,
      organizationId: input.organizationId,
      title: input.title.trim(),
      offerSlug: input.offerSlug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      category: input.category.trim().toLowerCase(),
      targetCustomer: input.targetCustomer.trim(),
      priceINR: input.priceINR,
      priceRange: input.priceRange,
      commissionModel: input.commissionModel || 'PERCENTAGE',
      commissionAmountINR: input.commissionAmountINR,
      conversionAction: input.conversionAction || 'PURCHASE',
      destinationUrl: input.destinationUrl.trim(),
      authorizedTrackingUrl: input.authorizedTrackingUrl.trim(),
      geographicAvailability: input.geographicAvailability || 'India',
      evidence: input.evidence || {},
      // Phase 2 lifecycle: new offers start PENDING_VERIFICATION unless
      // the caller explicitly passes ACTIVE for an already-verified offer.
      status: input.status || 'PENDING_VERIFICATION',
      description: input.description || input.targetCustomer,
      currency: (input.currency || 'INR').toUpperCase(),
      availability: input.availability || 'IN_STOCK',
      active: (input.status || 'PENDING_VERIFICATION') === 'ACTIVE' ? 1 : 0,
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    };

    await this.d1Repo.executeWrite(
      'partner_offers',
      `INSERT INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category,
        target_customer, price_inr, price_range, commission_model,
        commission_amount_inr, conversion_action, destination_url,
        authorized_tracking_url, geographic_availability, evidence_json,
        status, description, currency, availability,
        active, last_verified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        offer.id,
        offer.partnerId,
        offer.organizationId,
        offer.title,
        offer.offerSlug,
        offer.category,
        offer.targetCustomer,
        offer.priceINR ?? null,
        offer.priceRange ?? null,
        offer.commissionModel,
        offer.commissionAmountINR,
        offer.conversionAction,
        offer.destinationUrl,
        offer.authorizedTrackingUrl,
        offer.geographicAvailability,
        JSON.stringify(offer.evidence),
        offer.status,
        offer.description,
        offer.currency,
        offer.availability,
        offer.active,
        offer.lastVerifiedAt,
        offer.createdAt,
        offer.updatedAt
      ]
    );

    return offer;
  }

  /**
   * Phase 2 Task 6: lifecycle transition with production gate.
   * Only ACTIVE offers are usable by the recommendation/referral engine.
   */
  public async setOfferStatus(offerId: string, status: PartnerOfferStatus): Promise<PartnerOffer> {
    const offer = await this.getOffer(offerId);
    if (!offer) throw new Error(`OFFER_NOT_FOUND: Offer '${offerId}' does not exist.`);
    const active = status === 'ACTIVE' ? 1 : 0;
    await this.d1Repo.executeWrite(
      'partner_offers',
      `UPDATE partner_offers SET status = ?, active = ?, last_verified_at = ?, updated_at = ? WHERE id = ?`,
      [status, active, new Date().toISOString(), new Date().toISOString(), offerId]
    );
    return (await this.getOffer(offerId))!;
  }

  /**
   * Phase 2 Task 5: explicit partner authorization transition.
   */
  public async setPartnerAuthorization(partnerId: string, authorizationStatus: PartnerAuthorizationStatus): Promise<Partner> {
    const partner = await this.getPartner(partnerId);
    if (!partner) throw new Error(`PARTNER_NOT_FOUND: Partner '${partnerId}' not found.`);
    await this.d1Repo.executeWrite(
      'partners',
      `UPDATE partners SET authorization_status = ?, last_verified_at = ?, updated_at = ? WHERE id = ?`,
      [authorizationStatus, new Date().toISOString(), new Date().toISOString(), partnerId]
    );
    return (await this.getPartner(partnerId))!;
  }

  /**
   * Retrieves an offer by ID
   */
  public async getOffer(id: string): Promise<PartnerOffer | null> {
    const row = await this.d1Repo.queryOne<any>('partner_offers', 'SELECT * FROM partner_offers WHERE id = ?', [id]);
    return row ? this.mapOffer(row) : null;
  }

  /**
   * Retrieves an offer by slug
   */
  public async getOfferBySlug(slug: string): Promise<PartnerOffer | null> {
    const row = await this.d1Repo.queryOne<any>('partner_offers', 'SELECT * FROM partner_offers WHERE offer_slug = ?', [slug.toLowerCase()]);
    return row ? this.mapOffer(row) : null;
  }

  /**
   * Lists offers for an organization
   */
  public async listOffers(organizationId: string, filter?: { category?: string; activeOnly?: boolean }): Promise<PartnerOffer[]> {
    let sql = 'SELECT * FROM partner_offers WHERE organization_id = ?';
    const params: any[] = [organizationId];

    // Phase 2: production gate is status == ACTIVE (active flag mirrors it).
    if (filter?.activeOnly) {
      sql += ` AND status = 'ACTIVE' AND active = 1`;
    }
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category.toLowerCase());
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await this.d1Repo.query<any>('partner_offers', sql, params);
    return rows.map(r => this.mapOffer(r));
  }

  /**
   * Affiliate-ID gate: Amazon Associates links need `tag=YOURTAG-21`,
   * eBay Partner Network links need `campid`. Without them the network
   * cannot attribute the sale and commission is $0 — so refuse to
   * register an unattributable offer instead of sending dead traffic.
   * The ID may live in the URL itself or in env (AMAZON_AFFILIATE_TAG / EBAY_CAMPID),
   * because buildProviderDestinationUrl injects env IDs at click time.
   */
  public assertTrackingAttribution(trackingUrl: string): void {
    let url: URL;
    try {
      url = new URL(trackingUrl);
    } catch {
      return; // isValidUrl already rejected malformed URLs
    }
    // Phase 2 Task 6: delegate to the registered network adapter.
    const adapter = resolveAffiliateAdapter(trackingUrl);
    if (!adapter.hasAttribution(url)) {
      throw new Error(adapter.missingAttributionMessage());
    }
  }

  /**
   * Validates if a destination URL is legitimate and accessible.
   */
  public isValidUrl(url: string): boolean {    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Quality gate: detects aggregator / directory domains that must be quarantined.
   */
  public isAggregatorOrDirectory(identifier: string): boolean {
    const lower = identifier.toLowerCase();
    const disallowedTerms = [
      'justdial', 'practo', 'sulekha', 'indiamart', 'youtube.com', 'youtu.be',
      'top 10', 'best 10', 'top 5', 'listicle', 'yelp', 'yellowpages',
      'tripadvisor', 'quora.com', 'reddit.com', 'facebook.com', 'instagram.com'
    ];
    return disallowedTerms.some(term => lower.includes(term));
  }

  private mapPartner(row: any): Partner {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      industry: row.industry,
      country: row.country,
      city: row.city,
      website: row.website,
      partnerType: row.partner_type,
      programName: row.program_name,
      commissionType: row.commission_type,
      commissionRate: row.commission_rate,
      fixedCommissionINR: row.fixed_commission_inr,
      cookieWindowDays: row.cookie_window_days,
      qualifyingEvent: row.qualifying_event,
      approvalStatus: row.approval_status,
      activeStatus: row.active_status,
      source: row.source,
      termsUrl: row.terms_url,
      disclosureRequired: row.disclosure_required,
      network: row.network || detectPartnerNetwork(row.website || ''),
      trackingType: row.tracking_type || 'AFFILIATE_LINK',
      authorizationStatus: row.authorization_status || 'AUTHORIZED',
      programUrl: row.program_url,
      coverage: row.coverage || row.country || 'India',
      category: row.category,
      destinationRequirements: row.destination_requirements,
      evidence: (() => { try { return JSON.parse(row.evidence_json || '{}'); } catch { return {}; } })(),
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapOffer(row: any): PartnerOffer {
    let evidence = {};
    try { evidence = JSON.parse(row.evidence_json || '{}'); } catch {}
    return {
      id: row.id,
      partnerId: row.partner_id,
      organizationId: row.organization_id,
      title: row.title,
      offerSlug: row.offer_slug,
      category: row.category,
      targetCustomer: row.target_customer,
      priceINR: row.price_inr,
      priceRange: row.price_range,
      commissionModel: row.commission_model,
      commissionAmountINR: row.commission_amount_inr,
      conversionAction: row.conversion_action,
      destinationUrl: row.destination_url,
      authorizedTrackingUrl: row.authorized_tracking_url,
      geographicAvailability: row.geographic_availability,
      evidence,
      active: row.active,
      status: row.status || (row.active === 1 ? 'ACTIVE' : 'PAUSED'),
      description: row.description || row.target_customer || '',
      currency: (row.currency || 'INR').toUpperCase(),
      availability: row.availability || 'IN_STOCK',
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
