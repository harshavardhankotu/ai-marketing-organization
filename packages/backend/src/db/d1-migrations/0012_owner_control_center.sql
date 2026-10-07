-- 0012_owner_control_center.sql
-- Schema extensions for Owner Control Center, Product Proposals, and Status Snapshots

CREATE TABLE IF NOT EXISTS owner_intake (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  organization_id TEXT NOT NULL,
  application_date TEXT NOT NULL,
  listed_site_urls_json TEXT NOT NULL,
  agreement_read_confirmed INTEGER NOT NULL,
  agreement_read_confirmed_at TEXT NOT NULL,
  site_name TEXT NOT NULL,
  author_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  tavily_key_rotated INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  category TEXT NOT NULL,
  product_name TEXT NOT NULL,
  manufacturer_name TEXT NOT NULL,
  spec_summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  retrieval_date TEXT NOT NULL,
  amazon_url TEXT,
  asin TEXT,
  status TEXT NOT NULL DEFAULT 'PROPOSED', -- PROPOSED | APPROVED | REJECTED
  approved_offer_id TEXT,
  product_checked INTEGER NOT NULL DEFAULT 0,
  product_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS owner_status_snapshots (
  id TEXT PRIMARY KEY DEFAULT 'latest',
  organization_id TEXT NOT NULL,
  git_head TEXT,
  render_commit TEXT,
  firebase_deploy TEXT,
  commit_status TEXT NOT NULL,
  last_cron_cycle_json TEXT NOT NULL DEFAULT '{}',
  money_path_json TEXT NOT NULL DEFAULT '{}',
  deadline_180_days TEXT,
  countdown_days INTEGER,
  quotas_json TEXT NOT NULL DEFAULT '{}',
  cooldowns_json TEXT NOT NULL DEFAULT '[]',
  learning_insights_json TEXT NOT NULL DEFAULT '[]',
  open_actions_json TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
