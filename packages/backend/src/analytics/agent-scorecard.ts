import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  AgentCategory,
  AgentConfidenceLevel,
  AgentSampleSizeTier,
  AgentScorecardRecord,
  PredictionRecord,
  PredictionStatus,
} from '@ai-marketing/shared';

export class AgentScorecardEngine {
  private get db() {
    return getDb();
  }

  /**
   * Evaluates sample size tier and confidence strictly based on verified real-world decisions.
   */
  public determineSampleSizeTier(realDecisionsCount: number): {
    tier: AgentSampleSizeTier;
    confidence: AgentConfidenceLevel;
    canBeTopPerformer: boolean;
  } {
    if (realDecisionsCount < 5) {
      return {
        tier: 'PILOT_SAMPLE',
        confidence: 'LOW',
        canBeTopPerformer: false,
      };
    }
    if (realDecisionsCount < 20) {
      return {
        tier: 'EARLY_EVIDENCE',
        confidence: 'MEDIUM',
        canBeTopPerformer: true,
      };
    }
    return {
      tier: 'ESTABLISHED',
      confidence: 'HIGH',
      canBeTopPerformer: true,
    };
  }

  /**
   * Logs an agent's metric prediction. Status is strictly PREDICTION_PENDING until resolved.
   * Pending predictions CANNOT count toward accuracy. (Invariant 10)
   */
  public recordPrediction(params: {
    decisionId: string;
    agentId: string;
    businessId: string;
    expectedConversionRate?: number;
    expectedCplINR?: number;
    expectedCacINR?: number;
    expectedRevenueINR?: number;
    expectedRoas?: number;
    confidence: number;
  }): PredictionRecord {
    const id = `pred-${randomUUID()}`;
    const now = new Date().toISOString();
    const status: PredictionStatus = 'PREDICTION_PENDING';

    this.db
      .prepare(
        `INSERT INTO predictions (
          id, decision_id, agent_id, business_id, status,
          expected_conversion_rate, expected_cpl_inr, expected_cac_inr,
          expected_revenue_inr, expected_roas, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.decisionId,
        params.agentId,
        params.businessId,
        status,
        params.expectedConversionRate ?? null,
        params.expectedCplINR ?? null,
        params.expectedCacINR ?? null,
        params.expectedRevenueINR ?? null,
        params.expectedRoas ?? null,
        params.confidence,
        now
      );

    // Ensure agent scorecard exists and update pending count
    const existing = this.db
      .prepare('SELECT agent_id FROM agent_scorecards WHERE agent_id = ?')
      .get(params.agentId);

    if (!existing) {
      const agent = this.db
        .prepare('SELECT name, category FROM agents WHERE id = ?')
        .get(params.agentId) as any;
      const agentName = agent?.name || params.agentId;
      const division = (agent?.category as AgentCategory) || 'MARKETING_GROWTH';
      const tierInfo = this.determineSampleSizeTier(0);

      this.db
        .prepare(
          `INSERT INTO agent_scorecards (
            agent_id, agent_name, division, test_decisions_count, real_decisions_count,
            pending_predictions_count, resolved_predictions_count,
            sample_size_tier, confidence_level, is_top_performer,
            accepted_recommendations, rejected_recommendations, successful_actions,
            failed_actions, average_prediction_accuracy_percent, real_revenue_influenced_inr,
            real_cost_influenced_inr, outcome_quality_score
          ) VALUES (?, ?, ?, 0, 0, 1, 0, ?, ?, 0, 0, 0, 0, 0, 0.0, 0, 0, 50.0)`
        )
        .run(params.agentId, agentName, division, tierInfo.tier, tierInfo.confidence);
    } else {
      this.db
        .prepare(
          `UPDATE agent_scorecards 
           SET pending_predictions_count = pending_predictions_count + 1, updated_at = datetime('now')
           WHERE agent_id = ?`
        )
        .run(params.agentId);
    }

    return {
      id,
      decisionId: params.decisionId,
      agentId: params.agentId,
      businessId: params.businessId,
      status,
      expectedConversionRate: params.expectedConversionRate,
      expectedCplINR: params.expectedCplINR,
      expectedCacINR: params.expectedCacINR,
      expectedRevenueINR: params.expectedRevenueINR,
      expectedRoas: params.expectedRoas,
      confidence: params.confidence,
      createdAt: now,
    };
  }

  /**
   * Evaluates a prediction against actual observed outcomes.
   * Only now does the prediction transition to RESOLVED and affect accuracy.
   */
  public resolvePrediction(
    id: string,
    actuals: {
      actualConversionRate?: number;
      actualCplINR?: number;
      actualCacINR?: number;
      actualRevenueINR?: number;
      actualRoas?: number;
    }
  ): PredictionRecord {
    const row = this.db.prepare('SELECT * FROM predictions WHERE id = ?').get(id) as any;
    if (!row) throw new Error(`Prediction ${id} not found`);

    const now = new Date().toISOString();

    // Calculate percentage error
    const errors: number[] = [];
    if (row.expected_conversion_rate !== null && actuals.actualConversionRate !== undefined) {
      const denom = Math.max(0.001, row.expected_conversion_rate);
      errors.push(Math.abs(actuals.actualConversionRate - row.expected_conversion_rate) / denom);
    }
    if (row.expected_cpl_inr !== null && actuals.actualCplINR !== undefined) {
      const denom = Math.max(1, row.expected_cpl_inr);
      errors.push(Math.abs(actuals.actualCplINR - row.expected_cpl_inr) / denom);
    }
    if (row.expected_revenue_inr !== null && actuals.actualRevenueINR !== undefined) {
      const denom = Math.max(1, row.expected_revenue_inr);
      errors.push(Math.abs(actuals.actualRevenueINR - row.expected_revenue_inr) / denom);
    }

    const meanError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;

    this.db
      .prepare(
        `UPDATE predictions SET
           status = 'RESOLVED',
           actual_conversion_rate = ?,
           actual_cpl_inr = ?,
           actual_cac_inr = ?,
           actual_revenue_inr = ?,
           actual_roas = ?,
           prediction_error = ?,
           evaluated_at = ?
         WHERE id = ?`
      )
      .run(
        actuals.actualConversionRate ?? null,
        actuals.actualCplINR ?? null,
        actuals.actualCacINR ?? null,
        actuals.actualRevenueINR ?? null,
        actuals.actualRoas ?? null,
        meanError,
        now,
        id
      );

    // Recalculate agent scorecard accuracy strictly using RESOLVED predictions
    this.recalculateAgentAccuracy(row.agent_id);

    return {
      id: row.id,
      decisionId: row.decision_id,
      agentId: row.agent_id,
      businessId: row.business_id,
      status: 'RESOLVED',
      expectedConversionRate: row.expected_conversion_rate,
      expectedCplINR: row.expected_cpl_inr,
      expectedCacINR: row.expected_cac_inr,
      expectedRevenueINR: row.expected_revenue_inr,
      expectedRoas: row.expected_roas,
      confidence: row.confidence,
      actualConversionRate: actuals.actualConversionRate,
      actualCplINR: actuals.actualCplINR,
      actualCacINR: actuals.actualCacINR,
      actualRevenueINR: actuals.actualRevenueINR,
      actualRoas: actuals.actualRoas,
      predictionError: meanError,
      evaluatedAt: now,
      createdAt: row.created_at,
    };
  }

  /**
   * Recalculates average prediction accuracy from RESOLVED predictions only.
   */
  private recalculateAgentAccuracy(agentId: string): void {
    const resolvedRows = this.db
      .prepare(
        "SELECT prediction_error FROM predictions WHERE agent_id = ? AND status = 'RESOLVED'"
      )
      .all(agentId) as any[];

    const pendingRow = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM predictions WHERE agent_id = ? AND status = 'PREDICTION_PENDING'"
      )
      .get(agentId) as any;

    const pendingCount = pendingRow?.count || 0;
    const resolvedCount = resolvedRows.length;

    let avgAccuracy = 0.0;
    if (resolvedCount > 0) {
      const sumAcc = resolvedRows.reduce((acc, r) => {
        const itemAcc = Math.max(0, Math.min(100, Math.round((1 - (r.prediction_error || 0)) * 100)));
        return acc + itemAcc;
      }, 0);
      avgAccuracy = Math.round((sumAcc / resolvedCount) * 10) / 10;
    }

    this.db
      .prepare(
        `UPDATE agent_scorecards SET
           average_prediction_accuracy_percent = ?,
           pending_predictions_count = ?,
           resolved_predictions_count = ?,
           updated_at = datetime('now')
         WHERE agent_id = ?`
      )
      .run(avgAccuracy, pendingCount, resolvedCount, agentId);
  }

  /**
   * Records an agent's tactical recommendation or execution outcome.
   */
  public recordAgentAction(
    agentId: string,
    agentName: string,
    division: AgentCategory,
    params: {
      isReal: boolean;
      wasAccepted?: boolean;
      wasSuccessful?: boolean;
      revenueInfluencedINR?: number;
      costInfluencedINR?: number;
    }
  ): void {
    const existing = this.db
      .prepare('SELECT * FROM agent_scorecards WHERE agent_id = ?')
      .get(agentId) as any;

    const testIncr = params.isReal ? 0 : 1;
    const realIncr = params.isReal ? 1 : 0;
    const accIncr = params.wasAccepted === true ? 1 : 0;
    const rejIncr = params.wasAccepted === false ? 1 : 0;
    const succIncr = params.wasSuccessful === true ? 1 : 0;
    const failIncr = params.wasSuccessful === false ? 1 : 0;
    const revIncr = params.revenueInfluencedINR || 0;
    const costIncr = params.costInfluencedINR || 0;

    const newTest = (existing?.test_decisions_count || 0) + testIncr;
    const newReal = (existing?.real_decisions_count || 0) + realIncr;
    const newAcc = (existing?.accepted_recommendations || 0) + accIncr;
    const newRej = (existing?.rejected_recommendations || 0) + rejIncr;
    const newSucc = (existing?.successful_actions || 0) + succIncr;
    const newFail = (existing?.failed_actions || 0) + failIncr;
    const newRev = (existing?.real_revenue_influenced_inr || 0) + revIncr;
    const newCost = (existing?.real_cost_influenced_inr || 0) + costIncr;

    const tierInfo = this.determineSampleSizeTier(newReal);
    const avgAcc = existing?.average_prediction_accuracy_percent || 0.0;

    const qualityScore = this.computeOutcomeScore({
      testDecisionsCount: newTest,
      realDecisionsCount: newReal,
      acceptedRecommendations: newAcc,
      rejectedRecommendations: newRej,
      successfulActions: newSucc,
      failedActions: newFail,
      averagePredictionAccuracyPercent: avgAcc,
    });

    const isTopPerformer = tierInfo.canBeTopPerformer && qualityScore >= 85 ? 1 : 0;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO agent_scorecards (
            agent_id, agent_name, division, test_decisions_count, real_decisions_count,
            pending_predictions_count, resolved_predictions_count,
            sample_size_tier, confidence_level, is_top_performer,
            accepted_recommendations, rejected_recommendations, successful_actions,
            failed_actions, average_prediction_accuracy_percent, real_revenue_influenced_inr,
            real_cost_influenced_inr, outcome_quality_score
          ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          agentId,
          agentName,
          division,
          newTest,
          newReal,
          tierInfo.tier,
          tierInfo.confidence,
          isTopPerformer,
          newAcc,
          newRej,
          newSucc,
          newFail,
          avgAcc,
          newRev,
          newCost,
          qualityScore
        );
    } else {
      this.db
        .prepare(
          `UPDATE agent_scorecards SET
             test_decisions_count = ?,
             real_decisions_count = ?,
             sample_size_tier = ?,
             confidence_level = ?,
             is_top_performer = ?,
             accepted_recommendations = ?,
             rejected_recommendations = ?,
             successful_actions = ?,
             failed_actions = ?,
             real_revenue_influenced_inr = ?,
             real_cost_influenced_inr = ?,
             outcome_quality_score = ?,
             updated_at = datetime('now')
           WHERE agent_id = ?`
        )
        .run(
          newTest,
          newReal,
          tierInfo.tier,
          tierInfo.confidence,
          isTopPerformer,
          newAcc,
          newRej,
          newSucc,
          newFail,
          newRev,
          newCost,
          qualityScore,
          agentId
        );
    }
  }

  private computeOutcomeScore(data: {
    testDecisionsCount: number;
    realDecisionsCount: number;
    acceptedRecommendations: number;
    rejectedRecommendations: number;
    successfulActions: number;
    failedActions: number;
    averagePredictionAccuracyPercent: number;
  }): number {
    let score = 50.0;
    const totalRecs = data.acceptedRecommendations + data.rejectedRecommendations;
    if (totalRecs > 0) {
      const acceptRate = data.acceptedRecommendations / totalRecs;
      score += (acceptRate - 0.5) * 20; // -10 to +10
    }

    const totalActs = data.successfulActions + data.failedActions;
    if (totalActs > 0) {
      const succRate = data.successfulActions / totalActs;
      score += (succRate - 0.5) * 20; // -10 to +10
    }

    // Only add accuracy bonus if there are evaluated predictions
    if (data.averagePredictionAccuracyPercent > 0) {
      score += (data.averagePredictionAccuracyPercent / 100 - 0.5) * 20; // -10 to +10
    }

    // Reward genuine real decisions
    if (data.realDecisionsCount > 0) {
      score += Math.min(10, data.realDecisionsCount * 2);
    }

    return Math.max(10, Math.min(99, Math.round(score * 10) / 10));
  }

  /**
   * Retrieves an agent's scorecard.
   */
  public getScorecard(agentId: string): AgentScorecardRecord | null {
    const row = this.db
      .prepare('SELECT * FROM agent_scorecards WHERE agent_id = ?')
      .get(agentId) as any;
    if (!row) return null;

    return {
      agentId: row.agent_id,
      agentName: row.agent_name,
      division: row.division as AgentCategory,
      testDecisionsCount: row.test_decisions_count,
      realDecisionsCount: row.real_decisions_count,
      pendingPredictionsCount: row.pending_predictions_count || 0,
      resolvedPredictionsCount: row.resolved_predictions_count || 0,
      sampleSizeTier: (row.sample_size_tier as AgentSampleSizeTier) || 'PILOT_SAMPLE',
      confidenceLevel: (row.confidence_level as AgentConfidenceLevel) || 'LOW',
      isTopPerformer: row.is_top_performer === 1,
      acceptedRecommendations: row.accepted_recommendations,
      rejectedRecommendations: row.rejected_recommendations,
      successfulActions: row.successful_actions,
      failedActions: row.failed_actions,
      averagePredictionAccuracyPercent: row.average_prediction_accuracy_percent,
      realRevenueInfluencedINR: row.real_revenue_influenced_inr,
      realCostInfluencedINR: row.real_cost_influenced_inr,
      outcomeQualityScore: row.outcome_quality_score,
    };
  }

  /**
   * Lists all agent scorecards.
   */
  public listScorecards(): AgentScorecardRecord[] {
    let rows = this.db
      .prepare('SELECT * FROM agent_scorecards ORDER BY outcome_quality_score DESC')
      .all() as any[];

    if (rows.length === 0) {
      // Seed core agents with 1 real decision (PILOT_SAMPLE, confidence LOW)
      this.recordAgentAction('agt_growth_lead_01', 'Growth Marketing Lead', 'MARKETING_GROWTH', {
        isReal: true,
        wasAccepted: true,
        wasSuccessful: true,
      });
      this.recordAgentAction('agt_cro_01', 'CRO Specialist', 'MARKETING_GROWTH', {
        isReal: true,
        wasAccepted: true,
        wasSuccessful: true,
      });
      this.recordAgentAction('agt_paid_search_01', 'Paid Search Specialist', 'MARKETING_GROWTH', {
        isReal: true,
        wasAccepted: true,
        wasSuccessful: true,
      });
      this.recordAgentAction('agt_rev_ops_01', 'Revenue Operations Analyst', 'ANALYTICS_LEARNING', {
        isReal: true,
        wasAccepted: true,
        wasSuccessful: true,
      });

      rows = this.db
        .prepare('SELECT * FROM agent_scorecards ORDER BY outcome_quality_score DESC')
        .all() as any[];
    }

    return rows.map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name,
      division: row.division as AgentCategory,
      testDecisionsCount: row.test_decisions_count,
      realDecisionsCount: row.real_decisions_count,
      pendingPredictionsCount: row.pending_predictions_count || 0,
      resolvedPredictionsCount: row.resolved_predictions_count || 0,
      sampleSizeTier: (row.sample_size_tier as AgentSampleSizeTier) || 'PILOT_SAMPLE',
      confidenceLevel: (row.confidence_level as AgentConfidenceLevel) || 'LOW',
      isTopPerformer: row.is_top_performer === 1,
      acceptedRecommendations: row.accepted_recommendations,
      rejectedRecommendations: row.rejected_recommendations,
      successfulActions: row.successful_actions,
      failedActions: row.failed_actions,
      averagePredictionAccuracyPercent: row.average_prediction_accuracy_percent,
      realRevenueInfluencedINR: row.real_revenue_influenced_inr,
      realCostInfluencedINR: row.real_cost_influenced_inr,
      outcomeQualityScore: row.outcome_quality_score,
    }));
  }
}
