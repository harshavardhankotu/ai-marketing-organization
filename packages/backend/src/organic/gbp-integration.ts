import { getDb } from '../db/client.js';
import { GBPLocationInsights, GBPPostRecord } from '@ai-marketing/shared';

export class GoogleBusinessProfileAdapter {
  private get db() {
    return getDb();
  }

  /**
   * Retrieves GBP location insights without fabricating unverified metrics.
   */
  public getLocationInsights(businessId: string): GBPLocationInsights {
    const row = this.db
      .prepare('SELECT * FROM gbp_interactions WHERE business_id = ?')
      .get(businessId) as any;

    if (!row) {
      return {
        businessId,
        searchImpressions: 'UNKNOWN',
        mapImpressions: 'UNKNOWN',
        callClicks: 0,
        websiteClicks: 0,
        directionRequests: 0,
        reviewsCount: 0,
        averageRating: 0.0,
        lastSyncTimestamp: new Date().toISOString(),
      };
    }

    return {
      businessId,
      searchImpressions: row.search_impressions ?? 'UNKNOWN',
      mapImpressions: row.map_impressions ?? 'UNKNOWN',
      callClicks: row.call_clicks || 0,
      websiteClicks: row.website_clicks || 0,
      directionRequests: row.direction_requests || 0,
      reviewsCount: row.reviews_count || 0,
      averageRating: row.average_rating || 0.0,
      lastSyncTimestamp: row.last_sync_timestamp,
    };
  }

  /**
   * Records a local engagement signal from GBP (e.g. call click or website visit).
   */
  public recordEngagementSignal(businessId: string, type: 'CALL' | 'WEBSITE' | 'DIRECTION'): void {
    const columnMap = {
      CALL: 'call_clicks',
      WEBSITE: 'website_clicks',
      DIRECTION: 'direction_requests',
    };
    const col = columnMap[type];

    this.db
      .prepare(
        `UPDATE gbp_interactions 
         SET ${col} = ${col} + 1, last_sync_timestamp = datetime('now')
         WHERE business_id = ?`
      )
      .run(businessId);
  }
}
