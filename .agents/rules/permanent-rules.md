# Permanent Operational Rules & Invariants

> **GLOBAL AUTONOMY BRAIN:** Read [GLOBAL_AUTONOMY_BRAIN.md](file:///GLOBAL_AUTONOMY_BRAIN.md) for master architecture, 8 commercial sectors, 4 shared revenue engines, and quota ledgers.

## 1. Controlled High-Risk Modules Policy
Agents MAY modify WhatsApp, Brevo, Google Indexing, GBP, Cuelinks, and Razorpay integrations provided that:
- All unit and integration tests pass before and after modifications.
- Free-tier hard caps and fail-closed guards remain strictly intact (e.g., Brevo 200/day cap, Google Indexing 180/day cap, Razorpay server-side price authority).
- Zero unsolicited spam or paid API overages can occur.
- Strict human approval gates (`human_approved = 0, dispatched = 0`) are preserved for outbound messages.
- Production credentials and live keys are isolated from test fixtures.

## 2. Evidence & Verification Rules
- Raw evidence only: Grade PASS only when verified by raw machine evidence; PARTIAL if only proposed or partly done; FAIL otherwise.
- Strictly zero invented, simulated, or fabricated data.
- Never fetch Amazon.in or Amazon product pages directly (violates robots.txt and operating agreement).
- Command limits: Always enforce `curl -m 30` (or `curl.exe -m 30` on Windows) and `vitest run --test-timeout=30000`. Kill any command exceeding 60s and report it.

## 3. Secret & PII Hygiene
- Never print secret values, API tokens, passwords, private keys, or the raw Amazon affiliate tracking tag in responses, logs, or committed files.
- Read `PUBLIC_SITE_NAME`, `PUBLIC_AUTHOR_NAME`, `PUBLIC_CONTACT_EMAIL`, and `PUBLIC_SITE_URL` from environment configuration only.

## 4. Human Owner Attestation & Approval Gates
- Never mark Amazon partner approval or `product_checked` on behalf of the owner.
- Never create or activate production offers, content, or partners without explicit human owner approval.
- The owner must manually supply the clean Amazon product URL and explicitly verify the product can be purchased by an individual or small business.

## 5. Learning Memory Lookups
- Always read `learning_records` by SQL lookup prior to making any external API or LLM call.
- Respect cooldown periods (7-day discovery query cooldown), domain blacklists, and claims linting rules.
