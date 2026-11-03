# V5.0 — First Revenue Execution Plan

**Repository:** `harshavardhankotu/ai-marketing-organization`  
**Primary Pilot Merchant:** boAt Lifestyle (`boat-lifestyle.com`)  
**Affiliate Provider:** Cuelinks India (Campaign ID `4232`, Publisher ID `281897`, Channel ID `331585`)  
**Target SKUs:** boAt Airdopes 141 Gen 2 (₹799) / boAt Airdopes 141 (₹999)  
**Budget:** Strictly ₹0 Paid Advertising  
**Sprint:** V5.0 Autonomous Commercial Operations  
**Date:** November 3, 2026  

---

## 1. Executive Objective

The sole objective of this execution plan is to generate the platform's **first provider-attributed sale**, validate the commission through Cuelinks, and receive the **first bank-confirmed cash payout** in India without spending money on advertising or burning unnecessary LLM tokens.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Organic Buyer   │ ──> │ Dynamic Deal    │ ──> │ boAt Store      │ ──> │ Cuelinks        │
│ Discovery       │     │ Redirect        │     │ Purchase        │     │ Reconciliation  │
│ (SEO Guide/Desk)│     │ (Sub-IDs Saved) │     │ (₹799 / ₹999)   │     │ (6% CPS: ₹48)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
                                                                                 │
                                                                                 ▼
                                                                        ┌─────────────────┐
                                                                        │ Bank-Confirmed  │
                                                                        │ Cash Payout     │
                                                                        └─────────────────┘
```

---

## 2. Seven-Stage Commercial Journey

| Stage | Action & System Behavior | Verification Criteria | Latency / Window |
| :--- | :--- | :--- | :--- |
| **Stage 1: Production Release** | Merge PR #33, apply D1 migrations 0044–0045, merge PR #34 to `main` | Render deploys V5.0 commit; `/api/v1/public/deals` returns verified deals | ~15 minutes |
| **Stage 2: Pilot Activation** | Publish boAt Airdopes 141 Gen 2 (₹799) deal with Cuelinks Campaign 4232 | Deal card live with deterministic slug and SSRF-checked tracking URL | Immediate |
| **Stage 3: Organic Acquisition** | Deploy High-Intent Buying Guide and Reply Desk comparison copy | Publicly indexable SEO guide with Schema.org Product/Offer markup | 1–48 hours |
| **Stage 4: Click & Attribution** | Visitor clicks deal; system dynamically converts link and logs Sub-IDs | Atomic write to `referrals` and `referral_click_events`; HTTP 302 to merchant | < 150 ms |
| **Stage 5: Merchant Checkout** | Visitor purchases boAt Airdopes on boAt Official Store | boAt fires Cuelinks tracking pixel with Sub-ID | Same session |
| **Stage 6: Reconciliation** | Hourly background reconciliation imports transaction via Cuelinks V3 API | Commission record upserted with `external_status = 'pending'` | 24–72 hours |
| **Stage 7: Payout & Cash Truth** | Cuelinks validates transaction post-return window and transfers funds | Bank credit SMS/statement confirms cash received; ledger updated | 30–60 days |

---

## 3. Organic Acquisition Channels (Strictly ₹0 Paid Spend)

### 3.1 Channel 1: High-Intent SEO Buying Guides
- **Target Search Query:** *"best wireless earbuds under 1000 in India"*, *"boAt Airdopes 141 review and lowest price"*, *"boAt Airdopes 141 Gen 2 vs standard 141"*.
- **Asset Published:** Canonical buying guide page at `/deals/boat-airdopes-141-gen2`.
- **Value Provided:** Factual specifications comparison, verified battery benchmarks (42h playtime, BEAST mode low latency), live price history, and official store warranty verification.
- **Compliance:** Includes prominent statutory disclosure: *"Disclosure: When you purchase through our links, we may earn an affiliate commission at no additional cost to you."*

### 3.2 Channel 2: Daily Reply Desk
- **Query Sources:** Public Indian shopping forums, Quora India, Reddit (`r/IndiaTech`, `r/budgetaudiophile`), and shopping advice boards.
- **Mechanism:** Factual, objective comparison answers drafted by `OrganicDistributionEngine` contrasting boAt Airdopes 141 Gen 2 against unbranded or generic alternatives.
- **Rules of Engagement:**
  - Strictly zero unsolicited messaging or cold outreach.
  - Answers only existing public buyer questions.
  - Contains full `#Ad` / affiliate transparency.

### 3.3 Channel 3: Syndicated RSS 2.0 Deal Feed
- **Feed URL:** `https://ai-marketing-organization.onrender.com/feeds/deals.xml`
- **Distribution:** Permitted syndication to free Indian coupon and deal aggregators.
- **Validation:** Only active, verified, discounted deals are emitted.

---

## 4. Production Release & Migration Protocol

To prevent schema mismatch and runtime persistence faults on production, the release sequence must be executed strictly in order:

```
[PR #33 Merge] ──> [Apply D1 Migrations 0044 & 0045] ──> [PR #34 Merge] ──> [Render Auto-Deploy]
```

1. **Step 1:** Merge PR #33 (`feat/v4-1-durable-daily-revenue-operations`) to `main`.
2. **Step 2:** Apply pending Cloudflare D1 migrations using deploy token:
   - `0044_durable_automation_job_queue.sql`
   - `0045_automation_job_lease_fencing.sql`
3. **Step 3:** Merge PR #34 (`feat/v4-2-multi-sector-commerce-recovery`) to `main`.
4. **Step 4:** Monitor Render deploy build logs for service `srv-darecoc9v7es73ea8t2g`.
5. **Step 5:** Run production smoke test against `https://ai-marketing-organization.onrender.com/api/v1/cron/status` and `https://ai-marketing-organization.onrender.com/api/v1/public/deals`.

---

## 5. First Sale Reconciliation & Financial Accounting

When the first visitor completes a purchase through the dynamic tracking link:

1. **Transaction Capture:**
   - Cuelinks records the conversion under Publisher `281897`, Channel `331585`, Campaign `4232`.
   - The transaction contains Sub-ID `subid` matching the unique `click_id` generated during the redirect.
2. **Attribution Matching:**
   - In `reconcileTransactionsIncremental()`, the engine queries `referrals` table using `tx.sub_id`.
   - Finds matching `referral_id` and links the purchase to the exact visitor click event.
3. **Ledger Update:**
   - Upserts record in `commission_records` table with:
     - `expected_commission_inr = ₹47.94` (for ₹799 Gen 2) or `₹59.94` (for ₹999 Standard).
     - `external_status = 'pending'`.
     - `status = 'COMMISSION_PENDING'`.
4. **Validation & Payout:**
   - Following boAt's standard return window (typically 7–14 days), Cuelinks validates the transaction (`external_status = 'validated'`).
   - Cuelinks raises an invoice and remits payment via NEFT/RTGS to the owner's bank account.
   - **Bank Cash Invariant:** The ledger advances `cashReceivedINR` only when bank credit statement proof is verified.
