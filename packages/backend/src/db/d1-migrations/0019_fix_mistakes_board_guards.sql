-- 0019_fix_mistakes_board_guards.sql
-- Link mistakes board rows 9-11 to real tests and set status to FIXED

UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:fails closed with DISCOVERY_COOLDOWN_CHECK_FAILED when D1 cooldown check errors, making zero search calls',
    recurrence_count = 1
WHERE id = 'mst_09_cooldown_failed_open';

UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:derives client IP from X-Forwarded-For, assigns separate buckets to different IPs, and blocks 11th request with 429 without creating real leads',
    recurrence_count = 1
WHERE id = 'mst_10_ratelimiter_used_proxy_ip';

UPDATE mistakes_board
SET status = 'FIXED',
    guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:skips candidates whose domain or source URL already exists in platform_prospects',
    recurrence_count = 1
WHERE id = 'mst_11_discovery_loop_duplicate_rows';
