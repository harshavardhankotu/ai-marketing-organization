-- 0003_d1_revenue_critical_tables.sql

-- Remaining durable tables for Cloudflare D1 production execution


CREATE TABLE IF NOT EXISTS business_autonomy_lock (
  business_id TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  lock_owner TEXT NOT NULL,
  lease_expiry TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS autonomous_cycle_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT,
  trigger_source TEXT NOT NULL DEFAULT 'SCHEDULER', -- SCHEDULER | EVENT | MANUAL | CLOUDFLARE_CRON
  cycle_start TEXT NOT NULL DEFAULT (datetime('now')),
  cycle_end TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING', -- RUNNING | COMPLETED | FAILED | PARTIAL
  opportunities_discovered INTEGER NOT NULL DEFAULT 0,
  opportunities_qualified INTEGER NOT NULL DEFAULT 0,
  actions_taken INTEGER NOT NULL DEFAULT 0,
  revenue_recorded_inr REAL NOT NULL DEFAULT 0,
  next_best_action TEXT,
  next_cycle_at TEXT,
  error_message TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS provider_quota_state (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  provider_limit INTEGER,
  application_limit INTEGER NOT NULL DEFAULT 1200,
  requests_today INTEGER NOT NULL DEFAULT 0,
  credits_consumed_month INTEGER NOT NULL DEFAULT 0,
  credits_estimated_remaining INTEGER,
  rate_limit_responses INTEGER NOT NULL DEFAULT 0,
  successful_requests INTEGER NOT NULL DEFAULT 0,
  failed_requests INTEGER NOT NULL DEFAULT 0,
  is_locked INTEGER NOT NULL DEFAULT 0,
  lock_reason TEXT,
  last_reset TEXT,
  next_reset TEXT,
  reset_window_hours INTEGER NOT NULL DEFAULT 24,
  last_successful_request TEXT,
  last_rate_limit TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS strategies (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  positioning TEXT NOT NULL,
  target_audience_json TEXT NOT NULL DEFAULT '[]',
  channel_strategy_json TEXT NOT NULL DEFAULT '[]',
  content_themes_json TEXT NOT NULL DEFAULT '[]',
  expected_leads INTEGER NOT NULL,
  expected_cpql_inr REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (goal_id) REFERENCES business_goals(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  channels_json TEXT NOT NULL DEFAULT '[]',
  target_audience TEXT NOT NULL,
  geography_json TEXT NOT NULL DEFAULT '{}',
  budget_inr REAL NOT NULL,
  spent_inr REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  primary_kpi TEXT NOT NULL,
  target_qualified_leads INTEGER NOT NULL,
  achieved_qualified_leads INTEGER NOT NULL DEFAULT 0,
  conversion_threshold REAL NOT NULL DEFAULT 0.05,
  experiment_plan_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
  FOREIGN KEY (goal_id) REFERENCES business_goals(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  journey_id TEXT,
  order_id TEXT UNIQUE NOT NULL,
  amount_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'CREATED',
  receipt TEXT NOT NULL,
  payment_id TEXT,
  notes_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  journey_id TEXT,
  campaign_id TEXT,
  invoice_number TEXT UNIQUE NOT NULL,
  amount_inr REAL NOT NULL,
  payment_method TEXT NOT NULL,
  payment_gateway TEXT NOT NULL DEFAULT 'SIMULATED',
  transaction_ref TEXT,
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  classification TEXT NOT NULL DEFAULT 'TEST',
  service_rendered TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS sales_pipeline (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  outbound_contact_id TEXT,
  journey_id TEXT,
  stage TEXT NOT NULL DEFAULT 'PROSPECT',
  -- PROSPECT | CONTACTED | REPLIED | QUALIFIED | MEETING_BOOKED | PROPOSAL_SENT | PAYMENT_PENDING | PAID | ONBOARDED | RETAINED | LOST
  owner_agent TEXT NOT NULL DEFAULT 'orchestrator',
  next_action TEXT,
  next_action_at TEXT,
  reason TEXT,
  probability REAL NOT NULL DEFAULT 0,
  expected_revenue_inr REAL NOT NULL DEFAULT 0,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS outbound_contacts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL, -- which business is doing the outreach
  organization_id TEXT NOT NULL,
  prospect_name TEXT NOT NULL,
  prospect_business_name TEXT,
  prospect_email TEXT,
  prospect_phone TEXT,
  prospect_website TEXT,
  prospect_city TEXT,
  prospect_vertical TEXT,
  channel TEXT NOT NULL DEFAULT 'EMAIL', -- EMAIL | WHATSAPP
  email_authorized INTEGER NOT NULL DEFAULT 0, -- 1 when email is verified business contact
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0, -- 1 ONLY when explicit consent evidence exists
  authorization_source TEXT, -- PUBLIC_BUSINESS_CONTACT | EXPLICIT_CONSENT | INBOUND_REQUEST
  authorization_evidence_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'MANUAL', -- TAVILY_RESEARCH | GBP_DISCOVERY | REFERRAL | MANUAL
  discovery_evidence_json TEXT NOT NULL DEFAULT '{}', -- raw source data
  is_opted_out INTEGER NOT NULL DEFAULT 0,
  is_bounced INTEGER NOT NULL DEFAULT 0,
  is_suppressed INTEGER NOT NULL DEFAULT 0,
  suppression_reason TEXT,
  last_contacted_at TEXT,
  contact_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT, -- cannot contact before this time
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE (business_id, prospect_email)
);


CREATE TABLE IF NOT EXISTS commercial_evidence (
  id TEXT PRIMARY KEY,
  milestone TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  request_reference TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'REAL',
  verification_source TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (tenant_id) REFERENCES organizations(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS autonomous_action_traces (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  expected_value REAL NOT NULL DEFAULT 0.0,
  authorization TEXT NOT NULL,
  quota_reservation TEXT NOT NULL,
  provider TEXT NOT NULL,
  request_id TEXT,
  provider_response TEXT,
  classification TEXT NOT NULL,
  result TEXT NOT NULL,
  external_id TEXT,
  cost REAL NOT NULL DEFAULT 0.0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS platform_customer_deliveries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'ONBOARDING', -- ONBOARDING | DAY_1_INTEGRATION | DAY_2_AUDIT | DAY_3_WORKFLOWS | DAY_4_CALENDAR | DAY_5_HANDOVER | COMPLETED
  contract_terms TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  success_metrics_json TEXT NOT NULL DEFAULT '[]',
  renewal_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS owner_sessions (
  id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL DEFAULT 'OWNER',
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS durable_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  -- NEW_PROSPECT | NEW_RESEARCH | NEW_LEAD | LEAD_NO_RESPONSE | LEAD_REPLIED |
  -- APPOINTMENT_BOOKED | APPOINTMENT_COMPLETED | OFFER_SENT | PAYMENT_REQUESTED |
  -- PAYMENT_RECEIVED | CUSTOMER_CREATED | CUSTOMER_LOST | EXPERIMENT_RESULT | REVENUE_RECORDED
  business_id TEXT,
  organization_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  processed INTEGER NOT NULL DEFAULT 0, -- 0=pending, 1=processed
  processed_at TEXT,
  triggered_agents_json TEXT NOT NULL DEFAULT '[]', -- which agents handled this event
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS learning_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT,
  learning_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  action TEXT NOT NULL,
  audience TEXT NOT NULL,
  offer TEXT NOT NULL,
  channel TEXT NOT NULL,
  result TEXT NOT NULL,
  revenue_inr REAL NOT NULL DEFAULT 0.0,
  cost_inr REAL NOT NULL DEFAULT 0.0,
  time_taken_hours REAL NOT NULL DEFAULT 0.0,
  confidence REAL NOT NULL DEFAULT 0.5,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS search_cache (
  id TEXT PRIMARY KEY,
  query_normalized TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'google_custom_search',
  raw_response_json TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  data_classification TEXT NOT NULL DEFAULT 'UNKNOWN', -- REAL_DATA | TEST_DATA | UNKNOWN
  source_verified INTEGER NOT NULL DEFAULT 0, -- 1 when verified against real web source
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS delivery_tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  customer_journey_id TEXT NOT NULL,
  service_type TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'ONBOARDING',
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  results_json TEXT NOT NULL DEFAULT '{}',
  action_classification TEXT NOT NULL DEFAULT 'INTERNAL_AUTOMATION',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_journey_id) REFERENCES customer_journeys(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  goal_id TEXT,
  campaign_id TEXT,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  current_step TEXT NOT NULL DEFAULT 'INIT',
  last_successful_checkpoint TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  inputs_json TEXT NOT NULL DEFAULT '{}',
  outputs_json TEXT NOT NULL DEFAULT '{}',
  error_info TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  campaign_id TEXT,
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  baseline TEXT NOT NULL,
  treatment TEXT NOT NULL,
  success_metric TEXT NOT NULL,
  minimum_evidence_requirement INTEGER NOT NULL DEFAULT 50,
  expected_effect TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'RUNNING',
  outcome TEXT,
  confidence_score REAL NOT NULL DEFAULT 0.5,
  decision_summary TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{"baselineSamples":0,"baselineConversions":0,"treatmentSamples":0,"treatmentConversions":0,"pVal":1.0}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  campaign_id TEXT,
  content_asset_id TEXT,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_identifier TEXT,
  revenue_inr REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
