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
  public_slug TEXT,
  vertical_id TEXT NOT NULL,
  vertical_name TEXT NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'MEDIUM',
  country TEXT NOT NULL DEFAULT 'IN',
  currency TEXT NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  locale TEXT NOT NULL DEFAULT 'en-US',
  city TEXT NOT NULL,
  neighborhood TEXT NOT NULL,
  service_area_json TEXT NOT NULL DEFAULT '[]',
  website_url TEXT,
  phone TEXT,
  email TEXT,
  primary_language TEXT NOT NULL DEFAULT 'English',
  secondary_languages_json TEXT NOT NULL DEFAULT '["Hindi"]',
  brand_voice TEXT NOT NULL,
  value_propositions_json TEXT NOT NULL DEFAULT '[]',
  offerings_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  autonomy_mode TEXT NOT NULL DEFAULT 'ASSISTED',
  kill_switch_active INTEGER NOT NULL DEFAULT 0,
  kill_switch_reason TEXT,
  public_live INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_businesses_org ON businesses(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_public_slug
  ON businesses(public_slug)
  WHERE public_slug IS NOT NULL AND public_slug != '';

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

-- 20b. Universal Free-Tier Quota Locks (Strict Daily Circuit Breaker)
CREATE TABLE IF NOT EXISTS universal_quota_locks (
  service TEXT NOT NULL,
  date_key TEXT NOT NULL,
  requests_count INTEGER NOT NULL DEFAULT 0,
  max_free_requests INTEGER NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  lock_reason TEXT,
  locked_at TEXT,
  PRIMARY KEY (service, date_key)
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

-- 24b. Payment Orders (Razorpay & Online Inbound Patient Payments)
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
CREATE INDEX IF NOT EXISTS idx_payment_orders_order ON payment_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_biz ON payment_orders(business_id);

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
  publishing_mode TEXT NOT NULL DEFAULT 'REQUIRES_CLINIC_APPROVAL',
  publication_evidence_json TEXT,
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

-- 43. Traffic Sessions & External Provenance
CREATE TABLE IF NOT EXISTS traffic_sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  referrer TEXT NOT NULL DEFAULT '',
  landing_page TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  traffic_evidence_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  ip_address TEXT,
  user_agent TEXT,
  is_external INTEGER NOT NULL DEFAULT 0,
  verification_reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_traffic_sess_biz ON traffic_sessions(business_id);
CREATE INDEX IF NOT EXISTS idx_traffic_sess_visitor ON traffic_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_traffic_sess_status ON traffic_sessions(traffic_evidence_status);
CREATE INDEX IF NOT EXISTS idx_traffic_sess_source ON traffic_sessions(source);

-- 44. Google Business Profile OAuth 2.0 Credentials & State
CREATE TABLE IF NOT EXISTS gbp_oauth_authorizations (
  business_id TEXT PRIMARY KEY,
  google_account_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  oauth_status TEXT NOT NULL DEFAULT 'NOT_CONNECTED',
  authorization_timestamp TEXT,
  token_expiry TEXT,
  encrypted_refresh_token TEXT,
  scopes TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/business.manage',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);

-- 45. Lead Acquisition Evidence (Separating Suresh Reddy Baseline from New Inbound)
CREATE TABLE IF NOT EXISTS acquisition_evidence (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  journey_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  lead_status TEXT NOT NULL DEFAULT 'REAL_LEAD',
  source_provenance TEXT NOT NULL DEFAULT 'UNKNOWN',
  traffic_evidence_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  verified_organic INTEGER NOT NULL DEFAULT 0,
  evidence_details TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_acq_ev_journey ON acquisition_evidence(journey_id);
CREATE INDEX IF NOT EXISTS idx_acq_ev_source ON acquisition_evidence(source_provenance);

-- 46. DPDP Act 2023 Digital Patient Consents & Rights Management
CREATE TABLE IF NOT EXISTS patient_dpdp_consents (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  journey_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  ip_address TEXT,
  purpose TEXT NOT NULL,
  consent_version TEXT NOT NULL DEFAULT '2026.1',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  consent_timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_timestamp TEXT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dpdp_biz ON patient_dpdp_consents(business_id);
-- 47. Automated Payment Orders & Gateway Reconciliation
CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  journey_id TEXT,
  order_id TEXT UNIQUE NOT NULL,
  amount_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'CREATED',
  receipt TEXT NOT NULL,
  notes_json TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pay_orders_biz ON payment_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_orders_ref ON payment_orders(order_id);

-- 48. Search Cache for Google Custom Search JSON API
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
CREATE INDEX IF NOT EXISTS idx_search_cache_query ON search_cache(query_normalized);

-- 49. Search Query Audit Log (Audit trail of every external outbound query)
CREATE TABLE IF NOT EXISTS search_queries_log (
  id TEXT PRIMARY KEY,
  business_id TEXT,
  query_text TEXT NOT NULL,
  provider TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  is_cached INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  raw_response_json TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_log_biz ON search_queries_log(business_id);

-- 50. Subscriptions & Multi-Tenant Billing
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  plan_tier TEXT NOT NULL DEFAULT 'GROWTH',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  monthly_price_inr REAL NOT NULL DEFAULT 4999,
  razorpay_subscription_id TEXT,
  current_period_start TEXT NOT NULL DEFAULT (datetime('now')),
  current_period_end TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sub_org ON subscriptions(organization_id);

-- ============================================================
-- AUTONOMOUS REVENUE ORGANIZATION — New Tables (Spec 2026-09)
-- ============================================================

-- 51. Opportunities (OpportunityEngine — every discovered revenue opportunity)
CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  prospect_id TEXT, -- explicit lineage to platform_prospects.id
  title TEXT,
  source TEXT NOT NULL, -- ORGANIC_SEARCH | SOCIAL | REFERRAL | LOCAL_PARTNERSHIP | COMPETITOR_GAP | INBOUND | OUTBOUND_PROSPECT
  evidence_json TEXT NOT NULL DEFAULT '[]', -- array of real-world evidence references (URLs, Tavily results, etc.)
  estimated_value_inr REAL NOT NULL DEFAULT 0,
  probability REAL NOT NULL DEFAULT 0, -- 0-1
  confidence_score REAL NOT NULL DEFAULT 0.5,
  acquisition_cost_inr REAL NOT NULL DEFAULT 0,
  time_to_revenue_days INTEGER NOT NULL DEFAULT 30,
  authorization_requirements_json TEXT NOT NULL DEFAULT '[]',
  risk_level TEXT NOT NULL DEFAULT 'MEDIUM', -- LOW | MEDIUM | HIGH
  next_best_action TEXT,
  status TEXT NOT NULL DEFAULT 'DISCOVERED', -- DISCOVERED | QUALIFIED | ENGAGING | CONVERTING | WON | LOST | IGNORED
  expected_revenue_inr REAL GENERATED ALWAYS AS (estimated_value_inr * probability) VIRTUAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_opp_biz_status ON opportunities(business_id, status);
CREATE INDEX IF NOT EXISTS idx_opp_org ON opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_opp_prospect ON opportunities(prospect_id);

-- 52. Sales Pipeline (end-to-end lead progression with owner agent)
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
CREATE INDEX IF NOT EXISTS idx_pipeline_biz_stage ON sales_pipeline(business_id, stage);
CREATE INDEX IF NOT EXISTS idx_pipeline_opp ON sales_pipeline(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_next_action ON sales_pipeline(next_action_at);

-- 53. Outbound Contacts (prospects for platform and client outbound sales)
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
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | REJECTED
  last_contacted_at TEXT,
  contact_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT, -- cannot contact before this time
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE (business_id, prospect_email)
);
CREATE INDEX IF NOT EXISTS idx_outbound_biz ON outbound_contacts(business_id);
CREATE INDEX IF NOT EXISTS idx_outbound_opted_out ON outbound_contacts(is_opted_out);
CREATE INDEX IF NOT EXISTS idx_outbound_suppressed ON outbound_contacts(is_suppressed);
CREATE INDEX IF NOT EXISTS idx_outbound_channel ON outbound_contacts(channel);

-- 54. Durable Events (autonomous event bus — every event that triggers agent action)
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
CREATE INDEX IF NOT EXISTS idx_events_org_type ON durable_events(organization_id, event_type);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON durable_events(processed, created_at);
CREATE INDEX IF NOT EXISTS idx_events_biz ON durable_events(business_id);

-- 55. Platform Prospects (the platform's own outbound self-sales pipeline)
CREATE TABLE IF NOT EXISTS platform_prospects (
  id TEXT PRIMARY KEY,
  business_name TEXT,
  prospect_business_name TEXT NOT NULL,
  prospect_owner_name TEXT,
  email TEXT,
  prospect_email TEXT,
  phone TEXT,
  prospect_phone TEXT,
  website_url TEXT,
  prospect_website TEXT,
  city TEXT,
  prospect_city TEXT NOT NULL,
  vertical TEXT,
  prospect_vertical TEXT NOT NULL, -- dental | salon | clinic | tuition | fitness | legal | home_services
  source TEXT DEFAULT 'TAVILY_RESEARCH',
  discovery_source TEXT NOT NULL DEFAULT 'TAVILY_RESEARCH',
  discovery_evidence_json TEXT NOT NULL DEFAULT '{}',
  observed_evidence_json TEXT NOT NULL DEFAULT '{}',
  fit_score REAL DEFAULT 0.85,
  audit_score REAL, -- estimated opportunity value if we onboard them
  status TEXT DEFAULT 'DISCOVERED',
  stage TEXT NOT NULL DEFAULT 'DISCOVERED',
  -- DISCOVERED | AUDITED | CONTACTED | REPLIED | DEMO_DONE | PROPOSAL_SENT | PAID | LOST
  is_opted_out INTEGER NOT NULL DEFAULT 0,
  last_contacted_at TEXT,
  contact_count INTEGER NOT NULL DEFAULT 0,
  monthly_fee_inr REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_prospects_email ON platform_prospects(prospect_email) WHERE prospect_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_prospects_stage ON platform_prospects(stage);
CREATE INDEX IF NOT EXISTS idx_platform_prospects_vertical ON platform_prospects(prospect_vertical);

-- 56. Payment Requests (PaymentRequestEngine — tracks every payment request lifecycle, Spec § 9)
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  prospect_id TEXT,
  opportunity_id TEXT,
  journey_id TEXT,
  proposal_id TEXT, -- explicit lineage to proposals.id
  offer_id TEXT,
  offer_description TEXT NOT NULL DEFAULT 'Commercial Service',
  amount_inr REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  billing_model TEXT NOT NULL DEFAULT 'ONE_TIME',
  provider TEXT NOT NULL DEFAULT 'RAZORPAY',
  provider_link_id TEXT,
  provider_order_id TEXT,
  short_url TEXT,
  reference_id TEXT,
  classification TEXT NOT NULL DEFAULT 'REAL', -- REAL | MANUAL_VERIFIED | TEST | SIMULATED
  status TEXT NOT NULL DEFAULT 'DRAFT',
  -- DRAFT | REQUEST_CREATED | PROVIDER_CREATED | SENT | VIEWED | PAYMENT_PENDING | PAID | FAILED | EXPIRED | CANCELLED | REFUNDED | CHARGEBACK
  payment_link TEXT,
  razorpay_order_id TEXT,
  payment_id TEXT,
  payment_verified_at TEXT,
  verified_at TEXT,
  verification_method TEXT,
  payment_evidence_json TEXT NOT NULL DEFAULT '{}',
  fulfilment_triggered INTEGER NOT NULL DEFAULT 0,
  revenue_recorded INTEGER NOT NULL DEFAULT 0,
  last_reminder_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payrq_biz_status ON payment_requests(business_id, status);
CREATE INDEX IF NOT EXISTS idx_payrq_opp ON payment_requests(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_payrq_provider_link ON payment_requests(provider_link_id);
CREATE INDEX IF NOT EXISTS idx_payrq_proposal ON payment_requests(proposal_id);

-- 57. Revenue Attribution Chain (full chain: customer → opportunity → source → campaign)
CREATE TABLE IF NOT EXISTS revenue_attribution_chain (
  id TEXT PRIMARY KEY,
  transaction_id TEXT,
  journey_id TEXT,
  opportunity_id TEXT,
  campaign_id TEXT,
  content_asset_id TEXT,
  channel TEXT,
  acquisition_source TEXT,
  strategy_id TEXT,
  evidence_confidence TEXT NOT NULL DEFAULT 'INFERRED', -- DIRECT | CORRELATED | INFERRED | UNKNOWN
  attribution_method TEXT NOT NULL DEFAULT 'LAST_TOUCH',
  revenue_inr REAL NOT NULL DEFAULT 0,
  classification TEXT NOT NULL DEFAULT 'REAL',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL,
  FOREIGN KEY (journey_id) REFERENCES customer_journeys(id) ON DELETE SET NULL,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_attr_chain_journey ON revenue_attribution_chain(journey_id);
CREATE INDEX IF NOT EXISTS idx_attr_chain_opp ON revenue_attribution_chain(opportunity_id);

-- 58. Autonomous Cycle Log (audit log for every AutonomousRevenueOrchestrator execution)
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
CREATE INDEX IF NOT EXISTS idx_cycle_log_org ON autonomous_cycle_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_cycle_log_status ON autonomous_cycle_log(status);

-- 59. Provider Quota State (unified quota manager — one row per provider)
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
  source TEXT DEFAULT 'SYSTEM',
  unlogged_credits INTEGER DEFAULT 0,
  unlogged_reason TEXT,
  limit_source TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 60. Automation Health (one row per organization)
CREATE TABLE IF NOT EXISTS automation_health (
  organization_id TEXT PRIMARY KEY,
  last_successful_wake TEXT,
  last_successful_external_action TEXT,
  last_successful_revenue_action TEXT,
  consecutive_wake_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_action_failures INTEGER NOT NULL DEFAULT 0,
  provider_failures_json TEXT NOT NULL DEFAULT '{}',
  quota_locks_json TEXT NOT NULL DEFAULT '[]',
  authorization_blocks INTEGER NOT NULL DEFAULT 0,
  total_wakes INTEGER NOT NULL DEFAULT 0,
  total_external_actions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 61. Business Autonomy Lock (prevents concurrent ARO cycles)
CREATE TABLE IF NOT EXISTS business_autonomy_lock (
  business_id TEXT PRIMARY KEY,
  locked_at TEXT NOT NULL,
  lock_owner TEXT NOT NULL,
  lease_expiry TEXT NOT NULL
);

-- 62. Action Cooldowns (prevents rapid repeated execution per action and target)
CREATE TABLE IF NOT EXISTS action_cooldowns (
  target_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TEXT NOT NULL,
  next_eligible_at TEXT NOT NULL,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  exhausted INTEGER NOT NULL DEFAULT 0,
  escalated INTEGER NOT NULL DEFAULT 0,
  last_succeeded INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (target_id, action_type)
);
CREATE INDEX IF NOT EXISTS idx_cooldowns_eligible ON action_cooldowns(next_eligible_at);

-- 63. Autonomous Action Traces (Spec § 31: Full audit trace of every autonomous action)
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
CREATE INDEX IF NOT EXISTS idx_aat_cycle ON autonomous_action_traces(cycle_id);
CREATE INDEX IF NOT EXISTS idx_aat_tenant ON autonomous_action_traces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aat_class ON autonomous_action_traces(classification);

-- 64. Sales Pipeline Transitions (Spec § 4: Durable pipeline state transition audit log)
CREATE TABLE IF NOT EXISTS pipeline_transitions (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  new_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pipeline_id) REFERENCES sales_pipeline(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pipe_trans_id ON pipeline_transitions(pipeline_id);

-- 65. Offers & Value Propositions (Spec § 6: OfferEngine catalogue & generated offers)
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  offer_name TEXT NOT NULL,
  offer_type TEXT NOT NULL,
  problem TEXT NOT NULL,
  solution TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  price_inr REAL NOT NULL,
  pricing_model TEXT NOT NULL DEFAULT 'ONE_TIME',
  expected_customer_value_inr REAL NOT NULL,
  delivery_time_days INTEGER NOT NULL DEFAULT 7,
  guarantee_or_terms TEXT,
  sales_message TEXT NOT NULL,
  qualification_questions_json TEXT NOT NULL DEFAULT '[]',
  payment_method TEXT NOT NULL DEFAULT 'RAZORPAY',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_offers_biz ON offers(business_id);

-- 66. Meetings & Calendar Bookings (Spec § 10: MeetingEngine appointments)
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  pipeline_id TEXT,
  lead_id TEXT,
  provider TEXT NOT NULL DEFAULT 'INTERNAL',
  external_event_id TEXT,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  attendees_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  action_classification TEXT NOT NULL DEFAULT 'INTERNAL_AUTOMATION',
  provider_response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_meetings_biz ON meetings(business_id);
CREATE INDEX IF NOT EXISTS idx_meetings_pipe ON meetings(pipeline_id);

-- 67. Revenue Records (Spec § 12: Split Client Revenue vs Platform Revenue)
CREATE TABLE IF NOT EXISTS revenue_records (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT,
  revenue_type TEXT NOT NULL,
  source TEXT NOT NULL,
  transaction_id TEXT,
  amount_inr REAL NOT NULL,
  amount_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'INR',
  verified INTEGER NOT NULL DEFAULT 0,
  verification_method TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'REAL',
  recurring_model TEXT NOT NULL DEFAULT 'ONE_TIME',
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rev_records_org ON revenue_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_rev_records_type ON revenue_records(revenue_type, verified);

-- 68. Learning Records (Spec § 16: Empirical observations with provenance)
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
  what TEXT,
  outcome TEXT,
  cause TEXT,
  rule TEXT,
  evidence_ref TEXT,
  source_file TEXT,
  date TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lrn_records_org ON learning_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_lrn_records_type ON learning_records(learning_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lrn_content_hash ON learning_records(content_hash);

-- 69. Autonomy Policy Configuration (Spec § 23: Machine-enforced bounds)
CREATE TABLE IF NOT EXISTS autonomy_policy_config (
  organization_id TEXT PRIMARY KEY,
  max_actions_per_wake INTEGER NOT NULL DEFAULT 1,
  max_external_actions_per_day INTEGER NOT NULL DEFAULT 50,
  max_messages_per_contact INTEGER NOT NULL DEFAULT 3,
  followup_cooldown_hours INTEGER NOT NULL DEFAULT 24,
  payment_retry_policy_json TEXT NOT NULL DEFAULT '{"maxRetries":3,"backoffHours":24}',
  research_daily_budget_credits INTEGER NOT NULL DEFAULT 800,
  ai_daily_budget_requests INTEGER NOT NULL DEFAULT 1200,
  marketing_budget_inr REAL NOT NULL DEFAULT 0.0,
  paid_acquisition_allowed INTEGER NOT NULL DEFAULT 0,
  allowed_channels_json TEXT NOT NULL DEFAULT '["WHATSAPP","EMAIL","LOCAL_SEARCH"]',
  allowed_regions_json TEXT NOT NULL DEFAULT '["IN"]',
  consent_policy TEXT NOT NULL DEFAULT 'DPDP_2023_EXPLICIT',
  kill_switch INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 70. Customer Delivery Tasks (Spec § 14: Post-payment delivery lifecycle)
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
CREATE INDEX IF NOT EXISTS idx_delivery_tasks_journey ON delivery_tasks(customer_journey_id);

-- 71. Commercial Lifecycle State (Spec § 2 & § 22: Stage & highest milestone)
CREATE TABLE IF NOT EXISTS commercial_lifecycle_state (
  organization_id TEXT PRIMARY KEY,
  lifecycle_state TEXT NOT NULL DEFAULT 'COMMERCIAL_READY',
  highest_proven_milestone TEXT NOT NULL DEFAULT 'M0',
  total_live_external_actions INTEGER NOT NULL DEFAULT 0,
  total_verified_customers INTEGER NOT NULL DEFAULT 0,
  verified_client_revenue_inr REAL NOT NULL DEFAULT 0.0,
  verified_platform_revenue_inr REAL NOT NULL DEFAULT 0.0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 72. Live Provider Activations (Spec § 3 & § 4: Provider states and verification)
CREATE TABLE IF NOT EXISTS live_provider_activations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  is_live_verified INTEGER NOT NULL DEFAULT 0,
  last_health_check TEXT,
  last_verified_at TEXT,
  verification_evidence_json TEXT NOT NULL DEFAULT '{}',
  external_identifier TEXT,
  failure_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_live_prov_state ON live_provider_activations(state);

-- 73. Commercial Evidence (Spec § 24: Real-world audit logs with external identifiers)
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
CREATE INDEX IF NOT EXISTS idx_comm_ev_milestone ON commercial_evidence(milestone);
CREATE INDEX IF NOT EXISTS idx_comm_ev_ext_id ON commercial_evidence(external_id);

-- 74. Commercial Proposals (Spec § 15: Immutable approved customer proposals)
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_proposals_biz ON proposals(business_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);

-- 75. Idempotent Actions (Spec § 31: Enforces zero-duplicate external mutations)
CREATE TABLE IF NOT EXISTS idempotent_actions (
  idempotency_key TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  executed_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'EXECUTED',
  result_json TEXT NOT NULL DEFAULT '{}'
);

-- 76. Owner Configuration (Spec § 28: Single operator configuration)
CREATE TABLE IF NOT EXISTS owner_configuration (
  id TEXT PRIMARY KEY,
  owner_name TEXT NOT NULL DEFAULT 'Harsha Vardhan Kotu',
  organization_id TEXT NOT NULL DEFAULT 'org_owner_primary',
  platform_business_id TEXT NOT NULL DEFAULT 'biz_platform_aro',
  platform_upi_vpa TEXT,
  platform_currency TEXT NOT NULL DEFAULT 'INR',
  platform_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  marketing_budget REAL NOT NULL DEFAULT 0.0,
  autonomy_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 77. Payment Provider Links (Spec § 11 & § 12: Real Razorpay UPI Payment Links)
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
  provider_response_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(provider, provider_link_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_links_ref ON payment_provider_links(reference_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_provider_links(status);

-- 78. Manual UPI Claims (Spec § 15 & § 18: Customer claim awaiting owner verification)
CREATE TABLE IF NOT EXISTS manual_upi_claims (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  journey_id TEXT,
  utr TEXT NOT NULL,
  amount_inr REAL NOT NULL,
  service_rendered TEXT,
  status TEXT NOT NULL DEFAULT 'PAYMENT_CLAIMED',
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT,
  verified_by TEXT,
  rejection_reason TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_manual_upi_utr ON manual_upi_claims(utr);
CREATE INDEX IF NOT EXISTS idx_manual_upi_status ON manual_upi_claims(status);

-- 79. Owner Sessions (Spec § 3: Short-lived authenticated owner sessions)
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
CREATE INDEX IF NOT EXISTS idx_owner_sess_exp ON owner_sessions(expires_at);

-- 80. Platform Customer Deliveries (Spec § 38 & § 39: Onboarding, SLAs and outcome milestones)
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
CREATE INDEX IF NOT EXISTS idx_pcd_cust ON platform_customer_deliveries(customer_id);

-- 81. Integration Phone Mappings (WhatsApp phone_number_id → business mapping)
CREATE TABLE IF NOT EXISTS integration_phone_mappings (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'WHATSAPP',
  external_phone_number_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  UNIQUE(provider, external_phone_number_id)
);
CREATE INDEX IF NOT EXISTS idx_phone_map_provider ON integration_phone_mappings(provider, external_phone_number_id);

-- 82. Cron Telemetry (Cloudflare Worker cron heartbeat & execution trace, Spec § 16 & § 31)
CREATE TABLE IF NOT EXISTS cron_telemetry (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'CONFIGURED', -- CONFIGURED | DEPLOYED | OBSERVED | HEALTHY | DEGRADED | FAILED
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  execution_started_at TEXT,
  execution_finished_at TEXT,
  cycle_id TEXT,
  http_status INTEGER,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_observed_ping TEXT,
  total_pings INTEGER NOT NULL DEFAULT 0,
  last_user_agent TEXT,
  worker_source TEXT,
  last_successful_cycle TEXT,
  last_failed_cycle TEXT,
  cycle_result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cron_tel_status ON cron_telemetry(status);
CREATE INDEX IF NOT EXISTS idx_cron_tel_rec ON cron_telemetry(received_at);

-- 83. Outbound Action Ledger (Durable action identity & strict send idempotency, Spec § 16)
CREATE TABLE IF NOT EXISTS outbound_action_ledger (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  outbound_contact_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL, -- EMAIL | WHATSAPP
  action_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_external_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SENT | DELIVERED | FAILED | REJECTED
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
  UNIQUE (organization_id, opportunity_id, outbound_contact_id, sequence_number, channel)
);
CREATE INDEX IF NOT EXISTS idx_outbound_ledger_opp ON outbound_action_ledger(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_outbound_ledger_contact ON outbound_action_ledger(outbound_contact_id);
CREATE INDEX IF NOT EXISTS idx_outbound_ledger_status ON outbound_action_ledger(status);

-- 84. Funnels (First-class Universal Demand Capture Funnels)
CREATE TABLE IF NOT EXISTS funnels (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  public_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | DRAFT | ARCHIVED
  funnel_type TEXT NOT NULL DEFAULT 'UNIVERSAL',
  objective TEXT NOT NULL,
  target_intent TEXT,
  audience TEXT,
  headline TEXT,
  subheadline TEXT,
  proof_points_json TEXT NOT NULL DEFAULT '[]',
  offer_ids_json TEXT NOT NULL DEFAULT '[]',
  cta_strategy TEXT NOT NULL DEFAULT 'BOOK_OR_BUY',
  qualification_strategy TEXT,
  scheduling_strategy TEXT,
  payment_strategy TEXT NOT NULL DEFAULT 'OPTIONAL', -- REQUIRED | DEPOSIT | OPTIONAL | NONE
  language TEXT NOT NULL DEFAULT 'en',
  currency TEXT NOT NULL DEFAULT 'INR',
  design_config_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  UNIQUE(business_id, public_slug)
);
CREATE INDEX IF NOT EXISTS idx_funnels_biz ON funnels(business_id);
CREATE INDEX IF NOT EXISTS idx_funnels_slug ON funnels(public_slug);

-- 85. Customer Offers (Offers sold by client businesses to their customers - completely decoupled from Platform Offers)
CREATE TABLE IF NOT EXISTS customer_offers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'GENERAL',
  price_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  billing_model TEXT NOT NULL DEFAULT 'ONE_TIME', -- ONE_TIME | MONTHLY | ANNUAL | DEPOSIT | USAGE | CUSTOM
  deposit_minor INTEGER,
  target_segment TEXT,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  qualification_rules_json TEXT NOT NULL DEFAULT '[]',
  availability_rules_json TEXT NOT NULL DEFAULT '{}',
  fulfillment_type TEXT NOT NULL DEFAULT 'SERVICE_DELIVERY', -- APPOINTMENT | SERVICE_DELIVERY | DIGITAL | SHIPMENT | SUBSCRIPTION | CONSULTATION
  active INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cust_offers_biz ON customer_offers(business_id);

-- 86. Availability Slots (Universal Resource & Scheduling Engine)
CREATE TABLE IF NOT EXISTS availability_slots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  resource_id TEXT,
  resource_type TEXT NOT NULL DEFAULT 'STAFF', -- STAFF | PRACTITIONER | ROOM | TABLE | VEHICLE | VIRTUAL
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1,
  reserved_count INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_avail_slots_biz_time ON availability_slots(business_id, start_time, end_time);

-- 87. Booking Reservations (Universal Appointment / Table / Service Reservations)
CREATE TABLE IF NOT EXISTS booking_reservations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_contact TEXT NOT NULL,
  customer_email TEXT,
  service_title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION', -- PENDING_CONFIRMATION | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_booking_res_biz ON booking_reservations(business_id);

-- 88. Universal Orders (Server-authoritative Order Lifecycle)
CREATE TABLE IF NOT EXISTS universal_orders (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  offer_title TEXT,
  funnel_id TEXT,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'CHECKOUT', -- QUOTE | CHECKOUT | ORDER | PAYMENT_PENDING | PAID | FULFILLMENT | COMPLETED | CANCELLED | REFUNDED
  payment_provider TEXT, -- RAZORPAY | STRIPE | MANUAL
  provider_order_id TEXT,
  provider_payment_id TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | SCHEDULED | IN_PROGRESS | DELIVERED | ACKNOWLEDGED
  recovery_state TEXT,
  failure_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_uorders_biz ON universal_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_uorders_prov_order ON universal_orders(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_uorders_status ON universal_orders(status);

-- 89. Fulfillment Tasks (Execution, Delivery Tracking & SLA)
CREATE TABLE IF NOT EXISTS fulfillment_tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  fulfillment_type TEXT NOT NULL,
  assigned_owner TEXT,
  sla_hours INTEGER NOT NULL DEFAULT 24,
  state TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | COMPLETED | BLOCKED
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES universal_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fulfill_tasks_order ON fulfillment_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_tasks_biz ON fulfillment_tasks(business_id);

-- 90. Partners Registry (Autonomous Commission & Referral Engine)
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
  network TEXT NOT NULL DEFAULT 'OTHER_AUTHORIZED_PARTNER',
  tracking_type TEXT NOT NULL DEFAULT 'AFFILIATE_LINK',
  authorization_status TEXT NOT NULL DEFAULT 'AUTHORIZED',
  program_url TEXT,
  coverage TEXT NOT NULL DEFAULT 'India',
  category TEXT,
  destination_requirements TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_partners_org_status ON partners(organization_id, active_status);
CREATE INDEX IF NOT EXISTS idx_partners_industry ON partners(industry);

-- 91. Partner Offers Registry
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
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'INR',
  availability TEXT NOT NULL DEFAULT 'IN_STOCK',
  active INTEGER NOT NULL DEFAULT 1,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_partner_offers_partner ON partner_offers(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_offers_category ON partner_offers(category);
CREATE INDEX IF NOT EXISTS idx_partner_offers_active ON partner_offers(active);

-- 92. Referrals Tracking
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
  ip TEXT,
  user_agent TEXT,
  referer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  content_asset_id TEXT,
  placement TEXT,
  device_class TEXT,
  country TEXT,
  keyword TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES partner_offers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_referrals_offer ON referrals(offer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_click ON referrals(click_id);
CREATE INDEX IF NOT EXISTS idx_referrals_created ON referrals(created_at);
CREATE INDEX IF NOT EXISTS idx_referrals_asset ON referrals(content_asset_id);
CREATE INDEX IF NOT EXISTS idx_referrals_org ON referrals(organization_id);

-- 92b. Immutable referral click events (append-only)
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

-- 93. Commission Records Ledger
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
CREATE INDEX IF NOT EXISTS idx_commissions_org ON commission_records(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_partner_tx ON commission_records(partner_id, external_transaction_id);

-- 94. Commission Content Assets (Organic Inbound Pages; renamed to avoid collision with marketing content_assets)
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
  quality_gate_json TEXT NOT NULL DEFAULT '{}',
  disclosure_version TEXT NOT NULL DEFAULT '2026.1',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (primary_offer_id) REFERENCES partner_offers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_commission_content_assets_slug ON commission_content_assets(slug);
CREATE INDEX IF NOT EXISTS idx_commission_content_assets_category ON commission_content_assets(category);

-- 95. Demand Signals (Discovered Organic Intent)
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
  intent_class TEXT NOT NULL DEFAULT 'RESEARCH',
  commercial_score REAL NOT NULL DEFAULT 0,
  source_host TEXT,
  url TEXT,
  excerpt TEXT,
  author_hash TEXT,
  language TEXT DEFAULT 'en',
  city TEXT,
  intent_score INTEGER DEFAULT 0,
  budget_hint TEXT,
  found_at TEXT,
  dedupe_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demand_signals_topic ON demand_signals(topic);
CREATE INDEX IF NOT EXISTS idx_demand_signals_status ON demand_signals(status);
CREATE INDEX IF NOT EXISTS idx_demand_signals_intent ON demand_signals(intent_class);
CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_signals_dedupe ON demand_signals(dedupe_hash);

-- 96. Durable Rate Limits (Per-IP hash window limiter)
CREATE TABLE IF NOT EXISTS durable_rate_limits (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON durable_rate_limits(expires_at);

-- 97. Provider Call Audit Logs (D1-persisted call logging)
CREATE TABLE IF NOT EXISTS provider_call_logs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  action_type TEXT NOT NULL,
  priority TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  success INTEGER NOT NULL DEFAULT 1,
  is_rate_limit INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  query TEXT,
  url TEXT,
  duplicate_of TEXT,
  flag TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_logs_provider_created ON provider_call_logs(provider, created_at);

-- 98. Owner Intake (Spec: One-time operator intake and attestation)
CREATE TABLE IF NOT EXISTS owner_intake (
  id TEXT PRIMARY KEY DEFAULT 'primary',
  organization_id TEXT NOT NULL,
  application_date TEXT NOT NULL,
  listed_site_urls_json TEXT NOT NULL,
  agreement_read_confirmed INTEGER NOT NULL,
  agreement_read_confirmed_at TEXT NOT NULL,
  site_name TEXT NOT NULL,
  author_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  tavily_key_rotated INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'VALID',
  written_by TEXT NOT NULL DEFAULT 'OWNER_FORM',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 99. Product Proposals (Non-Amazon manufacturer spec-derived proposals)
CREATE TABLE IF NOT EXISTS product_proposals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  category TEXT NOT NULL,
  product_name TEXT NOT NULL,
  manufacturer_name TEXT NOT NULL,
  spec_summary TEXT NOT NULL,
  source_url TEXT NOT NULL,
  retrieval_date TEXT NOT NULL,
  provider_call_log_id TEXT,
  page_text_snippet TEXT,
  display_name TEXT,
  listing_facts_json TEXT,
  amazon_url TEXT,
  asin TEXT,
  status TEXT NOT NULL DEFAULT 'PROPOSED',
  provenance TEXT DEFAULT 'APP_LOGGED_CALL',
  approved_offer_id TEXT,
  product_checked INTEGER NOT NULL DEFAULT 0,
  product_checked_at TEXT,
  approved_at TEXT,
  owner_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 100. Owner Status Snapshots (Hourly computed status and open actions)
CREATE TABLE IF NOT EXISTS owner_status_snapshots (
  id TEXT PRIMARY KEY DEFAULT 'latest',
  organization_id TEXT NOT NULL,
  git_head TEXT,
  render_commit TEXT,
  firebase_deploy TEXT,
  commit_status TEXT NOT NULL,
  last_cron_cycle_json TEXT NOT NULL DEFAULT '{}',
  money_path_json TEXT NOT NULL DEFAULT '{}',
  deadline_180_days TEXT,
  countdown_days INTEGER,
  quotas_json TEXT NOT NULL DEFAULT '{}',
  cooldowns_json TEXT NOT NULL DEFAULT '[]',
  learning_insights_json TEXT NOT NULL DEFAULT '[]',
  open_actions_json TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 101. Mistakes Board (Empirical incident tracking and guardrails)
CREATE TABLE IF NOT EXISTS mistakes_board (
  id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  title TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  cause TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('P1', 'P2', 'P3')),
  status TEXT NOT NULL CHECK(status IN ('OPEN', 'FIXED', 'MONITORING')),
  recurrence_count INTEGER NOT NULL DEFAULT 1,
  guard_type TEXT NOT NULL CHECK(guard_type IN ('TEST', 'HOOK', 'LINT', 'NONE')),
  guard_ref TEXT,
  source_report TEXT NOT NULL
);

-- 102. Provider Usage Drift Records
CREATE TABLE IF NOT EXISTS provider_drift_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  local_count INTEGER NOT NULL,
  provider_count INTEGER NOT NULL,
  drift_percentage REAL NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 103. Demand Matches
CREATE TABLE IF NOT EXISTS demand_matches (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  expected_value REAL NOT NULL DEFAULT 0.0,
  ev_basis TEXT NOT NULL DEFAULT 'ESTIMATED',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (signal_id) REFERENCES demand_signals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_demand_matches_signal ON demand_matches(signal_id);
CREATE INDEX IF NOT EXISTS idx_demand_matches_offer ON demand_matches(offer_id);

-- 104. Outreach Drafts
CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'COMMUNITY_FORUM',
  draft_text TEXT NOT NULL,
  landing_url TEXT NOT NULL,
  disclosure_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFTED' CHECK(status IN ('DRAFTED', 'APPROVED', 'POSTED_BY_OWNER', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  posted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (signal_id) REFERENCES demand_signals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_signal ON outreach_drafts(signal_id);
CREATE INDEX IF NOT EXISTS idx_outreach_drafts_status ON outreach_drafts(status);

-- 105. Source Rules (host allowlist and policies)
CREATE TABLE IF NOT EXISTS source_rules (
  host TEXT PRIMARY KEY,
  allows_links INTEGER NOT NULL DEFAULT 1,
  allows_affiliate INTEGER NOT NULL DEFAULT 0,
  needs_disclosure INTEGER NOT NULL DEFAULT 1,
  automation_allowed INTEGER NOT NULL DEFAULT 0,
  owner_approved INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  terms_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 106. Stored Reports (Uploaded Associates earnings reports)
CREATE TABLE IF NOT EXISTS stored_reports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  byte_size INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stored_reports_org ON stored_reports(organization_id);
`;