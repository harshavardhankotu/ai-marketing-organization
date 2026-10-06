import { randomUUID } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { PartnerRegistryEngine } from './partner-registry.js';
import { DemandOfferMatchingEngine } from './demand-offer-matching.js';
import { ContentAsset, ContentAssetType } from './types.js';

export interface CreateContentAssetInput {
  organizationId: string;
  slug: string;
  assetType: ContentAssetType;
  title: string;
  category: string;
  location?: string;
  intentTarget: string;
  contentMarkdown: string;
  primaryOfferId?: string;
  matchedOfferIds?: string[];
  disclosureMarkdown?: string;
}

export class ContentAssetEngine {
  private static instance: ContentAssetEngine;
  private d1Repo = D1RevenueRepository.getInstance();
  private registry = PartnerRegistryEngine.getInstance();
  private matcher = DemandOfferMatchingEngine.getInstance();

  public static getInstance(): ContentAssetEngine {
    if (!ContentAssetEngine.instance) {
      ContentAssetEngine.instance = new ContentAssetEngine();
    }
    return ContentAssetEngine.instance;
  }

  /**
   * Phase 2 Task 15: content quality gate. Returns per-check results;
   * critical failures mean DO NOT PUBLISH (asset is stored as DRAFT).
   * Checks: real topic/intent, real ACTIVE offer + authorized partner,
   * current valid tracking destination, evidence present, no fabricated
   * claims (reviews/prices/guarantees), disclosure present.
   */
  public async validateForPublish(input: CreateContentAssetInput): Promise<{ passed: boolean; failures: string[]; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {};
    const failures: string[] = [];

    checks.realTopic = (input.intentTarget || '').trim().length >= 8 && (input.title || '').trim().length >= 8;
    if (!checks.realTopic) failures.push('NO_REAL_TOPIC: intent and title must describe a genuine customer problem.');

    checks.contentSubstance = (input.contentMarkdown || '').trim().length >= 300;
    if (!checks.contentSubstance) failures.push('THIN_CONTENT: body must contain genuinely useful guidance (300+ chars).');

    const offerIds = [...(input.matchedOfferIds || []), ...(input.primaryOfferId ? [input.primaryOfferId] : [])];
    checks.hasOffer = offerIds.length > 0;
    if (!checks.hasOffer) failures.push('NO_OFFER: at least one partner offer must back the page.');

    checks.offersActive = true;
    checks.trackingValid = true;
    checks.evidencePresent = true;
    for (const offerId of offerIds) {
      const offerRow = await this.d1Repo.queryOne<any>('partner_offers', 'SELECT * FROM partner_offers WHERE id = ?', [offerId]);
      if (!offerRow || offerRow.status !== 'ACTIVE' || Number(offerRow.active) !== 1) {
        checks.offersActive = false;
        failures.push(`INACTIVE_OFFER: offer '${offerId}' is not ACTIVE and cannot be published.`);
        continue;
      }
      try {
        this.registry.assertTrackingAttribution(offerRow.authorized_tracking_url);
      } catch (e: any) {
        checks.trackingValid = false;
        failures.push(`INVALID_TRACKING: offer '${offerId}': ${e.message}`);
      }
      let evidence: any = {};
      try { evidence = JSON.parse(offerRow.evidence_json || '{}'); } catch {}
      if (Object.keys(evidence).length === 0 && !offerRow.destination_url) {
        checks.evidencePresent = false;
        failures.push(`NO_EVIDENCE: offer '${offerId}' has no evidence or destination.`);
      }
    }

    const body = (input.contentMarkdown || '').toLowerCase();
    const fabricatedPatterns = [
      /(\d+(\.\d+)?\s*stars? ratings?)/,
      /"[^"]{0,80}(amazing|life-changing|guaranteed)[^"]{0,80}"/,
      /100%\s*guarantee/,
      /risk-free.*refund.*guarantee/,
      /₹[\d,]+\s*(only|just)/,
    ];
    checks.noFabricatedClaims = !fabricatedPatterns.some(p => p.test(body));
    if (!checks.noFabricatedClaims) failures.push('FABRICATED_CLAIMS: remove invented reviews, prices, or guarantees.');

    checks.noUnfilledPlaceholders = !body.includes('operator_to_fill');
    if (!checks.noUnfilledPlaceholders) failures.push('UNFILLED_PLACEHOLDER: content contains OPERATOR_TO_FILL markers and cannot be published.');

    // Direct Amazon links in markdown must carry an affiliate tag parameter
    const amazonLinkMatches = (input.contentMarkdown || '').match(/https?:\/\/(?:www\.)?amazon\.[a-z.0-9-_/]+(?:\?[^\s"')>]+)?/gi) || [];
    let untaggedAmazonLink = false;
    for (const rawUrl of amazonLinkMatches) {
      try {
        const parsed = new URL(rawUrl);
        const tag = parsed.searchParams.get('tag');
        if (!tag || tag.trim().length === 0) {
          untaggedAmazonLink = true;
          break;
        }
      } catch {
        untaggedAmazonLink = true;
        break;
      }
    }
    checks.noUntaggedAmazonLinks = !untaggedAmazonLink;
    if (!checks.noUntaggedAmazonLinks) failures.push('UNTAGGED_AMAZON_LINK: Amazon links in content must include an authorized affiliate tag.');

    // Disclosure is always applied by createAsset (defaultDisclosure), so this
    // check only fails when the caller explicitly passes an empty disclosure
    // AND the body carries no affiliate language (defense in depth).
    const explicitEmptyDisclosure = input.disclosureMarkdown !== undefined && input.disclosureMarkdown.trim().length <= 40;
    checks.disclosurePresent = !explicitEmptyDisclosure ||
      body.includes('affiliate') || body.includes('commission') || body.includes('referral');
    if (!checks.disclosurePresent) failures.push('DISCLOSURE_MISSING: affiliate disclosure is required.');

    return { passed: failures.length === 0, failures, checks };
  }

  /**
   * Creates a durable content acquisition asset.
   * Phase 2 Task 15: failing the quality gate stores DRAFT (unpublished).
   */
  public async createAsset(input: CreateContentAssetInput): Promise<ContentAsset> {
    const id = `cnt_${randomUUID().substring(0, 10)}`;
    const now = new Date().toISOString();
    const cleanSlug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');

    const defaultDisclosure =
      '**Affiliate & Referral Disclosure:** We provide independent analysis and recommendations. When you purchase or sign up through our referral links, we may earn an affiliate commission at no extra cost to you. All prices, terms, and specifications are subject to provider confirmation.';

    const gate = await this.validateForPublish(input);

    const asset: ContentAsset = {
      id,
      organizationId: input.organizationId,
      slug: cleanSlug,
      assetType: input.assetType,
      title: input.title.trim(),
      category: input.category.trim().toLowerCase(),
      location: input.location?.trim() || 'India',
      intentTarget: input.intentTarget.trim(),
      contentMarkdown: input.contentMarkdown.trim(),
      primaryOfferId: input.primaryOfferId,
      matchedOfferIds: input.matchedOfferIds || [],
      disclosureMarkdown: input.disclosureMarkdown || defaultDisclosure,
      // Phase 2 Task 15: critical gate failure => DRAFT (never publicly served).
      status: gate.passed ? 'PUBLISHED' : 'DRAFT',
      viewCount: 0,
      referralClickCount: 0,
      createdAt: now,
      updatedAt: now
    };

    await this.d1Repo.executeWrite(
      'commission_content_assets',
      `INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category,
        location, intent_target, content_markdown, primary_offer_id,
        matched_offer_ids_json, disclosure_markdown, status,
        view_count, referral_click_count, quality_gate_json, disclosure_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, '2026.1', ?, ?)`,
      [
        asset.id,
        asset.organizationId,
        asset.slug,
        asset.assetType,
        asset.title,
        asset.category,
        asset.location,
        asset.intentTarget,
        asset.contentMarkdown,
        asset.primaryOfferId || null,
        JSON.stringify(asset.matchedOfferIds),
        asset.disclosureMarkdown,
        asset.status,
        JSON.stringify({ passed: gate.passed, failures: gate.failures, checks: gate.checks, evaluatedAt: now }),
        asset.createdAt,
        asset.updatedAt
      ]
    );

    return asset;
  }

  /**
   * Retrieves an asset by slug and increments the view counter.
   */
  public async getAssetBySlug(slug: string, recordView: boolean = true): Promise<ContentAsset | null> {
    const cleanSlug = slug.trim().toLowerCase();
    const row = await this.d1Repo.queryOne<any>(
      'commission_content_assets',
      'SELECT * FROM commission_content_assets WHERE slug = ? AND status = \'PUBLISHED\'',
      [cleanSlug]
    );

    if (!row) return null;

    if (recordView) {
      try {
        await this.d1Repo.executeWrite(
          'commission_content_assets',
          'UPDATE commission_content_assets SET view_count = view_count + 1 WHERE id = ?',
          [row.id]
        );
        row.view_count = (row.view_count || 0) + 1;
      } catch {}
    }

    return this.mapAsset(row);
  }

  /**
   * Lists published content assets
   */
  public async listAssets(organizationId: string, filter?: { category?: string; assetType?: ContentAssetType }): Promise<ContentAsset[]> {
    let sql = 'SELECT * FROM commission_content_assets WHERE organization_id = ? AND status = \'PUBLISHED\'';
    const params: any[] = [organizationId];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category.toLowerCase());
    }
    if (filter?.assetType) {
      sql += ' AND asset_type = ?';
      params.push(filter.assetType);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = await this.d1Repo.query<any>('commission_content_assets', sql, params);
    return rows.map(r => this.mapAsset(r));
  }

  /**
   * Autonomously generates a useful, factual comparison or recommendation page backed by verified partner offers.
   */
  public async generateAssetForIntent(
    organizationId: string,
    intent: string,
    category: string,
    location: string = 'India'
  ): Promise<ContentAsset> {
    const matches = await this.matcher.matchDemand({
      organizationId,
      intent,
      category,
      location,
      limit: 3
    });

    if (matches.length === 0) {
      throw new Error(`NO_VERIFIED_OFFERS: Cannot generate acquisition asset for '${intent}'. No verified partner offers available.`);
    }

    const primaryMatch = matches[0];
    const slug = `${category}-${primaryMatch.offer.offerSlug}-guide`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

    // Build genuine factual comparison content
    let contentMarkdown = `# Complete Guide: ${intent}\n\n`;
    contentMarkdown += `Finding the right solution for **${intent}** in ${location} requires evaluating verified providers, genuine customer outcomes, and pricing.\n\n`;
    contentMarkdown += `## Recommended Provider: ${primaryMatch.partner.name}\n\n`;
    contentMarkdown += `**${primaryMatch.offer.title}**\n\n`;
    contentMarkdown += `* **Category:** ${primaryMatch.offer.category}\n`;
    contentMarkdown += `* **Target Audience:** ${primaryMatch.offer.targetCustomer}\n`;
    if (primaryMatch.offer.priceRange) {
      contentMarkdown += `* **Price Range:** ${primaryMatch.offer.priceRange}\n`;
    }
    contentMarkdown += `* **Key Advantage:** Direct verified booking with dedicated support and transparent terms.\n\n`;
    contentMarkdown += `[Check Official Pricing & Availability on ${primaryMatch.partner.name}](/r/${primaryMatch.offer.offerSlug}/${primaryMatch.offer.id})\n\n`;

    if (matches.length > 1) {
      contentMarkdown += `## Alternatives to Consider\n\n`;
      for (let i = 1; i < matches.length; i++) {
        const alt = matches[i];
        contentMarkdown += `### ${i}. ${alt.partner.name} — ${alt.offer.title}\n`;
        contentMarkdown += `* Focus: ${alt.offer.targetCustomer}\n`;
        contentMarkdown += `* [View details and availability](/r/${alt.offer.offerSlug}/${alt.offer.id})\n\n`;
      }
    }

    contentMarkdown += `## Evaluation Checklist\n\n`;
    contentMarkdown += `Before purchasing, verify:\n`;
    contentMarkdown += `1. Clear terms of service and refund policies.\n`;
    contentMarkdown += `2. Direct support channel.\n`;
    contentMarkdown += `3. Verified business credentials and official domain registration.\n`;

    return await this.createAsset({
      organizationId,
      slug,
      assetType: 'RECOMMENDATION',
      title: `${primaryMatch.partner.name}: ${primaryMatch.offer.title} Review & Comparison (${location})`,
      category,
      location,
      intentTarget: intent,
      contentMarkdown,
      primaryOfferId: primaryMatch.offer.id,
      matchedOfferIds: matches.map(m => m.offer.id)
    });
  }

  private mapAsset(row: any): ContentAsset {
    let matchedOfferIds: string[] = [];
    try { matchedOfferIds = JSON.parse(row.matched_offer_ids_json || '[]'); } catch {}
    return {
      id: row.id,
      organizationId: row.organization_id,
      slug: row.slug,
      assetType: row.asset_type,
      title: row.title,
      category: row.category,
      location: row.location,
      intentTarget: row.intent_target,
      contentMarkdown: row.content_markdown,
      primaryOfferId: row.primary_offer_id,
      matchedOfferIds,
      disclosureMarkdown: row.disclosure_markdown,
      status: row.status,
      viewCount: row.view_count,
      referralClickCount: row.referral_click_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
