-- 0041_direct_outreach_log_and_b2b_prospects.sql
-- Direct Outreach Log for B2B Healthcare & Dental SMB Inbound Lead Triage drafts behind strict human approval gate (human_approved = 0)

CREATE TABLE IF NOT EXISTS direct_outreach_log (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  segment TEXT NOT NULL,
  prospect_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_draft TEXT NOT NULL,
  compliance_checked INTEGER NOT NULL DEFAULT 0,
  human_approved INTEGER NOT NULL DEFAULT 0,
  dispatched INTEGER NOT NULL DEFAULT 0,
  dispatch_timestamp TEXT,
  response_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outreach_biz ON direct_outreach_log(business_id);
CREATE INDEX IF NOT EXISTS idx_outreach_human_approved ON direct_outreach_log(human_approved);
