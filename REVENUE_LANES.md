# REVENUE LANES AUDIT & EXECUTION MAP

> Generated from direct codebase inspection and live production state.
> Single-owner, India-first commercial engine.
> Currency: INR (₹). Free tier API limits enforced. No unbacked estimates.
> Version: 3.1 (Revenue-First Execution Sprint)

---

## Executive Summary

| Lane | Name | Status | Measured Revenue | Operational Reality | Owner Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Lane F** | Cuelinks India Affiliate Network | **ACTIVE_MONETIZED** | ₹0.00 cash (0 completed sales) | Publisher 281897 & Channel 331585 approved. 4 active flight campaigns live. Student flight discount guide live (`/guides/student-flight-discounts-india`). Public deals catalog live (`/deals`). Public revenue dashboard live (`/revenue`). | Distribute guide link to authorized student/alumni groups |
| **Lane B** | Razorpay Hosted Payment Page | **ACTIVE_READY** | ₹0.00 cash (0 client transactions) | Canonical hosted page `https://razorpay.me/@venkatasaiharshavardhankotu` live and verified. | Share hosted link with prospective consulting clients |
| **Lane C** | Own Service Offer with API Payment Link | **ACTIVE_READY** | ₹0.00 cash (0 proposals accepted) | API endpoints `/api/v1/commercial/proposals/accept` and `/api/v1/payments/create-order` live with cryptographic webhook verification. | Present proposal to qualified leads |
| **Lane H** | Multi-Agent Coordinated Operations | **ACTIVE_COORDINATED** | Indirect | Coordinated orchestrator wires 15 specialized agents directly to `AgentRuntime.getInstance().execute()` with real runtime token accounting and decision journal persistence. | Review pending publication approvals in dashboard |
| **Lane D** | Manual UPI Claim & Owner Confirm | **CONFIG_PENDING** | ₹0.00 cash | Direct UPI endpoints built; awaiting owner UPI VPA in environment. | Set `PLATFORM_UPI_VPA` in Render dashboard |
| **Lane A** | Amazon Search-Link Guides | **CONFIG_PENDING** | ₹0.00 cash | Static generator built; awaiting 6 owner statutory variables and 3 qualifying sales. | Configure 6 owner transparency variables in Render |
| **Lane E** | Tenant Funnels & Lead Ingestion | **DORMANT** | ₹0.00 cash | 0 external business tenants onboarded. | Onboard first SMB client |
| **Lane G** | Owned Telegram Broadcast | **DORMANT** | ₹0.00 cash | Telegram bot disabled (`TELEGRAM_ENABLED !== 'true'`). | Configure Telegram bot credentials if channel desired |

---

## Detailed Lane Specifications

### Lane F: Cuelinks India Affiliate Network (Primary Commercial Lane)
- **Entry Points:**
  - Guide: `https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india`
  - Deals Catalog: `https://ai-marketing-organization.onrender.com/deals`
  - Public Funnel: `https://ai-marketing-organization.onrender.com/revenue`
  - Partner Tracking Redirects:
    - Akasa Air: `https://clnk.in/DKX3`
    - Air India: `https://clnk.in/DKX4`
    - Air India Express: `https://clnk.in/DKRM`
    - Cleartrip: `https://clnk.in/DKRN`
- **Payment / Click Flow:** External visitor lands on guide or deals catalog -> clicks through tracked affiliate link -> completes booking/purchase on merchant site -> Cuelinks tracks referral via sub-ID -> merchant validates sale -> Cuelinks credits publisher account -> payment settled via NEFT in INR.
- **Revenue Proof Mechanism:** Cuelinks V3 API sync (`/pub_api/v3/reports`, `/pub_api/v3/transactions`) ingested into D1 database; cash confirmed only upon matching bank statement credit.
- **Status:** **ACTIVE_MONETIZED**
- **Blockers Cleared:**
  1. Publisher Account `281897` approved.
  2. Channel `331585` (`ai-marketing-organization.onrender.com`) verified and approved.
  3. All 6 required API scopes (`read:campaigns`, `read:offers`, `write:links`, `read:transactions`, `read:reports`, `read:channels`) verified active.
  4. Student flight guide published and verified serving 4 monetized partner links with ASCI compliant disclosures.
- **Current Metrics:**
  - External Visitors: 0 (empirically separated from internal test runs)
  - Real Outbound Clicks: 0
  - Diagnostic Test Clicks: 2 (strictly quarantined)
  - Provider Attributed Clicks: 0 (Cuelinks report)
  - Reported Transactions: 0
  - Pending Commission: ₹0.00
  - Confirmed Commission: ₹0.00
  - Bank Cash: ₹0.00
- **Owner Action Needed:** Share student travel guide link in compliant, authorized student and alumni communities.
- **Compliance:** ASCI Affiliate Disclosure guidelines prominently displayed at top and bottom of guide.

---

### Lane B: Razorpay Hosted Page & Platform Offers
- **Entry Point:** Canonical hosted payment page: `https://razorpay.me/@venkatasaiharshavardhankotu` (defined in `OwnerAuthService.PLATFORM_RAZORPAY_PAYMENT_PAGE_URL`).
- **Payment / Click Flow:** Prospective business visits hosted payment page -> selects setup or retainer amount -> completes payment via UPI, Credit/Debit card, or Netbanking -> Razorpay captures payment.
- **Revenue Proof Mechanism:** Razorpay webhook verification (`payment.captured`, `order.paid`) with HMAC-SHA256 signature, or owner manual reconciliation with bank statement. Recorded in `revenue_records` as verified platform revenue.
- **Status:** **ACTIVE_READY**
- **Blocker:** Zero client transactions completed.
- **Owner Action Needed:** Provide payment page link to prospective clients inquiring about marketing automation.
- **Compliance:** Razorpay merchant terms of service, GST invoice compliance on delivery.

---

### Lane C: Own Offer with Razorpay API Payment Link
- **Entry Point:** `RazorpayAdapter.createPaymentLink()` via `/api/v1/commercial/proposals/accept` and `/api/v1/payments/create-order` in `packages/backend/src/integrations/razorpay.ts`.
- **Payment / Click Flow:** Client accepts proposal -> system generates specific Razorpay payment link (e.g., `https://rzp.io/i/...`) with exact server-side authorized price -> client opens link and pays -> Razorpay webhooks fire to `/api/v1/webhooks/razorpay`.
- **Revenue Proof Mechanism:** Webhook verifies `X-Razorpay-Signature` against secret, verifies exact amount in paise against database record, marks payment request `PAID`, and logs immutable record in `revenue_records`.
- **Status:** **ACTIVE_READY**
- **Blocker:** Zero client proposals accepted.
- **Owner Action Needed:** Present commercial proposal to qualified prospect.
- **Compliance:** Server-side price authority enforced; client-side tampering rejected.

---

### Lane H: Multi-Agent Coordinated Operations
- **Entry Point:** `CoordinatedAgentOrchestrator.executeCoordinatedCampaign()` in `packages/backend/src/agents/coordinated-orchestrator.ts`.
- **Execution Flow:** 15 specialized agents execute in sequential dependency graph across 4 groups (Research & Intelligence -> Content Studio -> Marketing & Growth -> Analytics & Learning).
- **Runtime Connection:** Connected directly to `AgentRuntime.getInstance().execute()` with real Gemini LLM structured outputs, verified token accounting in `ai_cost_logs`, decision journal persistence in `decisions`, and safe deterministic fallback in offline/test environments.
- **Artifact Handoff:** Upstream research findings (market dynamics, manufacturer specs, search intent, DPDP compliance) pass directly as structured inputs to downstream content, distribution, and attribution agents.
- **Status:** **ACTIVE_COORDINATED**
- **Owner Action Needed:** Review and approve pending publication assets in dashboard.

---

### Lane D: Manual UPI Claim & Owner Confirm Routes
- **Entry Point:**
  - Buyer Submission: `POST /api/v1/payments/manual-upi/claim`
  - Owner Confirmation: `POST /api/v1/payments/manual-upi/confirm`
  - Claims Review: `GET /api/v1/payments/manual-upi/claims`
- **Payment / Click Flow:** Buyer scans owner UPI QR / sends payment to platform VPA -> buyer enters 12-digit bank UTR reference number and claimed amount at `/payments/manual-upi/claim` -> status becomes `PAYMENT_CLAIMED` -> owner verifies UTR against bank statement -> owner calls `/payments/manual-upi/confirm` -> status becomes `CONFIRMED`.
- **Revenue Proof Mechanism:** Explicit owner confirmation tied to bank statement reference, logged as `MANUAL_VERIFIED` in `revenue_records`.
- **Status:** **CONFIG_PENDING**
- **Blocker:** `PLATFORM_UPI_VPA` not configured in environment; zero claims submitted.
- **Owner Action Needed:** Set `PLATFORM_UPI_VPA` in environment and verify incoming UTRs upon payment.

---

### Lane A: Amazon Search-Link Guides
- **Entry Point:** Static site deployment (`https://ai-marketing-platform-core.web.app/guides/...`) generated by `packages/backend/src/commission/automatic-offer-lane.ts` linking to Amazon.in search queries (`https://www.amazon.in/s?k=...&tag=...`).
- **Payment / Click Flow:** Visitor reads buyer guide -> clicks out to Amazon.in search query with masked partner tag -> visitor completes qualifying purchase on Amazon.in within 24-hour cookie window.
- **Revenue Proof Mechanism:** Official Amazon Associates India monthly earnings report ingested via CSV/reconciliation into `commission_records`.
- **Status:** **CONFIG_PENDING**
- **Blocker:** Six owner transparency variables missing from Render environment: `ASSOCIATES_APPLICATION_DATE`, `ASSOCIATES_LISTED_SITE_URL`, `ASSOCIATES_AGREEMENT_READ`, `PUBLIC_SITE_NAME`, `PUBLIC_AUTHOR_NAME`, `PUBLIC_CONTACT_EMAIL`.
- **Owner Action Needed:** Set the 6 statutory environment variables in the Render dashboard.

---

### Lane E: Tenant Funnels, Booking & Lead Ingestion
- **Entry Point:** Local business landing pages (`/f/:tenantSlug`), booking endpoints (`/f/:tenantSlug/book`), and inbound webhook/lead endpoints.
- **Status:** **DORMANT**
- **Blocker:** 0 real commercial tenants exist in production database.
- **Owner Action Needed:** Onboard first local service business client.

---

### Lane G: Owned Telegram Channel Broadcast
- **Entry Point:** `TelegramBotAdapter.postPublishedGuide()` in `packages/backend/src/integrations/telegram-adapter.ts`.
- **Status:** **DORMANT**
- **Blocker:** Integration explicitly turned off (`TELEGRAM_ENABLED !== 'true'`).
- **Owner Action Needed:** Set env vars: `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`.
