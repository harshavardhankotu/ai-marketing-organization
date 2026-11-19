---
name: first-revenue-execution
description: Standard operating rules for zero-budget SiteFix SEO audits, dual-rail affiliate monetization, D1 0050 baseline preservation, Direct UPI payment truth, and permission-first SMB teardowns.
---

# First Revenue Execution Skill (AROS / Antigravity Playbook)

This skill encodes the battle-tested, constitutional rules governing the **AI Marketing Organization** private revenue engine. Every agent session working on this repository must adhere strictly to these principles.

---

## 1. Zero-Budget (`₹0.00`) Monetization Architecture

The organization operates under a strict **zero-paid-spend invariant**:
- **Lane A — SiteFix AI Technical Fix-Pack (₹499):**
  - Self-serve, deterministic audit scanner on `/tools/site-audit`.
  - Audits public `<head>` tags, Schema.org JSON-LD, `robots.txt`, `sitemap.xml`, and security headers with strict OWASP SSRF protection (5s timeout).
  - Delivers a downloadable package containing ready-to-paste JSON, Markdown, HTML `<head>`, `robots.txt`, and `sitemap.xml` fix files.
  - Transparent disclosure: *"Files are generated from your live scan for you or your developer to review and paste. SiteFix does not modify your live server or guarantee search rankings."*
- **Lane B — Verified Dual-Rail Affiliate Monetization:**
  - Cuelinks V3 API campaigns + Dual-Rail Amazon.in affiliate redirects (`/api/v1/public/amazon-redirect`).
  - Strict impulse pricing tier (`₹299–₹1,499`) prioritized in catalogs and dynamic buyer-intent hubs (`/best/*`, `/deals/*`, `/compare/*`).
  - Zero static scraped Amazon prices; compliant `#Ad — Affiliate Links` disclosures.
  - Zero device fingerprinting or cross-site tracking; uses purely non-PII first-party `clickId` and SubID tokens.

---

## 2. Constitutional Invariants & Standing Orders

1. **Private Single-Owner System:** No multi-tenant accounts. Visitors are either affiliate shoppers or SMB owners reviewing their tokenized audit.
2. **Sell Only What People Already Buy:** Only verified Cuelinks/Amazon affiliate offers and the ₹499 SiteFix Fix-Pack. Zero speculative SaaS features.
3. **First Paying Customer Focus:** Reject abstractions or unneeded dashboard tabs that do not advance conversion.
4. **Self-Sourced Autonomous Discovery:** The system discovers, scores, and audits leads autonomously. Never demand manual prospect lists from the owner.
5. **System Doctor Scope Lock:** `AutonomousSystemDoctor` is purely a deterministic self-healing engine (repairing corrupt payloads, fixing schema anomalies, cleaning expired records). It is not a business strategist.
6. **Automation Bounded by Law & Money:** Automate auditing, drafting, and syndication. Human gate applies to legal compliance, Brevo email review (First-5 gate), and bank statement credit verification.
7. **Durable State in D1/SQLite:** Never rely on ephemeral in-memory state for revenue, ledger, suppression, or payment truth.
8. **Hard Fail-Closed Rules:**
   - **No passwordless owner login:** `autoEnvLogin` returns 401 under `VITEST`, `NODE_ENV=test`, or `RENDER=true`.
   - **ZERO healthcare/medical/dental outreach:** Strictly disqualified (`prospectTriggerScore = -100`, `isRegulatedHealthcare = true`).
   - **Strict Brevo outreach limits:** `<= 10/day` UTC cap, 1 initial + max 1 follow-up (`>= 96h` later), bounce rate `> 5%` circuit breaker.
   - **D1 Migration Baseline 0050:** Strictly preserve baseline migration `0050`. Zero new `.sql` migrations permitted. Remote D1 writes execute solely via `D1RevenueRepository.executeWrite()` when `RENDER === 'true' || ALLOW_REMOTE_D1_WRITES === 'true'`.

---

## 3. Four-State Payment Truth Protocol (Direct UPI & Razorpay)

Revenue recognition is strictly tied to verified cash in bank, separating instant digital capture from cash settlement:
- **State 1 (`PAYMENT_PAGE_VIEW`):**
  - Visitor opened `/proposals/:id/checkout` or `/tools/site-audit`.
  - Logged as navigation traffic. **₹0.00 revenue recognized.**
- **State 2 (`PAYMENT_CLAIMED`):**
  - Customer submitted a 12-digit numeric UPI UTR or initialized Razorpay payment.
  - Stored for operator reconciliation with `is_verified = 0`. **₹0.00 revenue recognized.**
- **State 3 (`PAYMENT_CAPTURED` / `HUMAN_VERIFIED_PAYMENT`):**
  - Instant digital confirmation via signed Razorpay webhook (`payment.captured`) or operator manual UTR verification.
  - Unlocks customer deliverable entitlement. **Strictly separated from cash settlement.**
- **State 4 (`BANK_SETTLED`):**
  - Real cash settlement into the merchant bank account (typically T+2 working days for Razorpay / confirmed bank statement credit match for manual UPI).
  - Real cash ledgers into `financial_truth_ledger`.
- **Fulfillment (`FULFILLED`):**
  - 72-hour entitlement token issued; ready-to-paste JSON/Markdown/HTML/XML Fix-Pack delivered.

---

## 4. DPDP Act 2023 Compliance & Retention Lifecycle

1. **30-Day Automated Purge:**
   - `DPDPComplianceManager.purgeExpiredInquiries(30)` runs daily under `quota_health_checks` and `b2b_suppression_and_compliance_audit`.
   - Scrubs PII from `platform_prospects` older than 30 days.
   - Deletes expired `PRICE_DROP_SUBSCRIPTION` events older than 30 days.
   - Deletes terminal completed `PRICE_ALERT_DELIVERY_CLAIMED` events (`processed = 1`).
   - **Delivery Tombstone Safety:** NEVER deletes in-flight or leased delivery claims (`error_message LIKE 'PROVIDER_CALL_ATTEMPTED%'` or `error_message LIKE 'PRE_SEND_LEASE%'` or `processed = 0`); scrubs PII fields from payload while preserving the non-PII tombstone ID `price_alert_claim_<sha256>`.
   - Awaits remote D1 write execution via `d1Repo.executeWrite()`.
2. **Right to Erasure (Section 12):**
   - Inbound `/api/v1/compliance/dpdp/erase` request immediately anonymizes prospect journeys while retaining non-PII statutory financial ledgers.

---

## 5. Permission-First Hyderabad SMB Teardown Protocol

When evaluating or generating an audit scorecard for local SMBs:
1. **SSRF Safe Fetch:** Use `SiteAuditService.runAudit()` with OWASP SSRF protection (reject private IP ranges 10.0.0.0/8, 127.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, link-local, cloud metadata 169.254.169.254).
2. **Healthcare Policy Guard:** Verify domain and business title with `isRegulatedHealthcareTarget()`. Immediately drop clinics, dental practices, pharmacies, hospitals, and diagnostic labs.
3. **Commercial Impact Mapping:**
   - Label findings with (a) Observed Evidence, (b) Commercial Impact (why visitors/crawlers drop off), and (c) Fix-Pack Deliverable (`Ready-to-paste snippet` vs `Owner action checklist`).
4. **First-5 Human Gate:** All drafted outbound emails remain in `PENDING_REVIEW` until the owner clicks approve in `/owner/direct-outreach`.

---

## 6. Windows Shell Execution Invariants

On Windows host machines:
- **Never use `Invoke-WebRequest`** (hangs indefinitely or corrupts binary streams).
- **Use ONLY `curl.exe -sS --max-time 25`** or bounded Node scripts ending with `process.exit(0)`.
- Always verify working directory prefix: `cd C:\Users\vardh\.gemini\antigravity\scratch\ai-marketing-organization;`.
