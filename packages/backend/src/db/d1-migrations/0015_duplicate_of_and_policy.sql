-- Migration 0015: Add duplicate_of to provider_call_logs and category policy
ALTER TABLE provider_call_logs ADD COLUMN duplicate_of TEXT;
