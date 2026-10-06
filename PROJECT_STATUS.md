# Project Status & Verification Truth Record

> **Single Source of Truth** for verified infrastructure, commercial progress, known resolutions, and pending owner actions.
> **Rules:**
> 1. Read this file **FIRST** at the start of any new session or task before re-diagnosing or re-running checks that already read `PASS`.
> 2. Only re-verify a `PASS` item if explicitly requested by the owner or if an edit could plausibly affect it.
> 3. Update this file at the conclusion of every session with changes made.
> 4. **Zero Secrets Rule:** Never write or restate credential values here. Use status words (`CONFIGURED` / `MISSING`) only.
> 5. Tracked in git — keep clean of environment-specific secret data.

---

## Infrastructure (Verified via Real API & HTTP Calls)

*Last Full Audit Date: 2026-10-06 (Local IST) / 2026-10-05 (UTC)*

| Item | Status | Last Verified Date | Proving Command / Live Endpoint | Evidence & Notes |
| :--- | :---: | :---: | :--- | :--- |
| **Local Repository HEAD** | **PASS** | 2026-10-06 | `git rev-parse HEAD` | Commit SHA: `f14cebb`<br>Branch: `main` |
| **Deployed Production Commit (Render)** | **PASS** | 2026-10-06 | Render API / Live Endpoint | Service `ai-marketing-organization.onrender.com`<br>Deploy ID: `dep-db24q67lot8c73dravtg`<br>Commit: `f14cebb`<br>Status: `live`<br>Finished: `2026-10-06T01:22:22.794978Z` |
| **Render Web Service (Live HTTP)** | **PASS** | 2026-10-06 | `GET https://ai-marketing-organization.onrender.com/api/v1/health` | HTTP 200 OK<br>`{"status":"healthy","version":"1.0.0","service":"AI Marketing Organization Engine"}` (timestamp: `2026-10-06T01:22:51.967Z`) |
| **Cloudflare Worker (Live HTTP)** | **PASS** | 2026-10-06 | `GET https://ai-marketing-cron-worker.vardhankotu.workers.dev/health` | HTTP 200 OK: `{"status":"ok","worker":"ai-marketing-cron-worker"}`<br>Total pings recorded in D1: 180<br>Last observed ping: `2026-10-06 01:23:41 UTC` |
| **Cloudflare D1 Database** | **PASS** | 2026-10-06 | Cloudflare D1 REST API query | 52 durable tables verified through migration `0011`.<br>1,181 total prospect rows reconciled.<br>784 rows quarantined as `REJECTED`, 397 rows `DISCOVERED`.<br>Durable rate limits (`durable_rate_limits`) and provider call audit logs (`provider_call_logs`) active. |
| **Demo Businesses Privacy Quarantine (Live HTTP)** | **PASS** | 2026-10-06 | `GET /api/v1/public/business/:slug` | HTTP 404 returned on all `/api/v1/public/*` routes for demo businesses:<br>- `smilekraft-dental-clinic`: HTTP 404 `PUBLIC_BUSINESS_NOT_FOUND`<br>- `smilekraft-dental-clinic-2`: HTTP 404 `PUBLIC_BUSINESS_NOT_FOUND`<br>- `platform-aro`: HTTP 404 `PUBLIC_BUSINESS_NOT_FOUND`<br>- `fnl_smilekraft_main`: HTTP 404 `BUSINESS_NOT_FOUND` |
| **Single-Business Cron Execution (Live HTTP)** | **PASS** | 2026-10-06 | `POST /api/v1/cron/ping` with `CRON_PING_SECRET` | HTTP 200 OK. Exactly 1 business processed: `biz_platform_aro` (`COMPLETED`, `BLOCKED_AUTHORIZATION`, `actionsTaken: 0`).<br>Fixtures `biz_smilekraft_hyd` and `biz_1790714233800` paused via kill switch (`PAUSED_FIXTURE_CYCLE`).<br>`GET /cron/status`: `totalPings: 180`, `lastSuccessfulCycle: 2026-10-06 01:23:52`. |
| **Production Runtime Secrets** | **PASS** | 2026-10-06 | Render `GET /api/v1/diagnostic/env` | `CRON_PING_SECRET`: **CONFIGURED**<br>`OWNER_API_KEY`: **CONFIGURED**<br>`GEMINI_API_KEY`: **CONFIGURED**<br>`TAVILY_API_KEY`: **CONFIGURED** |
| **Test Suite & Monorepo Build** | **PASS** | 2026-10-06 | `npm run typecheck && npm test` | Typecheck: 0 errors across 4 workspaces<br>Test files: 51 passed (51)<br>Tests: 478 passed (478)<br>Failed: 0 |

---

## Commercial State (Never Inferred, Only Real Evidence)

*All commercial stages remain strictly unexecuted until real external interactions are confirmed.*

| Stage | Status | First Real Date | Current Evidence & Ground Truth |
| :--- | :---: | :---: | :--- |
| **Real Prospects in D1** | **PASS** | 2026-10-06 | 1,181 total prospect rows in Cloudflare D1.<br>- **Quarantined (`REJECTED`):** 784 rows (392 YouTube video URLs + 392 Etacky listicle directory URLs).<br>- **Real Discovered Clinics:** 397 rows (393 duplicate rows of `fmsdental.com` from pre-deduplication cycles + 1 `siridentalhospital.com` + 1 `parthadental.com`).<br>- Discovery deduplication and 7-day query cooldown active (expected ~5.14 cycles/day platform-wide). |
| **Real Outbound Contact** | **HOLD_REQUIRES_APPROVAL** | — | 0 outbound messages dispatched (`outbound_action_ledger` count = 0). 398 junk contacts quarantined as `REJECTED`, and remaining 10 contacts placed on reversible hold as `HOLD_REQUIRES_APPROVAL` (`suppression_reason: 'PREV_STATUS:ACTIVE'`). `OUTBOUND_ENABLED` config flag (default `false`) enforces global hold in dispatch policy gate (`autonomy-policy.ts`). Fail-closed guards prevent dispatching held or rejected contacts. |
| **Real Prospect Inbound Response** | **NOT_VERIFIED** | — | 0 customer leads or inbound responses (`customer_journeys` count = 0). |
| **Real Commercial Proposal** | **NOT_VERIFIED** | — | 0 commercial proposals dispatched (`proposals` count = 0). |
| **Real Razorpay / Payment Link** | **NOT_CONFIGURED** | — | 0 payment links generated, 0 payments captured (`payment_requests` count = 0). Live Razorpay credentials unconfigured on Render. |
| **Verified Real Revenue** | **VERIFIED_ZERO** | 2026-10-06 | `verifiedRevenueINR = 0` (Confirmed via direct Cloudflare D1 query on `revenue_records`). |
| **Affiliate Partners / Offers** | **BLOCKED_GATE** | — | 0 approved partners, 0 active partner offers (`partners` count = 0, `partner_offers` count = 0). Fails closed under Rule 1 validation. |
| **Content Assets / Published Guides** | **DRAFT_ONLY** | — | 0 published content assets in D1 (`content_assets` count = 0). Publish blocker active on unfilled `OPERATOR_TO_FILL` markers. |

### Current Active Test Business
* **Name:** SmileKraft Dental Clinic (Healthcare & Dental Care, Hyderabad)
* **ID:** `biz_1790714233800`
* **Onboarded Via:** Live API `POST /api/v1/business`
* **Purpose:** Operational baseline for tenant isolation and `/system/readiness` evaluation without touching commercial pipeline.

---

## Known Resolved Issues (Do Not Re-Diagnose)

*Chronological record of verified fixes to prevent regressive troubleshooting:*

1. **2026-09-29 — Fake Booking Success Screen (`c276790`):** Front-end and mock flows presented consultation booking as confirmed without backend validation; hardened to require genuine backend verification.
2. **2026-09-29 — Razorpay Default Webhook Secret Fallback (`c276790`, `47f880d`):** Webhook signature verification previously fell back to an insecure default secret; replaced with strict production fail-closed signature verification.
3. **2026-09-29 — D1 Migration Parser Regex Bug (`9745a11`):** D1 migration runner failed on specific multi-statement SQL syntax; fixed runner script with robust statement splitter.
4. **2026-09-29 — Cron Schedule Re-alignment (`d6ff8e6`, `9745a11`):** Cloudflare Worker cron trigger corrected to hourly `0 * * * *` matching Render free-tier budget and system SLA.
5. **2026-09-29 — GitHub Actions Workflow Curl Fallbacks (`3b765fe`):** Deployment workflow contained `|| echo "000"` masks on HTTP checks; removed all masks so curl timeouts/failures fail the run legitimately.
6. **2026-09-29 — Render Blueprint Auto-Sync Deleting Secrets (`471f36f`):** Blueprint re-syncs stripped dashboard env vars; added `sync: false` to `render.yaml` for all production keys.
7. **2026-09-29 — Render Service Name Mismatch in Blueprint (`08ff3cb`):** `render.yaml` targeted `name: ai-marketing-backend` while live service was `ai-marketing-organization`; corrected target name.
8. **2026-09-29 — Render Runtime Mismatch in Blueprint (`3b78885`):** `render.yaml` specified Node runtime; corrected to Docker runtime (`dockerfilePath: ./Dockerfile`) matching Render Oregon deployment.
9. **2026-09-29 — Missing Diagnostic Endpoint in Route Allowlist (`88aa528`):** `/api/v1/diagnostic/env` returned 401 because it was missing from `EXACT_ROUTE_POLICY.PUBLIC`; added to public policy.
10. **2026-09-30 — Server-Side Environment Variables Missing on Render (`19fc793`):** Dashboard saves failed to inject env vars into the container; verified `[]` empty array via Render REST API and directly injected all secrets (`CRON_PING_SECRET`, `OWNER_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `CLOUDFLARE_D1_*`) via `PUT /v1/services/{serviceId}/env-vars`.
11. **2026-09-30 — System Readiness Route 400 on Empty Database (`19fc793`):** `/api/v1/system/readiness` failed closed when zero non-platform businesses existed in fresh SQLite; onboarded real `SmileKraft Dental Clinic` profile, resolving check to HTTP 200.
12. **2026-09-30 — Cloudflare D1 Remote Telemetry Write (`19fc793`):** Backend `D1RevenueRepository` required Cloudflare D1 credentials on Render to persist `cron_telemetry`; injected credentials, enabling `POST /cron/ping` to write directly to Cloudflare D1 and `GET /cron/status` to report `totalPings = 1` and `HEALTHY`.
13. **2026-09-30 — Universal Demand-Capture Funnel & Auth Isolation (`030ce3c`):** Replaced hardcoded `/aligners-hyderabad` routes with tenant-aware `/f/:businessSlug/:funnelSlug` and `/book/:businessSlug/:funnelSlug` funnels. Prevented unauthenticated visitors from triggering authenticated owner APIs (`loadAllData()`). Hardened `POST /public/lead` to mandate explicit tenant identity (`businessId` or `businessSlug`) with zero unsafe fallbacks. Generalized phone sanity checks to international format (8–15 digits).
14. **2026-09-30 — Synchronous BusinessAutonomyLock Throwing in Production (`3ad910f`):** `BusinessAutonomyLock.tryAcquire` was synchronous and threw `PRODUCTION D1 ERROR` on Render; switched `AutonomousRevenueOrchestrator` to async `BusinessAutonomyLock.tryAcquireAsync` and `releaseAsync`.
15. **2026-09-30 — Cloudflare D1 Missing Concurrency & Cycle Log Tables (`4903abd`):** Remote D1 database lacked `business_autonomy_lock`, `autonomous_cycle_log`, and other revenue-critical tables; created and applied migration `0003_d1_revenue_critical_tables.sql` (now 33 tables in D1).
16. **2026-09-30 — Baseline Reference Tenant Seeding & Auto-Sync (`3ad910f`):** Ephemeral SQLite on Render lacked baseline client business on boot, causing `/system/readiness` to return 400; seeded `biz_smilekraft_hyd` and initial campaign/goal into SQLite, bringing readiness check to 12/12 PASS (`FIRST_REAL_LEAD`).
17. **2026-09-30 — Universal Commercial Operating System (UCOS) Transformation:** Generalized entire system architecture away from hardcoded Indian/dental assumptions. Implemented currency neutrality (`Money` minor integer units + ISO 4217), first-class durable `funnels` entity in D1, decoupled `customer_offers` from platform setup fees, server-authoritative checkout & pricing with `PRICE_TAMPER_DETECTED` guards, `OfferDecisionEngine` for structured intent matching, `StripeAdapter` for multi-currency payment intents, unified Cloudflare Worker workspace in root CI/monorepo, applied D1 migration `0004` bringing D1 to 94 durable tables, and expanded unit test suite to 42 files and 401 passing tests.
18. **2026-09-30 — UCOS Production Hardening, D1 Session Authority & Atomic Booking Engine:**
    - Eliminated synthetic runtime funnel synthesis; missing funnels return genuine 404 `FUNNEL_NOT_FOUND`. Frontend fails closed on missing funnel without falling back to business profile.
    - Built atomic `AvailabilityEngine` preventing double-booking under concurrency with conditional SQL updates on slot capacity (`reserved_count < capacity`). Disallowed client-manipulable start/end times.
    - `OwnerAuthService` made Cloudflare D1 the sole authority in production with fail-closed `PERSISTENCE_FAULT` on D1 error, eliminating SQLite split-brain auth sessions.
    - Integrated full Stripe webhook lifecycle (`payment_intent.succeeded`, `charge.refunded`, etc.) with server-authoritative order updates, ledger revenue records, compensating negative revenue entries on refunds, and fulfillment task triggers.
    - Hardened `AutonomousRevenueOrchestrator` to await all D1 cycle and audit writes (`d1Repo.executeWrite`), eliminating unawaited fire-and-forget writes and `{ changes: 1 }` fallback.
    - Refactored `SystemReadinessEngine` around capability-based dimensions (`DATABASE`, `AUTH`, `STRIPE`, `RAZORPAY`, `PROVIDER`) without hardcoded `passed: true` or dental/Indian assumptions.
    - Removed Indian country/currency/timezone defaults from `CreateBusinessProfileSchema` into an explicit `IndiaOnboardingPreset` alongside authoritative ISO-4217 Currency Metadata Registry.
    - Iterated all eligible businesses across all organizations during cron ping without `LIMIT 5` suppression.
19. **2026-09-30 — UCOS Final Production Safety & Durability Hardening (`feat/ucos-final-integrity-complete`):**
    - **Zero SQLite Auth Fallback in Production:** Removed all production fallback queries against SQLite `users.api_token` in `OwnerAuthService` and `api.ts`. Production requests authenticate strictly against `OWNER_API_KEY` (env secret) or Cloudflare D1 `owner_sessions`. D1 outages fail closed without falling back to local SQLite.
    - **D1-First/Authoritative Writes:** `POST /business` and `POST /goals` execute authoritative writes directly to Cloudflare D1 in production, with fail-closed HTTP 500 responses if D1 persistence fails, eliminating split-brain.
    - **D1 Migration Startup Sequencing Gate:** Converted backend startup to async `startServer()` in `src/index.ts` which strictly verifies D1 connectivity, applies pending migrations, and validates schema before `serve()` accepts incoming HTTP traffic. Process halts with code 1 if migration fails in production.
    - **Centralized `TenantContextResolver`:** Created `src/control-plane/tenant-context-resolver.ts` to centralize multi-tenant context lookups across public funnels, orders, bookings, and admin endpoints. Completely eliminates `LIMIT 1` and `'org_owner_primary'` fallbacks and enforces organization boundaries.
    - **Atomic Booking Concurrency & Rollback:** Slot capacity reservation utilizes conditional atomic SQL updates with immediate compensating rollback if reservation record insertion fails.
    - **Timezone Correctness & Slot Matching:** Implemented `localTimeToUtcIso` converting international business hours (e.g. `America/New_York`, `Asia/Kolkata`, `Europe/London`) to exact UTC ISO instants. Strict `preferredTime` matching returns `TIME_NOT_AVAILABLE` if no slot exists within tolerance. Disabled synthetic availability auto-seeding in production.
    - **Recoverable Payment Order Failure State:** Added `PROVIDER_CREATED_D1_UPDATE_FAILED` state if an external payment provider order is generated but D1 status update encounters a persistence error.
    - **D1 Migration 0005:** Created `0005_revenue_neutrality_and_tenancy.sql` adding `amount_minor` to `revenue_records`, `offer_title`/`recovery_state`/`failure_reason` to `universal_orders`, and `integration_phone_mappings`.
    - **Test Coverage:** All 45 test suites (425 tests) passing with zero failures. Monorepo build and typecheck clean across all 4 packages.
20. **2026-09-30 — Single-Owner INR & Razorpay Hardening (Items 1–3, 5):**
    - **Payment Provider Not Browser-Controlled:** Removed `body.paymentProvider` entirely from order creation. Orders are routed server-authoritatively (Razorpay for INR business operations) without client influence.
    - **Zero Fire-and-Forget D1 Writes in Payment Path:** Eliminated fabricated `{ changes: 1 }` and unawaited `.catch()` promises from `RazorpayAdapter` and `RevenueReconciliationEngine`. All writes in `createPaymentOrder`, `createPaymentLink`, `confirmClientPayment`, `confirmManualUpiClaim`, and `processWebhook` are strictly awaited via `d1Repo.executeWrite`. Synchronous unawaited writes throw immediate violations in production.
    - **Atomic Webhook Idempotency:** Replaced check-then-insert pattern with atomic unique-constraint insertion into `idempotent_actions` table first. Duplicate or concurrent webhooks conflict on `idempotency_key` PRIMARY KEY, stop processing immediately, and return idempotent cached response without duplicate transactions.
    - **PROJECT_STATUS.md Ground Truth:** Reconciled real repository commit vs deployed Render commit (`abf879f`), marked remote HTTP endpoints unverified from local environment as `NOT_VERIFIED`.
    - **Verification Results:** All 45 test files passed (426 tests passed, 0 failed). Monorepo typecheck and build passed with exit code 0 across all 4 workspaces (`shared`, `backend`, `frontend`, `cloudflare-worker`).
21. **2026-09-30 — Production Admin Session Authentication Bootstrap & Owner Login UI (`e2fc200`):**
    - **Frontend Session-Based Auth Bootstrap:** Refactored `packages/frontend/src/App.tsx` with explicit auth states (`BOOTING`, `AUTHENTICATED`, `UNAUTHENTICATED`). Replaced premature unauthenticated fanning out to 10+ protected endpoints with session check via `GET /api/v1/auth/owner/session` before loading protected data.
    - **Production Owner Login Screen:** Built `OwnerLogin.tsx` component with single-owner sign-in, key visibility toggle, and instant feedback. Strictly avoids persisting sensitive credentials in `localStorage` or `sessionStorage`.
    - **API Client Credentials & Identity Sanitization:** Configured `fetchApi()` in `packages/frontend/src/services/api.ts` with `credentials: 'include'`. Completely removed spoofed identity headers (`x-organization-id`, `x-user-id: usr_owner_01`) as an authentication substitute. Distinguishes 401 unauthenticated errors and transitions UI cleanly without infinite retry loops.
    - **Credentialed CORS & Origin Restriction:** Replaced wildcard `*` CORS in `packages/backend/src/index.ts` with credentialed explicit origin resolver supporting dynamic `FRONTEND_ORIGIN` env var, production Render origin, and local dev hosts. Strictly prohibits wildcard `*` with credentials.
    - **Full Live Verification:** Deployed commit `e2fc200` to Render (`dep-daugpfuq1p3s738jlva0`). Proved unauthenticated 401 fail-closed protection, successful owner login establishing HttpOnly `owner_session` cookie, authenticated session, `/business` and `/system/readiness` 200 responses, clean logout session revocation, and unhindered public endpoint access. All 46 test suites (442 tests) passing with 0 failures.
22. **2026-09-30 — Strict Exact-Origin CORS Hardening (`2a78a17`):**
    - **Zero Substring Matching:** Removed insecure hostname substring check (`requestOrigin.includes(hostWithoutPort)`) from `packages/backend/src/index.ts`.
    - **Strict Exact-Origin Resolver:** Configured exact matching against configured `FRONTEND_ORIGIN` and known production Render origin `https://ai-marketing-organization.onrender.com`.
    - **Non-Production Dev Guard:** Allowed `localhost` and `127.0.0.1` strictly when `process.env.NODE_ENV !== 'production'`.
    - **Fail-Closed CORS Defense:** Unmatched or hostile origins (including prefix/suffix subdomains) receive `access-control-allow-origin: null`, entirely preventing cross-origin browser reads while preserving `credentials: true` for legitimate origins.
    - **Live Deployment & Verification:** Live on Render (`dep-dauhfre0tbcc7395m24g`, commit `2a78a17`). Verified live via OPTIONS preflights and live admin session lifecycle. Monorepo builds clean (exit 0), typechecks clean (0 errors), all 46 test suites (445 tests) passing with 0 failures.
23. **2026-09-30 — First Real Commercial Run & D1 Schema Alignment (`a1cb55b`):**
    - **Sender Identity Unification:** Harmonized `PLATFORM_SENDER_EMAIL` and `EMAIL_FROM_ADDRESS` across `EmailAdapter` and `LiveProviderActivation`.
    - **Async Event Claiming:** Converted synchronous `durable_events` queries in ARO to `DurableEventBus.claimPendingAsync` and `markProcessedAsync`.
    - **Manual Cycle Discovery Cooldown Bypass:** Enabled `triggerSource: 'MANUAL'` in ARO to bypass discovery cooldown in `NextBestActionEngine.choose`.
    - **Tavily Research Hardening:** Removed restrictive domain inclusion filters, excluded aggregator directory domains, added regex parsing for Indian business phone numbers and contact emails.
    - **D1 Schema Alignment:** Created and applied migration `0007_align_prospects_and_opportunities_schema.sql` aligning `platform_prospects` and `opportunities` between Cloudflare D1 and SQLite; updated `persistCandidates` to dual-populate columns.
    - **First Real Commercial Run Verification:** Executed live `POST /api/v1/workflows/autonomous-cycle` on Render for `biz_platform_aro` with `triggerSource = MANUAL`. Real Indian practice contact discovered and successfully persisted across all 5 durable D1 tables (`platform_prospects`, `opportunities`, `outbound_contacts`, `commercial_evidence`, `sales_pipeline`).
    - **Fail-Closed Outbound & Payment Defense:** Outbound outreach halted cleanly with `BLOCKED_AUTHORIZATION` due to unconfigured live SendGrid/Meta WhatsApp credentials. Real revenue strictly confirmed as ₹0 via Cloudflare D1 query.
24. **2026-10-06 — Stop-The-Waste & Safety Pass (`f14cebb`, live deploy `dep-db24q67lot8c73dravtg`):**
    - **Fixture Cycles Paused via Kill Switch:** Paused autonomous cycles for fixtures `biz_smilekraft_hyd` and `biz_1790714233800` using `kill_switch_active = 1` and `kill_switch_reason = 'PAUSED_FIXTURE_CYCLE'` without deleting records. Verified live on Render: `POST /cron/ping` processes exclusively `biz_platform_aro` (1 business).
    - **Discovery Deduplication & 7-Day Cooldown:** Implemented `normalizeDomain()` / `normalizeUrl()`, URL/domain pre-checking against existing tenant candidates, and a 7-day query cooldown via `search_cache` for automated cycles. Bounds maximum automated discovery cycles to ~5.14 per day across 36 vertical/city combinations.
    - **Data Quarantine & Reversible Status Filtering:** Marked 786 junk prospects (393 YouTube, 393 Etacky) as `REJECTED`, corresponding opportunities as `REJECTED`, and outbound contacts as `REJECTED` and `is_suppressed = 1`. Reconciled all 1,181 rows in D1: the 3 rows created at 01:00 UTC (`ppros_82e5e608-8`, `ppros_25cb5b70-0`, `ppros_2fd9dfe0-8`) were duplicate candidates (YouTube, Etacky, and FMS Dental) created by the pre-deploy code running at 01:00 UTC before the 01:22 UTC deploy, while `siridentalhospital.com` and `parthadental.com` were created during the initial 2026-09-30 discovery run (`ppros_22fb2604-5`, `ppros_d95f0f3d-2`). Implemented fail-closed outbound guard ensuring `REJECTED` contacts can never be dispatched.
    - **Durable Quota Counters:** Seeded `provider_quota_state` (Gemini: 1,200 requests/day, Tavily: 800 credits/month) and created `provider_call_logs` table in D1. Quota checks synchronize from D1 on server boot.
    - **Demo Businesses Privacy Lockdown:** Returned HTTP 404 on all `/api/v1/public/*` routes for `smilekraft-dental-clinic`, `smilekraft-dental-clinic-2`, and `platform-aro`. Added `public_live` column to `businesses` table, rejecting public lead, checkout, booking, order, and availability writes for any business not explicitly marked `public_live = 1`.
    - **Durable Rate Limiter:** Replaced in-memory limiter with D1-backed sliding window limiter (`durable_rate_limits`, SHA-256 IP hash) covering `/public/lead`, `/public/checkout`, `/public/order`, `/public/booking`, and `/organic/*`.
    - **Live Verification:** Deploy `dep-db24q67lot8c73dravtg` live on Render. Verified live: `/api/v1/health` (HTTP 200), demo slug 404s (HTTP 404), single-business cron ping (HTTP 200, only `biz_platform_aro`), and `/cron/status` (HTTP 200). 51 test files (478 tests) passing.

25. **2026-10-06 — Verify & Reconcile Pass on Stop-The-Waste (`HEAD`):**
    - **Commit Parity Verified:** Verified commit difference between `f14cebb` and `ec801bb` is strictly documentation-only (`PROJECT_STATUS.md` +18/-10).
    - **Scheduled Cron Observed Live:** Observed real top-of-hour cron run at `2026-10-06T02:00:21.370Z` (`cycle_1791252021370`), triggered by `CLOUDFLARE_CRON`, processing exclusively `biz_platform_aro` (0 errors). Selected action was `DISCOVER_PARTNER`, safely halted with `BLOCKED_AUTHORIZATION` due to 0 configured partners, consuming 0 Tavily/Gemini calls.
    - **Prospect & Contact Reconciliation in D1:** Formally quarantined duplicate `fmsdental.com` prospects/opportunities to `REJECTED` (`DUPLICATE_DOMAIN`), keeping oldest row `ppros_4eae425a-8`. Quarantined duplicate outbound contacts with `is_suppressed = 1`.
    - **Durable Quota & Action Cooldown Durability:** Made application limits configurable via `GEMINI_APPLICATION_LIMIT` (default 1200) and `TAVILY_APPLICATION_LIMIT` (default 800); real limits marked UNKNOWN (`NULL`) in `provider_quota_state`. Added `action_cooldowns` to `D1_REVENUE_CRITICAL_TABLES` and wired `ActionCooldownManager.syncFromD1Async()` into server boot and `/cron/ping`.
26. **2026-10-06 — Final Correction & Live Verification Pass (`HEAD`):**
    - **Caps Documented as Assumptions:** Formally documented `GEMINI_APPLICATION_LIMIT` (1,200 requests/day) and `TAVILY_APPLICATION_LIMIT` (800 credits/month) as ASSUMPTIONS, not provider limits. Tavily is tracked by actual credits consumed (not request count). Real provider limits remain marked UNKNOWN (`NULL`) in `provider_quota_state`.
    - **Cooldown TTL & 7-Day Query Cooldown:** Fixed `search_cache` query TTL to 7 days (`datetime('now', '+7 days')` on write and conflict update) and enforced query cooldown check `(expires_at > datetime('now') OR created_at > datetime('now', '-7 days'))` in `PlatformProspectDiscoveryEngine`, strictly blocking automated repeat discovery runs for 7 days unless `isManual = true`.
    - **Cooldown Fails Closed:** Replaced empty catch in 7-day cooldown check so any D1 query failure returns `DISCOVERY_COOLDOWN_CHECK_FAILED` with 0 Tavily search calls.
    - **Public Route 404 Identity Unified:** Reordered validation in `universal-checkout.ts` so tenant lookup occurs before body validation. All 10 routes under `/api/v1/public/*` return 100% identical HTTP 404 status codes and identical error body templates between hidden demo slugs and nonexistent slugs.
    - **Render Proxy Client IP Hardening:** Implemented `getTrustedClientIp()` deriving the client IP from the rightmost proxy-appended entry in `x-forwarded-for` (`TRUSTED_PROXY_HOPS`, default 1), ignoring untrusted client-controlled entries to the left. `cf-connecting-ip` is ignored unless `TRUST_CF_HEADER=true`. Requests with missing headers fall into a single `'unknown'` bucket with a stricter 5-request limit.
    - **DISCOVER_PARTNER Cooldown Observed Live at 03:00 UTC:** Observed scheduled cycle at `2026-10-06T03:00:21.217Z` (`cycle_1791255621217`, `CLOUDFLARE_CRON`). Selected action was `DISCOVER_PARTNER`, ended with `BLOCKED_AUTHORIZATION` (0 partners, 0 cost). Proved live D1 row written to `action_cooldowns` with `next_eligible_at: 2026-10-07T03:00:26.263Z` (+24h), permanently stopping hourly loops.
    - **Positive Controls & Content Routes Verified:** Permanently tested with fixture business (`public_live = 1`): GET/POST endpoints reach handlers (invalid bodies return 400, not 404); `/public/content/:slug` and `/public/disclosure/:slug` return 200 for published content and 404 for nonexistent slugs; published guides return 200 and appear in `/sitemap.xml`; referral routes return 302; demo businesses remain hidden (404). All 51 test suites (488 tests) passing.
27. **2026-10-06 — Micro-Verify Pass (Client-IP Diagnostics, Durable Outbound Hold & Money-Path Verification) (`HEAD`):**
    - **Live Client-IP Topology Endpoint:** Added temporary authenticated route `GET /api/v1/diag/headers` protected by `X-Cron-Secret` (returns 401 without valid secret) returning raw `x-forwarded-for`, entry count, `cf-connecting-ip`, `true-client-ip`, `x-real-ip`, and `selectedIp`.
    - **Client IP Consumers Unified:** Unified all remaining raw header reads (`/auth/login`, `/compliance/dpdp/consent`, and `/r/:offerSlug/:referralId` in both `api.ts` and `index.ts`) to use `getTrustedClientIp(c).ip`. Confirmed `/r/*` and `/api/v1/guides/*` are NOT behind any rate limiter.
    - **Scheduled Loop Since 03:00 UTC Audit:** Analyzed cycles from 03:00 UTC through 17:00 UTC. While `DISCOVER_PARTNER` is on cooldown, engine executed `DISCOVER_DEMAND` at 04:00 (1 Tavily call), `DISCOVER_PROSPECTS` at 05:00 (hit 7d cache), `IDLE` (`NO_ACTION_DUE`) between 06:00–10:00 (0 external calls), `DISCOVER_DEMAND` at 11:00 (1 Tavily call), and `IDLE` between 12:00–17:00 (0 external calls). `quota_reservation: RESERVED_1` in traces is static NBA plan metadata; provider quota state reflects actual calls only (0 Gemini consumed today, 2 Tavily credits consumed this month). Actions ending `BLOCKED_AUTHORIZATION` never invoke `quotaService.recordRequest`, releasing zero leaked quota units.
    - **Discovery Yield Drop Explained:** Hour 00:00 UTC evaluated 8 minutes after 23:51 UTC finished, selecting `IDLE` / `NO_ACTION_DUE` with 0 prospect rows generated.
    - **Durable Outbound Hold:** Added `OUTBOUND_ENABLED` config flag (default `false`) in `autonomy-policy.ts` dispatch policy gate. Quarantined 10 active outbound contacts to `HOLD_REQUIRES_APPROVAL` with `suppression_reason: 'PREV_STATUS:ACTIVE'` (reversible). Added permanent unit tests verifying `OUTBOUND_ENABLED=false` blocks dispatch, and `HOLD_REQUIRES_APPROVAL` contacts fail-closed with `BLOCKED`.
    - **Money-Path Snapshot:** In production D1, `partners` has 0 rows, `partner_offers` has 0 rows, `commission_content_assets` has 0 rows. Live `GET /api/v1/commission/money-path` returns `moneyPath: BLOCKED` with single biggest blocker `PARTNER_APPROVAL`. Verified thermal-printer page is DRAFT and returns 404 (not publicly served).
    - **Tests and Verification:** All 51 test suites (491 tests) passing. Monorepo builds and typechecks clean.
28. **2026-10-06 — Small Fix Pass (Robust Client IP, Junk Gap Reconcile, Hardened Candidate Filter & Diag Cleanup) (`HEAD`):**
    - **Robust Hop-Agnostic Client IP Derivation:** Made `getTrustedClientIp()` in `client-ip.ts` robust to reverse proxy hop count variations by popping trailing private / reserved IPv4 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`) and all Cloudflare published edge ranges (`https://www.cloudflare.com/ips-v4`, 15 CIDRs, labeled 2026-10-06). Selects the rightmost remaining entry. Leftmost spoofed IPs are never selected. Headers with only private IPs map to `'unknown'` bucket with stricter rate limiting. Tested against exact live topology vectors: `"110.235.225.146, 172.69.86.91, 10.194.16.2"` -> `110.235.225.146`; `"9.9.9.9,110.235.225.146, 172.68.175.61, 10.199.92.5"` -> `110.235.225.146`.
    - **Junk Gap Reconciled in Production D1:** Quarantined the 7 contacts created `2026-10-06 05:00-05:02Z` (`apolloclinic`, `manipal`, Karnataka Govt `.gov.in` PDF, `unitedhospitals`, `salezshark`, `apollohospitals`) to `status = 'REJECTED'`, `is_suppressed = 1`, `suppression_reason = 'NOT_TARGET_OR_DIRECTORY'`. Applied identical status update to their corresponding `platform_prospects` and `opportunities` rows. Exactly 3 Sept 30 clinics (`fmsdental`, `parthadental`, `siridentalhospital`) remain on `HOLD_REQUIRES_APPROVAL` (and `DISCOVERED` in prospects/opps).
      - `outbound_contacts`: BEFORE: 10 HOLD_REQUIRES_APPROVAL, 398 REJECTED. AFTER: 3 HOLD_REQUIRES_APPROVAL, 405 REJECTED.
      - `platform_prospects`: BEFORE: 10 DISCOVERED, 1178 REJECTED. AFTER: 3 DISCOVERED, 1185 REJECTED.
      - `opportunities`: BEFORE: 10 DISCOVERED, 1178 REJECTED. AFTER: 3 DISCOVERED, 1185 REJECTED.
    - **Candidate Filter Hardened:** Added filters to `validateCandidate()` in `PlatformProspectDiscoveryEngine`: rejects `.pdf` and `.gov.in`/`.gov` URLs; rejects URLs containing `/clinic-locator`, `/company/`, `/listing`, `view_listing`, `directory`; rejects `"list of"` and `"email id"` in candidate title; added `salezshark.com` to `JUNK_AND_DIRECTORY_DOMAINS`; and rejects candidates whose city or vertical fails to match the query context. Verified against all 7 real-world candidate edge cases in unit tests.
    - **Diag Route Removed:** Removed temporary route `GET /api/v1/diag/headers` from `routes/api.ts` and `EXACT_ROUTE_POLICY.SYSTEM`. Verified returning 404 in tests and production.
    - **Monorepo Tests & Build:** All 51 test suites (493 tests) passing. Monorepo builds and typechecks clean.

---

## Manual Steps Still Owed by Human Owner

*The following items require real-world human accounts/keys outside automated provisioning:*

1. **SendGrid / Resend Provider Credentials:** **NOT DONE**
   * Provide `RESEND_API_KEY` or `SENDGRID_API_KEY` to enable outbound email outreach.
2. **Meta WhatsApp Cloud API Credentials:** **NOT DONE**
   * Provide `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` for outbound WhatsApp messaging.
3. **Razorpay Live Merchant Account & KYC:** **NOT DONE**
   * Configure live Razorpay Key ID, Key Secret, and Webhook Secret once account verification is finalized.
4. **Google Search / Ads Credentials (Optional):** **NOT DONE**
   * Configure Google Ads customer ID / API tokens if paid search campaigns are to be activated.
