-- 0013_attestation_and_provenance.sql
-- Schema extensions for Owner Attestation Integrity and Product Proposal Provenance

ALTER TABLE owner_intake ADD COLUMN status TEXT NOT NULL DEFAULT 'VALID';
ALTER TABLE owner_intake ADD COLUMN written_by TEXT NOT NULL DEFAULT 'OWNER_FORM';
ALTER TABLE owner_intake ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'));

ALTER TABLE product_proposals ADD COLUMN provider_call_log_id TEXT;
ALTER TABLE product_proposals ADD COLUMN page_text_snippet TEXT;
