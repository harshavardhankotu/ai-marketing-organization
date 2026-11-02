# V4.5 — Festive Commerce & Black Friday 2026 Autonomous Campaign Plan

**Document Version:** 4.5.0  
**Status:** CAMPAIGN PLAN APPROVED & SCHEDULED  
**Target Window:** Diwali Season (Nov 2 – Nov 8, 2026) & Black Friday / Cyber Monday (Nov 9 – Nov 30, 2026)  
**Primary Monetization Focus:** Sector E (Software / SaaS / Hosting) & Sector A/B (Consumer Electronics / Appliances)  
**Budget:** Strictly ₹0 Paid Advertising  

---

## 1. Official Campaign Calendar & Strategic Milestones (2026)

| Milestone | Exact Date | Target Consumer Intent | Core Product Verticals | Primary Merchants / Networks |
| :--- | :--- | :--- | :--- | :--- |
| **Pre-Dhanteras Setup** | Nov 2 – 5, 2026 | Auspicious investment research, gift list planning | 24K Gold/Silver Coins, Kitchen Appliances | Tanishq, Tata CLiQ, Philips, Croma |
| **Dhanteras Day** | **Nov 6, 2026** | Instant gold purchases, kitchenware upgrades | Gold Jewellery, Coins, Cookware | Tanishq, CaratLane, Amazon India |
| **Diwali Day** | **Nov 8, 2026** | Festive gifting, last-minute audio & gadget gifts | Wireless Earbuds, Smartwatches, Air Fryers | boAt, Noise, Philips, Amazon |
| **Post-Diwali Transition** | Nov 9 – 15, 2026 | Shift focus to global tech, SaaS, hosting pre-sales | Web Hosting, VPNs, Productivity SaaS | Hostinger, Namecheap, NordVPN |
| **Black Friday Warmup** | Nov 16 – 26, 2026 | Pre-Black Friday early deals, software coupons | Developer Tools, Cloud VPS, Laptops | DigitalOcean, Hostinger, Lenovo |
| **Black Friday Peak** | **Nov 27, 2026** | Maximum global and Indian tech purchasing surge | High-ticket Software, Electronics, Gaming | Global SaaS, Amazon, Cuelinks Partners |
| **Cyber Monday Peak** | **Nov 30, 2026** | Digital tools, online subscriptions, course offers | Domain Registration, Cloud Services | Namecheap, Coursera, SaaS brands |
| **Reconciliation Period**| Dec 1 – 31, 2026| Order confirmation, return period clearing | All active campaigns | Cuelinks V3 Reports Engine |

---

## 2. Sector Focus & High-Yield Campaign Architecture

### 2.1 Sector E: High-Yield Software, Cloud & Hosting (Black Friday Core)
* **Strategic Value:** Software and SaaS provide the highest affiliate commissions in the industry (30% to 60% first-year payouts, recurring rev-share, or ₹2,500 – ₹7,500 fixed CPA).
* **Target Commercial Opportunities:**
  1. **Hostinger India:** Black Friday Web Hosting + Free Domain deals (Up to 75% off + flat 40% affiliate commission).
  2. **NordVPN / Surfshark:** Annual cybersecurity subscription deals (Up to 70% off + 40% commission).
  3. **Namecheap:** Black Friday domain transfers and SSL bundles (20% – 35% commission).
* **Audience:** Indian developers, freelance web designers, digital marketing agencies, tech startup founders.

### 2.2 Sector A & B: Tech Gadgets & Home Upgrades (Diwali & Cyber Weekend)
* **Strategic Value:** High conversion velocity, widespread Indian brand recognition, instant impulse purchases.
* **Target Commercial Opportunities:**
  1. **boAt Lifestyle:** Audio and smartwatch bundles with coupon `GRAB100` (4.5% - 6% commission).
  2. **Philips Domestic Appliances:** Digital Air Fryers & Garment Steamers (3.5% - 5% commission).
  3. **Croma / Reliance Digital:** Festive consumer electronics exchange deals (1.5% - 3% commission).

---

## 3. Dedicated Landing Pages & Technical Architecture

### 3.1 Static Site Generation (SSG) for Sub-100ms Page Loads
The existing `StaticSiteGenerator` (`packages/backend/src/commission/static-site-generator.ts`) automatically compiles dedicated campaign hubs:
- **Diwali Hub:** `/deals/diwali-dhanteras-sale-2026`
- **Black Friday Tech Hub:** `/deals/black-friday-cyber-monday-deals-2026`
- **Developer & SaaS Hub:** `/deals/software-hosting-black-friday-2026`

### 3.2 Search Intent & SEO Keyword Matrix
To capture high-intent organic visitors with ₹0 advertising spend:
- `black friday hosting deals india 2026`
- `best web hosting black friday discounts 2026`
- `boat airdopes 141 anc diwali discount coupon`
- `philips air fryer best price diwali 2026`
- `hostinger black friday coupon code india`

### 3.3 Server-Side Click Attribution & Redirection
All campaign links route through `/api/v1/public/deals/:id/redirect`:
```
GET /api/v1/public/deals/deal_hostinger_bf_2026/redirect
  → Attaches Sub-IDs: sub_id=c_black_friday_2026&sub_id_2=deal_hostinger_bf_2026&sub_id_4=human
  → Increments immutable click counter in D1 referral_click_events
  → Emits HTTP 302 to merchant tracking URL
```

---

## 4. Multi-Channel Distribution Protocol (Strict Zero-Spam Policy)

1. **Owned Public Web Properties:**
   - Featured banners and top-ranked deal cards on `ai-marketing-organization.onrender.com/deals`.
   - Comprehensive comparative review articles (e.g. *"Top 5 Web Hosts for Indian Developers — Black Friday 2026 Comparison"*).
2. **Authorized Community Feeds (Opt-in Only):**
   - Push notifications to registered subscribers who opted into deal alerts.
   - Public Telegram channel for verified instant price drop alerts (strictly single daily digests, zero unsolicited DMs).
3. **Strict Compliance Guardrails:**
   - **NO** cold emailing.
   - **NO** unsolicited WhatsApp messaging.
   - **NO** automated social media bot spam.
   - **NO** scraped phone number targeting.

---

## 5. Performance Targets & Financial Milestones

* **Diwali Period Target (Nov 2 – 8):**
  - Minimum 150 unique human visitors across festive deal pages.
  - Minimum 25 attributed outbound merchant clicks.
  - Target: **First provider-attributed transaction (₹60 – ₹150 commission)**.
* **Black Friday / Cyber Monday Period Target (Nov 16 – 30):**
  - Minimum 500 unique human visitors across tech & hosting pages.
  - Minimum 60 attributed outbound clicks.
  - Target: **2 to 5 high-ticket SaaS/Hosting conversions (₹3,000 – ₹7,500 confirmed commissions)**.
* **Operational Cost Ceiling:** Strictly ₹0.00 cash expenditure (executed within existing Render and Cloudflare free tiers).
