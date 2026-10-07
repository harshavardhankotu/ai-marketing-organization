---
name: deploy-and-verify
description: Protocol for git staging, committing, pushing, tracking live Render deploys, and verifying health.
---

# Deploy and Verify Skill

## Purpose
Governs the safe deployment lifecycle from working tree validation to live health confirmation.

## Pre-Deploy Verification
1. Run `npm run typecheck` across all 4 workspaces (`shared`, `backend`, `frontend`, `cloudflare-worker`).
2. Run `npm run build` across all workspaces.
3. Run `npx vitest run --test-timeout=30000` (sequential execution).

## Deployment Protocol
1. Stage changes with `git add` excluding sensitive files or raw credentials.
2. Commit with conventional commit message (`feat: ...` or `fix: ...`).
3. Push to `origin main` to trigger the Render webhook build.
4. Poll Render service status until deploy status reaches `live`.
5. Verify live production service using `curl.exe -m 30 -s https://ai-marketing-organization.onrender.com/api/v1/health` and verify HTTP 200 `healthy`.
