-- D1 Migration 0002: Core Multi-Tenant Production Schema & Durable Entities
-- Ensures tables in D1_REVENUE_CRITICAL_TABLES exist on Cloudflare D1

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- 2. Businesses
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  public_slug TEXT,
  vertical_id TEXT NOT NULL,
  vertical_name TEXT NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'MEDIUM',
  country TEXT NOT NULL DEFAULT 'IN',
  currency TEXT NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  city TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  website_url TEXT,
  phone TEXT,
  primary_language TEXT NOT NULL DEFAULT 'English',
  secondary_languages_json TEXT NOT NULL DEFAULT '["Hindi"]',
  brand_voice TEXT NOT NULL,
  value_propositions_json TEXT NOT NULL DEFAULT '[]',
  offerings_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  autonomy_mode TEXT NOT NULL DEFAULT 'ASSISTED',
  kill_switch_active INTEGER NOT NULL DEFAULT 0,
  kill_switch_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_businesses_org ON businesses(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_public_slug
  ON businesses(public_slug)
  WHERE public_slug IS NOT NULL AND public_slug != '';

-- 3. Business Goals & KPIs
CREATE TABLE IF NOT EXISTS business_goals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  title TEXT NOT NULL,
  target_metric TEXT NOT NULL,
  target_value REAL NOT NULL,
  current_value REAL NOT NULL DEFAULT 0,
  metric_unit TEXT NOT NULL DEFAULT 'leads',
  timeframe_days INTEGER NOT NULL DEFAULT 90,
  start_date TEXT NOT NULL,
  target_date TEXT NOT NULL,
  budget_allocated_inr REAL NOT NULL,
  budget_spent_inr REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 4. Customer Journeys
CREATE TABLE IF NOT EXISTS customer_journeys (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'AWARENESS',
  first_touch_channel TEXT,
  last_touch_channel TEXT,
  conversion_probability REAL NOT NULL DEFAULT 0.05,
  total_lifetime_value_inr REAL NOT NULL DEFAULT 0,
  touchpoints_json TEXT NOT NULL DEFAULT '[]',
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  classification TEXT NOT NULL DEFAULT 'REAL',
  gclid TEXT,
  attribution_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journeys_biz ON customer_journeys(business_id);
CREATE INDEX IF NOT EXISTS idx_journeys_stage ON customer_journeys(stage);
CREATE INDEX IF NOT EXISTS idx_journeys_classification ON customer_journeys(classification);

-- 5. Payment Requests
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  prospect_id TEXT,
  offer_id TEXT,
  proposal_id TEXT,
  offer_description TEXT NOT NULL,
  amount_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  billing_model TEXT NOT NULL DEFAULT 'ONE_TIME',
  payment_link_url TEXT,
  status TEXT NOT NULL DEFAULT 'SENT',
  classification TEXT NOT NULL DEFAULT 'REAL',
  provider TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_link_id TEXT,
  provider_order_id TEXT,
  short_url TEXT,
  reference_id TEXT,
  payment_id TEXT,
  verified_at TEXT,
  verification_method TEXT,
  last_reminder_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payrq_biz ON payment_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_payrq_status ON payment_requests(status);

-- 6. Payment Provider Links
CREATE TABLE IF NOT EXISTS payment_provider_links (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  prospect_id TEXT,
  journey_id TEXT,
  proposal_id TEXT,
  provider TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_link_id TEXT NOT NULL,
  short_url TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  amount_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'CREATED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  payment_id TEXT,
  provider_response_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ppl_link_id ON payment_provider_links(provider_link_id);

-- 7. Revenue Records
CREATE TABLE IF NOT EXISTS revenue_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  revenue_type TEXT NOT NULL,
  source TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  verified INTEGER NOT NULL DEFAULT 1,
  verification_method TEXT NOT NULL DEFAULT 'RAZORPAY_WEBHOOK',
  classification TEXT NOT NULL DEFAULT 'REAL',
  recurring_model TEXT NOT NULL DEFAULT 'ONE_TIME',
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rev_records_biz ON revenue_records(business_id);
CREATE INDEX IF NOT EXISTS idx_rev_records_type ON revenue_records(revenue_type);

-- 8. Platform Prospects
CREATE TABLE IF NOT EXISTS platform_prospects (
  id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  city TEXT NOT NULL,
  neighborhood TEXT,
  website_url TEXT,
  phone TEXT,
  email TEXT,
  source TEXT NOT NULL DEFAULT 'DISCOVERY',
  status TEXT NOT NULL DEFAULT 'NEW',
  fit_score REAL NOT NULL DEFAULT 0.0,
  qualification_notes TEXT,
  observed_evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 9. Opportunities
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  prospect_id TEXT,
  lead_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  estimated_value_inr REAL NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 10. Proposals
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  prospect_id TEXT NOT NULL,
  offer_id TEXT,
  title TEXT NOT NULL,
  customer_problem TEXT NOT NULL,
  proposed_solution TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  timeline_days INTEGER NOT NULL DEFAULT 5,
  setup_price_inr REAL NOT NULL DEFAULT 15000.0,
  monthly_price_inr REAL NOT NULL DEFAULT 8000.0,
  payment_terms TEXT NOT NULL,
  scope_boundary TEXT NOT NULL,
  next_step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. Initial Tenant & Platform Records (Idempotent Seed)
INSERT OR IGNORE INTO organizations (id, name, slug)
VALUES ('org_owner_primary', 'Platform Owner Organization', 'owner-primary');

INSERT OR IGNORE INTO organizations (id, name, slug)
VALUES ('org_smilekraft_01', 'SmileKraft Healthcare Solutions', 'smilekraft-healthcare');

INSERT OR IGNORE INTO businesses (
  id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
  country, currency, timezone, city, neighborhood,
  brand_voice, autonomy_mode, kill_switch_active
) VALUES (
  'biz_platform_aro', 'org_owner_primary', 'Platform Autonomous Revenue System', 'platform-aro', 'TECHNOLOGY', 'AI & Technology Services', 'LOW',
  'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills',
  'Direct, consultative, authoritative', 'ASSISTED', 0
);

INSERT OR IGNORE INTO businesses (
  id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
  country, currency, timezone, city, neighborhood,
  website_url, phone, primary_language, secondary_languages_json,
  brand_voice, value_propositions_json, offerings_json, constraints_json,
  autonomy_mode, kill_switch_active
) VALUES (
  'biz_smilekraft_hyd', 'org_smilekraft_01', 'SmileKraft Dental Clinic Hyderabad', 'smilekraft-dental-clinic', 'HEALTHCARE_CLINIC', 'Healthcare Clinic (Dental/Orthodontics)', 'HIGH',
  'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills',
  'https://smilekraftdental.in', '+91-98491-23456', 'English', '["Telugu", "Hindi"]',
  'Clinical, reassuring, transparent, technologically progressive',
  '["AI 3D Smile Scanning", "Zero-Cost EMI Financing"]',
  '[{"id":"off_aligners","title":"Invisible Clear Aligners & Orthodontics","description":"Custom-molded digital invisible aligners with 3D smile design preview. Painless teeth straightening in 6-9 months.","priceINR":45000,"targetSegment":"Young professionals and college students in Gachibowli & Hitec City"}]',
  '{"monthlyBudgetINR": 50000, "maxCACINR": 2500}',
  'CONTROLLED_AUTONOMY', 0
);

INSERT OR IGNORE INTO businesses (
  id, organization_id, name, public_slug, vertical_id, vertical_name, risk_tier,
  country, currency, timezone, city, neighborhood,
  website_url, phone, primary_language, secondary_languages_json,
  brand_voice, value_propositions_json, offerings_json, constraints_json,
  autonomy_mode, kill_switch_active
) VALUES (
  'biz_1790714233800', 'org_owner_primary', 'SmileKraft Dental Clinic', 'smilekraft-dental-clinic-2', 'HEALTHCARE_CLINIC', 'Healthcare Clinic (Dental/Orthodontics)', 'HIGH',
  'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills',
  'https://smilekraftdental.in', '+91-98491-23456', 'English', '["Telugu", "Hindi"]',
  'Clinical, reassuring, transparent, technologically progressive',
  '["AI 3D Smile Scanning", "Zero-Cost EMI Financing"]',
  '[{"id":"off_aligners","title":"Invisible Clear Aligners & Orthodontics","description":"Custom-molded digital invisible aligners with 3D smile design preview. Painless teeth straightening in 6-9 months.","priceINR":45000,"targetSegment":"Young professionals and college students in Gachibowli & Hitec City"}]',
  '{"monthlyBudgetINR": 50000, "maxCACINR": 2500}',
  'CONTROLLED_AUTONOMY', 0
);
