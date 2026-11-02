# CLM SYSTEM WORKING MEMORY

## 🎯 Global Objective
Transform the organization into an autonomous multi-sector deal-discovery, price-intelligence, and commercial affiliate revenue platform across 8 authoritative sectors. Generate the first genuine, bank-verified revenue in India using free or authorized channels and ₹0 paid advertising.

## 🗺️ Codebase Footprint & Active Baseline
- **Active Branch:** `feat/v4-2-multi-sector-commerce-recovery` (branched from `feat/v4-1-durable-daily-revenue-operations` at `bc214b3`)
- **PR #33 Status:** Green on CI (`Typecheck, Guardrails, Build & Test` passed)
- **Production Commit:** `f3e0c92` (PR #32 on `main`)
- **Production URL:** https://ai-marketing-organization.onrender.com
- **Owner Control Dashboard:** https://ai-marketing-organization.onrender.com/owner/today
- **Sector Control Dashboard:** https://ai-marketing-organization.onrender.com/owner/deals
- **Automation Control Dashboard:** https://ai-marketing-organization.onrender.com/owner/automation
- **Public Deals Portal:** https://ai-marketing-organization.onrender.com/deals

## 📊 Active State Scoreboard
- [x] P0 Multi-Sector Taxonomy Defined — Exactly 8 sectors defined in `packages/shared/src/constants/sectors.ts` with Sector A (Gold, Silver, Jewellery) as highest value priority.
- [x] P0 Precious Metals Sources Registered — IBJA benchmark spot intelligence, Tanishq, CaratLane, BlueStone registered in `AutonomousDealDiscoveryEngine`.
- [x] P0 Seasonal Demand Mapped — Akshaya Tritiya, Dhanteras, Diwali mapped to `GOLD_SILVER_BULLION_JEWELLERY`.
- [x] P0 Cuelinks V3 Scopes & Cursor Traps Repaired — Core scopes (`read:campaigns`, `read:offers`, `write:links`, `read:channels`) verified; cursor resets to page 1 on HTTP 500 error instead of incrementing to infinity.
- [x] P0 Sub-ID Transaction Reconciliation Active — Automated 1-to-1 matching of Cuelinks transaction `subid` to `referral_click_events.click_id` updating `commission_records`.
- [x] P0 Zero-Fabrication Invariant Enforced — `defaultDeals` and `FALLBACK_VERIFIED_DEALS` eradicated; honest empty state `"No currently verified offers are available in this category. Check back later."` rendered.
- [x] P0 Server-Side Deal Redirect & Attribution Live — `GET /api/v1/public/deals/:id/redirect` issues HTTP 302 redirect, appends `subid/subid2/subid3`, and records immutable click event.
- [x] P0 Owner Sector Control Centre Active — `GET /owner/deals` and `GET /api/v1/owner/deals/summary` render 16 metrics per sector.
- [x] P0 Real Economics Guarded — Reports `INSUFFICIENT_EVIDENCE` when organic visitor sample size < 30.
- [x] P0 Financial Integrity Maintained — Bank cash strictly ₹0.00 | Ad spend strictly ₹0.00.

## 🛑 Earliest Active Blocker & Next Action
- **Earliest Blocker:** Upstream affiliate partner approval & credentials (e.g. Amazon PA-API credentials, Cuelinks live sales).
- **Next Single Action:** Run full preflight verification and merge `feat/v4-2-multi-sector-commerce-recovery` into PR pipeline.
