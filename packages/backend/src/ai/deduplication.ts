import crypto from 'crypto';
import { getDb } from '../db/client.js';

export interface DeduplicationOptions {
  agentId: string;
  prompt: string;
  context: Record<string, any>;
  modelVersion: string;
  strategyVersion?: number;
  ttlHours?: number;
}

export class DeduplicationEngine {
  public static generateFingerprint(options: DeduplicationOptions): string {
    const raw = JSON.stringify({
      agentId: options.agentId,
      prompt: options.prompt.trim().toLowerCase(),
      context: options.context,
      modelVersion: options.modelVersion,
      strategyVersion: options.strategyVersion || 1
    });

    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  public static getCachedResult<T>(fingerprint: string): T | null {
    const db = getDb();
    const row = db.prepare(`
      SELECT result_json FROM deduplication_cache
      WHERE fingerprint = ? AND expires_at > datetime('now')
    `).get(fingerprint) as { result_json: string } | undefined;

    if (!row) return null;
    try {
      return JSON.parse(row.result_json) as T;
    } catch {
      return null;
    }
  }

  public static setCachedResult(fingerprint: string, result: any, modelVersion: string, ttlHours = 24): void {
    const db = getDb();
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    db.prepare(`
      INSERT OR REPLACE INTO deduplication_cache (fingerprint, result_json, model_version, created_at, expires_at)
      VALUES (?, ?, ?, datetime('now'), ?)
    `).run(fingerprint, JSON.stringify(result), modelVersion, expiresAt);
  }
}