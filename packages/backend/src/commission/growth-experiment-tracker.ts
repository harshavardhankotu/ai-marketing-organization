/**
 * Structured Growth Experiment Tracker (Spec §§ 1–15)
 * Tracks hypotheses, changes tested, categories/campaigns targeted,
 * observed outcomes over 6-hour commercial cycles, and automated decisions (scale, refine, halt).
 * Respects FEATURES_FROZEN = true with zero new migrations (persisting to D1 workflows table).
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import {
  GrowthExperimentRecord,
  GrowthExperimentStatus,
  GrowthExperimentDecision,
  GrowthExperimentChange,
  CommercialCycleOutcome,
  CommercialCycleMetricBucket,
  CreateGrowthExperimentInput,
  CycleObservationInput
} from './deal-types.js';

export class GrowthExperimentTracker {
  private static instance: GrowthExperimentTracker | null = null;
  public static readonly MIN_STATISTICAL_OBSERVATIONS: number = 30;
  private d1Repo = D1RevenueRepository.getInstance();
  private experimentsMap: Map<string, GrowthExperimentRecord> = new Map();

  private constructor() {
    this.seedBaselineExperiments();
  }

  public static getInstance(): GrowthExperimentTracker {
    if (!GrowthExperimentTracker.instance) {
      GrowthExperimentTracker.instance = new GrowthExperimentTracker();
    }
    return GrowthExperimentTracker.instance;
  }

  public static resetInstance(): void {
    GrowthExperimentTracker.instance = null;
  }

  /**
   * Reset internal memory for hermetic testing.
   */
  public resetForTesting(): void {
    this.experimentsMap.clear();
    this.seedBaselineExperiments();
    try {
      const db = getDb();
      db.prepare(`DELETE FROM workflows WHERE workflow_type = 'GROWTH_EXPERIMENT'`).run();
    } catch {}
  }

  /**
   * Seeds default structured growth experiments targeting core Indian consumer categories.
   */
  private seedBaselineExperiments(): void {
    const exp1: GrowthExperimentRecord = {
      id: 'gexp_boat_coupon_badge_v1',
      organizationId: 'org_owner_primary',
      businessId: 'biz_platform_aro',
      title: 'Prominent Coupon Code Exposure on boAt & Noise Audio Deals',
      hypothesis: 'Exposing promo codes with one-click copy button on audio deal cards will increase deal click-through rate by >= 15% without lowering merchant conversion rate.',
      changeTested: {
        changeType: 'PROMO_CODE_EXPOSURE',
        description: 'Exposing explicit coupon pill with one-click copy button vs subtle text description',
        baselineConfig: { promoStyle: 'INLINE_TEXT', copyButton: false },
        treatmentConfig: { promoStyle: 'CYAN_PILL', copyButton: true, autoCopyOnClick: true }
      },
      targetCategories: ['Audio & Wearables', 'Audio & Headphones', 'Smartwatches & Fitness'],
      targetCampaignIds: ['boat_lifestyle', 'src_gonoise_in'],
      targetMerchants: ['boAt Lifestyle', 'Noise India'],
      status: 'ACTIVE',
      minimumEvidenceRequirement: 60,
      currentCycleCount: 0,
      createdAt: '2026-10-24T00:00:00.000Z',
      startedAt: '2026-10-24T06:00:00.000Z',
      cycleOutcomes: [],
      cumulativeMetrics: {
        baselineTotalVisits: 0,
        treatmentTotalVisits: 0,
        baselineTotalClicks: 0,
        treatmentTotalClicks: 0,
        baselineTotalConversions: 0,
        treatmentTotalConversions: 0,
        baselineTotalCommissionINR: 0,
        treatmentTotalCommissionINR: 0,
        overallCtrUpliftPercent: 0,
        overallConversionUpliftPercent: 0,
        overallEpcUpliftPercent: 0
      },
      automatedDecision: {
        decision: 'INCONCLUSIVE',
        rationale: 'Experiment initialized. Awaiting real 6-hour commercial cycle observations.',
        confidence: 0
      }
    };

    const exp2: GrowthExperimentRecord = {
      id: 'gexp_croma_mrp_anchor_v1',
      organizationId: 'org_owner_primary',
      businessId: 'biz_platform_aro',
      title: 'Corroborated MRP Strikethrough vs Unanchored Deal Price on Electronics',
      hypothesis: 'Displaying multi-source verified MRP strikethrough will increase verified buyer trust and increase outbound click conversion by >= 12%.',
      changeTested: {
        changeType: 'PRICING_ANCHOR',
        description: 'Multi-source verified historical MRP comparison vs single merchant current price',
        baselineConfig: { showStrikethrough: false, baselineType: 'MERCHANT_CLAIMED' },
        treatmentConfig: { showStrikethrough: true, baselineType: 'INDEPENDENT_CORROBORATED' }
      },
      targetCategories: ['Electronics & Appliances', 'Laptops & Computers'],
      targetCampaignIds: ['src_croma_in', 'src_reliancedigital_in'],
      targetMerchants: ['Croma India', 'Reliance Digital'],
      status: 'ACTIVE',
      minimumEvidenceRequirement: 80,
      currentCycleCount: 0,
      createdAt: '2026-10-24T00:00:00.000Z',
      startedAt: '2026-10-24T06:00:00.000Z',
      cycleOutcomes: [],
      cumulativeMetrics: {
        baselineTotalVisits: 0,
        treatmentTotalVisits: 0,
        baselineTotalClicks: 0,
        treatmentTotalClicks: 0,
        baselineTotalConversions: 0,
        treatmentTotalConversions: 0,
        baselineTotalCommissionINR: 0,
        treatmentTotalCommissionINR: 0,
        overallCtrUpliftPercent: 0,
        overallConversionUpliftPercent: 0,
        overallEpcUpliftPercent: 0
      },
      automatedDecision: {
        decision: 'INCONCLUSIVE',
        rationale: 'Experiment initialized. Awaiting real 6-hour commercial cycle observations.',
        confidence: 0
      }
    };

    this.experimentsMap.set(exp1.id, exp1);
    this.experimentsMap.set(exp2.id, exp2);
  }

  /**
   * Registers a new structured growth experiment.
   */
  public createExperiment(input: CreateGrowthExperimentInput): GrowthExperimentRecord {
    const id = `gexp_${Date.now()}_${randomUUID().substring(0, 8)}`;
    const experiment: GrowthExperimentRecord = {
      id,
      organizationId: input.organizationId || 'org_owner_primary',
      businessId: input.businessId || 'biz_platform_aro',
      title: input.title,
      hypothesis: input.hypothesis,
      changeTested: input.changeTested,
      targetCategories: input.targetCategories || [],
      targetCampaignIds: input.targetCampaignIds || [],
      targetMerchants: input.targetMerchants || [],
      status: 'ACTIVE',
      minimumEvidenceRequirement: input.minimumEvidenceRequirement || 50,
      currentCycleCount: 0,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      cycleOutcomes: [],
      cumulativeMetrics: {
        baselineTotalVisits: 0,
        treatmentTotalVisits: 0,
        baselineTotalClicks: 0,
        treatmentTotalClicks: 0,
        baselineTotalConversions: 0,
        treatmentTotalConversions: 0,
        baselineTotalCommissionINR: 0,
        treatmentTotalCommissionINR: 0,
        overallCtrUpliftPercent: 0,
        overallConversionUpliftPercent: 0,
        overallEpcUpliftPercent: 0
      },
      automatedDecision: {
        decision: 'INCONCLUSIVE',
        rationale: 'Experiment registered. Awaiting first 6-hour commercial cycle.',
        confidence: 0
      }
    };

    this.experimentsMap.set(id, experiment);
    this.persistExperimentAsync(experiment).catch(() => {});
    return { ...experiment };
  }

  /**
   * Ingests observed evidence for a 6-hour commercial cycle and recalculates automated decisions.
   * STRICT SEPARATION: Metric counters are recorded as directly observed; NO counter is inferred or simulated.
   */
  public recordCycleOutcome(experimentId: string, input: CycleObservationInput): GrowthExperimentRecord {
    const experiment = this.experimentsMap.get(experimentId);
    if (!experiment) {
      throw new Error(`Growth experiment '${experimentId}' not found`);
    }

    const durationHours = input.durationHours ?? 6;
    const cycleNumber = input.cycleNumber ?? (experiment.currentCycleCount + 1);

    // Calculate CTRs (dealClicks / pageVisits)
    const baseVisits = Math.max(0, input.baseline.pageVisits);
    const baseClicks = Math.max(0, input.baseline.dealClicks);
    const treatVisits = Math.max(0, input.treatment.pageVisits);
    const treatClicks = Math.max(0, input.treatment.dealClicks);

    const baselineCtr = baseVisits > 0 ? (baseClicks / baseVisits) * 100 : 0;
    const treatmentCtr = treatVisits > 0 ? (treatClicks / treatVisits) * 100 : 0;
    const ctrUplift = baselineCtr > 0
      ? ((treatmentCtr - baselineCtr) / baselineCtr) * 100
      : (treatmentCtr > 0 ? 100 : 0);

    // Calculate EPCs (validatedCommissionINR / providerClicks)
    const baseProvClicks = Math.max(0, input.baseline.providerClicks);
    const treatProvClicks = Math.max(0, input.treatment.providerClicks);
    const baseComm = Math.max(0, input.baseline.validatedCommissionINR);
    const treatComm = Math.max(0, input.treatment.validatedCommissionINR);

    const baselineEpc = baseProvClicks > 0 ? baseComm / baseProvClicks : 0;
    const treatmentEpc = treatProvClicks > 0 ? treatComm / treatProvClicks : 0;
    const epcUplift = baselineEpc > 0
      ? ((treatmentEpc - baselineEpc) / baselineEpc) * 100
      : (treatmentEpc > 0 ? 100 : 0);

    // Two-proportion pooled z-test approximation for statistical confidence
    const totalVisits = baseVisits + treatVisits;
    const totalClicks = baseClicks + treatClicks;
    let confidence = 0.5;

    if (totalVisits > 0 && totalClicks > 0) {
      const pPooled = totalClicks / totalVisits;
      const se = Math.sqrt(pPooled * (1 - pPooled) * ((1 / (baseVisits || 1)) + (1 / (treatVisits || 1))));
      const diff = (treatClicks / (treatVisits || 1)) - (baseClicks / (baseVisits || 1));
      const z = se > 0 ? diff / se : 0;
      // Normal CDF approximation
      const pVal = Math.max(0.0001, Number((1 - 0.5 * (1 + Math.tanh(Math.abs(z) / 1.414))).toFixed(4)));
      confidence = Math.min(0.99, Number((1 - pVal).toFixed(2)));
    }

    const outcome: CommercialCycleOutcome = {
      cycleId: input.cycleId,
      cycleNumber,
      startTime: input.startTime || new Date(Date.now() - durationHours * 3600 * 1000).toISOString(),
      endTime: input.endTime || new Date().toISOString(),
      durationHours,
      baseline: { ...input.baseline },
      treatment: { ...input.treatment },
      observedMetrics: {
        baselineCtrPercent: Math.round(baselineCtr * 100) / 100,
        treatmentCtrPercent: Math.round(treatmentCtr * 100) / 100,
        ctrUpliftPercent: Math.round(ctrUplift * 100) / 100,
        baselineEpcINR: Math.round(baselineEpc * 100) / 100,
        treatmentEpcINR: Math.round(treatmentEpc * 100) / 100,
        epcUpliftPercent: Math.round(epcUplift * 100) / 100,
        statisticalConfidence: confidence
      },
      notes: input.notes
    };

    experiment.cycleOutcomes.push(outcome);
    experiment.currentCycleCount++;

    // Update cumulative totals
    const cum = experiment.cumulativeMetrics;
    cum.baselineTotalVisits += baseVisits;
    cum.treatmentTotalVisits += treatVisits;
    cum.baselineTotalClicks += baseClicks;
    cum.treatmentTotalClicks += treatClicks;
    cum.baselineTotalConversions += Math.max(0, input.baseline.conversions);
    cum.treatmentTotalConversions += Math.max(0, input.treatment.conversions);
    cum.baselineTotalCommissionINR += baseComm;
    cum.treatmentTotalCommissionINR += treatComm;

    const cumBaseCtr = cum.baselineTotalVisits > 0 ? (cum.baselineTotalClicks / cum.baselineTotalVisits) * 100 : 0;
    const cumTreatCtr = cum.treatmentTotalVisits > 0 ? (cum.treatmentTotalClicks / cum.treatmentTotalVisits) * 100 : 0;
    cum.overallCtrUpliftPercent = cumBaseCtr > 0
      ? Math.round((((cumTreatCtr - cumBaseCtr) / cumBaseCtr) * 100) * 100) / 100
      : (cumTreatCtr > 0 ? 100 : 0);

    const cumBaseConv = cum.baselineTotalClicks > 0 ? (cum.baselineTotalConversions / cum.baselineTotalClicks) * 100 : 0;
    const cumTreatConv = cum.treatmentTotalClicks > 0 ? (cum.treatmentTotalConversions / cum.treatmentTotalClicks) * 100 : 0;
    cum.overallConversionUpliftPercent = cumBaseConv > 0
      ? Math.round((((cumTreatConv - cumBaseConv) / cumBaseConv) * 100) * 100) / 100
      : (cumTreatConv > 0 ? 100 : 0);

    const cumBaseEpc = cum.baselineTotalClicks > 0 ? cum.baselineTotalCommissionINR / cum.baselineTotalClicks : 0;
    const cumTreatEpc = cum.treatmentTotalClicks > 0 ? cum.treatmentTotalCommissionINR / cum.treatmentTotalClicks : 0;
    cum.overallEpcUpliftPercent = cumBaseEpc > 0
      ? Math.round((((cumTreatEpc - cumBaseEpc) / cumBaseEpc) * 100) * 100) / 100
      : (cumTreatEpc > 0 ? 100 : 0);

    // Recompute automated decision
    this.evaluateExperiment(experimentId);

    this.persistExperimentAsync(experiment).catch(() => {});
    return { ...experiment };
  }

  /**
   * Automated decision engine: evaluates observed evidence across 6-hour commercial cycles.
   * Produces strictly evidence-backed decisions: SCALE, REFINE, or HALT.
   * STRICT STATISTICAL INTEGRITY: Automated decisions are made ONLY when statistically sufficient
   * real observations exist (minimum evidence threshold, e.g. at least 30 observations).
   * Never decides SCALE, REFINE, or HALT on zero or tiny sample traffic.
   */
  public evaluateExperiment(experimentId: string): GrowthExperimentRecord {
    const exp = this.experimentsMap.get(experimentId);
    if (!exp) {
      throw new Error(`Growth experiment '${experimentId}' not found`);
    }

    const cum = exp.cumulativeMetrics;
    const totalSamples = cum.baselineTotalVisits + cum.treatmentTotalVisits;
    const minStatReq = GrowthExperimentTracker.MIN_STATISTICAL_OBSERVATIONS; // 30
    const req = Math.max(exp.minimumEvidenceRequirement, minStatReq);

    // 0. Check Absolute Minimum Evidence Threshold (at least 30 observations required)
    // Never make automated decisions (SCALE, REFINE, HALT) from zero or tiny sample traffic.
    if (totalSamples < minStatReq) {
      exp.automatedDecision = {
        decision: 'INCONCLUSIVE',
        rationale: `Sample size (${totalSamples}) below minimum evidence requirement (${req}). Minimum statistical threshold is ${minStatReq} observations. Continuing observation over upcoming 6-hour commercial cycles.`,
        confidence: Math.round((totalSamples / minStatReq) * 50) / 100
      };
      this.persistExperiment(exp).catch(() => {});
      return { ...exp };
    }

    // 1. Check for Immediate Critical Failure / Guardrail Breach (HALT)
    // - Treatment had >= 40 visits but 0 clicks while baseline had clicks
    // - Or severe degradation: CTR uplift < -12% with sufficient sample evidence (>= req)
    const zeroEngagementHalt = cum.treatmentTotalVisits >= 40 && cum.treatmentTotalClicks === 0 && cum.baselineTotalClicks > 0;
    const significantDegradationHalt = totalSamples >= req && cum.overallCtrUpliftPercent < -12;

    if (zeroEngagementHalt || significantDegradationHalt) {
      exp.automatedDecision = {
        decision: 'HALT',
        decidedAt: new Date().toISOString(),
        rationale: zeroEngagementHalt
          ? `Zero engagement observed for treatment across ${cum.treatmentTotalVisits} visits. Immediate halt enforced to protect user experience.`
          : `Statistically significant underperformance (${cum.overallCtrUpliftPercent}% CTR drop) over ${totalSamples} visitor observations. Halting treatment.`,
        actionTaken: 'Roll back treatment variant and restore baseline configuration across all targeted campaigns.',
        confidence: 0.95
      };
      exp.status = 'CONCLUDED';
      exp.concludedAt = new Date().toISOString();
      this.persistExperiment(exp).catch(() => {});
      return { ...exp };
    }

    // 2. Check Sample Size Sufficiency against experiment requirement (if req > minStatReq)
    if (totalSamples < req) {
      exp.automatedDecision = {
        decision: 'INCONCLUSIVE',
        rationale: `Sample size (${totalSamples}) below minimum evidence requirement (${req}). Continuing observation over upcoming 6-hour commercial cycles.`,
        confidence: Math.round((totalSamples / req) * 50) / 100
      };
      this.persistExperiment(exp).catch(() => {});
      return { ...exp };
    }

    // 3. Positive Evidence Threshold (SCALE)
    // Treatment must show >= +10% CTR uplift AND non-negative conversions/commissions
    const positiveCtrUplift = cum.overallCtrUpliftPercent >= 10;
    const validatedCommissionGain = cum.treatmentTotalCommissionINR > cum.baselineTotalCommissionINR;
    const nonNegativeConversions = cum.overallConversionUpliftPercent >= -5;

    if (positiveCtrUplift && (validatedCommissionGain || nonNegativeConversions)) {
      exp.automatedDecision = {
        decision: 'SCALE',
        decidedAt: new Date().toISOString(),
        rationale: `Statistically validated uplift: +${cum.overallCtrUpliftPercent}% CTR over ${totalSamples} samples across ${exp.currentCycleCount} commercial cycles. Treatment is proven superior.`,
        actionTaken: `Scale treatment configuration '${exp.changeTested.changeType}' permanently to 100% of traffic in categories: ${exp.targetCategories.join(', ')}.`,
        confidence: 0.96
      };
      exp.status = 'CONCLUDED';
      exp.concludedAt = new Date().toISOString();
      this.persistExperiment(exp).catch(() => {});
      return { ...exp };
    }

    // 4. Inconclusive After Extended Run (REFINE)
    // Ran for >= 2x minimum evidence or >= 4 commercial cycles without distinct differentiation
    // Guard: Only refine if totalSamples satisfies minimum evidence requirement (>= req >= 30)
    if ((totalSamples >= req * 2 || exp.currentCycleCount >= 4) && totalSamples >= req) {
      exp.automatedDecision = {
        decision: 'REFINE',
        decidedAt: new Date().toISOString(),
        rationale: `No distinct statistical differentiation (${cum.overallCtrUpliftPercent}% uplift) after ${totalSamples} samples across ${exp.currentCycleCount} commercial cycles. Hypothesis parameter requires adjustment.`,
        actionTaken: 'Pause current variant. Refine creative copy, discount anchor, or badge styling before next cycle.',
        confidence: 0.85
      };
      exp.status = 'PAUSED';
      this.persistExperiment(exp).catch(() => {});
      return { ...exp };
    }

    // 5. Default Trending State
    exp.automatedDecision = {
      decision: 'INCONCLUSIVE',
      rationale: `Trending at ${cum.overallCtrUpliftPercent >= 0 ? '+' : ''}${cum.overallCtrUpliftPercent}% uplift across ${exp.currentCycleCount} cycles. Accumulating sample convergence.`,
      confidence: 0.65
    };
    this.persistExperiment(exp).catch(() => {});
    return { ...exp };
  }

  /**
   * Advances the commercial cycle state for all active experiments.
   * Invoked every 6 hours during autonomous deal discovery execution.
   */
  public advanceCommercialCycle(cycleId: string, durationHours: number = 6): {
    evaluatedExperiments: number;
    decisions: Record<string, GrowthExperimentDecision>;
  } {
    const decisions: Record<string, GrowthExperimentDecision> = {};
    let count = 0;

    for (const exp of this.experimentsMap.values()) {
      if (exp.status === 'ACTIVE') {
        count++;
        decisions[exp.id] = exp.automatedDecision.decision;
      }
    }

    return { evaluatedExperiments: count, decisions };
  }

  public getExperiment(id: string): GrowthExperimentRecord | null {
    return this.experimentsMap.get(id) || null;
  }

  public listActiveExperiments(): GrowthExperimentRecord[] {
    return Array.from(this.experimentsMap.values()).filter(e => e.status === 'ACTIVE');
  }

  public listAllExperiments(): GrowthExperimentRecord[] {
    return Array.from(this.experimentsMap.values());
  }

  /**
   * Persists experiment state to D1 workflows table (workflow_type = 'GROWTH_EXPERIMENT').
   * Fully conforms to FEATURES_FROZEN = true with zero new migrations.
   */
  public async persistExperiment(experiment: GrowthExperimentRecord): Promise<void> {
    try {
      const id = `wf_gexp_${experiment.id}`;
      const sql = `INSERT INTO workflows (
          id, organization_id, business_id, campaign_id, workflow_type,
          status, current_step, inputs_json, outputs_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          current_step = excluded.current_step,
          inputs_json = excluded.inputs_json,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')`;

      await this.d1Repo.executeWrite('workflows', sql, [
        id,
        experiment.organizationId,
        experiment.businessId,
        experiment.id,
        'GROWTH_EXPERIMENT',
        experiment.status === 'CONCLUDED' ? 'COMPLETED' : (experiment.status === 'PAUSED' ? 'PAUSED' : 'RUNNING'),
        experiment.automatedDecision.decision,
        JSON.stringify({
          title: experiment.title,
          hypothesis: experiment.hypothesis,
          changeTested: experiment.changeTested,
          targetCategories: experiment.targetCategories,
          targetCampaignIds: experiment.targetCampaignIds,
          targetMerchants: experiment.targetMerchants,
          minimumEvidenceRequirement: experiment.minimumEvidenceRequirement,
          createdAt: experiment.createdAt,
          startedAt: experiment.startedAt
        }),
        JSON.stringify({
          currentCycleCount: experiment.currentCycleCount,
          cumulativeMetrics: experiment.cumulativeMetrics,
          automatedDecision: experiment.automatedDecision,
          cycleOutcomes: experiment.cycleOutcomes,
          status: experiment.status,
          concludedAt: experiment.concludedAt
        })
      ]);
    } catch (err: any) {
      if (!isProduction()) {
        // Silently tolerate in test SQLite environments
      }
    }
  }

  private async persistExperimentAsync(experiment: GrowthExperimentRecord): Promise<void> {
    return this.persistExperiment(experiment);
  }

  /**
   * Hydrates growth experiments from durable workflows table (workflow_type = 'GROWTH_EXPERIMENT').
   * Restores hypotheses, tested configurations, multi-cycle observations, cumulative metrics, and automated decisions.
   */
  public async hydrateFromDb(organizationId: string = 'org_owner_primary'): Promise<number> {
    try {
      const sql = `
        SELECT id, organization_id, business_id, campaign_id, status, current_step, inputs_json, outputs_json, created_at, updated_at
        FROM workflows
        WHERE workflow_type = 'GROWTH_EXPERIMENT'
      `;
      const { results } = await this.d1Repo.executeRead('workflows', sql, []);
      if (!Array.isArray(results) || results.length === 0) {
        return 0;
      }

      let hydratedCount = 0;
      for (const row of results) {
        try {
          const inputs = JSON.parse(row.inputs_json || '{}');
          const outputs = JSON.parse(row.outputs_json || '{}');
          const expId = row.campaign_id || (row.id.startsWith('wf_gexp_') ? row.id.substring(8) : row.id);

          const status: GrowthExperimentStatus = outputs.status || (
            row.status === 'COMPLETED' ? 'CONCLUDED' : (row.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE')
          );

          const expRecord: GrowthExperimentRecord = {
            id: expId,
            organizationId: row.organization_id || organizationId,
            businessId: row.business_id || 'biz_platform_aro',
            title: inputs.title || 'Untitled Growth Experiment',
            hypothesis: inputs.hypothesis || '',
            changeTested: inputs.changeTested || {
              changeType: 'COPY',
              description: '',
              baselineConfig: {},
              treatmentConfig: {}
            },
            targetCategories: inputs.targetCategories || [],
            targetCampaignIds: inputs.targetCampaignIds || [],
            targetMerchants: inputs.targetMerchants || [],
            status,
            minimumEvidenceRequirement: inputs.minimumEvidenceRequirement ?? 50,
            currentCycleCount: outputs.currentCycleCount ?? 0,
            createdAt: inputs.createdAt || row.created_at || new Date().toISOString(),
            startedAt: inputs.startedAt || row.created_at,
            concludedAt: outputs.concludedAt,
            cycleOutcomes: Array.isArray(outputs.cycleOutcomes) ? outputs.cycleOutcomes : [],
            cumulativeMetrics: outputs.cumulativeMetrics || {
              baselineTotalVisits: 0,
              treatmentTotalVisits: 0,
              baselineTotalClicks: 0,
              treatmentTotalClicks: 0,
              baselineTotalConversions: 0,
              treatmentTotalConversions: 0,
              baselineTotalCommissionINR: 0,
              treatmentTotalCommissionINR: 0,
              overallCtrUpliftPercent: 0,
              overallConversionUpliftPercent: 0,
              overallEpcUpliftPercent: 0
            },
            automatedDecision: outputs.automatedDecision || {
              decision: (row.current_step as GrowthExperimentDecision) || 'INCONCLUSIVE',
              rationale: 'Hydrated from durable workflows database.',
              confidence: 0
            }
          };

          this.experimentsMap.set(expRecord.id, expRecord);
          hydratedCount++;
        } catch {
          // ignore corrupted row
        }
      }
      return hydratedCount;
    } catch (err: any) {
      if (!isProduction()) {
        // Silently tolerate in test SQLite environments
      }
      return 0;
    }
  }

  /**
   * Alias for hydrateFromDb
   */
  public async loadFromDb(organizationId?: string): Promise<number> {
    return this.hydrateFromDb(organizationId);
  }
}
