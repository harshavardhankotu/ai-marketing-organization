/**
 * UnifiedQuotaService — Centralized, persisted quota and health service.
 *
 * Implements Spec §§ 5, 6, 7, 8, 9, 26, 27, 31, 32.
 *
 * All external AI (Gemini) and Search (Tavily) requests MUST pass through this service.
 * Disconnected in-memory counters are prohibited; state is persisted in SQLite:
 *   - provider_quota_state
 *   - automation_health
 */

import { getDb } from '../db/client.js';

export type QuotaPriority = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type ProviderName = 'GEMINI' | 'TAVILY';

export interface QuotaGateResult {
  allowed: boolean;
  reason: string;
  provider: ProviderName;
  remainingAllowance: number | 'UNKNOWN';
  budgetBucketRemaining: number;
  mode: 'NORMAL' | 'CONSERVATIVE' | 'LOCKED' | 'BLOCKED';
}

export interface ProviderQuotaStatus {
  provider: ProviderName;
  providerLimit: number | null;
  applicationLimit: number;
  used: number; // requestsToday for Gemini, creditsConsumedMonth for Tavily
  remainingAllowance: number;
  safetyReserve: number;
  isLocked: boolean;
  lockReason?: string;
  lastReset: string;
  nextReset: string;
  mode: 'NORMAL' | 'CONSERVATIVE' | 'LOCKED';
}

export interface AutomationHealthSummary {
  organizationId: string;
  status: 'ONLINE' | 'NO_EXTERNAL_ACTION_YET' | 'BLOCKED' | 'PAUSED';
  lastSuccessfulWake?: string;
  lastSuccessfulExternalAction?: string;
  lastSuccessfulRevenueAction?: string;
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
   * Initializes default provider records if not present.
   */
  private ensureInitialized(): void {
    try {
      const db = getDb();
      const now = new Date().toISOString();

      // Gemini: default provider limit 1500 (configurable, stored in DB), safety cap 80% = 1200
      const gemini = db.prepare(`SELECT id FROM provider_quota_state WHERE provider = 'GEMINI'`).get();
      if (!gemini) {
        db.prepare(`
          INSERT INTO provider_quota_state (
            id, provider, provider_limit, application_limit, requests_today,
            credits_consumed_month, rate_limit_responses, is_locked,
            last_reset, next_reset, reset_window_hours, updated_at
          ) VALUES (
            'gemini', 'GEMINI', 1500, 1200, 0,
            0, 0, 0,
            ?, ?, 24, ?
          )
        `).run(now, new Date(Date.now() + 24 * 3600 * 1000).toISOString(), now);
      }

      // Tavily: 1000 credits/mo free allowance, application safety cap: 800 credits/mo
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
        `).run(now, new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), now);
      }
    } catch {
      // client migration might run after construction in some test setups
    }
  }

  /**
   * Check if reset window has elapsed and perform state reset if due.
   */
  private checkAndPerformReset(row: any): any {
    const db = getDb();
    const now = new Date();
    const nextReset = new Date(row.next_reset || 0);

    if (now >= nextReset) {
      const lastResetStr = now.toISOString();
      let nextResetStr: string;
      let newRequests = 0;
      let newCredits = row.credits_consumed_month;

      if (row.provider === 'GEMINI') {
        // Provider-defined window (default 24h from now)
        nextResetStr = new Date(now.getTime() + (row.reset_window_hours || 24) * 3600 * 1000).toISOString();
        newRequests = 0;
      } else {
        // Tavily: Monthly reset (30 days)
        nextResetStr = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString();
        newCredits = 0;
      }

      db.prepare(`
        UPDATE provider_quota_state
        SET requests_today = ?, credits_consumed_month = ?, is_locked = 0, lock_reason = NULL,
            last_reset = ?, next_reset = ?, updated_at = ?
        WHERE id = ?
      `).run(newRequests, newCredits, lastResetStr, nextResetStr, lastResetStr, row.id);

      return db.prepare(`SELECT * FROM provider_quota_state WHERE id = ?`).get(row.id);
    }

    return row;
  }

  /**
   * Evaluates if an external AI / Search request is authorized under current quota and priority.
   * Spec §§ 4, 6, 7, 8, 9, 26, 27.
   */
  public canMakeRequest(provider: ProviderName, priority: QuotaPriority, purpose: string): QuotaGateResult {
    this.ensureInitialized();
    const db = getDb();
    let row = db.prepare(`SELECT * FROM provider_quota_state WHERE provider = ?`).get(provider) as any;
    if (!row) {
      return {
        allowed: false,
        reason: `PROVIDER_UNINITIALIZED: ${provider}`,
        provider,
        remainingAllowance: 'UNKNOWN',
        budgetBucketRemaining: 0,
        mode: 'BLOCKED'
      };
    }

    row = this.checkAndPerformReset(row);

    if (row.is_locked) {
      return {
        allowed: false,
        reason: `QUOTA_LOCKED: ${row.lock_reason || 'Provider cap reached'}`,
        provider,
        remainingAllowance: 0,
        budgetBucketRemaining: 0,
        mode: 'LOCKED'
      };
    }

    if (provider === 'GEMINI') {
      const providerLimit = row.provider_limit || 1500;
      const appLimit = Math.floor(providerLimit * 0.8); // 20% safety reserve enforced
      const usedToday = row.requests_today || 0;
      const remaining = Math.max(0, appLimit - usedToday);

      if (remaining <= 0) {
        this.lockProvider('GEMINI', 'Application safety limit reached (20% reserve protected)');
        return {
          allowed: false,
          reason: 'APPLICATION_SAFETY_LIMIT_REACHED: 20% reserve protected',
          provider,
          remainingAllowance: 0,
          budgetBucketRemaining: 0,
          mode: 'LOCKED'
        };
      }

      // Budget Allocator:
      // P0: 40% (Payment/Customer/Lead/Appointment)
      // P1: 25% (Sales/Offer/Follow-up)
      // P2: 20% (Experiment/Attribution/Learning)
      // P3: 10% (Research/Prospect discovery)
      // P4: 5%  (Content ideation/low priority)
      // Emergency reserve is preserved for P0/P1 only when remaining < 10%
      if (remaining < appLimit * 0.05 && (priority === 'P3' || priority === 'P4')) {
        return {
          allowed: false,
          reason: 'RESERVED_FOR_REVENUE_ACTIONS: Remaining quota protected for P0/P1 operations',
          provider,
          remainingAllowance: remaining,
          budgetBucketRemaining: 0,
          mode: 'CONSERVATIVE'
        };
      }

      return {
        allowed: true,
        reason: 'QUOTA_AVAILABLE',
        provider,
        remainingAllowance: remaining,
        budgetBucketRemaining: remaining,
        mode: 'NORMAL'
      };
    }

    if (provider === 'TAVILY') {
      const appLimit = row.application_limit || 800; // 800 credits/mo safety cap
      const creditsUsed = row.credits_consumed_month || 0;
      const remaining = Math.max(0, appLimit - creditsUsed);

      if (creditsUsed >= appLimit) {
        this.lockProvider('TAVILY', 'Monthly application credit cap (800) reached');
        return {
          allowed: false,
          reason: 'MONTHLY_CREDIT_CAP_REACHED: Locked until monthly reset',
          provider,
          remainingAllowance: 0,
          budgetBucketRemaining: 0,
          mode: 'LOCKED'
        };
      }

      // At 80% of application cap (640 credits): conservative mode
      const isConservative = creditsUsed >= appLimit * 0.8;
      if (isConservative && (priority === 'P3' || priority === 'P4')) {
        // In conservative mode, only P0, P1, and high-value operations get Tavily calls
        return {
          allowed: false,
          reason: 'CONSERVATIVE_MODE_ACTIVE: 80% credit cap reached; low-priority research paused',
          provider,
          remainingAllowance: remaining,
          budgetBucketRemaining: remaining,
          mode: 'CONSERVATIVE'
        };
      }

      return {
        allowed: true,
        reason: 'QUOTA_AVAILABLE',
        provider,
        remainingAllowance: remaining,
        budgetBucketRemaining: remaining,
        mode: isConservative ? 'CONSERVATIVE' : 'NORMAL'
      };
    }

    return {
      allowed: false,
      reason: 'UNKNOWN_PROVIDER',
      provider,
      remainingAllowance: 'UNKNOWN',
      budgetBucketRemaining: 0,
      mode: 'BLOCKED'
    };
  }

  /**
   * Records execution of an API request and tracks real consumed units.
   */
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
      // Store actual observed provider reset window
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

  /**
   * Dashboard quota status (Spec § 31).
   */
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

      result[provider] = {
        provider,
        providerLimit: checked.provider_limit,
        applicationLimit: appLimit,
        used,
        remainingAllowance: remaining,
        safetyReserve: (checked.provider_limit || appLimit) - appLimit,
        isLocked: checked.is_locked === 1,
        lockReason: checked.lock_reason || undefined,
        lastReset: checked.last_reset,
        nextReset: checked.next_reset,
        mode: checked.is_locked ? 'LOCKED' : isConservative ? 'CONSERVATIVE' : 'NORMAL'
      };
    }
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // AUTOMATION HEALTH TRACKING (Spec § 32)
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

  public recordAuthBlock(orgId: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO automation_health (organization_id, authorization_blocks, updated_at)
      VALUES (?, 1, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        authorization_blocks = authorization_blocks + 1,
        updated_at = ?
    `).run(orgId, now, now);
  }

  public getHealthSummary(orgId: string): AutomationHealthSummary {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM automation_health WHERE organization_id = ?`).get(orgId) as any;

    const lockedProviders = (db.prepare(`
      SELECT provider FROM provider_quota_state WHERE is_locked = 1
    `).all() as any[]).map(p => p.provider);

    const hasExecutedExternal = Boolean(row?.last_successful_external_action);
    const hasWake = Boolean(row?.last_successful_wake);

    let status: 'ONLINE' | 'NO_EXTERNAL_ACTION_YET' | 'BLOCKED' | 'PAUSED' = 'ONLINE';
    if (!hasExecutedExternal && hasWake) {
      status = 'NO_EXTERNAL_ACTION_YET';
    } else if (lockedProviders.length >= 2 || (row?.consecutive_wake_failures || 0) >= 5) {
      status = 'BLOCKED';
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
