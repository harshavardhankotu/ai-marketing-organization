# Mistakes Board — Active Rules & Guardrails

> Auto-generated from Cloudflare D1 mistakes_board at 2026-10-10T13:46:47.869Z
> Total Open Rules: 12
> Antigravity loads this file at session start. Do not delete.

## Active Guardrails (Sorted by Severity, then Recurrence)

### [P1] PASS given without raw proof
- **ID:** `mst_02_pass_without_raw_proof`
- **Severity:** P1 | **Recurrence:** 2 | **Status:** OPEN
- **Rule:** **Give PASS only when raw output proves it. Give PARTIAL when only a script test ran. Give FAIL in all other cases.**
- **What Happened:** Report awarded PASS without pasting verbatim raw terminal and curl execution outputs.
- **Cause:** Agent summarized results rather than capturing and printing verbatim stdout.
- **Guard:** NONE

### [P1] Agent chose products and wrote facts as if the owner checked them
- **ID:** `mst_03_agent_chose_products`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Do not write owner facts for the owner. Product approval requires explicit owner submission with canonical Amazon URL, 3 spec facts with dates, and product_checked=true.**
- **What Happened:** Agent generated product proposals and listing facts presenting them as human-verified.
- **Cause:** Missing strict barrier separating agent discovery from owner approval.
- **Guard:** NONE

### [P1] Fixture data in the production deploy folder and site identity
- **ID:** `mst_04_fixture_in_production_deploy`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **prepare-deploy must build ONLY from PUBLISHED guides in production D1, and fail with NO_PUBLISHED_GUIDE if none exist. Site identity must come strictly from owner_intake or env.**
- **What Happened:** Fixture guides and synthetic site names ('India Commercial Review') were bundled in frontend distribution and generator fallbacks.
- **Cause:** Default fallback strings and fixture files were used instead of failing closed.
- **Guard:** NONE

### [P1] Raw output changed between reports (timestamps, columns, a missing row)
- **ID:** `mst_05_raw_output_changed_between_reports`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Paste raw command output directly from database or CLI without manual formatting, column renaming, or timestamp altering.**
- **What Happened:** Ledger report output omitted row call_1791259250048_ppmps, renamed columns to operation/credits_used, altered timestamps, and added synthetic Gemini call.
- **Cause:** Model formatted/synthesized markdown JSON instead of running and pasting raw D1 SELECT query results.
- **Guard:** NONE

### [P1] Local counter differs from provider dashboard (Tavily: 4 local, 226 real)
- **ID:** `mst_06_local_counter_differs_from_provider_dashboard`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Reconcile local counters with owner-reported provider dashboard and maintain drift checking.**
- **What Happened:** Local provider_quota_state recorded 4 Tavily credits consumed while real Tavily dashboard showed 226 credits consumed.
- **Cause:** Pre-audit external calls were not recorded in local database table.
- **Guard:** NONE

### [P1] Guide generated before owner approval
- **ID:** `mst_12_guide_generated_before_approval`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Guide drafting must strictly gate on owner-approved proposal and offer active=1.**
- **What Happened:** Content generation pipeline triggered guide generation before owner reviewed and approved product offer.
- **Cause:** Pipeline advanced from proposal to guide draft without gating on status = APPROVED.
- **Guard:** NONE

### [P1] Production log row written by script and shown as app provenance
- **ID:** `mst_14_production_log_row_script_provenance`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Never write production log rows by script. Application provenance requires logged runtime calls through the app.**
- **What Happened:** Agent wrote a production log row (call_1791393061443_spec01) by script and presented it as app provenance
- **Cause:** Manual script executed direct insert into production D1 bypassing application call stack
- **Guard:** NONE

### [P1] Tavily credits rose from 226 (owner, Oct 8) to 257 (API) with no log
- **ID:** `mst_15_tavily_credits_unlogged_rise`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Log actual credits on every Tavily call with include_usage, run daily usage sync, and flag drift >10%.**
- **What Happened:** Tavily credit usage rose from 226 to 257 on provider API check with no corresponding application call log
- **Cause:** Tavily API calls executed outside the logged application runtime without include_usage tracking
- **Guard:** NONE

### [P1] Boilerplate "biggest risk" repeated without data
- **ID:** `mst_16_boilerplate_biggest_risk_repeated`
- **Severity:** P1 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Compute top blockers directly from open mistakes board items and money path, citing measured data and monetary impact.**
- **What Happened:** Repeated generic boilerplate risk text across reports without computing risk from measured data
- **Cause:** Risk assessment was hardcoded rather than dynamically computed from open blockers and money path
- **Guard:** NONE

### [P2] Placeholder text left in prompts
- **ID:** `mst_01_placeholder_prompts`
- **Severity:** P2 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Reject any value that contains brackets, PUT_, or INSERT.**
- **What Happened:** Placeholder text and bracketed tokens were left in prompts and documentation.
- **Cause:** Missing preflight lint on prompt templates.
- **Guard:** NONE

### [P2] Hook tested by script only. Antigravity did not run it
- **ID:** `mst_07_hook_tested_by_script_only`
- **Severity:** P2 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Report PARTIAL when a hook is tested by script only and not intercepted by Antigravity runtime.**
- **What Happened:** Antigravity hooks were verified solely through synthetic test scripts and never intercepted tool calls in native Antigravity execution.
- **Cause:** No active workspace configured in Antigravity session, preventing workspace .agents/hooks.json attachment.
- **Guard:** NONE

### [P2] Provider limits written as fact without a source (Gemini 1500, Tavily 1000)
- **ID:** `mst_08_provider_limits_unverified_source`
- **Severity:** P2 | **Recurrence:** 1 | **Status:** OPEN
- **Rule:** **Leave provider limits as NULL (UNKNOWN) unless citing official provider documentation, or label as OWNER_REPORTED.**
- **What Happened:** Gemini provider limit 1500 and Tavily limit 1000 were reported without citing official documentation or owner verification.
- **Cause:** Assumptions based on public marketing discussions without verifying provider documentation.
- **Guard:** NONE

