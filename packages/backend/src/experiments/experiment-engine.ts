import { getDb } from '../db/client.js';
import { LearningManager } from '../control-plane/learning-manager.js';
import { ExperimentOutcome } from '@ai-marketing/shared';

export interface CreateExperimentOptions {
  organizationId: string;
  businessId: string;
  campaignId?: string;
  title: string;
  hypothesis: string;
  baseline: string;
  treatment: string;
  successMetric: string;
  expectedEffect: string;
  minimumEvidenceRequirement?: number;
  metadata?: Record<string, any>;
}

export interface SampleComparisonInput {
  baselineSamples: number;
  baselineConversions: number;
  treatmentSamples: number;
  treatmentConversions: number;
}

export interface ExperimentEvaluationResult {
  outcome: ExperimentOutcome;
  confidence: number;
  decisionSummary: string;
  pVal: number;
  upliftPercent: number;
  baselineRate: number;
  treatmentRate: number;
  metrics: SampleComparisonInput & Record<string, any>;
}

export const STOREFRONT_DEAL_CTA_EXP_ID = 'exp_storefront_deal_cta';
export const STOREFRONT_SITEFIX_CTA_EXP_ID = 'exp_storefront_sitefix_cta';

export interface StorefrontExperimentDefinition {
  id: string;
  slot: 'DEAL_CARD_CTA' | 'SITEFIX_CHECKOUT_CTA';
  title: string;
  hypothesis: string;
  baseline: string;
  treatment: string;
  successMetric: string;
  expectedEffect: string;
  minimumEvidenceRequirement: number;
}

export const DEFAULT_STOREFRONT_EXPERIMENTS: StorefrontExperimentDefinition[] = [
  {
    id: STOREFRONT_DEAL_CTA_EXP_ID,
    slot: 'DEAL_CARD_CTA',
    title: 'Storefront Deal Card Outbound CTA Test',
    hypothesis: 'Action-oriented verified price claim CTA increases buyer click-through rate over neutral merchant link',
    baseline: 'Buy at Merchant →',
    treatment: 'Claim Verified Deal Price →',
    successMetric: 'verified_outbound_deal_clicks',
    expectedEffect: '+20% outbound deal CTR across / and /deals',
    minimumEvidenceRequirement: 20
  },
  {
    id: STOREFRONT_SITEFIX_CTA_EXP_ID,
    slot: 'SITEFIX_CHECKOUT_CTA',
    title: 'SiteFix Checkout Fix-Pack CTA Test',
    hypothesis: 'Specific deliverable-oriented SEO & Schema patch framing lifts self-serve ₹499 checkout conversion',
    baseline: 'Unlock Instant Ready-to-Paste Fix-Pack — ₹499',
    treatment: 'Download Complete SEO & Schema Patch — ₹499',
    successMetric: 'sitefix_checkout_conversions',
    expectedEffect: '+15% SiteFix ₹499 checkout initiation & completion',
    minimumEvidenceRequirement: 20
  }
];

export interface StorefrontVariantAssignment {
  experimentId: string;
  slot: string;
  variant: 'baseline' | 'treatment';
  ctaText: string;
  promoted: boolean;
  status: string;
}

export class ExperimentEngine {
  /**
   * Stage J Task 4: Idempotently seeds the 2 default production (non-test, isTest: false)
   * Storefront A/B experiments for Deal Card CTA & SiteFix Checkout CTA.
   */
  public static seedDefaultStorefrontExperiments(
    organizationId: string = 'org_owner_primary',
    businessId: string = 'biz_platform_aro'
  ): { seededIds: string[] } {
    const db = getDb();
    const seededIds: string[] = [];

    // Ensure owner org and business exist if invoked against a blank/minimal test DB
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug)
        VALUES (?, 'Platform Owner Organization', 'owner-primary')
      `).run(organizationId);
      db.prepare(`
        INSERT OR IGNORE INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
          country, currency, timezone, city, neighborhood, brand_voice, autonomy_mode, kill_switch_active, public_live
        ) VALUES (
          ?, ?, 'Platform Autonomous Revenue System', 'platform-aro', 'TECHNOLOGY', 'AI & Technology Services', 'LOW',
          'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills',
          'Direct, consultative, authoritative', 'ASSISTED', 0, 0
        )
      `).run(businessId, organizationId);
    } catch {}

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO experiments (
        id, organization_id, business_id, campaign_id, title,
        hypothesis, baseline, treatment, success_metric, minimum_evidence_requirement,
        expected_effect, start_date, status, metrics_json, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'RUNNING', ?, datetime('now'), datetime('now'))
    `);

    for (const def of DEFAULT_STOREFRONT_EXPERIMENTS) {
      const initialMetrics = {
        isTest: false,
        storefrontSlot: def.slot,
        baselineSamples: 0,
        baselineConversions: 0,
        treatmentSamples: 0,
        treatmentConversions: 0,
        promotedVariant: null,
        promotedCta: null,
        pVal: 1.0,
        upliftPercent: 0
      };
      stmt.run(
        def.id,
        organizationId,
        businessId,
        def.title,
        def.hypothesis,
        def.baseline,
        def.treatment,
        def.successMetric,
        def.minimumEvidenceRequirement,
        def.expectedEffect,
        JSON.stringify(initialMetrics)
      );
      seededIds.push(def.id);
    }

    return { seededIds };
  }

  /**
   * Returns deterministic 50/50 variant assignment while experiment is RUNNING,
   * or auto-promotes 100% traffic to the winning CTA once outcome === 'SCALE' (or reverts on 'STOP').
   */
  public static assignStorefrontVariant(
    experimentId: string,
    visitorKey?: string
  ): StorefrontVariantAssignment {
    const def = DEFAULT_STOREFRONT_EXPERIMENTS.find(d => d.id === experimentId) || DEFAULT_STOREFRONT_EXPERIMENTS[0];
    try {
      const db = getDb();
      const exp = db.prepare('SELECT id, baseline, treatment, status, outcome, metrics_json FROM experiments WHERE id = ?').get(experimentId) as any;
      if (exp) {
        let metrics: Record<string, any> = {};
        try {
          metrics = JSON.parse(exp.metrics_json || '{}');
        } catch {
          metrics = {};
        }

        if (exp.outcome === 'SCALE' || (metrics.promotedVariant === 'treatment' && metrics.promotedCta)) {
          return {
            experimentId: exp.id,
            slot: metrics.storefrontSlot || def.slot,
            variant: 'treatment',
            ctaText: String(metrics.promotedCta || exp.treatment),
            promoted: true,
            status: exp.status || 'CONCLUDED'
          };
        }
        if (exp.outcome === 'STOP' || metrics.promotedVariant === 'baseline') {
          return {
            experimentId: exp.id,
            slot: metrics.storefrontSlot || def.slot,
            variant: 'baseline',
            ctaText: String(exp.baseline),
            promoted: true,
            status: exp.status || 'CONCLUDED'
          };
        }

        const bucket = ExperimentEngine.hashBucket(visitorKey || `anon_${Date.now()}_${Math.random()}`);
        const variant: 'baseline' | 'treatment' = bucket % 2 === 0 ? 'baseline' : 'treatment';
        return {
          experimentId: exp.id,
          slot: metrics.storefrontSlot || def.slot,
          variant,
          ctaText: variant === 'treatment' ? exp.treatment : exp.baseline,
          promoted: false,
          status: exp.status || 'RUNNING'
        };
      }
    } catch {}

    const bucket = ExperimentEngine.hashBucket(visitorKey || 'default');
    const variant: 'baseline' | 'treatment' = bucket % 2 === 0 ? 'baseline' : 'treatment';
    return {
      experimentId: def.id,
      slot: def.slot,
      variant,
      ctaText: variant === 'treatment' ? def.treatment : def.baseline,
      promoted: false,
      status: 'RUNNING'
    };
  }

  private static hashBucket(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  /**
   * Records a live storefront exposure ('impression') or conversion ('click' / 'conversion')
   * into analytics_events for automated ExperimentEngine telemetry evaluation.
   */
  public static recordStorefrontEvent(options: {
    experimentId: string;
    variant: 'baseline' | 'treatment';
    eventType: 'impression' | 'click' | 'conversion';
    targetId?: string;
    userIdentifier?: string;
    organizationId?: string;
    businessId?: string;
    isTest?: boolean;
  }): { recorded: boolean; eventId: string } {
    const db = getDb();
    const eventId = `ev_sf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const orgId = options.organizationId || 'org_owner_primary';
    const bizId = options.businessId || 'biz_platform_aro';

    db.prepare(`
      INSERT INTO analytics_events (
        id, organization_id, business_id, campaign_id, channel, event_type, user_identifier, metadata_json, created_at
      ) VALUES (?, ?, ?, NULL, 'STOREFRONT_WEB', ?, ?, ?, datetime('now'))
    `).run(
      eventId,
      orgId,
      bizId,
      options.eventType,
      options.userIdentifier || null,
      JSON.stringify({
        experimentId: options.experimentId,
        variant: options.variant,
        targetId: options.targetId || null,
        isTest: Boolean(options.isTest)
      })
    );

    return { recorded: true, eventId };
  }

  /**
   * Runs automated statistical comparison across all seeded Storefront A/B experiments.
   */
  public static evaluateStorefrontExperiments(): Array<{
    experimentId: string;
    outcome: ExperimentOutcome;
    promotedCta: string | null;
    upliftPercent: number;
    pVal: number;
  }> {
    const db = getDb();
    const results: Array<{
      experimentId: string;
      outcome: ExperimentOutcome;
      promotedCta: string | null;
      upliftPercent: number;
      pVal: number;
    }> = [];

    for (const def of DEFAULT_STOREFRONT_EXPERIMENTS) {
      const exp = db.prepare('SELECT id FROM experiments WHERE id = ?').get(def.id) as any;
      if (!exp) continue;
      const evalRes = ExperimentEngine.evaluateFromTelemetry(def.id);
      results.push({
        experimentId: def.id,
        outcome: evalRes.outcome,
        promotedCta: evalRes.metrics?.promotedCta || null,
        upliftPercent: evalRes.upliftPercent,
        pVal: evalRes.pVal
      });
    }

    return results;
  }

  public static createExperiment(options: CreateExperimentOptions): string {
    const db = getDb();
    const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const initialMetrics = {
      isTest: false,
      ...(options.metadata || {}),
      baselineSamples: 0,
      baselineConversions: 0,
      treatmentSamples: 0,
      treatmentConversions: 0,
      pVal: 1.0,
      upliftPercent: 0
    };

    db.prepare(`
      INSERT INTO experiments (
        id, organization_id, business_id, campaign_id, title,
        hypothesis, baseline, treatment, success_metric, minimum_evidence_requirement,
        expected_effect, start_date, status, metrics_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'RUNNING', ?, datetime('now'), datetime('now'))
    `).run(
      id,
      options.organizationId,
      options.businessId,
      options.campaignId || null,
      options.title,
      options.hypothesis,
      options.baseline,
      options.treatment,
      options.successMetric,
      options.minimumEvidenceRequirement || 50,
      options.expectedEffect,
      JSON.stringify(initialMetrics)
    );

    return id;
  }

  public static evaluateExperiment(
    experimentId: string,
    sampleData: SampleComparisonInput
  ): ExperimentEvaluationResult {
    const db = getDb();
    const exp = db.prepare('SELECT * FROM experiments WHERE id = ?').get(experimentId) as any;
    if (!exp) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    let existingMetrics: Record<string, any> = {};
    try {
      existingMetrics = JSON.parse(exp.metrics_json || '{}');
    } catch {
      existingMetrics = {};
    }

    const baselineSamples = Math.max(0, Math.floor(Number(sampleData.baselineSamples) || 0));
    const baselineConversions = Math.min(baselineSamples, Math.max(0, Math.floor(Number(sampleData.baselineConversions) || 0)));
    const treatmentSamples = Math.max(0, Math.floor(Number(sampleData.treatmentSamples) || 0));
    const treatmentConversions = Math.min(treatmentSamples, Math.max(0, Math.floor(Number(sampleData.treatmentConversions) || 0)));

    const totalSamples = baselineSamples + treatmentSamples;
    const baselineRate = baselineSamples > 0 ? baselineConversions / baselineSamples : 0;
    const treatmentRate = treatmentSamples > 0 ? treatmentConversions / treatmentSamples : 0;
    const upliftPercent = baselineRate > 0
      ? Number((((treatmentRate - baselineRate) / baselineRate) * 100).toFixed(1))
      : (treatmentRate > 0 ? 100 : 0);

    const minPerArm = 50;
    if (
      totalSamples < exp.minimum_evidence_requirement ||
      baselineSamples < minPerArm ||
      treatmentSamples < minPerArm
    ) {
      const decisionSummary = `Sample size (${totalSamples}: Control ${baselineSamples}, Variation ${treatmentSamples}) below minimum evidence requirement (${exp.minimum_evidence_requirement}, >=${minPerArm}/arm). Continuing experiment run.`;
      const updatedMetrics = {
        ...existingMetrics,
        baselineSamples,
        baselineConversions,
        treatmentSamples,
        treatmentConversions,
        pVal: 1.0,
        upliftPercent,
        baselineRate: Number((baselineRate * 100).toFixed(2)),
        treatmentRate: Number((treatmentRate * 100).toFixed(2)),
        lastEvaluatedAt: new Date().toISOString()
      };

      db.prepare(`
        UPDATE experiments
        SET status = 'RUNNING',
            outcome = 'INCONCLUSIVE',
            confidence_score = 0.4,
            decision_summary = ?,
            metrics_json = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(decisionSummary, JSON.stringify(updatedMetrics), experimentId);

      return {
        outcome: 'INCONCLUSIVE',
        confidence: 0.4,
        decisionSummary,
        pVal: 1.0,
        upliftPercent,
        baselineRate,
        treatmentRate,
        metrics: updatedMetrics
      };
    }

    // Two-proportion pooled z-test (two-tailed p-value)
    const pPooled = (baselineConversions + treatmentConversions) / totalSamples;
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / baselineSamples + 1 / treatmentSamples));
    const z = se > 0 ? (treatmentRate - baselineRate) / se : 0;
    const absZ = Math.abs(z);
    const phiAbsZ = 0.5 * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (absZ + 0.044715 * absZ * absZ * absZ)));
    const pVal = Math.max(0.0001, Math.min(1.0, Number((2 * (1 - phiAbsZ)).toFixed(4))));
    const isSignificant = pVal < 0.05;

    let outcome: ExperimentOutcome = 'INCONCLUSIVE';
    let decisionSummary = '';

    if (isSignificant && upliftPercent > 10) {
      outcome = 'SCALE';
      decisionSummary = `Statistically significant uplift of +${upliftPercent.toFixed(1)}% (p=${pVal}). Recommend scaling treatment permanently across campaigns.`;
    } else if (isSignificant && upliftPercent < -5) {
      outcome = 'STOP';
      decisionSummary = `Statistically significant underperformance of ${upliftPercent.toFixed(1)}% (p=${pVal}). Immediate termination recommended.`;
    } else if (!isSignificant && totalSamples > exp.minimum_evidence_requirement * 2) {
      outcome = 'MODIFY';
      decisionSummary = `No statistical distinction between baseline and treatment after ${totalSamples} impressions (p=${pVal}). Refine hypothesis and iterate creative.`;
    } else {
      outcome = 'RERUN';
      decisionSummary = `Trending ${upliftPercent >= 0 ? `+${upliftPercent.toFixed(1)}%` : `${upliftPercent.toFixed(1)}%`} (p=${pVal}) — requires additional sample convergence.`;
    }

    const confidenceScore = Math.min(0.99, Math.max(0.5, Number((1 - pVal).toFixed(2))));
    const promotedVariant = outcome === 'SCALE'
      ? 'treatment'
      : outcome === 'STOP'
        ? 'baseline'
        : (existingMetrics.promotedVariant || null);
    const promotedCta = outcome === 'SCALE'
      ? String(exp.treatment)
      : outcome === 'STOP'
        ? String(exp.baseline)
        : (existingMetrics.promotedCta || null);

    const updatedMetrics = {
      ...existingMetrics,
      baselineSamples,
      baselineConversions,
      treatmentSamples,
      treatmentConversions,
      promotedVariant,
      promotedCta,
      pVal,
      upliftPercent,
      baselineRate: Number((baselineRate * 100).toFixed(2)),
      treatmentRate: Number((treatmentRate * 100).toFixed(2)),
      lastEvaluatedAt: new Date().toISOString()
    };

    db.transaction(() => {
      // 1. Update Experiment
      db.prepare(`
        UPDATE experiments
        SET status = 'CONCLUDED',
            outcome = ?,
            confidence_score = ?,
            decision_summary = ?,
            metrics_json = ?,
            end_date = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        outcome,
        confidenceScore,
        decisionSummary,
        JSON.stringify(updatedMetrics),
        experimentId
      );

      // 2. Synthesize Formal Learning if Conclusive
      if (outcome === 'SCALE' || outcome === 'STOP') {
        LearningManager.recordLearning({
          organizationId: exp.organization_id,
          businessId: exp.business_id,
          sourceExperimentId: experimentId,
          observation: `Treatment generated ${upliftPercent > 0 ? '+' : ''}${upliftPercent.toFixed(1)}% conversion shift compared to baseline.`,
          hypothesis: exp.hypothesis,
          experimentResult: decisionSummary,
          learning: outcome === 'SCALE'
            ? `Audience strongly responds to: "${exp.treatment}". Cement this into brand communication standards.`
            : `Audience rejected: "${exp.treatment}". Cease similar creatives.`,
          policyUpdate: outcome === 'SCALE'
            ? `Increase channel budget allocation and mandate "${exp.treatment}" in subsequent campaign creative briefs.`
            : `Filter out negative messaging patterns in quality assurance.`,
          confidence: confidenceScore
        });
      }
    })();

    return {
      outcome,
      confidence: confidenceScore,
      decisionSummary,
      pVal,
      upliftPercent,
      baselineRate,
      treatmentRate,
      metrics: updatedMetrics
    };
  }

  /**
   * Collects live telemetry from analytics_events for an experiment/campaign (or storefront metadata)
   * and evaluates statistical significance using the persisted + telemetry sample counts.
   */
  public static evaluateFromTelemetry(
    experimentId: string,
    overrideSamples?: Partial<SampleComparisonInput>
  ): ExperimentEvaluationResult {
    const db = getDb();
    const exp = db.prepare('SELECT * FROM experiments WHERE id = ?').get(experimentId) as any;
    if (!exp) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    let existingMetrics: Record<string, any> = {};
    try {
      existingMetrics = JSON.parse(exp.metrics_json || '{}');
    } catch {
      existingMetrics = {};
    }

    let telemetryBaselineSamples = 0;
    let telemetryBaselineConversions = 0;
    let telemetryTreatmentSamples = 0;
    let telemetryTreatmentConversions = 0;

    const events = exp.campaign_id
      ? (db.prepare(`
          SELECT event_type, metadata_json
          FROM analytics_events
          WHERE campaign_id = ?
        `).all(exp.campaign_id) as Array<{ event_type: string; metadata_json: string }>)
      : (db.prepare(`
          SELECT event_type, metadata_json
          FROM analytics_events
          WHERE campaign_id IS NULL
            AND (json_extract(metadata_json, '$.experimentId') = ? OR metadata_json LIKE ?)
        `).all(experimentId, `%${experimentId}%`) as Array<{ event_type: string; metadata_json: string }>);

    const isStorefrontExp = !exp.campaign_id && Boolean(existingMetrics.storefrontSlot);

    for (const ev of events) {
      let meta: Record<string, any> = {};
      try {
        meta = JSON.parse(ev.metadata_json || '{}');
      } catch {
        meta = {};
      }

      if (meta.experimentId && meta.experimentId !== experimentId) {
        continue;
      }

      // Fix 3: Exclude test & diagnostic probe events from statistical evaluation
      const rawMetaStr = String(ev.metadata_json || '');
      if (
        meta.isTest === true ||
        meta.is_test === true ||
        meta.is_test === 1 ||
        meta.diagnosticProbe === true ||
        rawMetaStr.includes('X-Diagnostic-Probe')
      ) {
        continue;
      }

      const variant = String(meta.variant || '').toLowerCase();
      const evType = String(ev.event_type || '').toLowerCase();
      // For storefront CTA experiments, impression/view/visit are exposures; click/conversion/purchase are conversions.
      // For legacy campaign experiments, impression/view/visit/click/session are exposures and conversion/lead/booking/purchase/payment are conversions.
      const isExposure = isStorefrontExp
        ? ['impression', 'view', 'visit', 'session'].includes(evType)
        : ['impression', 'view', 'visit', 'click', 'session'].includes(evType);
      const isConversion = isStorefrontExp
        ? ['click', 'conversion', 'lead', 'qualified_lead', 'booking', 'purchase', 'payment'].includes(evType)
        : ['conversion', 'lead', 'qualified_lead', 'booking', 'purchase', 'payment'].includes(evType);

      if (variant === 'baseline' || variant === 'control') {
        if (isExposure) telemetryBaselineSamples += 1;
        if (isConversion) telemetryBaselineConversions += 1;
      } else if (variant === 'treatment' || variant === 'variation' || (existingMetrics.variantLabel && meta.variant === existingMetrics.variantLabel)) {
        if (isExposure) telemetryTreatmentSamples += 1;
        if (isConversion) telemetryTreatmentConversions += 1;
      }
    }

    const baselineSamples = overrideSamples?.baselineSamples ?? Math.max(existingMetrics.baselineSamples || 0, telemetryBaselineSamples);
    const baselineConversions = overrideSamples?.baselineConversions ?? Math.max(existingMetrics.baselineConversions || 0, telemetryBaselineConversions);
    const treatmentSamples = overrideSamples?.treatmentSamples ?? Math.max(existingMetrics.treatmentSamples || 0, telemetryTreatmentSamples);
    const treatmentConversions = overrideSamples?.treatmentConversions ?? Math.max(existingMetrics.treatmentConversions || 0, telemetryTreatmentConversions);

    const evalResult = ExperimentEngine.evaluateExperiment(experimentId, {
      baselineSamples,
      baselineConversions,
      treatmentSamples,
      treatmentConversions
    });

    try {
      const winner: 'TREATMENT' | 'BASELINE' | 'INCONCLUSIVE' =
        evalResult.outcome === 'SCALE'
          ? 'TREATMENT'
          : evalResult.outcome === 'STOP'
            ? 'BASELINE'
            : 'INCONCLUSIVE';
      const isSignificant = evalResult.pVal < 0.05;
      const winnerConversions = winner === 'TREATMENT'
        ? treatmentConversions
        : winner === 'BASELINE'
          ? baselineConversions
          : 0;
      const sectorCode = (existingMetrics.sectorCode as any) || (exp.campaign_id ? 'SECTOR_B_ELECTRONICS' : 'SECTOR_H_LOCAL_SERVICES_B2B');
      void import('../commission/commercial-learning-engine.js').then(({ CommercialLearningEngine }) => {
        CommercialLearningEngine.getInstance().recordExperimentSignal({
          experimentId,
          sectorCode,
          winner,
          conversionsCount: winnerConversions,
          isSignificant
        });
      }).catch(() => {});
    } catch {}

    return evalResult;
  }
}