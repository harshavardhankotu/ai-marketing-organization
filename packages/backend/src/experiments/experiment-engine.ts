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
}

export class ExperimentEngine {
  public static createExperiment(options: CreateExperimentOptions): string {
    const db = getDb();
    const id = `exp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

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
      JSON.stringify({
        baselineSamples: 0,
        baselineConversions: 0,
        treatmentSamples: 0,
        treatmentConversions: 0,
        pVal: 1.0
      })
    );

    return id;
  }

  public static evaluateExperiment(
    experimentId: string,
    sampleData: {
      baselineSamples: number;
      baselineConversions: number;
      treatmentSamples: number;
      treatmentConversions: number;
    }
  ): { outcome: ExperimentOutcome; confidence: number; decisionSummary: string } {
    const db = getDb();
    const exp = db.prepare('SELECT * FROM experiments WHERE id = ?').get(experimentId) as any;
    if (!exp) {
      throw new Error(`Experiment not found: ${experimentId}`);
    }

    const { baselineSamples, baselineConversions, treatmentSamples, treatmentConversions } = sampleData;
    const totalSamples = baselineSamples + treatmentSamples;

    if (totalSamples < exp.minimum_evidence_requirement) {
      return {
        outcome: 'INCONCLUSIVE',
        confidence: 0.4,
        decisionSummary: `Sample size (${totalSamples}) below minimum evidence requirement (${exp.minimum_evidence_requirement}). Continuing experiment run.`
      };
    }

    const pBaseline = baselineConversions / (baselineSamples || 1);
    const pTreatment = treatmentConversions / (treatmentSamples || 1);
    const uplift = ((pTreatment - pBaseline) / (pBaseline || 0.001)) * 100;

    // Two-proportion pooled z-test approximation
    const pPooled = (baselineConversions + treatmentConversions) / totalSamples;
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / (baselineSamples || 1) + 1 / (treatmentSamples || 1)));
    const z = se > 0 ? (pTreatment - pBaseline) / se : 0;
    
    // Normal CDF p-value approximation
    const pVal = Math.max(0.001, Number((1 - 0.5 * (1 + Math.tanh(z / 1.414))).toFixed(4)));
    const isSignificant = pVal < 0.05;

    let outcome: ExperimentOutcome = 'INCONCLUSIVE';
    let decisionSummary = '';

    if (isSignificant && uplift > 10) {
      outcome = 'SCALE';
      decisionSummary = `Statistically significant uplift of +${uplift.toFixed(1)}% (p=${pVal}). Recommend scaling treatment permanently across campaigns.`;
    } else if (isSignificant && uplift < -5) {
      outcome = 'STOP';
      decisionSummary = `Statistically significant underperformance of ${uplift.toFixed(1)}% (p=${pVal}). Immediate termination recommended.`;
    } else if (!isSignificant && totalSamples > exp.minimum_evidence_requirement * 2) {
      outcome = 'MODIFY';
      decisionSummary = `No statistical distinction between baseline and treatment after ${totalSamples} impressions (p=${pVal}). Refine hypothesis and iterate creative.`;
    } else {
      outcome = 'RERUN';
      decisionSummary = `Trending positively (+${uplift.toFixed(1)}%) but requires additional sample convergence.`;
    }

    const confidenceScore = Math.min(0.99, Number((1 - pVal).toFixed(2)));

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
        JSON.stringify({ ...sampleData, pVal }),
        experimentId
      );

      // 2. Synthesize Formal Learning if Conclusive
      if (outcome === 'SCALE' || outcome === 'STOP') {
        LearningManager.recordLearning({
          organizationId: exp.organization_id,
          businessId: exp.business_id,
          sourceExperimentId: experimentId,
          observation: `Treatment generated ${uplift > 0 ? '+' : ''}${uplift.toFixed(1)}% conversion shift compared to baseline.`,
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

    return { outcome, confidence: confidenceScore, decisionSummary };
  }
}