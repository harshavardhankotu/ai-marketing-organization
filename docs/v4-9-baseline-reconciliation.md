# V4.9 Release Baseline Reconciliation & Production Reality Audit

**Repository:** `harshavardhankotu/ai-marketing-organization`  
**Date:** November 3, 2026  
**Auditor & Lead Engineer:** Principal Engineer, Revenue Systems Auditor & Cost Optimisation Lead  
**Working Branch:** `feat/v4-2-multi-sector-commerce-recovery`  
**Branch Head Commit:** `0f294bfe1de4acac31309548ab117058afe3fb07`  
**Production Remote:** `origin/main` at `f3e0c92d8d2b824504b77976f88641e3f83e7cdb`  
**Financial Baseline:** Strictly ₹0.00 Bank-Confirmed Cash, ₹0.00 Paid Advertising  

---

## 1. Executive Summary & Git Lineage Audit

A forensic verification of the repository's Git history, GitHub Pull Requests, Cloudflare Worker configurations, and deployment pipelines confirms the following baseline:

1. **Production Commit Live on Render:**
   - Commit: `f3e0c92` ("fix(ops): allow owner direct-outreach actions from browser review queue in public route policy (#32)").
   - Deployed on Render Service: `srv-darecoc9v7es73ea8t2g`.
   - Render is configured to auto-deploy changes merged into `main`.
2. **Pull Request Chain & Ancestry:**
   - **PR #33:** `feat/v4-1-durable-daily-revenue-operations` (Head commit: `bc214b3`, Base: `main`). Open, CI passing.
   - **PR #34:** `feat/v4-2-multi-sector-commerce-recovery` (Head commit: `0f294bf`, Base: `feat/v4-1-durable-daily-revenue-operations`). Open Draft PR.
   - **Ancestry Verification:** Commit `f3e0c92` (main) is the direct merge-base. `bc214b3` is a strict direct ancestor of `0f294bf`. The branch lineage is strictly linear with 0 divergence:
     `f3e0c92` (main) ➔ `82ae018` ➔ `bc214b3` (PR #33) ➔ `d676380` ➔ `45d9a2c` ➔ `0f294bf` (PR #34 Head).
3. **Database Migration State:**
   - Cloudflare D1 migrations `0001` through `0043` are applied in production.
   - Migrations `0044_multi_sector_deals.sql` and `0045_durable_job_lease_fencing.sql` are committed in the branch but pending merge to `main`.
4. **Cloudflare Cron Worker Schedule Reality vs. Documentation Discrepancy:**
   - `packages/cloudflare-worker/wrangler.toml` line 6 defines `crons = ["0 * * * *"]` (Hourly).
   - `packages/cloudflare-worker/src/worker.ts` line 53 sends `cronExpression: "0 * * * *"`.
   - Prior documentation informally claimed "10-minute cron execution". The actual code and deployed trigger is strictly **hourly (`0 * * * *`)**.
5. **Scheduler State:**
   - `.github/workflows/autonomous-commercial-cycle.yml` on `feat/v4-2-multi-sector-commerce-recovery` has had its `schedule:` block removed (commit `0f294bf`), retaining only `workflow_dispatch`.
   - On production `main` (`f3e0c92`), the legacy scheduled cron `30 3,15 * * *` still technically exists until PR #33/#34 merge.

---

## 2. Forensic Reconciliation of V4.8 Claims vs. Code Truth

An independent code inspection revealed five critical discrepancies between the V4.8 report and real operational behaviour:

| # | System Area | V4.8 Claimed Behaviour | Actual Code Reality at `0f294bf` | Reconciliation / Repair Required in V4.9 |
|---|---|---|---|---|
| 1 | **Deal Identity & URL Resolution** | "Deal resolved via public redirect" | Deals are identified by UUID (`deal_UUID`). `getDealById(id)` looks up only exact ID in in-memory `dealsMap`. Cold-starts or slug requests (e.g. `/public/deals/boat-airdopes-141-anc/redirect`) return **HTTP 404**. | Implement canonical slug generation, persistent D1 deal lookup, cold-start hydration, 404 for unknown, 410 for expired, 503 for unavailable. |
| 2 | **Visitor Attribution & Sub-IDs** | "Sub-IDs attached for 1-to-1 conversion" | Code appended query params (`?subid=...`) to an already shortened `clnk.in` URL. Cuelinks V3 API expects Sub-IDs in `POST /links/convert` body. `tracking_url` field was overwritten with `short_url`. | Pass unique visitor Sub-IDs (`subid`..`subid5`) in `POST /links/convert` request body; keep `tracking_url` and `short_url` separate; use full `tracking_url` for redirect. |
| 3 | **Public Redirect Safety** | "Click attribution logged" | In `routes/api.ts`, redirect executes `INSERT OR IGNORE INTO partners ... ('APPROVED', 1, 'AUTHORIZED')`, auto-approving partners on public GET requests! D1 click write errors were swallowed in a `try/catch` and still redirected. | Never approve/create partners in public routes. Require successful local click/referral write BEFORE redirecting; return 503 if write fails. |
| 4 | **Traffic Classification** | "Traffic classified accurately" | `referral-tracking.ts` classified any browser User-Agent containing `chrome\|safari` as `'human'`. | Reclassify browser User-Agents as `'browser_candidate'`. Preserve `'human'` only for verified interaction. |
| 5 | **Transaction Reconciliation** | "Transactions reconciled" | `getTransactions()` in `cuelinks-sync-manager.ts` and `deal-discovery-engine.ts` only fetched page 1 with `per_page: 50`. No cursor pagination, no `updated_since`, no transaction persistence or Sub-ID matching. | Implement incremental multi-page pagination using `updated_since`, match Sub-IDs to local clicks, and filter by pilot channel/campaign. |
| 6 | **Discovery Engine Failure Reporting** | "Page failures handled" | When Cuelinks returned HTTP 500, `src.lastHttpStatus` was still overwritten with `200` and `failureCount = 0`. | Preserve failed page telemetry (`lastHttpStatus = 500`, `failureCount`, error info). Never report full success when a page fails. |

---

## 3. Deployment Pipeline Race Condition Analysis

Render is configured to automatically trigger builds upon pushes to `main`.
Simultaneously, `.github/workflows/deploy-cron-worker.yml` triggers on push to `main` and executes:
1. `npm ci`
2. `npm run build`
3. `npx tsx packages/backend/src/db/d1-migrations/index.ts` (runs D1 migrations)
4. `wrangler deploy` (deploys Cloudflare Worker)

**Risk Identified:** If Render builds and boots the new backend container before GitHub Actions completes step 3, the backend will attempt to query tables or columns (such as `lease_token` in `automation_jobs` from migration 0045) that have not yet been created in D1.

**V4.9 Runbook Mandate:** A migration-first deployment sequence must be enforced. PRs #33 and #34 must NOT be merged until migration verification runbooks are approved.
