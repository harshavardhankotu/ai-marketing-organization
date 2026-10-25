# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Produce real, evidence-backed revenue through the existing India-first site without paid acquisition or false accounting.

## 🗺️ Codebase Footprint
- **Key Modules:**
  - `packages/backend/src/commission/autonomous-deal-discovery-engine.ts`
  - `packages/backend/src/commission/cuelinks-v3-client.ts`
  - `packages/backend/src/commission/autonomous-commercial-engine.ts`
  - `packages/backend/src/commission/cuelinks-sync-manager.ts`
  - `packages/backend/src/commission/growth-experiment-tracker.ts`
  - `packages/backend/src/routes/api.ts`
- **Core Dependencies:** SQLite/Cloudflare D1, Cuelinks V3, Render, Cloudflare Worker, Firebase, GitHub Actions

## 📊 Active State Scoreboard
- [x] P1 conversion truth — raw shortcut removed; monetize only on convertLink affiliated=true
- [x] P1 fail-closed scopes — ping() fails closed with missingScopes when scopes omitted/empty
- [x] P1 commercial state machine — resolved BLOCKED bouncing; no false unblock without offer/URL
- [x] P1 attribution reconciliation — ignore pending/rejected; log DISCOVERY_COMPLETED_WITH_BLOCKERS
- [x] P2 organic acquisition — 3 experiments registered with 7-day review; student travel guide live

## 📉 Compressed Context & Diagnostics
- Base SHA: `74b5d22e73b0437b5f078c79d5b017e257646015` | Branch: `feat/revenue-engine-v2-6-real-revenue`
- Tests: 128 tests passing (12 new V2.6 verification tests, 0 regressions); typecheck, 3 linters, build pass
- Funnel Truth: Organic clicks 0, conversions 0, commission ₹0.00, bank cash ₹0.00 (verified honest)
- Next Action: Commit changes, push branch, open PR #18, watch CI and deploy to Render
