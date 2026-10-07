-- 0017_spec01_and_quotas.sql
-- Add flag column to provider_call_logs, flag call_1791393061443_spec01, and update application limits

ALTER TABLE provider_call_logs ADD COLUMN flag TEXT;

UPDATE provider_call_logs
SET flag = 'UNLOGGED_UNKNOWN_ORIGIN'
WHERE id = 'call_1791393061443_spec01';

UPDATE provider_quota_state
SET application_limit = 700,
    last_successful_request = '2026-10-07 08:00:50',
    updated_at = datetime('now')
WHERE id = 'tavily';

UPDATE provider_quota_state
SET application_limit = 50,
    provider_limit = NULL,
    limit_source = 'ASSUMPTION',
    updated_at = datetime('now')
WHERE id = 'gemini';
