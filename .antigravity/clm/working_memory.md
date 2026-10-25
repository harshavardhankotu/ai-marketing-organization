# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Acquire first genuine external visitors and provider-attributed affiliate click through compliant, zero-paid-ad student travel funnel.

## 🗺️ Codebase Footprint
- **Key Modules:**
  - `packages/backend/src/commission/static-site-generator.ts` (custom travel disclosure, sponsored nofollow styling, inline UTM beacon)
  - `packages/backend/src/db/seed.ts` (verified DGCA/airline concession claims, physical ID rules, Air India Express & Cleartrip links)
  - `packages/backend/src/commission/content-asset-engine.ts` (D1 baseline guide content update & synchronization)
  - `.github/workflows/deploy-cron-worker.yml` (smoke test timeout relaxation for full commercial cycle)
- **Core Dependencies:** Cloudflare D1/SQLite, Cuelinks V3 (Channel 331585, Publisher 281897), Render, Cloudflare Worker Cron, Firebase

## 📊 Active State Scoreboard
- [x] P1 Tracking Destination Verification — Air India Express (`clnk.in/DKRM`) & Cleartrip (`clnk.in/DKRN`) verified live
- [x] P1 Guide Claims Verification — Corrected airline concession terms, added physical ID penalty warning, and added outbound links
- [x] P1 Guide Rendering Hardening — Travel disclosure rendered, sponsored nofollow styling applied, UTM session beacon injected
- [x] P1 Production Deployment Verified — Live Render backend serving verified links, disclosure, and beacon (HTTP 200 OK)
- [x] P2 Experiment Selection — Selected Student Travel & Concession Funnel (Air India Express ₹168.75/sale + Cleartrip ₹67.50/sale)
- [x] P2 CI Automation Hardening — Relaxed smoke test timeout from 60s to 120s for full Render orchestration cycle
- [ ] P2 First Real Traffic Acquisition — Owner copy-pastes Asset 1 to student community & adds Search Console verification tag

## 📉 Compressed Context & Diagnostics
- Live Production SHA: `c186f52` (PR #23 merged) | Render Backend: HEALTHY (HTTP 200)
- Live Cuelinks Truth (30d): Clicks 0, Conversions 0, Commission ₹0.00, Bank Cash ₹0.00 (Zero test traffic in prod)
- Verified Live Endpoints: `/guides/student-flight-discounts-india` (Live with `clnk.in/DKRM`, `clnk.in/DKRN`, disclosure & beacon)
- Next Action: Submit report and guide owner through single 60s distribution action (Asset 1) and GSC verification tag.
