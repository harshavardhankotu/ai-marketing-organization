# SYSTEM STATE RECORD (STATE.md)

## 1. Context Ledger
1. One owner. Not for other users. The goal is verified cash in India.
2. Free plans only. Tavily: 2 searches per day. Firecrawl: 500 credits. Stop each provider at 70% of its allowance.
3. The owner gives owner facts. The agent never sets or guesses them.
4. Razorpay: manual mode now. Owner QR and UPI link exist. API keys come later, at a threshold the owner sets.
5. No cold email. No cold WhatsApp. The system never posts or messages anyone for the owner. It prepares drafts. The owner sends them.
6. Revenue counts only with provider or bank proof. A claim, a click, a proposal, an asking price, and a test record are not revenue.
7. Commercial truth: 5 sequential Cuelinks authorization states enforced. Zero hardcoded partner fallbacks.
8. Raw output only. PASS needs raw proof. Never invent a number.
9. Outbound outreach dispatch strictly requires `human_approved = 1 AND approval_source = 'HUMAN_OWNER'`.
10. FEATURES_FROZEN = true. Feature freeze is strictly reinstated. No new migrations. No new feature routes or agent types.

## 2. Last Verified Commit
- **Verified Main Baseline:** `abd5d902719ff8cd28d3c447052c1747317726f7` (Stage D, PR #52 merged)
- **Active Branch:** `main`
- **Canonical Production URL:** `https://ai-marketing-organization.onrender.com`
- **Render Service ID:** `srv-darecoc9v7es73ea8t2g`
- **Remote Cloudflare D1 Database:** `prod-db` (`0563bb85-f6d2-483f-8b0f-0784e3d604c7`)
- **Remote D1 Table Count:** 88 verified tables
- **Last Applied D1 Migration:** `0050_stage_d_deal_reconciliation_and_schedule.sql`

## 3. Operational Counts (Empirical Evidence)
- **Verified Bank Cash Received:** ₹0.00
- **Internal Deal Candidates in D1:** 134 total deals in `public_deals` (133 in-stock)
- **Verified Public Monetizable Offers:** 25 (actively published at `/api/v1/public/deals` with live `clnk.in` tracking URLs)
- **Published Buyer Guides in D1:** 1 (`student-flight-discounts-india`)
- **Direct Outreach Drafts:**
  * Total Prepared: 38
  * Owner-Approved: 0 (All 5 Stage-B auto-flagged rows neutralized via migration 0050)
  * Provider Dispatched: 0
- **Completed Site Audits:** 3 (12-point deterministic HTML & SEO audits; synthetic scores on `example.com` reset)
- **Cloudflare Worker Cron:**
  * Status: OBSERVED / ACTIVE (`ai-marketing-cron-worker/1.0`)
  * Last Observed Ping: `2026-11-10 06:49:29`
  * Last Successful Cycle: `2026-11-10 06:51:24`

## 4. 3 Commercial Monetization Lanes
| Lane | Description | Implemented | Accessible | Provider-Connected | Owner-Approved | Commercially Ready | Generating Verified Revenue |
|---|---|---|---|---|---|---|---|
| **Lane 1** | Administrative Inquiry Capture Storefront (`/offer`) | YES | YES (`/offer`) | NO (Sandbox Mode) | YES (Attested) | YES (Inquiry Mode) | NO (₹0.00 cash) |
| **Lane 2** | SiteFix AI 12-Point Deterministic Scanner (`/tools/site-audit`) | YES | YES (`/tools/site-audit`) | NO (PageSpeed Unkeyed) | YES | YES (HTML Audit Live) | NO (₹0.00 cash) |
| **Lane 3** | Cuelinks 5-State Multi-Sector Affiliate Engine | YES | YES (`/deals`) | YES (Channel 331585 Approved) | YES (25 Deals Live Verified) | YES (25 live verified offers) | NO (₹0.00 cash until conversions report) |

## 5. Single Next Action
- Autonomous execution: The Cloudflare Worker cron will continuously execute hourly cycles, automatically draining remaining deal candidate batches and syncing conversion reports via approved Channel ID 331585.
