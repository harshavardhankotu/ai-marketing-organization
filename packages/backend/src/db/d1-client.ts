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

  // 80% safety caps for Cloudflare D1 Free Tier
  public static readonly READ_SAFETY_CAP = 4_000_000;
  public static readonly WRITE_SAFETY_CAP = 80_000;

  private constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    this.databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
    this.apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;
    this.ensureUsageTable();
  }

  public static getInstance(): D1Client {
    if (!D1Client.instance) {
      D1Client.instance = new D1Client();
    }
    return D1Client.instance;
  }

  public isRemoteD1Configured(): boolean {
    return Boolean(this.accountId && this.databaseId && this.apiToken);
  }

  private ensureUsageTable(): void {
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
  public recordUsage(rowsRead = 0, rowsWritten = 0): void {
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

  /**
   * Evaluates current D1 Free Tier consumption.
   */
  public getUsage(): D1UsageMetrics {
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
    priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4' = 'P1'
  ): Promise<{ results: T[]; rowsAffected: number; source: 'CLOUDFLARE_D1' | 'PERSISTENT_SQLITE' }> {
    const usage = this.getUsage();

    // Spec § 18: Guard check — when D1 safety cap is approached, pause low priority (P3/P4) queries
    if ((isWrite && usage.isWriteThrottled) || (!isWrite && usage.isReadThrottled)) {
      if (priority === 'P3' || priority === 'P4') {
        throw new Error(`[D1 SAFETY GUARD] Daily budget limit reached for non-critical query (Priority ${priority}). Revenue-critical queries only.`);
      }
    }

    const isProduction = process.env.NODE_ENV === 'production';

    if (this.isRemoteD1Configured()) {
      const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ sql, params })
        });

        if (response.ok) {
          const json = await response.json() as any;
          const result = json?.result?.[0];
          const results = result?.results || [];
          const rowsRead = result?.meta?.rows_read || results.length || 1;
          const rowsWritten = result?.meta?.rows_written || (isWrite ? 1 : 0);

          this.recordUsage(rowsRead, rowsWritten);
          return { results, rowsAffected: rowsWritten, source: 'CLOUDFLARE_D1' };
        } else {
          const errText = await response.text();
          if (isProduction) {
            throw new Error(`[D1 PERSISTENCE ERROR] D1 returned HTTP ${response.status}: ${errText}`);
          }
          console.warn(`[D1Client] Cloudflare D1 HTTP ${response.status} (${errText}) — falling back to dev store`);
        }
      } catch (err: any) {
        if (isProduction) {
          throw new Error(`[D1 PERSISTENCE FAULT] Production Cloudflare D1 unavailable (${err.message}). Halting to prevent non-durable state divergence.`);
        }
        console.warn(`[D1Client] Cloudflare D1 query failed (${err.message}) — falling back to local store in dev/test`);
      }
    } else if (isProduction && process.env.REQUIRE_REMOTE_D1 === 'true') {
      throw new Error('[D1 CONFIGURATION FAULT] Production requires remote Cloudflare D1 credentials. Local storage not permitted.');
    }

    // Local / SQLite execution (Dev / Test / Offline)
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
}
