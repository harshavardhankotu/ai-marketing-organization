# STAGE F-LITE PRODUCTION AUDIT EVIDENCE FILE

- **Audit Timestamp:** 2026-11-10T12:15:00Z / 2026-11-10T17:45:00+05:30
- **Auditor Role:** Senior Staff Engineer & Production Reliability Auditor
- **Repository:** https://github.com/harshavardhankotu/ai-marketing-organization
- **Canonical Production URL:** https://ai-marketing-organization.onrender.com
- **Remote Cloudflare D1 Database:** `prod-db` (`0563bb85-f6d2-483f-8b0f-0784e3d604c7`)
- **Render Service ID:** `srv-darecoc9v7es73ea8t2g`

---

## 1. Repository and Deployment Identity Evidence

### A. Local Git Head & Remote Main
- **Command:** `git branch --show-current; git rev-parse HEAD; git ls-remote origin refs/heads/main; git log -1 --format="%H | %cd | %s"`
- **Timestamp:** 2026-11-10T12:13:43Z
- **Raw Output Excerpt:**
```text
main
2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c
2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c	refs/heads/main
2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c | Tue Nov 10 16:16:31 2026 +0530 | docs: update STATE.md for Stage E completion
```
- **Interpretation:** `OBSERVED`. Local HEAD and remote GitHub `main` are exactly in sync at `2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c`.

### B. Pull Requests & GitHub Actions Runs
- **Command:** `gh pr list --state all --limit 5; gh run list --limit 5`
- **Timestamp:** 2026-11-10T12:13:50Z
- **Raw Output Excerpt:**
```text
53	Stage E — First Revenue & Conversion Integrity Execution	fix/stage-e-conversion-funnel-integrity	MERGED	2026-11-10T10:13:02Z
52	Stage C — Production Integrity Closure	fix/stage-c-commercial-truth-closure	MERGED	2026-11-10T03:53:45Z
51	fix(recovery): Stage B production recovery	fix/production-recovery-stage-b	MERGED	2026-11-08T08:03:34Z
50	V5.8.4 — Revenue Path Closure, Razorpay Webhook Hardening & Administrative Compliance	fix/v5-8-4-revenue-path-closure	MERGED	2026-11-08T05:52:04Z
49	feat(v5.8.3): auditor-aligned production hardening with strict razorpay verification, true cuelinks gate and honest telemetry	fix/v5-8-3-auditor-hardening	MERGED	2026-11-08T04:18:16Z
completed	success	docs: update STATE.md for Stage E completion	Deploy Cloudflare Cron Worker	main	push	42801985653	4m24s	2026-11-10T10:46:35Z
completed	success	docs: update STATE.md for Stage E completion	CI & Deployment Pipeline	main	push	42801985631	4m18s	2026-11-10T10:46:35Z
completed	success	Stage E — First Revenue & Conversion Integrity Execution (#53)	Deploy Cloudflare Cron Worker	main	push	42800840705	4m27s	2026-11-10T10:38:19Z
completed	success	Stage E — First Revenue & Conversion Integrity Execution (#53)	CI & Deployment Pipeline	main	push	42800840502	4m27s	2026-11-10T10:38:19Z
```
- **Interpretation:** `OBSERVED`. PR #53 was squash-merged into `main` at `2026-11-10T10:38:16Z` (commit `6ba3656`), followed by doc update `2ed2dde` which completed CI and deployed to Render and Cloudflare Worker.

### C. Live Render Deployment Status
- **Command:** `curl.exe -sS --max-time 15 https://ai-marketing-organization.onrender.com/api/v1/public/autonomy-status`
- **Timestamp:** 2026-11-10T12:15:31Z
- **Raw Output Excerpt:**
```json
{
  "version": "5.8.4",
  "buildMetadata": {
    "version": "5.8.4",
    "gitCommit": "2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c",
    "deployedCommitSha": "2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c",
    "cloudflareWorkerStatus": {
      "status": "OBSERVED",
      "lastObservedPing": "2026-11-10 11:00:45",
      "lastUserAgent": "ai-marketing-cron-worker/1.0"
    },
    "cloudflareWorkerVersion": "ai-marketing-cron-worker/1.0",
    "d1MigrationVersion": "0050",
    "runtimeVerifiedAt": "2026-11-10T12:15:31.370Z"
  }
}
```
- **Interpretation:** `OBSERVED`. Live Render deployment SHA is `2ed2dde0d61a455fb132d802d2f73c16a3c6ba3c`. There is zero mismatch between Local HEAD, GitHub `main`, and Render live SHA.

---

## 2. Migration `0050` Resolution Evidence

### A. Git History of Migration File
- **Command:** `git log --stat -- packages/backend/src/db/d1-migrations/0050*`
- **Timestamp:** 2026-11-10T12:13:58Z
- **Raw Output Excerpt:**
```text
commit abd5d902719ff8cd28d3c447052c1747317726f7
Author: harshavardhankotu <73973400+harshavardhankotu@users.noreply.github.com>
Date:   Tue Nov 10 12:13:40 2026 +0530

    Stage C — Production Integrity Closure (#52)
    
    Stage D — Autonomous Daily Deals, Cuelinks Conversion Verification, and Cron Starvation Elimination

 ...50_stage_d_deal_reconciliation_and_schedule.sql | 81 ++++++++++++++++++++++
 1 file changed, 81 insertions(+)
```

### B. Remote D1 `_d1_migrations` Table
- **Command:** `npx wrangler d1 execute prod-db --remote --command "SELECT * FROM _d1_migrations ORDER BY id DESC LIMIT 5;"`
- **Timestamp:** 2026-11-10T12:14:10Z
- **Raw Output Excerpt:**
```json
[
  {
    "id": 51,
    "migration_name": "0050_stage_d_deal_reconciliation_and_schedule.sql",
    "applied_at": "2026-11-10 06:44:33"
  },
  {
    "id": 50,
    "migration_name": "0049_v5_8_4_revenue_path_closure.sql",
    "applied_at": "2026-11-08 05:25:39"
  }
]
```
- **Interpretation:** `OBSERVED`. Migration `0050` exists in repository and remote D1. It was introduced during Stage D via PR #52 (merged at `06:43:40Z`), and applied manually via CLI at `06:44:33Z` (GitHub Actions CI has no `wrangler d1 migrations apply` step). It altered no schemas; it executed score resets, outreach neutralization, workflow cadence adjustments, and deal candidate seeding. During Stage E, the feature freeze was reinstated: no migration `0051` was created, and `d1MigrationVersion` remained `"0050"`.

---

## 3. Direct Production D1 Counts Evidence

- **Command:** `npx wrangler d1 execute prod-db --remote --command "SELECT 'public_deals' as tbl, count(*) as cnt FROM public_deals; SELECT 'public_deals_in_stock' as tbl, count(*) as cnt FROM public_deals WHERE availability = 'IN_STOCK'; SELECT 'public_deals_monetizable' as tbl, count(*) as cnt FROM public_deals WHERE is_monetizable = 1 AND affiliate_verified = 1 AND product_verified = 1; SELECT 'partner_offers' as tbl, count(*) as cnt FROM partner_offers; SELECT 'partner_offers_active' as tbl, count(*) as cnt FROM partner_offers WHERE active = 1 AND status = 'ACTIVE'; SELECT 'partners' as tbl, count(*) as cnt FROM partners;"`
- **Timestamp:** 2026-11-10T12:14:36Z
- **Raw Output Excerpt:**
```text
public_deals: 134
public_deals_in_stock: 133
public_deals_monetizable: 50
partner_offers: 52
partner_offers_active: 52
partners: 3
```

- **Command:** `npx wrangler d1 execute prod-db --remote --command "SELECT 'commission_content_assets' as tbl, count(*) as cnt FROM commission_content_assets; SELECT 'commission_content_assets_published' as tbl, count(*) as cnt FROM commission_content_assets WHERE status = 'PUBLISHED'; SELECT 'site_audits' as tbl, count(*) as cnt FROM site_audits; SELECT 'direct_outreach_log' as tbl, count(*) as cnt FROM direct_outreach_log; SELECT 'direct_outreach_approved' as tbl, count(*) as cnt FROM direct_outreach_log WHERE human_approved = 1; SELECT 'direct_outreach_dispatched' as tbl, count(*) as cnt FROM direct_outreach_log WHERE dispatched = 1; SELECT 'referral_click_events' as tbl, count(*) as cnt FROM referral_click_events; SELECT 'referrals' as tbl, count(*) as cnt FROM referrals; SELECT 'owner_intake' as tbl, count(*) as cnt FROM owner_intake;"`
- **Timestamp:** 2026-11-10T12:14:48Z
- **Raw Output Excerpt:**
```text
commission_content_assets: 2
commission_content_assets_published: 2
site_audits: 3
direct_outreach_log: 38
direct_outreach_approved: 0
direct_outreach_dispatched: 0
referral_click_events: 8
referrals: 6
owner_intake: 0
```

- **Command:** `npx wrangler d1 execute prod-db --remote --command "SELECT 'revenue_records' as tbl, count(*) as cnt FROM revenue_records; SELECT 'transactions' as tbl, count(*) as cnt FROM transactions; SELECT 'proposals' as tbl, count(*) as cnt FROM proposals; SELECT 'payment_orders' as tbl, count(*) as cnt FROM payment_orders; SELECT 'automation_execution_log' as tbl, count(*) as cnt FROM automation_execution_log; SELECT 'cron_telemetry' as tbl, count(*) as cnt FROM cron_telemetry;"`
- **Timestamp:** 2026-11-10T12:15:10Z
- **Raw Output Excerpt:**
```text
revenue_records: 0
transactions: 0
proposals: 1
payment_orders: 2
automation_execution_log: 1207
cron_telemetry: 2
```
- **Interpretation:** `OBSERVED`. The live D1 database empirical counts match the Stage E reports:
  - 134 total deals / 133 in-stock / 50 monetizable
  - 52 partner offers / 52 active
  - 2 published guides in `commission_content_assets`
  - 38 outreach drafts / 0 approved / 0 dispatched
  - ₹0.00 verified revenue in `revenue_records` / 0 transactions.

---

## 4. Deal-to-Partner-Offer Integrity Evidence

- **Command:** SQL joins on `public_deals` and `partner_offers`:
  - Query 1 (Unmapped monetizable deals): `SELECT count(*) as cnt FROM public_deals d LEFT JOIN partner_offers o ON d.id = o.id WHERE d.is_monetizable = 1 AND o.id IS NULL;` -> `0` (`OBSERVED`)
  - Query 2 (Inactive matching offers): `SELECT count(*) as cnt FROM public_deals d JOIN partner_offers o ON d.id = o.id WHERE d.is_monetizable = 1 AND (o.active != 1 OR o.status != 'ACTIVE');` -> `0` (`OBSERVED`)
  - Query 3 (Orphaned active offers): `SELECT count(*) as cnt FROM partner_offers o LEFT JOIN public_deals d ON o.id = d.id WHERE o.active = 1 AND d.id IS NULL;` -> `1` (`CONFLICTING` - `off_boat_airdopes_141_gen2`)
  - Query 4 (Offers with unapproved/missing parent partners): `SELECT count(*) as cnt FROM partner_offers o LEFT JOIN partners p ON o.partner_id = p.id WHERE p.id IS NULL OR p.approval_status != 'APPROVED' OR p.authorization_status != 'AUTHORIZED';` -> `0` (`OBSERVED`)
  - Query 5 (Mismatched destination URLs): `SELECT count(*) as cnt FROM public_deals d JOIN partner_offers o ON d.id = o.id WHERE d.product_url != o.destination_url;` -> `0` (`OBSERVED`)
  - Query 6 (Invalid tracking URLs): `SELECT count(*) as cnt FROM public_deals WHERE is_monetizable = 1 AND (affiliate_url IS NULL OR (affiliate_url NOT LIKE '%linksredirect.com%' AND affiliate_url NOT LIKE '%clnk.in%'));` -> `0` (`OBSERVED`)
  - Query 7 (Duplicate destination URLs): `SELECT destination_url, count(*) as cnt FROM partner_offers WHERE active = 1 GROUP BY destination_url HAVING cnt > 1;` -> `1` (`CONFLICTING` - `https://www.boat-lifestyle.com/products/airdopes-141-gen2-wireless-earbuds` mapped to both `off_boat_airdopes_141_gen2` and `deal_boat_airdopes_141_gen2`).

---

## 5. Published Guide Affiliate-Link Audit Evidence

- **Command:** `npx wrangler d1 execute prod-db --remote --command "SELECT id, slug, title, primary_offer_id, matched_offer_ids_json, content_markdown FROM commission_content_assets;"`
- **Timestamp:** 2026-11-10T12:14:40Z
- **Findings:**
  - **Guide 1:** `guide_electronics_audio_wearables_2026` (`best-wireless-audio-smartwatches-india`)
    - Links in markdown: `https://clnk.in/D8C9` (boAt Rockerz 430), `https://clnk.in/D8Da` (boAt Airdopes Plus 221), `https://clnk.in/D8Dt` (Noise Kore), `https://clnk.in/D8Du` (Noise ColorFit Icon Rise Max).
    - All 4 deals exist in `public_deals` (`deal_4ea10ff4-5`, `deal_660e8e2f-1`, `deal_1f758bfb-7`, `deal_3d917061-8`) and `partner_offers`, and all are active/monetizable (`OBSERVED`).
  - **Guide 2:** `guide_student_flights_2026` (`student-flight-discounts-india`)
    - Links in markdown: `https://clnk.in/DKRM` (Air India Express), `https://clnk.in/DKX3` (Akasa Air), `https://clnk.in/DKX4` (Air India), `https://clnk.in/DKRN` (Cleartrip).
    - Status in D1: `NOT_OBSERVED` in `public_deals` and `NOT_OBSERVED` in `partner_offers`!
    - Bypasses internal click tracking routes (`/api/v1/public/deals/:id/redirect`); clicks are not logged in `referral_click_events` (`CONFLICTING`). Contains unbacked hardcoded tariff claims and penalty numbers.

---

## 6. Public Production Website Audit Evidence

Bounded Node.js Audit Script (`test-public-routes.mjs`) Results:
- **Timestamp:** 2026-11-10T12:22:00Z
- **Endpoint Audit Summary:**
  1. `/`: HTTP 200, Content-Type `text/html; charset=UTF-8`, canonical `https://ai-marketing-organization.onrender.com/`, title `Administrative Website & WhatsApp Inquiry Capture | AI Marketing Organization`. (`OBSERVED`)
  2. `/deals`: HTTP 200, Content-Type `text/html; charset=UTF-8`, canonical `https://ai-marketing-organization.onrender.com/deals`, title `Verified Deals & Price Evidence | Verified Deals & Price Evidence` (Double title defect `OBSERVED`).
  3. `/deals/{slug}`: HTTP 200, Content-Type `text/html; charset=UTF-8`, canonical `https://ai-marketing-organization.onrender.com/deals` (Does NOT point to the individual deal URL; returns SPA root shell `SPA_SHELL` without SSR deal metadata). (`CONFLICTING`)
  4. `/deals?dealId={id}`: HTTP 200, loads `/deals` page. (`OBSERVED`)
  5. `/guides/student-flight-discounts-india`: HTTP 200, SSR HTML rendered with title and canonical. (`OBSERVED`)
  6. `/guides/best-wireless-audio-smartwatches-india`: HTTP 200, SSR HTML rendered with title and canonical. (`OBSERVED`)
  7. `/compare/electronics-technology`: HTTP 200, title `Top Verified Electronics & Tech Deals & Buying Guide (2026) | #Ad`. (`OBSERVED`)
  8. `/sitemap.xml`: HTTP 200, Content-Type `application/xml; charset=utf-8`. (`OBSERVED`)
  9. `/rss.xml`: HTTP 200, Content-Type `application/rss+xml; charset=utf-8`. (`OBSERVED`)
  10. `/api/v1/public/feeds/deals.json`: HTTP 200, Content-Type `application/feed+json; charset=utf-8`. (`OBSERVED`)
  11. `/feeds/deals.json`: HTTP 301 -> redirects to `/api/v1/public/feeds/deals.json`. (`OBSERVED`)
  12. `/api/v1/cron/status`: HTTP 200, Content-Type `application/json`, reports `status: "STALE", heartbeatAgeMinutes: 81, recentPings24h: 0`. (`OBSERVED`)
  13. `/audit/capturelifedentalcare.com`: HTTP 200, HTML rendered with title and canonical. (`OBSERVED`)

---

## 7. Cron and Automation Execution Audit Evidence

- **A. Automation Execution Log:**
  - Total records: 1,207
  - Grouped by `trigger_source`:
    - `CLOUDFLARE_CRON`: 1,176 executions (`OBSERVED`)
    - `MANUAL_PING`: 31 executions (`OBSERVED`)
  - Grouped by `status`:
    - `COMPLETED`: 817
    - `NO_ACTION_DUE`: 348
    - `PARTIAL`: 26
    - `COMPLETED_NO_FINDINGS`: 9
    - `BLOCKED`: 7
- **B. Cron Telemetry & Automation Jobs:**
  - `cron_telemetry`:
    - Row `cloudflare_worker_cron`: `total_pings: 1128`, `last_observed_ping: "2026-11-10 11:00:45"`, `user_agent: "ai-marketing-cron-worker/1.0"`.
    - Row `manual_ping`: `total_pings: 5`, `last_observed_ping: "2026-11-10 10:50:45"`.
  - `automation_jobs`: 878 jobs (183 COMPLETED, 669 NO_ACTION_DUE, 15 QUEUED, 10 BLOCKED, 1 COMPLETED_NO_FINDINGS).
- **C. Reason for `/api/v1/cron/status` STALE and `recentPings24h: 0`:**
  - In `routes/api.ts` line 1363: `recentPings24h` queries `autonomous_cycle_log`. But `autonomous_cycle_log` has not been written to since 2026-11-03! Modern executions write to `automation_execution_log`. Thus `recentPings24h` returns 0.
  - Heartbeat status checks `(now - lastPingMs) < 75 * 60 * 1000`. At audit time, 81 minutes had elapsed since the 11:00:45 UTC ping (`heartbeatAgeMinutes: 81 > 75`), causing status to flip to `STALE`.

---

## 8. Workflow Output and Idle-Engine Audit Evidence

- **Total Registered Workflows:** 20
- **Row Counts in Output Tables:**
  - `stored_reports`: 0 (`NOT_OBSERVED`)
  - `market_experiments`: 0 (`NOT_OBSERVED`)
  - `healthcare_evidence_records`: 0 (`NOT_OBSERVED`)
  - `seasonal_festivals`: 0 (`NOT_OBSERVED`)
  - `owner_intake`: 0 (`NOT_OBSERVED`)
- **Idle Execution Analysis:** Workflows like `healthcare_claim_verification`, `daily_commercial_summary`, `competitor_pricing_research` were executed and marked `COMPLETED` in `automation_registry`, but wrote 0 durable rows to their corresponding output tables (`CONFLICTING`).

---

## 9. Outreach and Prospect Reality Check Evidence

- **Audit Script:** `test-prospect-websites.mjs` (38 HTTP GET probes using `Promise.allSettled` and `AbortSignal.timeout(5000)`).
- **Timestamp:** 2026-11-10T12:25:55Z
- **Findings:**
  - Total drafts in `direct_outreach_log`: 38
  - Human approved: 0 (`OBSERVED`)
  - Dispatched: 0 (`OBSERVED`)
  - Target websites returning HTTP 200: 30 / 38 (`OBSERVED`)
  - Target websites returning error/timeout: 8 / 38 (`apollowhitedental.com`, `vasandental.com` 403, `capitaldental.in`, `apexdentalcare.in` 403, `vaniinstitute.org` x2, `pratibhainstitute.in` x2) (`OBSERVED`)
  - Visible Contact Methods on Live Sites: All 30 responding websites display clear business contact channels (published business email, business phone, or contact form).
  - Code inspection of `/owner/direct-outreach`: Properly fails closed with HTTP 503 (`D1_QUERY_FAILED`) on D1 query exception (`OBSERVED`).

---

## 10. Provider Configurations Audit Evidence

- **A. Environment Variable Presence (Boolean Only):**
  - `CUELINKS_API_KEY`: PRESENT (boolean true)
  - `CUELINKS_CHANNEL_ID`: PRESENT (`331585`)
  - `TAVILY_API_KEY`: PRESENT (boolean true)
  - `GOOGLE_PAGESPEED_API_KEY`: PRESENT (boolean true)
  - `RAZORPAY_KEY_ID`: NOT PRESENT in live environment (SANDBOX mode)
  - `RAZORPAY_TEST_KEY_ID`: PRESENT (VERIFIED_TEST)
- **B. Cuelinks Read-Only Validation:**
  - Scopes: Verified through live runtime operations (`write:links`, `read:channels`).
  - Channel: `331585` APPROVED for `https://ai-marketing-organization.onrender.com`.
  - Attribution: Channel-scoped report confirmed (11 clicks, 0 transactions).
- **C. PageSpeed & Razorpay Code State:**
  - `GooglePageSpeedClient`: Implements 40 requests/day cap via `UnifiedQuotaService`, 24h cache in search_cache, dedicated `GOOGLE_PAGESPEED_API_KEY`, keyless fallback for 400/401/403 errors, zero synthetic metrics.
  - `RazorpayAdapter`: Enforces server-side deposit policies (₹500 consultation deposit, ₹15,000 setup fee, ₹8,000 monthly fee), strict D1 writes in production (`isProduction() && !process.env.VITEST`), webhook cryptographic verification, and strict payment ID validation (`pay_...` required, `plink_...` rejected).
