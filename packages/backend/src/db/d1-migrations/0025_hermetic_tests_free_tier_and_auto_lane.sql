-- Migration 0025: Hermetic Tests, Free-Tier Truth, Automatic Offer Lane & Data Reconciliation

-- 1. Alter demand_signals to add signal_type column
ALTER TABLE demand_signals ADD COLUMN signal_type TEXT DEFAULT 'BUYER_QUESTION';

-- 2. Alter learning_records to add source column
ALTER TABLE learning_records ADD COLUMN source TEXT DEFAULT 'UNKNOWN';

-- 3. Create domain_policy table for brand site verification and domain reject classes (Step 3b)
CREATE TABLE IF NOT EXISTS domain_policy (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  policy TEXT NOT NULL DEFAULT 'REJECT', -- 'ALLOW_BRAND' | 'REJECT'
  reject_class TEXT,                     -- 'MARKETPLACE' | 'REVIEW_SITE' | 'SOCIAL_NETWORK' | 'VIDEO_SITE' | 'FILE_TYPE'
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed domain_policy with canonical reject classes
INSERT INTO domain_policy (id, domain, policy, reject_class, reason) VALUES
  ('dp_amazon', 'amazon.in', 'REJECT', 'MARKETPLACE', 'Amazon pages must never be scraped or fetched'),
  ('dp_amazon_com', 'amazon.com', 'REJECT', 'MARKETPLACE', 'Amazon pages must never be scraped or fetched'),
  ('dp_flipkart', 'flipkart.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
  ('dp_snapdeal', 'snapdeal.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
  ('dp_jiomart', 'jiomart.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
  ('dp_meesho', 'meesho.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
  ('dp_indiamart', 'indiamart.com', 'REJECT', 'MARKETPLACE', 'B2B marketplace domain rejected as brand source'),
  ('dp_ebay', 'ebay.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
  ('dp_pcmag', 'pcmag.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_techradar', 'techradar.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_cnet', 'cnet.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_tomsguide', 'tomsguide.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_wirecutter', 'nytimes.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_gsmarena', 'gsmarena.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_rtings', 'rtings.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
  ('dp_reddit', 'reddit.com', 'REJECT', 'SOCIAL_NETWORK', 'Community forum rejected as brand source'),
  ('dp_quora', 'quora.com', 'REJECT', 'SOCIAL_NETWORK', 'Community forum rejected as brand source'),
  ('dp_facebook', 'facebook.com', 'REJECT', 'SOCIAL_NETWORK', 'Social network rejected as brand source'),
  ('dp_twitter', 'twitter.com', 'REJECT', 'SOCIAL_NETWORK', 'Social network rejected as brand source'),
  ('dp_x', 'x.com', 'REJECT', 'SOCIAL_NETWORK', 'Social network rejected as brand source'),
  ('dp_instagram', 'instagram.com', 'REJECT', 'SOCIAL_NETWORK', 'Social network rejected as brand source'),
  ('dp_youtube', 'youtube.com', 'REJECT', 'VIDEO_SITE', 'Video platform rejected as brand source'),
  ('dp_pdf', '*.pdf', 'REJECT', 'FILE_TYPE', 'Binary PDF documents rejected as web spec source')
ON CONFLICT(domain) DO NOTHING;

-- 4. Create brand_spec_lines table to store verified manufacturer specs (Step 3c)
CREATE TABLE IF NOT EXISTS brand_spec_lines (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  spec_line TEXT NOT NULL,
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spec_lines_prod ON brand_spec_lines(product_id);

-- 5. Create competitor_topics table for publisher articles separated from demand signals (Step 6b)
CREATE TABLE IF NOT EXISTS competitor_topics (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  category TEXT,
  publisher_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Add mistake mst_23: Tests spent live provider credits (Step 1f)
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule, severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_23_tests_spent_live_provider_credits',
  datetime('now'),
  datetime('now'),
  'Tests spent live provider credits',
  'Vitest test suite loaded live credentials from .env.local and spent real Tavily search credits (usage reached 312) due to lack of environment stripping and un-intercepted network calls.',
  'Local environment variables leaked into test runner without hermetic network call blocking.',
  'Test suite must strip all provider keys and block network calls to api.tavily.com, api.firecrawl.dev, and generativelanguage.googleapis.com.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)',
  'ANTIGRAVITY_AUDIT_20261010_STEP1'
) ON CONFLICT(id) DO UPDATE SET
  rule = excluded.rule,
  guard_type = excluded.guard_type,
  guard_ref = excluded.guard_ref,
  status = excluded.status;

-- 7. Update mistake mst_22 guard reference to data-audit-reconciliation test (Step 8c)
UPDATE mistakes_board
SET guard_type = 'TEST',
    guard_ref = 'packages/backend/tests/unit/data-audit-reconciliation.test.ts:fails when table count changes without recorded cause'
WHERE id = 'mst_22_audit_counts_did_not_match_earlier_raw_counts';

-- 8. Add DECISION record in learning_records for automatic offer lane (Step 3)
INSERT INTO learning_records (
  id, organization_id, learning_type, decision, hypothesis, action, audience, offer, channel, result,
  confidence, rule, provenance, source, created_at
) VALUES (
  'lrn_dec_auto_offer_lane_20261010',
  'org_owner_primary',
  'DECISION',
  'Owner removed per-product manual approval. Automatic offer lane builds server-side Amazon.in search URLs (https://www.amazon.in/s?k=<brand model>&tag=<tag>).',
  'Search results may convert lower than direct ASIN product pages and product availability is unverified, but enables automated publishing without scraping amazon.* or manual owner bottleneck.',
  'Generate static buyer guides using only verified brand spec lines; link to Amazon search query with transparent disclaimer.',
  'BUYER_SEARCH',
  'OFFER_AUTO_SEARCH_LANE',
  'ORGANIC_SEARCH',
  'ACTIVE_DECISION',
  1.0,
  'Link to Amazon search query with transparent disclaimer; do not scrape amazon.*',
  'APP_LOGGED_CALL',
  'OUTCOME',
  datetime('now')
) ON CONFLICT(id) DO NOTHING;

-- 9. Backfill existing learning_records source to SEEDED or OUTCOME
UPDATE learning_records SET source = 'SEEDED' WHERE source IS NULL OR source = 'UNKNOWN';
UPDATE learning_records SET source = 'OUTCOME' WHERE id LIKE '%auto_offer_lane%' OR id LIKE '%outcome%';
