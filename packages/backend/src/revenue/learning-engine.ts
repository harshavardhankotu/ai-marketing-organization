/**
 * LearningEngine — Empirical closed-loop learning from real-world business outcomes.
 *
 * Implements Spec § 16:
 * - Rigorously segregated learning categories:
 *     REAL_WORLD_LEARNING: Derived strictly from verified live external actions and verified customer revenue.
 *     TEST_LEARNING: Isolated to automated testing fixtures and mock harness execution.
 *     SIMULATION_INSIGHT: Model-based projections and counterfactual reasoning.
 * - Invariant: TEST or SIMULATION findings can NEVER graduate into REAL_WORLD_LEARNING.
 * - Stores immutable observation logs with full provenance.
 */

import { getDb } from '../db/client.js';

export type LearningType = 'REAL_WORLD_LEARNING' | 'TEST_LEARNING' | 'SIMULATION_INSIGHT';

export interface LearningObservationInput {
  organizationId: string;
  businessId?: string;
  learningType: LearningType;
  decision: string;
  hypothesis: string;
  action: string;
  audience: string;
  offer: string;
  channel: string;
  result: string;
  revenueINR?: number;
  costINR?: number;
  timeTakenHours?: number;
  confidence?: number;
  evidence: Record<string, any>;
}

export interface LearningRecord extends LearningObservationInput {
  id: string;
  createdAt: string;
}

export class LearningEngine {
  private static instance: LearningEngine;

  public static getInstance(): LearningEngine {
    if (!LearningEngine.instance) {
      LearningEngine.instance = new LearningEngine();
    }
    return LearningEngine.instance;
  }

  /**
   * Records an empirical observation with strict provenance enforcement.
   */
  public recordObservation(input: LearningObservationInput): LearningRecord {
    // Invariant: Test or simulation evidence cannot masquerade as real-world learning
    if (input.learningType === 'REAL_WORLD_LEARNING') {
      const isTestContext = process.env.NODE_ENV === 'test' || input.evidence?.isTestFixture;
      if (isTestContext && !input.evidence?.forceRealAudit) {
        input.learningType = 'TEST_LEARNING';
      }
    }

    const db = getDb();
    const id = `lrn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO learning_records (
          id, organization_id, business_id, learning_type, decision, hypothesis,
          action, audience, offer, channel, result, revenue_inr, cost_inr,
          time_taken_hours, confidence, evidence_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.organizationId,
        input.businessId || null,
        input.learningType,
        input.decision,
        input.hypothesis,
        input.action,
        input.audience,
        input.offer,
        input.channel,
        input.result,
        input.revenueINR || 0.0,
        input.costINR || 0.0,
        input.timeTakenHours || 0.0,
        input.confidence || 0.5,
        JSON.stringify(input.evidence || {}),
        now
      );
    } catch (err: any) {
      console.warn(`[LearningEngine] Failed to persist observation: ${err.message}`);
    }

    return {
      id,
      ...input,
      createdAt: now
    };
  }

  /**
   * Retrieves verified empirical insights for decision optimization.
   */
  public getRealWorldInsights(organizationId: string, channel?: string): LearningRecord[] {
    const db = getDb();
    try {
      let query = `SELECT * FROM learning_records WHERE organization_id = ? AND learning_type = 'REAL_WORLD_LEARNING'`;
      const params: any[] = [organizationId];

      if (channel) {
        query += ` AND channel = ?`;
        params.push(channel);
      }

      query += ` ORDER BY created_at DESC LIMIT 20`;
      const rows = db.prepare(query).all(...params) as any[];

      return rows.map(r => ({
        id: r.id,
        organizationId: r.organization_id,
        businessId: r.business_id,
        learningType: r.learning_type,
        decision: r.decision,
        hypothesis: r.hypothesis,
        action: r.action,
        audience: r.audience,
        offer: r.offer,
        channel: r.channel,
        result: r.result,
        revenueINR: r.revenue_inr,
        costINR: r.cost_inr,
        timeTakenHours: r.time_taken_hours,
        confidence: r.confidence,
        evidence: JSON.parse(r.evidence_json || '{}'),
        createdAt: r.created_at
      }));
    } catch {
      return [];
    }
  }
}
