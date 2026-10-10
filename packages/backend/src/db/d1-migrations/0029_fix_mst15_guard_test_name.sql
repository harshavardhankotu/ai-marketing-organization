-- Migration 0029: Fix mst_15 guard_ref test name

UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/hermetic-tests.test.ts:loadLocalEnvFile refuses to load .env.local when in test environment (Step 1a)',
    last_seen = datetime('now')
WHERE id = 'mst_15_tavily_credits_unlogged_rise';
