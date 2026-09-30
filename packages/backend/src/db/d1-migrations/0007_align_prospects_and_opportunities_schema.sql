-- 0007_align_prospects_and_opportunities_schema.sql
-- Align schema for platform_prospects and opportunities with autonomous revenue organization engine

ALTER TABLE platform_prospects ADD COLUMN prospect_business_name TEXT;
ALTER TABLE platform_prospects ADD COLUMN prospect_owner_name TEXT;
ALTER TABLE platform_prospects ADD COLUMN prospect_email TEXT;
ALTER TABLE platform_prospects ADD COLUMN prospect_phone TEXT;
ALTER TABLE platform_prospects ADD COLUMN prospect_website TEXT;
ALTER TABLE platform_prospects ADD COLUMN prospect_city TEXT;
ALTER TABLE platform_prospects ADD COLUMN prospect_vertical TEXT;
ALTER TABLE platform_prospects ADD COLUMN discovery_source TEXT DEFAULT 'TAVILY_RESEARCH';
ALTER TABLE platform_prospects ADD COLUMN discovery_evidence_json TEXT DEFAULT '{}';
ALTER TABLE platform_prospects ADD COLUMN audit_score REAL DEFAULT 0.85;
ALTER TABLE platform_prospects ADD COLUMN stage TEXT DEFAULT 'DISCOVERED';
ALTER TABLE platform_prospects ADD COLUMN is_opted_out INTEGER DEFAULT 0;
ALTER TABLE platform_prospects ADD COLUMN last_contacted_at TEXT;
ALTER TABLE platform_prospects ADD COLUMN contact_count INTEGER DEFAULT 0;
ALTER TABLE platform_prospects ADD COLUMN monthly_fee_inr REAL DEFAULT 15000;
ALTER TABLE platform_prospects ADD COLUMN notes TEXT;

ALTER TABLE opportunities ADD COLUMN source TEXT DEFAULT 'OUTBOUND_PROSPECT';
ALTER TABLE opportunities ADD COLUMN evidence_json TEXT DEFAULT '[]';
ALTER TABLE opportunities ADD COLUMN probability REAL DEFAULT 0.2;
ALTER TABLE opportunities ADD COLUMN acquisition_cost_inr REAL DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN time_to_revenue_days INTEGER DEFAULT 7;
ALTER TABLE opportunities ADD COLUMN authorization_requirements_json TEXT DEFAULT '[]';
ALTER TABLE opportunities ADD COLUMN risk_level TEXT DEFAULT 'LOW';
ALTER TABLE opportunities ADD COLUMN next_best_action TEXT DEFAULT 'PURSUE_OPPORTUNITY';
ALTER TABLE opportunities ADD COLUMN expected_revenue_inr REAL DEFAULT 0;
