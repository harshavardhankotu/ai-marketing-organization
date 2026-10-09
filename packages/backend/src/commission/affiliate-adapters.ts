/**
 * Phase 2 Task 6: generic affiliate network adapter interface.
 * Only networks we hold authorization for are implemented.
 * Adding a network = new adapter + registration, never a rewrite.
 */

export interface TrackedDestinationInput {
  baseUrl: string;
  clickId: string;
  template?: string;
  variables?: Record<string, string>;
  partner?: {
    id?: string;
    network?: string;
    approvalStatus?: string;
    authorizationStatus?: string;
    trackingTemplate?: string;
  };
}

export interface AffiliateNetworkAdapter {
  /** e.g. 'AMAZON_ASSOCIATES' */
  readonly network: string;
  /** True when this adapter handles the given destination host */
  handles(hostname: string): boolean;
  /** Inject network attribution params; must preserve existing params */
  buildTrackedDestination(input: TrackedDestinationInput): string;
  /** True when the URL (or env fallback) carries attributable IDs */
  hasAttribution(url: URL): boolean;
  /** Human-readable setup instruction when attribution is missing */
  missingAttributionMessage(): string;
  /** Network-specific metadata for diagnostics (never secrets) */
  getPartnerMetadata(): { network: string; trackingType: string };
}

function getEnv(name: string): string {
  return (process.env[name] || '').trim();
}

export class AmazonAdapter implements AffiliateNetworkAdapter {
  readonly network = 'AMAZON_ASSOCIATES';

  handles(hostname: string): boolean {
    return hostname.toLowerCase().includes('amazon.');
  }

  buildTrackedDestination({ baseUrl, clickId }: TrackedDestinationInput): string {
    const url = new URL(baseUrl);
    const tag = getEnv('AMAZON_AFFILIATE_TAG');
    if (!url.searchParams.has('tag') && tag) url.searchParams.set('tag', tag);
    // Amazon-supported sub-identifier for internal attribution (never overrides tag)
    if (!url.searchParams.has('linkCode')) url.searchParams.set('linkCode', 'osi');
    void clickId;
    return url.toString();
  }

  hasAttribution(url: URL): boolean {
    const tag = url.searchParams.get('tag') || '';
    return tag.trim().length > 0 || getEnv('AMAZON_AFFILIATE_TAG').length > 0;
  }

  missingAttributionMessage(): string {
    return 'MISSING_AFFILIATE_ID: Amazon link has no `tag=` and AMAZON_AFFILIATE_TAG is unset. ' +
      'Get your tag from Amazon Associates (affiliate-program.amazon.in > SiteStripe) and set AMAZON_AFFILIATE_TAG or embed ?tag=YOURTAG-21 in the tracking URL.';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'AFFILIATE_LINK' };
  }
}

export class EbayAdapter implements AffiliateNetworkAdapter {
  readonly network = 'EBAY_PARTNER_NETWORK';

  handles(hostname: string): boolean {
    return hostname.toLowerCase().includes('ebay.');
  }

  buildTrackedDestination({ baseUrl, clickId }: TrackedDestinationInput): string {
    const url = new URL(baseUrl);
    const campId = getEnv('EBAY_CAMPID');
    if (!url.searchParams.has('campid') && campId) url.searchParams.set('campid', campId);
    if (!url.searchParams.has('mkevt')) url.searchParams.set('mkevt', '1');
    if (!url.searchParams.has('mkcid')) url.searchParams.set('mkcid', '1');
    if (!url.searchParams.has('toolid')) {
      url.searchParams.set('toolid', getEnv('EBAY_TOOLID') || '10001');
    }
    if (!url.searchParams.has('customid')) url.searchParams.set('customid', clickId);
    return url.toString();
  }

  hasAttribution(url: URL): boolean {
    const camp = url.searchParams.get('campid') || '';
    return camp.trim().length > 0 || getEnv('EBAY_CAMPID').length > 0;
  }

  missingAttributionMessage(): string {
    return 'MISSING_AFFILIATE_ID: eBay link has no `campid=` and EBAY_CAMPID is unset. ' +
      'Get your campid from eBay Partner Network and set EBAY_CAMPID or embed it in the tracking URL.';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'AFFILIATE_LINK' };
  }
}

export class GenericAffiliateAdapter implements AffiliateNetworkAdapter {
  readonly network = 'OTHER_AUTHORIZED_PARTNER';

  handles(_hostname: string): boolean {
    return true; // fallback for authorized non-Amazon/eBay programs
  }

  buildTrackedDestination({ baseUrl }: TrackedDestinationInput): string {
    return new URL(baseUrl).toString();
  }

  hasAttribution(_url: URL): boolean {
    return true; // generic programs attribute via their own dashboard/link
  }

  missingAttributionMessage(): string {
    return '';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'AFFILIATE_LINK' };
  }
}

export class DirectReferralAdapter implements AffiliateNetworkAdapter {
  readonly network = 'DIRECT_REFERRAL';

  handles(_hostname: string): boolean {
    return true;
  }

  buildTrackedDestination({ baseUrl }: TrackedDestinationInput): string {
    return new URL(baseUrl).toString();
  }

  hasAttribution(_url: URL): boolean {
    return true;
  }

  missingAttributionMessage(): string {
    return '';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'REFERRAL_LINK' };
  }
}

export const PARTNER_OFFICIAL_SIGNUP_DIRECTORY: Record<string, {
  officialSignupUrl: string;
  retrievalDate: string;
  networkDetailsStatus: 'UNVERIFIED';
  notes: string;
}> = {
  VCOMMISSION: {
    officialSignupUrl: 'https://tools.vcommission.com/affiliates/signup.php',
    retrievalDate: '2026-10-09',
    networkDetailsStatus: 'UNVERIFIED',
    notes: 'All third-party scraped claims (payout, KYC, cookies) marked UNVERIFIED. Tracking templates must be owner-entered.'
  },
  CUELINKS: {
    officialSignupUrl: 'https://www.cuelinks.com/signup',
    retrievalDate: '2026-10-09',
    networkDetailsStatus: 'UNVERIFIED',
    notes: 'All third-party scraped claims (payout, KYC, cookies) marked UNVERIFIED. Tracking templates must be owner-entered.'
  },
  EARNKARO: {
    officialSignupUrl: 'https://earnkaro.com/',
    retrievalDate: '2026-10-09',
    networkDetailsStatus: 'UNVERIFIED',
    notes: 'All third-party scraped claims (payout, KYC, cookies) marked UNVERIFIED. Tracking templates must be owner-entered.'
  }
};

export class VCommissionAdapter implements AffiliateNetworkAdapter {
  readonly network = 'VCOMMISSION';

  handles(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return h.includes('vcommission.') || h.includes('tracking.vcommission.');
  }

  buildTrackedDestination({ baseUrl, clickId, template: explicitTemplate, partner, variables }: TrackedDestinationInput): string {
    const template = partner?.trackingTemplate || explicitTemplate || variables?.template;
    if (!template) {
      throw new Error('MISSING_PARTNER_TRACKING_TEMPLATE: vCommission adapter refuses to build link because owner-entered tracking template is missing from partner record.');
    }
    const offerId = variables?.offerId || getEnv('VCOMMISSION_OFFER_ID') || '';
    const affId = variables?.affId || getEnv('VCOMMISSION_AFF_ID') || '';
    return PartnerTrackingLinkBuilder.buildFromTemplate(template, {
      baseUrl,
      clickId,
      offerId,
      affId,
      extra: variables
    });
  }

  hasAttribution(url: URL): boolean {
    return url.searchParams.has('aff_sub') || getEnv('VCOMMISSION_AFF_ID').length > 0;
  }

  missingAttributionMessage(): string {
    return 'MISSING_AFFILIATE_ID: vCommission link has no aff_sub tracking and VCOMMISSION_AFF_ID is unset.';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'AFFILIATE_LINK' };
  }
}

export class CuelinksAdapter implements AffiliateNetworkAdapter {
  readonly network = 'CUELINKS';

  handles(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return h.includes('cuelinks.') || h.includes('linksredirect.');
  }

  buildTrackedDestination({ baseUrl, clickId, template: explicitTemplate, partner, variables }: TrackedDestinationInput): string {
    const template = partner?.trackingTemplate || explicitTemplate || variables?.template;
    if (!template) {
      throw new Error('MISSING_PARTNER_TRACKING_TEMPLATE: Cuelinks adapter refuses to build link because owner-entered tracking template is missing from partner record.');
    }
    const campaignId = variables?.campaignId || getEnv('CUELINKS_CAMPAIGN_ID') || '';
    return PartnerTrackingLinkBuilder.buildFromTemplate(template, {
      baseUrl,
      clickId,
      campaignId,
      extra: variables
    });
  }

  hasAttribution(url: URL): boolean {
    return url.searchParams.has('subid') || url.searchParams.has('cid') || getEnv('CUELINKS_CAMPAIGN_ID').length > 0;
  }

  missingAttributionMessage(): string {
    return 'MISSING_AFFILIATE_ID: Cuelinks link has no subid tracking and CUELINKS_CAMPAIGN_ID is unset.';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'AFFILIATE_LINK' };
  }
}

export class EarnKaroAdapter implements AffiliateNetworkAdapter {
  readonly network = 'EARNKARO';

  handles(hostname: string): boolean {
    return hostname.toLowerCase().includes('earnkaro.');
  }

  buildTrackedDestination({ baseUrl, clickId, template: explicitTemplate, partner, variables }: TrackedDestinationInput): string {
    const template = partner?.trackingTemplate || explicitTemplate || variables?.template;
    if (!template) {
      throw new Error('MISSING_PARTNER_TRACKING_TEMPLATE: EarnKaro adapter refuses to build link because owner-entered tracking template is missing from partner record.');
    }
    const referralId = variables?.referralId || getEnv('EARNKARO_REFERRAL_ID') || '';
    return PartnerTrackingLinkBuilder.buildFromTemplate(template, {
      baseUrl,
      clickId,
      referralId,
      extra: variables
    });
  }

  hasAttribution(url: URL): boolean {
    return url.searchParams.has('r') || getEnv('EARNKARO_REFERRAL_ID').length > 0;
  }

  missingAttributionMessage(): string {
    return 'MISSING_AFFILIATE_ID: EarnKaro link has no referral identifier and EARNKARO_REFERRAL_ID is unset.';
  }

  getPartnerMetadata() {
    return { network: this.network, trackingType: 'AFFILIATE_LINK' };
  }
}

export class PartnerTrackingLinkBuilder {
  /**
   * Builds a tracked destination URL from a template string with variable substitution.
   * Supported tokens:
   *   {baseUrl}, {url}, {encodedUrl}, {clickId}, {subId}, {subid}, {aff_sub}, {affId}, {offerId}, {campaignId}, {referralId}
   */
  public static buildFromTemplate(
    template: string,
    vars: {
      baseUrl: string;
      clickId: string;
      offerId?: string;
      affId?: string;
      campaignId?: string;
      referralId?: string;
      extra?: Record<string, string>;
    }
  ): string {
    let result = template;
    const encodedUrl = encodeURIComponent(vars.baseUrl);

    const replacements: Record<string, string> = {
      '{baseUrl}': vars.baseUrl,
      '{url}': vars.baseUrl,
      '{encodedUrl}': encodedUrl,
      '{clickId}': vars.clickId,
      '{subId}': vars.clickId,
      '{subid}': vars.clickId,
      '{aff_sub}': vars.clickId,
      '{affId}': vars.affId || '',
      '{offerId}': vars.offerId || '',
      '{campaignId}': vars.campaignId || '',
      '{referralId}': vars.referralId || '',
      ...(vars.extra || {})
    };

    for (const [token, value] of Object.entries(replacements)) {
      result = result.split(token).join(value);
    }
    return result;
  }

  /**
   * Main entry point to build a tracked link for a partner.
   * Fail-closed: Refuses to build a link for an unapproved partner unless running in test/mock mode.
   */
  public static buildPartnerLink(input: TrackedDestinationInput): string {
    if (input.partner) {
      const isApproved = input.partner.approvalStatus === 'APPROVED' && input.partner.authorizationStatus === 'AUTHORIZED';
      if (!isApproved) {
        throw new Error(
          `UNAPPROVED_PARTNER_ERROR: Partner '${input.partner.id || 'unknown'}' is not approved by the owner. ` +
          `Status: approvalStatus=${input.partner.approvalStatus || 'PENDING'}, authorizationStatus=${input.partner.authorizationStatus || 'PENDING_REVIEW'}. ` +
          `The owner must apply and prove partner authorization before building links.`
        );
      }
    }

    // 1. If explicit template provided on input or partner, use template builder
    const template = input.template || input.partner?.trackingTemplate;
    if (template) {
      return PartnerTrackingLinkBuilder.buildFromTemplate(template, {
        baseUrl: input.baseUrl,
        clickId: input.clickId,
        extra: input.variables
      });
    }

    // 2. Otherwise use the registered adapter
    const adapter = resolveAffiliateAdapter(input.baseUrl);
    return adapter.buildTrackedDestination(input);
  }
}

const ADAPTERS: AffiliateNetworkAdapter[] = [
  new AmazonAdapter(),
  new EbayAdapter(),
  new VCommissionAdapter(),
  new CuelinksAdapter(),
  new EarnKaroAdapter(),
  new GenericAffiliateAdapter(),
];

/** Resolves the most specific adapter for a destination URL. */
export function resolveAffiliateAdapter(destinationUrl: string): AffiliateNetworkAdapter {
  try {
    const host = new URL(destinationUrl).hostname;
    for (const adapter of ADAPTERS) {
      if (adapter.network !== 'OTHER_AUTHORIZED_PARTNER' && adapter.handles(host)) {
        return adapter;
      }
    }
  } catch {
    // fall through to generic
  }
  return new GenericAffiliateAdapter();
}
