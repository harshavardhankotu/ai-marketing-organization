# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Acquire first genuine external visitors and provider-attributed affiliate click through compliant, zero-paid-ad student travel funnel.

## 🗺️ Codebase Footprint
- **Key Modules:**
  - `packages/backend/src/commission/static-site-generator.ts` (outbound click beacon listener, /revenue in sitemap & nav)
  - `packages/backend/src/db/seed.ts` (monetized Akasa Air, Air India, Air India Express, Cleartrip)
  - `packages/backend/src/routes/api.ts` (POST /organic/affiliate-clicks & GET /public/revenue-funnel)
  - `packages/backend/src/index.ts` (server-rendered /revenue public dashboard)
- **Core Dependencies:** Cloudflare D1/SQLite, Cuelinks V3 (Channel 331585, Publisher 281897), Render, Cloudflare Worker Cron, Firebase

## 📊 Active State Scoreboard
- [x] P1 Partner Monetization — Akasa Air (`clnk.in/DKX3`), Air India (`clnk.in/DKX4`), Air India Express (`clnk.in/DKRM`), Cleartrip (`clnk.in/DKRN`)
- [x] P1 Redirect Allowlist — `clnk.in` and `www.clnk.in` added to Cuelinks allowlisted hosts
- [x] P1 Outbound Click Tracking — Non-blocking beacon `POST /api/v1/organic/affiliate-clicks` active
- [x] P1 Public Revenue Funnel — `GET /api/v1/public/revenue-funnel` & `GET /revenue` live with zero cash claims
- [x] P1 Regression & Integrity Tests — 9 targeted tests + 66 full revenue tests passing
- [x] P2 PR #25 Merged to Main — Commit `0990b65`
- [ ] P2 First Real Traffic Acquisition — Owner copy-pastes Asset 1 to student community & adds Search Console verification tag

## 📉 Compressed Context & Diagnostics
- Live Main SHA: `0990b65` (PR #25 merged) | CI & Deploy in progress
- Live Cuelinks Truth (30d): Clicks 1 (test), Conversions 0, Commission ₹0.00, Bank Cash ₹0.00
- Verified Live Endpoints: `/guides/student-flight-discounts-india`, `/revenue`, `/deals`, `/api/health`
- Next Action: Verify Render production deployment post-merge and guide owner through distribution asset execution.
