-- 0043_healthcare_medical_accuracy_and_claims_gate.sql
-- V4.0 Schema: Healthcare Evidence Records, Clinical Safety Policies, Healthcare Compliance Register,
-- Multi-Market Experiments, Customer Acceptance Records, and Outreach Suppression List.

CREATE TABLE IF NOT EXISTS healthcare_evidence_records (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE,
  exact_claim TEXT NOT NULL,
  category TEXT NOT NULL, -- 'APPOINTMENT_TRIAGE', 'PRACTICE_OPERATIONS', 'NO_SHOW_REDUCTION', 'PATIENT_COMMUNICATION', 'DARK_HOURS_LEAKAGE'
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  authority_type TEXT NOT NULL, -- 'GOVERNMENT_BODY', 'PEER_REVIEWED_JOURNAL', 'STATUTORY_BOARD', 'CLINICAL_GUIDELINE', 'NMC', 'INDUSTRY_BENCHMARK'
  publication_date TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW', -- 'VERIFIED', 'PENDING_REVIEW', 'REJECTED', 'EXPIRED'
  limitations TEXT,
  expiry_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hc_evidence_claim_id ON healthcare_evidence_records(claim_id);
CREATE INDEX IF NOT EXISTS idx_hc_evidence_status ON healthcare_evidence_records(review_status);
CREATE INDEX IF NOT EXISTS idx_hc_evidence_expiry ON healthcare_evidence_records(expiry_date);

CREATE TABLE IF NOT EXISTS clinical_safety_policies (
  id TEXT PRIMARY KEY,
  policy_code TEXT NOT NULL UNIQUE,
  policy_type TEXT NOT NULL, -- 'SYMPTOM_DEFLECTION', 'EMERGENCY_ROUTING', 'NO_AUTONOMOUS_DIAGNOSIS', 'NO_PRESCRIPTION_REFILL', 'DPDP_HEALTH_MINIMIZATION'
  keywords_json TEXT NOT NULL,
  action TEXT NOT NULL, -- 'DEFLECT_TO_CLINIC_STAFF', 'ROUTE_TO_EMERGENCY_SERVICES', 'REDACT_PII'
  canned_response TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clinical_policy_code ON clinical_safety_policies(policy_code);

CREATE TABLE IF NOT EXISTS healthcare_compliance_register (
  id TEXT PRIMARY KEY,
  regulation_name TEXT NOT NULL,
  rule_summary TEXT NOT NULL,
  compliance_status TEXT NOT NULL DEFAULT 'COMPLIANT', -- 'COMPLIANT', 'UNDER_REVIEW', 'NON_COMPLIANT'
  last_audited_at TEXT NOT NULL DEFAULT (datetime('now')),
  audit_findings TEXT
);

CREATE TABLE IF NOT EXISTS market_experiments (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL UNIQUE,
  vertical TEXT NOT NULL, -- 'HEALTHCARE', 'EDUCATION', 'LOCAL_SERVICES', 'B2B_COMMERCE', 'AFFILIATE_COMMERCE'
  hypothesis TEXT NOT NULL,
  lead_target INTEGER NOT NULL DEFAULT 20,
  conversion_target INTEGER NOT NULL DEFAULT 1,
  actual_leads INTEGER NOT NULL DEFAULT 0,
  actual_conversions INTEGER NOT NULL DEFAULT 0,
  stop_condition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'PAUSED', 'STOPPED', 'PROMOTED', 'REVISED'
  start_date TEXT NOT NULL DEFAULT (datetime('now')),
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_market_exp_id ON market_experiments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_market_exp_status ON market_experiments(status);

CREATE TABLE IF NOT EXISTS customer_acceptance_records (
  id TEXT PRIMARY KEY,
  acceptance_id TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  onboarding_checklist_json TEXT NOT NULL,
  test_scenarios_passed INTEGER NOT NULL DEFAULT 0,
  test_scenarios_total INTEGER NOT NULL DEFAULT 5,
  clinical_boundary_acknowledged INTEGER NOT NULL DEFAULT 1,
  emergency_triage_acknowledged INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDING_ACCEPTANCE', -- 'PENDING_ACCEPTANCE', 'ACCEPTED', 'REJECTED'
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cust_accept_id ON customer_acceptance_records(acceptance_id);
CREATE INDEX IF NOT EXISTS idx_cust_accept_biz ON customer_acceptance_records(business_id);

CREATE TABLE IF NOT EXISTS outreach_suppression_list (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  identifier_type TEXT NOT NULL, -- 'PHONE', 'EMAIL', 'DOMAIN'
  reason TEXT NOT NULL, -- 'DO_NOT_CONTACT', 'COOL_DOWN_60D', 'OPTOUT', 'INVALID_CONTACT'
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_suppression_ident ON outreach_suppression_list(identifier);
