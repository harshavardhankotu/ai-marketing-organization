# AI Marketing Organization — Invariants & Directory Guide

> **GLOBAL AUTONOMY BRAIN:** Read [GLOBAL_AUTONOMY_BRAIN.md](file:///GLOBAL_AUTONOMY_BRAIN.md) first for 8-sector architecture, 4 shared revenue engines, quota ledgers, and operational state.

## 1. Non-Negotiable Operational Invariants
- **Strict Financial Truth:** Bank cash received is strictly ₹0.00 until bank statement credit verification. Paid-acquisition budget is strictly ₹0.00.
- **Raw Evidence Required:** Completion grades (`PASS`) require verbatim raw machine evidence (database rows, test runs, HTTP status); never summarize or infer success.
- **Zero Unsolicited Cold Messaging:** Outbound direct contact requires explicit owner review (`human_approved = 1 AND dispatched = 0`) and manual Click-to-Chat trigger. The system never mutates `dispatched = 1` without provider response or owner confirmation.
- **Controlled High-Risk Module Policy:** Agents MAY modify WhatsApp, Brevo, Google Indexing, GBP, Cuelinks, and Razorpay integrations provided that (a) unit/integration tests pass, (b) free-tier hard caps and fail-closed guards remain intact, and (c) zero unsolicited spam or paid API overages can occur.
- **Secret Hygiene:** Never print secret tokens, API keys, passwords, or raw affiliate tags in responses, logs, or commits.

## 2. Operational Procedures & Skills
For routine workflows, invoke specialized skills:
- **`revenue-ops`**: Daily execution loop, mistakes board preflight (`npm run board:preflight`), and money-path verification.
- **`money-path-check`**: Read-only inspection of partner authorization, active offers, and commission ledgers.
- **`verify-evidence`**: Grading standards and timeout enforcement (`curl.exe -m 30`, `--test-timeout=30000`).
- **`deploy-and-verify`**: Sequential typecheck, build, test, and Render health check (`/api/v1/health`).

## 3. Modular Reference Directory
To preserve the agent rule budget (20,000 token limit), detailed directories are loaded on demand:
- **Canonical 80-Agent Directory:** Read [canonical-agents.md](file:///.agents/references/canonical-agents.md)
- **Compliance Rules:** Read [permanent-rules.md](file:///.agents/rules/permanent-rules.md) and [revenue-integrity.md](file:///.agents/rules/revenue-integrity.md)
