-- 0011_stop_waste_and_safety_pass.sql
-- Stop waste, quarantine junk, enforce durable rate limits and visibility

-- 1. Add public_live column to businesses (defaults to 0, false)
ALTER TABLE businesses ADD COLUMN public_live INTEGER NOT NULL DEFAULT 0;

-- 2. Add status column to outbound_contacts (defaults to 'ACTIVE')
ALTER TABLE outbound_contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';

-- 3. Durable rate limiting table
CREATE TABLE IF NOT EXISTS durable_rate_limits (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON durable_rate_limits(expires_at);

-- 4. Provider call audit log table
CREATE TABLE IF NOT EXISTS provider_call_logs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  action_type TEXT NOT NULL,
  priority TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  success INTEGER NOT NULL DEFAULT 1,
  is_rate_limit INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_logs_provider_created ON provider_call_logs(provider, created_at);

-- 5. Stop the loop on fixture businesses (Item 1)
UPDATE businesses
SET kill_switch_active = 1,
    kill_switch_reason = 'PAUSED_FIXTURE_CYCLE',
    updated_at = datetime('now')
WHERE id IN ('biz_smilekraft_hyd', 'biz_1790714233800');

-- 6. Quarantine junk prospects (Item 3)
UPDATE platform_prospects
SET status = 'REJECTED', stage = 'REJECTED', updated_at = datetime('now')
WHERE website_url LIKE '%youtube%'
   OR website_url LIKE '%youtu.be%'
   OR website_url LIKE '%etacky%'
   OR prospect_website LIKE '%youtube%'
   OR prospect_website LIKE '%youtu.be%'
   OR prospect_website LIKE '%etacky%'
   OR business_name LIKE '%Top 10%'
   OR business_name LIKE '%Best 10%'
   OR prospect_business_name LIKE '%Top 10%'
   OR prospect_business_name LIKE '%Best 10%';

-- 7. Quarantine junk opportunities (Item 3)
UPDATE opportunities
SET status = 'REJECTED', updated_at = datetime('now')
WHERE prospect_id IN (SELECT id FROM platform_prospects WHERE status = 'REJECTED');

-- 8. Quarantine junk outbound contacts (Item 3)
UPDATE outbound_contacts
SET is_suppressed = 1, suppression_reason = 'REJECTED', status = 'REJECTED', updated_at = datetime('now')
WHERE prospect_website LIKE '%youtube%'
   OR prospect_website LIKE '%youtu.be%'
   OR prospect_website LIKE '%etacky%'
   OR prospect_business_name LIKE '%Top 10%'
   OR prospect_business_name LIKE '%Best 10%';
