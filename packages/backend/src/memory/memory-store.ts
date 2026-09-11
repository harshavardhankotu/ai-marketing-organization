import { getDb } from '../db/client.js';

export type MemoryScope = 'BUSINESS' | 'MARKET' | 'CAMPAIGN' | 'AGENT' | 'SYSTEM';

export interface MemoryItem<T = any> {
  id: string;
  organizationId: string;
  businessId: string;
  scope: MemoryScope;
  key: string;
  value: T;
  version: number;
  confidence: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class MemoryStore {
  private static instance: MemoryStore;

  public static getInstance(): MemoryStore {
    if (!MemoryStore.instance) {
      MemoryStore.instance = new MemoryStore();
    }
    return MemoryStore.instance;
  }

  public set<T>(
    orgId: string,
    businessId: string,
    scope: MemoryScope,
    key: string,
    value: T,
    options?: { confidence?: number; ttlDays?: number }
  ): void {
    const db = getDb();
    const id = `mem_${businessId}_${scope.toLowerCase()}_${key}`;
    const confidence = options?.confidence ?? 1.0;
    const expiresAt = options?.ttlDays
      ? new Date(Date.now() + options.ttlDays * 86400000).toISOString()
      : null;

    db.prepare(`
      INSERT INTO memory_items (
        id, organization_id, business_id, scope, key, value_json,
        version, confidence, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(business_id, scope, key) DO UPDATE SET
        value_json = excluded.value_json,
        version = version + 1,
        confidence = excluded.confidence,
        expires_at = excluded.expires_at,
        updated_at = datetime('now')
    `).run(id, orgId, businessId, scope, key, JSON.stringify(value), confidence, expiresAt);
  }

  public get<T>(businessId: string, scope: MemoryScope, key: string): T | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT value_json FROM memory_items
      WHERE business_id = ? AND scope = ? AND key = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(businessId, scope, key) as { value_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return null;
    }
  }

  public getAllInScope(businessId: string, scope: MemoryScope): Record<string, any> {
    const db = getDb();
    const rows = db.prepare(`
      SELECT key, value_json FROM memory_items
      WHERE business_id = ? AND scope = ?
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all(businessId, scope) as { key: string; value_json: string }[];

    const result: Record<string, any> = {};
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value_json);
      } catch {
        result[r.key] = r.value_json;
      }
    }
    return result;
  }

  /**
   * Bounded Context Package constructor:
   * Assembles only relevant, fresh context for an agent execution to avoid prompt bloat.
   */
  public constructBoundedContext(businessId: string, campaignId?: string): Record<string, any> {
    const db = getDb();
    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId) as any;
    const latestStrategy = db.prepare(`
      SELECT * FROM strategies WHERE business_id = ? ORDER BY version DESC LIMIT 1
    `).get(businessId) as any;

    const marketMemory = this.getAllInScope(businessId, 'MARKET');
    const systemMemory = this.getAllInScope(businessId, 'SYSTEM');

    let campaignData = null;
    if (campaignId) {
      campaignData = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    }

    return {
      business: {
        name: business?.name,
        vertical: business?.vertical_name,
        riskTier: business?.risk_tier,
        city: business?.city,
        neighborhood: business?.neighborhood,
        brandVoice: business?.brand_voice,
        primaryLanguage: business?.primary_language
      },
      strategy: latestStrategy ? {
        version: latestStrategy.version,
        title: latestStrategy.title,
        positioning: latestStrategy.positioning
      } : null,
      campaign: campaignData,
      marketSignals: marketMemory,
      activeLearnings: systemMemory.latest_learnings || []
    };
  }
}