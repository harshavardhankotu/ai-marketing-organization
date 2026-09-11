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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_journeys_biz_visitor ON customer_journeys(business_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_journeys_stage ON customer_journeys(stage);
CREATE INDEX IF NOT EXISTS idx_journeys_class ON customer_journeys(classification);

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
