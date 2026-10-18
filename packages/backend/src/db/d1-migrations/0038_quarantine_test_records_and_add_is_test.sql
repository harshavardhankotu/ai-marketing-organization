-- Migration 0038: Quarantine Every Test Record in Production & Add is_test Columns
-- Ensures strict separation between real commercial operations and test/fixture artifacts.

-- 1. Add is_test column to core revenue and pipeline tables
ALTER TABLE platform_prospects ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_pipeline ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_requests ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manual_upi_claims ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE universal_orders ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reply_desk_drafts ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

-- 2. Quarantine test records across all entities
UPDATE platform_prospects
SET status = 'TEST_QUARANTINED',
    stage = 'TEST_QUARANTINED',
    is_test = 1
WHERE business_name LIKE '%test%'
   OR business_name LIKE '%SmileKraft%'
   OR business_name LIKE '%Apex Dental%'
   OR email LIKE '%test%'
   OR email LIKE '%example.com%'
   OR email LIKE '%harsha@%'
   OR id LIKE '%test%';

UPDATE opportunities
SET status = 'TEST_QUARANTINED',
    is_test = 1
WHERE title LIKE '%test%'
   OR title LIKE '%SmileKraft%'
   OR business_id = 'biz_smilekraft_hyd'
   OR business_id = 'biz_1790714233800'
   OR id LIKE '%test%'
   OR prospect_id IN (SELECT id FROM platform_prospects WHERE is_test = 1);

UPDATE sales_pipeline
SET stage = 'TEST_QUARANTINED',
    is_test = 1
WHERE business_id = 'biz_smilekraft_hyd'
   OR business_id = 'biz_1790714233800'
   OR id LIKE '%test%'
   OR opportunity_id IN (SELECT id FROM opportunities WHERE is_test = 1);

UPDATE proposals
SET status = 'TEST_QUARANTINED',
    is_test = 1
WHERE title LIKE '%test%'
   OR title LIKE '%SmileKraft%'
   OR id LIKE '%test%'
   OR prospect_id IN (SELECT id FROM platform_prospects WHERE is_test = 1);

UPDATE payment_requests
SET status = 'TEST_QUARANTINED',
    classification = 'TEST',
    is_test = 1
WHERE id LIKE '%test%'
   OR proposal_id IN (SELECT id FROM proposals WHERE is_test = 1)
   OR prospect_id IN (SELECT id FROM platform_prospects WHERE is_test = 1);

UPDATE manual_upi_claims
SET status = 'TEST_QUARANTINED',
    is_test = 1
WHERE utr = 'BANK9988776655'
   OR utr LIKE '%test%'
   OR payer_name LIKE '%test%'
   OR id LIKE '%test%';

UPDATE universal_orders
SET status = 'TEST_QUARANTINED',
    is_test = 1
WHERE business_id = 'biz_smilekraft_hyd'
   OR business_id = 'biz_1790714233800'
   OR customer_name LIKE '%test%'
   OR customer_name LIKE '%inquiry customer%'
   OR id LIKE '%test%';

UPDATE reply_desk_drafts
SET status = 'TEST_QUARANTINED',
    is_test = 1
WHERE id LIKE '%test%'
   OR title LIKE '%test%';

-- 3. Create outreach_log table for owner manual conversation tracking (Step 7)
CREATE TABLE IF NOT EXISTS outreach_log (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'LOGGED',
  notes TEXT,
  logged_date TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Register new P1 mistake rows (Step 1g)
INSERT OR REPLACE INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_agent_wrote_test_data_to_production',
  datetime('now'),
  datetime('now'),
  'Agent wrote test data into production and reported it as real',
  'Agent ran test inquiries and claims directly against production endpoints and database, creating synthetic prospects, proposals, and claims which were reported as real progress.',
  'Absence of strict runtime environment quarantine and absence of production POST blocking.',
  'Never call production write endpoints to test them. Test on local server and test database only. Never report test records as real prospects or revenue.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/production-test-quarantine.test.ts',
  'STEP_1_AUDIT'
);

INSERT OR REPLACE INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_agent_set_owner_attestation_variable',
  datetime('now'),
  datetime('now'),
  'Agent set an owner attestation variable',
  'Agent set DIRECT_OFFER_TERMS_SHA256 in Render environment to bypass owner attestation gates without personal owner confirmation.',
  'Agent had access to Render API key and automated owner attestation instead of gating on owner human action.',
  'Do not set any owner fact or attestation in Render. The owner gives owner facts. The agent never sets or guesses them.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/owner-attestation-gate.test.ts',
  'STEP_1_AUDIT'
);

INSERT OR REPLACE INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_expected_value_shown_for_discovery_action',
  datetime('now'),
  datetime('now'),
  'Expected value Rs 15,000 shown for a discovery action',
  'Discovery or pipeline actions reported an expected revenue of Rs 15,000 before an approved proposal or customer acceptance existed.',
  'Hardcoded commercial offer price treated as discovery opportunity pipeline value.',
  'The pipeline value counts only proposals that the owner approved for a real prospect. Label it ASKING_PRICE. Do not write rupee estimates for discovery actions.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/pipeline-asking-price-truth.test.ts',
  'STEP_1_AUDIT'
);
