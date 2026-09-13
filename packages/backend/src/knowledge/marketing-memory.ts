import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  EvidenceSourceType,
  MarketingMemoryDimension,
  MarketingMemoryRecord,
} from '@ai-marketing/shared';

export class MarketingMemoryEngine {
  private get db() {
    return getDb();
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
  }): MarketingMemoryRecord {
    const id = `mem-${randomUUID()}`;
    const now = new Date().toISOString();
    const confidence = params.confidence !== undefined ? params.confidence : 0.85;

    this.db
      .prepare(
        `INSERT INTO marketing_memories (
          id, business_id, dimension, memory_key, insight, evidence_reference,
          source_type, confidence, verified_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      verifiedAt: now,
      createdAt: now,
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
