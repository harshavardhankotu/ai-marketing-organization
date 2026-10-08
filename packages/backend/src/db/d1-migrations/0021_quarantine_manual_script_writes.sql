-- Migration 0021: Quarantine manual script writes and enforce provenance
-- Flag manual script call in provider_call_logs
UPDATE provider_call_logs
SET flag = 'QUARANTINED_MANUAL_SCRIPT'
WHERE id = 'call_1791393061443_spec01';

-- Quarantine any product proposal with MANUAL_SCRIPT provenance
UPDATE product_proposals
SET status = 'QUARANTINED'
WHERE provenance = 'MANUAL_SCRIPT';
