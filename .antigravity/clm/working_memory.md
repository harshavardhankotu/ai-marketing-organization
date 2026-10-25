# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Produce real, evidence-backed revenue through the existing India-first site without paid acquisition or false accounting.

## 🗺️ Codebase Footprint
- **Key Modules:**
  - `packages/backend/src/commission/autonomous-deal-discovery-engine.ts`
  - `packages/backend/src/commission/cuelinks-v3-client.ts`
  - `packages/backend/src/commission/autonomous-commercial-engine.ts`
  - `packages/backend/src/commission/static-site-generator.ts`
  - `packages/backend/src/commission/content-asset-engine.ts`
  - `packages/backend/src/commission/growth-experiment-tracker.ts`
  - `packages/backend/src/index.ts`
- **Core Dependencies:** Cloudflare D1/SQLite, Cuelinks V3, Render, Cloudflare Worker, Firebase, GitHub Actions

## 📊 Active State Scoreboard
- [x] P1 conversion truth — raw shortcut removed; monetize only on convertLink affiliated=true
- [x] P1 fail-closed scopes — ping() fails closed with missingScopes when scopes omitted/empty
- [x] P1 commercial state machine — resolved BLOCKED bouncing; no false unblock without offer/URL
- [x] P1 attribution reconciliation — ignore pending/rejected; log DISCOVERY_COMPLETED_WITH_BLOCKERS
- [x] P2 organic acquisition & SEO — student guide route, sitemap fallback, 3 experiments live
- [x] P2 production deployment — PR #18, #19, #20, #21 merged to main; Render & Worker live

## 📉 Compressed Context & Diagnostics
- Deployed Main SHA: `cf85957b8b6ee480caab4808aa0367d8bfea2465` (PR #18-#21 merged)
- Full Backend Test Suite: 120 test files, 1126 tests passing (100% green); monorepo typecheck & linters pass
- Funnel Truth: Organic clicks 0, conversions 0, commission ₹0.00, bank cash ₹0.00 (verified honest)
- Next Action: Confirm live guide HTML body rendering post-deploy & document V2.6 delivery
