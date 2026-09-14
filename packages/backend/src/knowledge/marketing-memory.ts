import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  EvidenceSourceType,
  EvidenceThresholdConfig,
  MarketingMemoryDimension,
  MarketingMemoryMaturity,
  MarketingMemoryRecord,
} from '@ai-marketing/shared';

export const DEFAULT_EVIDENCE_THRESHOLDS: EvidenceThresholdConfig = {
  promisingMinObservations: 1,
  supportedMinObservations: 5,
  provenMinObservations: 10,
  provenMinCustomers: 3,
  provenPositiveNetContribution: true,
};

export class MarketingMemoryEngine {
  private get db() {
    return getDb();
  }

  /**
   * Evaluates memory maturity strictly based on verifiable evidence.
   */
  public calculateMaturity(params: {
    evidenceCount: number;
    sourceType: EvidenceSourceType;
    verifiedRevenueINR?: number;
    payingCustomersCount?: number;
    netContributionINR?: number;
    config?: Partial<EvidenceThresholdConfig>;
  }): MarketingMemoryMaturity {
    const cfg = { ...DEFAULT_EVIDENCE_THRESHOLDS, ...params.config };

    // Invariant 11: Test or simulated data can NEVER become PROVEN real-world memory
    if (params.sourceType === 'TEST_DATA' || params.sourceType === 'SIMULATED_DATA') {
      return 'HYPOTHESIS';
    }

    const count = params.evidenceCount || 0;
    const customers = params.payingCustomersCount || 0;
    const netContrib = params.netContributionINR ?? 0;

    // Invariant 9: One observation cannot create PROVEN memory (strictly PROMISING)
    if (count < cfg.promisingMinObservations) {
      return 'HYPOTHESIS';
    }

    if (count < cfg.supportedMinObservations) {
      return 'PROMISING';
    }

    const meetsProvenCriteria =
      count >= cfg.provenMinObservations &&
      customers >= cfg.provenMinCustomers &&
      (!cfg.provenPositiveNetContribution || netContrib > 0);

    if (meetsProvenCriteria) {
      return 'PROVEN';
    }

    return 'SUPPORTED';
  }

  /**
   * Stores a structured, evidence-backed marketing insight in the persistent memory store.
   */
  public recordMemory(params: {
    businessId: string;
    dimension: MarketingMemoryDimension;
    key: string;
    insight: string;
    evidenceReference: string;
    sourceType: EvidenceSourceType;
    confidence?: number;
    evidenceCount?: number;
    verifiedRevenueINR?: number;
    maturity?: MarketingMemoryMaturity;
    payingCustomersCount?: number;
    netContributionINR?: number;
    config?: Partial<EvidenceThresholdConfig>;
  }): MarketingMemoryRecord {
    const id = `mem-${randomUUID()}`;
    const now = new Date().toISOString();
    const confidence = params.confidence !== undefined ? params.confidence : 0.85;
    const evidenceCount = params.evidenceCount !== undefined ? params.evidenceCount : 1;
    const verifiedRevenueINR = params.verifiedRevenueINR || 0;

    const maturity =
      params.maturity ||
      this.calculateMaturity({
        evidenceCount,
        sourceType: params.sourceType,
        verifiedRevenueINR,
        payingCustomersCount: params.payingCustomersCount,
        netContributionINR: params.netContributionINR,
        config: params.config,
      });

    this.db
      .prepare(
        `INSERT INTO marketing_memories (
          id, business_id, dimension, memory_key, insight, evidence_reference,
          source_type, confidence, maturity, evidence_count, verified_revenue_inr,
          verified_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.businessId,
        params.dimension,
        params.key,
        params.insight,
        params.evidenceReference,
        params.sourceType,
        confidence,
        maturity,
        evidenceCount,
        verifiedRevenueINR,
        now,
        now
      );

    return {
      id,
      businessId: params.businessId,
      dimension: params.dimension,
      key: params.key,
      insight: params.insight,
      evidenceReference: params.evidenceReference,
      sourceType: params.sourceType,
      confidence,
      maturity,
      evidenceCount,
      verifiedRevenueINR,
      verifiedAt: now,
      createdAt: now,
    };
  }

  /**
   * Updates an existing memory's maturity based on new observations.
   */
  public updateMaturity(
    id: string,
    params: {
      evidenceCount: number;
      sourceType?: EvidenceSourceType;
      verifiedRevenueINR?: number;
      payingCustomersCount?: number;
      netContributionINR?: number;
      config?: Partial<EvidenceThresholdConfig>;
    }
  ): MarketingMemoryRecord {
    const existing = this.getMemory(id);
    if (!existing) throw new Error(`Memory ${id} not found`);

    const sourceType = params.sourceType || existing.sourceType;
    const verifiedRev = params.verifiedRevenueINR !== undefined ? params.verifiedRevenueINR : existing.verifiedRevenueINR;

    const newMaturity = this.calculateMaturity({
      evidenceCount: params.evidenceCount,
      sourceType,
      verifiedRevenueINR: verifiedRev,
      payingCustomersCount: params.payingCustomersCount,
      netContributionINR: params.netContributionINR,
      config: params.config,
    });

    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE marketing_memories SET
           maturity = ?,
           evidence_count = ?,
           verified_revenue_inr = ?,
           verified_at = ?
         WHERE id = ?`
      )
      .run(newMaturity, params.evidenceCount, verifiedRev, now, id);

    return {
      ...existing,
      maturity: newMaturity,
      evidenceCount: params.evidenceCount,
      verifiedRevenueINR: verifiedRev,
      verifiedAt: now,
    };
  }

  /**
   * Retrieves memories for a business, optionally filtered by dimension.
   */
  public listMemories(
    businessId: string,
    dimension?: MarketingMemoryDimension
  ): MarketingMemoryRecord[] {
    let rows: any[];
    if (dimension) {
      rows = this.db
        .prepare(
          'SELECT * FROM marketing_memories WHERE business_id = ? AND dimension = ? ORDER BY created_at DESC'
        )
        .all(businessId, dimension);
    } else {
      rows = this.db
        .prepare('SELECT * FROM marketing_memories WHERE business_id = ? ORDER BY created_at DESC')
        .all(businessId);
    }

    return rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      dimension: r.dimension as MarketingMemoryDimension,
      key: r.memory_key,
      insight: r.insight,
      evidenceReference: r.evidence_reference,
      sourceType: r.source_type as EvidenceSourceType,
      confidence: r.confidence,
      maturity: (r.maturity as MarketingMemoryMaturity) || 'HYPOTHESIS',
      evidenceCount: r.evidence_count || 0,
      verifiedRevenueINR: r.verified_revenue_inr || 0,
      verifiedAt: r.verified_at,
      createdAt: r.created_at,
    }));
  }

  /**
   * Retrieves a single memory by ID.
   */
  public getMemory(id: string): MarketingMemoryRecord | null {
    const r = this.db
      .prepare('SELECT * FROM marketing_memories WHERE id = ?')
      .get(id) as any;
    if (!r) return null;

    return {
      id: r.id,
      businessId: r.business_id,
      dimension: r.dimension as MarketingMemoryDimension,
      key: r.memory_key,
      insight: r.insight,
      evidenceReference: r.evidence_reference,
      sourceType: r.source_type as EvidenceSourceType,
      confidence: r.confidence,
      maturity: (r.maturity as MarketingMemoryMaturity) || 'HYPOTHESIS',
      evidenceCount: r.evidence_count || 0,
      verifiedRevenueINR: r.verified_revenue_inr || 0,
      verifiedAt: r.verified_at,
      createdAt: r.created_at,
    };
  }

  /**
   * Deletes a memory record by ID.
   */
  public deleteMemory(id: string): boolean {
    const result = this.db.prepare('DELETE FROM marketing_memories WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
