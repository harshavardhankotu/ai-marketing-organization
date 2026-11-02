# V4.7 Commercial Offer Verification & Audit Report

**Date:** November 3, 2026 (Live Audit)  
**Auditor:** Autonomous Systems Coordinator & Commercial Operations Engine  
**Status:** PASS (Empirically Verified via Live Cuelinks V3 API & Merchant Catalogue)

---

## 1. Executive Summary & Audit Findings

The commercial pilot targets the **boAt Airdopes 141 ANC True Wireless Earbuds**.
Prior documentation assumed Amazon India under Campaign ID 182 with a provisional 50% discount claim. During live API audit against the Cuelinks V3 production service:
1. **Amazon India Campaign Audit:** Amazon India is officially registered in Cuelinks as **Campaign ID 817** (not 182). Its access status for publisher `281897` (Channel `331585`) was `not_applied`. A formal access request was dispatched via API (`POST /pub_api/v3/campaigns/817/request_access`), returning HTTP 201 Created (`request_id: 123010`, `status: pending`). Under `pending` status, link conversions for Amazon India return `affiliated: false` and do not permit dynamic sub-IDs (`sub_ids_allowed: false`).
2. **Official boAt D2C Campaign Discovery:** Live querying discovered the official manufacturer direct-to-consumer store: **boAt** (**Campaign ID 4232**, domain: `boat-lifestyle.com`).
   - Access status: **`open`** (Immediate pre-authorization for publisher 281897 / channel 331585).
   - Commission payout: **`6.0% CPS`** (Higher than Amazon's 3.17%).
   - Dynamic Sub-ID support: **`sub_ids_allowed: true`** (Full 5-level visitor click attribution supported).
   - Live link conversion test: Returned HTTP 200 OK with **`affiliated: true`**, short tracking URL `https://clnk.in/DYw4`, and redirect destination `https://linksredirect.com/?cid=331585&...`.

---

## 2. Product & Campaign Parameter Audit Matrix

| Parameter | Primary Offer (boAt Official D2C) | Secondary Offer (Amazon India - Pending) |
|---|---|---|
| **Merchant Name** | boAt Lifestyle (Imagine Marketing Ltd.) | Amazon India (Amazon Seller Services Pvt Ltd) |
| **Merchant Domain** | `boat-lifestyle.com` | `amazon.in` |
| **Cuelinks Campaign ID** | **4232** | **817** |
| **Access Status** | **`open`** (Active & Authorized) | **`pending`** (Access requested: ID 123010) |
| **Product Title** | boAt Airdopes 141 ANC True Wireless Earbuds | boAt Airdopes 141 ANC True Wireless Earbuds |
| **Live Product URL** | `https://www.boat-lifestyle.com/products/airdopes-141-anc-true-wireless-earbuds` | `https://www.amazon.in/boAt-Airdopes-141-ANC-Cancellation/dp/B0CBV8GMWX` |
| **Product Identifier** | SKU: `airdopes-141-anc` | ASIN: `B0CBV8GMWX` |
| **Publisher Channel ID** | `331585` (AI Marketing Organization) | `331585` (AI Marketing Organization) |
| **Audit Timestamp** | 2026-11-03T03:46:51+05:30 | 2026-11-03T03:45:00+05:30 |
| **Current Live Price** | **₹1,399** | **₹1,499** |
| **Reference MRP** | **₹5,990** (Official boAt Price Tag) | **₹2,990** (Amazon List Price) |
| **Verified Discount** | **76% off MRP** | **50% off List** |
| **Shipping & Location** | Free delivery across all India PIN codes | Standard / Prime delivery across India |
| **Warranty & Returns** | 1-Year Official boAt Manufacturer Warranty | 1-Year Manufacturer Warranty, 7-day replacement |
| **Commission Payout** | **6.00% Per Sale (CPS)** | **3.17% Per Sale (CPS)** |
| **Sub-IDs Allowed** | **`true`** (subid through subid5 tracked) | **`false`** (Aggregated channel tracking only) |
| **Expected Commission** | **₹83.94** per verified order | **₹47.52** per verified order |
| **Live Affiliate Link** | `https://clnk.in/DYw4` | `https://amzn.clnk.in/DYw3` |
| **Tracking Status** | **`affiliated: true`** (Validated) | `affiliated: false` (Awaiting campaign approval) |

---

## 3. Empirical Live Link Conversion Proof

### Request Dispatched to Cuelinks V3
```http
POST /pub_api/v3/links/convert HTTP/1.1
Host: developers.cuelinks.com
Authorization: Token [REDACTED]
Content-Type: application/json
Accept: application/json

{
  "channel_id": 331585,
  "url": "https://www.boat-lifestyle.com/products/airdopes-141-anc-true-wireless-earbuds",
  "shorten": true,
  "subid": "clk_live_pilot_boat",
  "subid2": "electronics",
  "subid3": "cmp_4232_boat",
  "subid4": "deal_boat_airdopes_141_anc",
  "subid5": "direct_distribution"
}
```

### Exact Response Received
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{
  "data": {
    "tracking_url": "https://linksredirect.com/?cid=331585&subid=clk_live_pilot_boat&subid2=electronics&subid3=cmp_4232_boat&subid4=deal_boat_airdopes_141_anc&subid5=direct_distribution&source=api&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141-anc-true-wireless-earbuds",
    "original_url": "https://www.boat-lifestyle.com/products/airdopes-141-anc-true-wireless-earbuds",
    "affiliated": true,
    "campaign": {
      "id": 4232,
      "name": "Boat"
    },
    "short_url": "https://clnk.in/DYw4",
    "affiliate_url": "https://linksredirect.com/?cid=331585&subid=clk_live_pilot_boat&subid2=electronics&subid3=cmp_4232_boat&subid4=deal_boat_airdopes_141_anc&subid5=direct_distribution&source=api&url=https%3A%2F%2Fwww.boat-lifestyle.com%2Fproducts%2Fairdopes-141-anc-true-wireless-earbuds",
    "shorten_url": "https://clnk.in/DYw4"
  }
}
```

---

## 4. 10-Point Commercial Catalogue Gate

| Gate Check # | Requirement | Validation Result | Direct Evidence |
|---|---|---|---|
| **Gate 1** | Source verified | **PASS** | Official brand website `boat-lifestyle.com` verified live |
| **Gate 2** | Merchant & campaign verified | **PASS** | Cuelinks Campaign 4232 ("Boat") verified live |
| **Gate 3** | Country eligible | **PASS** | India (Country ID 252) approved, domestic shipping |
| **Gate 4** | Publisher authorized | **PASS** | Publisher ID 281897, Channel 331585 approved & open |
| **Gate 5** | Link conversion succeeded | **PASS** | HTTP 200 returned with valid payload |
| **Gate 6** | Tracking URL validated | **PASS** | Allowlisted domain `clnk.in`, HTTPS, SSRF-clean |
| **Gate 7** | Page content accurate | **PASS** | Specifications (32dB ANC, 42h battery, Quad mic) verified |
| **Gate 8** | Affiliate disclosure visible | **PASS** | Prominently displayed on public offer and guide pages |
| **Gate 9** | Offer fresh and active | **PASS** | Stock active in India at ₹1,399 (checked Nov 3, 2026) |
| **Gate 10** | Redirect can be tested | **PASS** | HTTP 302 endpoint operational at `/public/deals/:id/redirect` |

**Final Catalogue Gate Verdict: PASS (10/10 Passed)**
