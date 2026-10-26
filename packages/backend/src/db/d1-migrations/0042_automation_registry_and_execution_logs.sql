-- 0042_automation_registry_and_execution_logs.sql
-- Durable Central Automation Registry & Background Execution Telemetry

CREATE TABLE IF NOT EXISTS automation_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- 'RESEARCH', 'COMMERCIAL', 'SALES_PIPELINE', 'ACCOUNTING', 'SYSTEM'
  enabled INTEGER NOT NULL DEFAULT 1,
  trigger_type TEXT NOT NULL DEFAULT 'CRON', -- 'CRON', 'EVENT', 'MANUAL'
  cadence_minutes INTEGER NOT NULL DEFAULT 60,
  timezone TEXT NOT NULL DEFAULT 'UTC', -- Displayed in Asia/Kolkata
  last_started_at TEXT,
  last_completed_at TEXT,
  next_scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_status TEXT NOT NULL DEFAULT 'IDLE', -- 'IDLE', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_FINDINGS', 'COMPLETED_NO_FINDINGS', 'PARTIAL', 'DEFERRED', 'BLOCKED', 'PAUSED_QUOTA', 'ERROR'
  last_error TEXT,
  execution_budget_ms INTEGER NOT NULL DEFAULT 30000,
  quota_service_caps_json TEXT,
  dedup_policy TEXT NOT NULL DEFAULT 'TIME_WINDOW',
  checkpoint_json TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  next_retry_at TEXT,
  last_result_summary_json TEXT,
  owner_action_required TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_next_sched ON automation_registry(enabled, next_scheduled_at);
CREATE INDEX IF NOT EXISTS idx_automation_status ON automation_registry(last_status);

CREATE TABLE IF NOT EXISTS automation_execution_log (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL, -- 'CLOUDFLARE_CRON', 'MANUAL', 'EVENT'
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL, -- 'COMPLETED', 'PARTIAL', 'BLOCKED', 'ERROR', 'PAUSED_QUOTA', 'NO_ACTION_DUE'
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_succeeded INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT,
  result_summary_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workflow_id) REFERENCES automation_registry(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auto_exec_wf ON automation_execution_log(workflow_id, created_at);
