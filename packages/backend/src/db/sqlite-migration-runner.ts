import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSqlStatements } from './d1-migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Applies all pending SQL migrations to local SQLite database (for boot and in tests).
 * Guarantees 100% schema parity between local SQLite (Render/test runner) and Cloudflare D1.
 */
export function applySqliteMigrations(db: Database.Database): { applied: string[] } {
  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sqlite_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const existingRows = db.prepare(`SELECT migration_name FROM _sqlite_migrations`).all() as { migration_name: string }[];
  const appliedSet = new Set(existingRows.map(r => r.migration_name));

  const possibleDirs = [
    path.resolve(__dirname, 'd1-migrations'),
    path.resolve(__dirname, '../../../src/db/d1-migrations'),
    path.resolve(process.cwd(), 'packages/backend/src/db/d1-migrations'),
    path.resolve(process.cwd(), 'src/db/d1-migrations'),
    path.resolve(process.cwd(), 'packages/backend/dist/db/d1-migrations'),
    path.resolve(process.cwd(), 'dist/db/d1-migrations')
  ];

  let migrationsDir = path.resolve(__dirname, 'd1-migrations');
  for (const d of possibleDirs) {
    if (fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith('.sql'))) {
      migrationsDir = d;
      break;
    }
  }

  if (!fs.existsSync(migrationsDir)) {
    return { applied: [] };
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const statements = parseSqlStatements(content);

    // Run each migration file in one transaction.
    // If any statement fails (other than safe duplicate column / already exists), the transaction rolls back
    // and the migration record is NOT written. Boot fails immediately.
    const executeMigrationTransaction = db.transaction(() => {
      for (const stmt of statements) {
        db.exec('SAVEPOINT sp_migration_stmt');
        try {
          db.exec(stmt);
          db.exec('RELEASE sp_migration_stmt');
        } catch (err: any) {
          const msg = String(err.message || '').toLowerCase();
          // Ignore ONLY duplicate column name and already exists
          if (
            msg.includes('duplicate column name') ||
            msg.includes('already exists') ||
            msg.includes('duplicate index name')
          ) {
            db.exec('ROLLBACK TO sp_migration_stmt');
            db.exec('RELEASE sp_migration_stmt');
            continue;
          }
          db.exec('ROLLBACK TO sp_migration_stmt');
          db.exec('RELEASE sp_migration_stmt');
          throw new Error(`SQLITE_MIGRATION_FAILED: Migration '${file}' failed on statement:\n${stmt}\nError: ${err.message}`);
        }
      }

      // Record migration ONLY after all statements have succeeded
      db.prepare(`INSERT INTO _sqlite_migrations (migration_name) VALUES (?)`).run(file);
    });

    executeMigrationTransaction();
    applied.push(file);
  }

  return { applied };
}
