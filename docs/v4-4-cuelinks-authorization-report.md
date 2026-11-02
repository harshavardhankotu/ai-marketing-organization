# V4.4 Cuelinks Authorization, Permissions & Scope Audit Report

**Provider:** Cuelinks India (REST API V3)  
**API Documentation Reference:** https://developers.cuelinks.com/docs/reference/  
**Publisher Channel ID:** `127814` (`https://ai-marketing-organization.onrender.com`)  
**Publisher Verification Meta Tag:** `VERIFY-CL-YE94W8YS` (present and live in production HTML `<head>`)  
**Audit Date:** 2026-11-03 01:15 IST  

---

## 1. Verified Endpoint & Permission Matrix

| Endpoint Path | Required Scope | HTTP Method | Observed Status | Scopes Verified | Operational Status & Commercial Readiness |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/pub_api/v3/campaigns.json` | `read:campaigns` | GET | HTTP 200 | **VERIFIED** | Active. Campaign discovery and approval tracking operational. |
| `/pub_api/v3/offers.json` | `read:offers` | GET | HTTP 200 | **VERIFIED** | Active. Deal parsing, discount extraction, and pagination cursor operational. |
| `/pub_api/v3/channels.json` | `read:channels` | GET | HTTP 200 | **VERIFIED** | Active. Channel `127814` verified approved. |
| `/pub_api/v3/links.json` | `write:links` | POST | HTTP 200 | **VERIFIED** | Active. Deep link monetization and Sub-ID insertion operational. |
| `/pub_api/v3/transactions.json` | `read:transactions` | GET | HTTP 200 | **VERIFIED** | Active. Reconciles sub_id, sub_id_2..5, invoice_number, currency. Returns 0 records until real buyer purchases occur. |
| `/pub_api/v3/reports/performance.json` | `read:reports` | GET | HTTP 200 | **VERIFIED** | Active. Aggregates provider impressions, clicks, EPC. |
| `/pub_api/v3/invoices.json` | `read:invoices` | GET | HTTP 403 / Pending | **PENDING** | Non-blocking. Invoices scope requires publisher console activation once commissions reach payout threshold. |

---

## 2. 10-Stage Commercial Readiness Policy

Under V4.4, an opportunity is classified into explicit states:
`DISCOVERED` $\rightarrow$ `ACCESS_PENDING` $\rightarrow$ `AUTHORIZED` $\rightarrow$ `OFFER_VERIFIED` $\rightarrow$ `LINK_CREATED` $\rightarrow$ `PUBLISHED` $\rightarrow$ `BLOCKED` $\rightarrow$ `EXPIRED`.

A campaign is declared **Commercially Ready** only when all 10 conditions are satisfied:
1. **Active Provider Confirmation:** Cuelinks confirms campaign status is `active`.
2. **Publisher Authorization:** Publisher channel `127814` is approved for the merchant campaign.
3. **API Scopes Operational:** All 4 core commercial scopes (`read:campaigns`, `read:offers`, `write:links`, `read:channels`) are verified.
4. **Channel Active:** Domain matches `ai-marketing-organization.onrender.com`.
5. **Market Eligibility:** Geographic coverage includes India (`country: IN`).
6. **Link Conversion:** `/v3/links.json` returns HTTP 200 with `affiliated: true`.
7. **SSRF & Security Allowlist:** Destination URL passes `DealSsrfGuard` (HTTPS, non-private IP, no open redirect).
8. **Offer & Baseline Verification:** Product price, discount evidence, and merchant stock are verified.
9. **Unique Attribution Sub-IDs:** Outbound tracking link includes `subid` (unique click ID), `subid2` (sector code), and `subid3` (internal deal ID).
10. **Immutable Click Persistence:** Clicks are classified (`human`, `bot`, `test`) and persisted in `referral_click_events`.

---

## 3. Resumable Pagination & Fault Recovery

To prevent upstream HTTP 500 errors and avoid restarting from page 1 on transient failures:
1. **Bounded Progression:** Sync queries at most 2 pages per execution cycle.
2. **Persistent Checkpointing:** Cursor progress (`offerPage`, `campaignPage`) is saved to `automation_registry.checkpoint_json`.
3. **Cursor Reset on Completion:** When upstream returns HTTP 500 or end of offers, `reachedOfferEnd` is set to `true`, cleanly resetting cursor to page 1 for subsequent runs without getting trapped in high offset loops.
4. **Exponential Backoff:** Rate-limited responses (HTTP 429) back off with exponential jitter up to 60 minutes.

---

## 4. Transaction Reconciliation & Strict Currency/Invoice Rules

1. **Rule 10 Adherence:**
   - `status: pending` $\rightarrow$ Logged as `PENDING`, zero cash.
   - `status: validated` / `payable` $\rightarrow$ Logged as `COMMISSION_CONFIRMED`, zero cash.
   - `status: invoice_raised` $\rightarrow$ Logged as `INVOICE_RAISED` / `COMMISSION_CONFIRMED`. **Strictly forbidden from being counted as paid cash.**
   - `status: paid` $\rightarrow$ Logged as `COMMISSION_PAID`, with received commission tracked. **Bank cash remains ₹0.00 until bank statement credit verification.**
2. **Currency Integrity:** The engine reads `tx.currency`. If non-INR (e.g. USD), currency code is explicitly preserved in `evidence_json`.
3. **Sub-ID Attribution:**
   - 1-to-1 match against `referral_click_events.click_id` via `sub_id` or `subid`.
   - Secondary sector attribution via `sub_id_2` (`subid2`).
   - Internal deal reference via `sub_id_3` (`subid3`).
