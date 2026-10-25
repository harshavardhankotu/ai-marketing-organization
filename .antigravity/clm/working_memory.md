# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Keep the Revenue Engine healthy, genuinely autonomous, and focused on evidence-backed revenue in India.

## 🗺️ Codebase Footprint
- **Key Modules:**
  - `packages/backend/src/db/d1-migrations/0038_quarantine_test_records_and_add_is_test.sql`
  - `packages/backend/src/db/sqlite-migration-runner.ts`
  - `packages/backend/src/db/client.ts`
  - `packages/backend/src/db/schema.ts`
  - `packages/backend/src/commission/cuelinks-v3-client.ts`
  - `packages/backend/src/commission/cuelinks-v3-types.ts`
  - `packages/backend/src/commission/cuelinks-sync-manager.ts`
  - `packages/backend/src/commission/autonomous-deal-discovery-engine.ts`
  - `packages/backend/src/commission/autonomous-commercial-engine.ts`
- **Core Dependencies:** SQLite/Cloudflare D1, Cuelinks V3 API, Express/Hono backend on Render (`srv-darecoc9v7es73ea8t2g`), Cloudflare Worker Cron, Firebase Hosting.

## 📊 Active State Scoreboard
- [x] P1: Fix confirmed production SQLite migration error (status/blocker) — Fixed & regression-tested
- [x] P1: Fix Cuelinks channel creation 422 and verify live scopes — Fixed & verified (Channel 331585 reused)
- [x] P1: Trace scheduled discovery → link conversion → public offer → attribution — Traced & verified live
- [x] P2: Verify real source collectors, pagination and reporting — Sources audited & accurately classified
- [x] P2: Weekly improvement workflow and measured organic growth — Review doc generated for 2026-10-25

## 📉 Compressed Context & Diagnostics
- Base SHA: `8deb51c9a3b49ec518ae3f1145a61979ca5f91ad` | Working branch: `fix/revenue-engine-v2-5-production-repair`
- Live Errors Fixed: Migration 0038 missing columns patched; Cuelinks channel 422 length & matching fixed
- Test Suite: 116 vitest unit/integration tests passed; monorepo typecheck, 3 linters, and full build passed (0 errors)
- Next Action: Commit changes, push branch, open PR #17 to main, watch CI, and verify deployment
