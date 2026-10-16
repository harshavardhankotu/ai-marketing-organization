# Engineering & Operational Lessons Learned

> **Generated:** 2026-10-16
> **Repository:** `harshavardhankotu/ai-marketing-organization`
> **Core Principle:** Zero synthetic metrics, zero fabricated demand, zero unverified revenue, zero agent default assumptions.

---

## 1. Executive Summary & Foundational Rules

1. **Demand Provenance Gate:** Every demand signal must trace to an external URL. Fixtures or mock signals (`search.community`) must never enter production D1, count toward 3-signal gates, or justify offer creation.
2. **Four-State Payment Truth:** Commercial revenue is NEVER recorded from page visits, proposal creations, or self-reported claims. Truth progresses through:
   `PAYMENT_PAGE_VIEW` (traffic only) &rarr; `PAYMENT_CLAIMED` (customer UTR entered, ₹0 ledgered) &rarr; `MANUAL_VERIFIED` (owner confirms bank statement credit) &rarr; `EXPORT_VERIFIED` (reconciled against bank/gateway settlement export).
3. **Statutory Owner Boundary:** The system strictly prohibits agents from setting, guessing, or defaulting statutory owner facts (PAN, GST, UPI VPA, Amazon Associates dates). All owner facts require explicit manual entry via `scripts/owner-apply.mjs` or owner form.
4. **Hermetic Test Isolation:** Tests must NEVER spend live provider credits (Tavily, Gemini, Firecrawl) or mutate production storage.
5. **Deployment Parity:** Production deployments must strictly match local git HEAD (`HEAD === render_commit`), and no code may deploy while CI is red.

---

## 2. Lessons from Mistakes Board (Root Cause & Permanent Guards)

| Mistake ID | Sev | What Failed | Root Cause | Permanent Guard | New Operational Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **mst_02_pass_without_raw_proof** | `P1` | Report awarded PASS without pasting verbatim raw terminal and curl execution outputs. | Agent summarized results rather than capturing and printing verbatim stdout. | LINT (`scripts/board-preflight.mjs`) | Give PASS only when raw output proves it. Give PARTIAL when only a script test ran. Give FAIL in all other cases. |
| **mst_03_agent_chose_products** | `P1` | Agent generated product proposals and listing facts presenting them as human-verified. | Missing strict barrier separating agent discovery from owner approval. | TEST (`packages/backend/tests/unit/automatic-offer-lane.test.ts:fails the lint when a guide contains an unsourced product fact (Step 3f, 3i)`) | Do not write owner facts for the owner. Product approval requires explicit owner submission with canonical Amazon URL, 3 spec facts with dates, and product_checked=true. |
| **mst_04_fixture_in_production_deploy** | `P1` | Fixture guides and synthetic site names ('India Commercial Review') were bundled in frontend distribution and generator fallbacks. | Default fallback strings and fixture files were used instead of failing closed. | TEST (`packages/backend/tests/unit/auto-publish-dry-run.test.ts:fails with NO_PUBLISHED_GUIDE when zero published guides exist (Step 4b)`) | prepare-deploy must build ONLY from PUBLISHED guides in production D1, and fail with NO_PUBLISHED_GUIDE if none exist. Site identity must come strictly from owner_intake or env. |
| **mst_05_raw_output_changed_between_reports** | `P1` | Ledger report output omitted row call_1791259250048_ppmps, renamed columns to operation/credits_used, altered timestamps, and added synthetic Gemini call. | Model formatted/synthesized markdown JSON instead of running and pasting raw D1 SELECT query results. | LINT (`scripts/generate-status.mjs`) | Paste raw command output directly from database or CLI without manual formatting, column renaming, or timestamp altering. |
| **mst_06_local_counter_differs_from_provider_dashboard** | `P1` | Local provider_quota_state recorded 4 Tavily credits consumed while real Tavily dashboard showed 226 credits consumed. | Pre-audit external calls were not recorded in local database table. | TEST (`packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)`) | Reconcile local counters with owner-reported provider dashboard and maintain drift checking. |
| **mst_12_guide_generated_before_approval** | `P1` | Content generation pipeline triggered guide generation before owner reviewed and approved product offer. | Pipeline advanced from proposal to guide draft without gating on status = APPROVED. | TEST (`packages/backend/tests/unit/auto-publish-dry-run.test.ts:executes full dry run: lint pass, publish, build, deploy command printed, IndexNow payload printed (Step 4g)`) | Guide drafting must strictly gate on owner-approved proposal and offer active=1. |
| **mst_13_category_block_query_no_input** | `P1` | Reported SQL query for isCategoryBlocked did not accept or match the specific product category parameter. | Hardcoded SQL query template used in documentation and engine without binding category parameter. | TEST (`packages/backend/tests/unit/owner-control-center.test.ts:category policy executes SQL against learning_records with category input and uses matched rows`) | isCategoryBlocked must take product category as argument and execute parameterized SQL against learning_records. |
| **mst_14_production_log_row_script_provenance** | `P1` | Agent wrote a production log row (call_1791393061443_spec01) by script and presented it as app provenance | Manual script executed direct insert into production D1 bypassing application call stack | TEST (`packages/backend/tests/unit/owner-action-truth-gates.test.ts:verifies 5 canonical owner actions resolve strictly on proof and open otherwise`) | Never write production log rows by script. Application provenance requires logged runtime calls through the app. |
| **mst_15_tavily_credits_unlogged_rise** | `P1` | Tavily credit usage rose from 226 to 257 on provider API check with no corresponding application call log | Tavily API calls executed outside the logged application runtime without include_usage tracking | TEST (`packages/backend/tests/unit/hermetic-tests.test.ts:loadLocalEnvFile refuses to load .env.local when in test environment (Step 1a)`) | Log actual credits on every Tavily call with include_usage, run daily usage sync, and flag drift >10%. |
| **mst_16_boilerplate_biggest_risk_repeated** | `P1` | Repeated generic boilerplate risk text across reports without computing risk from measured data | Risk assessment was hardcoded rather than dynamically computed from open blockers and money path | LINT (`scripts/generate-status.mjs`) | Compute top blockers directly from open mistakes board items and money path, citing measured data and monetary impact. |
| **mst_17_rupee_estimates_without_data** | `P1` | Previous status reports printed hypothetical or projected rupee numbers for revenue potential without verified transaction backing. | Projections were conflated with verified ledger records in report generation. | LINT (`scripts/lint-no-unbacked-rupee-estimates.mjs`) | Do not write rupee estimates. Use a measured value or write UNKNOWN. |
| **mst_18_owner_actions_resolved_without_evidence** | `P1` | TODAY page showed complete intake and approve product as RESOLVED when production D1 had 0 intake rows and 0 active offers. | Status computation evaluated local test fixtures and checked loose conditions without verifying provenance and session IDs. | TEST (`packages/backend/tests/unit/owner-action-truth-gates.test.ts:verifies 5 canonical owner actions resolve strictly on proof and open otherwise`) | An action is RESOLVED only when exact verifiable evidence exists in the production database (intake written by OWNER_FORM, proposal APPROVED with owner session ID and active offer, guide PUBLISHED, visit recorded by click beacon, or uploaded report with content hash). |
| **mst_19_partner_details_from_reviews_as_facts** | `P1` | Research on Indian affiliate networks stored blog and forum claims about commissions, cookies, and KYC as factual parameters. | Third-party aggregators and reviews were treated as authoritative provider documentation. | TEST (`packages/backend/tests/unit/affiliate-adapters.test.ts:adapter refuses to build link if owner-entered template is missing`) | Mark all scraped network details UNVERIFIED. Store only official signup URLs and dates. Adapters must read templates from partner records only. |
| **mst_20_production_write_audit_incomplete** | `P1` | Initial write audit focused only on call_1791393061443_spec01 instead of auditing all script-written rows across all tables. | Audit scope was narrowly scoped to a single reported mistake rather than a full database inventory. | LINT (`scripts/audit-full-d1.mjs`) | List every production D1 write across all tables, row counts, dates, methods, and quarantine unapproved rows. |
| **mst_21_deployed_with_api_key_while_ci_red** | `P1` | After CI run 37866291738 failed on unit tests, the commit was deployed directly using Render API key, bypassing the CI gate. | Deploy script did not verify GitHub Actions check run conclusion before triggering Render API deploy. | TEST (`packages/backend/tests/unit/ci-deploy-gate.test.ts:refuses to deploy when latest CI run for HEAD is not success`) | Do not deploy with a Render API key while CI is red. Deploy script must verify CI check suite success. |
| **mst_22_audit_counts_did_not_match_earlier_raw_counts** | `P1` | Previous write audit reported 3 prospects and 3 contacts instead of 1,188 prospects and 408 contacts, conflating the migration 0023 quarantine targets with total table counts. | Audit query inspected a subset filter rather than surveying all tables across sqlite_master. | TEST (`packages/backend/tests/unit/data-audit-reconciliation.test.ts:fails when table count changes without recorded cause`) | Run SELECT COUNT(*) on every table from sqlite_master. Report complete raw table counts without conflating targeted rows with total table size. |
| **mst_23_tests_spent_live_provider_credits** | `P1` | Vitest test suite loaded live credentials from .env.local and spent real Tavily search credits (usage reached 312) due to lack of environment stripping and un-intercepted network calls. | Local environment variables leaked into test runner without hermetic network call blocking. | TEST (`packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)`) | Test suite must strip all provider keys and block network calls to api.tavily.com, api.firecrawl.dev, and generativelanguage.googleapis.com. |
| **mst_default_identity_reintroduced** | `P1` | Owner full name and site details were reintroduced as code defaults in owner-auth and schema. | Fallback defaults created to avoid missing environment errors. | TEST (`packages/backend/tests/unit/no-default-identity.test.ts:enforces all six owner facts and prevents default identity reintroduction`) | Never use default or fallback owner names or site identities in code or configuration. |
| **mst_p1_hardcoded_affiliate_tag** | `P1` | A hardcoded affiliate tag literal was found in automatic-offer-lane.ts and static guide fixtures. | Fallback default string added to bypass missing env var in local testing. | LINT (`scripts/lint-mask-affiliate-tag.mjs`) | Never hardcode an affiliate tag in application source or default to hardcoded tag fallbacks. |
| **mst_p1_mock_specs_production** | `P1` | AutomaticOfferLane fetchAndStoreBrandSpecs returned mock thermal printer specs when Firecrawl key was missing. | Mock specs were returned whenever Firecrawl key was missing regardless of production environment. | TEST (`packages/backend/tests/unit/automatic-offer-lane.test.ts:fails the lint when a guide contains an unsourced product fact (Step 3f, 3i)`) | Never return or publish mock product specification lines outside hermetic unit test environments. |
| **mst_p1_quota_stale_local_db** | `P1` | Status reports and quota gates previously read local database counters that lagged live provider dashboards by hundreds of credits. | Local database row was trusted as sole authority without automated sync from live provider usage endpoints. | TEST (`packages/backend/tests/unit/hermetic-tests.test.ts:strips all provider keys from environment in test setup (Step 1a)`) | Always synchronize provider credit usage directly from authoritative provider APIs, never stale local counters. |
| **mst_p1_fixture_demand_seeded_by_migration** | `P1` | Migration 0026 seeded 14 fake hardware buyer questions with search.community/q* URLs directly into production D1 demand_signals table. | Test fixture data was bundled into an unquarantined D1 SQL migration. | TEST (`packages/backend/tests/unit/no-fixture-migrations.test.ts:rejects migrations that insert mock, fixture, or search.community URLs into production tables`) | Never insert test fixtures, mock URLs (search.community, localhost, example.com), or synthetic buyer demand into production migrations. |
| **mst_01_placeholder_prompts** | `P2` | Placeholder text and bracketed tokens were left in prompts and documentation. | Missing preflight lint on prompt templates. | TEST (`packages/backend/tests/unit/owner-env-intake.test.ts:fails validation when placeholder or bracketed text is provided (Step 5b, 5f)`) | Reject any value that contains brackets, PUT_, or INSERT. |
| **mst_07_hook_tested_by_script_only** | `P2` | Antigravity hooks were verified solely through synthetic test scripts and never intercepted tool calls in native Antigravity execution. | No active workspace configured in Antigravity session, preventing workspace .agents/hooks.json attachment. | HOOK (`.agents/scripts/protect-and-sanitize.cjs`) | Report PARTIAL when a hook is tested by script only and not intercepted by Antigravity runtime. |
| **mst_08_provider_limits_unverified_source** | `P2` | Gemini provider limit 1500 and Tavily limit 1000 were reported without citing official documentation or owner verification. | Assumptions based on public marketing discussions without verifying provider documentation. | LINT (`scripts/generate-status.mjs`) | Leave provider limits as NULL (UNKNOWN) unless citing official provider documentation, or label as OWNER_REPORTED. |
| **mst_09_cooldown_failed_open** | `P2` | Search queries bypassed 7-day cooldown when cache lookups failed or returned undefined. | Missing fail-closed error handling around search cache query. | TEST (`packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:fails closed with DISCOVERY_COOLDOWN_CHECK_FAILED when D1 cooldown check errors, making zero search calls`) | Enforce 7-day query cooldown on all automated discovery queries before dispatching external calls. |
| **mst_10_ratelimiter_used_proxy_ip** | `P2` | Rate limiter used socket address or untrusted x-forwarded-for headers rather than validated Cloudflare connecting IP. | Missing header precedence and proxy trust validation in client IP resolution. | TEST (`packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:derives client IP from X-Forwarded-For, assigns separate buckets to different IPs, and blocks 11th request with 429 without creating real leads`) | do not trust cf-connecting-ip unless TRUST_CF_HEADER is true. Use the rightmost entry that is not a private or Cloudflare address. |
| **mst_11_discovery_loop_duplicate_rows** | `P2` | Repeated cron ticks generated duplicate prospect and call log entries. | Missing unique constraints and deduplication keys on external research requests. | TEST (`packages/backend/tests/unit/stop-the-waste-safety-pass.test.ts:skips candidates whose domain or source URL already exists in platform_prospects`) | Deduplicate discovery intents and call logs with unique keys and skip duplicate logging. |

---

## 3. Empirical Learning Records (From Production Engine)

### SEARCH_DEMAND_NOT_REACHING_BUYERS (ZERO_BUYER_QUESTIONS_AFTER_WEEK)
- **Date:** 2026-10-16 13:08:04
- **Root Cause:** 167 consecutive search signals over 10 days yielded 13 duplicate publisher review articles and 0 real buyer questions
- **Governing Rule:** Halt credit spend on a category when a week of discovery yields fewer than 3 real buyer questions
- **Source:** `OUTCOME`

### null (null)
- **Date:** 2026-10-10 14:44:27
- **Root Cause:** null
- **Governing Rule:** Link to Amazon search query with transparent disclaimer; do not scrape amazon.*
- **Source:** `OUTCOME`

### Boilerplate "biggest risk" repeated without data (mst_16) (FAILED)
- **Date:** 2026-10-08 21:45:58
- **Root Cause:** Risk assessment was hardcoded boilerplate without computing risk from measured data.
- **Governing Rule:** Compute top blockers directly from open mistakes board items and money path, citing measured data and monetary impact.
- **Source:** `SEEDED`

### Category BLOCK policy: Health, skin care, supplements, medical categories blocked (FAILED)
- **Date:** 2026-10-08 21:45:58
- **Root Cause:** High-liability and regulated categories pose commercial and legal risk.
- **Governing Rule:** Drop categories with outcome BLOCK (health, skin care, supplements, medical).
- **Source:** `SEEDED`

### Production log row written by script and shown as app provenance (mst_14) (FAILED)
- **Date:** 2026-10-08 21:45:57
- **Root Cause:** Direct insert of call_1791393061443_spec01 via scratch script.
- **Governing Rule:** Never write production log rows by script. Application provenance requires logged runtime calls through the app.
- **Source:** `SEEDED`

### Tavily credits rose from 226 (owner, Oct 8) to 257 (API) with no log (mst_15) (FAILED)
- **Date:** 2026-10-08 21:45:57
- **Root Cause:** Tavily API calls executed outside the logged application runtime without include_usage tracking.
- **Governing Rule:** Log actual credits on every Tavily call with include_usage, run daily usage sync, and flag drift >10%.
- **Source:** `SEEDED`

### Provider limits written as fact without a source (mst_08) (FAILED)
- **Date:** 2026-10-08 21:45:56
- **Root Cause:** Hardcoded 1500 for Gemini and 1000 for Tavily without official citation.
- **Governing Rule:** Leave provider limits as NULL (UNKNOWN) unless citing official documentation, or label ASSUMPTION.
- **Source:** `SEEDED`

### Guide generated before owner approval (mst_12) (FAILED)
- **Date:** 2026-10-08 21:45:56
- **Root Cause:** Guide generation triggered on unapproved candidate proposal.
- **Governing Rule:** Guide drafting must strictly gate on owner-approved proposal and offer active=1.
- **Source:** `SEEDED`

### Placeholder text left in prompts (mst_01) (FAILED)
- **Date:** 2026-10-08 21:45:55
- **Root Cause:** Agent prompts contained placeholder brackets and template variables.
- **Governing Rule:** Reject any value that contains brackets, PUT_, or INSERT.
- **Source:** `SEEDED`

### Hook tested by script only. Antigravity did not run it (mst_07) (FAILED)
- **Date:** 2026-10-08 21:45:55
- **Root Cause:** Hook verification executed standalone test script without interception in agent runtime.
- **Governing Rule:** Report PARTIAL when a hook is tested by script only and not intercepted by Antigravity runtime.
- **Source:** `SEEDED`

### Category policy block query: Executes SQL against learning_records with category input (WORKED)
- **Date:** 2026-10-08 21:45:54
- **Root Cause:** Category block query previously had no input parameter.
- **Governing Rule:** Category policy query must pass target category as parameter to SQL.
- **Source:** `SEEDED`

### Fake Booking Success Screen: Hardened consultation booking to require backend verification (WORKED)
- **Date:** 2026-10-08 21:45:53
- **Root Cause:** Client showed success without confirming backend payment request.
- **Governing Rule:** Require backend database confirmation for consultation bookings.
- **Source:** `SEEDED`

### Razorpay Default Webhook Secret Fallback: Replaced with strict production fail-closed signature verification (WORKED)
- **Date:** 2026-10-08 21:45:53
- **Root Cause:** Insecure fallback secret in non-production allowed unsigned webhooks.
- **Governing Rule:** Reject webhooks in production if webhook secret is missing or invalid.
- **Source:** `SEEDED`

### D1 Migration Parser Regex Bug: Fixed runner with robust statement splitter (WORKED)
- **Date:** 2026-10-08 21:45:53
- **Root Cause:** Naive regex broke on semicolons inside quotes or comments.
- **Governing Rule:** Use robust character-by-character SQL statement parser for migrations.
- **Source:** `SEEDED`

### Search Console data from the owner's own site. (UNKNOWN)
- **Date:** 2026-10-08 21:45:52
- **Root Cause:** Not tried yet. Awaiting owner connecting Search Console.
- **Governing Rule:** Use Search Console query impressions as highest-quality proof of search intent.
- **Source:** `SEEDED`

### Intent-based discovery of people who ask for recommendations. (UNKNOWN)
- **Date:** 2026-10-08 21:45:51
- **Root Cause:** Not tried yet. Demand engine state machine being implemented.
- **Governing Rule:** Discover commercial intent queries on owner-approved public hosts and score 0-100.
- **Source:** `SEEDED`

### Non-Amazon partners. (UNKNOWN)
- **Date:** 2026-10-08 21:45:51
- **Root Cause:** Not tried yet. Researching Indian affiliate networks for individual signups.
- **Governing Rule:** Verify KYC, payout rules, and link formatting before submitting for owner approval.
- **Source:** `SEEDED`

### The 80 catalog agents are not wired. They produced no output. (FAILED)
- **Date:** 2026-10-08 21:45:50
- **Root Cause:** Catalog agents existed as definitions without execution wiring in the revenue orchestrator.
- **Governing Rule:** Do not rely on unwired agents for revenue; use deterministic single-owner pipeline.
- **Source:** `SEEDED`

### No traffic source exists. No guide is published. No visitor has arrived. (FAILED)
- **Date:** 2026-10-08 21:45:50
- **Root Cause:** Zero published guides in production D1 and lack of inbound distribution channels.
- **Governing Rule:** Focus on demand engine matching people who ask for recommendations to approved offers.
- **Source:** `SEEDED`

### Agent chose products and wrote facts as if the owner checked them. (FAILED)
- **Date:** 2026-10-08 21:45:49
- **Root Cause:** Agent synthesized product facts and marked proposals without owner review.
- **Governing Rule:** Product approval requires explicit owner submission with canonical Amazon URL, 3 facts, and product_checked=true.
- **Source:** `SEEDED`

---

## 4. Recent Verified Git Commits

```text
* c9741fc - 2026-10-16: docs: sync PROJECT_STATUS.md with commit bd877ba and deploy dep-db8m28tbedkc73cn5r40
* bd877ba - 2026-10-16: feat: reconcile 15-stage funnel metrics, click attribution, and multi-category opportunities
* 5b70027 - 2026-10-16: docs: sync PROJECT_STATUS.md with commit 6ccf8b5 and deploy dep-db8gj83m8hqs738d85b0
* 6ccf8b5 - 2026-10-15: feat: multi-category revenue engine with empirical 15-stage funnel
* d263a49 - 2026-10-15: docs: sync PROJECT_STATUS.md and mistakes rules with commit 6015aa2 and deploy dep-db8ejjp42hec73c9egt0
* 6015aa2 - 2026-10-15: feat: eliminate unverified referral links, gate guides, remove synthetic scorecards, and align status
* b63eeee - 2026-10-15: docs: sync PROJECT_STATUS.md with commit 5ed1d9b and deploy dep-db8ds6dbedkc73a4bung
* 5ed1d9b - 2026-10-15: docs: sync mistakes board auto-generated rules
* 2b5b4f3 - 2026-10-15: feat: complete revenue engine 2.0 commercial loop, board truth guards, and dpdp lead leakage calculator
* 2722046 - 2026-10-14: docs: sync status records and mistakes board after Step 10 live deployment
* d2032f4 - 2026-10-14: test: ensure partner exists in hermetic dynamic-offer-discovery beforeEach
* cadac97 - 2026-10-14: fix(db): ensure domain_policy and brand_spec_lines tables are initialized in SCHEMA_SQL and client stubs
```

---

## 5. Verification Checklist for Future Changes

- [ ] Run `npm run board:preflight` before starting any task.
- [ ] Run `npm run board:verify` after making changes to verify all guards pass.
- [ ] Ensure 0 test fixtures are present in production D1 migrations (`no-fixture-migrations.test.ts`).
- [ ] Ensure all 6 statutory owner facts remain unguested (`owner-facts-and-publish-gate.test.ts`).
- [ ] Ensure test suite executes 100% hermetically with 0 API credit consumption.
