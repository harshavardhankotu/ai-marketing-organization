# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Acquire first genuine external visitors and provider-attributed affiliate click through compliant, zero-paid-ad student travel funnel.

## 🗺️ Codebase Footprint
- **Key Modules:**
  - `packages/backend/src/commission/static-site-generator.ts` (custom travel disclosure, sponsored nofollow affiliate styling, UTM beacon script)
  - `packages/backend/src/db/seed.ts` (verified airline concession claims, physical ID rules, Air India Express & Cleartrip tracking links)
  - `packages/backend/src/commission/content-asset-engine.ts` (D1 baseline guide content sync)
  - `packages/backend/src/routes/api.ts` (separate measurement of sessions, local click beacons, and provider reconciliation)
- **Core Dependencies:** Cloudflare D1/SQLite, Cuelinks V3 (Channel 331585, Publisher 281897), Render, Cloudflare Worker, Firebase

## 📊 Active State Scoreboard
- [x] P1 Tracking Destination Verification — Validated Air India Express (`clnk.in/DKRM`) and Cleartrip (`clnk.in/DKRN`) end-to-end with subid attribution
- [x] P1 Guide Claims Verification — Corrected airline concession terms, added physical ID penalty warning, and added verified outbound affiliate links
- [x] P1 Guide Rendering Hardening — Replaced hardcoded Amazon disclosure with travel disclosure, added sponsored nofollow, and injected UTM session beacon
- [x] P1 D1 Baseline Synchronization — Updated syncBaselineAssetsAsync to sync enhanced guide content to Cloudflare D1 on deployment
- [x] P2 Experiment Selection — Selected Student Travel & Concession Funnel (₹168.75/sale Air India Express + ₹67.50/sale Cleartrip)
- [x] P2 Analytics & GSC Status — Documented exact owner action for Search Console HTML tag verification; zero false claims

## 📉 Compressed Context & Diagnostics
- Base Main SHA: `8c204f2` | Feature Branch: `feat/revenue-engine-v2-8-real-traffic-sprint`
- Live Cuelinks Truth (30d): Clicks 0, Conversions 0, Commission ₹0.00, Bank Cash ₹0.00 (Zero self-clicks; verified honest)
- Tests: 54/54 passing across traffic sprint, v2.7 verification, rules, and intake suites; typecheck & linters green
- Next Action: Commit changes, open PR, verify CI, merge to main, verify production deployment, and write V2.8 delivery report
