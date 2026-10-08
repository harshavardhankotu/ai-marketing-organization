-- Migration 0020: History Ingest, Demand Engine, and P1 Mistakes Board Rows

-- 1. Extend learning_records schema for structured empirical history
ALTER TABLE learning_records ADD COLUMN what TEXT;
ALTER TABLE learning_records ADD COLUMN outcome TEXT;
ALTER TABLE learning_records ADD COLUMN cause TEXT;
ALTER TABLE learning_records ADD COLUMN rule TEXT;
ALTER TABLE learning_records ADD COLUMN evidence_ref TEXT;
ALTER TABLE learning_records ADD COLUMN source_file TEXT;
ALTER TABLE learning_records ADD COLUMN date TEXT;
ALTER TABLE learning_records ADD COLUMN content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lrn_content_hash ON learning_records(content_hash);

-- 2. Extend demand_signals schema for intent-based discovery
ALTER TABLE demand_signals ADD COLUMN source_host TEXT;
ALTER TABLE demand_signals ADD COLUMN url TEXT;
ALTER TABLE demand_signals ADD COLUMN excerpt TEXT;
ALTER TABLE demand_signals ADD COLUMN author_hash TEXT;
ALTER TABLE demand_signals ADD COLUMN language TEXT DEFAULT 'en';
ALTER TABLE demand_signals ADD COLUMN city TEXT;
ALTER TABLE demand_signals ADD COLUMN intent_score INTEGER DEFAULT 0;
ALTER TABLE demand_signals ADD COLUMN budget_hint TEXT;
ALTER TABLE demand_signals ADD COLUMN found_at TEXT;
ALTER TABLE demand_signals ADD COLUMN dedupe_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_signals_dedupe ON demand_signals(dedupe_hash);

-- 3. Demand Matches table
CREATE TABLE IF NOT EXISTS demand_matches (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  expected_value REAL NOT NULL DEFAULT 0.0,
  ev_basis TEXT NOT NULL DEFAULT 'ESTIMATED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (signal_id) REFERENCES demand_signals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_demand_matches_signal ON demand_matches(signal_id);
CREATE INDEX IF NOT EXISTS idx_demand_matches_offer ON demand_matches(offer_id);

-- 4. Outreach Drafts table
CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'COMMUNITY_FORUM',
  draft_text TEXT NOT NULL,
  landing_url TEXT NOT NULL,
  disclosure_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFTED' CHECK(status IN ('DRAFTED', 'APPROVED', 'POSTED_BY_OWNER', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (signal_id) REFERENCES demand_signals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_signal ON outreach_drafts(signal_id);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_status ON outreach_drafts(status);

-- 5. Source Rules table (host allowlist and policies)
CREATE TABLE IF NOT EXISTS source_rules (
  host TEXT PRIMARY KEY,
  allows_links INTEGER NOT NULL DEFAULT 1,
  allows_affiliate INTEGER NOT NULL DEFAULT 0,
  needs_disclosure INTEGER NOT NULL DEFAULT 1,
  automation_allowed INTEGER NOT NULL DEFAULT 0,
  owner_approved INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed candidate Indian community hosts (all unapproved by default, automation always 0)
INSERT OR IGNORE INTO source_rules (host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes)
VALUES ('reddit.com', 1, 0, 1, 0, 0, 'Candidate community host; requires owner approval before any read');
INSERT OR IGNORE INTO source_rules (host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes)
VALUES ('quora.com', 1, 0, 1, 0, 0, 'Candidate Q&A host; requires owner approval before any read');
INSERT OR IGNORE INTO source_rules (host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes)
VALUES ('techenclave.com', 1, 0, 1, 0, 0, 'Candidate Indian hardware forum; requires owner approval before any read');
INSERT OR IGNORE INTO source_rules (host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes)
VALUES ('desidime.com', 1, 0, 1, 0, 0, 'Candidate Indian deal forum; requires owner approval before any read');

-- 6. Add the 3 P1 mistakes to mistakes_board
INSERT OR IGNORE INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_14_production_log_row_script_provenance',
  '2026-10-09',
  '2026-10-09',
  'Production log row written by script and shown as app provenance',
  'Agent wrote a production log row (call_1791393061443_spec01) by script and presented it as app provenance',
  'Manual script executed direct insert into production D1 bypassing application call stack',
  'Never write production log rows by script. Application provenance requires logged runtime calls through the app.',
  'P1',
  'OPEN',
  1,
  'NONE',
  NULL,
  'UNKNOWN'
);

INSERT OR IGNORE INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_15_tavily_credits_unlogged_rise',
  '2026-10-09',
  '2026-10-09',
  'Tavily credits rose from 226 (owner, Oct 8) to 257 (API) with no log',
  'Tavily credit usage rose from 226 to 257 on provider API check with no corresponding application call log',
  'Tavily API calls executed outside the logged application runtime without include_usage tracking',
  'Log actual credits on every Tavily call with include_usage, run daily usage sync, and flag drift >10%.',
  'P1',
  'OPEN',
  1,
  'NONE',
  NULL,
  'UNKNOWN'
);

INSERT OR IGNORE INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_16_boilerplate_biggest_risk_repeated',
  '2026-10-09',
  '2026-10-09',
  'Boilerplate "biggest risk" repeated without data',
  'Repeated generic boilerplate risk text across reports without computing risk from measured data',
  'Risk assessment was hardcoded rather than dynamically computed from open blockers and money path',
  'Compute top blockers directly from open mistakes board items and money path, citing measured data and monetary impact.',
  'P1',
  'OPEN',
  1,
  'NONE',
  NULL,
  'UNKNOWN'
);
