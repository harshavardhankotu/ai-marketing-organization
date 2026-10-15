-- Migration 0031: Board Truth & P1 Mistakes (Step 3c & Step 4)

-- 2. Add P1: Hardcoded affiliate tag in source
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_hardcoded_affiliate_tag',
  datetime('now'),
  datetime('now'),
  'Hardcoded affiliate tag in source',
  'A hardcoded affiliate tag literal was found in automatic-offer-lane.ts and static guide fixtures.',
  'Fallback default string added to bypass missing env var in local testing.',
  'Never hardcode an affiliate tag in application source or default to hardcoded tag fallbacks.',
  'P1',
  'FIXED',
  1,
  'LINT',
  'scripts/lint-mask-affiliate-tag.mjs',
  'STEP_1_AUDIT'
) ON CONFLICT(id) DO UPDATE SET
  status = 'FIXED',
  guard_type = 'LINT',
  guard_ref = 'scripts/lint-mask-affiliate-tag.mjs',
  last_seen = datetime('now');

-- 3. Add P1: Mock product specs reachable in production
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_mock_specs_production',
  datetime('now'),
  datetime('now'),
  'Mock product specs reachable in production',
  'AutomaticOfferLane fetchAndStoreBrandSpecs returned mock thermal printer specs when Firecrawl key was missing.',
  'Mock specs were returned whenever Firecrawl key was missing regardless of production environment.',
  'Never return or publish mock product specification lines outside hermetic unit test environments.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/automatic-offer-lane.test.ts:fails the lint when a guide contains an unsourced product fact (Step 3f, 3i)',
  'STEP_3_AUDIT'
) ON CONFLICT(id) DO UPDATE SET
  status = 'FIXED',
  guard_type = 'TEST',
  guard_ref = 'packages/backend/tests/unit/automatic-offer-lane.test.ts:fails the lint when a guide contains an unsourced product fact (Step 3f, 3i)',
  last_seen = datetime('now');

-- 4. Add P1: Quota read from stale local database
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_quota_stale_local_db',
  datetime('now'),
  datetime('now'),
  'Quota read from stale local database',
  'Status reports and quota gates previously read local database counters that lagged live provider dashboards by hundreds of credits.',
  'Local database row was trusted as sole authority without automated sync from live provider usage endpoints.',
  'Always synchronize provider credit usage directly from authoritative provider APIs, never stale local counters.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)',
  'STEP_5_AUDIT'
) ON CONFLICT(id) DO UPDATE SET
  status = 'FIXED',
  guard_type = 'TEST',
  guard_ref = 'packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)',
  last_seen = datetime('now');
