import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema.js';

let dbInstance: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  const resolvedPath = dbPath || process.env.DATABASE_PATH || path.resolve(process.cwd(), 'ai_marketing.sqlite');
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  db.exec(SCHEMA_SQL);

  // Safe schema migrations for existing persistent SQLite databases
  try {
    db.exec(`ALTER TABLE learnings ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'TEST_LEARNING'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN api_token TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN source_type TEXT NOT NULL DEFAULT 'TEST_DATA'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN source_reference TEXT NOT NULL DEFAULT 'DETERMINISTIC_TEST_FIXTURE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN retrieved_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'NO_REAL_WORLD_EVIDENCE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'TEST_DATA'`);
  } catch {}

  dbInstance = db;
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbForTesting(): Database.Database {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  dbInstance = db;
  return dbInstance;
}