/**
 * OpportunityEngine — discovers, qualifies, and tracks revenue opportunities.
 *
 * Every opportunity MUST have real-world evidence:
 *   - Tavily search results with URLs
 *   - Inbound leads from real visitors
 *   - Referral signals from existing customers
 *   - GBP/local discovery via search API
 *
 * No synthetic opportunities. No fabricated evidence. Status lifecycle:
 *   DISCOVERED → QUALIFIED → ENGAGING → CONVERTING → WON | LOST | IGNORED
 */

import { getDb } from '../db/client.js';
import { DurableEventBus } from './durable-event-bus.js';

export type OpportunitySource =
  | 'ORGANIC_SEARCH'
  | 'SOCIAL'
  | 'REFERRAL'
  | 'LOCAL_PARTNERSHIP'
  | 'COMPETITOR_GAP'
  | 'INBOUND'
  | 'OUTBOUND_PROSPECT';

export type OpportunityStatus =
  | 'DISCOVERED'
  | 'QUALIFIED'
  | 'ENGAGING'
  | 'CONVERTING'
  | 'WON'
  | 'LOST'
  | 'IGNORED';

export interface OpportunityEvidence {
  type: 'TAVILY_RESULT' | 'INBOUND_LEAD' | 'REFERRAL' | 'GBP_DATA' | 'CUSTOMER_SIGNAL';
  url?: string;
  title?: string;
  snippet?: string;
  retrievedAt: string;
}

export interface CreateOpportunityInput {
  businessId: string;
  organizationId: string;
  source: OpportunitySource;
  /** Must contain at least one real-world evidence item */
  evidence: OpportunityEvidence[];
  estimatedValueINR: number;
  probability: number; // 0-1
  acquisitionCostINR: number;
  timeToRevenueDays: number;
  authorizationRequirements: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  nextBestAction: string;
}

export interface Opportunity {
  id: string;
  businessId: string;
  organizationId: string;
  source: OpportunitySource;
  evidence: OpportunityEvidence[];
  estimatedValueINR: number;
  probability: number;
  acquisitionCostINR: number;
  timeToRevenueDays: number;
  authorizationRequirements: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  nextBestAction: string;
  status: OpportunityStatus;
  /** expectedRevenueINR = estimatedValueINR × probability */
  expectedRevenueINR: number;
  createdAt: string;
  updatedAt: string;
}

export class OpportunityEngine {
  private static instance: OpportunityEngine;

  public static getInstance(): OpportunityEngine {
    if (!OpportunityEngine.instance) {
      OpportunityEngine.instance = new OpportunityEngine();
    }
    return OpportunityEngine.instance;
  }

  /**
   * Discover a new opportunity. Requires at least one piece of real-world evidence.
   * Emits NEW_OPPORTUNITY event to the durable event bus.
   */
  public discover(input: CreateOpportunityInput): Opportunity {
    if (input.evidence.length === 0) {
      throw new Error(
        '[OpportunityEngine] REJECTED: Cannot create opportunity without real-world evidence. ' +
        'Provide at least one Tavily result, inbound lead signal, or verified referral.'
      );
    }
    if (input.estimatedValueINR < 0 || input.probability < 0 || input.probability > 1) {
      throw new Error('[OpportunityEngine] Invalid estimatedValueINR or probability range.');
    }

    const db = getDb();
    const id = `opp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO opportunities (
        id, business_id, organization_id, source, evidence_json,
        estimated_value_inr, probability, acquisition_cost_inr, time_to_revenue_days,
        authorization_requirements_json, risk_level, next_best_action, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISCOVERED', ?, ?)
    `).run(
      id,
      input.businessId,
      input.organizationId,
      input.source,
      JSON.stringify(input.evidence),
      input.estimatedValueINR,
      input.probability,
      input.acquisitionCostINR,
      input.timeToRevenueDays,
      JSON.stringify(input.authorizationRequirements),
      input.riskLevel,
      input.nextBestAction,
      now,
      now
    );

    const opp = this.getById(id)!;

    // Emit event so orchestrator can react immediately
    DurableEventBus.emit({
      eventType: 'NEW_OPPORTUNITY',
      organizationId: input.organizationId,
      businessId: input.businessId,
      payload: { opportunityId: id, source: input.source, expectedRevenueINR: opp.expectedRevenueINR }
    });

    console.log(`[OpportunityEngine] Discovered: ${id} | source=${input.source} | expected=₹${opp.expectedRevenueINR.toFixed(0)}`);
    return opp;
  }

  /**
   * Advance an opportunity's status through the lifecycle.
   * Each transition emits a durable event.
   */
  public advance(opportunityId: string, toStatus: OpportunityStatus, reason?: string): void {
    const db = getDb();
    const opp = this.getById(opportunityId);
    if (!opp) throw new Error(`[OpportunityEngine] Opportunity not found: ${opportunityId}`);

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE opportunities SET status = ?, next_best_action = ?, updated_at = ?
      WHERE id = ?
    `).run(toStatus, reason || opp.nextBestAction, now, opportunityId);

    DurableEventBus.emit({
      eventType: 'OPPORTUNITY_STATUS_CHANGED',
      organizationId: opp.organizationId,
      businessId: opp.businessId,
      payload: { opportunityId, fromStatus: opp.status, toStatus, reason }
    });

    if (toStatus === 'WON') {
      DurableEventBus.emit({
        eventType: 'OPPORTUNITY_WON',
        organizationId: opp.organizationId,
        businessId: opp.businessId,
        payload: { opportunityId, expectedRevenueINR: opp.expectedRevenueINR }
      });
    }
  }

  /**
   * Score opportunities by expected value per day:
   *   score = (estimatedValueINR × probability) / timeToRevenueDays
   * Used by NextBestActionEngine to pick the highest-value authorized action.
   */
  public scoreAndRank(businessId: string): Opportunity[] {
    const active = this.listByBusiness(businessId, ['DISCOVERED', 'QUALIFIED', 'ENGAGING', 'CONVERTING']);
    return active.sort((a, b) => {
      const scoreA = (a.estimatedValueINR * a.probability) / Math.max(1, a.timeToRevenueDays);
      const scoreB = (b.estimatedValueINR * b.probability) / Math.max(1, b.timeToRevenueDays);
      return scoreB - scoreA;
    });
  }

  public listByBusiness(businessId: string, statuses?: OpportunityStatus[]): Opportunity[] {
    const db = getDb();
    let rows: any[];
    if (statuses && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(', ');
      rows = db.prepare(
        `SELECT * FROM opportunities WHERE business_id = ? AND status IN (${placeholders}) ORDER BY created_at DESC`
      ).all(businessId, ...statuses) as any[];
    } else {
      rows = db.prepare(
        `SELECT * FROM opportunities WHERE business_id = ? ORDER BY created_at DESC`
      ).all(businessId) as any[];
    }
    return rows.map(this.mapRow);
  }

  public getById(id: string): Opportunity | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: any): Opportunity {
    return {
      id: row.id,
      businessId: row.business_id,
      organizationId: row.organization_id,
      source: row.source as OpportunitySource,
      evidence: JSON.parse(row.evidence_json || '[]'),
      estimatedValueINR: row.estimated_value_inr,
      probability: row.probability,
      acquisitionCostINR: row.acquisition_cost_inr,
      timeToRevenueDays: row.time_to_revenue_days,
      authorizationRequirements: JSON.parse(row.authorization_requirements_json || '[]'),
      riskLevel: row.risk_level,
      nextBestAction: row.next_best_action || '',
      status: row.status as OpportunityStatus,
      expectedRevenueINR: row.estimated_value_inr * row.probability,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
