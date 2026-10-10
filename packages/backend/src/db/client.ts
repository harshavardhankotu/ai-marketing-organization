import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_SQL } from './schema.js';

let dbInstance: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  let resolvedPath = dbPath || process.env.DATABASE_PATH;
  if (!resolvedPath) {
    const rootDb = path.resolve(process.cwd(), 'ai_marketing.sqlite');
    const siblingDb = path.resolve(process.cwd(), '../ai_marketing.sqlite');
    const parentDb = path.resolve(process.cwd(), '../../ai_marketing.sqlite');
    const pkgDb = path.resolve(process.cwd(), 'packages/backend/ai_marketing.sqlite');

    if (fs.existsSync(rootDb)) {
      resolvedPath = rootDb;
    } else if (fs.existsSync(siblingDb)) {
      resolvedPath = siblingDb;
    } else if (fs.existsSync(parentDb)) {
      resolvedPath = parentDb;
    } else if (fs.existsSync(pkgDb)) {
      resolvedPath = pkgDb;
    } else {
      resolvedPath = rootDb;
    }
  }

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Safe schema migrations for existing persistent SQLite databases before index creation
  try {
    db.exec(`ALTER TABLE businesses ADD COLUMN public_slug TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE businesses ADD COLUMN public_live INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE outbound_contacts ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE customer_journeys ADD COLUMN gclid TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE customer_journeys ADD COLUMN attribution_status TEXT NOT NULL DEFAULT 'UNVERIFIED'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE learnings ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'TEST_LEARNING'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN api_token TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN source_type TEXT NOT NULL DEFAULT 'TEST_DATA'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN source_reference TEXT NOT NULL DEFAULT 'DETERMINISTIC_TEST_FIXTURE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN retrieved_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'NO_REAL_WORLD_EVIDENCE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE research_findings ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'TEST_DATA'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE google_clicks ADD COLUMN device TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE google_clicks ADD COLUMN click_type TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE marketing_memories ADD COLUMN maturity TEXT NOT NULL DEFAULT 'HYPOTHESIS'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE marketing_memories ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE marketing_memories ADD COLUMN verified_revenue_inr REAL NOT NULL DEFAULT 0.0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE knowledge_graph_edges ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE knowledge_graph_edges ADD COLUMN evidence_id TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE knowledge_graph_edges ADD COLUMN timestamp TEXT NOT NULL DEFAULT (datetime('now'))`);
  } catch {}
  try {
    db.exec(`ALTER TABLE predictions ADD COLUMN status TEXT NOT NULL DEFAULT 'PREDICTION_PENDING'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN pending_predictions_count INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN resolved_predictions_count INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN sample_size_tier TEXT NOT NULL DEFAULT 'PILOT_SAMPLE'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN confidence_level TEXT NOT NULL DEFAULT 'LOW'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE agent_scorecards ADD COLUMN is_top_performer INTEGER NOT NULL DEFAULT 0`);
  } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN business_name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN vertical TEXT`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN city TEXT`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN phone TEXT`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN email TEXT`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN website_url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN source TEXT DEFAULT 'TAVILY_RESEARCH'`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN status TEXT DEFAULT 'DISCOVERED'`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN fit_score REAL DEFAULT 0.85`); } catch {}
  try { db.exec(`ALTER TABLE platform_prospects ADD COLUMN observed_evidence_json TEXT DEFAULT '{}'`); } catch {}
  try { db.exec(`ALTER TABLE opportunities ADD COLUMN title TEXT`); } catch {}
  try { db.exec(`ALTER TABLE opportunities ADD COLUMN confidence_score REAL DEFAULT 0.5`); } catch {}

  // Autonomous Revenue Organization — new table migration guards
  // These are safe no-ops if the tables already exist (SCHEMA_SQL handles full creation)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      source TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '[]',
      estimated_value_inr REAL NOT NULL DEFAULT 0, probability REAL NOT NULL DEFAULT 0,
      acquisition_cost_inr REAL NOT NULL DEFAULT 0, time_to_revenue_days INTEGER NOT NULL DEFAULT 30,
      authorization_requirements_json TEXT NOT NULL DEFAULT '[]', risk_level TEXT NOT NULL DEFAULT 'MEDIUM',
      next_best_action TEXT, status TEXT NOT NULL DEFAULT 'DISCOVERED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS durable_events (
      id TEXT PRIMARY KEY, event_type TEXT NOT NULL, business_id TEXT,
      organization_id TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      processed INTEGER NOT NULL DEFAULT 0, processed_at TEXT,
      triggered_agents_json TEXT NOT NULL DEFAULT '[]', error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS autonomous_cycle_log (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT,
      trigger_source TEXT NOT NULL DEFAULT 'SCHEDULER', cycle_start TEXT NOT NULL DEFAULT (datetime('now')),
      cycle_end TEXT, status TEXT NOT NULL DEFAULT 'RUNNING',
      opportunities_discovered INTEGER NOT NULL DEFAULT 0, opportunities_qualified INTEGER NOT NULL DEFAULT 0,
      actions_taken INTEGER NOT NULL DEFAULT 0, revenue_recorded_inr REAL NOT NULL DEFAULT 0,
      next_best_action TEXT, next_cycle_at TEXT, error_message TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS provider_quota_state (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL UNIQUE, provider_limit INTEGER,
      application_limit INTEGER NOT NULL DEFAULT 1200, requests_today INTEGER NOT NULL DEFAULT 0,
      credits_consumed_month INTEGER NOT NULL DEFAULT 0, credits_estimated_remaining INTEGER,
      rate_limit_responses INTEGER NOT NULL DEFAULT 0, successful_requests INTEGER NOT NULL DEFAULT 0,
      failed_requests INTEGER NOT NULL DEFAULT 0, is_locked INTEGER NOT NULL DEFAULT 0,
      lock_reason TEXT, last_reset TEXT, next_reset TEXT, reset_window_hours INTEGER NOT NULL DEFAULT 24,
      last_successful_request TEXT, last_rate_limit TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS automation_health (
      organization_id TEXT PRIMARY KEY, last_successful_wake TEXT,
      last_successful_external_action TEXT, last_successful_revenue_action TEXT,
      consecutive_wake_failures INTEGER NOT NULL DEFAULT 0, consecutive_action_failures INTEGER NOT NULL DEFAULT 0,
      provider_failures_json TEXT NOT NULL DEFAULT '{}', quota_locks_json TEXT NOT NULL DEFAULT '[]',
      authorization_blocks INTEGER NOT NULL DEFAULT 0, total_wakes INTEGER NOT NULL DEFAULT 0,
      total_external_actions INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS business_autonomy_lock (
      business_id TEXT PRIMARY KEY, locked_at TEXT NOT NULL,
      lock_owner TEXT NOT NULL, lease_expiry TEXT NOT NULL
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS action_cooldowns (
      target_id TEXT NOT NULL, action_type TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
      last_executed_at TEXT NOT NULL, next_eligible_at TEXT NOT NULL,
      max_attempts INTEGER NOT NULL DEFAULT 3, exhausted INTEGER NOT NULL DEFAULT 0,
      escalated INTEGER NOT NULL DEFAULT 0, last_succeeded INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (target_id, action_type)
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS autonomous_action_traces (
      id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, action_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      action_type TEXT NOT NULL, reason TEXT NOT NULL, expected_value REAL NOT NULL DEFAULT 0.0,
      authorization TEXT NOT NULL, quota_reservation TEXT NOT NULL, provider TEXT NOT NULL,
      request_id TEXT, provider_response TEXT, classification TEXT NOT NULL, result TEXT NOT NULL,
      external_id TEXT, cost REAL NOT NULL DEFAULT 0.0, timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS pipeline_transitions (
      id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, business_id TEXT NOT NULL,
      previous_state TEXT NOT NULL, new_state TEXT NOT NULL, actor TEXT NOT NULL,
      reason TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      offer_name TEXT NOT NULL, offer_type TEXT NOT NULL, problem TEXT NOT NULL,
      solution TEXT NOT NULL, deliverables_json TEXT NOT NULL DEFAULT '[]',
      price_inr REAL NOT NULL, pricing_model TEXT NOT NULL DEFAULT 'ONE_TIME',
      expected_customer_value_inr REAL NOT NULL, delivery_time_days INTEGER NOT NULL DEFAULT 7,
      guarantee_or_terms TEXT, sales_message TEXT NOT NULL,
      qualification_questions_json TEXT NOT NULL DEFAULT '[]',
      payment_method TEXT NOT NULL DEFAULT 'RAZORPAY', status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      pipeline_id TEXT, lead_id TEXT, provider TEXT NOT NULL DEFAULT 'INTERNAL',
      external_event_id TEXT, title TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', attendees_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'SCHEDULED', action_classification TEXT NOT NULL DEFAULT 'INTERNAL_AUTOMATION',
      provider_response_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS revenue_records (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT,
      revenue_type TEXT NOT NULL, source TEXT NOT NULL, transaction_id TEXT,
      amount_inr REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
      verified INTEGER NOT NULL DEFAULT 0, verification_method TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'REAL', recurring_model TEXT NOT NULL DEFAULT 'ONE_TIME',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS learning_records (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT,
      learning_type TEXT NOT NULL, decision TEXT NOT NULL, hypothesis TEXT NOT NULL,
      action TEXT NOT NULL, audience TEXT NOT NULL, offer TEXT NOT NULL, channel TEXT NOT NULL,
      result TEXT NOT NULL, revenue_inr REAL NOT NULL DEFAULT 0.0, cost_inr REAL NOT NULL DEFAULT 0.0,
      time_taken_hours REAL NOT NULL DEFAULT 0.0, confidence REAL NOT NULL DEFAULT 0.5,
      evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS autonomy_policy_config (
      organization_id TEXT PRIMARY KEY, max_actions_per_wake INTEGER NOT NULL DEFAULT 1,
      max_external_actions_per_day INTEGER NOT NULL DEFAULT 50, max_messages_per_contact INTEGER NOT NULL DEFAULT 3,
      followup_cooldown_hours INTEGER NOT NULL DEFAULT 24,
      payment_retry_policy_json TEXT NOT NULL DEFAULT '{"maxRetries":3,"backoffHours":24}',
      research_daily_budget_credits INTEGER NOT NULL DEFAULT 800,
      ai_daily_budget_requests INTEGER NOT NULL DEFAULT 1200,
      marketing_budget_inr REAL NOT NULL DEFAULT 0.0, paid_acquisition_allowed INTEGER NOT NULL DEFAULT 0,
      allowed_channels_json TEXT NOT NULL DEFAULT '["WHATSAPP","EMAIL","LOCAL_SEARCH"]',
      allowed_regions_json TEXT NOT NULL DEFAULT '["IN"]', consent_policy TEXT NOT NULL DEFAULT 'DPDP_2023_EXPLICIT',
      kill_switch INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS delivery_tasks (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT NOT NULL,
      customer_journey_id TEXT NOT NULL, service_type TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'ONBOARDING', deliverables_json TEXT NOT NULL DEFAULT '[]',
      results_json TEXT NOT NULL DEFAULT '{}', action_classification TEXT NOT NULL DEFAULT 'INTERNAL_AUTOMATION',
      completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS commercial_lifecycle_state (
      organization_id TEXT PRIMARY KEY, lifecycle_state TEXT NOT NULL DEFAULT 'COMMERCIAL_READY',
      highest_proven_milestone TEXT NOT NULL DEFAULT 'M0', total_live_external_actions INTEGER NOT NULL DEFAULT 0,
      total_verified_customers INTEGER NOT NULL DEFAULT 0, verified_client_revenue_inr REAL NOT NULL DEFAULT 0.0,
      verified_platform_revenue_inr REAL NOT NULL DEFAULT 0.0, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS live_provider_activations (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'NOT_CONFIGURED', is_live_verified INTEGER NOT NULL DEFAULT 0,
      last_health_check TEXT, last_verified_at TEXT, verification_evidence_json TEXT NOT NULL DEFAULT '{}',
      external_identifier TEXT, failure_reason TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS commercial_evidence (
      id TEXT PRIMARY KEY, milestone TEXT NOT NULL, provider TEXT NOT NULL,
      external_id TEXT NOT NULL, timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      request_reference TEXT NOT NULL, tenant_id TEXT NOT NULL, business_id TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'REAL', verification_source TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT NOT NULL,
      prospect_id TEXT NOT NULL, offer_id TEXT, title TEXT NOT NULL,
      customer_problem TEXT NOT NULL, proposed_solution TEXT NOT NULL,
      deliverables_json TEXT NOT NULL DEFAULT '[]', timeline_days INTEGER NOT NULL DEFAULT 5,
      setup_price_inr REAL NOT NULL DEFAULT 15000.0, monthly_price_inr REAL NOT NULL DEFAULT 8000.0,
      payment_terms TEXT NOT NULL, scope_boundary TEXT NOT NULL, next_step TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS idempotent_actions (
      idempotency_key TEXT PRIMARY KEY, action_type TEXT NOT NULL, target_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL, executed_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'EXECUTED', result_json TEXT NOT NULL DEFAULT '{}'
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, industry TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'India', city TEXT, website TEXT NOT NULL,
      partner_type TEXT NOT NULL DEFAULT 'AFFILIATE', program_name TEXT,
      commission_type TEXT NOT NULL DEFAULT 'PERCENTAGE', commission_rate REAL, fixed_commission_inr REAL,
      cookie_window_days INTEGER NOT NULL DEFAULT 30, qualifying_event TEXT NOT NULL DEFAULT 'PURCHASE',
      approval_status TEXT NOT NULL DEFAULT 'APPROVED', active_status INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'DIRECT_PARTNER', terms_url TEXT, disclosure_required INTEGER NOT NULL DEFAULT 1,
      network TEXT NOT NULL DEFAULT 'OTHER_AUTHORIZED_PARTNER', tracking_type TEXT NOT NULL DEFAULT 'AFFILIATE_LINK',
      authorization_status TEXT NOT NULL DEFAULT 'AUTHORIZED', program_url TEXT, coverage TEXT NOT NULL DEFAULT 'India',
      category TEXT, destination_requirements TEXT, evidence_json TEXT NOT NULL DEFAULT '{}',
      last_verified_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS partner_offers (
      id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      title TEXT NOT NULL, offer_slug TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
      target_customer TEXT NOT NULL, price_inr REAL, price_range TEXT,
      commission_model TEXT NOT NULL DEFAULT 'PERCENTAGE', commission_amount_inr REAL NOT NULL DEFAULT 0,
      conversion_action TEXT NOT NULL DEFAULT 'PURCHASE', destination_url TEXT NOT NULL,
      authorized_tracking_url TEXT NOT NULL, geographic_availability TEXT NOT NULL DEFAULT 'India',
      evidence_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'ACTIVE',
      description TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'INR',
      availability TEXT NOT NULL DEFAULT 'IN_STOCK', active INTEGER NOT NULL DEFAULT 1,
      last_verified_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, offer_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, anonymous_session_id TEXT, click_id TEXT NOT NULL UNIQUE,
      tracking_parameters_json TEXT NOT NULL DEFAULT '{}', landing_page TEXT,
      source TEXT, campaign TEXT, destination_url TEXT NOT NULL,
      ip TEXT, user_agent TEXT, referer TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
      utm_term TEXT, utm_content TEXT, content_asset_id TEXT, placement TEXT, device_class TEXT,
      country TEXT, keyword TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS referral_click_events (
      id TEXT PRIMARY KEY, referral_id TEXT NOT NULL, click_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, offer_id TEXT NOT NULL, partner_id TEXT NOT NULL,
      content_asset_id TEXT, placement TEXT, source TEXT, medium TEXT, campaign TEXT,
      keyword TEXT, referrer TEXT, device_class TEXT, country TEXT,
      destination_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS commission_records (
      id TEXT PRIMARY KEY, referral_id TEXT, partner_id TEXT NOT NULL, offer_id TEXT,
      organization_id TEXT NOT NULL, external_transaction_id TEXT, event_type TEXT NOT NULL DEFAULT 'PURCHASE',
      external_status TEXT NOT NULL DEFAULT 'PENDING', expected_commission_inr REAL NOT NULL DEFAULT 0,
      verified_commission_inr REAL NOT NULL DEFAULT 0, received_commission_inr REAL NOT NULL DEFAULT 0,
      verification_source TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'COMMISSION_PENDING', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT, paid_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_partner_tx ON commission_records(partner_id, external_transaction_id)`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS commission_content_assets (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      asset_type TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
      location TEXT, intent_target TEXT NOT NULL, content_markdown TEXT NOT NULL,
      primary_offer_id TEXT, matched_offer_ids_json TEXT NOT NULL DEFAULT '[]',
      disclosure_markdown TEXT NOT NULL DEFAULT 'Disclosure: We may earn a referral commission at no additional cost to you when you purchase through our links.',
      status TEXT NOT NULL DEFAULT 'PUBLISHED', view_count INTEGER NOT NULL DEFAULT 0,
      referral_click_count INTEGER NOT NULL DEFAULT 0, quality_gate_json TEXT NOT NULL DEFAULT '{}',
      disclosure_version TEXT NOT NULL DEFAULT '2026.1', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS demand_signals (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, topic TEXT NOT NULL,
      category TEXT NOT NULL, location TEXT, intent_type TEXT NOT NULL DEFAULT 'SEARCH_QUERY',
      raw_query TEXT NOT NULL, evidence_snippet TEXT NOT NULL, source_url TEXT NOT NULL,
      urgency REAL NOT NULL DEFAULT 0.5, estimated_monthly_volume INTEGER NOT NULL DEFAULT 100,
      status TEXT NOT NULL DEFAULT 'DISCOVERED', intent_class TEXT NOT NULL DEFAULT 'RESEARCH',
      commercial_score REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS owner_configuration (
      id TEXT PRIMARY KEY, owner_name TEXT NOT NULL DEFAULT 'Harsha Vardhan Kotu',
      organization_id TEXT NOT NULL DEFAULT 'org_owner_primary', platform_business_id TEXT NOT NULL DEFAULT 'biz_platform_aro',
      platform_upi_vpa TEXT, platform_currency TEXT NOT NULL DEFAULT 'INR',
      platform_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata', marketing_budget REAL NOT NULL DEFAULT 0.0,
      autonomy_enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS payment_provider_links (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT NOT NULL,
      prospect_id TEXT, journey_id TEXT, proposal_id TEXT, provider TEXT NOT NULL DEFAULT 'RAZORPAY',
      provider_link_id TEXT NOT NULL, short_url TEXT NOT NULL, reference_id TEXT NOT NULL,
      amount_inr REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'CREATED',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT, payment_id TEXT,
      provider_response_json TEXT NOT NULL DEFAULT '{}'
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS manual_upi_claims (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, business_id TEXT NOT NULL,
      journey_id TEXT, utr TEXT NOT NULL, amount_inr REAL NOT NULL, service_rendered TEXT,
      status TEXT NOT NULL DEFAULT 'PAYMENT_CLAIMED', claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      verified_at TEXT, verified_by TEXT, rejection_reason TEXT, notes TEXT
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS owner_sessions (
      id TEXT PRIMARY KEY, principal_type TEXT NOT NULL DEFAULT 'OWNER',
      organization_id TEXT NOT NULL, user_id TEXT NOT NULL, ip_address TEXT,
      user_agent TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN prospect_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN offer_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'ONE_TIME'`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN provider TEXT NOT NULL DEFAULT 'RAZORPAY'`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN provider_link_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN provider_order_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN short_url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN reference_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN payment_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN verified_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN verification_method TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN last_reminder_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN expires_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE payment_requests ADD COLUMN proposal_id TEXT`); } catch {}
  // Phase 2 catch-up columns for pre-existing local databases
  try { db.exec(`ALTER TABLE partners ADD COLUMN network TEXT NOT NULL DEFAULT 'OTHER_AUTHORIZED_PARTNER'`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN tracking_type TEXT NOT NULL DEFAULT 'AFFILIATE_LINK'`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN authorization_status TEXT NOT NULL DEFAULT 'AUTHORIZED'`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN program_url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN coverage TEXT NOT NULL DEFAULT 'India'`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN category TEXT`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN destination_requirements TEXT`); } catch {}
  try { db.exec(`ALTER TABLE partners ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}'`); } catch {}
  try { db.exec(`ALTER TABLE partner_offers ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`); } catch {}
  try { db.exec(`ALTER TABLE partner_offers ADD COLUMN description TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE partner_offers ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR'`); } catch {}
  try { db.exec(`ALTER TABLE partner_offers ADD COLUMN availability TEXT NOT NULL DEFAULT 'IN_STOCK'`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN ip TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN user_agent TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN referer TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN utm_source TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN utm_medium TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN utm_campaign TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN utm_term TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN utm_content TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN content_asset_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN placement TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN device_class TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN country TEXT`); } catch {}
  try { db.exec(`ALTER TABLE referrals ADD COLUMN keyword TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN intent_class TEXT NOT NULL DEFAULT 'RESEARCH'`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN commercial_score REAL NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE commission_content_assets ADD COLUMN quality_gate_json TEXT NOT NULL DEFAULT '{}'`); } catch {}
  try { db.exec(`ALTER TABLE commission_content_assets ADD COLUMN disclosure_version TEXT NOT NULL DEFAULT '2026.1'`); } catch {}
  try { db.exec(`ALTER TABLE opportunities ADD COLUMN prospect_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE outbound_contacts ADD COLUMN channel TEXT NOT NULL DEFAULT 'EMAIL'`); } catch {}
  try { db.exec(`ALTER TABLE outbound_contacts ADD COLUMN email_authorized INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE outbound_contacts ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE outbound_contacts ADD COLUMN authorization_source TEXT`); } catch {}
  try { db.exec(`ALTER TABLE outbound_contacts ADD COLUMN authorization_evidence_json TEXT NOT NULL DEFAULT '{}'`); } catch {}
  try { db.exec(`ALTER TABLE search_cache ADD COLUMN data_classification TEXT NOT NULL DEFAULT 'UNKNOWN'`); } catch {}
  try { db.exec(`ALTER TABLE search_cache ADD COLUMN source_verified INTEGER NOT NULL DEFAULT 0`); } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS platform_customer_deliveries (
      id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      business_id TEXT NOT NULL, offer_id TEXT NOT NULL, payment_id TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'ONBOARDING', contract_terms TEXT NOT NULL,
      renewal_date TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS integration_phone_mappings (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'WHATSAPP',
      external_phone_number_id TEXT NOT NULL, organization_id TEXT NOT NULL,
      business_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`ALTER TABLE businesses ADD COLUMN locale TEXT DEFAULT 'en-US'`);
  } catch {}
  try {
    db.exec(`ALTER TABLE businesses ADD COLUMN email TEXT`);
  } catch {}
  try {
    db.exec(`ALTER TABLE businesses ADD COLUMN service_area_json TEXT DEFAULT '[]'`);
  } catch {}
  try { db.exec(`ALTER TABLE revenue_records ADD COLUMN amount_minor INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE universal_orders ADD COLUMN offer_title TEXT`); } catch {}
  try { db.exec(`ALTER TABLE universal_orders ADD COLUMN recovery_state TEXT`); } catch {}
  try { db.exec(`ALTER TABLE universal_orders ADD COLUMN failure_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE owner_intake ADD COLUMN status TEXT NOT NULL DEFAULT 'VALID'`); } catch {}
  try { db.exec(`ALTER TABLE owner_intake ADD COLUMN written_by TEXT NOT NULL DEFAULT 'OWNER_FORM'`); } catch {}
  try { db.exec(`ALTER TABLE owner_intake ADD COLUMN created_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN provider_call_log_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN page_text_snippet TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN display_name TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN listing_facts_json TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN provenance TEXT DEFAULT 'APP_LOGGED_CALL'`); } catch {}
  try { db.exec(`ALTER TABLE provider_call_logs ADD COLUMN query TEXT`); } catch {}
  try { db.exec(`ALTER TABLE provider_call_logs ADD COLUMN url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE provider_call_logs ADD COLUMN duplicate_of TEXT`); } catch {}
  try { db.exec(`ALTER TABLE provider_call_logs ADD COLUMN flag TEXT`); } catch {}
  try { db.exec(`ALTER TABLE provider_quota_state ADD COLUMN source TEXT DEFAULT 'SYSTEM'`); } catch {}
  try { db.exec(`ALTER TABLE provider_quota_state ADD COLUMN unlogged_credits INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE provider_quota_state ADD COLUMN unlogged_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE provider_quota_state ADD COLUMN limit_source TEXT`); } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS mistakes_board (
      id TEXT PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
      title TEXT NOT NULL, what_happened TEXT NOT NULL, cause TEXT NOT NULL, rule TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('P1', 'P2', 'P3')),
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'FIXED', 'MONITORING')),
      recurrence_count INTEGER NOT NULL DEFAULT 1,
      guard_type TEXT NOT NULL CHECK(guard_type IN ('TEST', 'HOOK', 'LINT', 'NONE')),
      guard_ref TEXT, source_report TEXT NOT NULL
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS provider_drift_records (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL,
      local_count INTEGER NOT NULL, provider_count INTEGER NOT NULL,
      drift_percentage REAL NOT NULL, status TEXT NOT NULL,
      details_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN what TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN outcome TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN cause TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN rule TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN evidence_ref TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN source_file TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN date TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN content_hash TEXT`); } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lrn_content_hash ON learning_records(content_hash)`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN source_host TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN excerpt TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN author_hash TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN language TEXT DEFAULT 'en'`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN city TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN intent_score INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN budget_hint TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN found_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE demand_signals ADD COLUMN dedupe_hash TEXT`); } catch {}
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_signals_dedupe ON demand_signals(dedupe_hash)`); } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS demand_matches (
      id TEXT PRIMARY KEY, signal_id TEXT NOT NULL, offer_id TEXT NOT NULL,
      expected_value REAL NOT NULL DEFAULT 0.0, ev_basis TEXT NOT NULL DEFAULT 'ESTIMATED',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS outreach_drafts (
      id TEXT PRIMARY KEY, signal_id TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'COMMUNITY_FORUM',
      draft_text TEXT NOT NULL, landing_url TEXT NOT NULL, disclosure_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFTED', expires_at TEXT NOT NULL,
      posted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS source_rules (
      host TEXT PRIMARY KEY, allows_links INTEGER NOT NULL DEFAULT 1,
      allows_affiliate INTEGER NOT NULL DEFAULT 0, needs_disclosure INTEGER NOT NULL DEFAULT 1,
      automation_allowed INTEGER NOT NULL DEFAULT 0, owner_approved INTEGER NOT NULL DEFAULT 0,
      notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try { db.exec(`ALTER TABLE source_rules ADD COLUMN terms_checked_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE source_rules ADD COLUMN terms_url TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN approved_at TEXT`); } catch {}
  try { db.exec(`ALTER TABLE product_proposals ADD COLUMN owner_session_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE learning_records ADD COLUMN provenance TEXT DEFAULT 'APP_LOGGED_CALL'`); } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS stored_reports (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, filename TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE, byte_size INTEGER NOT NULL, row_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}


  // Initialize schema (creates all tables if not exist — safe for both fresh and existing DBs)

  db.exec(SCHEMA_SQL);

  // Backfill public slugs for existing businesses without ever guessing a
  // tenant at request time. Collisions are resolved deterministically.
  try {
    const businesses = db
      .prepare(`SELECT id, name, public_slug FROM businesses WHERE public_slug IS NULL OR trim(public_slug) = ''`)
      .all() as any[];

    const exists = db.prepare('SELECT 1 FROM businesses WHERE public_slug = ? LIMIT 1');
    const update = db.prepare(`UPDATE businesses SET public_slug = ?, updated_at = datetime('now') WHERE id = ?`);

    for (const business of businesses) {
      const base = String(business.name || business.id)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `business-${String(business.id)}`;

      let slug = base;
      let suffix = 2;
      while (exists.get(slug)) {
        slug = `${base}-${suffix++}`;
      }
      update.run(slug, business.id);
    }
  } catch (err) {
    console.warn('[DB] Business public slug backfill skipped:', err);
  }

  dbInstance = db;
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function resetDbForTesting(): Database.Database {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  dbInstance = db;
  return dbInstance;
}