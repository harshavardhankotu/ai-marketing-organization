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
  'search_cache'
] as const;

export type D1RevenueCriticalTable = typeof D1_REVENUE_CRITICAL_TABLES[number];

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
      this.d1.assertDurableStorageForEntity(table);
    }
  }

  /**
   * Executes a write operation for a revenue-critical table.
   * In production, routes through Cloudflare D1 if configured; throws if unconfigured.
   * In local/test, executes via SQLite.
   */
  public async executeWrite(
    table: D1RevenueCriticalTable,
    sql: string,
    params: any[] = []
  ): Promise<{ rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    this.assertDurableStorage(table);
    if (isProduction()) {
      if (this.d1.isRemoteD1Configured()) {
        const res = await this.d1.executeQuery(sql, params, true, 'P0');
        // Update local SQLite as read-cache
        try {
          const db = getDb();
          db.prepare(sql).run(...params);
        } catch {}
        return { rowsAffected: res.rowsAffected, source: 'CLOUDFLARE_D1' };
      } else {
        throw new Error(`PRODUCTION SECURITY ERROR: Table ${table} write requires durable Cloudflare D1 storage in production.`);
      }
    }
    const db = getDb();
    const info = db.prepare(sql).run(...params);
    return { rowsAffected: info.changes, source: 'PERSISTENT_SQLITE' };
  }

  /**
   * Executes a read operation for a revenue-critical table.
   * In production with Cloudflare D1, routes through D1 HTTP API.
   * In local/test, executes via SQLite.
   */
  public async executeRead<T = any>(
    table: D1RevenueCriticalTable,
    sql: string,
    params: any[] = []
  ): Promise<{ results: T[]; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    this.assertDurableStorage(table);
    if (isProduction() && this.d1.isRemoteD1Configured()) {
      const res = await this.d1.executeQuery<T>(sql, params, false, 'P0');
      return { results: res.results, source: 'CLOUDFLARE_D1' };
    }
    const db = getDb();
    const results = db.prepare(sql).all(...params) as T[];
    return { results, source: 'PERSISTENT_SQLITE' };
  }
}
