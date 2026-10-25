import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SCHEMA_SQL } from '../../src/db/schema.js';
import { applySqliteMigrations } from '../../src/db/sqlite-migration-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../../src/db/d1-migrations');

describe('SQLite Migration 0038 Schema Resilience & Idempotency (P1 Fix)', () => {
  it('applies cleanly on a fresh database initialized with SCHEMA_SQL and records 0038', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    
    // Standard backend initialization flow: SCHEMA_SQL followed by applySqliteMigrations
    db.exec(SCHEMA_SQL);
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Primary', 'owner-primary')`).run();
    db.prepare(`INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice) VALUES ('biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'vert_tech', 'Tech', 'Bangalore', 'Indiranagar', 'Helpful')`).run();

    const result = applySqliteMigrations(db);
    expect(result.applied).toContain('0038_quarantine_test_records_and_add_is_test.sql');

    // Verify opportunities table has is_test, title, and prospect_id
    const columns = db.pragma('table_info(opportunities)') as { name: string }[];
    const colNames = columns.map(c => c.name);
    expect(colNames).toContain('is_test');
    expect(colNames).toContain('title');
    expect(colNames).toContain('prospect_id');

    // Verify _sqlite_migrations record
    const recorded = db.prepare(`SELECT migration_name FROM _sqlite_migrations WHERE migration_name = ?`).get(
      '0038_quarantine_test_records_and_add_is_test.sql'
    );
    expect(recorded).toBeDefined();

    db.close();
  });

  it('safely upgrades an older existing schema where opportunities.title is absent', () => {
    const db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    db.prepare(`INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org_owner_primary', 'Owner Primary', 'owner-primary')`).run();
    db.prepare(`INSERT OR IGNORE INTO businesses (id, organization_id, name, vertical_id, vertical_name, city, neighborhood, brand_voice) VALUES ('biz_platform_aro', 'org_owner_primary', 'Platform ARO', 'vert_tech', 'Tech', 'Bangalore', 'Indiranagar', 'Helpful')`).run();

    // Ensure migration table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS _sqlite_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        migration_name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Pre-populate all migration files up to 0037 as already applied
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && f < '0038_');
    
    for (const f of files) {
      db.prepare(`INSERT OR IGNORE INTO _sqlite_migrations (migration_name) VALUES (?)`).run(f);
    }

    // Now re-create opportunities without title or prospect_id (as produced by legacy client.ts:163)
    db.exec(`
      DROP TABLE IF EXISTS opportunities;
      CREATE TABLE opportunities (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DISCOVERED'
      );
    `);

    // Insert legacy opportunity test row
    db.prepare(`
      INSERT INTO opportunities (id, business_id, organization_id, status)
      VALUES ('opp_legacy_test_1', 'biz_smilekraft_hyd', 'org_owner_primary', 'DISCOVERED')
    `).run();

    // Verify title column is indeed missing before 0038 runs
    const beforeCols = (db.pragma('table_info(opportunities)') as { name: string }[]).map(c => c.name);
    expect(beforeCols).not.toContain('title');
    expect(beforeCols).not.toContain('prospect_id');

    // Run migration 0038 — must succeed and add title without crashing on UPDATE
    const result = applySqliteMigrations(db);
    expect(result.applied).toContain('0038_quarantine_test_records_and_add_is_test.sql');

    // Verify title column was added
    const afterCols = (db.pragma('table_info(opportunities)') as { name: string }[]).map(c => c.name);
    expect(afterCols).toContain('title');
    expect(afterCols).toContain('prospect_id');
    expect(afterCols).toContain('is_test');

    // Verify test record was quarantined
    const row = db.prepare(`SELECT status, is_test FROM opportunities WHERE id = 'opp_legacy_test_1'`).get() as any;
    expect(row.status).toBe('TEST_QUARANTINED');
    expect(row.is_test).toBe(1);

    // Verify _sqlite_migrations recorded successful application
    const recorded = db.prepare(`SELECT migration_name FROM _sqlite_migrations WHERE migration_name = ?`).get(
      '0038_quarantine_test_records_and_add_is_test.sql'
    );
    expect(recorded).toBeDefined();

    db.close();
  });

  it('rolls back and does not record migration in _sqlite_migrations if a fatal error occurs', () => {
    const db = new Database(':memory:');
    
    // Omit required tables so migration 0001 fails
    db.exec(`
      CREATE TABLE platform_prospects (id TEXT PRIMARY KEY);
    `);

    expect(() => applySqliteMigrations(db)).toThrow(/SQLITE_MIGRATION_FAILED/);

    // Ensure _sqlite_migrations exists but does NOT record 0038
    const recorded = db.prepare(`SELECT migration_name FROM _sqlite_migrations WHERE migration_name = ?`).get(
      '0038_quarantine_test_records_and_add_is_test.sql'
    );
    expect(recorded).toBeUndefined();

    db.close();
  });
});
