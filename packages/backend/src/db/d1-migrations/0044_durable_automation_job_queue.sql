-- 0044_durable_automation_job_queue.sql
-- Durable Automation Job Queue, Attempt History, Indian Festival Demand, and SEO Sourced Keywords

CREATE TABLE IF NOT EXISTS automation_jobs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_FINDINGS', 'COMPLETED_NO_FINDINGS',
    'NO_ACTION_DUE', 'PARTIAL', 'DEFERRED', 'BLOCKED', 'RETRY_WAIT', 'FAILED_PERMANENTLY', 'NOT_IMPLEMENTED'
  )),
  priority INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT,
  lease_expires_at TEXT,
  worker_source TEXT,
  last_error TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auto_jobs_due ON automation_jobs(status, available_at, priority);
CREATE INDEX IF NOT EXISTS idx_auto_jobs_lease ON automation_jobs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_auto_jobs_workflow ON automation_jobs(workflow_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auto_jobs_idempotency ON automation_jobs(idempotency_key);

CREATE TABLE IF NOT EXISTS automation_job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  result_json TEXT NOT NULL DEFAULT '{}',
  worker_source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auto_attempts_job ON automation_job_attempts(job_id, attempt_number);

-- Indian Festival & Seasonal Demand Registry (Phase 5)
CREATE TABLE IF NOT EXISTS seasonal_festivals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  event_date TEXT NOT NULL,
  category TEXT NOT NULL,
  shopping_lead_days INTEGER NOT NULL DEFAULT 14,
  region TEXT NOT NULL DEFAULT 'All India',
  source_url TEXT NOT NULL,
  confidence_score REAL NOT NULL DEFAULT 1.0,
  last_verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_festivals_date ON seasonal_festivals(event_date);
CREATE INDEX IF NOT EXISTS idx_festivals_cat ON seasonal_festivals(category);

-- Sourced SEO Keywords & Intent Clusters (Phase 6)
CREATE TABLE IF NOT EXISTS seo_keywords (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL UNIQUE,
  search_intent TEXT NOT NULL CHECK (search_intent IN ('INFORMATIONAL', 'COMPARISON', 'COMMERCIAL_INVESTIGATION', 'TRANSACTIONAL', 'LOCAL_SERVICE')),
  target_vertical TEXT NOT NULL,
  canonical_slug TEXT,
  cluster_name TEXT,
  provenance TEXT NOT NULL,
  search_volume INTEGER,
  difficulty INTEGER,
  last_retrieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_seo_keywords_cluster ON seo_keywords(cluster_name);
CREATE INDEX IF NOT EXISTS idx_seo_keywords_vert ON seo_keywords(target_vertical);
