-- D1 Migration 0047: Revenue Integrity, Audit Telemetry and Public Deals Parity
-- Enhances public_deals with discount provenance, deterministic rechecking and deduplication.
-- Adds explicit HTML scan and PageSpeed telemetry status to site_audits.
-- Adds cuelinks_campaigns table for live merchant campaign verification.

-- 1. Create cuelinks_campaigns table for campaign lookup
CREATE TABLE IF NOT EXISTS cuelinks_campaigns (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  merchant_domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  payout_model TEXT DEFAULT 'CPS',
  payout_rate TEXT,
  cookie_days INTEGER DEFAULT 30,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cuelinks_campaigns_domain ON cuelinks_campaigns(merchant_domain);
CREATE INDEX IF NOT EXISTS idx_cuelinks_campaigns_status ON cuelinks_campaigns(status);

-- Seed approved active Cuelinks merchants
INSERT OR IGNORE INTO cuelinks_campaigns (campaign_id, name, merchant_domain, status, payout_model, cookie_days)
VALUES
  ('4232', 'boAt Lifestyle', 'boat-lifestyle.com', 'ACTIVE', 'CPS', 30),
  ('3278', 'Noise India', 'gonoise.com', 'ACTIVE', 'CPS', 30),
  ('57469', 'Skullcandy India', 'skullcandy.in', 'ACTIVE', 'CPS', 30),
  ('11155', 'Palmonas', 'palmonas.com', 'ACTIVE', 'CPS', 30),
  ('4957', 'Swiss Beauty', 'swissbeauty.in', 'ACTIVE', 'CPS', 30),
  ('2067', 'Ustraa', 'ustraa.com', 'ACTIVE', 'CPS', 30),
  ('2514', 'The Man Company', 'themancompany.com', 'ACTIVE', 'CPS', 30);

-- 2. Enhance public_deals with discount provenance, recheck schedule and monetization flags
ALTER TABLE public_deals ADD COLUMN is_monetizable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public_deals ADD COLUMN discount_verification_type TEXT NOT NULL DEFAULT 'UNCONFIRMED';
ALTER TABLE public_deals ADD COLUMN next_recheck_at TEXT;
ALTER TABLE public_deals ADD COLUMN last_verified_at TEXT;
ALTER TABLE public_deals ADD COLUMN expiry_date TEXT;
ALTER TABLE public_deals ADD COLUMN product_verified INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public_deals ADD COLUMN affiliate_verified INTEGER NOT NULL DEFAULT 1;

-- Deduplicate public_deals by product_url, keeping only the most recently updated entry
DELETE FROM public_deals
WHERE id IN (
  SELECT p1.id
  FROM public_deals p1
  INNER JOIN public_deals p2
    ON p1.product_url = p2.product_url
    AND (p1.updated_at < p2.updated_at OR (p1.updated_at = p2.updated_at AND p1.id < p2.id))
);

-- Remove non-in-stock or unverified rows
DELETE FROM public_deals
WHERE availability != 'IN_STOCK'
   OR current_price_inr <= 0
   OR verification_status NOT IN ('VERIFIED', 'AFFILIATE_VERIFIED');

-- 3. Enhance site_audits with explicit scan status and authorization gates
ALTER TABLE site_audits ADD COLUMN html_scan_status TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE site_audits ADD COLUMN pagespeed_status TEXT NOT NULL DEFAULT 'UNAVAILABLE';
ALTER TABLE site_audits ADD COLUMN pagespeed_unavailable_reason TEXT;
ALTER TABLE site_audits ADD COLUMN is_publicly_authorized INTEGER NOT NULL DEFAULT 0;

-- Authorize baseline demonstration domain
UPDATE site_audits
SET is_publicly_authorized = 1
WHERE domain = 'capturelifedentalcare.com';
