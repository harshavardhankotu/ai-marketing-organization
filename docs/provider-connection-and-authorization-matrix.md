# Multi-Sector Provider Connection & Authorization Matrix (V4.2)

This document establishes the verified connection, authorization, fallback, and reconciliation status for all commercial monetization partners, affiliate networks, and direct data feeds integrated into the AI Marketing Organization platform.

---

## 1. Provider Connection Matrix

| Provider / Network | Commercial Sector | Integration Channel | Authorization Method | Required Scopes / Permissions | Status in Code | Production Status & Blocker | Safe Fallback Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Cuelinks India (V3 API)** | Sector A (Jewellery), Sector B (Tech), Sector C (Appliances), Sector D (Travel), Sector G (Lifestyle) | REST API V3 (`https://api.cuelinks.com/v3`) | API Key / Bearer Token (`CUELINKS_API_KEY`) & Channel ID (`CUELINKS_CHANNEL_ID`) | `read:campaigns`<br>`read:offers`<br>`write:links`<br>`read:channels` | **Full Production Integration** (`CuelinksV3Client`, `CuelinksSyncManager`) | Token active; core scopes verified. Resumable cursor pagination active. | Direct merchant route with Sub-ID retention. Renders honest empty state if zero offers. |
| **Amazon Associates India** | Sector B (Electronics), Sector C (Home Appliances), Sector F (Office/Printers) | PA-API 5.0 (`webservices.amazon.in`) | Access Key, Secret Key, Partner Tag (`AMAZON_ASSOCIATES_TAG`) | `ProductAdvertisingAPIv5:GetItems`<br>`SearchItems` | **Client Implemented** (`AmazonAssociatesClient`, `AssociatesComplianceEngine`) | Awaiting owner PA-API production credentials (`PAAPI_KEY`, `PAAPI_SECRET`). | Fail-closed: Never generate Amazon links without valid tag; falls back to Cuelinks Amazon campaign. |
| **India Bullion & Jewellers Association (IBJA)** | Sector A (Precious Metals Benchmark) | Open Data / Public Benchmark Rate Feed (`ibjarates.com`) | Public Promotion / Open Structured Feed | None (Public Daily Reference Standard) | **Integrated in Deal Discovery Engine** (`src_ibja_rates`) | Live in discovery engine. Provides benchmark spot rates for 22K/24K gold and silver. | Fail-closed: Invariant `NO_UNVERIFIED_BENCHMARK_RATES` disables gold deal publishing if benchmark feed unreachable. |
| **Direct Merchant Feeds (Tanishq, CaratLane, BlueStone)** | Sector A (Gold, Silver, Jewellery) | JSON-LD Structured Data & Product Catalog | Public HTML / Microdata Parsing (`@type: Product`, `@type: Offer`) | Public structured metadata consumption | **Integrated in Deal Discovery Engine** (`src_tanishq_in`, `src_caratlane_in`, `src_bluestone_in`) | Live in discovery engine. Discovery adapters scan pricing & making charges. | If affiliate campaign inactive, links route directly to store (`part_direct_merchant`) with zero commission tracking. |
| **Admitad India** | Sector D (Travel), Sector E (SaaS / Web Tools), Sector G (Lifestyle) | REST API V2 | Client ID & Client Secret / OAuth2 Bearer | `advcampaigns`<br>`coupons`<br>`deeplink` | **Taxonomy & Adapter Ready** (`COMMERCIAL_SECTOR_TAXONOMY`) | Planned expansion. Awaiting Admitad India publisher account approval. | Bypassed until credentials supplied. Deals in these categories route via Cuelinks or direct. |
| **EarnKaro** | Sector B (Tech), Sector C (Home & Kitchen), Sector G (Lifestyle) | Profit Link API / Partner Feed | API Key / Publisher Token | `create_profit_link`<br>`deals_feed` | **Taxonomy & Adapter Ready** | Planned expansion. Awaiting EarnKaro API key provisioning. | Route via Cuelinks or direct store link. |
| **vCommission** | Sector D (Travel & Flights), Sector E (Software/BFSI) | Publisher API / Feed | API Key & Affiliate ID | `offers_feed`<br>`click_tracking` | **Taxonomy & Adapter Ready** | Planned expansion. | Route via Cuelinks or direct store link. |
| **Brevo MCP Server & API** | Engine 1 (Asset Delivery), Engine 3 (CRM Sync) | MCP Server (`https://mcp.brevo.com/v1/brevo/mcp`) / REST v3 | API Key (`BREVO_API_KEY`) | `smtp:send`<br>`contacts:write`<br>`deals:write` | **Integrated with Daily Ledger Guard** (`BrevoMcpClient`) | Live-ready. Enforces 200 sends/day cap (on 300 free plan), 2000 contacts, 50 deals. WhatsApp blocked. | Queues overflow messages in D1 (`QUEUED_NEXT_UTC_WINDOW`). |
| **Google Indexing API** | Engine 2 (Commerce Guides), Engine 4 (Syndication) | Google API REST (`indexing.googleapis.com/v3`) | Service Account JWT | `https://www.googleapis.com/auth/indexing` | **Integrated with Strict Schema Gate** (`GoogleIndexingClient`) | Live-ready. Enforces 180 requests/day cap (on 200 free quota). JobPosting & BroadcastEvent only. | Non-eligible pages routed to Sitemap + IndexNow syndication. |

---

## 2. Cuelinks V3 Integration Details

### 2.1 Verified Scopes & Scopes Policy
The Cuelinks V3 API requires distinct scopes depending on the endpoints accessed:
- `read:campaigns`: Required to fetch merchant approval status, commission payouts, and campaign URLs.
- `read:offers`: Required to fetch real-time merchant deals, coupons, and discounts.
- `write:links`: Required to generate monetizable deep links (`c.cuelinks.com`).
- `read:channels`: Required to identify active channels and verify publisher domain authorization.

### 2.2 Empirical Verification Flow
The engine tracks scopes empirically (`CuelinksSyncManager`):
1. Calls to `/v3/campaigns.json` verify `read:campaigns`.
2. Calls to `/v3/offers.json` verify `read:offers`.
3. Calls to `/v3/links.json` verify `write:links`.
4. Calls to `/v3/channels.json` verify `read:channels`.

Any HTTP 403 Forbidden is logged into `forbiddenScopes`, preventing repeated invalid calls. A cycle is marked `PARTIAL` or `COMPLETED_NO_FINDINGS` rather than failing when endpoints are temporarily unavailable.

### 2.3 Resumable Cursor Pagination
To avoid HTTP 500 errors on high page offsets (Cuelinks upstream pagination limit):
- Pagination progresses at up to 2 pages per cycle.
- If upstream returns HTTP 500 or reaches the end of offers, the cursor flags `reachedOfferEnd = true` and cleanly resets to page 1 for the next cycle.
- Cursor state is persistently checkpointed.

---

## 3. Immutable Click Attribution & Conversion Reconciliation

### 3.1 Click Tracking Pipeline
When a user clicks a deal link on `/deals` or a buying guide:
1. User requests `/api/v1/public/deals/:id/redirect`.
2. Server validates destination URL against `DealSsrfGuard`.
3. Server generates unique `clickId` (`clk_<timestamp>_<random>`) and `referralId`.
4. Server appends sub-IDs to Cuelinks tracking URL:
   - `subid`: Unique `clickId`
   - `subid2`: Standardized sector code (e.g. `SECTOR_A_PRECIOUS_METALS`)
   - `subid3`: Internal deal ID
5. Server writes immutable record into `referral_click_events` and `referrals` tables.
6. Server issues HTTP 302 redirect to the destination merchant.

### 3.2 1-to-1 Sub-ID Conversion Reconciliation
When Cuelinks sync runs (`affiliate_offer_reconciliation` or `cuelinks_transaction_sync`):
1. `CuelinksSyncManager` fetches transactions from `/v3/transactions.json`.
2. For each transaction, the engine matches `tx.subid` or `tx.aff_sub` against `referral_click_events.click_id`.
3. If matched, `commission_records` is updated:
   - `status`: Updated from `PENDING` to `VERIFIED` or `PAID`.
   - `verified_commission_inr`: Populated with validated commission.
   - `referral_id`: Linked to internal referral.
4. If no Sub-ID match exists, transaction is recorded as unmatched network revenue with an audit notice.

---

## 4. Cash Integrity & Zero-Fabrication Rules

1. **Bank Cash Invariant:** No commission is recorded as cash until it is credited to the company bank account and verified via statement evidence. All dashboard cash counters display strictly ₹0.00 until bank verification.
2. **Honest Empty State:** When no verified offers are available in a sector, the UI displays:
   `"No currently verified offers are available in this category. Check back later."`
   No mock, synthetic, or fallback deals are rendered.
3. **No Phantom Traffic:** Simulated page views, fake clicks, and mock conversions are strictly prohibited in production.
