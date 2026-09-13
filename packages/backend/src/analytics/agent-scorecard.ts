import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { AgentCategory, AgentScorecardRecord, PredictionRecord } from '@ai-marketing/shared';

export class AgentScorecardEngine {
  private get db() {
    return getDb();
  }

  /**
   * Logs an agent's metric prediction for a specific campaign or tactical decision.
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

    this.db
      .prepare(
        `INSERT INTO predictions (
          id, decision_id, agent_id, business_id,
          expected_conversion_rate, expected_cpl_inr, expected_cac_inr,
          expected_revenue_inr, expected_roas, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.decisionId,
        params.agentId,
        params.businessId,
        params.expectedConversionRate || null,
        params.expectedCplINR || null,
        params.expectedCacINR || null,
        params.expectedRevenueINR || null,
        params.expectedRoas || null,
        params.confidence,
        now
      );

    return {
      id,
      decisionId: params.decisionId,
      agentId: params.agentId,
      businessId: params.businessId,
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

    // Calculate absolute percentage error where comparable
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
    const accuracyScorePercent = Math.max(0, Math.min(100, Math.round((1 - meanError) * 100)));

    this.db
      .prepare(
        `UPDATE predictions SET
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
        actuals.actualConversionRate || null,
        actuals.actualCplINR || null,
        actuals.actualCacINR || null,
        actuals.actualRevenueINR || null,
        actuals.actualRoas || null,
        meanError,
        now,
        id
      );

    // Update agent scorecard accuracy
    this.updateAgentAccuracy(row.agent_id, accuracyScorePercent);

    return {
      id: row.id,
      decisionId: row.decision_id,
      agentId: row.agent_id,
      businessId: row.business_id,
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

    if (!existing) {
      const qualityScore = this.computeOutcomeScore({
        testDecisionsCount: testIncr,
        realDecisionsCount: realIncr,
        acceptedRecommendations: accIncr,
        rejectedRecommendations: rejIncr,
        successfulActions: succIncr,
        failedActions: failIncr,
        averagePredictionAccuracyPercent: 80.0,
      });

      this.db
        .prepare(
          `INSERT INTO agent_scorecards (
            agent_id, agent_name, division, test_decisions_count, real_decisions_count,
            accepted_recommendations, rejected_recommendations, successful_actions,
            failed_actions, average_prediction_accuracy_percent, real_revenue_influenced_inr,
            real_cost_influenced_inr, outcome_quality_score
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 80.0, ?, ?, ?)`
        )
        .run(
          agentId,
          agentName,
          division,
          testIncr,
          realIncr,
          accIncr,
          rejIncr,
          succIncr,
          failIncr,
          revIncr,
          costIncr,
          qualityScore
        );
    } else {
      const newTest = existing.test_decisions_count + testIncr;
      const newReal = existing.real_decisions_count + realIncr;
      const newAcc = existing.accepted_recommendations + accIncr;
      const newRej = existing.rejected_recommendations + rejIncr;
      const newSucc = existing.successful_actions + succIncr;
      const newFail = existing.failed_actions + failIncr;
      const newRev = existing.real_revenue_influenced_inr + revIncr;
      const newCost = existing.real_cost_influenced_inr + costIncr;

      const qualityScore = this.computeOutcomeScore({
        testDecisionsCount: newTest,
        realDecisionsCount: newReal,
        acceptedRecommendations: newAcc,
        rejectedRecommendations: newRej,
        successfulActions: newSucc,
        failedActions: newFail,
        averagePredictionAccuracyPercent: existing.average_prediction_accuracy_percent,
      });

      this.db
        .prepare(
          `UPDATE agent_scorecards SET
             test_decisions_count = ?,
             real_decisions_count = ?,
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

  private updateAgentAccuracy(agentId: string, newAccuracy: number): void {
    const existing = this.db
      .prepare('SELECT average_prediction_accuracy_percent FROM agent_scorecards WHERE agent_id = ?')
      .get(agentId) as any;
    if (existing) {
      const updatedAcc = Math.round((existing.average_prediction_accuracy_percent + newAccuracy) / 2);
      this.db
        .prepare(
          'UPDATE agent_scorecards SET average_prediction_accuracy_percent = ?, updated_at = datetime("now") WHERE agent_id = ?'
        )
        .run(updatedAcc, agentId);
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

    score += (data.averagePredictionAccuracyPercent / 100 - 0.5) * 20; // -10 to +10

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
   * Lists all agent scorecards. If empty, seeds initial baseline agents.
   */
  public listScorecards(): AgentScorecardRecord[] {
    let rows = this.db
      .prepare('SELECT * FROM agent_scorecards ORDER BY outcome_quality_score DESC')
      .all() as any[];

    if (rows.length === 0) {
      // Seed core agents
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
