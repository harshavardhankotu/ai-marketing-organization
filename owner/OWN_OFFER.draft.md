# DRAFT COMMERCIAL OFFER SPECIFICATION (LANE B) — DRAFT FOR OWNER REVIEW

> IMPORTANT: This is a draft proposal specification. All prices, guarantees, delivery times, and refund terms must be set by the human owner. The autonomous agent does not set or guess them.
> To activate this offer:
> 1. Owner reviews and edits this file or `owner/OWN_OFFER.md`.
> 2. Owner runs `node scripts/owner-apply.mjs` to set `OWN_OFFER_CONFIRMED=true` and compute `DIRECT_OFFER_TERMS_SHA256`.

---

## 1. Offer Overview

- **Offer ID:** `PLATFORM_SETUP`
- **Full Title:** AI Inbound Lead Triage & Conversion System Setup
- **Price:** TBD by owner
- **Billing Model:** ONE_TIME
- **Delivery Time:** TBD by owner
- **Refund Terms:** TBD by owner
- **Target Audience:** High-ticket local service businesses (e.g. dental practices, specialized healthcare clinics, diagnostic centers, consulting firms) in India.

---

## 2. Deliverables (Evidence-Verified in Codebase & Free Tools)

Only deliverables verified in code (`IMPLEMENTED_VERIFIED`) or executable with free owner-managed tools (`MANUAL_BY_OWNER`) are included. Unverified or discontinued features (such as automated Google Business Profile chat, discontinued by Google July 2024) are strictly excluded.

| # | Deliverable | Code Path | Delivery Mode | Status | Owner Tool / Action |
|---|-------------|-----------|---------------|--------|---------------------|
| 1 | **Inbound WhatsApp FAQ & Triage Workflow** | `packages/backend/src/sales/sales-conversation-engine.ts` | WhatsApp Business App / Cloud API | `MANUAL_BY_OWNER` | Configured using WhatsApp Business App (free) quick replies, greeting message, away message, and labels. |
| 2 | **Multi-Touch Inquiry Follow-Up Workflow** | `owner/DELIVERY_PLAYBOOK.md` | WhatsApp Business App / Manual Cadence | `MANUAL_BY_OWNER` | 3-step follow-up cadence (+24h, +72h, +120h) manually sent from WhatsApp Business app until a messaging provider is active. |
| 3 | **Direct Calendar Booking Integration** | `owner/DELIVERY_PLAYBOOK.md` | Cal.com / Google Calendar | `MANUAL_BY_OWNER` | Direct booking link configured manually to practitioner chair time / appointment calendar until automated cal.com or google calendar credentials are configured. |
| 4 | **Weekly Show-Rate & Conversion Performance Reporting** | `packages/backend/src/revenue/reality-report-generator.ts` | Reality Report Engine / Sheets | `IMPLEMENTED_VERIFIED` | Weekly breakdown of total inquiries, qualified leads, booked consultations, and show-up rates. |
| 5 | **Digital Personal Data Protection (DPDP) Consent Logging** | `packages/backend/src/db/schema.ts` (`customer_journeys`) | Local Database | `IMPLEMENTED_VERIFIED` | Consent timestamp, channel, and opt-in tracking complying with India's DPDP Act 2023. |
| 6 | **Manual Google Business Profile Optimization Audit** | `owner/DELIVERY_PLAYBOOK.md` | Manual Verification | `MANUAL_BY_OWNER` | Manual review of client GBP hours, categories, website link, and WhatsApp click-to-chat CTA (GBP automated chat is discontinued by Google). |

---

## 3. Retainer & SLA (Optional Phase 2)

- **Offer ID:** `PLATFORM_MONTHLY`
- **Title:** Lead Triage System Maintenance & Conversion SLA
- **Price:** TBD by owner
- **Delivery Time:** TBD by owner
- **Refund Terms:** TBD by owner
- **Deliverables:**
  1. Ongoing prompt and quick-reply rubric tuning based on real inquiry logs (`MANUAL_BY_OWNER`).
  2. Weekly show-rate and conversion report generation (`IMPLEMENTED_VERIFIED`).
  3. Routine DPDP compliance data purging and consent audit (`IMPLEMENTED_VERIFIED`).

---

## 4. Payment Methods Available

- **Method A (Exact Dynamic Link):** Razorpay Payment Link API (manual mode currently active; API keys come at threshold owner sets).
- **Method B (Manual UPI QR):** Direct payment to owner UPI address (`venkatasaiharsh149768.rzp@rxairtel`) followed by customer UTR submission and owner bank credit confirmation.
- **Banned:** Old ₹100 fixed link (`https://rzp.io/rzp/paQqSni`) is permanently banned.
