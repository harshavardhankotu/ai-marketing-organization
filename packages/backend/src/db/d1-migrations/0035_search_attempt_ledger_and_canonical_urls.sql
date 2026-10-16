-- Migration 0035: Search Attempt Ledger, Canonical URL Deduplication, and Direct Offer Attestation Gate

-- 1. Add canonical_url to demand_signals if not present
-- Note: SQLite allows ADD COLUMN without default or with simple expressions
ALTER TABLE demand_signals ADD COLUMN canonical_url TEXT;

-- 2. Populate canonical_url with trimmed source_url for existing historical records
UPDATE demand_signals
SET canonical_url = LOWER(TRIM(source_url))
WHERE canonical_url IS NULL AND source_url IS NOT NULL;

-- 3. Create index for fast canonical URL lookups
CREATE INDEX IF NOT EXISTS idx_demand_signals_canonical ON demand_signals(canonical_url);

-- 4. Create durable search_attempts ledger (enforces max 3 Tavily searches per Asia/Kolkata calendar day)
CREATE TABLE IF NOT EXISTS search_attempts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'TAVILY',
  category TEXT NOT NULL,
  query TEXT NOT NULL,
  query_version TEXT NOT NULL DEFAULT 'v1',
  kolkata_date TEXT NOT NULL,
  status TEXT NOT NULL, -- 'ATTEMPTED', 'SUCCESS', 'FAILED', 'QUOTA_EXHAUSTED', 'BUDGET_EXCEEDED'
  results_count INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_attempts_date ON search_attempts(provider, kolkata_date);
CREATE INDEX IF NOT EXISTS idx_search_attempts_query ON search_attempts(category, query_version);

-- 5. Create direct_offer_attestation table (Lane B commercial terms explicit owner gate)
CREATE TABLE IF NOT EXISTS direct_offer_attestation (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  offer_version TEXT NOT NULL,
  setup_price_inr INTEGER,
  monthly_price_inr INTEGER,
  deliverables_json TEXT,
  sla_days INTEGER,
  refund_terms TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  upi_vpa TEXT,
  payment_url TEXT,
  attested_by TEXT NOT NULL DEFAULT 'OWNER_FORM',
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'ATTESTED' | 'PENDING' | 'REJECTED'
  attested_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offer_attestation_status ON direct_offer_attestation(offer_id, status);
