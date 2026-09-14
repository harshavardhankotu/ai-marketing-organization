import { getDb } from '../db/client.js';
import {
  OrganicChannelRecord,
  OrganicMarketingChannel,
} from '@ai-marketing/shared';

export class OrganicChannelManager {
  private get db() {
    return getDb();
  }

  /**
   * Returns all 10 zero-budget organic channels configured for a business.
   */
  public listChannels(businessId: string): OrganicChannelRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM organic_channels WHERE business_id = ? ORDER BY id ASC')
      .all(businessId) as any[];

    return rows.map((r) => {
      let themes: string[] = [];
      try {
        themes = JSON.parse(r.content_themes_json);
      } catch {}

      // Retrieve actual organic funnel metrics from journeys
      const journeyStats = this.db
        .prepare(
          `SELECT 
             COUNT(*) as visits,
             SUM(CASE WHEN stage IN ('LEAD', 'QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER') THEN 1 ELSE 0 END) as leads,
             SUM(CASE WHEN stage IN ('QUALIFIED_LEAD', 'OPPORTUNITY', 'CUSTOMER') THEN 1 ELSE 0 END) as qualified,
             SUM(CASE WHEN stage = 'CUSTOMER' THEN 1 ELSE 0 END) as customers
           FROM customer_journeys 
           WHERE business_id = ? AND first_touch_channel = ?`
        )
        .get(businessId, r.channel) as any;

      return {
        id: r.id,
        businessId: r.business_id,
        channel: r.channel as OrganicMarketingChannel,
        strategy: r.strategy,
        contentThemes: themes,
        callToAction: r.call_to_action,
        trackingTemplate: r.tracking_template,
        sourceEvidence: r.source_evidence,
        activeStatus: r.active_status,
        metrics: {
          impressions: 'UNKNOWN', // No fabricated search impressions without API link
          visits: journeyStats?.visits || 0,
          leads: journeyStats?.leads || 0,
          consultations: journeyStats?.qualified || 0,
          customers: journeyStats?.customers || 0,
        },
      };
    });
  }

  /**
   * Generates a deterministic UTM tracking string for an organic asset or link.
   * Format: utm_source={channel}&utm_medium=organic&utm_campaign={campaign}&utm_content={content}
   */
  public generateOrganicUTM(params: {
    channel: OrganicMarketingChannel;
    campaign: string;
    content: string;
    targetKeyword?: string;
  }): {
    utmSource: string;
    utmMedium: string;
    utmCampaign: string;
    utmContent: string;
    fullQueryString: string;
  } {
    const utmSource = params.channel.toLowerCase().replace(/_organic|_inbound/g, '');
    const utmMedium = 'organic';
    const utmCampaign = params.campaign.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const utmContent = params.content.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

    let queryString = `utm_source=${utmSource}&utm_medium=${utmMedium}&utm_campaign=${utmCampaign}&utm_content=${utmContent}`;
    if (params.targetKeyword) {
      const utmTerm = encodeURIComponent(params.targetKeyword.toLowerCase());
      queryString += `&utm_term=${utmTerm}`;
    }

    return {
      utmSource,
      utmMedium,
      utmCampaign,
      utmContent,
      fullQueryString: queryString,
    };
  }

  /**
   * Gets a specific channel by channel enum.
   */
  public getChannel(businessId: string, channel: OrganicMarketingChannel): OrganicChannelRecord | null {
    const row = this.db
      .prepare('SELECT * FROM organic_channels WHERE business_id = ? AND channel = ?')
      .get(businessId, channel) as any;
    if (!row) return null;

    let themes: string[] = [];
    try {
      themes = JSON.parse(row.content_themes_json);
    } catch {}

    return {
      id: row.id,
      businessId: row.business_id,
      channel: row.channel as OrganicMarketingChannel,
      strategy: row.strategy,
      contentThemes: themes,
      callToAction: row.call_to_action,
      trackingTemplate: row.tracking_template,
      sourceEvidence: row.source_evidence,
      activeStatus: row.active_status,
    };
  }
}
