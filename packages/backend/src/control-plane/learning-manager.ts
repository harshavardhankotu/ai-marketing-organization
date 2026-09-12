import { getDb } from '../db/client.js';
import { LearningClassification } from '@ai-marketing/shared';

export interface CreateLearningInput {
  organizationId: string;
  businessId: string;
  sourceExperimentId?: string;
  observation: string;
  hypothesis: string;
  experimentResult: string;
  learning: string;
  policyUpdate: string;
  confidence: number;
  dataClassification?: LearningClassification;
}

export class LearningManager {
  public static recordLearning(input: CreateLearningInput): string {
    const db = getDb();
    const id = `lrn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const classification: LearningClassification = input.dataClassification || 'TEST_LEARNING';

    // Fetch latest strategy version for business
    const latestStrategy = db.prepare(`
      SELECT version FROM strategies
      WHERE business_id = ?
      ORDER BY version DESC LIMIT 1
    `).get(input.businessId) as { version: number } | undefined;

    const currentVersion = latestStrategy?.version || 1;

    db.prepare(`
      INSERT INTO learnings (
        id, organization_id, business_id, source_experiment_id,
        observation, hypothesis, experiment_result, learning,
        policy_update, confidence, applied_to_strategy_version, data_classification, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      input.organizationId,
      input.businessId,
      input.sourceExperimentId || null,
      input.observation,
      input.hypothesis,
      input.experimentResult,
      input.learning,
      input.policyUpdate,
      input.confidence,
      currentVersion + 1,
      classification
    );

    return id;
  }

  /**
   * Evolve Strategy:
   * Creates a new version (v2, v3...) incorporating learnings.
   * Only REAL_WORLD_LEARNING can mutate the active production strategy.
   * TEST_LEARNING generates isolated TEST strategies without superseding the active baseline.
   */
  public static evolveStrategy(
    orgId: string,
    businessId: string,
    goalId: string,
    rationale: string,
    channelUpdates: any[],
    newThemes: string[],
    dataClassification: LearningClassification = 'REAL_WORLD_LEARNING'
  ): { strategyId: string; newVersion: number; status: string; dataClassification: LearningClassification } {
    const db = getDb();

    return db.transaction(() => {
      // 1. Get latest version
      const current = db.prepare(`
        SELECT * FROM strategies WHERE business_id = ? ORDER BY version DESC LIMIT 1
      `).get(businessId) as any;

      const newVersion = current ? current.version + 1 : 1;
      const newStrategyId = `strat_v${newVersion}_${businessId}`;
      const isReal = dataClassification === 'REAL_WORLD_LEARNING';
      const strategyStatus = isReal ? 'ACTIVE' : 'TEST';
      const title = isReal
        ? `Evolved Growth Strategy v${newVersion}`
        : `[SANDBOX TEST] Evolved Strategy Candidate v${newVersion}`;

      // 2. Mark previous version SUPERSEDED ONLY if this is real-world learning
      if (current && isReal) {
        db.prepare("UPDATE strategies SET status = 'SUPERSEDED' WHERE id = ?").run(current.id);
      }

      // 3. Insert new strategy version
      db.prepare(`
        INSERT INTO strategies (
          id, organization_id, business_id, goal_id, version, title,
          rationale, positioning, target_audience_json, channel_strategy_json,
          content_themes_json, expected_leads, expected_cpql_inr, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        newStrategyId,
        orgId,
        businessId,
        goalId,
        newVersion,
        title,
        rationale,
        current?.positioning || 'Precision Localized Patient Acquisition',
        current?.target_audience_json || '[]',
        JSON.stringify(channelUpdates),
        JSON.stringify(newThemes),
        Math.round((current?.expected_leads || 100) * 1.2),
        Math.round((current?.expected_cpql_inr || 600) * 0.85),
        strategyStatus
      );

      // 4. Record Decision in Decision Journal
      db.prepare(`
        INSERT INTO decisions (
          id, organization_id, business_id, strategy_id, agent_id,
          decision, reason, evidence, source, confidence,
          expected_outcome, actual_outcome, outcome_evaluation, created_at
        ) VALUES (?, ?, ?, ?, 'mkt-01', ?, ?, ?, ?, ?, ?, NULL, 'PENDING', datetime('now'))
      `).run(
        `dec_${Date.now()}`,
        orgId,
        businessId,
        newStrategyId,
        `${isReal ? 'Upgrade to' : 'Evaluate Sandbox'} Marketing Strategy v${newVersion}`,
        rationale,
        isReal
          ? 'Empirical uplift verified from verified REAL revenue transactions'
          : 'Sandbox experiment simulation (TEST classification)',
        'Analytics & Attribution Engine',
        isReal ? 0.95 : 0.75,
        '+20% qualified leads and -15% CPQL reduction in next campaign cycle'
      );

      return {
        strategyId: newStrategyId,
        newVersion,
        status: strategyStatus,
        dataClassification
      };
    })();
  }
}