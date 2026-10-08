-- 0018_provider_drift_records.sql
-- Table for tracking provider API usage drift vs local counters

CREATE TABLE IF NOT EXISTS provider_drift_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  local_count INTEGER NOT NULL,
  provider_count INTEGER NOT NULL,
  drift_percentage REAL NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
