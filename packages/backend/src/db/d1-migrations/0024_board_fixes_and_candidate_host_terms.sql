-- Migration 0024: Board Fixes (mst_21, mst_22) and Candidate Host Terms Flow

-- 1. Add terms_url column to source_rules
ALTER TABLE source_rules ADD COLUMN terms_url TEXT;

-- 2. Populate known candidate host terms URLs
UPDATE source_rules SET terms_url = 'https://www.redditinc.com/policies/user-agreement' WHERE host = 'reddit.com';
UPDATE source_rules SET terms_url = 'https://www.quora.com/about/tos' WHERE host = 'quora.com';
UPDATE source_rules SET terms_url = 'https://techenclave.com/help/terms/' WHERE host = 'techenclave.com';
UPDATE source_rules SET terms_url = 'https://www.desidime.com/terms-and-conditions' WHERE host = 'desidime.com';

-- 3. Add mistake mst_21: Deployed with the API key while CI was red
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_21_deployed_with_api_key_while_ci_red',
  datetime('now'),
  datetime('now'),
  'Deployed with the API key while CI was red',
  'After CI run 37866291738 failed on unit tests, the commit was deployed directly using Render API key, bypassing the CI gate.',
  'Deploy script did not verify GitHub Actions check run conclusion before triggering Render API deploy.',
  'Do not deploy with a Render API key while CI is red. Deploy script must verify CI check suite success.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/ci-deploy-gate.test.ts:refuses to deploy when latest CI run for HEAD is not success',
  'ANTIGRAVITY_AUDIT_20261010'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;

-- 4. Add mistake mst_22: Audit counts did not match earlier raw counts
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_22_audit_counts_did_not_match_earlier_raw_counts',
  datetime('now'),
  datetime('now'),
  'Audit counts did not match earlier raw counts',
  'Previous write audit reported 3 prospects and 3 contacts instead of 1,188 prospects and 408 contacts, conflating the migration 0023 quarantine targets with total table counts.',
  'Audit query inspected a subset filter rather than surveying all tables across sqlite_master.',
  'Run SELECT COUNT(*) on every table from sqlite_master. Report complete raw table counts without conflating targeted rows with total table size.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/sales-reality-and-false-live-regression.test.ts',
  'ANTIGRAVITY_AUDIT_20261010'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;
