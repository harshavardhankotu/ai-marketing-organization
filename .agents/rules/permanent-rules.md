# Permanent Operational Rules & Invariants

## 1. Protected Modules List
Under no circumstances may any agent touch, modify, refactor, or delete the following protected modules:
- Razorpay (`*razorpay*`)
- SendGrid (`*sendgrid*`)
- WhatsApp (`*whatsapp*`)
- Stripe (`*stripe*`)
- Ads (`*adwords*`, `*ads*`)
- GBP / Google Business Profile (`*gbp*`, `*google-business*`)
- Brevo (`*brevo*`)
- Agent Registry core code (`packages/backend/src/agents/*`)
- UCOS / Unified Commerce Operating System code (`*ucos*`)

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
