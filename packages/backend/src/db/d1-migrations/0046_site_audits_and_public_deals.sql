-- D1 Migration 0046: Public Deals Catalog and Site Audits Durable Tables
-- Ensures Cloudflare D1 mirrors SQLite tables for public /deals and /audit routes

CREATE TABLE IF NOT EXISTS public_deals (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  canonical_slug TEXT,
  title TEXT NOT NULL,
  brand TEXT,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  sector_code TEXT NOT NULL,
  product_url TEXT NOT NULL,
  affiliate_url TEXT,
  current_price_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  reference_price_inr REAL,
  discount_percent REAL,
  availability TEXT NOT NULL DEFAULT 'IN_STOCK',
  verification_status TEXT NOT NULL DEFAULT 'VERIFIED',
  deal_kind TEXT NOT NULL DEFAULT 'PRODUCT',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_public_deals_sector ON public_deals(sector_code, availability);
CREATE INDEX IF NOT EXISTS idx_public_deals_slug ON public_deals(slug);

CREATE TABLE IF NOT EXISTS site_audits (
  domain TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  business_name TEXT NOT NULL,
  performance_score INTEGER NOT NULL DEFAULT 0,
  seo_score INTEGER NOT NULL DEFAULT 0,
  core_web_vitals_json TEXT NOT NULL DEFAULT '{}',
  head_snippets TEXT,
  schema_json_ld TEXT,
  checklist_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_site_audits_updated ON site_audits(updated_at);
