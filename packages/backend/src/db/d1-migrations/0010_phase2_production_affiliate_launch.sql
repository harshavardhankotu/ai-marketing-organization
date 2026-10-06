-- 0010_phase2_production_affiliate_launch.sql
-- Phase 2: production-grade partner/offer registries, first-class referral
-- attribution + immutable click events, commission idempotency guard,
-- demand intent classification, content quality gate storage.
-- All statements are additive / idempotent (migration runner skips
-- "duplicate column name" / "already exists").

-- 1. Partners: network identity + explicit authorization + evidence
ALTER TABLE partners ADD COLUMN network TEXT NOT NULL DEFAULT 'OTHER_AUTHORIZED_PARTNER';
ALTER TABLE partners ADD COLUMN tracking_type TEXT NOT NULL DEFAULT 'AFFILIATE_LINK';
ALTER TABLE partners ADD COLUMN authorization_status TEXT NOT NULL DEFAULT 'AUTHORIZED';
ALTER TABLE partners ADD COLUMN program_url TEXT;
ALTER TABLE partners ADD COLUMN coverage TEXT NOT NULL DEFAULT 'India';
ALTER TABLE partners ADD COLUMN category TEXT;
ALTER TABLE partners ADD COLUMN destination_requirements TEXT;
ALTER TABLE partners ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';

-- 2. Offers: lifecycle status (only ACTIVE is usable in production)
ALTER TABLE partner_offers ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE partner_offers ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE partner_offers ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE partner_offers ADD COLUMN availability TEXT NOT NULL DEFAULT 'IN_STOCK';
-- Backfill lifecycle status from legacy active flag for pre-Phase-2 rows
UPDATE partner_offers SET status = CASE WHEN active = 1 THEN 'ACTIVE' ELSE 'PAUSED' END WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_partner_offers_status ON partner_offers(status);

-- 3. Referrals: first-class attribution (anonymous, no PII)
ALTER TABLE referrals ADD COLUMN ip TEXT;
ALTER TABLE referrals ADD COLUMN user_agent TEXT;
ALTER TABLE referrals ADD COLUMN referer TEXT;
ALTER TABLE referrals ADD COLUMN utm_source TEXT;
ALTER TABLE referrals ADD COLUMN utm_medium TEXT;
ALTER TABLE referrals ADD COLUMN utm_campaign TEXT;
ALTER TABLE referrals ADD COLUMN utm_term TEXT;
ALTER TABLE referrals ADD COLUMN utm_content TEXT;
ALTER TABLE referrals ADD COLUMN content_asset_id TEXT;
ALTER TABLE referrals ADD COLUMN placement TEXT;
ALTER TABLE referrals ADD COLUMN device_class TEXT;
ALTER TABLE referrals ADD COLUMN country TEXT;
ALTER TABLE referrals ADD COLUMN keyword TEXT;
CREATE INDEX IF NOT EXISTS idx_referrals_asset ON referrals(content_asset_id);
CREATE INDEX IF NOT EXISTS idx_referrals_org ON referrals(organization_id);

-- 4. Immutable referral click events (append-only; never updated)
CREATE TABLE IF NOT EXISTS referral_click_events (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL,
  click_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  content_asset_id TEXT,
  placement TEXT,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  keyword TEXT,
  referrer TEXT,
  device_class TEXT,
  country TEXT,
  destination_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_click_events_referral ON referral_click_events(referral_id);
CREATE INDEX IF NOT EXISTS idx_click_events_offer ON referral_click_events(offer_id);
CREATE INDEX IF NOT EXISTS idx_click_events_asset ON referral_click_events(content_asset_id);

-- 5. Commission idempotency: same external transaction twice = one record
CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_partner_tx
  ON commission_records(partner_id, external_transaction_id);
CREATE INDEX IF NOT EXISTS idx_commissions_org ON commission_records(organization_id);

-- 6. Demand intent classification (Phase 2 Task 12)
ALTER TABLE demand_signals ADD COLUMN intent_class TEXT NOT NULL DEFAULT 'RESEARCH';
ALTER TABLE demand_signals ADD COLUMN commercial_score REAL NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_demand_signals_intent ON demand_signals(intent_class);

-- 7. Content quality gate record (Phase 2 Task 15)
ALTER TABLE commission_content_assets ADD COLUMN quality_gate_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE commission_content_assets ADD COLUMN disclosure_version TEXT NOT NULL DEFAULT '2026.1';
