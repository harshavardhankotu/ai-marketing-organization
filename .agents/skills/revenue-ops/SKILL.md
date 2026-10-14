---
name: revenue-ops
description: Protocol for single-owner revenue operations, mistakes board preflight, money-path verification, owner action audits, hermetic testing, and secret hygiene.
---

# Revenue Operations (Revenue-Ops) Skill

## Purpose
Governs the operational execution loop for the single-owner, India-first commercial engine. Ensures zero-spend adherence, prevents mistake recurrence, and enforces evidence-based progress toward qualifying transactions and verified revenue.

## Operational Protocol

### 1. Mistakes Board Preflight Check
- Always execute `npm run board:preflight` as the very first command of every operational cycle.
- Inspect all rows. If any mistake is OPEN, halt other work and resolve the root cause.
- Run `npm run board:verify` to ensure every FIXED mistake has a working automated guard.

### 2. Money-Path Status Check
- Query `GET /api/v1/commission/money-path` (with owner auth header).
- Evaluate the 5 sequential revenue stages:
  1. Approved Partner (`partners`)
  2. Active Commercial Offer (`partner_offers`)
  3. Published Buyer Guide (`commission_content_assets`)
  4. Measured Visitor Click (`referral_click_events`)
  5. Verified Commission Ledger (`commission_records`)
- Identify the first non-READY stage. Focus exclusively on unlocking that specific blocker.

### 3. Review Owner Actions & Statutory Environment
- Audit the 6 statutory environment variables required for Amazon Associates compliance:
  - `ASSOCIATES_APPLICATION_DATE`
  - `ASSOCIATES_LISTED_SITE_URL`
  - `ASSOCIATES_AGREEMENT_READ`
  - `PUBLIC_SITE_NAME`
  - `PUBLIC_AUTHOR_NAME`
  - `PUBLIC_CONTACT_EMAIL`
- Never guess, default, or fabricate owner facts. Only the human owner can set them in the Render dashboard.

### 4. Hermetic Test Execution (Zero Provider Credits)
- Execute `npx vitest run --test-timeout=30000` to verify all test suites pass.
- Verify provider isolation: all live keys (`GEMINI_API_KEY`, `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`) must be stripped during automated tests.
- Confirm 0 external API calls and 0 provider credits consumed during test execution (`mst_23`).

### 5. Deployment & Production Verification
- Run typecheck and build across all 4 workspaces (`shared`, `backend`, `frontend`, `cloudflare-worker`).
- Push strictly to `main` with passing CI before deploying.
- Confirm Render live deploy status and verify raw response from `/api/v1/health` and `/api/health`.

### 6. Secrets & Data Hygiene
- Never output secrets, credentials, API keys, or raw affiliate tracking tags into logs, status files, or console outputs.
- Mask affiliate tags in all public logs and status documents.
- Never write unbacked rupee estimates (`UNKNOWN` if unmeasured).
- Never scrape or extract any `amazon.*` webpage.
