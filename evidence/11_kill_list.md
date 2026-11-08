# 11_kill_list.md — Component Inventory & Rationalization Recommendations

Audit Date: 2026-11-08  
Repository: `https://github.com/harshavardhankotu/ai-marketing-organization`  
Branch: `main` (`b4ee6e5fc58960de48dfa61fa79aff20d5f83e17`)  
Deployment: Render Production (`srv-darecoc9v7es73ea8t2g`)  
Rule: **Read-Only Audit — Zero Code or DB Modifications Made**

---

## 1. System Components, Directories, and Catalogues

| Component / Artifact | Exists | Wired | Used in Prod | Verified Result | Recommendation | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **80-Agent Catalog** (`packages/shared/src/contracts/agent-contracts.ts`) | **YES** | **NO** | **NO** | **NO** | **PARK** | 2,500 lines of static agent definitions (`res-01`..`res-20`, `strat-01`..`strat-20`, `cont-01`..`cont-20`, `ops-01`..`ops-20`). The production engine does not execute them; the 20 background workflows run directly in `automation-registry-engine.ts`. |
| **Agent Runtime** (`packages/backend/src/agents/agent-runtime.ts`) | **YES** | **NO** | **NO** | **NO** | **PARK** | Only invoked by `CoordinatedAgentOrchestrator` on non-scheduled endpoints (`/agents/campaign`). Zero production executions in D1. |
| **Coordinated Orchestrator** (`packages/backend/src/agents/coordinated-orchestrator.ts`) | **YES** | **NO** | **NO** | **NO** | **PARK** | Exposes manual test endpoints (`/agents/divisions`, `/agents/campaign`). Not triggered by Cloudflare Worker cron or any production schedule. |
| **Frontend Agents Page** (`packages/frontend/src/pages/Agents.tsx`) | **YES** | **NO** | **NO** | **NO** | **PARK** | Visual catalog of 80 agents with simulated scores. Purely illustrative UI. |
| **`.agent` Directory** (Root Directory) | **YES** | **NO** | **NO** | **NO** | **REMOVE** | Legacy agent state files (`architecture-state.md`, `current-objective.md`, `project-state.json`). Superseded by repository docs and brain artifacts. |
| **`.agents` Directory** (Root Directory) | **YES** | **YES** | **DEV ONLY** | **YES** | **KEEP** | Contains active Antigravity IDE configuration (skills, rules, hooks, scheduled automations). |
| **Duplicate / Historical Docs** (`docs/v4-*`, `docs/v5-0-*`, `docs/revenue_engine_v2_*`) | **YES** | **NO** | **NO** | **NO** | **PARK** | 50+ superseded delivery reports from historical development iterations. Clutters repository search and prompt contexts; recommend moving to `docs/archive/`. |
| **`SiteFix AI` Core Scanner** (`packages/backend/src/tools/site-audit/`) | **YES** | **YES** | **YES** | **YES** | **KEEP** | Operational production HTML scanner. Completed 2 live audits in production D1. |
| **`GooglePageSpeedClient` Keyless Fallback** | **YES** | **YES** | **FAILING** | **NO** | **REPAIR** | Fails with HTTP 429 quota exhaustion because Google Cloud requires an authenticated API key for `pagespeedonline/v5`. Needs dedicated API key. |
| **Razorpay Adapter** (`packages/backend/src/integrations/razorpay.ts`) | **YES** | **YES** | **PARTIAL** | **NO** | **REPAIR** | Webhook handler `/webhooks/razorpay` crashes on synchronous D1 read and missing table. Needs migration to D1 asynchronous query and `processed_webhook_events`. |
| **Cuelinks V3 Client & Sync** (`packages/backend/src/commission/cuelinks-v3-client.ts`) | **YES** | **YES** | **YES** | **YES** | **KEEP** | Fully authenticated with Cuelinks API v3; channel 331585 approved; successfully pulls publisher and campaign data. |
| **Outbound Referral Tracking** (`packages/backend/src/commission/referral-tracking.ts`) | **YES** | **YES** | **FLAWED** | **NO** | **REPAIR** | Reuses static embedded sub-IDs across multiple visitors; needs dynamic clickId generation per redirect. |

---

## 2. All 20 Registered Background Workflows

| Workflow ID | Exists | Wired | Used in Prod | Verified Result | Recommendation | Notes / Operational Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`daily_market_demand_research`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs hourly; samples multi-sector bandit; queries Tavily/Google search. |
| **`competitor_pricing_research`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 24h; collects competitor pricing benchmarks in metro hubs. |
| **`prospect_discovery_validation`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 12h; discovered 1,213 clinic prospects in D1 `platform_prospects`. |
| **`prospect_dedup_qualification`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 6h; validates prospect domains against suppression lists. |
| **`outreach_draft_preparation`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 6h; generated 38 personalized drafts behind owner approval gate. |
| **`owner_approval_queue_generation`**| **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs hourly; compiles pending drafts count for `/owner/today`. |
| **`authorized_outreach_dispatch`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs hourly; strictly checks `human_approved = 1` before dispatching. |
| **`new_inquiry_processing`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs hourly; checks `owner_intake` for public leads; DPDP consent logging. |
| **`reply_classification_followup`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 2h; scans `direct_outreach_log` for inbound client replies. |
| **`proposal_prep_followup`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 6h; tracks issued proposal expiration and checkout readiness. |
| **`payment_status_reconciliation`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs hourly; reconciles payment order statuses; enforces ₹0 bank cash rule. |
| **`affiliate_offer_reconciliation`**| **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 6h; syncs Cuelinks merchant campaigns to D1 `cuelinks_campaigns`. |
| **`content_freshness_verification`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 12h; audits first-party public guide links and redirects. |
| **`daily_commercial_summary`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 24h; aggregates net operating contributions into `stored_reports`. |
| **`seasonal_demand_research`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 12h; evaluates upcoming festival calendar from `seasonal_festivals`. |
| **`seo_keyword_research`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 12h; clusters commercial keyword intent to canonical routes. |
| **`quota_health_checks`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs hourly; resets provider quotas and verifies circuit breaker states. |
| **`healthcare_claim_verification`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 24h; audits clinical compliance in `healthcare_evidence_records`. |
| **`multi_market_lead_qualification`**| **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 6h; scores prospects against sector rubrics in `platform_prospects`. |
| **`b2b_suppression_and_compliance_audit`** | **YES** | **YES** | **YES** | **YES** | **KEEP** | Runs every 12h; enforces 60-day outreach cooldown; purges expired DPDP records. |
