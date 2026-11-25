---
name: revenue-ops
description: Protocol for single-owner revenue operations across B2B SiteFix/Founding Pilot + Razorpay, Cuelinks, mistakes board preflight, hermetic testing, and secret hygiene.
---

# Revenue Operations (Revenue-Ops) Skill

## Purpose
Governs the operational execution loop for the single-owner, India-first commercial engine across B2B Website Enquiry Path Repair (Founding Pilot ₹1,999), SiteFix Fix-Pack + Razorpay, and Cuelinks affiliate lanes.

## Operational Protocol

### 1. Mistakes Board Preflight Check
- Execute `npm run board:preflight` and `npm run board:verify` to ensure zero open regressions.

### 2. Revenue Lane & Money-Path Check
- Query `GET /api/v1/owner/status` and `GET /api/v1/b2b/readiness` (read-only) to verify B2B proposal approval queue, Razorpay readiness, and Cuelinks sync status.
- Ensure public proposals remain `UNPRICED_DRAFT` until explicit owner price approval, and never invent client logos, testimonials, or admission guarantees.

### 3. Optional Amazon Associates Statutory Check
- Only when working on Amazon Associates links/catalogs, load `.agents/skills/amazon-associates-compliance/SKILL.md` and audit its 6 environment variables.

### 4. Hermetic Test Execution (Zero Provider Credits)
- Run targeted Vitest suites with `--test-timeout=30000` (let GitHub Actions CI run the full suite).
- Confirm 0 external paid API calls and 0 provider credits consumed during test execution.

### 5. PR-Gated Deployment & Production Verification
- Run `npm run typecheck`, `npm run build`, and compliance linters (`lint:owner-prices`, `lint:owner-claims`, `lint:rupee-estimates`, `board:verify`).
- Push to a feature/fix branch, open a PR, wait for green GitHub Actions CI, squash-merge to `main`, and verify Render `Status: live` + `curl.exe -m 30` `/api/v1/health`.

### 6. Secrets & Data Hygiene
- Never output secrets, credentials, API keys, `rzp-key.csv`, or private tracking tags into logs, status files, or console outputs.
- Never write unbacked rupee estimates (`UNKNOWN` if unmeasured).
