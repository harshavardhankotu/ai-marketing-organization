import { D1Client } from './d1-client.js';
import { getDb } from './client.js';
import { isProduction } from '../config/env.js';

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
    const shouldSyncRemoteD1 = this.d1.isRemoteD1WriteAllowed();
    if (shouldSyncRemoteD1) {
      const res = await this.d1.executeQuery(sql, params, true, 'P0');
      try {
        const db = getDb();
        db.prepare(sql).run(...params);
      } catch {}
      return { rowsAffected: res.rowsAffected, source: res.source };
    }
    if (isProduction() && !process.env.VITEST && !this.d1.isRemoteD1Configured()) {
      throw new Error(`PERSISTENCE_FAULT: Table '${table}' write requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
    }
    const db = getDb();
    const info = db.prepare(sql).run(...params);
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

    if (shouldSyncRemoteD1) {
      const res = await this.d1.executeBatch(operations.map(o => ({ sql: o.sql, params: o.params })), 'P0');
      try {
        const db = getDb();
        const syncBatch = db.transaction((ops: typeof operations) => {
          for (const op of ops) {
            db.prepare(op.sql).run(...(op.params || []));
          }
        });
        syncBatch(operations);
      } catch {}
      return { rowsAffected: res.rowsAffected, source: res.source };
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
    const shouldQueryRemoteD1 = this.d1.isRemoteD1ReadAllowed();
    if (shouldQueryRemoteD1) {
      const res = await this.d1.executeQuery<T>(sql, params, false, 'P0');
      return { results: res.results, source: res.source };
    }
    if (isProduction() && !process.env.VITEST && !this.d1.isRemoteD1QuotaExhausted() && !this.d1.isRemoteD1Configured()) {
      throw new Error(`PERSISTENCE_FAULT: Table '${table}' read requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
    }
    const db = getDb();
    const results = db.prepare(sql).all(...params) as T[];
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
