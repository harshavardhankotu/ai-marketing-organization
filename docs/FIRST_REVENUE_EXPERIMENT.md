# First Revenue Experiment — SiteFix AI & Autonomous Daily Deals

**Repository:** `https://github.com/harshavardhankotu/ai-marketing-organization`  
**Generated On:** `2026-11-11`  
**Audit Scope:** 20 verified HTTP-200 non-healthcare Indian SMBs (across Coaching & Training, Salons & Beauty Studios, Local Retail & Specialty Stores, and Small Professional Service Firms), 10 live deterministic `SiteAuditScanner` HTML audits, and 5 `NOT_SENT` owner-approval outreach drafts.  
**PageSpeed Disclosure:** For all 10 audits below, live Core Web Vitals / PageSpeed Insights metrics are explicitly `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`. Every score and defect listed reflects **direct, observed HTTP GET HTML/header/`robots.txt`/`sitemap.xml` inspection only**.

---

## 1. Smallest Sellable SiteFix Package & Pricing Hypothesis

### Tier 0 — Free Preliminary 3-Point Snapshot (`₹0`)
- **Automated endpoint:** `GET /tools/site-audit` (`POST /api/v1/tools/site-audit/scan`) runs instantaneously on any public URL via `SiteAuditScanner`.
- **Includes:** Deterministic 0–100 conformance score, top `<head>` / Schema.org / crawlability findings, and a preview `<head>` snippet.
- **Purpose:** Instant zero-friction proof of observed defects before any payment ask.

### Tier 1 — SiteFix Core Technical Fix-Pack (`₹1,499` One-Time Hypothesis; `₹999` Pilot Hypothesis for First 3 Customers)
> **Pricing Disclaimer:** `₹1,499` / `₹999` are commercial test hypotheses pending owner sign-off and attestation (`DirectCommercialOfferPage.isDirectOfferAttested()`). Zero historical closed SiteFix sales exist yet.

- **Exact Concrete Deliverables (Delivered within 24–48 Hours of Verified Payment & Domain Details):**
  1. Custom `<head>` HTML patch (`<title>` 30–65 chars, `<meta name="description">` 100–155 chars, `<link rel="canonical">`, mobile `<meta name="viewport">`, Open Graph `og:*`, and Twitter Card tags).
  2. Validated `Schema.org` JSON-LD script tailored to observed business details (`LocalBusiness` / `Organization` / `EducationalOrganization` / `BeautySalon` / `AccountingService` / `Store`) — using strictly verified business details only, never invented reviews or coordinates.
  3. Clean `/robots.txt` (removing accidental `Disallow: /` directives on public sites where appropriate) and valid `/sitemap.xml` starter index.
  4. HTTP security header configuration checklist (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`) + verification re-scan on `/tools/site-audit`.
- **Explicit Exclusions:**
  - Does **not** include ongoing SEO retainers, paid ad management, custom visual redesign, backend rewrites, link building, or search-ranking / traffic / revenue guarantees.
  - Core Web Vitals (LCP/INP/CLS) lab/field re-checks require `GOOGLE_PAGESPEED_API_KEY` or public Chrome UX availability.
- **Refund Terms Hypothesis:**
  - Full 100% refund if the verified HTML/Schema/robots/sitemap fix bundle is not delivered within 48 hours of payment and required domain confirmation, or if delivered HTML fails deterministic `SiteAuditScanner` syntax validation.

---

## 2. First 20 Non-Healthcare Indian SMB Prospect Candidates

All 20 candidates below were checked live via read-only HTTP `GET` (`SecureUrlFetcher`, `2026-11-11`) and returned **HTTP 200 OK** with HTML payloads under 512 KB (excluding 6 probed candidates that timed out, failed DNS, or exceeded 512 KB). Contact status reflects **strictly what was observed on each live homepage** (`PUBLIC_EMAIL_OBSERVED` vs `CONTACT_FORM_ONLY`); cached DB emails were not trusted without live homepage observation.

| # | Business Name | Category | City | Website URL | Source | Public Contact Channel Status | Eligibility |
|---:|---|---|---|---|---|---|---|
| 1 | Atta Galatta | Local Retail & Specialty Store | Bengaluru | https://attagalatta.com | web_search | CONTACT_FORM_ONLY (`tel:`, `<form>`, WhatsApp link) | ELIGIBLE_NON_HEALTHCARE |
| 2 | Roastery Coffee House | Local Retail & Specialty Store | Hyderabad | https://roasterycoffee.co.in | web_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `mailto:`/`@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 3 | Havana The Salon | Salon & Beauty Studio | Bengaluru / Hyderabad | https://havanasalons.com | web_search | PUBLIC_EMAIL_OBSERVED (`<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 4 | ACE Engineering Academy | Coaching & Training Centre | Hyderabad | https://www.aceenggacademy.com/ | prod-db (`platform_prospects`) | CONTACT_FORM_ONLY (`tel:`, WhatsApp; no email on homepage) | ELIGIBLE_NON_HEALTHCARE |
| 5 | Vurve Salon | Salon & Beauty Studio | Bengaluru / Hyderabad | https://vurvesalon.com | web_search | PUBLIC_EMAIL_OBSERVED (`<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 6 | Akhil Amit And Associates | Small Professional Service Firm | Pune | https://akhilamitassociates.com | tavily_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 7 | SNR & Company | Small Professional Service Firm | Pune / Bengaluru | https://snr.company/ | web_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 8 | T.I.M.E. (TIME Hyderabad) | Coaching & Training Centre | Hyderabad | https://time4education.com/ | prod-db (`platform_prospects`) | PUBLIC_EMAIL_OBSERVED (`@` in HTML; no `tel:`/`<form>`) | ELIGIBLE_NON_HEALTHCARE |
| 9 | Plutus Academy | Coaching & Training Centre | Bengaluru | https://plutusacademy.com | prod-db (`platform_prospects`) | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 10 | Kameleon Salon | Salon & Beauty Studio | Bengaluru / Hyderabad | https://www.kameleonsalon.com/ | web_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 11 | Looks Salon | Salon & Beauty Studio | Bengaluru / Hyderabad | https://www.lookssalon.in | web_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`) | ELIGIBLE_NON_HEALTHCARE |
| 12 | Naturals Salon | Salon & Beauty Studio | Bengaluru / Hyderabad | https://naturals.in | web_search | PUBLIC_EMAIL_OBSERVED (`@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 13 | Maverick & Farmer | Local Retail & Specialty Store | Bengaluru | https://www.maverickandfarmer.com/ | web_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`) | ELIGIBLE_NON_HEALTHCARE |
| 14 | Pista House | Local Retail & Specialty Store | Hyderabad | https://pistahouse.in | web_search | CONTACT_FORM_ONLY (`<form>` / booking; no email on homepage) | ELIGIBLE_NON_HEALTHCARE |
| 15 | A N Bhutada & Co. | Small Professional Service Firm | Pune | https://anbca.com | web_search | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 16 | Studio ADI | Small Professional Service Firm | Hyderabad | https://www.studioadi.in/ | web_search | PUBLIC_EMAIL_OBSERVED (`<form>`, `@`) | ELIGIBLE_NON_HEALTHCARE |
| 17 | Digitalbuddha | Small Professional Service Firm | Pune / Bengaluru | https://digitalbuddha.in | web_search | CONTACT_FORM_ONLY (`tel:`, WhatsApp; no email on homepage) | ELIGIBLE_NON_HEALTHCARE |
| 18 | Architectural Design Studio | Small Professional Service Firm | Pune | https://architecturaldesignstudio.in | web_search | PUBLIC_EMAIL_OBSERVED (`<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 19 | Career Launcher Bengaluru | Coaching & Training Centre | Bengaluru | https://www.careerlauncher.com | prod-db (`platform_prospects`) | CONTACT_FORM_ONLY (`tel:`, `<form>`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |
| 20 | Narayana Coaching Center | Coaching & Training Centre | Hyderabad | https://narayanagroup.com/ | prod-db (`platform_prospects`) | PUBLIC_EMAIL_OBSERVED (`tel:`, `<form>`, `@`, WhatsApp) | ELIGIBLE_NON_HEALTHCARE |

---

## 3. Ten Completed Deterministic SiteFix Audit Scorecards

Executed locally using [`SiteAuditScanner`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/tools/site-audit/site-audit-scanner.ts) on `2026-11-11T10:45Z` (read-only HTTP GET; zero writes to `prod-db`). PageSpeed Insights / Core Web Vitals are `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)` across all 10 audits.

### 1. Atta Galatta (`https://attagalatta.com`) — **64/100 (`NEEDS_IMPROVEMENT`)**
- **HTTP / Timing:** `200 OK`, `132ms`, `238 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` `"Attagalatta - Book Store"` (24 chars — optimal); `<meta name="description">` **MISSING** (0 chars, `HIGH` ISSUE); `<link rel="canonical">` **MISSING** (`MEDIUM` WARNING); `<meta name="viewport">` present; **Open Graph `og:title` / `og:image` MISSING** (`HIGH` ISSUE); **Twitter Card MISSING** (`LOW` WARNING).
- **Schema.org / Crawlability / Security:** `application/ld+json` **NONE** (`HIGH` ISSUE); `/robots.txt` **HTTP 404**; `/sitemap.xml` **HTTP 404**; HSTS / CSP / XFO / XCTO **not set**; contact links `PHONE_CLICK_TO_CALL, ONLINE_BOOKING`.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Without a meta description, canonical tag, `BookStore`/`LocalBusiness` Schema.org, or Open Graph tags, search snippets pull arbitrary page copy and WhatsApp/social event shares render blank link previews.

### 2. Roastery Coffee House (`https://roasterycoffee.co.in`) — **72/100 (`NEEDS_IMPROVEMENT`)**
- **HTTP / Timing:** `200 OK`, `128ms`, `113 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` `"Roastery Coffee House"` (21 chars — optimal); `<meta name="description">` **MISSING** (`HIGH` ISSUE); `<link rel="canonical">` present (`https://roasterycoffee.co.in/`); `<meta name="viewport">` present; **Open Graph `og:title` / `og:image` MISSING** (`HIGH` ISSUE); **Twitter Card MISSING** (`LOW` WARNING).
- **Schema.org / Crawlability / Security:** Only `BreadcrumbList` detected (no `Organization`/`CafeOrCoffeeShop`/`Store`); `/robots.txt` returns `200 OK` **containing `Disallow: /` warning**; `/sitemap.xml` `200 OK`; CSP set, HSTS / XFO / XCTO absent; `PHONE_CLICK_TO_CALL, ONLINE_BOOKING`, public email observed.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** A `Disallow: /` rule in `robots.txt` combined with missing `meta description` and Open Graph tags directly restricts search crawler snippet quality and WhatsApp/Instagram link sharing.

### 3. Havana The Salon (`https://havanasalons.com`) — **74/100 (`NEEDS_IMPROVEMENT`)**
- **HTTP / Timing:** `200 OK`, `798ms`, `51 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` (53 chars — optimal); `<meta name="description">` (135 chars — optimal); `<link rel="canonical">` **MISSING** (`MEDIUM` WARNING); `<meta name="viewport">` present; **Open Graph `og:title` / `og:image` MISSING** (`HIGH` ISSUE); **Twitter Card MISSING** (`LOW` WARNING).
- **Schema.org / Crawlability / Security:** `application/ld+json` **NONE** (`HIGH` ISSUE); `/robots.txt` **HTTP 404**; `/sitemap.xml` **HTTP 404**; HSTS enabled, CSP / XFO / XCTO absent; `ONLINE_BOOKING`, public email observed (`tel:` link absent).
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** High-intent local salon visitors often tap to call or share makeover portfolios on WhatsApp; missing `BeautySalon` schema, `tel:` links, canonical tags, and Open Graph previews reduce local discovery clarity.

### 4. ACE Engineering Academy (`https://www.aceenggacademy.com/`) — **76/100 (`NEEDS_IMPROVEMENT`)**
- **HTTP / Timing:** `200 OK`, `93ms`, `241 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` **97 chars — truncated** (`LOW` WARNING); `<meta name="description">` **192 chars — truncated** (`LOW` WARNING); `<link rel="canonical">` present; **`<meta name="viewport">` MISSING (`HIGH` ISSUE)**; **`og:image` MISSING (`HIGH` ISSUE)**; Twitter Card present.
- **Schema.org / Crawlability / Security:** Only `WebSite` detected (missing `EducationalOrganization`/`LocalBusiness`); `/robots.txt` `200 OK`; `/sitemap.xml` `200 OK`; HSTS / CSP / XFO / XCTO absent; `PHONE_CLICK_TO_CALL` + WhatsApp link present (`CONTACT_FORM_ONLY`).
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Missing mobile `viewport` forces phones to zoom-out desktop layout for student visitors, while missing `og:image` leaves blank cards when batch schedules are shared on WhatsApp/Telegram.

### 5. Vurve Salon (`https://vurvesalon.com`) — **80/100 (`NEEDS_IMPROVEMENT`)**
- **HTTP / Timing:** `200 OK`, `229ms`, `166 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` **75 chars — truncated** (`LOW` WARNING); `<meta name="description">` **224 chars — truncated** (`LOW` WARNING); `<link rel="canonical">` present; `<meta name="viewport">` present; **`og:image` MISSING (`HIGH` ISSUE)**; Twitter Card present.
- **Schema.org / Crawlability / Security:** `Organization, WebSite, WebPage` detected, missing `telephone` property (`NEEDS_USER_CONFIRMATION`); `/robots.txt` `200 OK` **containing `Disallow: /` warning**; `/sitemap.xml` `200 OK`; security headers absent; `EMAIL_CLICK_TO_CONTACT, ONLINE_BOOKING`.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** `Disallow: /` inside `robots.txt` can block crawler paths and missing `og:image` weakens visual trust on WhatsApp/Instagram referrals.

### 6. Akhil Amit And Associates (`https://akhilamitassociates.com`) — **82/100 (`NEEDS_IMPROVEMENT`)**
- **HTTP / Timing:** `200 OK`, `367ms`, `115 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` **109 chars — truncated** (`LOW` WARNING); `<meta name="description">` **206 chars — truncated** (`LOW` WARNING); `<link rel="canonical">` **MISSING** (`MEDIUM` WARNING); `<meta name="viewport">` present; Open Graph & Twitter Card present.
- **Schema.org / Crawlability / Security:** `application/ld+json` **NONE** (`HIGH` ISSUE); `/robots.txt` **HTTP 404**; `/sitemap.xml` **HTTP 404**; HSTS / CSP / XFO / XCTO absent; `PHONE_CLICK_TO_CALL, EMAIL_CLICK_TO_CONTACT`.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Founders searching for CA/GST firms rely on clean search snippets and structured `AccountingService` entity data rather than truncated 109-char titles and missing sitemaps.

### 7. SNR & Company (`https://snr.company/`) — **88/100 (`OPTIMIZED`)**
- **HTTP / Timing:** `200 OK`, `274ms`, `228 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` (69 chars — optimal); `<meta name="description">` **188 chars — may truncate** (`LOW` WARNING); canonical, viewport, Open Graph, and Twitter Card present.
- **Schema.org / Crawlability / Security:** `application/ld+json` **NONE** (`HIGH` ISSUE); `/robots.txt` `200 OK`; `/sitemap.xml` `200 OK`; HSTS / CSP / XFO / XCTO absent; `PHONE_CLICK_TO_CALL, EMAIL_CLICK_TO_CONTACT, ONLINE_BOOKING`.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Clean metadata foundation, missing only `AccountingService`/`Organization` JSON-LD and concise 155-char description + security headers.

### 8. T.I.M.E. (`https://time4education.com/`) — **90/100 (`OPTIMIZED`)**
- **HTTP / Timing:** `200 OK`, `28ms`, `20 KB` HTML, HTTPS enforced.
- **Metadata:** `<title>` (69 chars), `<meta name="description">` (162 chars), canonical, viewport, Open Graph, Twitter Card all present.
- **Schema.org / Crawlability / Security:** `Organization, EducationalOrganization, WebPage, BreadcrumbList` detected; `/robots.txt` `200 OK` **containing `Disallow: /` warning**; `/sitemap.xml` `200 OK`; HSTS / CSP / XFO / XCTO absent; **no `tel:`, `mailto:`, or CTA booking link detected in homepage HTML** (`MEDIUM` WARNING).
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Mobile/aspirant visitors landing on the homepage cannot tap-to-call or tap-to-mail directly from `tel:`/`mailto:` anchors, and `robots.txt` `Disallow: /` should be reviewed.

### 9. Plutus Academy (`https://plutusacademy.com`) — **96/100 (`OPTIMIZED`)**
- **HTTP / Timing:** `200 OK`, `565ms`, **`358 KB` large HTML payload** (`MEDIUM` WARNING), HTTPS enforced.
- **Metadata:** Title (59 chars), description (135 chars), canonical, viewport, Open Graph, Twitter Card all present.
- **Schema.org / Crawlability / Security:** `WebPage, ImageObject, BreadcrumbList, WebSite, Organization` detected (missing `telephone` on `Organization`); `/robots.txt` & `/sitemap.xml` `200 OK`; HSTS / CSP / XFO / XCTO absent; `PHONE_CLICK_TO_CALL, ONLINE_BOOKING`.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Heavy 358 KB initial HTML slows mobile rendering over cellular connections and missing schema `telephone` reduces click-to-call entity completeness.

### 10. Kameleon Salon (`https://www.kameleonsalon.com/`) — **96/100 (`OPTIMIZED`)**
- **HTTP / Timing:** `200 OK`, `34ms`, **`282 KB` large HTML payload** (`MEDIUM` WARNING), HTTPS enforced.
- **Metadata & Schema:** Title (50 chars), description (149 chars), canonical, viewport, Open Graph, Twitter Card all present; `Organization, WebSite, BeautySalon, HairSalon, FAQPage` Schema.org detected; `/robots.txt` & `/sitemap.xml` `200 OK`; HSTS / CSP / XFO / XCTO absent; `PHONE_CLICK_TO_CALL, EMAIL_CLICK_TO_CONTACT, ONLINE_BOOKING`.
- **PageSpeed / CWV:** `UNAVAILABLE (Requires GOOGLE_PAGESPEED_API_KEY)`.
- **Why It Matters:** Strongest technical baseline among the 10 sites; main low-lift improvements are trimming the 282 KB HTML payload and adding standard security headers (`HSTS`/`XCTO`).

---

## 4. Five Personalized Outreach Drafts (`STATUS: NOT_SENT — REQUIRES_OWNER_APPROVAL_AND_MANUAL_SEND`)

All drafts below are strictly **UNSENT (`NOT_SENT`)**. Never send without explicit owner review and manual action.

### Draft 1 — Atta Galatta (`https://attagalatta.com`)
- **STATUS:** `NOT_SENT — REQUIRES_OWNER_APPROVAL_AND_MANUAL_SEND`
- **Channel:** Homepage contact form / listed bookstore desk (`CONTACT_FORM_ONLY`)
- **Subject:** Quick technical note on `attagalatta.com` preview tags & structured data
- **Body:**
  > Hi Atta Galatta team,  
  > I checked your public homepage (`https://attagalatta.com`, HTTP 200 in 132ms) and noticed three technical HTML gaps that affect how events and bookstore links show up in Google snippets and WhatsApp shares:  
  > 1. No `<meta name="description">` or `<link rel="canonical">` tag is currently set in `<head>`.  
  > 2. Open Graph (`og:title`, `og:image`) and `Schema.org` JSON-LD (`BookStore`/`LocalBusiness`) are missing, so shared links lack rich preview cards.  
  > 3. `/robots.txt` and `/sitemap.xml` currently return HTTP 404.  
  > Happy to send over our 1-page deterministic HTML scorecard + ready-to-paste `<head>`/JSON-LD snippet pack with zero obligation. If this isn't useful, just reply "stop" and I won't follow up.

### Draft 2 — Roastery Coffee House (`https://roasterycoffee.co.in`)
- **STATUS:** `NOT_SENT — REQUIRES_OWNER_APPROVAL_AND_MANUAL_SEND`
- **Channel:** Public email observed on homepage (`PUBLIC_EMAIL_OBSERVED`)
- **Subject:** Quick note on `roasterycoffee.co.in` `robots.txt` & missing Open Graph tags
- **Body:**
  > Hi Roastery Coffee House team,  
  > While reviewing public Indian specialty roaster sites, I ran an automated HTML/crawl check on `https://roasterycoffee.co.in` (score 72/100) and spotted three quick technical fixes:  
  > 1. `/robots.txt` includes a `Disallow: /` directive that can block search crawlers on covered paths.  
  > 2. `<meta name="description">` is empty/missing and Open Graph (`og:title`, `og:image`) + Twitter Card tags are not set for social/WhatsApp shares.  
  > 3. JSON-LD currently includes only `BreadcrumbList` (no `Organization` or `Store`/`CafeOrCoffeeShop` entity).  
  > Let me know if you'd like the full technical checklist (no pitch or obligation). Reply "opt out" anytime if not relevant.

### Draft 3 — Havana The Salon (`https://havanasalons.com`)
- **STATUS:** `NOT_SENT — REQUIRES_OWNER_APPROVAL_AND_MANUAL_SEND`
- **Channel:** Public email observed on homepage (`PUBLIC_EMAIL_OBSERVED`)
- **Subject:** Small HTML & `BeautySalon` schema fix note for `havanasalons.com`
- **Body:**
  > Hi Havana The Salon team,  
  > Quick technical note after inspecting `https://havanasalons.com` (HTTP 200, score 74/100):  
  > 1. Your `<title>` and meta description are well-sized, but `<link rel="canonical">`, Open Graph (`og:title`, `og:image`), and `BeautySalon` JSON-LD structured data are missing.  
  > 2. `/robots.txt` and `/sitemap.xml` return HTTP 404.  
  > 3. There is currently no `tel:` tap-to-call anchor on the homepage HTML for mobile visitors ready to book.  
  > If helpful, I can share the ready-to-drop `<head>` tags and `BeautySalon` JSON-LD snippet with zero obligation. Let me know if you'd prefer not to hear from me again.

### Draft 4 — ACE Engineering Academy (`https://www.aceenggacademy.com/`)
- **STATUS:** `NOT_SENT — REQUIRES_OWNER_APPROVAL_AND_MANUAL_SEND`
- **Channel:** Public homepage inquiry channel (`CONTACT_FORM_ONLY`)
- **Subject:** Mobile `viewport` & `og:image` check on `aceenggacademy.com`
- **Body:**
  > Hi ACE Engineering Academy team,  
  > I ran an automated technical HTML inspection on `https://www.aceenggacademy.com/` (score 76/100) and noticed two mobile/social issues worth flagging:  
  > 1. `<meta name="viewport">` is missing from `<head>`, which causes mobile phones to render the full desktop layout zoomed out.  
  > 2. `og:image` is missing and `<title>` / `<meta name="description">` are 97 and 192 characters (truncated in search snippets), while Schema.org only declares `WebSite` without `EducationalOrganization`.  
  > Happy to send the exact HTML/JSON-LD scorecard if useful—no obligation. Just reply "no thanks" if you'd rather I didn't follow up.

### Draft 5 — Akhil Amit And Associates (`https://akhilamitassociates.com`)
- **STATUS:** `NOT_SENT — REQUIRES_OWNER_APPROVAL_AND_MANUAL_SEND`
- **Channel:** Public email observed on homepage (`PUBLIC_EMAIL_OBSERVED`)
- **Subject:** `AccountingService` Schema & `<head>` tag note for `akhilamitassociates.com`
- **Body:**
  > Hi CA Akhil Amit & team,  
  > I inspected `https://akhilamitassociates.com` (score 82/100) and observed a few quick technical cleanup items:  
  > 1. `<script type="application/ld+json">` (`AccountingService` / `LocalBusiness` schema) and `<link rel="canonical">` are currently missing.  
  > 2. `/robots.txt` and `/sitemap.xml` return HTTP 404.  
  > 3. Homepage `<title>` (109 chars) and `<meta name="description">` (206 chars) exceed standard snippet lengths and truncate in search results.  
  > If you'd like the complete HTML scorecard and ready-to-install JSON-LD template with zero obligation, happy to reply with it. Reply "opt out" anytime to stop follow-ups.

---

## 5. Immediate Autonomous Execution + 14-Day Commercial Execution Plan

### Immediate / Daily Autonomous Systems (Zero Manual Delay Once PR #54 Merges & Owner Env Is Set)
Instead of waiting days to build momentum, the repository's existing autonomous pipeline handles daily deal & demand workflows continuously via Cloudflare Worker cron (`/api/v1/cron/tick`):
1. **Daily Affiliate Deals & Reconciliation (Autonomous):** `deal_sync_and_reconcile`, `daily_market_demand_research`, `content_freshness_verification`, and `daily_commercial_summary` harvest active Cuelinks campaigns/offers (Channel `331585`), reconcile `public_deals` against strict `partner_offers`/`partners` chains, strip/quarantine broken or ambiguous offers, and track clicks/conversions into `public_deals`, `/deals`, and `/guides/*`.
2. **Instant Self-Serve SiteFix Funnel:** Any prospect or visitor hitting `/tools/site-audit` receives a live deterministic audit in seconds (`SiteAuditScanner`), with paid SiteFix Core Fix-Pack fulfillment ready immediately once `DirectCommercialOfferPage.isDirectOfferAttested()` and Razorpay Standard Checkout secrets are enabled on Render.

### 14-Day Owner Conversion Checklist & Daily Scoreboard
- **Day 0 (Immediate Launch Today):** Merge PR #54, trigger Render deploy, verify `GET /` emits `WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I` and `VERIFY-CL-YE94W8YS`, verify Cloudflare Worker cron + `CUELINKS_CHANNEL_ID=331585` daily deal sync, and manually approve & send Drafts 1–5 (`NOT_SENT` -> `SENT`).
- **Days 1–2:** Audit prospects #11–#20 via `/tools/site-audit`; prepare Drafts 6–10 (`Looks Salon`, `A N Bhutada & Co.`, `Vurve Salon`, `Studio ADI`, `Digitalbuddha`).
- **Days 3–5:** Log replies from Wave 1 (Drafts 1–5); send 1-page SiteFix HTML fix-pack previews to positive responders and offer the `₹999` pilot fix-pack checkout (`₹1,499` standard hypothesis).
- **Days 6–8:** Fulfill any paid pilot order within 48h (patched `<head>`, JSON-LD, `robots.txt`, `sitemap.xml`, before/after SiteFix scan), verify bank settlement, and send Wave 2 outreach.
- **Days 9–11:** Follow up once (single polite bump only; honor all opt-outs immediately); review autonomous `/deals` & `/guides/*` outbound human click logs (`verifiedHumanOutboundClicks`) vs Cuelinks transactions.
- **Days 12–14:** Run end-of-sprint commercial retrospective: verified INR settled across SiteFix orders + Cuelinks validated commissions, response rate across sent drafts, and decision on retaining `₹999` vs `₹1,499` pricing.

### Daily Commercial Scoreboard Template

| Day | Date | Autonomous Deal Sync Status | Human Outbound Deal Clicks | Cuelinks Conv / Validated INR | SiteFix Outreach Sent | Positive Replies | SiteFix Paid Orders | Verified Bank Cash (INR) |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Day 0 / 1 | `YYYY-MM-DD` | | | | 5 (Wave 1) | | | |
| Day 2–3 | `YYYY-MM-DD` | | | | | | | |
| Day 4–7 | `YYYY-MM-DD` | | | | | | | |
| Day 8–11 | `YYYY-MM-DD` | | | | | | | |
| Day 12–14 | `YYYY-MM-DD` | | | | | | | |
