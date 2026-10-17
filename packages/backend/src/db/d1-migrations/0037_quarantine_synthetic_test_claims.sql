-- Migration 0037: Quarantine Synthetic Test Payment Claims (Task 5 Safety Audit)
-- Relabel test UTRs submitted during smoke testing to TEST_QUARANTINED to prevent ledger contamination.

UPDATE manual_upi_claims
SET status = 'TEST_QUARANTINED',
    rejection_reason = 'SYNTHETIC_TEST_RECORD: Post-deployment infrastructure smoke test. Quarantined to prevent ledger contamination.',
    notes = 'AUDIT_CORRECTION: Relabeled from PAYMENT_CLAIMED as part of Task 5 production safety audit.',
    verified_at = datetime('now'),
    verified_by = 'usr_system_audit'
WHERE utr = 'BANK9988776655'
   OR payer_name LIKE '%Live Customer Test%'
   OR payer_name LIKE '%Test%';
