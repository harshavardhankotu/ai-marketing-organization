---
name: deploy-and-verify
description: Protocol for feature-branch PR workflow, CI verification, squash-merge, tracking live Render deploys, and verifying health.
---

# Deploy and Verify Skill

## Purpose
Governs the safe deployment lifecycle from working tree validation through PR CI checks to live health confirmation.

## Pre-PR Verification
1. Run `npm run typecheck` across all workspaces.
2. Run `npm run build` across all workspaces.
3. Run compliance linters (`npm run lint:owner-prices`, `npm run lint:owner-claims`, `npm run lint:rupee-estimates`, `npm run board:verify`) and targeted Vitest suites (`--test-timeout=30000`).

## Deployment Protocol
1. Create a feature/fix branch (`fix/...` or `feat/...`); never push directly to `main`.
2. Stage changes with `git add` excluding `owner/`, `.env*`, `rzp-key.csv`, or raw credentials.
3. Commit with a conventional commit message (`feat: ...` or `fix: ...`), push branch to `origin`, and open a Pull Request.
4. Watch GitHub Actions CI (`gh pr checks <pr> --watch`) until all checks are green, then squash-merge to `main`.
5. Track `node scripts/show-render-deploys.mjs` until the new `main` commit reaches `Status: live`.
6. Verify live production endpoints with `curl.exe -m 30 -s https://ai-marketing-organization.onrender.com/api/v1/health` (HTTP 200 `healthy`).
