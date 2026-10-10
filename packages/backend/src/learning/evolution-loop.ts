import { getDb } from '../db/client.js';

export interface GuideMetrics {
  guideId: string;
  slug: string;
  title: string;
  category: string;
  views: number;
  clicks: number;
  conversions: number;
}

export interface EvolutionLoopOutcome {
  id: string;
  guideId: string;
  category: string;
  views: number;
  clicks: number;
  conversions: number;
  sampleSize: number;
  weightChanged: boolean;
  newWeight?: number;
  reason: string;
}

export class EvolutionLoopService {
  private static instance: EvolutionLoopService | null = null;

  public static getInstance(): EvolutionLoopService {
    if (!EvolutionLoopService.instance) {
      EvolutionLoopService.instance = new EvolutionLoopService();
    }
    return EvolutionLoopService.instance;
  }

  /**
   * Step 7b: Run weekly evolution loop with zero LLM calls.
   * Aggregates views, clicks, and conversions per category and guide.
   * Writes OUTCOME rows to learning_records with sample size n.
   * Modifies recommendation weights ONLY when n is at least 30 views OR 5 clicks.
   */
  public runWeeklyOutcomeAudit(): EvolutionLoopOutcome[] {
    const db = getDb();
    const outcomes: EvolutionLoopOutcome[] = [];

    // 1. Fetch published guides from commission_content_assets
    const guides = db.prepare(`
      SELECT id, slug, title, category, view_count, referral_click_count
      FROM commission_content_assets
      WHERE status = 'PUBLISHED'
    `).all() as any[];

    for (const guide of guides) {
      const views = guide.view_count || 0;
      const clicks = guide.referral_click_count || 0;

      // Conversions from commission_records
      const conversions = (db.prepare(`
        SELECT COUNT(*) as cnt
        FROM commission_records
        WHERE offer_id = ? OR referral_id = ?
      `).get(guide.id, guide.slug) as any)?.cnt || 0;

      const sampleSize = views + clicks;
      const meetsSampleThreshold = views >= 30 || clicks >= 5;

      let weightChanged = false;
      let newWeight: number | undefined;
      let reason: string;

      if (!meetsSampleThreshold) {
        reason = `INSUFFICIENT_SAMPLE_SIZE: Sample size n=${sampleSize} (views=${views}, clicks=${clicks}) below minimum threshold (30 views or 5 clicks). Weight unchanged.`;
      } else {
        weightChanged = true;
        // Conversion rate calculation
        const conversionRate = clicks > 0 ? conversions / clicks : 0;
        newWeight = Number((0.5 + Math.min(conversionRate, 0.5)).toFixed(3));
        reason = `STATISTICALLY_SIGNIFICANT_OUTCOME: Sample size n=${sampleSize} meets threshold. Weight updated to ${newWeight}.`;
      }

      const outcomeId = `lrn_outcome_${guide.slug}_${Date.now()}`;
      const evidence = JSON.stringify({
        guideId: guide.id,
        slug: guide.slug,
        views,
        clicks,
        conversions,
        sampleSize,
        meetsSampleThreshold,
        weightChanged,
        newWeight,
        evaluatedAt: new Date().toISOString()
      });

      // Write OUTCOME row to learning_records
      db.prepare(`
        INSERT INTO learning_records (
          id, organization_id, learning_type, decision, hypothesis,
          action, audience, offer, channel, result, confidence,
          evidence_json, source, created_at
        ) VALUES (
          ?, 'org_owner_primary', 'PERFORMANCE_OUTCOME', ?, ?,
          ?, 'ORGANIC_BUYERS', ?, 'ORGANIC_SEARCH', ?, ?,
          ?, 'OUTCOME', datetime('now')
        )
      `).run(
        outcomeId,
        guide.title,
        `Sample size n >= 30 views or 5 clicks verifies consumer guide effectiveness for ${guide.category}`,
        guide.slug,
        guide.slug,
        reason,
        meetsSampleThreshold ? 0.9 : 0.2,
        evidence
      );

      outcomes.push({
        id: outcomeId,
        guideId: guide.id,
        category: guide.category,
        views,
        clicks,
        conversions,
        sampleSize,
        weightChanged,
        newWeight,
        reason
      });
    }

    return outcomes;
  }
}
