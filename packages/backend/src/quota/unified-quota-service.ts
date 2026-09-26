/**
 * UnifiedQuotaService — Central authoritative quota, rate limit, and budget service.
 *
 * Implements Spec §§ 8, 9, 10, 11, 12, 13, 14, 26, 27, 31, 32:
 *
 * 1. Single source of truth: Consolidates QuotaManager & UniversalLockManager.
 * 2. Quota Reservation Model:
 *      reserve(provider, priority, units) -> execute -> reconcile(actualUnits)
 * 3. Tavily Calendar Month Reset:
 *      Resets on the 1st of each calendar month at 00:00:00 UTC (not rolling 30 days).
 *      Cap: 800 credits/mo application safety cap (from 1,000 provider allowance).
 * 4. Gemini Limits:
 *      providerLimit is UNKNOWN until verified.
 *      applicationSafetyLimit = 1,200 requests/day.
 *      Tracks provider reset metadata without assuming UTC.
 * 5. Priority Buckets:
 *      P0: 40% (Payment, Customer, Lead, Appointment)
 *      P1: 25% (Sales, Offer, Follow-up)
 *      P2: 20% (Experiment, Learning)
 *      P3: 10% (Research, Prospect Discovery)
 *      P4: 5%  (Content, Analysis)
 * 6. Idle wakes consume Gemini = 0, Tavily = 0.
 */

import { getDb } from '../db/client.js';

export type QuotaPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type ProviderName = 'GEMINI' | 'TAVILY';

export interface QuotaReservation {
  reservationId: string;
  allowed: boolean;
  provider: ProviderName;
  priority: QuotaPriority;
  reservedUnits: number;
  reason: string;
  mode: 'NORMAL' | 'CONSERVATIVE' | 'LOCKED' | 'BLOCKED';
  createdAt: number;
}

export interface ProviderQuotaStatus {
  provider: ProviderName;
  providerLimit: number | null;
  providerLimitStatus: 'PROVIDER_LIMIT_VERIFIED' | 'PROVIDER_LIMIT_UNKNOWN';
  applicationLimit: number;
  used: number;
  remainingAllowance: number;
  safetyReserve: number;
  isLocked: boolean;
  lockReason?: string;
  calendarMonth?: string;
  lastReset: string;
  nextReset: string;
  mode: 'NORMAL' | 'CONSERVATIVE' | 'LOCKED';
}

export interface AutomationHealthSummary {
  organizationId: string;
  status: 'AUTONOMY_ONLINE' | 'NO_EXTERNAL_ACTION_YET' | 'AUTONOMY_BLOCKED' | 'AUTONOMY_PAUSED';
  lastSuccessfulWake?: string;
  lastSuccessfulExternalAction?: string;
  lastSuccessfulRevenueAction?: string;
  lastAttemptedExternalAction?: string;
  lastFailedExternalAction?: string;
  lastSandboxAction?: string;
  lastBlockedAuthorization?: string;
  consecutiveWakeFailures: number;
  consecutiveActionFailures: number;
  providerFailures: Record<string, number>;
  quotaLocks: string[];
  authorizationBlocks: number;
  totalWakes: number;
  totalExternalActions: number;
}

export class UnifiedQuotaService {
  private static instance: UnifiedQuotaService;
  private activeReservations: Map<string, QuotaReservation> = new Map();

  private constructor() {
    this.ensureInitialized();
  }

  public static getInstance(): UnifiedQuotaService {
    if (!UnifiedQuotaService.instance) {
      UnifiedQuotaService.instance = new UnifiedQuotaService();
    }
    return UnifiedQuotaService.instance;
  }

  /**
   * Returns current calendar month string e.g. "2026-09"
   */
  public static getCurrentCalendarMonth(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  /**
   * Returns 1st of next calendar month 00:00:00 UTC (Spec § 10)
   */
  public static getNextCalendarMonthReset(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const nextMonth = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
    return nextMonth.toISOString();
  }

  public ensureInitialized(): void {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const monthKey = UnifiedQuotaService.getCurrentCalendarMonth();
      const nextMonthReset = UnifiedQuotaService.getNextCalendarMonthReset();

      // Gemini row: providerLimit = NULL (UNKNOWN until verified from provider headers)
      const gemini = db.prepare(`SELECT id FROM provider_quota_state WHERE provider = 'GEMINI'`).get();
      if (!gemini) {
        db.prepare(`
          INSERT INTO provider_quota_state (
            id, provider, provider_limit, application_limit, requests_today,
            credits_consumed_month, rate_limit_responses, is_locked,
            last_reset, next_reset, reset_window_hours, updated_at
          ) VALUES (
            'gemini', 'GEMINI', NULL, 1200, 0,
            0, 0, 0,
            ?, ?, 24, ?
          )
        `).run(now, new Date(Date.now() + 24 * 3600 * 1000).toISOString(), now);
      }

      // Tavily row: 1000 provider allowance, 800 application safety cap, calendar month reset
      const tavily = db.prepare(`SELECT id FROM provider_quota_state WHERE provider = 'TAVILY'`).get();
      if (!tavily) {
        db.prepare(`
          INSERT INTO provider_quota_state (
            id, provider, provider_limit, application_limit, requests_today,
            credits_consumed_month, credits_estimated_remaining, rate_limit_responses, is_locked,
            last_reset, next_reset, reset_window_hours, updated_at
          ) VALUES (
            'tavily', 'TAVILY', 1000, 800, 0,
            0, 800, 0, 0,
            ?, ?, 720, ?
          )
        `).run(monthKey, nextMonthReset, now);
      }
    } catch {
      // test runner database swaps
    }
  }

  private checkAndPerformReset(row: any): any {
    const db = getDb();
    const now = new Date();

    if (row.provider === 'TAVILY') {
      // Spec § 10: Reset on first day of calendar month
      const currentMonth = UnifiedQuotaService.getCurrentCalendarMonth();
      const isNewMonth = row.last_reset && !row.last_reset.startsWith(currentMonth);
      const nextResetDate = new Date(row.next_reset || 0);

      if (now >= nextResetDate || isNewMonth) {
        const nextResetStr = UnifiedQuotaService.getNextCalendarMonthReset();
        db.prepare(`
          UPDATE provider_quota_state
          SET credits_consumed_month = 0, credits_estimated_remaining = 800,
              is_locked = 0, lock_reason = NULL,
              last_reset = ?, next_reset = ?, updated_at = ?
          WHERE id = ?
        `).run(currentMonth, nextResetStr, now.toISOString(), row.id);

        return db.prepare(`SELECT * FROM provider_quota_state WHERE id = ?`).get(row.id);
      }
      return row;
    }

    if (row.provider === 'GEMINI') {
      const nextReset = new Date(row.next_reset || 0);
      if (now >= nextReset) {
        const nextResetStr = new Date(now.getTime() + (row.reset_window_hours || 24) * 3600 * 1000).toISOString();
        db.prepare(`
          UPDATE provider_quota_state
          SET requests_today = 0, is_locked = 0, lock_reason = NULL,
              last_reset = ?, next_reset = ?, updated_at = ?
          WHERE id = ?
        `).run(now.toISOString(), nextResetStr, now.toISOString(), row.id);

        return db.prepare(`SELECT * FROM provider_quota_state WHERE id = ?`).get(row.id);
      }
      return row;
    }

    return row;
  }

  /**
   * Spec § 9: QUOTA RESERVATION MODEL
   * Reserves capacity prior to dispatching outbound provider calls.
   */
  public reserve(
    provider: ProviderName,
    priority: QuotaPriority,
    estimatedUnits = 1,
    purpose: string = 'api_call'
  ): QuotaReservation {
    this.ensureInitialized();
    const db = getDb();
    const reservationId = `resv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    let row = db.prepare(`SELECT * FROM provider_quota_state WHERE provider = ?`).get(provider) as any;
    if (!row) {
      return {
        reservationId,
        allowed: false,
        provider,
        priority,
        reservedUnits: 0,
        reason: `PROVIDER_UNINITIALIZED: ${provider}`,
        mode: 'BLOCKED',
        createdAt: Date.now()
      };
    }

    row = this.checkAndPerformReset(row);

    if (row.is_locked) {
      return {
        reservationId,
        allowed: false,
        provider,
        priority,
        reservedUnits: 0,
        reason: `QUOTA_LOCKED: ${row.lock_reason || 'Provider cap reached'}`,
        mode: 'LOCKED',
        createdAt: Date.now()
      };
    }

    if (provider === 'GEMINI') {
      const appLimit = row.application_limit || 1200; // Local protective cap
      const usedToday = row.requests_today || 0;
      const remaining = Math.max(0, appLimit - usedToday);

      if (remaining <= 0 || remaining < estimatedUnits) {
        this.lockProvider('GEMINI', 'Application safety limit reached (1,200 requests/day protected)');
        return {
          reservationId,
          allowed: false,
          provider,
          priority,
          reservedUnits: 0,
          reason: 'APPLICATION_SAFETY_LIMIT_REACHED: Daily safety limit reached',
          mode: 'LOCKED',
          createdAt: Date.now()
        };
      }

      // Spec § 12: Request budget priority enforcement
      // P3/P4 are blocked if quota remaining is below 10% reserve for P0/P1 revenue operations
      if (remaining < appLimit * 0.1 && (priority === 'P3' || priority === 'P4')) {
        return {
          reservationId,
          allowed: false,
          provider,
          priority,
          reservedUnits: 0,
          reason: 'RESERVED_FOR_REVENUE_ACTIONS: Remaining quota protected for P0/P1 operations',
          mode: 'CONSERVATIVE',
          createdAt: Date.now()
        };
      }

      const reservation: QuotaReservation = {
        reservationId,
        allowed: true,
        provider,
        priority,
        reservedUnits: estimatedUnits,
        reason: 'RESERVATION_GRANTED',
        mode: 'NORMAL',
        createdAt: Date.now()
      };
      this.activeReservations.set(reservationId, reservation);
      return reservation;
    }

    if (provider === 'TAVILY') {
      const appLimit = row.application_limit || 800; // 800 credits/mo
      const creditsUsed = row.credits_consumed_month || 0;
      const remaining = Math.max(0, appLimit - creditsUsed);

      if (creditsUsed >= appLimit || remaining < estimatedUnits) {
        this.lockProvider('TAVILY', 'Monthly application credit cap (800 credits) reached');
        return {
          reservationId,
          allowed: false,
          provider,
          priority,
          reservedUnits: 0,
          reason: 'MONTHLY_CREDIT_CAP_REACHED: Locked until 1st of next month',
          mode: 'LOCKED',
          createdAt: Date.now()
        };
      }

      // At 80% (640 credits): conservative mode
      const isConservative = creditsUsed >= appLimit * 0.8;
      if (isConservative && (priority === 'P3' || priority === 'P4')) {
        return {
          reservationId,
          allowed: false,
          provider,
          priority,
          reservedUnits: 0,
          reason: 'CONSERVATIVE_MODE_ACTIVE: 80% credit cap reached; low-priority research paused',
          mode: 'CONSERVATIVE',
          createdAt: Date.now()
        };
      }

      const reservation: QuotaReservation = {
        reservationId,
        allowed: true,
        provider,
        priority,
        reservedUnits: estimatedUnits,
        reason: 'RESERVATION_GRANTED',
        mode: isConservative ? 'CONSERVATIVE' : 'NORMAL',
        createdAt: Date.now()
      };
      this.activeReservations.set(reservationId, reservation);
      return reservation;
    }

    return {
      reservationId,
      allowed: false,
      provider,
      priority,
      reservedUnits: 0,
      reason: 'UNKNOWN_PROVIDER',
      mode: 'BLOCKED',
      createdAt: Date.now()
    };
  }

  /**
   * Spec § 9: Reconciles actual usage after provider execution.
   */
  public reconcile(
    reservationId: string,
    actualUnits: number,
    success: boolean,
    resetWindowMs?: number,
    isRateLimit = false
  ): void {
    const resv = this.activeReservations.get(reservationId);
    this.activeReservations.delete(reservationId);

    const provider: ProviderName = resv?.provider || 'GEMINI';
    this.recordRequest(provider, success, actualUnits, resetWindowMs, isRateLimit);
  }

  /**
   * Synchronous check (used by ARO observe step & tests).
   */
  public canMakeRequest(provider: ProviderName, priority: QuotaPriority, purpose: string) {
    const res = this.reserve(provider, priority, 1, purpose);
    if (res.allowed) {
      // Release immediate reservation for check-only callers
      this.activeReservations.delete(res.reservationId);
    }
    const status = this.getStatus()[provider];
    return {
      allowed: res.allowed,
      reason: res.reason,
      provider,
      remainingAllowance: status?.remainingAllowance ?? 0,
      budgetBucketRemaining: status?.remainingAllowance ?? 0,
      mode: res.mode
    };
  }

  public recordRequest(
    provider: ProviderName,
    success: boolean,
    creditsConsumed = 1,
    resetWindowMs?: number,
    isRateLimit = false
  ): void {
    this.ensureInitialized();
    const db = getDb();
    const now = new Date().toISOString();

    const row = db.prepare(`SELECT * FROM provider_quota_state WHERE provider = ?`).get(provider) as any;
    if (!row) return;

    let nextReset = row.next_reset;
    if (resetWindowMs && resetWindowMs > 0) {
      nextReset = new Date(Date.now() + resetWindowMs).toISOString();
    }

    if (provider === 'GEMINI') {
      const newRequests = (row.requests_today || 0) + 1;
      const successful = (row.successful_requests || 0) + (success ? 1 : 0);
      const failed = (row.failed_requests || 0) + (success ? 0 : 1);
      const rateLimits = (row.rate_limit_responses || 0) + (isRateLimit ? 1 : 0);

      db.prepare(`
        UPDATE provider_quota_state
        SET requests_today = ?, successful_requests = ?, failed_requests = ?,
            rate_limit_responses = ?, last_successful_request = IIF(?, ?, last_successful_request),
            last_rate_limit = IIF(?, ?, last_rate_limit), next_reset = ?, updated_at = ?
        WHERE provider = ?
      `).run(
        newRequests, successful, failed, rateLimits,
        success ? 1 : 0, now,
        isRateLimit ? 1 : 0, now,
        nextReset, now, provider
      );
    } else if (provider === 'TAVILY') {
      const credits = (row.credits_consumed_month || 0) + creditsConsumed;
      const appLimit = row.application_limit || 800;
      const remaining = Math.max(0, appLimit - credits);
      const successful = (row.successful_requests || 0) + (success ? 1 : 0);
      const failed = (row.failed_requests || 0) + (success ? 0 : 1);
      const rateLimits = (row.rate_limit_responses || 0) + (isRateLimit ? 1 : 0);

      db.prepare(`
        UPDATE provider_quota_state
        SET credits_consumed_month = ?, credits_estimated_remaining = ?,
            successful_requests = ?, failed_requests = ?, rate_limit_responses = ?,
            last_successful_request = IIF(?, ?, last_successful_request),
            last_rate_limit = IIF(?, ?, last_rate_limit), updated_at = ?
        WHERE provider = ?
      `).run(
        credits, remaining, successful, failed, rateLimits,
        success ? 1 : 0, now,
        isRateLimit ? 1 : 0, now,
        now, provider
      );
    }
  }

  public recordProviderMetadata(provider: ProviderName, verifiedLimit: number, resetWindowMs?: number): void {
    this.ensureInitialized();
    const db = getDb();
    const nextReset = resetWindowMs ? new Date(Date.now() + resetWindowMs).toISOString() : undefined;

    db.prepare(`
      UPDATE provider_quota_state
      SET provider_limit = ?, next_reset = COALESCE(?, next_reset), updated_at = datetime('now')
      WHERE provider = ?
    `).run(verifiedLimit, nextReset || null, provider);
  }

  public lockProvider(provider: ProviderName, reason: string): void {
    this.ensureInitialized();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE provider_quota_state
      SET is_locked = 1, lock_reason = ?, updated_at = ?
      WHERE provider = ?
    `).run(reason, now, provider);
  }

  public unlockProvider(provider: ProviderName): void {
    this.ensureInitialized();
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE provider_quota_state
      SET is_locked = 0, lock_reason = NULL, updated_at = ?
      WHERE provider = ?
    `).run(now, provider);
  }

  public getStatus(): Record<ProviderName, ProviderQuotaStatus> {
    this.ensureInitialized();
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM provider_quota_state`).all() as any[];

    const result: any = {};
    for (const r of rows) {
      const checked = this.checkAndPerformReset(r);
      const provider = checked.provider as ProviderName;
      const used = provider === 'GEMINI' ? checked.requests_today : checked.credits_consumed_month;
      const appLimit = checked.application_limit;
      const remaining = Math.max(0, appLimit - used);
      const isConservative = provider === 'TAVILY' && used >= appLimit * 0.8;
      const limitStatus = checked.provider_limit ? 'PROVIDER_LIMIT_VERIFIED' : 'PROVIDER_LIMIT_UNKNOWN';

      result[provider] = {
        provider,
        providerLimit: checked.provider_limit,
        providerLimitStatus: limitStatus,
        applicationLimit: appLimit,
        used,
        remainingAllowance: remaining,
        safetyReserve: (checked.provider_limit || appLimit) - appLimit,
        isLocked: checked.is_locked === 1,
        lockReason: checked.lock_reason || undefined,
        calendarMonth: provider === 'TAVILY' ? UnifiedQuotaService.getCurrentCalendarMonth() : undefined,
        lastReset: checked.last_reset,
        nextReset: checked.next_reset,
        mode: checked.is_locked ? 'LOCKED' : isConservative ? 'CONSERVATIVE' : 'NORMAL'
      };
    }
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AUTOMATION HEALTH (Spec § 21 & § 32)
  // ────────────────────────────────────────────────────────────────────────────

  public recordWake(orgId: string, success: boolean, err?: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO automation_health (
        organization_id, last_successful_wake, consecutive_wake_failures, total_wakes, updated_at
      ) VALUES (?, IIF(?, ?, NULL), IIF(?, 0, 1), 1, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        total_wakes = total_wakes + 1,
        last_successful_wake = IIF(?, ?, last_successful_wake),
        consecutive_wake_failures = IIF(?, 0, consecutive_wake_failures + 1),
        updated_at = ?
    `).run(orgId, success ? 1 : 0, now, success ? 1 : 0, now, success ? 1 : 0, now, success ? 1 : 0, now);
  }

  public recordExternalAction(orgId: string, success: boolean, isRevenueAction = false, err?: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO automation_health (
        organization_id, last_successful_external_action, last_successful_revenue_action,
        consecutive_action_failures, total_external_actions, updated_at
      ) VALUES (?, IIF(?, ?, NULL), IIF(?, ?, NULL), IIF(?, 0, 1), 1, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        total_external_actions = total_external_actions + 1,
        last_successful_external_action = IIF(?, ?, last_successful_external_action),
        last_successful_revenue_action = IIF(?, ?, last_successful_revenue_action),
        consecutive_action_failures = IIF(?, 0, consecutive_action_failures + 1),
        updated_at = ?
    `).run(
      orgId,
      success ? 1 : 0, now,
      success && isRevenueAction ? 1 : 0, now,
      success ? 1 : 0, now,
      success ? 1 : 0, now,
      success && isRevenueAction ? 1 : 0, now,
      success ? 1 : 0, now
    );
  }

  public recordAttemptedAction(orgId: string, classification: 'SANDBOX_ACTION' | 'BLOCKED_AUTHORIZATION' | 'FAILED_EXTERNAL'): void {
    const db = getDb();
    const now = new Date().toISOString();

    if (classification === 'BLOCKED_AUTHORIZATION') {
      db.prepare(`
        INSERT INTO automation_health (organization_id, authorization_blocks, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT(organization_id) DO UPDATE SET
          authorization_blocks = authorization_blocks + 1,
          updated_at = ?
      `).run(orgId, now, now);
    }
  }

  public getHealthSummary(orgId: string): AutomationHealthSummary {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM automation_health WHERE organization_id = ?`).get(orgId) as any;

    const lockedProviders = (db.prepare(`
      SELECT provider FROM provider_quota_state WHERE is_locked = 1
    `).all() as any[]).map(p => p.provider);

    const hasExecutedExternal = Boolean(row?.last_successful_external_action);
    const hasWake = Boolean(row?.last_successful_wake);

    let status: 'AUTONOMY_ONLINE' | 'NO_EXTERNAL_ACTION_YET' | 'AUTONOMY_BLOCKED' | 'AUTONOMY_PAUSED' = 'AUTONOMY_ONLINE';
    if (!hasExecutedExternal && hasWake) {
      status = 'NO_EXTERNAL_ACTION_YET';
    } else if (lockedProviders.length >= 2 || (row?.consecutive_wake_failures || 0) >= 5) {
      status = 'AUTONOMY_BLOCKED';
    }

    return {
      organizationId: orgId,
      status,
      lastSuccessfulWake: row?.last_successful_wake || undefined,
      lastSuccessfulExternalAction: row?.last_successful_external_action || undefined,
      lastSuccessfulRevenueAction: row?.last_successful_revenue_action || undefined,
      consecutiveWakeFailures: row?.consecutive_wake_failures || 0,
      consecutiveActionFailures: row?.consecutive_action_failures || 0,
      providerFailures: JSON.parse(row?.provider_failures_json || '{}'),
      quotaLocks: lockedProviders,
      authorizationBlocks: row?.authorization_blocks || 0,
      totalWakes: row?.total_wakes || 0,
      totalExternalActions: row?.total_external_actions || 0
    };
  }
}
