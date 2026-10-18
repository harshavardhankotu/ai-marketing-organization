-- Migration 0040: Split the Flags — is_test vs is_junk (Step 6)
-- Distinguishes synthetic test fixture data (is_test = 1) from rejected / noisy discovery output (is_junk = 1).
-- Real funnel queries require: WHERE is_test = 0 AND is_junk = 0.

ALTER TABLE platform_prospects ADD COLUMN is_junk INTEGER NOT NULL DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN is_junk INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_pipeline ADD COLUMN is_junk INTEGER NOT NULL DEFAULT 0;

-- Mark existing rejected / quarantined non-test discovery records as junk
UPDATE opportunities
SET is_junk = 1
WHERE is_test = 0 AND status IN ('REJECTED', 'QUARANTINED');

UPDATE sales_pipeline
SET is_junk = 1
WHERE is_test = 0 AND opportunity_id IN (SELECT id FROM opportunities WHERE is_junk = 1);

CREATE INDEX IF NOT EXISTS idx_opportunities_flags ON opportunities(is_test, is_junk, status);
CREATE INDEX IF NOT EXISTS idx_sales_pipeline_flags ON sales_pipeline(is_test, is_junk, stage);
CREATE INDEX IF NOT EXISTS idx_platform_prospects_flags ON platform_prospects(is_test, is_junk, status);
