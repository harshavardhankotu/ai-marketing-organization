/**
 * Cloudflare D1 Database Integration & Usage Guard
 *
 * Implements Spec §§ 17 & 18:
 * - Persistent cloud database for autonomy state (survives Render restarts).
 * - D1 Free-Tier Protection Guard:
 *     5M reads/day limit -> Application safety cap: 4,000,000 rows read/day (80%)
 *     100k writes/day limit -> Application safety cap: 80,000 rows written/day (80%)
 *     5GB storage limit
 * - Prioritizes revenue-critical state (P0/P1) when safety budget is reached.
 * - Seamless fallback to SQLite for local development and test runners.
 */

import { getDb } from './client.js';

export const FINANCIAL_TABLES = [
  'payment_requests',
  'manual_upi_claims',
  'orders',
  'universal_orders',
  'transactions',
  'commission_ledger',
  'delivery_tasks',
  'payout_records'
] as const;

export const DURABLE_REQUIRED_TABLES = [
  ...FINANCIAL_TABLES,
  'durable_events',
  'customer_journeys',
  'proposals'
] as const;

export function isFinancialSql(sql: string): boolean {
  const lower = String(sql || '').toLowerCase();
  return FINANCIAL_TABLES.some(tbl => {
    const regex = new RegExp(`\\b${tbl}\\b`, 'i');
    return regex.test(lower);
  });
}

export function isDurableRequiredTable(table: string): boolean {
  const clean = String(table || '').trim().toLowerCase();
  return DURABLE_REQUIRED_TABLES.some(tbl => tbl === clean);
}

export function isDurableRequiredSql(sql: string): boolean {
  const lower = String(sql || '').toLowerCase();
  return DURABLE_REQUIRED_TABLES.some(tbl => {
    const regex = new RegExp(`\\b${tbl}\\b`, 'i');
    return regex.test(lower);
  });
}

export interface D1UsageMetrics {
  dateKey: string;
  rowsReadToday: number;
  rowsWrittenToday: number;
  maxReadCap: number;
  maxWriteCap: number;
  remainingReadBudget: number;
  remainingWriteBudget: number;
  isReadThrottled: boolean;
  isWriteThrottled: boolean;
}

export class D1Client {
  private static instance: D1Client;
  private accountId?: string;
  private databaseId?: string;
  private apiToken?: string;
  private remoteReadQuotaExhaustedUntilMs = 0;
  private remoteReadQuotaExhaustedReason = '';
  private remoteWriteQuotaExhaustedUntilMs = 0;
  private remoteWriteQuotaExhaustedReason = '';
  private loggedQuotaExhaustedDate = '';

  // 80% safety caps for Cloudflare D1 Free Tier
  public static readonly READ_SAFETY_CAP = 4_000_000;
  public static readonly WRITE_SAFETY_CAP = 80_000;

  // PR #92: Per-run background cycle budget cap to stop D1 row-read bleed
  public static readonly PER_CYCLE_READ_BUDGET_CAP = 2500;
  private cycleActive = false;
  private currentCycleRowsRead = 0;
  private currentCycleRowsWritten = 0;
  private currentCycleQueries = 0;
  private cycleBudgetCeiling = 2500;

  // PR #93: Daily cumulative background read budget guard (250,000 rows/day = 5% of 5M free limit)
  public static readonly DAILY_BACKGROUND_READ_BUDGET_CAP = 250_000;
  private dailyBackgroundRowsRead = 0;
  private dailyBackgroundRowsWritten = 0;
  private dailyBudgetCap = 250_000;
  private currentDailyDateKey = new Date().toISOString().split('T')[0];

  private constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
    this.databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';
    this.apiToken = process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
    this.ensureUsageTable();
  }

  public static getInstance(): D1Client {
    if (!D1Client.instance) {
      D1Client.instance = new D1Client();
    }
    return D1Client.instance;
  }

  public static isDailyReadQuotaError(status: number, bodyText: string): boolean {
    const raw = String(bodyText || '');
    return /Your account has exceeded D1['’]s free tier daily row read limit/i.test(raw);
  }

  public static isDailyWriteQuotaError(status: number, bodyText: string): boolean {
    const raw = String(bodyText || '');
    return /Your account has exceeded D1['’]s free tier daily row write limit/i.test(raw);
  }

  public static isDailyQuotaError(status: number, bodyText: string): boolean {
    const raw = String(bodyText || '');
    // Narrow Cloudflare D1 daily quota classifier (Spec Stage P.2):
    // Trip circuit breaker ONLY when error matches true Cloudflare free-tier daily row limit exhaustion.
    // Never classify bare HTTP 429, generic "quota exceeded", "daily quota", error 7429, or error 7500 as daily row quota exhaustion.
    return /Your account has exceeded D1['’]s free tier daily row (read|write) limit/i.test(raw);
  }

  public isDailyQuotaError(status: number, bodyText: string): boolean {
    return D1Client.isDailyQuotaError(status, bodyText);
  }

  public isDailyReadQuotaError(status: number, bodyText: string): boolean {
    return D1Client.isDailyReadQuotaError(status, bodyText);
  }

  public isDailyWriteQuotaError(status: number, bodyText: string): boolean {
    return D1Client.isDailyWriteQuotaError(status, bodyText);
  }

  public tripQuotaCircuitBreakerPublic(errText: string, type: 'read' | 'write' | 'both' = 'both'): void {
    this.tripQuotaCircuitBreaker(errText, type);
  }

  public tripReadQuotaCircuitBreaker(errText: string): void {
    this.tripQuotaCircuitBreaker(errText, 'read');
  }

  public tripWriteQuotaCircuitBreaker(errText: string): void {
    this.tripQuotaCircuitBreaker(errText, 'write');
  }

  public isRemoteD1ReadQuotaExhausted(): boolean {
    return Date.now() < this.remoteReadQuotaExhaustedUntilMs;
  }

  public isRemoteD1WriteQuotaExhausted(): boolean {
    return Date.now() < this.remoteWriteQuotaExhaustedUntilMs;
  }

  public isRemoteD1QuotaExhausted(): boolean {
    return this.isRemoteD1ReadQuotaExhausted() || this.isRemoteD1WriteQuotaExhausted();
  }

  public getRemoteQuotaCircuitState(): {
    exhausted: boolean;
    readExhausted: boolean;
    writeExhausted: boolean;
    untilIso: string | null;
    readUntilIso: string | null;
    writeUntilIso: string | null;
    reason: string | null;
    readReason: string | null;
    writeReason: string | null;
  } {
    const readExhausted = this.isRemoteD1ReadQuotaExhausted();
    const writeExhausted = this.isRemoteD1WriteQuotaExhausted();
    const exhausted = readExhausted || writeExhausted;
    const maxUntilMs = Math.max(this.remoteReadQuotaExhaustedUntilMs, this.remoteWriteQuotaExhaustedUntilMs);
    return {
      exhausted,
      readExhausted,
      writeExhausted,
      untilIso: exhausted ? new Date(maxUntilMs).toISOString() : null,
      readUntilIso: readExhausted ? new Date(this.remoteReadQuotaExhaustedUntilMs).toISOString() : null,
      writeUntilIso: writeExhausted ? new Date(this.remoteWriteQuotaExhaustedUntilMs).toISOString() : null,
      reason: readExhausted ? this.remoteReadQuotaExhaustedReason : (writeExhausted ? this.remoteWriteQuotaExhaustedReason : null),
      readReason: readExhausted ? this.remoteReadQuotaExhaustedReason : null,
      writeReason: writeExhausted ? this.remoteWriteQuotaExhaustedReason : null
    };
  }

  public resetQuotaCircuitBreakerForTesting(): void {
    this.remoteReadQuotaExhaustedUntilMs = 0;
    this.remoteReadQuotaExhaustedReason = '';
    this.remoteWriteQuotaExhaustedUntilMs = 0;
    this.remoteWriteQuotaExhaustedReason = '';
    this.loggedQuotaExhaustedDate = '';
  }

  private tripQuotaCircuitBreaker(errText: string, type?: 'read' | 'write' | 'both'): void {
    const now = new Date();
    const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1, 0);
    const raw = String(errText || '');
    let isWrite = false;
    let isRead = false;

    if (/write limit/i.test(raw) && !/read limit/i.test(raw)) {
      isWrite = true;
    } else if (/read limit/i.test(raw) && !/write limit/i.test(raw)) {
      isRead = true;
    } else if (type === 'write') {
      isWrite = true;
    } else if (type === 'read') {
      isRead = true;
    } else {
      isWrite = true;
      isRead = true;
    }

    if (isRead) {
      this.remoteReadQuotaExhaustedUntilMs = nextUtcMidnight;
      this.remoteReadQuotaExhaustedReason = raw.slice(0, 300);
    }
    if (isWrite) {
      this.remoteWriteQuotaExhaustedUntilMs = nextUtcMidnight;
      this.remoteWriteQuotaExhaustedReason = raw.slice(0, 300);
    }

    const dayKey = now.toISOString().split('T')[0];
    if (this.loggedQuotaExhaustedDate !== dayKey) {
      this.loggedQuotaExhaustedDate = dayKey;
      console.info(
        `[D1Client] Cloudflare D1 free-tier daily ${isWrite && !isRead ? 'write' : isRead && !isWrite ? 'read' : 'quota'} reached (code 7500); falling back cleanly to local SQLite until ${new Date(nextUtcMidnight).toISOString()}.`
      );
    }
  }

  private getAccountId(): string {
    return (process.env.CLOUDFLARE_ACCOUNT_ID || this.accountId || '9b7511ff69e507dd3a00a7266fec11a3').trim();
  }

  private getDatabaseId(): string {
    return (process.env.CLOUDFLARE_D1_DATABASE_ID || this.databaseId || '0563bb85-f6d2-483f-8b0f-0784e3d604c7').trim();
  }

  private getApiToken(): string {
    const raw = (process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || this.apiToken || '').trim();
    if (!raw || /^(placeholder|demo|test|none|null|undefined|change_me)$/i.test(raw) || raw.includes('your_')) {
      return '';
    }
    return raw;
  }

  public isRemoteD1Configured(): boolean {
    return Boolean(this.getAccountId() && this.getDatabaseId() && this.getApiToken());
  }

  /**
   * Remote Cloudflare D1 reads in non-Render dev/preview (NODE_ENV !== 'production' && RENDER !== 'true')
   * are disabled by default so dev traffic reads local SQLite cleanly and does not burn Render's
   * 5M/day Cloudflare D1 free-tier read quota or spam HTTP 400 (code 7500) fallback logs.
   */
  public isRemoteD1ReadAllowed(): boolean {
    if (process.env.VITEST && process.env.ALLOW_REMOTE_D1_READS !== 'true') return false;
    if (!this.isRemoteD1Configured()) return false;
    if (this.isRemoteD1ReadQuotaExhausted() || this.isRemoteD1WriteQuotaExhausted()) return false;
    return (
      process.env.NODE_ENV === 'production' ||
      process.env.RENDER === 'true' ||
      process.env.ALLOW_REMOTE_D1_READS === 'true' ||
      process.env.ALLOW_REMOTE_D1_WRITES === 'true'
    );
  }

  /**
   * Remote Cloudflare D1 writes are only permitted on Render production (RENDER === 'true')
   * or when explicitly unlocked via ALLOW_REMOTE_D1_WRITES === 'true' (outside Vitest).
   */
  public isRemoteD1WriteAllowed(): boolean {
    if (process.env.VITEST && process.env.ALLOW_REMOTE_D1_WRITES !== 'true') return false;
    if (!this.isRemoteD1Configured()) return false;
    if (this.isRemoteD1WriteQuotaExhausted() || this.isRemoteD1ReadQuotaExhausted()) return false;
    return process.env.RENDER === 'true' || process.env.ALLOW_REMOTE_D1_WRITES === 'true';
  }

  /**
   * Spec § 37: D1 Production Persistence Assertion
   * In production, if Cloudflare D1 is unavailable or unconfigured, halt irreversible external actions.
   */
  public assertDurableStorageForExternalAction(): void {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !this.isRemoteD1Configured()) {
      throw new Error(
        'PERSISTENCE_FAULT: Irreversible external action blocked. Production requires durable Cloudflare D1 persistence (CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_API_TOKEN) to ensure state survives container restarts.'
      );
    }
  }

  /**
   * Production Revenue State Assertion (Spec § 9)
   * In production, irreversible revenue operations on critical tables require durable Cloudflare D1 persistence.
   */
  public assertDurableStorageForEntity(entityName: string): void {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && !this.isRemoteD1Configured()) {
      throw new Error(
        `PERSISTENCE_FAULT: Irreversible action on '${entityName}' blocked. Production requires durable Cloudflare D1 persistence (CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_API_TOKEN) to ensure state survives container restarts.`
      );
    }
  }

  private ensureUsageTable(): void {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const db = getDb();
      db.prepare(`
        CREATE TABLE IF NOT EXISTS d1_usage_state (
          date_key TEXT PRIMARY KEY,
          rows_read INTEGER NOT NULL DEFAULT 0,
          rows_written INTEGER NOT NULL DEFAULT 0,
          read_safety_cap INTEGER NOT NULL DEFAULT 4000000,
          write_safety_cap INTEGER NOT NULL DEFAULT 80000,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();
    } catch {}
  }

  /**
   * Tracks rows read/written to ensure Cloudflare Free Tier caps are never exceeded.
   */
  public recordUsage(rowsRead = 0, rowsWritten = 0, isBackground = false): void {
    this.recordCycleUsage(rowsRead, rowsWritten, isBackground);
    if (process.env.NODE_ENV === 'production') return;
    try {
      this.ensureUsageTable();
      const db = getDb();
      const dateKey = new Date().toISOString().split('T')[0];

      db.prepare(`
        INSERT INTO d1_usage_state (date_key, rows_read, rows_written, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(date_key) DO UPDATE SET
          rows_read = rows_read + ?,
          rows_written = rows_written + ?,
          updated_at = datetime('now')
      `).run(dateKey, rowsRead, rowsWritten, rowsRead, rowsWritten);
    } catch {}
  }

  public isCycleActive(): boolean {
    return this.cycleActive;
  }

  public getD1Status(): {
    status: 'HEALTHY' | 'CYCLE_BUDGET_EXCEEDED' | 'DAILY_BACKGROUND_BUDGET_EXCEEDED' | 'QUOTA_CIRCUIT_OPEN' | 'UNCONFIGURED';
    d1Health: 'HEALTHY' | 'DEGRADED_QUOTA_EXHAUSTED' | 'UNCONFIGURED';
    quotaStatus: 'HEALTHY' | 'DEGRADED_QUOTA_EXHAUSTED' | 'UNCONFIGURED';
    remoteD1Configured: boolean;
    readExhausted: boolean;
    writeExhausted: boolean;
    dateKey: string;
    instanceLocalDailyBackgroundRowsRead: number;
    instanceLocalDailyBackgroundRowsWritten: number;
    dailyBackgroundBudgetCap: number;
    dailyBackgroundBudgetExceeded: boolean;
    cycleActive: boolean;
    currentCycleRowsRead: number;
    cycleBudgetCap: number;
    cycleBudgetExceeded: boolean;
    telemetryScopeNote: string;
    circuitBreaker: ReturnType<D1Client['getRemoteQuotaCircuitState']>;
  } {
    this.checkAndResetDailyUsage();
    const remoteConfigured = this.isRemoteD1Configured();
    const circuit = this.getRemoteQuotaCircuitState();
    const dailyExceeded = this.isDailyBackgroundBudgetExceeded();
    const cycleExceeded = this.isCycleBudgetExceeded();
    const isDegraded = circuit.exhausted || dailyExceeded;
    const d1Health: 'HEALTHY' | 'DEGRADED_QUOTA_EXHAUSTED' | 'UNCONFIGURED' = !remoteConfigured
      ? 'UNCONFIGURED'
      : (isDegraded ? 'DEGRADED_QUOTA_EXHAUSTED' : 'HEALTHY');
    return {
      status: !remoteConfigured
        ? 'UNCONFIGURED'
        : (circuit.exhausted
            ? 'QUOTA_CIRCUIT_OPEN'
            : (dailyExceeded
                ? 'DAILY_BACKGROUND_BUDGET_EXCEEDED'
                : (cycleExceeded ? 'CYCLE_BUDGET_EXCEEDED' : 'HEALTHY'))),
      d1Health,
      quotaStatus: d1Health,
      remoteD1Configured: remoteConfigured,
      readExhausted: circuit.readExhausted,
      writeExhausted: circuit.writeExhausted,
      dateKey: this.currentDailyDateKey,
      instanceLocalDailyBackgroundRowsRead: this.dailyBackgroundRowsRead,
      instanceLocalDailyBackgroundRowsWritten: this.dailyBackgroundRowsWritten,
      dailyBackgroundBudgetCap: this.dailyBudgetCap,
      dailyBackgroundBudgetExceeded: dailyExceeded,
      cycleActive: this.cycleActive,
      currentCycleRowsRead: this.currentCycleRowsRead,
      cycleBudgetCap: this.cycleBudgetCeiling,
      cycleBudgetExceeded: cycleExceeded,
      telemetryScopeNote: 'Instance-local counter in process memory; resets across process restarts or redeploys.',
      circuitBreaker: circuit
    };
  }

  public assertBackgroundBudgetAvailable(
    sql: string,
    priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' = 'P1',
    isBackground?: boolean
  ): void {
    const backgroundQuery = isBackground === true || this.cycleActive || priority === 'P3' || priority === 'P4';
    if (!backgroundQuery) return;
    if (isFinancialSql(sql) && priority === 'P0' && isBackground !== true && !this.cycleActive) return;
    if (this.isCycleBudgetExceeded() || this.isDailyBackgroundBudgetExceeded()) {
      throw new Error(
        `D1_BACKGROUND_BUDGET_EXCEEDED: [D1 BUDGET GUARD] Background D1 budget exceeded (cycleRowsRead=${this.currentCycleRowsRead}/${this.cycleBudgetCeiling}, dailyRowsRead=${this.dailyBackgroundRowsRead}/${this.dailyBudgetCap}). Background query blocked.`
      );
    }
  }

  // PR #93: Daily check & reset helper
  private checkAndResetDailyUsage(): void {
    const todayKey = new Date().toISOString().split('T')[0];
    if (this.currentDailyDateKey !== todayKey) {
      this.currentDailyDateKey = todayKey;
      this.dailyBackgroundRowsRead = 0;
      this.dailyBackgroundRowsWritten = 0;
    }
  }

  public isDailyBackgroundBudgetExceeded(): boolean {
    this.checkAndResetDailyUsage();
    return this.dailyBackgroundRowsRead >= this.dailyBudgetCap;
  }

  public getDailyBackgroundUsage(): {
    dateKey: string;
    dailyRowsRead: number;
    dailyRowsWritten: number;
    dailyBudgetCap: number;
    dailyBudgetExceeded: boolean;
  } {
    this.checkAndResetDailyUsage();
    return {
      dateKey: this.currentDailyDateKey,
      dailyRowsRead: this.dailyBackgroundRowsRead,
      dailyRowsWritten: this.dailyBackgroundRowsWritten,
      dailyBudgetCap: this.dailyBudgetCap,
      dailyBudgetExceeded: this.isDailyBackgroundBudgetExceeded()
    };
  }

  public setDailyBackgroundBudgetCap(cap: number): void {
    this.dailyBudgetCap = cap;
  }

  public resetDailyBackgroundUsage(): void {
    this.dailyBackgroundRowsRead = 0;
    this.dailyBackgroundRowsWritten = 0;
    this.currentDailyDateKey = new Date().toISOString().split('T')[0];
  }

  // PR #92 & PR #93: Background Cycle & Daily Budget Tracking
  public startBackgroundCycle(budget: number = D1Client.PER_CYCLE_READ_BUDGET_CAP): void {
    this.checkAndResetDailyUsage();
    this.currentCycleRowsRead = 0;
    this.currentCycleRowsWritten = 0;
    this.currentCycleQueries = 0;
    this.cycleBudgetCeiling = budget;
    this.cycleActive = true;
  }

  public endBackgroundCycle(): {
    queriesExecuted: number;
    rowsRead: number;
    rowsWritten: number;
    budgetStopped: boolean;
    budgetCap: number;
    dailyRowsRead: number;
    dailyBudgetCap: number;
    dailyBudgetExceeded: boolean;
  } {
    this.checkAndResetDailyUsage();
    const summary = {
      queriesExecuted: this.currentCycleQueries,
      rowsRead: this.currentCycleRowsRead,
      rowsWritten: this.currentCycleRowsWritten,
      budgetStopped: this.isCycleBudgetExceeded(),
      budgetCap: this.cycleBudgetCeiling,
      dailyRowsRead: this.dailyBackgroundRowsRead,
      dailyBudgetCap: this.dailyBudgetCap,
      dailyBudgetExceeded: this.isDailyBackgroundBudgetExceeded()
    };
    this.cycleActive = false;
    return summary;
  }

  public isCycleBudgetExceeded(): boolean {
    this.checkAndResetDailyUsage();
    return (this.cycleActive && this.currentCycleRowsRead >= this.cycleBudgetCeiling) ||
           this.isDailyBackgroundBudgetExceeded();
  }

  public getCycleUsage(): {
    queriesExecuted: number;
    rowsRead: number;
    rowsWritten: number;
    budgetLimit: number;
    budgetExceeded: boolean;
    dailyRowsRead: number;
    dailyBudgetCap: number;
    dailyBudgetExceeded: boolean;
  } {
    this.checkAndResetDailyUsage();
    return {
      queriesExecuted: this.currentCycleQueries,
      rowsRead: this.currentCycleRowsRead,
      rowsWritten: this.currentCycleRowsWritten,
      budgetLimit: this.cycleBudgetCeiling,
      budgetExceeded: this.isCycleBudgetExceeded(),
      dailyRowsRead: this.dailyBackgroundRowsRead,
      dailyBudgetCap: this.dailyBudgetCap,
      dailyBudgetExceeded: this.isDailyBackgroundBudgetExceeded()
    };
  }

  public recordCycleUsage(rowsRead = 0, rowsWritten = 0, isBackground = false): void {
    this.checkAndResetDailyUsage();
    if (this.cycleActive) {
      this.currentCycleQueries++;
      this.currentCycleRowsRead += rowsRead;
      this.currentCycleRowsWritten += rowsWritten;
      this.dailyBackgroundRowsRead += rowsRead;
      this.dailyBackgroundRowsWritten += rowsWritten;
    } else if (isBackground) {
      this.dailyBackgroundRowsRead += rowsRead;
      this.dailyBackgroundRowsWritten += rowsWritten;
    }
  }

  /**
   * Evaluates current D1 Free Tier consumption.
   */
  public getUsage(): D1UsageMetrics {
    if (process.env.NODE_ENV === 'production') {
      return {
        dateKey: new Date().toISOString().split('T')[0],
        rowsReadToday: 0,
        rowsWrittenToday: 0,
        maxReadCap: D1Client.READ_SAFETY_CAP,
        maxWriteCap: D1Client.WRITE_SAFETY_CAP,
        remainingReadBudget: D1Client.READ_SAFETY_CAP,
        remainingWriteBudget: D1Client.WRITE_SAFETY_CAP,
        isReadThrottled: false,
        isWriteThrottled: false
      };
    }
    this.ensureUsageTable();
    const db = getDb();
    const dateKey = new Date().toISOString().split('T')[0];

    const row = db.prepare(`SELECT * FROM d1_usage_state WHERE date_key = ?`).get(dateKey) as any;
    const rowsReadToday = row?.rows_read || 0;
    const rowsWrittenToday = row?.rows_written || 0;

    return {
      dateKey,
      rowsReadToday,
      rowsWrittenToday,
      maxReadCap: D1Client.READ_SAFETY_CAP,
      maxWriteCap: D1Client.WRITE_SAFETY_CAP,
      remainingReadBudget: Math.max(0, D1Client.READ_SAFETY_CAP - rowsReadToday),
      remainingWriteBudget: Math.max(0, D1Client.WRITE_SAFETY_CAP - rowsWrittenToday),
      isReadThrottled: rowsReadToday >= D1Client.READ_SAFETY_CAP,
      isWriteThrottled: rowsWrittenToday >= D1Client.WRITE_SAFETY_CAP
    };
  }

  /**
   * Executes query against Cloudflare D1 HTTP API if configured,
   * otherwise executes locally on SQLite while recording D1 usage metrics.
   */
  public async executeQuery<T = any>(
    sql: string,
    params: any[] = [],
    isWrite = false,
    priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' = 'P1',
    isBackground?: boolean
  ): Promise<{ results: T[]; rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    const trackAsBackground = isBackground === true || this.cycleActive || priority === 'P3' || priority === 'P4';
    this.assertBackgroundBudgetAvailable(sql, priority, isBackground);

    const usage = this.getUsage();

    // Spec § 18: Guard check — when D1 safety cap is approached, pause low priority (P3/P4) queries
    if ((isWrite && usage.isWriteThrottled) || (!isWrite && usage.isReadThrottled)) {
      if (priority === 'P3' || priority === 'P4') {
        throw new Error(`[D1 SAFETY GUARD] Daily budget limit reached for non-critical query (Priority ${priority}). Revenue-critical queries only.`);
      }
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const isRender = process.env.RENDER === 'true';
    const isFinancial = isWrite && isFinancialSql(sql);
    const isDurableRequired = isDurableRequiredSql(sql);
    const enforceDurableFailClosed =
      (isRender && (isFinancial || (isDurableRequired && !process.env.VITEST))) ||
      (isProduction && isDurableRequired && (!process.env.VITEST || isRender || this.isRemoteD1Configured()));

    // Fail-closed enforcement on DURABLE_REQUIRED_TABLES & FINANCIAL_TABLES in production / Render
    if (enforceDurableFailClosed) {
      if (!this.isRemoteD1Configured()) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Durable customer/proposal/financial operations require remote Cloudflare D1 (remote D1 not configured)');
      }
      if (this.isRemoteD1WriteQuotaExhausted() || this.isRemoteD1ReadQuotaExhausted()) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Durable customer/proposal/financial operations require remote Cloudflare D1 (quota circuit breaker active)');
      }
    }

    const remoteAllowed = isWrite ? this.isRemoteD1WriteAllowed() : this.isRemoteD1ReadAllowed();

    if (isWrite && this.isRemoteD1Configured() && !remoteAllowed) {
      if ((isRender && isFinancial) || enforceDurableFailClosed) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Durable writes require remote Cloudflare D1');
      }
      // Stage K D1 Write Isolation: Non-Render dev/test environments write strictly to local SQLite
      const db = getDb();
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      this.recordUsage(0, info.changes || 1, trackAsBackground);
      return { results: [], rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
    }

    if (remoteAllowed) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.getAccountId()}/d1/database/${this.getDatabaseId()}/query`;
      const retryDelays = [250, 750];

      for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
        if (attempt > 0) {
          const jitter = Math.floor(Math.random() * 50);
          await new Promise(r => setTimeout(r, retryDelays[attempt - 1] + jitter));
        }

        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.getApiToken()}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sql, params }),
            signal: AbortSignal.timeout(10000)
          });

          if (!response.ok) {
            const errText = await response.text();
            const cfRay = response.headers?.get?.('cf-ray') || response.headers?.get?.('cf-request-id') || 'none';
            console.error(`[D1Client ERROR] HTTP ${response.status} (cf-ray=${cfRay}): ${errText}`);

            if (D1Client.isDailyQuotaError(response.status, errText)) {
              this.tripQuotaCircuitBreaker(errText, isWrite ? 'write' : 'read');
              if ((isRender && isFinancial) || enforceDurableFailClosed) {
                throw new Error(`D1_DURABLE_WRITE_UNAVAILABLE: Durable operations require remote Cloudflare D1 (${errText})`);
              }
              const db = getDb();
              if (isWrite) {
                const stmt = db.prepare(sql);
                const info = stmt.run(...params);
                this.recordUsage(0, info.changes || 1);
                return { results: [], rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
              } else {
                const stmt = db.prepare(sql);
                const results = stmt.all(...params) as T[];
                this.recordUsage(results.length || 1, 0);
                return { results, rowsAffected: 0, source: 'PERSISTENT_SQLITE' };
              }
            }

            // HTTP 429 throttling, overloaded 7429, or transient 7500 storage / 5xx error retry with bounded exponential backoff + jitter
            const isRetryable =
              response.status === 429 ||
              (response.status === 400 && (errText.includes('7500') || errText.includes('7429'))) ||
              response.status >= 500;
            if (isRetryable && attempt < retryDelays.length) {
              continue;
            }

            if ((isRender && isFinancial) || enforceDurableFailClosed) {
              throw new Error(`D1_DURABLE_WRITE_UNAVAILABLE: Durable operations require remote Cloudflare D1 (HTTP ${response.status}, cf-ray=${cfRay}: ${errText})`);
            }
            if (isProduction) {
              throw new Error(`[D1 PERSISTENCE ERROR] D1 returned HTTP ${response.status} (cf-ray=${cfRay}): ${errText}`);
            }
            console.warn(`[D1Client] Cloudflare D1 HTTP ${response.status} (cf-ray=${cfRay}, ${errText}) — falling back to dev store`);
            break;
          } else {
            const json = await response.json() as any;
            const result = json?.result?.[0];
            const results = result?.results || [];
            const rowsRead = typeof result?.meta?.rows_read === 'number' ? result.meta.rows_read : (results.length || 0);
            const rowsWritten = typeof result?.meta?.rows_written === 'number' ? result.meta.rows_written : (isWrite ? 1 : 0);

            this.recordUsage(rowsRead, rowsWritten, trackAsBackground);
            return { results, rowsAffected: rowsWritten, source: 'CLOUDFLARE_D1' };
          }
        } catch (fetchErr: any) {
          if (fetchErr.message && fetchErr.message.includes('D1_DURABLE_WRITE_UNAVAILABLE')) {
            throw fetchErr;
          }
          if (D1Client.isDailyQuotaError(0, fetchErr?.message || '')) {
            this.tripQuotaCircuitBreaker(fetchErr?.message || '', isWrite ? 'write' : 'read');
            if (isRender && isFinancial) {
              throw new Error(`D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1 (${fetchErr.message})`);
            }
            const db = getDb();
            if (isWrite) {
              const stmt = db.prepare(sql);
              const info = stmt.run(...params);
              this.recordUsage(0, info.changes || 1);
              return { results: [], rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
            } else {
              const stmt = db.prepare(sql);
              const results = stmt.all(...params) as T[];
              this.recordUsage(results.length || 1, 0);
              return { results, rowsAffected: 0, source: 'PERSISTENT_SQLITE' };
            }
          }

          if (attempt < retryDelays.length) {
            const jitter = Math.floor(Math.random() * 50);
            await new Promise(r => setTimeout(r, retryDelays[attempt] + jitter));
            continue;
          }

          if (isRender && isFinancial) {
            throw new Error(`D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1 (${fetchErr.message})`);
          }
          if (isProduction) {
            throw new Error(`[D1 PERSISTENCE FAULT] Production Cloudflare D1 unavailable (${fetchErr.message}). Halting to prevent non-durable state divergence.`);
          }
          console.warn(`[D1Client] Cloudflare D1 query failed (${fetchErr.message}) — falling back to local store in dev/test`);
          break;
        }
      }
    } else if (isProduction && !this.isRemoteD1Configured()) {
      if (isRender && isFinancial) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1');
      }
      throw new Error('[D1 CONFIGURATION FAULT] Production requires remote Cloudflare D1 credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_API_TOKEN). Ephemeral SQLite fallback is strictly prohibited in production.');
    }

    if (isRender && isFinancial) {
      throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1');
    }

    // Local / SQLite execution (Dev / Test / Offline)
    const db = getDb();
    if (isWrite) {
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      this.recordUsage(0, info.changes || 1, trackAsBackground);
      return { results: [], rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
    } else {
      const stmt = db.prepare(sql);
      const results = stmt.all(...params) as T[];
      this.recordUsage(results.length || 1, 0, trackAsBackground);
      return { results, rowsAffected: 0, source: 'PERSISTENT_SQLITE' };
    }
  }

  /**
   * Helper to safely format / interpolate SQL values when assembling multi-statement SQL for Cloudflare D1.
   */
  public static interpolateSql(sql: string, params: any[] = []): string {
    let paramIdx = 0;
    return sql.replace(/\?/g, () => {
      if (paramIdx >= params.length) {
        throw new Error(`Insufficient parameters provided for SQL query.`);
      }
      const val = params[paramIdx++];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
      if (typeof val === 'boolean') return val ? '1' : '0';
      if (val instanceof Date) return `'${val.toISOString()}'`;
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }

  /**
   * Executes a batch of statements sequentially against Cloudflare D1 HTTP API.
   * Note: The Cloudflare D1 HTTP API processes statements sequentially.
   * If a batch contains financial statements:
   * - Failure at index 0 throws D1_DURABLE_WRITE_UNAVAILABLE.
   * - Failure at index > 0 throws D1_PARTIAL_BATCH_FAILURE (local replay aborted to prevent state divergence).
   * - Network timeouts/disconnections throw D1_AMBIGUOUS_OUTCOME.
   * Under no circumstances may financial statements fall back to local SQLite on Render.
   * In local/dev SQLite, executes wrapped in a db.transaction().
   */
  public async executeBatch(
    statements: Array<{ sql: string; params?: any[] }>,
    priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' = 'P0',
    isBackground?: boolean
  ): Promise<{ rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    if (statements.length === 0) {
      return { rowsAffected: 0, source: this.isRemoteD1Configured() ? 'CLOUDFLARE_D1' : 'PERSISTENT_SQLITE' };
    }

    const trackAsBackground = isBackground === true || this.cycleActive || priority === 'P3' || priority === 'P4';
    this.assertBackgroundBudgetAvailable(statements.map(s => s.sql).join(' '), priority, isBackground);

    const usage = this.getUsage();
    if (usage.isWriteThrottled && (priority === 'P3' || priority === 'P4')) {
      throw new Error(`[D1 SAFETY GUARD] Daily budget limit reached for non-critical batch (Priority ${priority}).`);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const isRender = process.env.RENDER === 'true';
    const hasFinancialStatement = statements.some(s => isFinancialSql(s.sql));

    // Fail-closed enforcement for Render on financial statements if remote D1 is unconfigured or either quota circuit breaker is active
    if (isRender && hasFinancialStatement) {
      if (!this.isRemoteD1Configured()) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1 (remote D1 not configured)');
      }
      if (this.isRemoteD1WriteQuotaExhausted() || this.isRemoteD1ReadQuotaExhausted()) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1 (quota circuit breaker active)');
      }
    }

    // In production with remote D1 configured: fail closed if either read or write quota breaker is active
    if (isProduction && this.isRemoteD1Configured()) {
      if (this.isRemoteD1ReadQuotaExhausted() || this.isRemoteD1WriteQuotaExhausted() || !this.isRemoteD1WriteAllowed()) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Production batch writes require durable remote D1 (quota circuit breaker active)');
      }
    }

    if (this.isRemoteD1WriteAllowed()) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.getAccountId()}/d1/database/${this.getDatabaseId()}/query`;
      const retryDelays = [250, 750];
      let totalWritten = 0;
      let fallbackToLocal = false;
      let failedIdx = -1;
      let failureErrorText = '';

      for (let idx = 0; idx < statements.length; idx++) {
        // Concurrent trip guard: if either quota circuit breaker was tripped during this batch, halt immediately
        if (isProduction && (this.isRemoteD1ReadQuotaExhausted() || this.isRemoteD1WriteQuotaExhausted() || !this.isRemoteD1WriteAllowed())) {
          failedIdx = idx;
          fallbackToLocal = true;
          failureErrorText = 'quota circuit breaker active during batch';
          break;
        }

        const s = statements[idx];
        let statementOk = false;

        for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
          if (attempt > 0) {
            const jitter = Math.floor(Math.random() * 50);
            await new Promise(r => setTimeout(r, retryDelays[attempt - 1] + jitter));
          }

          try {
            const response = await fetch(url, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${this.getApiToken()}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ sql: s.sql, params: s.params || [] }),
              signal: AbortSignal.timeout(10000)
            });

            if (!response.ok) {
              const errText = await response.text();
              const cfRay = response.headers?.get?.('cf-ray') || response.headers?.get?.('cf-request-id') || 'none';
              console.error(`[D1Client BATCH ERROR] HTTP ${response.status} (cf-ray=${cfRay}) at index ${idx}: ${errText}`);
              failureErrorText = errText;
              if (D1Client.isDailyQuotaError(response.status, errText)) {
                this.tripQuotaCircuitBreaker(errText, 'write');
                failedIdx = idx;
                fallbackToLocal = true;
                break;
              }

              const isTransient =
                response.status === 429 ||
                (response.status === 400 && (errText.includes('7500') || errText.includes('7429'))) ||
                response.status >= 500;
              if (isTransient && attempt < retryDelays.length) {
                continue;
              }

              failedIdx = idx;
              fallbackToLocal = true;
              break;
            } else {
              const json = await response.json() as any;
              const results = json?.result || [];
              for (const res of results) {
                totalWritten += typeof res?.meta?.rows_written === 'number' ? res.meta.rows_written : (typeof res?.meta?.changes === 'number' ? res.meta.changes : 1);
                const rRead = typeof res?.meta?.rows_read === 'number' ? res.meta.rows_read : 0;
                if (rRead > 0) this.recordUsage(rRead, 0, trackAsBackground);
              }
              statementOk = true;
              break;
            }
          } catch (netErr: any) {
            failureErrorText = netErr?.message || '';
            const isTimeout =
              netErr?.name === 'AbortError' ||
              netErr?.name === 'TimeoutError' ||
              /timeout|aborted|ETIMEDOUT|ECONNRESET/i.test(netErr?.message || '');

            if (D1Client.isDailyQuotaError(0, netErr?.message || '')) {
              this.tripQuotaCircuitBreaker(netErr?.message || '', 'write');
              failedIdx = idx;
              fallbackToLocal = true;
              break;
            }
            if (attempt < retryDelays.length) {
              const jitter = Math.floor(Math.random() * 50);
              await new Promise(r => setTimeout(r, retryDelays[attempt] + jitter));
              continue;
            }
            if (hasFinancialStatement && isTimeout) {
              throw new Error(
                `D1_AMBIGUOUS_OUTCOME: Network timeout or disconnection during batch execution at statement index ${idx}. Outcome ambiguous; local replay aborted.`
              );
            }
            failedIdx = idx;
            fallbackToLocal = true;
            break;
          }
        }

        if (!statementOk) {
          break;
        }
      }

      if (fallbackToLocal && failedIdx >= 0) {
        if (failedIdx > 0) {
          throw new Error(`D1_PARTIAL_BATCH_FAILURE: Statement at index ${failedIdx} failed after earlier statements committed. Local replay aborted.`);
        }
        if (hasFinancialStatement) {
          throw new Error(`D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1 (${failureErrorText})`);
        }
        if (isProduction) {
          if (this.isRemoteD1ReadQuotaExhausted() || this.isRemoteD1WriteQuotaExhausted()) {
            throw new Error(`D1_DURABLE_WRITE_UNAVAILABLE: Production batch writes require durable remote D1 (${failureErrorText})`);
          }
          throw new Error(`[D1 PERSISTENCE ERROR] D1 batch statement failed at index ${failedIdx}: ${failureErrorText}`);
        }
        if (!(this.isRemoteD1ReadQuotaExhausted() || this.isRemoteD1WriteQuotaExhausted())) {
          console.warn(`[D1Client] Cloudflare D1 batch statement failed at index ${failedIdx} (${failureErrorText}) — falling back to dev store`);
        }
      } else if (!fallbackToLocal) {
        this.recordUsage(0, totalWritten, trackAsBackground);
        return { rowsAffected: totalWritten, source: 'CLOUDFLARE_D1' };
      }
    } else if (isProduction && !this.isRemoteD1Configured()) {
      if (isRender && hasFinancialStatement) {
        throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1');
      }
      throw new Error('[D1 CONFIGURATION FAULT] Production requires remote Cloudflare D1 credentials (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_D1_API_TOKEN). Ephemeral SQLite fallback is strictly prohibited in production.');
    }

    if (isProduction && this.isRemoteD1Configured()) {
      throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Production batch writes require durable remote D1');
    }

    if (isRender && hasFinancialStatement) {
      throw new Error('D1_DURABLE_WRITE_UNAVAILABLE: Financial writes require durable remote D1');
    }

    // Local / SQLite execution (Dev / Test / Offline) wrapped in transaction
    const db = getDb();
    let totalChanges = 0;
    const runBatch = db.transaction((stmts: Array<{ sql: string; params?: any[] }>) => {
      for (const s of stmts) {
        const stmt = db.prepare(s.sql);
        const info = stmt.run(...(s.params || []));
        totalChanges += info.changes || 1;
      }
    });

    runBatch(statements);
    this.recordUsage(0, totalChanges, trackAsBackground);
    return { rowsAffected: totalChanges, source: 'PERSISTENT_SQLITE' };
  }
}
