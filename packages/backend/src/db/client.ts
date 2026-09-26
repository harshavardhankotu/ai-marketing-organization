import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema.js';

let dbInstance: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  let resolvedPath = dbPath || process.env.DATABASE_PATH;
  if (!resolvedPath) {
    const rootDb = path.resolve(process.cwd(), 'ai_marketing.sqlite');
    const siblingDb = path.resolve(process.cwd(), '../ai_marketing.sqlite');
    const parentDb = path.resolve(process.cwd(), '../../ai_marketing.sqlite');
    const pkgDb = path.resolve(process.cwd(), 'packages/backend/ai_marketing.sqlite');

    if (fs.existsSync(rootDb)) {
      resolvedPath = rootDb;
    } else if (fs.existsSync(siblingDb)) {
      resolvedPath = siblingDb;
    } else if (fs.existsSync(parentDb)) {
      resolvedPath = parentDb;
    } else if (fs.existsSync(pkgDb)) {
      resolvedPath = pkgDb;
    } else {
      resolvedPath = rootDb;
    }
  }

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Safe schema migrations for existing persistent SQLite databases before index creation
  try {
    db.exec(`ALTER TABLE customer_journeys ADD COLUMN gclid TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE customer_journeys ADD COLUMN attribution_status TEXT NOT NULL DEFAULT 'UNVERIFIED'`);
  } catch {}
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
  try {
    db.exec(`ALTER TABLE google_clicks ADD COLUMN device TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE google_clicks ADD COLUMN click_type TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE marketing_memories ADD COLUMN maturity TEXT NOT NULL DEFAULT 'HYPOTHESIS'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE marketing_memories ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE marketing_memories ADD COLUMN verified_revenue_inr REAL NOT NULL DEFAULT 0.0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE knowledge_graph_edges ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE knowledge_graph_edges ADD COLUMN evidence_id TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE knowledge_graph_edges ADD COLUMN timestamp TEXT NOT NULL DEFAULT (datetime('now'))`);
  } catch {}
  try {
    db.exec(`ALTER TABLE predictions ADD COLUMN status TEXT NOT NULL DEFAULT 'PREDICTION_PENDING'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN pending_predictions_count INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN resolved_predictions_count INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN sample_size_tier TEXT NOT NULL DEFAULT 'PILOT_SAMPLE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN confidence_level TEXT NOT NULL DEFAULT 'LOW'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN is_top_performer INTEGER NOT NULL DEFAULT 0`);
  } catch {}

  // Autonomous Revenue Organization — new table migration guards
  // These are safe no-ops if the tables already exist (SCHEMA_SQL handles full creation)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      source TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
      estimated_value_inr REAL NOT NULL DEFAULT 0, probability REAL NOT NULL DEFAULT 0,
      acquisition_cost_inr REAL NOT NULL DEFAULT 0, time_to_revenue_days INTEGER NOT NULL DEFAULT 30,
      authorization_requirements_json TEXT NOT NULL DEFAULT '[]', risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
      next_best_action TEXT, status TEXT NOT NULL DEFAULT 'DISCOVERED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS durable_events (
      id TEXT PRIMARY KEY, event_type TEXT NOT NULL, business_id TEXT,
      organization_id TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      processed INTEGER NOT NULL DEFAULT 0, processed_at TEXT,
      triggered_agents_json TEXT NOT NULL DEFAULT '[]', error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS autonomous_cycle_log (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT,
      trigger_source TEXT NOT NULL DEFAULT 'SCHEDULER', cycle_start TEXT NOT NULL DEFAULT (datetime('now')),
      cycle_end TEXT, status TEXT NOT NULL DEFAULT 'RUNNING',
      opportunities_discovered INTEGER NOT NULL DEFAULT 0, opportunities_qualified INTEGER NOT NULL DEFAULT 0,
      actions_taken INTEGER NOT NULL DEFAULT 0, revenue_recorded_inr REAL NOT NULL DEFAULT 0,
      next_best_action TEXT, next_cycle_at TEXT, error_message TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`);
  } catch {}

  // Initialize schema (creates all tables if not exist — safe for both fresh and existing DBs)

  db.exec(SCHEMA_SQL);

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