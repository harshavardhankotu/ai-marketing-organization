/**
 * durable-rate-limiter.ts
 *
 * D1-backed durable rate limiter for unauthenticated public routes.
 * Replaces in-memory Map to survive restarts and multi-instance environments.
 * Uses SHA-256 IP hashing (and daily salted hashing for public scan buckets) to maintain DPDP compliance.
 *
 * Pass 2.1 Hardening:
 * - Supports `failClosed: true` mode (required for `/api/v1/public/scan` and `/api/v1/public/mcp`):
 *   any D1/SQLite storage failure returns `{ allowed: false, reason: 'RATE_LIMITER_UNAVAILABLE', retryAfterSeconds: 60 }`
 *   instead of falling back to `allowed: true`.
 * - Atomic `INSERT ... ON CONFLICT(key) DO UPDATE ... RETURNING request_count` + per-key serialization
 *   so concurrent requests at the cap boundary cannot overshoot.
 * - Explicit daily cap helper (`checkPublicScanDailyCaps`) enforcing BOTH per-IP daily cap
 *   (`public_scan:ip:<dailySaltedHash>:<YYYY-MM-DD>`, default 20/day) AND global daily cap
 *   (`public_scan:global:<YYYY-MM-DD>`, default 500/day).
 */

import { createHash } from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';

export type RateLimitDenialReason =
  | 'RATE_LIMIT_EXCEEDED'
  | 'IP_DAILY_RATE_LIMIT_EXCEEDED'
  | 'GLOBAL_DAILY_RATE_LIMIT_EXCEEDED'
  | 'RATE_LIMITER_UNAVAILABLE';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  ipHash: string;
  reason?: RateLimitDenialReason;
  bucketKey?: string;
}

export interface RateLimitOptions {
  /** When true, any storage failure denies the request with reason RATE_LIMITER_UNAVAILABLE (HTTP 503). */
  failClosed?: boolean;
  /** Optional explicit durable_rate_limits primary key (e.g. `public_scan:ip:<hash>:<YYYY-MM-DD>`). */
  explicitKey?: string;
  /** Optional deterministic timestamp in ms (defaults to Date.now()). */
  nowMs?: number;
}

export interface PublicScanDailyCapResult {
  allowed: boolean;
  reason?: RateLimitDenialReason;
  retryAfterSeconds: number;
  ipBucketKey: string;
  globalBucketKey: string;
  ipRemaining: number;
  globalRemaining: number;
  ipLimit: number;
  globalLimit: number;
}

export function getUtcDateString(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function getSecondsUntilNextUtcDay(nowMs: number = Date.now()): number {
  const d = new Date(nowMs);
  const nextMidnightMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(1, Math.ceil((nextMidnightMs - nowMs) / 1000));
}

export class DurableRateLimiter {
  private static instance: DurableRateLimiter;
  private d1Repo = D1RevenueRepository.getInstance();
  private inFlightByKey = new Map<string, Promise<unknown>>();

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
   * Computes a daily-salted SHA-256 IP hash so buckets rotate cleanly per UTC day without storing raw IPs.
   */
  public hashDailySaltedIp(clientIp: string, utcDate: string): string {
    const salt = (
      process.env.RATE_LIMIT_DAILY_SALT ||
      process.env.AUTH_SECRET ||
      'sitefix-daily-rate-salt'
    ).trim();
    return createHash('sha256')
      .update(`${utcDate}:${salt}:${clientIp || '127.0.0.1'}`)
      .digest('hex')
      .substring(0, 16);
  }

  private async runSerialized<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.inFlightByKey.get(lockKey) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const tracked = current.finally(() => {
      if (this.inFlightByKey.get(lockKey) === tracked) {
        this.inFlightByKey.delete(lockKey);
      }
    });
    this.inFlightByKey.set(lockKey, tracked);
    return current;
  }

  /**
   * Checks and atomically increments rate limit for a given route and IP.
   * Window is specified in seconds (default 600s = 10 mins).
   * Max requests per window (default 10).
   */
  public async checkRateLimit(
    route: string,
    clientIp: string,
    maxRequests = 10,
    windowSeconds = 600,
    options: RateLimitOptions = {}
  ): Promise<RateLimitResult> {
    const ipHash = this.hashIp(clientIp);
    const nowMs = options.nowMs ?? Date.now();
    const windowMs = windowSeconds * 1000;
    const windowBucket = Math.floor(nowMs / windowMs);
    const key = options.explicitKey || `${route}:${ipHash}:${windowBucket}`;
    const windowStart = windowBucket * windowMs;
    const expiresAt = windowStart + windowMs;
    const retryAfterDefault = Math.max(1, Math.ceil((expiresAt - nowMs) / 1000));

    return this.runSerialized(key, async () => {
      let currentCount = 1;

      try {
        if (isProduction()) {
          // Single atomic upsert+return statement in D1 (no read-after-write race)
          const row = await this.d1Repo.queryOne<{ request_count: number }>(
            'durable_rate_limits',
            `INSERT INTO durable_rate_limits (key, route, ip_hash, request_count, window_start, expires_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET
               request_count = request_count + 1,
               updated_at = datetime('now')
             RETURNING request_count`,
            [key, route, ipHash, windowStart, expiresAt]
          );
          if (row && typeof row.request_count === 'number') {
            currentCount = row.request_count;
          } else {
            // Fallback for D1 test mocks that only stub executeWrite/queryOne separately
            await this.d1Repo.executeWrite(
              'durable_rate_limits',
              `INSERT INTO durable_rate_limits (key, route, ip_hash, request_count, window_start, expires_at, updated_at)
               VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET
                 request_count = request_count + 1,
                 updated_at = datetime('now')`,
              [key, route, ipHash, windowStart, expiresAt]
            );
            const fallbackRow = await this.d1Repo.queryOne<{ request_count: number }>(
              'durable_rate_limits',
              `SELECT request_count FROM durable_rate_limits WHERE key = ?`,
              [key]
            );
            if (!fallbackRow || typeof fallbackRow.request_count !== 'number') {
              if (options.failClosed) {
                throw new Error('D1 rate-limit counter row unavailable after write');
              }
              currentCount = 1;
            } else {
              currentCount = fallbackRow.request_count;
            }
          }
        } else {
          const db = getDb();
          const row = db
            .prepare(
              `INSERT INTO durable_rate_limits (key, route, ip_hash, request_count, window_start, expires_at, updated_at)
               VALUES (?, ?, ?, 1, ?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET
                 request_count = request_count + 1,
                 updated_at = datetime('now')
               RETURNING request_count`
            )
            .get(key, route, ipHash, windowStart, expiresAt) as { request_count?: number } | undefined;

          if (!row || typeof row.request_count !== 'number') {
            if (options.failClosed) {
              throw new Error('SQLite rate-limit counter row unavailable after atomic increment');
            }
            currentCount = 1;
          } else {
            currentCount = row.request_count;
          }
        }
      } catch (err: any) {
        console.error(`[DurableRateLimiter] Rate limit storage error on ${route} (${key}): ${err?.message || err}`);
        if (options.failClosed) {
          return {
            allowed: false,
            limit: maxRequests,
            remaining: 0,
            retryAfterSeconds: 60,
            ipHash,
            reason: 'RATE_LIMITER_UNAVAILABLE',
            bucketKey: key
          };
        }
        currentCount = 1;
      }

      const allowed = currentCount <= maxRequests;
      const remaining = Math.max(0, maxRequests - currentCount);

      return {
        allowed,
        limit: maxRequests,
        remaining,
        retryAfterSeconds: retryAfterDefault,
        ipHash,
        reason: allowed ? undefined : 'RATE_LIMIT_EXCEEDED',
        bucketKey: key
      };
    });
  }

  /**
   * Enforces BOTH atomic daily caps for POST /api/v1/public/scan in fail-closed mode:
   * - Per-IP daily cap (`public_scan:ip:<dailySaltedHash>:<YYYY-MM-DD>`, default 20/day)
   * - Global daily cap (`public_scan:global:<YYYY-MM-DD>`, default 500/day)
   *
   * Storage errors ALWAYS fail closed with `reason: 'RATE_LIMITER_UNAVAILABLE'` and `retryAfterSeconds: 60`.
   */
  public async checkPublicScanDailyCaps(
    clientIp: string,
    opts: {
      ipDailyCap?: number;
      globalDailyCap?: number;
      nowMs?: number;
    } = {}
  ): Promise<PublicScanDailyCapResult> {
    const nowMs = opts.nowMs ?? Date.now();
    const utcDate = getUtcDateString(nowMs);
    const retryUntilTomorrow = getSecondsUntilNextUtcDay(nowMs);
    const ipLimit = Math.max(
      1,
      opts.ipDailyCap ?? (parseInt(process.env.PUBLIC_SCAN_IP_DAILY_CAP || '20', 10) || 20)
    );
    const globalLimit = Math.max(
      1,
      opts.globalDailyCap ?? (parseInt(process.env.PUBLIC_SCAN_GLOBAL_DAILY_CAP || '500', 10) || 500)
    );

    const dailySaltedHash = this.hashDailySaltedIp(clientIp, utcDate);
    const ipBucketKey = `public_scan:ip:${dailySaltedHash}:${utcDate}`;
    const globalBucketKey = `public_scan:global:${utcDate}`;

    // 1. Atomic per-IP daily cap check (fail-closed)
    const ipRes = await this.checkRateLimit('/public/scan:ip', clientIp, ipLimit, 86400, {
      failClosed: true,
      explicitKey: ipBucketKey,
      nowMs
    });

    if (!ipRes.allowed) {
      if (ipRes.reason === 'RATE_LIMITER_UNAVAILABLE') {
        return {
          allowed: false,
          reason: 'RATE_LIMITER_UNAVAILABLE',
          retryAfterSeconds: 60,
          ipBucketKey,
          globalBucketKey,
          ipRemaining: 0,
          globalRemaining: 0,
          ipLimit,
          globalLimit
        };
      }
      return {
        allowed: false,
        reason: 'IP_DAILY_RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: retryUntilTomorrow,
        ipBucketKey,
        globalBucketKey,
        ipRemaining: 0,
        globalRemaining: globalLimit,
        ipLimit,
        globalLimit
      };
    }

    // 2. Atomic global daily cap check (fail-closed)
    const globalRes = await this.checkRateLimit('/public/scan:global', 'global', globalLimit, 86400, {
      failClosed: true,
      explicitKey: globalBucketKey,
      nowMs
    });

    if (!globalRes.allowed) {
      if (globalRes.reason === 'RATE_LIMITER_UNAVAILABLE') {
        return {
          allowed: false,
          reason: 'RATE_LIMITER_UNAVAILABLE',
          retryAfterSeconds: 60,
          ipBucketKey,
          globalBucketKey,
          ipRemaining: ipRes.remaining,
          globalRemaining: 0,
          ipLimit,
          globalLimit
        };
      }
      return {
        allowed: false,
        reason: 'GLOBAL_DAILY_RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: retryUntilTomorrow,
        ipBucketKey,
        globalBucketKey,
        ipRemaining: ipRes.remaining,
        globalRemaining: 0,
        ipLimit,
        globalLimit
      };
    }

    return {
      allowed: true,
      retryAfterSeconds: retryUntilTomorrow,
      ipBucketKey,
      globalBucketKey,
      ipRemaining: ipRes.remaining,
      globalRemaining: globalRes.remaining,
      ipLimit,
      globalLimit
    };
  }
}
