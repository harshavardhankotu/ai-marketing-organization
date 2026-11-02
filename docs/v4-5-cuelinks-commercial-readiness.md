# V4.5 — Cuelinks Commercial Readiness & API Contract Specification

**Document Version:** 4.5.0  
**Status:** PRODUCTION READY & VERIFIED  
**Audited Base:** Commit `bc214b3` / PR #33 (`feat/v4-2-multi-sector-commerce-recovery`)  
**Network Provider:** Cuelinks V3 API  
**Integration Status:** Commercial Core Active, Resilient Checkpointed, Rule 10 Enforced  

---

## 1. Executive Summary & The "Scope Contradiction" Resolution

### 1.1 The Production Anomaly
In previous audit reports, production telemetry recorded:
```json
{
  "cuelinksConnected": true,
  "apiKeyConfigured": true,
  "hasScopes": false,
  "permissionStatus": "CONDITIONAL"
}
```
This created a apparent contradiction: Cuelinks was authenticated and returning live campaign data, yet the status reported `hasScopes: false`.

### 1.2 Root Cause Analysis
Detailed inspection of `packages/backend/src/commission/cuelinks-v3-client.ts` revealed the root cause:
1. **Monolithic Scope Check:** The client had defined an all-or-nothing check requiring 6 distinct scopes:
   - `read:campaigns` (Supported via `/campaigns`)
   - `read:offers` (Supported via `/offers`)
   - `write:links` (Supported via `/links`)
   - `read:channels` (Supported via `/channels`)
   - `read:reports` (Supported via `/reports`)
   - `read:invoices` (Dashboard-only feature; returns HTTP 403 on API tokens)
2. **The Blocker:** Standard Cuelinks Publisher API tokens provide programmatic access to campaigns, offers, link conversions, channels, and transactions. However, **`read:invoices` is not granted to programmatic API tokens** by Cuelinks; publisher invoices are managed exclusively via the publisher web dashboard.
3. **Resolution Implemented in V4.5:**
   We decoupled the scope evaluation in `packages/backend/src/commission/cuelinks-v3-client.ts` into:
   - **`Core Commercial Scopes` (Active & Validated):** `read:campaigns`, `read:offers`, `write:links`, `read:channels`, `read:reports`.
   - **`Dashboard Scopes` (Manual / Non-Blocking):** `read:invoices`.
   The system now correctly marks `commercialReadiness: READY` when the core commercial scopes succeed, eliminating false blockers while alerting the owner that invoice downloads remain a manual dashboard operation.

---

## 2. Live API Contract & Endpoint Validation

All endpoints are authenticated with header `Authorization: Bearer <CUELINKS_API_KEY>` or query parameter `token=<CUELINKS_API_KEY>`.

| Endpoint | Method | Purpose | Commercial Readiness Status | Error Handling / Fallback |
| :--- | :--- | :--- | :--- | :--- |
| `/v3/channels.json` | `GET` | Channel identification & routing | **ACTIVE** (Returns default channel `331585`) | Auto-creates channel `ARO Deals` if empty |
| `/v3/campaigns.json` | `GET` | Merchant campaign terms & EPC discovery | **ACTIVE** (Filters `country_id=252`, `access_status=open`) | Filter by `status=active` |
| `/v3/offers.json` | `GET` | Live discount & coupon offers | **ACTIVE** (Paginates 2 pages / cycle) | Offset limit handled via exponential retry |
| `/v3/links.json` | `POST` | Deep link affiliate conversion | **ACTIVE** (Mandatory conversion gate) | Direct URL fallback if unmonetizable |
| `/v3/reports.json` | `GET` | Click & transaction reconciliation | **ACTIVE** (Polls 30-day window) | Maps transactions strictly via Rule 10 |
| `/v3/invoices.json` | `GET` | Invoice records | **BLOCKED (BY DESIGN)** | Owner dashboard manual retrieval |

---

## 3. Mandatory Deep Link Affiliate Conversion Engine

Under the platform's commercial truth rules:
> **A deal is NEVER published with a fabricated affiliate link.**  
> **A deal is only marked `isMonetizable = true` when Cuelinks V3 API returns `affiliated: true` with an authorized tracking URL.**

### 3.1 Request Payload Schema
```http
POST https://api.cuelinks.com/v3/links.json
Authorization: Bearer <CUELINKS_API_KEY>
Content-Type: application/json

{
  "url": "https://www.boat-lifestyle.com/products/airdopes-141-anc",
  "campaign_id": 4120,
  "channel_id": 331585,
  "sub_id": "c_tech_diwali",
  "sub_id_2": "d_1bae9305",
  "sub_id_3": "p_boat_141",
  "sub_id_4": "human",
  "sub_id_5": "pub_web"
}
```

### 3.2 Response Payload Schema & Validation
```json
{
  "status": "success",
  "data": {
    "url": "https://www.boat-lifestyle.com/products/airdopes-141-anc",
    "tracking_url": "https://linksredirect.com/?cid=4120&subid=c_tech_diwali&subid2=d_1bae9305&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141-anc",
    "affiliated": true,
    "campaign_id": 4120,
    "merchant_name": "boAt Lifestyle"
  }
}
```

### 3.3 Sub-ID Tracking Architecture
To enable granular, leak-free transaction reconciliation, five sub-IDs are populated for every converted link:
1. `sub_id`: Campaign context (`c_tech_diwali`, `c_black_friday`, `c_gold_dhanteras`).
2. `sub_id_2`: Immutable deal identifier (`d_1bae9305`, `deal_test_tanishq_gold_pendant`).
3. `sub_id_3`: Product / SKU tag (`p_boat_141`, `p_philips_hd9252`).
4. `sub_id_4`: Traffic classification (`human`, `test`, `suspected_bot`, `diagnostic`).
5. `sub_id_5`: Distribution channel (`pub_web`, `pub_telegram`, `pub_newsletter`).

---

## 4. Resumable Pagination Continuation Cursor & Checkpointing

### 4.1 Upstream Offset Limit & Fault Isolation
During high-volume scans, Cuelinks API throws an HTTP 500 when pagination reaches deep offsets (e.g., offer page 171). In legacy versions, this error caused `reachedOfferEnd` to be set to `true`, instantly wiping the cursor back to page 1 and causing repeated wasteful crawling of pages 1–170.

### 4.2 Resilient Bounded Retry Architecture (Implemented in V4.5)
1. **Continuation Checkpointing:** The cursor is saved in D1 `workflows` under key `wf_cuelinks_sync_cursor`:
   ```json
   {
     "campaignPage": 2,
     "offerPage": 10,
     "failedPage": 10,
     "pageFailureCount": 1,
     "lastUpdated": "2026-11-03T02:08:00.000Z"
   }
   ```
2. **Transient Error Handling:** On receiving an HTTP 500 or timeout:
   - `failedPage` is set to the current `pageNum`.
   - `pageFailureCount` is incremented.
   - The cursor is retained at `offerPage = failedPage` (does NOT drop to 1).
3. **Bounded Wrap-around:** Only if a page fails **3 consecutive times** (indicating a true upstream offset ceiling), the system logs the ceiling and wraps cleanly back to page 1.
4. **Verified by Unit Tests:** Test suite `autonomous-deal-discovery-engine.test.ts` (test 45) verifies that Cycle 1 retains the cursor, Cycle 2 retries, and Cycle 3 safely wraps.

---

## 5. Strict Cash Integrity & Rule 10 Enforcement

### 5.1 Reconciliation Lifecycle & State Machine
Every commission event progresses through distinct stages:

```
[Transaction Logged] 
       ↓
[PENDING / TRACKED] (Status: registered by merchant)
       ↓
[COMMISSION_CONFIRMED] (Status: merchant approved return period passed)
       ↓
[INVOICE_RAISED] (Status: Cuelinks raised publisher invoice)
       ↓
[PAID_CASH] (Status: Bank credit statement verified with UTR)
```

### 5.2 Rule 10 Anti-Hallucination Guardrail
In `packages/backend/src/commission/cuelinks-sync-manager.ts`:
- `status === 'invoice_raised'` increments `validatedCommissionsINR`.
- **`invoice_raised` NEVER increments `paidCashINR`.**
- `paidCashINR` remains strictly ₹0.00 until an explicit bank credit record with transaction reference / UTR is confirmed.
- Any attempt to classify an invoice or validated transaction as bank cash is rejected at the database constraint level.

---

## 6. Commercial Readiness Matrix

| Feature | Production Verification Status | Evidence / Test |
| :--- | :--- | :--- |
| API Key Configuration | **PASS** | Read from process.env / secrets |
| Core Scopes (`campaigns`, `offers`, `links`) | **PASS** | Tested in `cuelinks-v3-integration.test.ts` |
| Deep Link Conversion | **PASS** | `convertLink()` returns verified redirect URL |
| Sub-ID Injection | **PASS** | `sub_id` through `sub_id_5` attached |
| Continuation Cursor | **PASS** | D1 workflows persistence + bounded retry |
| Honest Pricing Guard | **PASS** | No invented MRPs; coupon-only deals supported |
| Rule 10 Cash Integrity | **PASS** | Invoices classified as confirmed, not cash |
