-- 0008_commission_and_referral_engine.sql
-- Autonomous Commission & Referral Revenue Engine (Phase 1)

-- 1. Partners Registry
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'India',
  city TEXT,
  website TEXT NOT NULL,
  partner_type TEXT NOT NULL DEFAULT 'AFFILIATE', -- AFFILIATE | REFERRAL | CPL | CLOSED_SALE
  program_name TEXT,
  commission_type TEXT NOT NULL DEFAULT 'PERCENTAGE', -- PERCENTAGE | FIXED | HYBRID
  commission_rate REAL,
  fixed_commission_inr REAL,
  cookie_window_days INTEGER NOT NULL DEFAULT 30,
  qualifying_event TEXT NOT NULL DEFAULT 'PURCHASE', -- PURCHASE | QUALIFIED_LEAD | APPLICATION | BOOKING
  approval_status TEXT NOT NULL DEFAULT 'APPROVED', -- PENDING | APPROVED | REJECTED | SUSPENDED
  active_status INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'DIRECT_PARTNER',
  terms_url TEXT,
  disclosure_required INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_partners_org_status ON partners(organization_id, active_status);
CREATE INDEX IF NOT EXISTS idx_partners_industry ON partners(industry);

-- 2. Partner Offers Registry
CREATE TABLE IF NOT EXISTS partner_offers (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  offer_slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  target_customer TEXT NOT NULL,
  price_inr REAL,
  price_range TEXT,
  commission_model TEXT NOT NULL DEFAULT 'PERCENTAGE', -- PERCENTAGE | FIXED
  commission_amount_inr REAL NOT NULL DEFAULT 0,
  conversion_action TEXT NOT NULL DEFAULT 'PURCHASE',
  destination_url TEXT NOT NULL,
  authorized_tracking_url TEXT NOT NULL,
  geographic_availability TEXT NOT NULL DEFAULT 'India',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_partner_offers_partner ON partner_offers(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_offers_category ON partner_offers(category);
CREATE INDEX IF NOT EXISTS idx_partner_offers_active ON partner_offers(active);

-- 3. Referrals Tracking
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  anonymous_session_id TEXT,
  click_id TEXT NOT NULL UNIQUE,
  tracking_parameters_json TEXT NOT NULL DEFAULT '{}',
  landing_page TEXT,
  source TEXT,
  campaign TEXT,
  destination_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES partner_offers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_referrals_offer ON referrals(offer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_click ON referrals(click_id);
CREATE INDEX IF NOT EXISTS idx_referrals_created ON referrals(created_at);

-- 4. Commission Records Ledger
CREATE TABLE IF NOT EXISTS commission_records (
  id TEXT PRIMARY KEY,
  referral_id TEXT,
  partner_id TEXT NOT NULL,
  offer_id TEXT,
  organization_id TEXT NOT NULL,
  external_transaction_id TEXT,
  event_type TEXT NOT NULL DEFAULT 'PURCHASE',
  external_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | PAID | REJECTED | CANCELLED | REFUNDED
  expected_commission_inr REAL NOT NULL DEFAULT 0,
  verified_commission_inr REAL NOT NULL DEFAULT 0,
  received_commission_inr REAL NOT NULL DEFAULT 0,
  verification_source TEXT NOT NULL, -- PARTNER_API | WEBHOOK | DASHBOARD_EXPORT | MANUAL_VERIFICATION | REFERENCE_CODE
  evidence_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'COMMISSION_PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  paid_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE SET NULL,
  FOREIGN KEY (offer_id) REFERENCES partner_offers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_commissions_partner ON commission_records(partner_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commission_records(status);
CREATE INDEX IF NOT EXISTS idx_commissions_referral ON commission_records(referral_id);

-- 5. Commission Content Assets (renamed to avoid collision with marketing content_assets)
CREATE TABLE IF NOT EXISTS commission_content_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  asset_type TEXT NOT NULL, -- COMPARISON | RECOMMENDATION | GUIDE | SERVICE_DIRECTORY | OFFER_DETAIL
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT,
  intent_target TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  primary_offer_id TEXT,
  matched_offer_ids_json TEXT NOT NULL DEFAULT '[]',
  disclosure_markdown TEXT NOT NULL DEFAULT 'Disclosure: We may earn a referral commission at no additional cost to you when you purchase through our links.',
  status TEXT NOT NULL DEFAULT 'PUBLISHED', -- DRAFT | PUBLISHED | ARCHIVED
  view_count INTEGER NOT NULL DEFAULT 0,
  referral_click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (primary_offer_id) REFERENCES partner_offers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_commission_content_assets_slug ON commission_content_assets(slug);
CREATE INDEX IF NOT EXISTS idx_commission_content_assets_category ON commission_content_assets(category);

-- 6. Demand Signals (Discovered Organic Intent)
CREATE TABLE IF NOT EXISTS demand_signals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT,
  intent_type TEXT NOT NULL DEFAULT 'SEARCH_QUERY', -- SEARCH_QUERY | PROBLEM_DESCRIPTION | PRODUCT_COMPARISON
  raw_query TEXT NOT NULL,
  evidence_snippet TEXT NOT NULL,
  source_url TEXT NOT NULL,
  urgency REAL NOT NULL DEFAULT 0.5,
  estimated_monthly_volume INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'DISCOVERED', -- DISCOVERED | MATCHED | ADDRESSED | QUARANTINED
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demand_signals_topic ON demand_signals(topic);
CREATE INDEX IF NOT EXISTS idx_demand_signals_status ON demand_signals(status);
