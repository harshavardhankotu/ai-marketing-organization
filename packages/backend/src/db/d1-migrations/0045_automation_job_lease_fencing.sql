-- 0045_automation_job_lease_fencing.sql
-- Adds lease fencing token and indexing for race-free worker claim, execution and completion

ALTER TABLE automation_jobs ADD COLUMN lease_token TEXT;

CREATE INDEX IF NOT EXISTS idx_auto_jobs_lease_token ON automation_jobs(id, lease_token);
