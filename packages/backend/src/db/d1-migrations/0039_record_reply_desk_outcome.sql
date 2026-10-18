-- Migration 0039: Reply Desk Tables & Outcome Record (Step 8 Reality Check)

-- 1. Create reply_desk_drafts table in D1
CREATE TABLE IF NOT EXISTS reply_desk_drafts (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL,
  draft_answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  intent_class TEXT DEFAULT 'DIRECT_NEED',
  qualification_status TEXT DEFAULT 'QUALIFIED',
  qualification_reason TEXT,
  next_permitted_action TEXT DEFAULT 'OWNER_REVIEW_AND_MANUAL_POST',
  query_date TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reply_desk_drafts_date ON reply_desk_drafts(query_date, status);

-- 2. Create reply_desk_query_runs table in D1
CREATE TABLE IF NOT EXISTS reply_desk_query_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  run_date TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'TAVILY',
  execution_time_ms INTEGER DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  result_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reply_desk_runs_date ON reply_desk_query_runs(run_date);

-- 3. Record OUTCOME in learning_records for Step 8c (< 3 real signals discovered)
INSERT OR REPLACE INTO learning_records (
  id, organization_id, business_id, learning_type, decision, hypothesis,
  action, audience, offer, channel, result, revenue_inr, cost_inr,
  time_taken_hours, confidence, evidence_json, what, outcome, cause, rule,
  provenance, source, created_at
) VALUES (
  'lrn_reply_desk_zero_buyer_signals',
  'org_owner_primary',
  'biz_platform_aro',
  'OUTCOME',
  'PIVOT_REPLY_DESK_QUERIES',
  'Targeted operational queries will yield higher intent signals than generic listicle searches.',
  'Change queries from generic software keywords to direct clinic communication challenges; limit to 2 per day.',
  'Local clinic operators and small service practices',
  'PLATFORM_SETUP',
  'TAVILY_SEARCH',
  'ZERO_REAL_SIGNALS',
  0.0,
  0.0,
  0.1,
  0.95,
  '{"inspected_demand_signals": 181, "real_buyer_requests": 0, "finding": "Articles and directory comparison sites only"}',
  'Tavily reply desk queries produced articles and directory comparison posts rather than inbound business requests for help.',
  'Fewer than 3 real signals (0 found) after discovery runs.',
  'Broad commercial keyword queries ("best accounting software small business India") retrieve SEO blogs rather than direct practitioner requests for triage help.',
  'Do not turn articles, directories, or fixtures into leads. Retain strict 2-search/day cap.',
  'APP_LOGGED_CALL',
  'STEP_8_REPLY_DESK_AUDIT',
  datetime('now')
);
