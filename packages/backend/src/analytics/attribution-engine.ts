import { getDb } from '../db/client.js';
import { AttributionModelType } from '@ai-marketing/shared';

export interface Touchpoint {
  id: string;
  channel: string;
  campaignId?: string;
  createdAt: string;
  revenueINR: number;
}

export interface AttributionResult {
  channel: string;
  campaignId?: string;
  creditFraction: number;
  attributedRevenueINR: number;
  modelType: AttributionModelType;
  confidence: number;
}

export class AttributionEngine {
  public static calculateAttribution(
    conversionEventId: string,
    touchpoints: Touchpoint[],
    modelType: AttributionModelType
  ): AttributionResult[] {
    if (touchpoints.length === 0) return [];

    const totalRevenue = touchpoints.reduce((acc, t) => acc + (t.revenueINR || 0), 0);
    const results: AttributionResult[] = [];

    switch (modelType) {
      case 'FIRST_TOUCH': {
        const first = touchpoints[0];
        results.push({
          channel: first.channel,
          campaignId: first.campaignId,
          creditFraction: 1.0,
          attributedRevenueINR: totalRevenue,
          modelType: 'FIRST_TOUCH',
          confidence: 0.82
        });
        break;
      }

      case 'LAST_TOUCH': {
        const last = touchpoints[touchpoints.length - 1];
        results.push({
          channel: last.channel,
          campaignId: last.campaignId,
          creditFraction: 1.0,
          attributedRevenueINR: totalRevenue,
          modelType: 'LAST_TOUCH',
          confidence: 0.85
        });
        break;
      }

      case 'LINEAR': {
        const fraction = 1.0 / touchpoints.length;
        for (const t of touchpoints) {
          results.push({
            channel: t.channel,
            campaignId: t.campaignId,
            creditFraction: fraction,
            attributedRevenueINR: totalRevenue * fraction,
            modelType: 'LINEAR',
            confidence: 0.80
          });
        }
        break;
      }

      case 'ASSISTED_CONVERSION': {
        // First touch: 40%, Last touch: 40%, Middle assists: 20% split
        if (touchpoints.length === 1) {
          results.push({
            channel: touchpoints[0].channel,
            campaignId: touchpoints[0].campaignId,
            creditFraction: 1.0,
            attributedRevenueINR: totalRevenue,
            modelType: 'ASSISTED_CONVERSION',
            confidence: 0.90
          });
        } else {
          const middleCount = touchpoints.length - 2;
          const middleFraction = middleCount > 0 ? 0.20 / middleCount : 0;

          // First
          results.push({
            channel: touchpoints[0].channel,
            campaignId: touchpoints[0].campaignId,
            creditFraction: 0.40,
            attributedRevenueINR: totalRevenue * 0.40,
            modelType: 'ASSISTED_CONVERSION',
            confidence: 0.88
          });

          // Middle
          for (let i = 1; i < touchpoints.length - 1; i++) {
            results.push({
              channel: touchpoints[i].channel,
              campaignId: touchpoints[i].campaignId,
              creditFraction: middleFraction,
              attributedRevenueINR: totalRevenue * middleFraction,
              modelType: 'ASSISTED_CONVERSION',
              confidence: 0.85
            });
          }

          // Last
          const last = touchpoints[touchpoints.length - 1];
          results.push({
            channel: last.channel,
            campaignId: last.campaignId,
            creditFraction: 0.40,
            attributedRevenueINR: totalRevenue * 0.40,
            modelType: 'ASSISTED_CONVERSION',
            confidence: 0.90
          });
        }
        break;
      }
    }

    // Persist attribution results
    const db = getDb();
    const insertAttr = db.prepare(`
      INSERT INTO attributions (
        id, organization_id, business_id, event_id, campaign_id,
        channel, model_type, credit_fraction, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // Fetch org/biz from event
    const eventRow = db.prepare('SELECT organization_id, business_id FROM analytics_events WHERE id = ?').get(conversionEventId) as any;

    if (eventRow) {
      for (const res of results) {
        insertAttr.run(
          `attr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          eventRow.organization_id,
          eventRow.business_id,
          conversionEventId,
          res.campaignId || null,
          res.channel,
          res.modelType,
          res.creditFraction,
          res.confidence
        );
      }
    }

    return results;
  }
}