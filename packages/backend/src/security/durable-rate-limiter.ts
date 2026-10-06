/**
 * durable-rate-limiter.ts
 *
 * D1-backed durable rate limiter for unauthenticated public write routes.
 * Replaces in-memory Map to survive restarts and multi-instance environments.
 * Uses SHA-256 IP hashing to maintain DPDP compliance.
 */

import { createHash } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  ipHash: string;
}

export class DurableRateLimiter {
  private static instance: DurableRateLimiter;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): DurableRateLimiter {
    if (!DurableRateLimiter.instance) {
      DurableRateLimiter.instance = new DurableRateLimiter();
    }
    return DurableRateLimiter.instance;
  }

  public static resetInstanceForTesting(): void {
    DurableRateLimiter.instance = undefined as any;
  }

  public hashIp(clientIp: string): string {
    return createHash('sha256').update(clientIp || '127.0.0.1').digest('hex').substring(0, 16);
  }

  /**
   * Checks and increments rate limit for a given route and IP.
   * Window is specified in seconds (default 600s = 10 mins).
   * Max requests per window (default 10).
   */
  public async checkRateLimit(
    route: string,
    clientIp: string,
    maxRequests = 10,
    windowSeconds = 600
  ): Promise<RateLimitResult> {
    const ipHash = this.hashIp(clientIp);
    const nowMs = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowBucket = Math.floor(nowMs / windowMs);
    const key = `${route}:${ipHash}:${windowBucket}`;
    const windowStart = windowBucket * windowMs;
    const expiresAt = windowStart + windowMs;

    let currentCount = 1;

    try {
      if (isProduction()) {
        await this.d1Repo.executeWrite(
          'durable_rate_limits',
          `INSERT INTO durable_rate_limits (key, route, ip_hash, request_count, window_start, expires_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET
             request_count = request_count + 1,
             updated_at = datetime('now')`,
          [key, route, ipHash, windowStart, expiresAt]
        );

        const row = await this.d1Repo.queryOne<{ request_count: number }>(
          'durable_rate_limits',
          `SELECT request_count FROM durable_rate_limits WHERE key = ?`,
          [key]
        );
        currentCount = row?.request_count ?? 1;
      } else {
        const db = getDb();
        db.prepare(`
          INSERT INTO durable_rate_limits (key, route, ip_hash, request_count, window_start, expires_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            request_count = request_count + 1,
            updated_at = datetime('now')
        `).run(key, route, ipHash, windowStart, expiresAt);

        const row = db.prepare(`SELECT request_count FROM durable_rate_limits WHERE key = ?`).get(key) as any;
        currentCount = row?.request_count ?? 1;
      }
    } catch (err: any) {
      console.warn(`[DurableRateLimiter] Rate limit storage error: ${err.message}.`);
      currentCount = 1;
    }

    const remaining = Math.max(0, maxRequests - currentCount);
    const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt - nowMs) / 1000));

    return {
      allowed: currentCount <= maxRequests,
      limit: maxRequests,
      remaining,
      retryAfterSeconds,
      ipHash
    };
  }
}
