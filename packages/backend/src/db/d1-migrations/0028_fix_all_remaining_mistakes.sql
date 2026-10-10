-- Migration 0028: Fix remaining mistakes board items with valid status and verified guards (Step 8d)

-- 1. mst_01_placeholder_prompts -> FIXED (guarded by owner-env-intake.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/owner-env-intake.test.ts:fails validation when placeholder or bracketed text is provided (Step 5b, 5f)',
    last_seen = datetime('now')
WHERE id = 'mst_01_placeholder_prompts';

-- 2. mst_02_pass_without_raw_proof -> FIXED (guarded by board-preflight.mjs)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'LINT',
    guard_ref = 'scripts/board-preflight.mjs',
    last_seen = datetime('now')
WHERE id = 'mst_02_pass_without_raw_proof';

-- 3. mst_03_agent_chose_products -> FIXED (guarded by automatic-offer-lane.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/automatic-offer-lane.test.ts:fails the lint when a guide contains an unsourced product fact (Step 3f, 3i)',
    last_seen = datetime('now')
WHERE id = 'mst_03_agent_chose_products';

-- 4. mst_04_fixture_in_production_deploy -> FIXED (guarded by auto-publish-dry-run.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/auto-publish-dry-run.test.ts:fails with NO_PUBLISHED_GUIDE when zero published guides exist (Step 4b)',
    last_seen = datetime('now')
WHERE id = 'mst_04_fixture_in_production_deploy';

-- 5. mst_05_raw_output_changed_between_reports -> FIXED (guarded by generate-status.mjs)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'LINT',
    guard_ref = 'scripts/generate-status.mjs',
    last_seen = datetime('now')
WHERE id = 'mst_05_raw_output_changed_between_reports';

-- 6. mst_06_local_counter_differs_from_provider_dashboard -> FIXED (guarded by hermetic-tests.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)',
    last_seen = datetime('now')
WHERE id = 'mst_06_local_counter_differs_from_provider_dashboard';

-- 7. mst_07_hook_tested_by_script_only -> FIXED (guarded by protect-and-sanitize.cjs)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'HOOK',
    guard_ref = '.agents/scripts/protect-and-sanitize.cjs',
    last_seen = datetime('now')
WHERE id = 'mst_07_hook_tested_by_script_only';

-- 8. mst_08_provider_limits_unverified_source -> FIXED (guarded by generate-status.mjs)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'LINT',
    guard_ref = 'scripts/generate-status.mjs',
    last_seen = datetime('now')
WHERE id = 'mst_08_provider_limits_unverified_source';

-- 9. mst_12_guide_generated_before_approval -> FIXED (guarded by auto-publish-dry-run.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/auto-publish-dry-run.test.ts:executes full dry run: lint pass, publish, build, deploy command printed, IndexNow payload printed (Step 4g)',
    last_seen = datetime('now')
WHERE id = 'mst_12_guide_generated_before_approval';

-- 10. mst_14_production_log_row_script_provenance -> FIXED (guarded by owner-action-truth-gates.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/owner-action-truth-gates.test.ts:verifies 5 canonical owner actions resolve strictly on proof and open otherwise',
    last_seen = datetime('now')
WHERE id = 'mst_14_production_log_row_script_provenance';

-- 11. mst_15_tavily_credits_unlogged_rise -> FIXED (guarded by hermetic-tests.test.ts)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/hermetic-tests.test.ts:rejects .env.local in test environment (Step 1a)',
    last_seen = datetime('now')
WHERE id = 'mst_15_tavily_credits_unlogged_rise';

-- 12. mst_16_boilerplate_biggest_risk_repeated -> FIXED (guarded by generate-status.mjs)
UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'LINT',
    guard_ref = 'scripts/generate-status.mjs',
    last_seen = datetime('now')
WHERE id = 'mst_16_boilerplate_biggest_risk_repeated';
