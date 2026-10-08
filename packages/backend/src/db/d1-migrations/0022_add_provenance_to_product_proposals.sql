-- Migration 0022: Add provenance column to product_proposals in D1 and quarantine MANUAL_SCRIPT
ALTER TABLE product_proposals ADD COLUMN provenance TEXT DEFAULT 'APP_LOGGED_CALL';

UPDATE product_proposals
SET status = 'QUARANTINED'
WHERE provenance = 'MANUAL_SCRIPT';
