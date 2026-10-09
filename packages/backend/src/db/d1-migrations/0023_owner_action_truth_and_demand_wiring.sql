-- Migration 0023: Owner Action Truth, Demand Engine Wiring, and Complete Write Quarantine

-- 1. Add terms_checked_at column to source_rules
ALTER TABLE source_rules ADD COLUMN terms_checked_at TEXT;

-- 2. Add approved_at and owner_session_id to product_proposals
ALTER TABLE product_proposals ADD COLUMN approved_at TEXT;
ALTER TABLE product_proposals ADD COLUMN owner_session_id TEXT;

-- 3. Add provenance to learning_records
ALTER TABLE learning_records ADD COLUMN provenance TEXT DEFAULT 'APP_LOGGED_CALL';

-- 4. Create stored_reports table for uploaded Associates earnings reports
CREATE TABLE IF NOT EXISTS stored_reports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stored_reports_org ON stored_reports(organization_id);

-- 5. Correct rule text of mst_10_ratelimiter_used_proxy_ip
UPDATE mistakes_board
SET rule = 'do not trust cf-connecting-ip unless TRUST_CF_HEADER is true. Use the rightmost entry that is not a private or Cloudflare address.'
WHERE id = 'mst_10_ratelimiter_used_proxy_ip';

-- 6. Add 4 new P1 mistakes to mistakes_board (using first_seen, last_seen, source_report)
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_17_rupee_estimates_without_data',
  datetime('now'),
  datetime('now'),
  'Rupee impact figures written without measured data',
  'Previous status reports printed hypothetical or projected rupee numbers for revenue potential without verified transaction backing.',
  'Projections were conflated with verified ledger records in report generation.',
  'Do not write rupee estimates. Use a measured value or write UNKNOWN.',
  'P1',
  'FIXED',
  1,
  'LINT',
  'scripts/lint-no-unbacked-rupee-estimates.mjs',
  'ANTIGRAVITY_AUDIT_20261009'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;

INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_18_owner_actions_resolved_without_evidence',
  datetime('now'),
  datetime('now'),
  'Owner actions marked RESOLVED without evidence',
  'TODAY page showed complete intake and approve product as RESOLVED when production D1 had 0 intake rows and 0 active offers.',
  'Status computation evaluated local test fixtures and checked loose conditions without verifying provenance and session IDs.',
  'An action is RESOLVED only when exact verifiable evidence exists in the production database (intake written by OWNER_FORM, proposal APPROVED with owner session ID and active offer, guide PUBLISHED, visit recorded by click beacon, or uploaded report with content hash).',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/owner-action-truth-gates.test.ts:verifies 5 canonical owner actions resolve strictly on proof and open otherwise',
  'ANTIGRAVITY_AUDIT_20261009'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;

INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_19_partner_details_from_reviews_as_facts',
  datetime('now'),
  datetime('now'),
  'Partner program details taken from blogs, video, and review sites and stored as facts',
  'Research on Indian affiliate networks stored blog and forum claims about commissions, cookies, and KYC as factual parameters.',
  'Third-party aggregators and reviews were treated as authoritative provider documentation.',
  'Mark all scraped network details UNVERIFIED. Store only official signup URLs and dates. Adapters must read templates from partner records only.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/affiliate-adapters.test.ts:adapter refuses to build link if owner-entered template is missing',
  'ANTIGRAVITY_AUDIT_20261009'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;

INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_20_production_write_audit_incomplete',
  datetime('now'),
  datetime('now'),
  'Production write audit that listed one row instead of all rows',
  'Initial write audit focused only on call_1791393061443_spec01 instead of auditing all script-written rows across all tables.',
  'Audit scope was narrowly scoped to a single reported mistake rather than a full database inventory.',
  'List every production D1 write across all tables, row counts, dates, methods, and quarantine unapproved rows.',
  'P1',
  'FIXED',
  1,
  'LINT',
  'scripts/audit-full-d1.mjs',
  'ANTIGRAVITY_AUDIT_20261009'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;

-- 7. Quarantine unapproved rows across all tables (Step 4)
-- Set provenance to MANUAL_SCRIPT for all script-written rows
UPDATE learning_records
SET provenance = 'MANUAL_SCRIPT'
WHERE source_file = 'KNOWN_HISTORY' OR learning_type = 'HISTORY_INGEST';

UPDATE platform_prospects
SET status = 'QUARANTINED'
WHERE status = 'DISCOVERED';

UPDATE opportunities
SET status = 'QUARANTINED'
WHERE status = 'DISCOVERED';

UPDATE outbound_contacts
SET status = 'QUARANTINED'
WHERE status = 'HOLD_REQUIRES_APPROVAL';

