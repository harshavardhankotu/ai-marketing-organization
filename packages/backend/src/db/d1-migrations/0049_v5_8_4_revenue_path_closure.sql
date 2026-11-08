-- D1 Migration 0049: V5.8.4 Revenue Path Closure, Razorpay Webhook Idempotency & Queue Compaction
-- 1. Create processed_webhook_events table for Razorpay webhook idempotency
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_hash TEXT,
  order_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_order ON processed_webhook_events(order_id);

-- 2. Enhance cuelinks_campaigns with explicit provenance and sync tracking
ALTER TABLE cuelinks_campaigns ADD COLUMN verification_source TEXT NOT NULL DEFAULT 'CUELINKS_API_V3';
ALTER TABLE cuelinks_campaigns ADD COLUMN last_provider_sync_at TEXT;

-- 3. Compact any stale duplicate QUEUED jobs, keeping only the latest per workflow
UPDATE automation_jobs
SET status = 'NO_ACTION_DUE', last_error = 'SUPERSEDED_DEDUP', updated_at = datetime('now')
WHERE status = 'QUEUED'
  AND id NOT IN (
    SELECT max(id) FROM automation_jobs WHERE status = 'QUEUED' GROUP BY workflow_id
  );
