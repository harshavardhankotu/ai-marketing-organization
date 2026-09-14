// Complete Relational Database Schema for SQLite & Cloudflare D1
// 40+ Core Entities with strict referential integrity, indexes, and tenant isolation

export const SCHEMA_SQL = `
-- 1. Organizations (Tenants)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'OWNER',
  api_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email ON users(organization_id, email);

-- 3. Businesses
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
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

-- 4. Business Goals & KPIs
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
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  kpis_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_goals_biz ON business_goals(business_id);

-- 5. Agents
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  role TEXT NOT NULL,
  system_instruction TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  confidence_threshold REAL NOT NULL DEFAULT 0.8,
  cost_budget REAL NOT NULL DEFAULT 500,
  performance_metrics_json TEXT NOT NULL DEFAULT '{}',
  memory_scope TEXT NOT NULL DEFAULT 'SYSTEM',
  failure_policy TEXT NOT NULL DEFAULT 'RETRY',
  status TEXT NOT NULL DEFAULT 'IDLE',
  version TEXT NOT NULL DEFAULT '1.0.0',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_cat ON agents(category);

-- 6. Strategies & Versions
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
CREATE INDEX IF NOT EXISTS idx_strategies_biz ON strategies(business_id);
CREATE INDEX IF NOT EXISTS idx_strategies_goal ON strategies(goal_id);

-- 7. Campaigns
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
CREATE INDEX IF NOT EXISTS idx_campaigns_biz ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);

-- 8. Content Assets & Versions
CREATE TABLE IF NOT EXISTS content_assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  content_type TEXT NOT NULL,
  language TEXT NOT NULL,
  content TEXT NOT NULL,
  media_prompt TEXT,
  call_to_action TEXT NOT NULL,
  target_funnel_stage TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  brand_voice_score REAL NOT NULL DEFAULT 0.9,
  factual_confidence REAL NOT NULL DEFAULT 0.95,
  compliance_flags_json TEXT NOT NULL DEFAULT '[]',
  performance_json TEXT NOT NULL DEFAULT '{"impressions":0,"clicks":0,"leads":0,"qualifiedLeads":0}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_content_campaign ON content_assets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_content_channel ON content_assets(channel);

-- 9. Research Findings & Evidence
CREATE TABLE IF NOT EXISTS research_findings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  market TEXT NOT NULL,
  finding TEXT NOT NULL,
  extracted_evidence TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  certainty TEXT NOT NULL DEFAULT 'OBSERVED',
  confidence_score REAL NOT NULL DEFAULT 0.85,
  relevance_score REAL NOT NULL DEFAULT 0.9,
  tags_json TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL DEFAULT 'TEST_DATA',
  source_reference TEXT NOT NULL DEFAULT 'DETERMINISTIC_TEST_FIXTURE',
  retrieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  evidence_status TEXT NOT NULL DEFAULT 'NO_REAL_WORLD_EVIDENCE',
  data_classification TEXT NOT NULL DEFAULT 'TEST_DATA',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_research_biz ON research_findings(business_id);
CREATE INDEX IF NOT EXISTS idx_research_topic ON research_findings(topic);

-- 10. Decisions & Decision Journal
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  strategy_id TEXT,
  campaign_id TEXT,
  agent_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  alternatives_json TEXT NOT NULL DEFAULT '[]',
  expected_outcome TEXT NOT NULL,
  actual_outcome TEXT,
  outcome_evaluation TEXT DEFAULT 'PENDING',
  impact_delta_percent REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  evaluated_at TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_decisions_biz ON decisions(business_id);

-- 11. Experiments & Split Tests
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
CREATE INDEX IF NOT EXISTS idx_experiments_biz ON experiments(business_id);

-- 12. Learnings & Closed Loop Evolution
CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  source_experiment_id TEXT,
  observation TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  experiment_result TEXT NOT NULL,
  learning TEXT NOT NULL,
  policy_update TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.85,
  applied_to_strategy_version INTEGER,
  data_classification TEXT NOT NULL DEFAULT 'TEST_LEARNING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (source_experiment_id) REFERENCES experiments(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_learnings_biz ON learnings(business_id);

-- 13. Human Approval Requests
CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  requester_agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  risk_score REAL NOT NULL,
  risk_factors_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING',
  feedback_notes TEXT,
  reviewed_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_approvals_biz_status ON approval_requests(business_id, status);

-- 14. Durable Workflows & Checkpoints
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
CREATE INDEX IF NOT EXISTS idx_workflows_biz_status ON workflows(business_id, status);

CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  state_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_wf ON workflow_checkpoints(workflow_id);

-- 15. Tasks & Task Attempts
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'PENDING',
  inputs_json TEXT NOT NULL DEFAULT '{}',
  outputs_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT UNIQUE NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- 16. Multi-Scoped Memory Items
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 1.0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_biz_scope_key ON memory_items(business_id, scope, key);

-- 17. Analytics Events (Unified Telemetry)
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
CREATE INDEX IF NOT EXISTS idx_events_biz_type ON analytics_events(business_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON analytics_events(campaign_id);

-- 18. Attributions
CREATE TABLE IF NOT EXISTS attributions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  campaign_id TEXT,
  channel TEXT NOT NULL,
  model_type TEXT NOT NULL,
  credit_fraction REAL NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES analytics_events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_attributions_campaign ON attributions(campaign_id);

-- 19. Deduplication Cache (Fingerprints)
CREATE TABLE IF NOT EXISTS deduplication_cache (
  fingerprint TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  model_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- 20. Quota Tracking & Rate Limiting
CREATE TABLE IF NOT EXISTS quota_records (
  date_key TEXT PRIMARY KEY,
  gemini_requests INTEGER NOT NULL DEFAULT 0,
  gemini_tokens INTEGER NOT NULL DEFAULT 0,
  cloudflare_worker_requests INTEGER NOT NULL DEFAULT 0,
  throttled_events INTEGER NOT NULL DEFAULT 0,
  circuit_breaker_tripped INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 21. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_logs(organization_id);

-- 22. Integrations Registry
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
  mode TEXT NOT NULL DEFAULT 'SANDBOX',
  credentials_meta_json TEXT NOT NULL DEFAULT '{}',
  last_health_check TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_biz_provider ON integrations(business_id, provider);

-- 23. Customer Journeys (End-to-End Visitor -> Customer Progression)
CREATE TABLE IF NOT EXISTS customer_journeys (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  stage TEXT NOT NULL DEFAULT 'VISITOR',
  first_touch_channel TEXT,
  last_touch_channel TEXT,
  touchpoints_json TEXT NOT NULL DEFAULT '[]',
  total_lifetime_value_inr REAL NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT 'TEST',
  gclid TEXT,
  attribution_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journeys_biz_visitor ON customer_journeys(business_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_journeys_stage ON customer_journeys(stage);
CREATE INDEX IF NOT EXISTS idx_journeys_class ON customer_journeys(classification);
CREATE INDEX IF NOT EXISTS idx_journeys_gclid ON customer_journeys(gclid);
CREATE INDEX IF NOT EXISTS idx_journeys_attr_status ON customer_journeys(attribution_status);

-- 24. Transactions (INR Revenue Reconciliation & Verification)
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
CREATE INDEX IF NOT EXISTS idx_tx_biz ON transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_tx_campaign ON transactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tx_class ON transactions(classification);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

-- 25. AI Cost Logs (Token Accounting, Thinking Budgets & Unit Economics)
CREATE TABLE IF NOT EXISTS ai_cost_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  division TEXT NOT NULL,
  model TEXT NOT NULL,
  thinking_level TEXT NOT NULL DEFAULT 'none',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  estimated_cost_inr REAL NOT NULL DEFAULT 0,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_cost_biz ON ai_cost_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_ai_cost_agent ON ai_cost_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_cost_division ON ai_cost_logs(division);

-- 26. Appointments (Confirmed Patient Clinical Appointments)
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  service TEXT NOT NULL,
  clinic_location TEXT NOT NULL,
  clinic_confirmation TEXT NOT NULL DEFAULT 'CONFIRMED',
  confirmation_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_appointments_journey ON appointments(journey_id);
CREATE INDEX IF NOT EXISTS idx_appointments_biz ON appointments(business_id);

-- 27. Google Clicks (Click-Level Verification from Google Ads click_view)
CREATE TABLE IF NOT EXISTS google_clicks (
  gclid TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  ad_group_id TEXT,
  keyword TEXT,
  device TEXT,
  click_type TEXT,
  click_timestamp TEXT NOT NULL,
  verification_source TEXT NOT NULL DEFAULT 'GOOGLE_ADS_API_CLICK_VIEW',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gclicks_campaign ON google_clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_gclicks_time ON google_clicks(click_timestamp);

-- 28. Marketing Memories (Structured Long-Term Evidence-Backed Memory)
CREATE TABLE IF NOT EXISTS marketing_memories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  insight TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  source_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  maturity TEXT NOT NULL DEFAULT 'HYPOTHESIS',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  verified_revenue_inr REAL NOT NULL DEFAULT 0.0,
  verified_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memories_biz ON marketing_memories(business_id);
CREATE INDEX IF NOT EXISTS idx_memories_dim ON marketing_memories(dimension);
CREATE INDEX IF NOT EXISTS idx_memories_maturity ON marketing_memories(maturity);

-- 29. Campaign Knowledge Graph (Nodes and Provenance Edges)
CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  label TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_type ON knowledge_graph_nodes(node_type);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  evidence_id TEXT,
  weight REAL DEFAULT 1.0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_node_id) REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kg_edges_source ON knowledge_graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_target ON knowledge_graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_status ON knowledge_graph_edges(verification_status);

-- 30. Predictions & Prediction vs Outcome
CREATE TABLE IF NOT EXISTS predictions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREDICTION_PENDING',
  expected_conversion_rate REAL,
  expected_cpl_inr REAL,
  expected_cac_inr REAL,
  expected_revenue_inr REAL,
  expected_roas REAL,
  confidence REAL NOT NULL,
  actual_conversion_rate REAL,
  actual_cpl_inr REAL,
  actual_cac_inr REAL,
  actual_revenue_inr REAL,
  actual_roas REAL,
  prediction_error REAL,
  evaluated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_predictions_agent ON predictions(agent_id);
CREATE INDEX IF NOT EXISTS idx_predictions_biz ON predictions(business_id);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);

-- 31. Agent Scorecards
CREATE TABLE IF NOT EXISTS agent_scorecards (
  agent_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  division TEXT NOT NULL,
  test_decisions_count INTEGER NOT NULL DEFAULT 0,
  real_decisions_count INTEGER NOT NULL DEFAULT 0,
  pending_predictions_count INTEGER NOT NULL DEFAULT 0,
  resolved_predictions_count INTEGER NOT NULL DEFAULT 0,
  sample_size_tier TEXT NOT NULL DEFAULT 'PILOT_SAMPLE',
  confidence_level TEXT NOT NULL DEFAULT 'LOW',
  is_top_performer INTEGER NOT NULL DEFAULT 0,
  accepted_recommendations INTEGER NOT NULL DEFAULT 0,
  rejected_recommendations INTEGER NOT NULL DEFAULT 0,
  successful_actions INTEGER NOT NULL DEFAULT 0,
  failed_actions INTEGER NOT NULL DEFAULT 0,
  average_prediction_accuracy_percent REAL NOT NULL DEFAULT 0.0,
  real_revenue_influenced_inr REAL NOT NULL DEFAULT 0.0,
  real_cost_influenced_inr REAL NOT NULL DEFAULT 0.0,
  outcome_quality_score REAL NOT NULL DEFAULT 50.0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 32. Stop Conditions Log
CREATE TABLE IF NOT EXISTS stop_conditions_log (
  id TEXT PRIMARY KEY,
  condition TEXT NOT NULL,
  details TEXT NOT NULL,
  campaign_halted INTEGER NOT NULL DEFAULT 1,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 33. Autonomy Policy & Budget Controls
CREATE TABLE IF NOT EXISTS autonomy_policy (
  business_id TEXT PRIMARY KEY,
  active_mode TEXT NOT NULL DEFAULT 'CONTROLLED_AUTONOMY',
  max_autonomous_spend_inr REAL NOT NULL DEFAULT 10000.0,
  current_autonomous_spend_inr REAL NOT NULL DEFAULT 0.0,
  requires_owner_approval_above_inr REAL NOT NULL DEFAULT 10000.0,
  stop_conditions_triggered INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 34. Treatment Plans (Quotes vs Payments Separation)
CREATE TABLE IF NOT EXISTS treatment_plans (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  service TEXT NOT NULL,
  quoted_amount_inr REAL NOT NULL,
  accepted_treatment_amount_inr REAL NOT NULL DEFAULT 0.0,
  deposit_amount_inr REAL NOT NULL DEFAULT 0.0,
  paid_amount_inr REAL NOT NULL DEFAULT 0.0,
  outstanding_amount_inr REAL NOT NULL DEFAULT 0.0,
  doctor_notes TEXT NOT NULL DEFAULT '',
  clinic_confirmation TEXT NOT NULL DEFAULT 'PENDING',
  confirmation_source TEXT NOT NULL DEFAULT 'MANUAL',
  confirmation_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  treatment_plan_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tplans_biz ON treatment_plans(business_id);
CREATE INDEX IF NOT EXISTS idx_tplans_journey ON treatment_plans(journey_id);

-- 35. Immutable Truth Events (Event Sourcing Audit Log)
CREATE TABLE IF NOT EXISTS immutable_truth_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  journey_id TEXT,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ite_biz ON immutable_truth_events(business_id);
CREATE INDEX IF NOT EXISTS idx_ite_journey ON immutable_truth_events(journey_id);
CREATE INDEX IF NOT EXISTS idx_ite_type ON immutable_truth_events(event_type);

-- 36. Organic Marketing Channels
CREATE TABLE IF NOT EXISTS organic_channels (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  strategy TEXT NOT NULL,
  content_themes_json TEXT NOT NULL DEFAULT '[]',
  call_to_action TEXT NOT NULL,
  tracking_template TEXT NOT NULL,
  source_evidence TEXT NOT NULL,
  active_status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_org_chan_biz ON organic_channels(business_id);

-- 37. Organic Content Assets & Medical Compliance Approval
CREATE TABLE IF NOT EXISTS organic_content (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  call_to_action TEXT NOT NULL,
  target_keyword TEXT,
  tracking_params_json TEXT NOT NULL,
  created_by_agent TEXT NOT NULL,
  has_medical_claim INTEGER NOT NULL DEFAULT 0,
  medical_claim_source TEXT,
  approval_status TEXT NOT NULL DEFAULT 'AI_DRAFT',
  publication_status TEXT NOT NULL DEFAULT 'DRAFT',
  source_evidence TEXT,
  clinic_approved_by TEXT,
  approved_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_org_content_biz ON organic_content(business_id);
CREATE INDEX IF NOT EXISTS idx_org_content_status ON organic_content(approval_status);

-- 38. Local Landing Pages
CREATE TABLE IF NOT EXISTS local_landing_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  clinic_name TEXT NOT NULL,
  location TEXT NOT NULL,
  service TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  cta_text TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  appointment_path TEXT NOT NULL,
  verified_doctor TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 39. Clinical Review Requests (Post-Appointment Verification)
CREATE TABLE IF NOT EXISTS review_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  clinic_confirmation TEXT NOT NULL DEFAULT 'CONFIRMED',
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  request_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  feedback_score REAL,
  external_review_platform TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rev_req_biz ON review_requests(business_id);

-- 40. Referral Partnerships & Local Community Proposals
CREATE TABLE IF NOT EXISTS referral_partnerships (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  category TEXT NOT NULL,
  partner_name TEXT NOT NULL,
  contact_person TEXT,
  proposal_draft TEXT NOT NULL,
  offer_terms TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ref_part_biz ON referral_partnerships(business_id);

-- 41. Ethical Direct Outreach & Rate Limits Log
CREATE TABLE IF NOT EXISTS direct_outreach_log (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  segment TEXT NOT NULL,
  prospect_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  message_draft TEXT NOT NULL,
  compliance_checked INTEGER NOT NULL DEFAULT 0,
  human_approved INTEGER NOT NULL DEFAULT 0,
  dispatched INTEGER NOT NULL DEFAULT 0,
  dispatch_timestamp TEXT,
  response_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outreach_biz ON direct_outreach_log(business_id);

-- 42. Google Business Profile Boundary
CREATE TABLE IF NOT EXISTS gbp_interactions (
  business_id TEXT PRIMARY KEY,
  search_impressions INTEGER,
  map_impressions INTEGER,
  call_clicks INTEGER NOT NULL DEFAULT 0,
  website_clicks INTEGER NOT NULL DEFAULT 0,
  direction_requests INTEGER NOT NULL DEFAULT 0,
  reviews_count INTEGER NOT NULL DEFAULT 0,
  average_rating REAL NOT NULL DEFAULT 0.0,
  last_sync_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
`;