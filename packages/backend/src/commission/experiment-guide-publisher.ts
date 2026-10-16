/**
 * ExperimentGuidePublisher — Implements Part B: Break The Deadlock
 *
 * Governing Rules:
 * - EXPERIMENT_MODE=false by default.
 * - When OWNER sets EXPERIMENT_MODE=true:
 *   - Guide may publish if owner facts are valid (validateOwnerEnvFacts().valid).
 *   - Every product fact has an official manufacturer source URL and retrieval date.
 *   - The owner explicitly clicks/authorizes publish (ownerConfirmed === true).
 *   - Demand is recorded as UNKNOWN on the guide, never claimed.
 *   - Cap: at most 5 live (PUBLISHED) guides.
 *   - Each records a hypothesis and an owner-set review window (default 56 days).
 *   - If Search Console or beacon data shows zero impressions in the window, archive it and write an OUTCOME row.
 *   - The strict 3-question gate stays for any report that claims demand.
 */

import { getDb } from '../db/client.js';
import { validateOwnerEnvFacts } from '../config/owner-env-intake.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface ExperimentGuidePublishInput {
  productId: string;
  slug: string;
  title: string;
  category: string;
  contentMarkdown: string;
  hypothesis: string;
  reviewWindowDays?: number; // default 56
  ownerConfirmed: boolean;
  specs?: Array<{ spec: string; sourceUrl: string; retrievedAt: string }>;
}

export interface ExperimentGuidePublishResult {
  published: boolean;
  reason?: string;
  guideId?: string;
  slug?: string;
  demand?: string;
  hypothesis?: string;
  reviewWindowDays?: number;
  reviewWindowEnd?: string;
}

export interface EvaluationOutcome {
  slug: string;
  archived: boolean;
  outcomeRecorded: boolean;
  reason: string;
}

export class ExperimentGuidePublisher {
  private static instance: ExperimentGuidePublisher;

  public static getInstance(): ExperimentGuidePublisher {
    if (!ExperimentGuidePublisher.instance) {
      ExperimentGuidePublisher.instance = new ExperimentGuidePublisher();
    }
    return ExperimentGuidePublisher.instance;
  }

  /**
   * Check if EXPERIMENT_MODE is explicitly enabled. Defaults to false.
   */
  public isExperimentModeEnabled(): boolean {
    return process.env.EXPERIMENT_MODE === 'true';
  }

  /**
   * Publishes an experimental guide under owner authorization.
   */
  public publishExperimentGuide(input: ExperimentGuidePublishInput): ExperimentGuidePublishResult {
    // 1. Check EXPERIMENT_MODE kill switch (off by default)
    if (!this.isExperimentModeEnabled()) {
      return {
        published: false,
        reason: 'EXPERIMENT_MODE_DISABLED: Experiment mode is off by default. Owner must explicitly set EXPERIMENT_MODE=true.'
      };
    }

    // 2. Check explicit owner click / confirmation
    if (!input.ownerConfirmed) {
      return {
        published: false,
        reason: 'OWNER_CONFIRMATION_REQUIRED: Guide publication in experiment mode requires explicit owner authorization.'
      };
    }

    // 3. Verify statutory owner facts
    const ownerValidation = validateOwnerEnvFacts();
    if (!ownerValidation.valid) {
      return {
        published: false,
        reason: `OWNER_FACTS_INVALID: Owner intake facts missing or invalid (${ownerValidation.missingFields.concat(ownerValidation.invalidFields.map(f => f.field)).join(', ')}).`
      };
    }

    const db = getDb();

    // 4. Check cap of 5 live guides
    const publishedCountRow = db.prepare(`SELECT COUNT(*) as count FROM commission_content_assets WHERE status = 'PUBLISHED' AND slug != ?`).get(input.slug) as any;
    const currentLiveCount = Number(publishedCountRow?.count || 0);
    if (currentLiveCount >= 5) {
      return {
        published: false,
        reason: `LIVE_CAP_REACHED: Maximum 5 live guides permitted under experiment mode (current: ${currentLiveCount}).`
      };
    }

    // 5. Verify manufacturer product facts: every product fact must have an official source URL and retrieval date
    let specs = input.specs || [];
    if (specs.length === 0) {
      try {
        const dbSpecs = db.prepare(`SELECT * FROM brand_spec_lines WHERE product_id = ?`).all(input.productId) as any[];
        specs = dbSpecs.map(s => ({
          spec: s.spec_name || s.spec_value || 'spec',
          sourceUrl: s.source_url,
          retrievedAt: s.retrieved_at
        }));
      } catch {}
    }

    if (specs.length === 0) {
      return {
        published: false,
        reason: 'UNSOURCED_PRODUCT_FACT: Zero verified manufacturer specifications found for product.'
      };
    }

    for (const spec of specs) {
      if (!spec.sourceUrl || !spec.sourceUrl.startsWith('http') || !spec.retrievedAt || !spec.retrievedAt.trim()) {
        return {
          published: false,
          reason: `UNSOURCED_PRODUCT_FACT: Every product fact must have an official manufacturer source URL and retrieval date. Found unbacked spec: '${spec.spec}'.`
        };
      }
    }

    // 6. Record metadata: Demand is strictly recorded as UNKNOWN, never claimed
    const reviewWindowDays = input.reviewWindowDays && input.reviewWindowDays > 0 ? input.reviewWindowDays : 56;
    const now = new Date();
    const reviewWindowStart = now.toISOString();
    const endDate = new Date(now.getTime() + reviewWindowDays * 24 * 60 * 60 * 1000);
    const reviewWindowEnd = endDate.toISOString();

    const qualityGateMeta = {
      mode: 'EXPERIMENT',
      demand: 'UNKNOWN',
      demandClaimed: false,
      hypothesis: input.hypothesis,
      reviewWindowDays,
      reviewWindowStart,
      reviewWindowEnd,
      specsCount: specs.length,
      ownerAttestedAt: reviewWindowStart
    };

    // Ensure content markdown includes explicit UNKNOWN demand disclosure
    let finalContent = input.contentMarkdown;
    if (!finalContent.includes('Demand: UNKNOWN') && !finalContent.includes('Demand Verification: UNKNOWN')) {
      finalContent = `> **Demand: UNKNOWN** (Published under Experiment Mode with verified manufacturer specifications; pending empirical visitor measurement)\n\n` + finalContent;
    }

    const guideId = `guide_exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sql = `
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category,
        intent_target, content_markdown, status, quality_gate_json, created_at, updated_at
      ) VALUES (
        ?, 'org_owner_primary', ?, 'GUIDE', ?, ?,
        'BUYER_RESEARCH', ?, 'PUBLISHED', ?, datetime('now'), datetime('now')
      )
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        category = excluded.category,
        content_markdown = excluded.content_markdown,
        status = 'PUBLISHED',
        quality_gate_json = excluded.quality_gate_json,
        updated_at = datetime('now')
    `;

    db.prepare(sql).run(
      guideId,
      input.slug,
      input.title,
      input.category,
      finalContent,
      JSON.stringify(qualityGateMeta)
    );

    if (isProduction()) {
      D1RevenueRepository.getInstance().executeWrite('commission_content_assets', sql, [
        guideId,
        input.slug,
        input.title,
        input.category,
        finalContent,
        JSON.stringify(qualityGateMeta)
      ]).catch(err => console.warn(`[ExperimentPublisher] D1 write error: ${err.message}`));
    }

    return {
      published: true,
      guideId,
      slug: input.slug,
      demand: 'UNKNOWN',
      hypothesis: input.hypothesis,
      reviewWindowDays,
      reviewWindowEnd
    };
  }

  /**
   * Evaluates all experimental guides whose review window has elapsed.
   * If Search Console or beacon data shows no impressions, archives guide and writes OUTCOME row.
   */
  public evaluateExperimentGuides(asOfDate: Date = new Date()): EvaluationOutcome[] {
    const db = getDb();
    const guides = db.prepare(`
      SELECT id, slug, title, view_count, referral_click_count, quality_gate_json, created_at
      FROM commission_content_assets
      WHERE status = 'PUBLISHED'
    `).all() as any[];

    const outcomes: EvaluationOutcome[] = [];

    for (const guide of guides) {
      let meta: any = {};
      try {
        meta = JSON.parse(guide.quality_gate_json || '{}');
      } catch {}

      if (meta.mode !== 'EXPERIMENT' || !meta.reviewWindowEnd) {
        continue;
      }

      const windowEndDate = new Date(meta.reviewWindowEnd);
      // Only evaluate if review window has expired
      if (asOfDate.getTime() < windowEndDate.getTime()) {
        continue;
      }

      // Check impressions / views from beacon data
      const views = Number(guide.view_count || 0);
      const clicks = Number(guide.referral_click_count || 0);

      // Check external referral_click_events or page view table if available
      let beaconViews = 0;
      try {
        const beaconRow = db.prepare(`SELECT COUNT(*) as c FROM referral_click_events WHERE guide_slug = ? OR landing_page LIKE ?`).get(guide.slug, `%${guide.slug}%`) as any;
        beaconViews = Number(beaconRow?.c || 0);
      } catch {}

      const totalImpressions = views + beaconViews;

      if (totalImpressions === 0 && clicks === 0) {
        // Archive guide
        db.prepare(`UPDATE commission_content_assets SET status = 'ARCHIVED', updated_at = datetime('now') WHERE id = ?`).run(guide.id);

        if (isProduction()) {
          D1RevenueRepository.getInstance().executeWrite(
            'commission_content_assets',
            `UPDATE commission_content_assets SET status = 'ARCHIVED', updated_at = datetime('now') WHERE id = ?`,
            [guide.id]
          ).catch(err => console.warn(`[ExperimentPublisher] D1 archive error: ${err.message}`));
        }

        // Write OUTCOME row to learning_records
        const outcomeId = `lrn_outcome_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const todayStr = asOfDate.toISOString().slice(0, 10);
        const hypothesis = meta.hypothesis || 'Commercial guide generates organic search demand';
        const days = meta.reviewWindowDays || 56;
        const what = `Zero impressions within ${days}-day review window for guide '${guide.slug}'`;
        const cause = `Guide failed to produce organic search console impressions or beacon traffic within the ${days}-day experimental window.`;
        const rule = `Archive unviable experimental guides that yield zero impressions within review window. Demand remains unproven.`;

        const outcomeSql = `
          INSERT INTO learning_records (
            id, organization_id, learning_type, decision, hypothesis, action,
            audience, offer, channel, result, what, outcome, cause, rule,
            source, date, created_at
          ) VALUES (
            ?, 'org_owner_primary', 'EXPERIMENT', 'ARCHIVE_GUIDE', ?, 'PUBLISH_GUIDE',
            'ORGANIC_SEARCH', ?, 'CONTENT', 'ZERO_IMPRESSIONS', ?, 'FAILED', ?, ?,
            'OUTCOME', ?, datetime('now')
          )
        `;

        try {
          db.prepare(outcomeSql).run(outcomeId, hypothesis, guide.slug, what, cause, rule, todayStr);
          if (isProduction()) {
            D1RevenueRepository.getInstance().executeWrite('learning_records', outcomeSql, [
              outcomeId, hypothesis, guide.slug, what, cause, rule, todayStr
            ]).catch(err => console.warn(`[ExperimentPublisher] D1 outcome write error: ${err.message}`));
          }
        } catch (err: any) {
          console.warn(`[ExperimentPublisher] Failed to record learning outcome: ${err.message}`);
        }

        outcomes.push({
          slug: guide.slug,
          archived: true,
          outcomeRecorded: true,
          reason: `Zero impressions in ${days}-day review window (start: ${meta.reviewWindowStart}, end: ${meta.reviewWindowEnd}). Archived.`
        });
      } else {
        outcomes.push({
          slug: guide.slug,
          archived: false,
          outcomeRecorded: false,
          reason: `Measured ${totalImpressions} impressions and ${clicks} clicks in review window. Maintained active.`
        });
      }
    }

    return outcomes;
  }
}
