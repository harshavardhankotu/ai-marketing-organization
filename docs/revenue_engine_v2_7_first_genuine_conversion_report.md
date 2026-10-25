# Revenue Engine V2.7 — First Genuine Conversion & Sustainable Revenue Sprint Report

**Date:** 25 October 2026 (Asia/Kolkata)  
**Execution Environment:** Production / Main Branch  
**Target Repository:** `harshavardhankotu/ai-marketing-organization`  
**Latest Merged Commit SHA:** `e5ea19d9b6e828d5d447d2ce893b1ebfe09e86ff` (PR #22)  
**Live Production Backend:** https://ai-marketing-organization.onrender.com  
**Published Content Asset:** https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india  
**Deals Catalog:** https://ai-marketing-organization.onrender.com/deals  
**Firebase Mirror:** https://gen-lang-client-0916255372.web.app/deals  

---

## 1. Executive Summary & Financial Funnel Truth

The objective of Revenue Engine V2.7 is to turn the deployed India-first affiliate engine into a genuine, measurable, and provider-attributed conversion funnel without fake visitors, self-clicks, synthetic transactions, or unbacked revenue claims.

### Absolute Ground Truth Scoreboard
| Metric | Reported Value | Verification Method |
| :--- | :--- | :--- |
| **Locally Observed Clicks (Diagnostic/Internal)** | 2 | Stage 3 Click Beacon (Diagnostics only) |
| **Organic External Buyer Clicks** | 0 | Public traffic log verification |
| **Provider-Attributed Clicks (Cuelinks V3)** | 0 | Official `GET /pub_api/v3/reports/performance` |
| **Provider-Attributed Conversions / Transactions** | 0 | Official `GET /pub_api/v3/reports/performance` |
| **Pending / Validated Affiliate Commission** | ₹0.00 | Official `GET /pub_api/v3/reports/performance` |
| **Bank Cash Received** | ₹0.00 | Strict zero-invented rule; bank statement proof |

> [!IMPORTANT]
> **No Revenue Inflation Rule:** Consistent with the hard boundaries of this sprint, internal diagnostic clicks, test traffic, catalog counts, and software milestones are never conflated with customer conversions or revenue. Bank cash remains strictly ₹0.00 until genuine external transactions convert and clear through independent banking verification.

---

## 2. Live Provider Verification (Cuelinks V3 India)

Verification was performed against the live Cuelinks V3 API (`https://api.cuelinks.com/pub_api/v3`) using the active `CUELINKS_API_KEY`:

```json
{
  "connected": true,
  "authorized": true,
  "publisher": {
    "id": 281897,
    "currency": "INR",
    "name": "Harshavardhan Kotu"
  },
  "channel": {
    "id": 331585,
    "url": "https://ai-marketing-organization.onrender.com",
    "is_default": true,
    "status": "APPROVED"
  },
  "scopes": [
    "read:campaigns", "read:reports", "read:transactions", "read:offers",
    "write:links", "read:channels", "write:channels", "read:invoices",
    "read:missing_transactions", "write:missing_transactions"
  ],
  "missingScopes": [],
  "last30DaysPerformance": {
    "clicks": 0,
    "transactions": 0,
    "commission": "0",
    "sale_amount": "0",
    "cr": "0",
    "epc": "0"
  }
}
```

---

## 3. Confirmed Code Defects & Implemented Fixes (PR #22)

### Defect 1: Tracking URL Security Hardening & Safe Candidate Extraction
- **File:** `packages/backend/src/commission/cuelinks-v3-client.ts`
- **Root Cause:** `isAllowedTrackingUrl()` previously accepted `http:`, did not reject embedded user credentials (`user:pass@`), and did not check for non-standard ports. Additionally, `convertLink()` could take an unvalidated `short_url` without verifying that it conformed to the HTTPS allowlist policy.
- **Fix:**
  1. Enforced strict `parsed.protocol === 'https:'`.
  2. Rejected URLs with embedded credentials (`parsed.username || parsed.password`).
  3. Rejected non-standard ports (`parsed.port && parsed.port !== '443'`).
  4. In `convertLink()`, independently sanitized `short_url`, `tracking_url`, and `url`, ensuring that no unallowlisted or insecure URL can ever leak into output.

### Defect 2: Purged Raw `offer.tracking_url` Monetization Shortcut
- **File:** `packages/backend/src/commission/cuelinks-sync-manager.ts`
- **Root Cause:** Lines 339–342 contained a residual raw tracking URL assignment that set `isMonetizable = true` if `offer.tracking_url` had an allowlisted domain, bypassing `convertLink()` confirmation.
- **Fix:** Purged the raw shortcut. Now, an offer is marked monetizable strictly when `this.client.convertLink()` succeeds with `affiliated === true` and an allowlisted HTTPS tracking destination.

### Defect 3: Feed Stock Honesty
- **File:** `packages/backend/src/commission/autonomous-deal-discovery-engine.ts`
- **Root Cause:** Hardcoded `availability: 'IN_STOCK'` on Cuelinks deals, despite third-party coupon and promo feeds having no real-time inventory tracking.
- **Fix:** Replaced hardcoded `'IN_STOCK'` with `availability: (offer as any).availability || 'UNKNOWN'`, honestly reflecting lack of real-time inventory feeds without making false in-stock guarantees.

### Defect 4: Commercial Engine Lock Namespacing & Status Honesty
- **File:** `packages/backend/src/commission/autonomous-commercial-engine.ts`
- **Root Cause:**
  1. `AutonomousCommercialEngine.runCycle()` locked the generic `businessId` (`biz_platform_aro`), which collided with `AutonomousRevenueOrchestrator` runs, causing deferred runs and `CYCLE_ALREADY_RUNNING` errors.
  2. When 0 tasks were processed, 0 completed, and 0 blocked, the cycle falsely returned `status: 'COMPLETED'`.
- **Fix:**
  1. Namespaced lock key to `comm_${businessId}` so Commercial Engine cycles never collide with ARO orchestration cycles.
  2. Changed return status on 0-task cycles to `status: 'NO_ACTION_DUE'`, ensuring empty cycles are not recorded as completed work.

---

## 4. Merchant Category Scorecard & Gold/Silver Evaluation

We audited live campaign access status on Cuelinks India (`country_id: 252`):

| Category / Merchant | Campaign ID | Name | Access Status | Payout | Evaluation & Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Audio / Gadgets: boAt** | 4232 | Boat | `open` | 6.0% / sale | **ACTIVE** — High conversion, youth & student demand |
| **Smartwatches: Noise** | 3278 | Gonoise | `open` | 4.2% / sale | **ACTIVE** — Popular budget tech |
| **Electronics: Croma** | 201 | Croma Retail | `open` | 3.38% / sale | **ACTIVE** — High trust Tata retail brand |
| **Computing: Lenovo** | 823 | Lenovo India | `open` | 3.0% / sale | **ACTIVE** — Student laptop discounts |
| **Travel: Air India Express** | 5195 | Air India Express | `open` | ₹168.75 / sale | **ACTIVE** — Direct student discount airline booking |
| **Travel: Cleartrip** | 29 | Cleartrip Flight | `open` | ₹67.50 / sale | **ACTIVE** — Approved flight aggregator |
| **Travel: MakeMyTrip** | 3801 | MakeMyTrip Hotels | `open` | ₹112.50 / sale | **ACTIVE** — Budget accommodation |
| **Jewellery: Tanishq** | 4229 | Tanishq | `open` | 1.58% / sale | **LOW PRIORITY** — Low margin, high-ticket discretionary |
| **Gold / Silver Bullion** | N/A | None | N/A | N/A | **DEFERRED** (Regulatory & Commercial grounds) |

### Gold & Silver Deferral Rationale
1. **Regulatory Safeguard (SEBI Regulations):** Under SEBI (Research Analysts) Regulations, 2014 and SEBI (Investment Advisers) Regulations, 2013, publishing commodity price predictions, buy/sell recommendations, or "best time to buy" gold/silver calls without registration is unlawful.
2. **Commercial Reality:** No approved, high-converting digital gold or bullion merchant campaigns exist on Cuelinks India with verified pricing APIs. Thin programmatic scrapers for daily bullion rates provide zero competitive differentiation against established financial portals.
3. **Formal Sprint Decision:** Gold/silver intent is formally **DEFERRED** for V2.7 in favor of high-intent student travel and student electronics discounts.

---

## 5. Zero-Cost Organic Distribution Sprint

### Target Asset
- **URL:** `https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india`
- **Subject:** Complete Guide to Student Airfare Discounts in India (IndiGo, Air India Express, SpiceJet rules, baggage allowances, DGCA requirements).

### Distribution Assets (Share-Ready)

#### Asset 1: Reddit (r/Indian_Academia, r/delhi, r/Bangalore, r/IndiaSpeaks)
**Title:** Quick breakdown of DGCA student flight discounts & extra 10kg baggage rules for college students  
**Body:**
> If you're a college student flying home for holidays or semester breaks, most domestic airlines offer a mandatory student discount + extra baggage allowance:
>
> 1. **Air India Express:** Up to 25% discount on base fares + 25kg checked baggage (extra 10kg over standard 15kg).
> 2. **IndiGo:** 6% discount on base fare + 25kg checked baggage. Must book at least 7 days before departure.
> 3. **SpiceJet:** Up to 6% base fare off + 25kg baggage allowance.
>
> **Critical Catch:** You cannot just show your ID at the boarding gate. The booking must be made under the dedicated Student Fare category with your student ID number, and a physical valid college ID with expiry date must be presented at the check-in counter (digilocker/scans are often rejected).
>
> We put together the full comparison table with exact DGCA concession guidelines, verification traps, and direct booking links here:  
> https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india?utm_source=reddit&utm_medium=community&utm_campaign=student_travel_in

---

#### Asset 2: LinkedIn (Student & Young Professional Network)
**Text:**
> Booking domestic flights as a student in India? Don't leave ₹1,500+ and 10kg extra baggage allowance on the table.
>
> Many college students miss out on airline student concessions because the policies aren't well advertised on main booking screens. 
> 
> Here is a quick reference on what IndiGo, Air India Express, and SpiceJet require:
> • Valid college ID card with clearly printed expiry date / course validity
> • Minimum age: 12+ years, enrolled in a recognized university or school
> • Up to 25kg baggage allowance (standard ticket is strictly 15kg)
>
> Full policy breakdown and step-by-step verification checklist:  
> https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india?utm_source=linkedin&utm_medium=social&utm_campaign=student_travel_in  
> #StudentLife #TravelHacks #IndiaTravel #CollegeHacks

---

#### Asset 3: WhatsApp / Telegram College & Hostel Groups
**Text:**
> Hey guys, if anyone is flying home for semester break, check this guide before booking:  
> Air India Express and IndiGo give up to 10kg extra baggage (total 25kg) + base fare discounts for students.  
> 
> Make sure to read the ID verification rules so they don't cancel the concession at check-in:  
> https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india?utm_source=whatsapp&utm_medium=direct&utm_campaign=student_travel_in

---

## 6. Smallest Action Required From Owner

To initiate organic discovery without violating any platform terms or privacy policies:
1. Copy **Asset 1** and post as an educational resource in one relevant student community (e.g. `r/Indian_Academia`).
2. Share **Asset 2** or **Asset 3** to one college alumni/student network or WhatsApp group.
3. Total owner time commitment: **under 60 seconds**.

---

## 7. Verification Summary

- **GitHub PR #22:** Merged into `main` (`e5ea19d`).
- **CI / Pipeline:** All typechecks, guardrails, linters, and 110+ unit/regression tests passed (100% green).
- **Deployment:** Render auto-deploy triggered; live health check returns `HTTP 200 OK` (`{"status":"ok"}`).
- **Static Assets:** `GET /guides/student-flight-discounts-india` returns `HTTP 200 OK` with full article content, airline rules, and Cuelinks verification tag.
- **Financial Status:** Cuelinks 30d clicks: 0, transactions: 0, commission: ₹0.00, bank cash: ₹0.00. Zero falsification.
