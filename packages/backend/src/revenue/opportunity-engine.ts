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
  | 'IGNORED'
  | 'REJECTED';

export type OpportunityLane =
  | 'LANE_A_AFFILIATE_COMMERCE'
  | 'LANE_B_B2B_SERVICES'
  | 'LANE_C_AUTHORIZED_PARTNERSHIPS'
  | 'LANE_D_DIGITAL_PRODUCTS';

export type ArosLifecycleState =
  | 'DISCOVERED'
  | 'RESEARCHED'
  | 'VERIFIED'
  | 'QUALIFIED'
  | 'OFFER_READY'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'ENGAGED'
  | 'CONVERTED'
  | 'FULFILLED'
  | 'RECONCILED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUSPENDED';

export const OPPORTUNITY_LIFECYCLE_TRANSITIONS: Record<ArosLifecycleState, ArosLifecycleState[]> = {
  DISCOVERED: ['RESEARCHED', 'REJECTED', 'EXPIRED'],
  RESEARCHED: ['VERIFIED', 'REJECTED', 'EXPIRED'],
  VERIFIED: ['QUALIFIED', 'REJECTED', 'EXPIRED'],
  QUALIFIED: ['OFFER_READY', 'REJECTED', 'EXPIRED', 'SUSPENDED'],
  OFFER_READY: ['APPROVED', 'REJECTED', 'EXPIRED', 'SUSPENDED'],
  APPROVED: ['PUBLISHED', 'REJECTED', 'SUSPENDED'],
  PUBLISHED: ['ENGAGED', 'EXPIRED', 'SUSPENDED', 'REJECTED'],
  ENGAGED: ['CONVERTED', 'EXPIRED', 'SUSPENDED', 'REJECTED'],
  CONVERTED: ['FULFILLED', 'REJECTED', 'SUSPENDED'],
  FULFILLED: ['RECONCILED', 'REJECTED'],
  RECONCILED: [],
  REJECTED: [],
  EXPIRED: ['RESEARCHED', 'DISCOVERED'],
  SUSPENDED: ['QUALIFIED', 'OFFER_READY', 'PUBLISHED', 'REJECTED']
};

export function canTransitionOpportunityLifecycle(
  fromState: ArosLifecycleState,
  toState: ArosLifecycleState
): boolean {
  const allowed = OPPORTUNITY_LIFECYCLE_TRANSITIONS[fromState];
  return Array.isArray(allowed) && allowed.includes(toState);
}

export interface UnifiedOpportunityContract {
  id: string;
  lane: OpportunityLane;
  title: string;
  buyerSegment: string;
  buyerPersonaConfidence: 'HYPOTHESIS' | 'EMPIRICAL';
  demandEvidence: OpportunityEvidence[];
  supplyEvidence: OpportunityEvidence[];
  authorizationStatus: 'VERIFIED' | 'PENDING' | 'NOT_REQUIRED' | 'DENIED';
  monetizationModel: 'AFFILIATE_CPS' | 'DIRECT_SERVICE_INR' | 'PARTNER_REVSHARE' | 'DIGITAL_DOWNLOAD_INR';
  verifiedCommissionOrMarginINR: number | null;
  confidence: number;
  sampleSize: number;
  lifecycleState: ArosLifecycleState;
  rejectionReason?: string | null;
  metadata?: Record<string, any>;
}

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
    let parsedEvidence: OpportunityEvidence[] = [];
    try {
      const raw = JSON.parse(row.evidence_json || '[]');
      parsedEvidence = Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
    } catch {
      parsedEvidence = [];
    }
    return {
      id: row.id,
      businessId: row.business_id,
      organizationId: row.organization_id,
      source: row.source as OpportunitySource,
      evidence: parsedEvidence,
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

  /**
   * Registers an AROS V2 multi-lane opportunity across Affiliate Commerce, B2B Services,
   * Authorized Partnerships, or Digital Products using existing `opportunities` schema.
   */
  public discoverUnified(
    input: Omit<UnifiedOpportunityContract, 'id' | 'lifecycleState'> & {
      id?: string;
      businessId?: string;
      organizationId?: string;
      source?: OpportunitySource;
      initialState?: ArosLifecycleState;
    }
  ): UnifiedOpportunityContract {
    const db = getDb();
    const combinedEvidence = [...(input.demandEvidence || []), ...(input.supplyEvidence || [])];
    if (combinedEvidence.length === 0) {
      throw new Error('Unified opportunity requires at least one real-world demand or supply evidence item.');
    }

    const id = input.id || `opp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lifecycleState: ArosLifecycleState = input.initialState || 'DISCOVERED';
    const contract: UnifiedOpportunityContract = {
      id,
      lane: input.lane,
      title: input.title,
      buyerSegment: input.buyerSegment,
      buyerPersonaConfidence: input.buyerPersonaConfidence,
      demandEvidence: input.demandEvidence || [],
      supplyEvidence: input.supplyEvidence || [],
      authorizationStatus: input.authorizationStatus,
      monetizationModel: input.monetizationModel,
      verifiedCommissionOrMarginINR:
        typeof input.verifiedCommissionOrMarginINR === 'number' && Number.isFinite(input.verifiedCommissionOrMarginINR)
          ? input.verifiedCommissionOrMarginINR
          : null,
      confidence: Math.max(0, Math.min(1, Number(input.confidence || 0))),
      sampleSize: Math.max(0, Math.round(Number(input.sampleSize || 0))),
      lifecycleState,
      rejectionReason: input.rejectionReason || null,
      metadata: input.metadata || {}
    };

    const envelopeJson = JSON.stringify({
      v2Contract: contract,
      items: combinedEvidence
    });

    const businessId = input.businessId || 'biz_platform_aro';
    const organizationId = input.organizationId || 'org_owner_primary';
    const source: OpportunitySource = input.source || 'ORGANIC_SEARCH';
    const estVal = contract.verifiedCommissionOrMarginINR !== null ? contract.verifiedCommissionOrMarginINR : 0;
    const prob = contract.confidence;

    db.prepare(`
      INSERT INTO opportunities (
        id, business_id, organization_id, source, title, confidence_score,
        evidence_json, estimated_value_inr, probability, acquisition_cost_inr,
        time_to_revenue_days, authorization_requirements_json, risk_level,
        next_best_action, status, expected_revenue_inr
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 7, ?, 'LOW', ?, ?, ?)
    `).run(
      id,
      businessId,
      organizationId,
      source,
      contract.title,
      contract.confidence,
      envelopeJson,
      estVal,
      prob,
      JSON.stringify([contract.authorizationStatus]),
      `${contract.lane}:${contract.lifecycleState}`,
      contract.lifecycleState,
      estVal * prob
    );

    DurableEventBus.emit({
      eventType: 'NEW_OPPORTUNITY',
      organizationId,
      businessId,
      payload: {
        opportunityId: id,
        lane: contract.lane,
        lifecycleState,
        sampleSize: contract.sampleSize
      }
    });

    return contract;
  }

  public getUnifiedById(opportunityId: string): UnifiedOpportunityContract | null {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(opportunityId) as any;
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.evidence_json || '{}');
      if (parsed && parsed.v2Contract) {
        return {
          ...parsed.v2Contract,
          lifecycleState: (row.status as ArosLifecycleState) || parsed.v2Contract.lifecycleState
        };
      }
    } catch {}
    return null;
  }

  /**
   * Advances an AROS V2 opportunity through the 11-state lifecycle (plus REJECTED/EXPIRED/SUSPENDED).
   * Enforces explicit transition table `OPPORTUNITY_LIFECYCLE_TRANSITIONS`.
   */
  public transitionLifecycle(
    opportunityId: string,
    toState: ArosLifecycleState,
    reason?: string
  ): UnifiedOpportunityContract {
    const existing = this.getUnifiedById(opportunityId);
    if (!existing) {
      throw new Error(`OPPORTUNITY_NOT_FOUND: ${opportunityId}`);
    }
    if (!canTransitionOpportunityLifecycle(existing.lifecycleState, toState)) {
      throw new Error(
        `INVALID_LIFECYCLE_TRANSITION: Cannot transition ${opportunityId} from ${existing.lifecycleState} to ${toState}`
      );
    }

    const updated: UnifiedOpportunityContract = {
      ...existing,
      lifecycleState: toState,
      rejectionReason: toState === 'REJECTED' ? (reason || existing.rejectionReason || 'Policy rejection') : existing.rejectionReason,
      metadata: {
        ...(existing.metadata || {}),
        lastTransitionReason: reason || null,
        lastTransitionAt: new Date().toISOString()
      }
    };

    const db = getDb();
    const row = db.prepare(`SELECT evidence_json, organization_id, business_id FROM opportunities WHERE id = ?`).get(opportunityId) as any;
    let envelope: any = { v2Contract: updated, items: [...updated.demandEvidence, ...updated.supplyEvidence] };
    try {
      const prev = JSON.parse(row?.evidence_json || '{}');
      if (prev && !Array.isArray(prev)) {
        envelope = { ...prev, v2Contract: updated };
      }
    } catch {}

    db.prepare(`
      UPDATE opportunities
      SET status = ?, evidence_json = ?, next_best_action = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(toState, JSON.stringify(envelope), reason || `${updated.lane}:${toState}`, opportunityId);

    DurableEventBus.emit({
      eventType: 'OPPORTUNITY_STATUS_CHANGED',
      organizationId: row?.organization_id || 'org_owner_primary',
      businessId: row?.business_id || 'biz_platform_aro',
      payload: { opportunityId, fromStatus: existing.lifecycleState, toStatus: toState, lane: updated.lane, reason }
    });

    return updated;
  }

  /**
   * Summarizes unified AROS opportunities grouped by lane and lifecycle state.
   */
  public summarizeLanesAndStates(): {
    byLane: Record<OpportunityLane, { total: number; verified: number; qualified: number; published: number; rejected: number }>;
    byState: Record<string, number>;
    totalTracked: number;
  } {
    const byLane: Record<OpportunityLane, { total: number; verified: number; qualified: number; published: number; rejected: number }> = {
      LANE_A_AFFILIATE_COMMERCE: { total: 0, verified: 0, qualified: 0, published: 0, rejected: 0 },
      LANE_B_B2B_SERVICES: { total: 0, verified: 0, qualified: 0, published: 0, rejected: 0 },
      LANE_C_AUTHORIZED_PARTNERSHIPS: { total: 0, verified: 0, qualified: 0, published: 0, rejected: 0 },
      LANE_D_DIGITAL_PRODUCTS: { total: 0, verified: 0, qualified: 0, published: 0, rejected: 0 }
    };
    const byState: Record<string, number> = {};
    let totalTracked = 0;

    try {
      const db = getDb();
      const rows = db.prepare(`SELECT status, evidence_json, source FROM opportunities`).all() as any[];
      for (const r of rows) {
        totalTracked++;
        const state = String(r.status || 'DISCOVERED');
        byState[state] = (byState[state] || 0) + 1;
        let lane: OpportunityLane = 'LANE_B_B2B_SERVICES';
        try {
          const parsed = JSON.parse(r.evidence_json || '{}');
          if (parsed?.v2Contract?.lane && byLane[parsed.v2Contract.lane as OpportunityLane]) {
            lane = parsed.v2Contract.lane as OpportunityLane;
          }
        } catch {}
        byLane[lane].total++;
        if (state === 'VERIFIED') byLane[lane].verified++;
        if (state === 'QUALIFIED') byLane[lane].qualified++;
        if (state === 'PUBLISHED') byLane[lane].published++;
        if (state === 'REJECTED') byLane[lane].rejected++;
      }
    } catch {}

    return { byLane, byState, totalTracked };
  }
}
