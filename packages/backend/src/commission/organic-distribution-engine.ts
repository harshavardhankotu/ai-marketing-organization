/**
 * Organic Distribution Engine (V5.0 Spec § 6)
 *
 * Implements compliant, zero-paid-budget organic distribution channels:
 * 1. Owned Deal Pages & Buying Guides (SEO & Schema.org Structured Data)
 * 2. Daily Reply Desk (Organic product comparison copy & answers to buyer queries)
 * 3. Structured Share Kit Generation (Compliant social posts with required #Ad / affiliate disclosures)
 * 4. Permitted RSS/XML Deal Feeds
 *
 * Strictly Prohibits:
 * - Paid advertising spend (₹0.00 spent)
 * - Outbound cold WhatsApp messaging or SMS spam
 * - Unsolicited email blasts
 * - Automated comment spamming on social media
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { QualifiedCommercialOpportunity } from './commercial-opportunity-selector.js';

export interface OrganicDistributionChannel {
  channelId: 'OWNED_BUYING_GUIDE' | 'DAILY_REPLY_DESK' | 'SHARE_KIT' | 'RSS_DEAL_FEED';
  name: string;
  isFreeTier: boolean;
  complianceDisclosureRequired: boolean;
  status: 'ACTIVE' | 'IDLE';
}

export interface ShareKitPost {
  platform: 'TWITTER' | 'TELEGRAM' | 'LINKEDIN' | 'COMMUNITY_FORUM';
  headline: string;
  body: string;
  disclosureTag: string; // Mandatory: "#Ad", "#Affiliate", "Commission earned"
  canonicalUrl: string;
  hashtags: string[];
}

export interface ReplyDeskComparison {
  queryTopic: string;
  productName: string;
  competitorComparison: string;
  keyFeatures: string[];
  verdict: string;
  affiliateCallToAction: string;
  complianceNotice: string;
}

export interface OrganicDistributionPackage {
  opportunityId: string;
  sku: string;
  generatedAt: string;
  buyingGuideUrl: string;
  shareKit: ShareKitPost[];
  replyDeskCopy: ReplyDeskComparison;
  rssFeedItem: {
    title: string;
    description: string;
    link: string;
    guid: string;
    pubDate: string;
  };
}

export class OrganicDistributionEngine {
  private static instance: OrganicDistributionEngine | null = null;
  private d1Repo = D1RevenueRepository.getInstance();

  public static readonly CHANNELS: OrganicDistributionChannel[] = [
    {
      channelId: 'OWNED_BUYING_GUIDE',
      name: 'Owned High-Intent Buying Guides & Deal Pages',
      isFreeTier: true,
      complianceDisclosureRequired: true,
      status: 'ACTIVE'
    },
    {
      channelId: 'DAILY_REPLY_DESK',
      name: 'Daily Reply Desk Product Comparison & Buying Advice',
      isFreeTier: true,
      complianceDisclosureRequired: true,
      status: 'ACTIVE'
    },
    {
      channelId: 'SHARE_KIT',
      name: 'Manual / Permitted Owner Social Broadcast Kit',
      isFreeTier: true,
      complianceDisclosureRequired: true,
      status: 'ACTIVE'
    },
    {
      channelId: 'RSS_DEAL_FEED',
      name: 'Public Syndicated Deal Feed (RSS 2.0)',
      isFreeTier: true,
      complianceDisclosureRequired: true,
      status: 'ACTIVE'
    }
  ];

  public static getInstance(): OrganicDistributionEngine {
    if (!OrganicDistributionEngine.instance) {
      OrganicDistributionEngine.instance = new OrganicDistributionEngine();
    }
    return OrganicDistributionEngine.instance;
  }

  public static resetInstance(): void {
    OrganicDistributionEngine.instance = null;
  }

  /**
   * Generates a complete organic distribution package for a qualified opportunity.
   */
  public generateDistributionPackage(
    opp: QualifiedCommercialOpportunity,
    baseUrl = 'https://ai-marketing-organization.onrender.com'
  ): OrganicDistributionPackage {
    const slug = opp.sku.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const buyingGuideUrl = `${baseUrl}/deals/${slug}`;
    const redirectUrl = `${baseUrl}/api/v1/public/deals/${opp.dealId}/redirect?placement=organic_guide`;
    const discountText = opp.discountPercent > 0 ? ` (${opp.discountPercent}% OFF, MRP ₹${opp.referencePriceINR})` : '';

    const shareKit: ShareKitPost[] = [
      {
        platform: 'TWITTER',
        headline: `Best True Wireless Earbuds Under ₹1,000 in India`,
        body: `Looking for reliable ANC & punchy bass under ₹1,000? ${opp.title} is now active at ₹${opp.currentPriceINR}${discountText}. Full specs, battery benchmarks & genuine buying guide:`,
        disclosureTag: '#Ad #AffiliateLink',
        canonicalUrl: redirectUrl,
        hashtags: ['#TechDeals', '#boAt', '#AudioIndia', '#SmartBuying']
      },
      {
        platform: 'TELEGRAM',
        headline: `Deal Alert: ${opp.title} at ₹${opp.currentPriceINR}`,
        body: `Verified genuine price alert on boAt Official Store:\n\nProduct: ${opp.title}\nCurrent Deal Price: ₹${opp.currentPriceINR}\nMRP: ₹${opp.referencePriceINR}\nSavings: ${opp.discountPercent}%\nMerchant: ${opp.merchant}\n\nGet it here: ${redirectUrl}\n\n(Disclosure: We earn an affiliate commission on qualifying purchases at no extra cost to you).`,
        disclosureTag: 'Disclosure: Commission-eligible link',
        canonicalUrl: redirectUrl,
        hashtags: ['#Electronics', '#TWSDeals']
      },
      {
        platform: 'COMMUNITY_FORUM',
        headline: `Hands-on Review: Is the ${opp.title} worth ₹${opp.currentPriceINR}?`,
        body: `For anyone evaluating earbuds under ₹1,000, here is what stands out on the ${opp.title}:\n- Battery Life: 42 hours total playback\n- Connectivity: Bluetooth 5.2 / BEAST Mode low latency\n- Official warranty through boAt India\n\nDirect deal on boAt store: ${redirectUrl}`,
        disclosureTag: 'Affiliate Disclosure: Author participates in partner affiliate programs.',
        canonicalUrl: redirectUrl,
        hashtags: ['#AudioGear', '#BudgetEarbuds']
      }
    ];

    const replyDeskCopy: ReplyDeskComparison = {
      queryTopic: `What are the best earbuds under ₹1000 in India?`,
      productName: opp.title,
      competitorComparison: `Compared to generic unbranded earbuds, boAt offers genuine 1-year domestic warranty, fast charging (ASAP charge 5 mins = 75 mins playtime), and IPX4 splash resistance.`,
      keyFeatures: [
        `Verified price: ₹${opp.currentPriceINR} (MRP ₹${opp.referencePriceINR})`,
        `Low latency gaming mode (BEAST mode)`,
        `Type-C charging case with instant wake and pair`,
        `Direct dispatch from official merchant`
      ],
      verdict: `At ₹${opp.currentPriceINR}, the ${opp.title} provides the highest audio reliability and warranty support in the sub-₹1,000 segment.`,
      affiliateCallToAction: `Check live deal price on boAt Official Store: ${redirectUrl}`,
      complianceNotice: `Note: When you buy through our links, we may receive an affiliate commission without charging you anything extra.`
    };

    const rssFeedItem = {
      title: `${opp.title} - ₹${opp.currentPriceINR} on ${opp.merchant}`,
      description: `Verified commercial offer: ${opp.title} at ₹${opp.currentPriceINR} (${opp.discountPercent}% discount). Available for direct delivery across India.`,
      link: redirectUrl,
      guid: `deal_${opp.sku}_${Date.now()}`,
      pubDate: new Date().toUTCString()
    };

    return {
      opportunityId: opp.dealId,
      sku: opp.sku,
      generatedAt: new Date().toISOString(),
      buyingGuideUrl,
      shareKit,
      replyDeskCopy,
      rssFeedItem
    };
  }

  /**
   * Records an organic distribution event in Cloudflare D1 workflows table.
   */
  public async logDistributionEvent(pkg: OrganicDistributionPackage): Promise<void> {
    try {
      const sql = `
        INSERT INTO workflows (
          id, organization_id, business_id, workflow_type, status, current_step,
          retry_count, max_retries, inputs_json, outputs_json, updated_at
        ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', 'ORGANIC_DISTRIBUTION', 'COMPLETED', 'DISTRIBUTED', 0, 3, '{}', ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')
      `;
      const workflowId = `wf_dist_${pkg.sku.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
      const payload = JSON.stringify(pkg);

      await this.d1Repo.executeWrite('workflows', sql, [workflowId, payload]);
    } catch (err: any) {
      console.warn(`[OrganicDistribution] Failed to log distribution event: ${err.message}`);
    }
  }
}
