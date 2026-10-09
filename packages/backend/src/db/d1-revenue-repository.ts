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
  'stored_reports'
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

  /**
   * Executes a write operation for a revenue-critical table.
   * In production, routes through Cloudflare D1 exclusively; throws if unconfigured or fails.
   * In local/test, executes via SQLite.
   */
  public async executeWrite(
    table: D1RevenueCriticalTable,
    sql: string,
    params: any[] = []
  ): Promise<{ rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    if (isProduction()) {
      if (this.d1.isRemoteD1Configured()) {
        const res = await this.d1.executeQuery(sql, params, true, 'P0');
        return { rowsAffected: res.rowsAffected, source: 'CLOUDFLARE_D1' };
      }
      if (!process.env.VITEST) {
        throw new Error(`PERSISTENCE_FAULT: Table '${table}' write requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
      }
    }
    const db = getDb();
    const info = db.prepare(sql).run(...params);
    return { rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
  }

  /**
   * Executes a read operation for a revenue-critical table.
   * In production, routes through Cloudflare D1 exclusively; throws if unconfigured or fails.
   * In local/test, executes via SQLite.
   */
  public async executeRead<T = any>(
    table: D1RevenueCriticalTable,
    sql: string,
    params: any[] = []
  ): Promise<{ results: T[]; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    if (isProduction()) {
      if (this.d1.isRemoteD1Configured()) {
        const res = await this.d1.executeQuery<T>(sql, params, false, 'P0');
        return { results: res.results, source: 'CLOUDFLARE_D1' };
      }
      if (!process.env.VITEST) {
        throw new Error(`PERSISTENCE_FAULT: Table '${table}' read requires durable Cloudflare D1 storage in production. SQLite fallback is strictly prohibited.`);
      }
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
