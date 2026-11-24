import {
  D1Client,
  FINANCIAL_TABLES,
  DURABLE_REQUIRED_TABLES,
  isFinancialSql,
  isDurableRequiredTable,
  isDurableRequiredSql
} from './d1-client.js';
import { getDb } from './client.js';
import { isProduction } from '../config/env.js';

export { DURABLE_REQUIRED_TABLES };

export const D1_REVENUE_CRITICAL_TABLES = [
  'payment_requests',
  'payment_provider_links',
  'payment_orders',
  'transactions',
  'revenue_records',
  'platform_prospects',
  'opportunities',
  'sales_pipeline',
  'outbound_contacts',
  'outbound_action_ledger',
  'proposals',
  'commercial_evidence',
  'autonomous_action_traces',
  'autonomous_cycle_log',
  'platform_customer_deliveries',
  'owner_sessions',
  'durable_events',
  'cron_telemetry',
  'learning_records',
  'search_cache',
  'search_queries_log',
  'direct_outreach_log',
  'outreach_suppression_list',
  'businesses',
  'organizations',
  'customer_journeys',
  'delivery_tasks',
  'workflows',
  'experiments',
  'provider_quota_state',
  'business_autonomy_lock',
  'analytics_events',
  'campaigns',
  'business_goals',
  'funnels',
  'customer_offers',
  'availability_slots',
  'booking_reservations',
  'universal_orders',
  'fulfillment_tasks',
  'idempotent_actions',
  'partners',
  'partner_offers',
  'referrals',
  'referral_click_events',
  'traffic_sessions',
  'commission_records',
  'commission_content_assets',
  'demand_signals',
  'durable_rate_limits',
  'provider_call_logs',
  'action_cooldowns',
  'owner_intake',
  'product_proposals',
  'owner_status_snapshots',
  'provider_drift_records',
  'stored_reports',
  'reply_desk_drafts',
  'reply_desk_query_runs',
  'provider_quota_ledger',
  'sector_bandit_states',
  'commercial_reward_events',
  'public_deals',
  'site_audits',
  'cuelinks_campaigns'
] as const;

export type D1RevenueCriticalTable = typeof D1_REVENUE_CRITICAL_TABLES[number] | string;

export class D1RevenueRepository {
  private static instance: D1RevenueRepository;
  private d1 = D1Client.getInstance();

  public static getInstance(): D1RevenueRepository {
    if (!D1RevenueRepository.instance) {
      D1RevenueRepository.instance = new D1RevenueRepository();
    }
    return D1RevenueRepository.instance;
  }

  public assertDurableStorage(table: D1RevenueCriticalTable): void {
    if (isProduction()) {
      this.d1.assertDurableStorageForEntity(String(table));
    }
  }

  public isRemoteD1Configured(): boolean {
    return this.d1.isRemoteD1Configured();
  }

  public isRemoteD1ReadAllowed(): boolean {
    return this.d1.isRemoteD1ReadAllowed();
  }

  public isRemoteD1WriteAllowed(): boolean {
    return this.d1.isRemoteD1WriteAllowed();
  }

  /**
   * Executes a write operation for a revenue-critical table.
   * Only writes to remote Cloudflare D1 when RENDER === 'true' or ALLOW_REMOTE_D1_WRITES === 'true'
   * (outside Vitest). Non-Render dev/test sandboxes write exclusively to local SQLite.
   */
  public async executeWrite(
    table: D1RevenueCriticalTable,
    sql: string,
    params: any[] = []
  ): Promise<{ rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    const isFinancialTable = FINANCIAL_TABLES.includes(table as any) || isFinancialSql(sql);
    const isDurableRequired = isFinancialTable || isDurableRequiredTable(String(table)) || isDurableRequiredSql(sql);
    if (this.d1.isCycleActive() || this.d1.isDailyBackgroundBudgetExceeded()) {
      this.d1.assertBackgroundBudgetAvailable(sql, 'P0', this.d1.isCycleActive());
    }

    const shouldSyncRemoteD1 = this.d1.isRemoteD1WriteAllowed();
    if (shouldSyncRemoteD1) {
      const res = await this.d1.executeQuery(sql, params, true, 'P0');
      // Spec Stage P.2: Never mirror financial/durable-required tables to local SQLite, and avoid duplicate write if already executed in SQLite
      if (!isFinancialTable && res.source !== 'PERSISTENT_SQLITE') {
        try {
          const db = getDb();
          db.prepare(sql).run(...params);
        } catch {}
      }
      return { rowsAffected: res.rowsAffected, source: res.source };
    }

    if (process.env.RENDER === 'true' && isFinancialTable) {
      throw new Error(
        `SERVICE_UNAVAILABLE: D1_DURABLE_WRITE_UNAVAILABLE: Financial writes on '${table}' require durable Cloudflare D1 storage. Render ephemeral disk fallback is strictly prohibited for money records.`
      );
    }

    const strictProdDurable =
      (process.env.RENDER === 'true' && !process.env.VITEST) ||
      (isProduction() && (!process.env.VITEST || this.d1.isRemoteD1Configured()));
    if (strictProdDurable && isDurableRequired) {
      throw new Error(
        `SERVICE_UNAVAILABLE: D1_DURABLE_WRITE_UNAVAILABLE: Durable table '${table}' write requires available remote Cloudflare D1 storage in production. Ephemeral SQLite fallback is strictly prohibited.`
      );
    }

    if (isProduction() && !process.env.VITEST && !this.d1.isRemoteD1Configured()) {
      throw new Error(`PERSISTENCE_FAULT: Table '${table}' write requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
    }
    const db = getDb();
    const info = db.prepare(sql).run(...params);
    if (this.d1.isCycleActive() && !isFinancialTable) {
      this.d1.recordCycleUsage(0, info.changes || 1, true);
    }
    return { rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
  }

  /**
   * Executes a batch of write operations atomically across revenue-critical tables.
   * Only writes to remote Cloudflare D1 when RENDER === 'true' or ALLOW_REMOTE_D1_WRITES === 'true'.
   */
  public async executeBatch(
    operations: Array<{ table: D1RevenueCriticalTable; sql: string; params?: any[] }>
  ): Promise<{ rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    const shouldSyncRemoteD1 = this.d1.isRemoteD1WriteAllowed();
    if (operations.length === 0) {
      return { rowsAffected: 0, source: shouldSyncRemoteD1 ? 'CLOUDFLARE_D1' : 'PERSISTENT_SQLITE' };
    }

    const hasFinancialTable = operations.some(
      o => FINANCIAL_TABLES.includes(o.table as any) || isFinancialSql(o.sql)
    );
    const hasDurableRequired = hasFinancialTable || operations.some(
      o => isDurableRequiredTable(String(o.table)) || isDurableRequiredSql(o.sql)
    );
    if (this.d1.isCycleActive() || this.d1.isDailyBackgroundBudgetExceeded()) {
      this.d1.assertBackgroundBudgetAvailable(operations.map(o => o.sql).join(' '), 'P0', this.d1.isCycleActive());
    }

    if (shouldSyncRemoteD1) {
      const res = await this.d1.executeBatch(operations.map(o => ({ sql: o.sql, params: o.params })), 'P0');
      // Spec Stage P.2: Never mirror financial tables to local SQLite, and avoid duplicate write if already executed in SQLite
      if (!hasFinancialTable && res.source !== 'PERSISTENT_SQLITE') {
        try {
          const db = getDb();
          const syncBatch = db.transaction((ops: typeof operations) => {
            for (const op of ops) {
              db.prepare(op.sql).run(...(op.params || []));
            }
          });
          syncBatch(operations);
        } catch {}
      }
      return { rowsAffected: res.rowsAffected, source: res.source };
    }

    if (process.env.RENDER === 'true' && hasFinancialTable) {
      throw new Error(
        `SERVICE_UNAVAILABLE: D1_DURABLE_WRITE_UNAVAILABLE: Financial batch writes require durable Cloudflare D1 storage. Render ephemeral disk fallback is strictly prohibited for money records.`
      );
    }

    const strictProdDurable =
      (process.env.RENDER === 'true' && !process.env.VITEST) ||
      (isProduction() && (!process.env.VITEST || this.d1.isRemoteD1Configured()));
    if (strictProdDurable && hasDurableRequired) {
      const tableList = operations.map(o => o.table).join(', ');
      throw new Error(
        `SERVICE_UNAVAILABLE: D1_DURABLE_WRITE_UNAVAILABLE: Batch write on [${tableList}] requires durable Cloudflare D1 storage in production. Ephemeral SQLite fallback is strictly prohibited.`
      );
    }

    if (isProduction() && !process.env.VITEST && !this.d1.isRemoteD1Configured()) {
      const tableList = operations.map(o => o.table).join(', ');
      throw new Error(`PERSISTENCE_FAULT: Batch write on [${tableList}] requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
    }

    const db = getDb();
    let totalChanges = 0;
    const runBatch = db.transaction((ops: typeof operations) => {
      for (const op of ops) {
        const info = db.prepare(op.sql).run(...(op.params || []));
        totalChanges += info.changes || 1;
      }
    });
    runBatch(operations);
    if (this.d1.isCycleActive() && !hasFinancialTable) {
      this.d1.recordCycleUsage(0, totalChanges, true);
    }
    return { rowsAffected: totalChanges, source: 'PERSISTENT_SQLITE' };
  }

  /**
   * Executes a read operation for a revenue-critical table.
   * Reads from remote Cloudflare D1 when isRemoteD1ReadAllowed() is true (production / Render / explicit opt-in),
   * and reads local SQLite cleanly in non-Render dev/test or when daily quota circuit breaker is tripped.
   */
  public async executeRead<T = any>(
    table: D1RevenueCriticalTable,
    sql: string,
    params: any[] = []
  ): Promise<{ results: T[]; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    const isFinancialTable = FINANCIAL_TABLES.includes(table as any) || isFinancialSql(sql);
    const isDurableRequired = isFinancialTable || isDurableRequiredTable(String(table)) || isDurableRequiredSql(sql);
    if (this.d1.isCycleActive() || this.d1.isDailyBackgroundBudgetExceeded()) {
      this.d1.assertBackgroundBudgetAvailable(sql, 'P0', this.d1.isCycleActive());
    }
    const shouldQueryRemoteD1 = this.d1.isRemoteD1ReadAllowed();
    if (shouldQueryRemoteD1) {
      const res = await this.d1.executeQuery<T>(sql, params, false, 'P0');
      return { results: res.results, source: res.source };
    }
    const strictProdDurable =
      (process.env.RENDER === 'true' && !process.env.VITEST) ||
      (isProduction() && (!process.env.VITEST || this.d1.isRemoteD1Configured()));
    if (strictProdDurable && isDurableRequired) {
      throw new Error(
        `SERVICE_UNAVAILABLE: D1_DURABLE_WRITE_UNAVAILABLE: Durable table '${table}' read requires available remote Cloudflare D1 storage in production. Ephemeral SQLite fallback is strictly prohibited.`
      );
    }
    if (isProduction() && !process.env.VITEST && !this.d1.isRemoteD1QuotaExhausted() && !this.d1.isRemoteD1Configured()) {
      throw new Error(`PERSISTENCE_FAULT: Table '${table}' read requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
    }
    const db = getDb();
    const results = db.prepare(sql).all(...params) as T[];
    if (this.d1.isCycleActive() && !isFinancialTable) {
      this.d1.recordCycleUsage(results.length || 1, 0, true);
    }
    return { results, source: 'PERSISTENT_SQLITE' };
  }

  /**
   * Convenience async query for multiple rows
   */
  public async query<T = any>(table: D1RevenueCriticalTable, sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.executeRead<T>(table, sql, params);
    return res.results;
  }

  /**
   * Convenience async query for single row
   */
  public async queryOne<T = any>(table: D1RevenueCriticalTable, sql: string, params: any[] = []): Promise<T | null> {
    const res = await this.executeRead<T>(table, sql, params);
    return res.results[0] || null;
  }

  /**
   * Synchronous query for dev/test runners ONLY.
   * In production, this fails immediately to prevent accidental non-durable reads.
   */
  public querySync<T = any>(table: D1RevenueCriticalTable, sql: string, params: any[] = []): T[] {
    if (isProduction() && !process.env.VITEST) {
      throw new Error(`PRODUCTION D1 VIOLATION: Synchronous query on table '${table}' is forbidden in production. Must use async executeRead/query.`);
    }
    const db = getDb();
    return db.prepare(sql).all(...params) as T[];
  }

  /**
   * Synchronous queryOne for dev/test runners ONLY.
   * In production, this fails immediately to prevent accidental non-durable reads.
   */
  public queryOneSync<T = any>(table: D1RevenueCriticalTable, sql: string, params: any[] = []): T | null {
    if (isProduction() && !process.env.VITEST) {
      throw new Error(`PRODUCTION D1 VIOLATION: Synchronous queryOne on table '${table}' is forbidden in production. Must use async executeRead/queryOne.`);
    }
    const db = getDb();
    return (db.prepare(sql).get(...params) as T) || null;
  }

  /**
   * Synchronous execute for dev/test runners ONLY.
   * In production, this fails immediately to prevent accidental non-durable writes.
   */
  public executeSync(table: D1RevenueCriticalTable, sql: string, params: any[] = []): { changes: number } {
    if (isProduction() && !process.env.VITEST) {
      throw new Error(`PRODUCTION D1 VIOLATION: Synchronous execute on table '${table}' is forbidden in production. Must use async executeWrite.`);
    }
    const db = getDb();
    const info = db.prepare(sql).run(...params);
    return { changes: info.changes };
  }
}
