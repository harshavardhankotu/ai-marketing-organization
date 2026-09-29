/**
 * LearningEngine — Empirical closed-loop learning from real-world business outcomes.
 *
 * Implements Spec § 16 & § 28:
 * - Rigorously segregated learning categories:
 *     REAL_WORLD_LEARNING: Derived strictly from verified live external actions and verified customer revenue.
 *     TEST_LEARNING: Isolated to automated testing fixtures and mock harness execution.
 *     SIMULATION_INSIGHT: Model-based projections and counterfactual reasoning.
 * - Invariant: TEST or SIMULATION findings can NEVER graduate into REAL_WORLD_LEARNING.
 * - Stores immutable observation logs with full provenance in D1 (production) and SQLite (dev/test).
 * - Zero getDb() import in this production path.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';
import { randomUUID } from 'crypto';

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
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): LearningEngine {
    if (!LearningEngine.instance) {
      LearningEngine.instance = new LearningEngine();
    }
    return LearningEngine.instance;
  }

  /**
   * Records a business observation with strict learning category validation.
   */
  public recordObservation(input: LearningObservationInput): LearningRecord {
    const id = `lrn_${Date.now()}_${randomUUID().substring(0, 6)}`;
    const now = new Date().toISOString();

    let learningType = input.learningType;

    // Invariant: REAL_WORLD_LEARNING must strictly cite BOTH:
    // a) A confirmed action in outbound_action_ledger (with status SENT or DELIVERED)
    // b) An authoritative transaction ID in revenue_records / D1
    // Any observation that lacks either must be demoted to TEST_LEARNING or SIMULATION_INSIGHT.
    // No test or simulated outcome may ever be classified as REAL_WORLD_LEARNING.
    if (learningType === 'REAL_WORLD_LEARNING') {
      const actionRef =
        input.evidence?.outboundActionId ||
        input.evidence?.actionLedgerId ||
        input.evidence?.externalActionId ||
        input.evidence?.actionId ||
        input.evidence?.ledgerId;

      const txRef =
        input.evidence?.transactionId ||
        input.evidence?.revenueRecordId ||
        input.evidence?.paymentId ||
        input.evidence?.providerTransactionId;

      let hasConfirmedAction = false;
      let hasAuthoritativeRevenue = false;

      if (actionRef) {
        try {
          const actionRow = this.d1Repo.queryOneSync<{ id: string; status: string }>(
            'outbound_action_ledger',
            `SELECT id, status FROM outbound_action_ledger
             WHERE (id = ? OR provider_external_id = ?)
               AND status IN ('SENT', 'DELIVERED')
             LIMIT 1`,
            [actionRef, actionRef]
          );
          if (actionRow) {
            hasConfirmedAction = true;
          }
        } catch {}
      }

      if (txRef) {
        try {
          const revRow = this.d1Repo.queryOneSync<{ id: string; verified: number }>(
            'revenue_records',
            `SELECT id, verified FROM revenue_records
             WHERE (id = ? OR transaction_id = ?)
               AND (verified = 1 OR classification = 'REAL')
             LIMIT 1`,
            [txRef, txRef]
          );
          if (revRow) {
            hasAuthoritativeRevenue = true;
          }
        } catch {}
      }

      if (!hasConfirmedAction || !hasAuthoritativeRevenue) {
        const isSimulation = Boolean(
          input.evidence?.simulation ||
          input.evidence?.isSimulation ||
          input.action?.toLowerCase().includes('simulat') ||
          input.hypothesis?.toLowerCase().includes('simulat')
        );
        learningType = isSimulation ? 'SIMULATION_INSIGHT' : 'TEST_LEARNING';
        console.warn(`[LearningEngine] Demoting observation ${id} to ${learningType}: missing confirmed outbound action (${hasConfirmedAction ? 'CONFIRMED' : 'MISSING'}) or authoritative revenue (${hasAuthoritativeRevenue ? 'CONFIRMED' : 'MISSING'}).`);
      }
    }

    const sql = `
      INSERT INTO learning_records (
        id, organization_id, business_id, learning_type,
        decision, hypothesis, action, audience, offer, channel,
        result, revenue_inr, cost_inr, time_taken_hours, confidence,
        evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      input.organizationId,
      input.businessId || null,
      learningType,
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
    ];

    if (isProduction()) {
      this.d1Repo.executeWrite('learning_records', sql, params).catch(err => {
        console.error(`[LearningEngine] D1 write failed: ${err.message}`);
      });
    } else {
      try {
        this.d1Repo.executeSync(
          'organizations',
          `INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (?, 'Platform Org', 'platform-org', datetime('now'))`,
          [input.organizationId]
        );
        this.d1Repo.executeSync('learning_records', sql, params);
      } catch (err: any) {
        console.warn(`[LearningEngine] Failed to persist observation in SQLite: ${err.message}`);
      }
    }

    return {
      id,
      ...input,
      learningType,
      createdAt: now
    };
  }

  /**
   * Asynchronously records a business observation with full D1 provenance checks.
   */
  public async recordObservationAsync(input: LearningObservationInput): Promise<LearningRecord> {
    const id = `lrn_${Date.now()}_${randomUUID().substring(0, 6)}`;
    const now = new Date().toISOString();

    let learningType = input.learningType;

    if (learningType === 'REAL_WORLD_LEARNING') {
      const actionRef =
        input.evidence?.outboundActionId ||
        input.evidence?.actionLedgerId ||
        input.evidence?.externalActionId ||
        input.evidence?.actionId ||
        input.evidence?.ledgerId;

      const txRef =
        input.evidence?.transactionId ||
        input.evidence?.revenueRecordId ||
        input.evidence?.paymentId ||
        input.evidence?.providerTransactionId;

      let hasConfirmedAction = false;
      let hasAuthoritativeRevenue = false;

      if (actionRef) {
        try {
          const actionRow = await this.d1Repo.queryOne<{ id: string; status: string }>(
            'outbound_action_ledger',
            `SELECT id, status FROM outbound_action_ledger
             WHERE (id = ? OR provider_external_id = ?)
               AND status IN ('SENT', 'DELIVERED')
             LIMIT 1`,
            [actionRef, actionRef]
          );
          if (actionRow) {
            hasConfirmedAction = true;
          }
        } catch {}
      }

      if (txRef) {
        try {
          const revRow = await this.d1Repo.queryOne<{ id: string; verified: number }>(
            'revenue_records',
            `SELECT id, verified FROM revenue_records
             WHERE (id = ? OR transaction_id = ?)
               AND (verified = 1 OR classification = 'REAL')
             LIMIT 1`,
            [txRef, txRef]
          );
          if (revRow) {
            hasAuthoritativeRevenue = true;
          }
        } catch {}
      }

      if (!hasConfirmedAction || !hasAuthoritativeRevenue) {
        const isSimulation = Boolean(
          input.evidence?.simulation ||
          input.evidence?.isSimulation ||
          input.action?.toLowerCase().includes('simulat') ||
          input.hypothesis?.toLowerCase().includes('simulat')
        );
        learningType = isSimulation ? 'SIMULATION_INSIGHT' : 'TEST_LEARNING';
        console.warn(`[LearningEngine] Demoting observation ${id} to ${learningType}: missing confirmed outbound action (${hasConfirmedAction ? 'CONFIRMED' : 'MISSING'}) or authoritative revenue (${hasAuthoritativeRevenue ? 'CONFIRMED' : 'MISSING'}).`);
      }
    }

    const sql = `
      INSERT INTO learning_records (
        id, organization_id, business_id, learning_type,
        decision, hypothesis, action, audience, offer, channel,
        result, revenue_inr, cost_inr, time_taken_hours, confidence,
        evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      id,
      input.organizationId,
      input.businessId || null,
      learningType,
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
    ];

    if (isProduction()) {
      await this.d1Repo.executeWrite('learning_records', sql, params);
    } else {
      try {
        await this.d1Repo.executeWrite(
          'organizations',
          `INSERT OR IGNORE INTO organizations (id, name, slug, created_at) VALUES (?, 'Platform Org', 'platform-org', datetime('now'))`,
          [input.organizationId]
        );
        this.d1Repo.executeSync('learning_records', sql, params);
      } catch (err: any) {
        console.warn(`[LearningEngine] Failed to persist observation in SQLite: ${err.message}`);
      }
    }

    return {
      id,
      ...input,
      learningType,
      createdAt: now
    };
  }

  /**
   * Retrieves verified empirical insights for decision optimization.
   */
  public getRealWorldInsights(organizationId: string, channel?: string): LearningRecord[] {
    let query = `SELECT * FROM learning_records WHERE organization_id = ? AND learning_type = 'REAL_WORLD_LEARNING'`;
    const params: any[] = [organizationId];

    if (channel) {
      query += ` AND channel = ?`;
      params.push(channel);
    }

    query += ` ORDER BY created_at DESC LIMIT 20`;

    try {
      const rows = this.d1Repo.querySync<any>('learning_records', query, params);

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

  public async getRealWorldInsightsAsync(organizationId: string, channel?: string): Promise<LearningRecord[]> {
    let query = `SELECT * FROM learning_records WHERE organization_id = ? AND learning_type = 'REAL_WORLD_LEARNING'`;
    const params: any[] = [organizationId];

    if (channel) {
      query += ` AND channel = ?`;
      params.push(channel);
    }

    query += ` ORDER BY created_at DESC LIMIT 20`;

    try {
      const rows = await this.d1Repo.query<any>('learning_records', query, params);

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
