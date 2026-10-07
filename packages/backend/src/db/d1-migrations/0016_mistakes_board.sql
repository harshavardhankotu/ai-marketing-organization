-- Migration 0016: Mistakes Board and Quota Metadata
CREATE TABLE IF NOT EXISTS mistakes_board (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  title TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  cause TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('P1', 'P2', 'P3')),
  status TEXT NOT NULL CHECK(status IN ('OPEN', 'FIXED', 'MONITORING')),
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  guard_type TEXT NOT NULL CHECK(guard_type IN ('TEST', 'HOOK', 'LINT', 'NONE')),
  guard_ref TEXT,
  source_report TEXT NOT NULL
);

-- Quota State Metadata Columns (for reconciliation, unlogged credits, and drift audits)
ALTER TABLE provider_quota_state ADD COLUMN source TEXT DEFAULT 'SYSTEM';
ALTER TABLE provider_quota_state ADD COLUMN unlogged_credits INTEGER DEFAULT 0;
ALTER TABLE provider_quota_state ADD COLUMN unlogged_reason TEXT;
ALTER TABLE provider_quota_state ADD COLUMN limit_source TEXT;
