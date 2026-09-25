import { getDb } from '../db/client.js';

export type UniversalLockService = 'GOOGLE_CUSTOM_SEARCH' | 'GEMINI_API' | 'TAVILY_SEARCH';

export interface ServiceLockStatus {
  service: UniversalLockService;
  requestsCountToday: number;
  maxFreeDailyRequests: number;
  remainingFreeRequests: number;
  isLocked: boolean;
  lockReason: string | null;
  lockedAt: string | null;
  resetsAtUtc: string;
}

export interface UniversalLockReport {
  dateKey: string;
  freeTierEnforced: boolean;
  services: Record<UniversalLockService, ServiceLockStatus>;
}

export class UniversalQuotaLockError extends Error {
  public readonly statusCode = 429;
  public readonly service: UniversalLockService;

  constructor(service: UniversalLockService, message: string) {
    super(message);
    this.name = 'UniversalQuotaLockError';
    this.service = service;
  }
}

export class UniversalLockManager {
  private static instance: UniversalLockManager | null = null;

  // Strict daily free-tier caps (hard limit, zero overages)
  public static readonly FREE_LIMITS: Record<UniversalLockService, number> = {
    GOOGLE_CUSTOM_SEARCH: 100, // Google Custom Search JSON API free quota: 100 queries/day
    GEMINI_API: 1500,          // Gemini free-tier daily requests cap: 1,500 queries/day
    TAVILY_SEARCH: 30          // Tavily Search API free quota: 30 queries/day (~900/month, safely under 1,000/mo)
  };

  private constructor() {}

  public static getInstance(): UniversalLockManager {
    if (!UniversalLockManager.instance) {
      UniversalLockManager.instance = new UniversalLockManager();
    }
    return UniversalLockManager.instance;
  }

  private getDateKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getMidnightUtc(): string {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    return tomorrow.toISOString();
  }

  /**
   * Asserts whether an outbound call is permitted under the free tier.
   * Throws UniversalQuotaLockError if daily free quota is exhausted or lock is tripped.
   */
  public checkCanExecute(service: UniversalLockService): void {
    const db = getDb();
    const dateKey = this.getDateKey();
    const maxFree = UniversalLockManager.FREE_LIMITS[service];

    // Ensure row exists
    db.prepare(`
      INSERT OR IGNORE INTO universal_quota_locks (
        service, date_key, requests_count, max_free_requests, is_locked
      ) VALUES (?, ?, 0, ?, 0)
    `).run(service, dateKey, maxFree);

    const row = db.prepare(`
      SELECT requests_count, max_free_requests, is_locked, lock_reason, locked_at
      FROM universal_quota_locks
      WHERE service = ? AND date_key = ?
    `).get(service, dateKey) as {
      requests_count: number;
      max_free_requests: number;
      is_locked: number;
      lock_reason: string | null;
      locked_at: string | null;
    } | undefined;

    if (!row) return;

    if (row.is_locked === 1) {
      throw new UniversalQuotaLockError(
        service,
        `[UNIVERSAL LOCK ACTIVE] Service '${service}' is locked for ${dateKey}. Reason: ${row.lock_reason || 'Daily free limit reached'}. Outbound calls paused until UTC midnight reset (${this.getMidnightUtc()}). Zero synthetic data fallback.`
      );
    }

    if (row.requests_count >= row.max_free_requests) {
      this.engageLock(service, `Daily free-tier quota (${row.max_free_requests}/${row.max_free_requests}) exhausted.`);
      throw new UniversalQuotaLockError(
        service,
        `[UNIVERSAL LOCK ENGAGED] Service '${service}' reached daily free limit (${row.requests_count}/${row.max_free_requests}). Outbound calls paused until UTC midnight reset.`
      );
    }
  }

  /**
   * Records a successful outbound call, incrementing the counter.
   * If the increment reaches the daily limit, immediately locks the service.
   */
  public recordOutboundCall(service: UniversalLockService, count = 1): void {
    const db = getDb();
    const dateKey = this.getDateKey();
    const maxFree = UniversalLockManager.FREE_LIMITS[service];

    db.prepare(`
      INSERT INTO universal_quota_locks (
        service, date_key, requests_count, max_free_requests, is_locked
      ) VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(service, date_key) DO UPDATE SET
        requests_count = requests_count + ?
    `).run(service, dateKey, count, maxFree, count);

    const row = db.prepare(`
      SELECT requests_count, max_free_requests
      FROM universal_quota_locks
      WHERE service = ? AND date_key = ?
    `).get(service, dateKey) as { requests_count: number; max_free_requests: number } | undefined;

    if (row && row.requests_count >= row.max_free_requests) {
      this.engageLock(service, `Daily free-tier quota (${row.requests_count}/${row.max_free_requests}) reached.`);
    }
  }

  /**
   * Immediately trips the universal lock for this service for today.
   */
  public engageLock(service: UniversalLockService, reason: string): void {
    const db = getDb();
    const dateKey = this.getDateKey();
    const now = new Date().toISOString();
    const maxFree = UniversalLockManager.FREE_LIMITS[service];

    db.prepare(`
      INSERT INTO universal_quota_locks (
        service, date_key, requests_count, max_free_requests, is_locked, lock_reason, locked_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(service, date_key) DO UPDATE SET
        is_locked = 1,
        lock_reason = ?,
        locked_at = ?
    `).run(service, dateKey, maxFree, maxFree, reason, now, reason, now);
  }

  /**
   * Retrieves live status of universal locks across all services.
   */
  public getStatus(): UniversalLockReport {
    const db = getDb();
    const dateKey = this.getDateKey();
    const resetsAtUtc = this.getMidnightUtc();

    const getServiceStatus = (service: UniversalLockService): ServiceLockStatus => {
      const maxFree = UniversalLockManager.FREE_LIMITS[service];
      const row = db.prepare(`
        SELECT requests_count, max_free_requests, is_locked, lock_reason, locked_at
        FROM universal_quota_locks
        WHERE service = ? AND date_key = ?
      `).get(service, dateKey) as any;

      const requestsCount = row?.requests_count ?? 0;
      const isLocked = Boolean(row?.is_locked === 1 || requestsCount >= maxFree);

      return {
        service,
        requestsCountToday: requestsCount,
        maxFreeDailyRequests: maxFree,
        remainingFreeRequests: Math.max(0, maxFree - requestsCount),
        isLocked,
        lockReason: row?.lock_reason || (isLocked ? 'Daily free limit reached' : null),
        lockedAt: row?.locked_at || null,
        resetsAtUtc
      };
    };

    return {
      dateKey,
      freeTierEnforced: true,
      services: {
        GOOGLE_CUSTOM_SEARCH: getServiceStatus('GOOGLE_CUSTOM_SEARCH'),
        GEMINI_API: getServiceStatus('GEMINI_API'),
        TAVILY_SEARCH: getServiceStatus('TAVILY_SEARCH')
      }
    };
  }
}
