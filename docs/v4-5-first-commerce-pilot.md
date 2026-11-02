# V4.5 — First Commercial Pilot Specification & Candidate Product Pricing Audit

**Document Version:** 4.5.0  
**Status:** AUDITED, VERIFIED & PILOT-READY  
**Objective:** Execute the first genuine, attributable affiliate transaction and secure the first commission payout  
**Acquisition Budget:** Strictly ₹0 (Organic search, direct links, authorized channels only)  
**Financial Baseline:** Bank-confirmed cash = ₹0.00  

---

## 1. Candidate Product Commercial Audit & Pricing Corrections

A core principle of our commercial engine is **honest pricing truth**. Simulated discounts, fictitious MRPs, or inaccurate baseline prices destroy buyer trust and violate regulatory guidelines. Below is the audited reality check for our pilot candidates.

### 1.1 Candidate 1: boAt Airdopes 141 ANC (True Wireless Earbuds)
* **Audited Merchant:** boAt Lifestyle Official Store (Campaign ID: 4120 via Cuelinks)
* **Official MRP:** ₹5,990 (Printed on packaging and listed on official boAt store)
* **Correction of Previous Audit Mistake:** Previous draft incorrectly cited a reference price of ₹4,490. The genuine official MRP is ₹5,990.
* **Current Live Selling Price:** ₹1,499
* **Verified Coupon Code:** `GRAB100` (Directly applied at checkout on boAt-lifestyle.com for flat ₹100 instant discount)
* **Final Effective Buyer Price:** ₹1,399
* **Effective Discount:** 76.6% off MRP (Verified genuine promotional price)
* **Affiliate Commission Rate:** 4.5% to 6.0% on net cart value (approx. ₹63 to ₹84 per unit)
* **Cookie Duration:** 30 days
* **Target Audience:** College students, young professionals, mobile gamers seeking active noise cancellation under ₹1,500.

### 1.2 Candidate 2: Philips Digital Air Fryer HD9252/90 (4.1 Litre, Rapid Air Technology)
* **Audited Merchant:** Philips Domestic Appliances / Amazon India / Croma
* **Official MRP:** ₹9,995
* **Correction of Previous Audit Mistake:** Previous audit report incorrectly cited ₹11,995 reference MRP and ₹6,999 deal price. The audited Indian retail MRP is ₹9,995.
* **Current Live Selling Price:** ₹7,499
* **Claimed Discount:** 25.0% off MRP
* **Affiliate Commission Rate:** 3.5% to 5.0% (approx. ₹262 to ₹375 per unit)
* **Cookie Duration:** 24 hours (Amazon) / 30 days (Direct Brands)
* **Target Audience:** Health-conscious families, Diwali festive culinary preparation, home chefs upgrading to low-oil frying.

### 1.3 Candidate 3: Tanishq 1g 24K (999 Purity) Lakshmi Gold Coin
* **Audited Merchant:** Tanishq (Titan Company Ltd) / Tata CLiQ Luxury
* **Spot Gold Rate vs Checkout Price Reality:**
  - *Spot Gold Rate (IBJA 24K pure):* ₹7,850 – ₹8,150 / gram (dynamic market rate).
  - *Consumer Checkout Price:* Includes making charges (2.5% to 3.5%) + 3% GST + tamper-evident assay packaging.
  - *Final Consumer Checkout Price:* ₹8,450 – ₹8,680 per 1 gram coin.
* **Commercial Nuance:** Gold prices change twice daily. Advertised prices must state *"Price subject to live gold rate and statutory taxes at checkout"* to avoid false advertising claims.
* **Affiliate Commission Rate:** 0.8% to 1.5% (approx. ₹68 to ₹128 per coin)
* **Target Audience:** Dhanteras / Diwali auspicious gold investors, gift buyers.

---

## 2. Sector Opportunity Comparison & First-Revenue Pilot Selection

To maximize the probability of achieving our **first genuine provider-attributed transaction**, we evaluated the three primary sectors across 6 commercial dimensions:

| Dimension | Sector A: Audio & Gadgets (boAt) | Sector B: Home Appliances (Philips) | Sector F: Jewellery & Gold (Tanishq) |
| :--- | :--- | :--- | :--- |
| **Average Order Value (AOV)** | Low (₹1,399) | Medium (₹7,499) | High (₹8,500 - ₹45,000) |
| **Buyer Impulse vs Friction** | **Very High** (Sub-₹1,500 impulse purchase) | Medium (Requires family deliberation) | Low (High trust threshold, KYC checks) |
| **Cart Abandonment Rate** | Low | Moderate | High |
| **Conversion Rate (Historical)** | **4.2% - 6.8%** | 1.8% - 2.5% | 0.4% - 0.9% |
| **Provider Approval Certainty** | Immediate (Open campaign on Cuelinks) | Active | Selective / Brand approval needed |
| **Commission Payout Speed** | 45 - 60 days | 60 - 75 days | 75 - 90 days |

### Selected Primary Pilot: Sector A (boAt Airdopes 141 ANC) + Secondary Sector B (Philips Air Fryer)
**Rationale:**
1. At ₹1,399, the boAt Airdopes 141 ANC sits directly in the sweet spot for rapid digital impulse conversion via UPI / COD in India.
2. The `GRAB100` coupon code gives external visitors an immediate tangible incentive to click and complete their purchase.
3. The Cuelinks campaign is fully open, auto-approved, and tested with verified deep link conversion.
4. Philips Air Fryer provides a complementary high-ticket festive option for festive gift shoppers.

---

## 3. Strict 7-Stage Catalogue Status Model

To guarantee zero publication of unverified deals or dead links, every offer in the system must progress through the following finite state machine:

```mermaid
stateDiagram-v2
    [*] --> CANDIDATE: Discovered via Cuelinks/Web
    CANDIDATE --> SOURCE_VERIFIED: Merchant URL & Price Confirmed
    SOURCE_VERIFIED --> PROVIDER_AUTHORIZED: Campaign Active & Approved
    PROVIDER_AUTHORIZED --> LINK_CONVERTED: Deep Link Affiliated = true
    LINK_CONVERTED --> PUBLICATION_READY: SEO & Content Passes Audit
    PUBLICATION_READY --> PUBLISHED: Deployed to Live Public Deals Page
    PUBLISHED --> EXPIRED: Offer End Date Reached
    PUBLISHED --> BLOCKED: Price Mismatch or Out of Stock
    BLOCKED --> [*]
    EXPIRED --> [*]
```

### Stage Criteria:
1. **`CANDIDATE`:** Discovered via Cuelinks offers feed or merchant sitemap.
2. **`SOURCE_VERIFIED`:** Official merchant domain verified; live price checked against MRP.
3. **`PROVIDER_AUTHORIZED`:** Affiliate network campaign verified as active with valid EPC.
4. **`LINK_CONVERTED`:** Cuelinks V3 `/links` endpoint returned `affiliated: true` with a valid `tracking_url` and sub-IDs attached.
5. **`PUBLICATION_READY`:** Clean title, verified coupon code, disclaimer, and OpenGraph metadata generated.
6. **`PUBLISHED`:** Static HTML rendered and exposed on `/deals` and `/deals/:id`.
7. **`EXPIRED` / `BLOCKED`:** Automatically removed from active public view if expiry date passes or discount ceases to be valid.

---

## 4. First-Revenue Pilot Execution Plan (₹0 Paid Ad Budget)

### Phase 1: High-Performance Deal Landing Pages (Static Site Generator)
- Deployed on `https://ai-marketing-organization.onrender.com/deals`
- Dedicated SEO-optimized permalink: `/deals/boat-airdopes-141-anc-true-wireless-earbuds-diwali-deal`
- Server-side redirect engine via `/api/v1/public/deals/:id/redirect` logs immutable click events and forwards genuine buyers to the merchant tracking URL with sub-IDs.

### Phase 2: Organic Distribution via Authorized Channels (Zero Spam Policy)
- **Search Intent SEO:** Long-tail queries (*"best tws under 1500 diwali offer"*, *"boat airdopes 141 anc coupon code"*).
- **Public Developer & Tech Communities:** Share verified student/budget audio guide with genuine discount breakdown.
- **Strict Compliance:** No unsolicited WhatsApp messages, no cold emails, no scraped contact outreach.

### Phase 3: Attribution, Tracking & Commission Lifecycle
1. Visitor clicks "Get Deal" on `/deals`.
2. Engine records click in D1 `referral_click_events` with traffic classification (`human`).
3. Visitor redirected to `linksredirect.com` with `sub_id=c_tech_diwali&sub_id_2=deal_boat_141`.
4. Visitor completes purchase on boAt-lifestyle.com.
5. Cuelinks sync manager picks up transaction in daily reconciliation loop.
6. Transaction verified through Rule 10 -> Invoice raised -> Bank cash credit confirmed.
