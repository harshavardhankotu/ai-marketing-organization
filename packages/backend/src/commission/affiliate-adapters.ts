/**
 * Phase 2 Task 6: generic affiliate network adapter interface.
 * Only networks we hold authorization for are implemented.
 * Adding a network = new adapter + registration, never a rewrite.
 */

export interface TrackedDestinationInput {
  baseUrl: string;
  clickId: string;
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

const ADAPTERS: AffiliateNetworkAdapter[] = [
  new AmazonAdapter(),
  new EbayAdapter(),
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
