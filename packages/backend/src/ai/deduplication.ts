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
  /**
   * Recursively canonicalizes an object by sorting keys and stripping volatile runtime timestamps.
   */
  public static canonicalizeObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => DeduplicationEngine.canonicalizeObject(item));
    }
    const volatileKeys = new Set([
      'timestamp', 'retrievedAt', 'updatedAt', 'createdAt',
      'taskId', 'decisionId', 'auditTimestamp', 'executionTimeMs'
    ]);
    const sortedKeys = Object.keys(obj)
      .filter(k => !volatileKeys.has(k))
      .sort();
    const sortedObj: Record<string, any> = {};
    for (const key of sortedKeys) {
      sortedObj[key] = DeduplicationEngine.canonicalizeObject(obj[key]);
    }
    return sortedObj;
  }

  public static generateFingerprint(options: DeduplicationOptions): string {
    const canonicalContext = DeduplicationEngine.canonicalizeObject(options.context || {});
    const raw = JSON.stringify({
      agentId: options.agentId,
      prompt: options.prompt.trim().toLowerCase(),
      context: canonicalContext,
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
