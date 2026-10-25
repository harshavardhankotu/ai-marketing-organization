# Revenue Engine V2.9 — Real Revenue Execution Sprint Report

**Sprint Date:** 25 October 2026 (Asia/Kolkata)  
**Repository:** `harshavardhankotu/ai-marketing-organization`  
**Latest Merged Commit:** `0990b65` (PR #25)  
**Live Production Backend:** `https://ai-marketing-organization.onrender.com`  
**Live Public Catalog:** `https://ai-marketing-organization.onrender.com/deals`  
**Live Commercial Guide:** `https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india`  
**Live Public Revenue Funnel:** `https://ai-marketing-organization.onrender.com/revenue`  
**Firebase Hosting Mirror:** `https://gen-lang-client-0916255372.web.app/deals`  
**Cuelinks Publisher Account:** `281897` | **Default Channel:** `331585` (`APPROVED`)  

---

## 1. Ground Truth Financial Baseline (Strict Empirical Separation)

| Metric | Measured Value | Truth Standard / Verification Evidence |
| :--- | :--- | :--- |
| **External Unique Visitors** | **0** | Verified by `traffic_sessions` (`is_external = 1` & `traffic_evidence_status = 'VERIFIED_EXTERNAL'`). |
| **Internal / Test Sessions** | **0** | Separated strictly (`traffic_evidence_status = 'TEST'`). |
| **Outbound Affiliate Clicks (Real)** | **0** | Recorded via new non-blocking beacon (`placement != 'direct_beacon'`). |
| **Diagnostic Test Clicks** | **2** | Isolated synthetic pings on 2026-10-25 (`placement = 'direct_beacon'`). Never counted as buyer interest. |
| **Provider-Attributed Clicks (Cuelinks)** | **1** | Recorded in Cuelinks V3 API (diagnostic check on 2026-10-25). |
| **Provider-Reported Conversions** | **0** | Cuelinks Transactions API report: 0 sales / 0 orders. |
| **Pending Commission (INR)** | **₹0.00** | Cuelinks performance report totals: ₹0.00. |
| **Approved Commission (INR)** | **₹0.00** | Cuelinks validated earnings: ₹0.00. |
| **Bank Cash Received (INR)** | **₹0.00** | Strictly ₹0.00. Zero cash claims permitted without external bank settlement proof. |

---

## 2. Root Cause Analysis: What Was Preventing Revenue?

1. **Unmonetized Flight Partners in Guide:**  
   Prior to V2.9, `/guides/student-flight-discounts-india` mentioned Akasa Air and Air India in text, but lacked booking links. Only Air India Express and Cleartrip had outbound affiliate buttons. Akasa Air offers one of the highest payouts (₹225.00 per domestic booking) on Cuelinks, representing immediate missed commercial yield.
2. **Missing Outbound Affiliate Click Beacon:**  
   While inbound visitors were tracked via `/api/v1/organic/sessions`, clicks on outbound partner booking links (`a.affiliate-link`) had no telemetry. The system could not measure which airline or comparison portal visitors clicked.
3. **`clnk.in` Omission in Cuelinks Redirect Allowlist:**  
   In `packages/backend/src/commission/referral-tracking.ts`, `ALLOWED_REDIRECT_HOSTS_BY_NETWORK.CUELINKS` included `cuelinks.com` and `linksredirect.com` but omitted `clnk.in` and `www.clnk.in`, which Cuelinks uses for shortened tracking links.
4. **Lack of Transparent Public Accountability:**  
   Visitors and stakeholders had no way to see real-time commercial funnel metrics or understand that airline affiliate tracking operates in offline mode (48–72h carrier reporting delay, 45–60 day travel validation window).

---

## 3. Implementation & Engineering Fixes (PR #25)

### A. Full Monetization of Student Flight Guide
In `packages/backend/src/db/seed.ts`, updated `BASELINE_STUDENT_FLIGHT_GUIDE` to monetize all four approved domestic airline partners:
- **Akasa Air (Campaign 57507):** Added verified booking link `https://clnk.in/DKX3` (CPS ₹225.00 per domestic booking, 30-day cookie).
- **Air India (Campaign 5622):** Added verified booking link `https://clnk.in/DKX4` (CPS ₹112.50 domestic / ₹375.00 international, 30-day cookie).
- **Air India Express (Campaign 5195):** Retained verified booking link `https://clnk.in/DKRM` (CPS ₹101.25 domestic / ₹168.75 international, 30-day cookie).
- **Cleartrip Flights (Campaign 29):** Retained verified booking link `https://clnk.in/DKRN` (CPS ₹67.50 per flight booking, 1-day cookie). Clarified that travelers comparing IndiGo (6E) and SpiceJet student fares can search through Cleartrip.
- **Strict Disclosures & ID Rule Integrity:** Concessions apply strictly to base fare (taxes, fuel surcharges, UDF/PSF, GST excluded). Warned students of the mandatory physical institutional ID requirement and the ₹5,000+ excess baggage penalty for failing to produce credentials.
- **Internal Navigation:** Added internal links to `/deals`, `/revenue`, and `/public/disclosure`.

### B. Cuelinks Domain Security Allowlist
In `packages/backend/src/commission/referral-tracking.ts`, added `'clnk.in'` and `'www.clnk.in'` to `ALLOWED_REDIRECT_HOSTS_BY_NETWORK.CUELINKS`.

### C. Outbound Affiliate Click Beacon
- In `packages/backend/src/commission/static-site-generator.ts`, attached a non-blocking `click` listener to all `a.affiliate-link` elements in `renderGuideHtml`, firing `navigator.sendBeacon` (or `fetch`) to `/api/v1/organic/affiliate-clicks`.
- In `packages/backend/src/routes/api.ts`:
  - Added `/organic/affiliate-clicks` to `EXACT_ROUTE_POLICY.PUBLIC`.
  - Implemented `POST /api/v1/organic/affiliate-clicks` to record clicks in `referral_click_events` and increment `referral_click_count` on `commission_content_assets`.
  - Ignores bots (`Googlebot`, `bingbot`, etc.) and synthetic test traffic (`x-test-mode`).

### D. Public Transparent Revenue Funnel Dashboard
- In `packages/backend/src/routes/api.ts`, added `GET /api/v1/public/revenue-funnel` exposing verified external visitors, internal test sessions, real outbound clicks, diagnostic clicks, CTR, Cuelinks live performance, and explicit accounting policies.
- In `packages/backend/src/index.ts`, added web route `GET /revenue` rendering a responsive, dark-mode public revenue dashboard.
- Added `${baseUrl}/revenue` to `/sitemap.xml`.
- Bank cash is strictly locked to ₹0.00 until independent bank verification.

---

## 4. Test & Verification Evidence

- **Unit & Regression Suite:** Created `packages/backend/tests/unit/revenue-engine-v2-9-revenue-sprint.test.ts` (9 targeted tests passing in 37ms).
- **Full Revenue Suite:** All 66 tests across 8 test suites passed with 0 failures.
- **Linters:**
  - `lint:rupee-estimates`: PASS (0 unbacked rupee estimates).
  - `lint:owner-prices`: PASS (0 unauthorized owner prices).
  - `lint:owner-claims`: PASS (0 unsourced commercial claims).
- **TypeScript:** Monorepo typecheck passed across `@ai-marketing/shared`, `@ai-marketing/backend`, `@ai-marketing/frontend`, and `@ai-marketing/cron-worker` with 0 errors.
- **CI / CD Pipeline:** Pull Request #25 CI passed (`Typecheck, Guardrails, Build & Test in 3m7s`).

---

## 5. Free Distribution Assets (Zero Paid Ads, Zero Spam)

### Asset 1: Higher Education Student Community Guide
**Target:** Indian student forums, university Reddit communities (e.g. `r/Indian_Academia`), student union discussion boards.  
**Tone:** Informational, advisory, practical.  
**Content:**
```markdown
Title: Complete Guide to Airline Student Discounts & Extra Baggage in India (2026 Rules)

If you're travelling between home, university, or exam centres this semester, here is the verified breakdown of official student fare concessions across Indian airlines:

1. Akasa Air: Up to 7% off base fare (Saver/Flexi) + 10 kg extra check-in baggage (25 kg total).
2. Air India Express: Up to 10% off base fare + 10 kg extra check-in baggage (25 kg total).
3. Air India (Full Service): Up to 25% off select domestic economy base fares + 25 kg baggage.
4. IndiGo & SpiceJet: Up to 6–10% off base fares + 10 kg extra baggage.

CRITICAL RULES TO AVOID AIRPORT PENALTIES:
- Concessions apply ONLY to base fare, not taxes, fuel surcharge, UDF/PSF, or GST.
- Mandatory Physical ID: You MUST carry your original physical student ID card with photo and expiry date. Airport counter tariff auditors do NOT accept phone photos or Digilocker screenshots for student tariff verification.
- Penalty: Failing to produce original ID results in losing the discount and being charged walk-up counter fare difference + excess baggage charges (typically ₹500–₹550/kg = ₹5,000+ extra).

Full verified guide with booking links and comparison:
https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india?utm_source=student_community&utm_medium=discussion&utm_campaign=semester_travel

(Affiliate Disclosure: Guide contains verified partner links; qualifying bookings may earn a small referral commission at zero extra cost to you).
```

### Asset 2: Competitive Exam Candidate Travel Advisory
**Target:** Engineering, Medical, and Civil Services aspirant groups (JEE, NEET, GATE, UPSC).  
**Tone:** Concise, travel advisory checklist.  
**Content:**
```markdown
Travelling to an Exam City for JEE / NEET / GATE / UPSC? Student Flight Advisory:

Before booking standard fares, check official airline student quotas:
- Akasa Air & Air India Express give 10 kg extra baggage allowance (25 kg total vs 15 kg standard) at no extra charge.
- Air India offers up to 25% base fare discount on select domestic sectors.
- Cleartrip lets you compare multi-airline options across IndiGo, SpiceJet, and Air India Express.

Check the complete eligibility criteria, ID requirements, and verified booking portals here:
https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india?utm_source=exam_aspirants&utm_medium=advisory&utm_campaign=exam_season_travel

Disclosure: Commercial links included. Concessions apply strictly to base fare. Always carry your physical institutional ID to check-in.
```

---

## 6. Smallest Required Owner Actions

1. **Google Search Console Verification Tag (2 minutes):**
   - Provide your Google Search Console verification meta tag string (e.g. `google-site-verification=XYZ123`).
   - Add it as environment variable `GOOGLE_SITE_VERIFICATION` in Render dashboard.
2. **Execute Free Distribution (Asset 1 or Asset 2) (1 minute):**
   - Share Asset 1 in an authorized university / student group or forum where student travel is discussed.
   - Do NOT send automated spam or unsolicited DMs.
