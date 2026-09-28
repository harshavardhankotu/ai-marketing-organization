-- D1 Migration 0001: Revenue Truth, Outbound Lineage & Action Idempotency
-- Idempotent schema migration for Cloudflare D1 production databases

-- 1. opportunities: add prospect_id
ALTER TABLE opportunities ADD COLUMN prospect_id TEXT;
CREATE INDEX IF NOT EXISTS idx_opp_prospect ON opportunities(prospect_id);

-- 2. outbound_contacts: add authorization fields & channel
ALTER TABLE outbound_contacts ADD COLUMN channel TEXT NOT NULL DEFAULT 'EMAIL';
ALTER TABLE outbound_contacts ADD COLUMN email_authorized INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound_contacts ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbound_contacts ADD COLUMN authorization_source TEXT;
ALTER TABLE outbound_contacts ADD COLUMN authorization_evidence_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_outbound_channel ON outbound_contacts(channel);

-- 3. payment_requests: add proposal_id
ALTER TABLE payment_requests ADD COLUMN proposal_id TEXT;
CREATE INDEX IF NOT EXISTS idx_payrq_proposal ON payment_requests(proposal_id);

-- 4. search_cache: add classification and source verification
ALTER TABLE search_cache ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE search_cache ADD COLUMN source_verified INTEGER NOT NULL DEFAULT 0;

-- 5. cron_telemetry: heartbeat, execution traces & health states
CREATE TABLE IF NOT EXISTS cron_telemetry (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'CONFIGURED',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  execution_started_at TEXT,
  execution_finished_at TEXT,
  cycle_id TEXT,
  http_status INTEGER,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_observed_ping TEXT,
  total_pings INTEGER NOT NULL DEFAULT 0,
  last_user_agent TEXT,
  worker_source TEXT,
  last_successful_cycle TEXT,
  last_failed_cycle TEXT,
  cycle_result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cron_tel_status ON cron_telemetry(status);
CREATE INDEX IF NOT EXISTS idx_cron_tel_rec ON cron_telemetry(received_at);

-- 6. outbound_action_ledger: strict idempotency across all outbound communications
CREATE TABLE IF NOT EXISTS outbound_action_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  outbound_contact_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL,
  action_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_external_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  UNIQUE (organization_id, opportunity_id, outbound_contact_id, sequence_number, channel)
);
CREATE INDEX IF NOT EXISTS idx_outbound_ledger_opp ON outbound_action_ledger(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_outbound_ledger_contact ON outbound_action_ledger(outbound_contact_id);
CREATE INDEX IF NOT EXISTS idx_outbound_ledger_status ON outbound_action_ledger(status);
