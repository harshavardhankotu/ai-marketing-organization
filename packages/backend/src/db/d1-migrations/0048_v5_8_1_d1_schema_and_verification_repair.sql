-- D1 Migration 0048: V5.8.1 D1 Schema, Quota Ledger, and Verification Repair
-- 1. Create missing provider_quota_ledger table in remote D1
CREATE TABLE IF NOT EXISTS provider_quota_ledger (
  provider TEXT NOT NULL,
  window_key TEXT NOT NULL,
  window_type TEXT NOT NULL DEFAULT 'UTC_DAY',
  configured_status TEXT NOT NULL DEFAULT 'CONFIGURED',
  cap_limit INTEGER NOT NULL,
  safety_reserve INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  reserved_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_reset_at TEXT,
  next_reset_at TEXT,
  circuit_breaker_state TEXT NOT NULL DEFAULT 'CLOSED',
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, window_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_quota_provider ON provider_quota_ledger(provider);

-- 2. Rebuild site_audits to make performance_score, seo_score, and metrics nullable
CREATE TABLE IF NOT EXISTS site_audits_new (
  domain TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  business_name TEXT NOT NULL,
  performance_score INTEGER,
  seo_score INTEGER,
  accessibility_score INTEGER,
  best_practices_score INTEGER,
  fcp_ms REAL,
  lcp_ms REAL,
  cls_score REAL,
  core_web_vitals_json TEXT NOT NULL DEFAULT '{}',
  head_snippets TEXT,
  schema_json_ld TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  html_scan_status TEXT NOT NULL DEFAULT 'COMPLETED',
  pagespeed_status TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  pagespeed_unavailable_reason TEXT,
  is_publicly_authorized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR REPLACE INTO site_audits_new (
  domain, target_url, business_name, performance_score, seo_score,
  core_web_vitals_json, head_snippets, schema_json_ld, checklist_json, status,
  html_scan_status, pagespeed_status, pagespeed_unavailable_reason, is_publicly_authorized,
  created_at, updated_at
)
SELECT
  domain, target_url, business_name, performance_score, seo_score,
  core_web_vitals_json, head_snippets, schema_json_ld, checklist_json, status,
  COALESCE(html_scan_status, 'COMPLETED'),
  COALESCE(pagespeed_status, 'UNAVAILABLE'),
  pagespeed_unavailable_reason,
  COALESCE(is_publicly_authorized, 0),
  created_at, updated_at
FROM site_audits;

DROP TABLE site_audits;
ALTER TABLE site_audits_new RENAME TO site_audits;
CREATE INDEX IF NOT EXISTS idx_site_audits_updated ON site_audits(updated_at);

-- 3. Purge dead *.trycloudflare.com and autonomous-deals-free URLs
DELETE FROM public_deals WHERE product_url LIKE '%trycloudflare.com%' OR affiliate_url LIKE '%trycloudflare.com%' OR product_url LIKE '%autonomous-deals-free%' OR affiliate_url LIKE '%autonomous-deals-free%';
UPDATE partner_offers SET destination_url = replace(destination_url, 'autonomous-deals-free.trycloudflare.com', 'ai-marketing-organization.onrender.com') WHERE destination_url LIKE '%trycloudflare.com%';
UPDATE partner_offers SET authorized_tracking_url = replace(authorized_tracking_url, 'autonomous-deals-free.trycloudflare.com', 'ai-marketing-organization.onrender.com') WHERE authorized_tracking_url LIKE '%trycloudflare.com%';

-- 4. Purge synthetic subid1=aro_organic tracking URLs that were not verified through Cuelinks API
UPDATE public_deals
SET affiliate_verified = 0, is_monetizable = 0, affiliate_url = NULL, verification_status = 'PRODUCT_ONLY_UNMONETIZED'
WHERE affiliate_url LIKE '%subid1=aro_organic%';

-- 5. Authorize baseline demonstration domains
UPDATE site_audits SET is_publicly_authorized = 1 WHERE domain IN ('capturelifedentalcare.com', 'clovedental.in');
