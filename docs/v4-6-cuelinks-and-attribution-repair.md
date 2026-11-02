# V4.6 Cuelinks Consolidation & Dynamic Sub-ID Attribution Repair

**Repository:** `harshavardhankotu/ai-marketing-organization`  
**Date:** November 2026  
**Implementation Files:**
- [`packages/backend/src/commission/cuelinks-v3-client.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/commission/cuelinks-v3-client.ts)
- [`packages/backend/src/commission/cuelinks-sync-manager.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/commission/cuelinks-sync-manager.ts)
- [`packages/backend/src/commission/autonomous-deal-discovery-engine.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/commission/autonomous-deal-discovery-engine.ts)
- [`packages/backend/src/commission/referral-tracking.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/commission/referral-tracking.ts)
- [`packages/backend/src/routes/api.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/routes/api.ts)

---

## 1. Problem Diagnosis & Attribution Gaps

Forensic audit of the commercial engine and Cuelinks integration revealed three major blockers preventing genuine commission attribution and revenue reconciliation:

1. **Dual Cuelinks Sync Pipelines (Redundant Cuelinks API Calls):**
   - In each commercial cycle of `AutonomousCommercialEngine`, Phase 2 executed `AutonomousDealDiscoveryEngine.getInstance().runDiscoveryCycle()`, which scanned Cuelinks campaigns, fetched offers, and reconciled transactions.
   - Immediately following Phase 2, Phase 3 executed `CuelinksSyncManager.getInstance().syncCuelinks()`, which repeated the exact same API calls (ping, channel check, search campaigns, get offers, get transactions).
   - This doubled upstream API load, increased rate-limit risk (HTTP 429), and caused unnecessary execution overhead.

2. **Static Offer Sub-ID Overwrite (Visitor Attribution Blocker):**
   - In `referral-tracking.ts`, the tracking URL generator checked `if (!url.searchParams.has('subid'))`.
   - Because Cuelinks converted links already contained a static offer-level subid (e.g. `subid=aro_deal_123`), the method refused to overwrite it.
   - Consequently, when an individual visitor clicked a deal card, their unique dynamic `clickId` (`clk_1793...`) was NEVER attached to the outgoing redirect!
   - When a purchase occurred, Cuelinks reported the generic deal subid instead of the individual click event, making it impossible to attribute the purchase back to the specific visitor session, landing page, or experiment.

3. **Repeated Link Conversion on Every Scan Cycle:**
   - On every discovery cycle, `convertLink` was called for every product URL discovered, even if the URL had already been converted into an approved tracking link in the previous cycle.
   - This wasted network quotas and delayed discovery cycles.

---

## 2. Implemented Solutions in V4.6

### 2.1 Consolidated Single Pipeline with `syncReconciliationOnly()`
- In `CuelinksSyncManager`:
  - Added options to `syncCuelinks(organizationId, businessId, options)`:
    - `skipOfferFetch?: boolean`: Skips step 4 (offer retrieval and conversion) when deal discovery has already ingested offers in the current cycle.
    - `reconciliationOnly?: boolean`: Skips both campaign search and offer retrieval, focusing strictly on transaction reconciliation and report aggregation.
  - Added dedicated helper `syncReconciliationOnly(organizationId, businessId)`.
- In `AutonomousCommercialEngine`:
  - Phase 3 now invokes `syncMgr.syncCuelinks(organizationId, businessId, { skipOfferFetch: true })`.
  - Phase 2 handles deal discovery; Phase 3 handles authoritative partner status and transactional reconciliation without duplicated network calls.

### 2.2 Dynamic Sub-ID Attribution Hierarchy (Visitor-Level Attribution)
File: [`packages/backend/src/commission/referral-tracking.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/commission/referral-tracking.ts) & [`packages/backend/src/routes/api.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/routes/api.ts)

The destination URL builder was completely refactored to enforce mandatory dynamic click ID replacement:
```typescript
export function buildProviderDestinationUrl(baseUrl: string, clickId: string, params: Record<string, string>): string {
  try {
    const adapter = resolveAffiliateAdapter(baseUrl);
    const url = new URL(adapter.buildTrackedDestination({ baseUrl, clickId }));
    
    // Dynamic individual click attribution: ALWAYS assign unique clickId to subid
    url.searchParams.set('subid', clickId);

    if (params.sectorId) {
      url.searchParams.set('subid2', params.sectorId);
    }
    if (params.campaignId) {
      url.searchParams.set('subid3', params.campaignId);
    }
    if (params.offerId) {
      url.searchParams.set('subid4', params.offerId);
    }
    if (params.placement) {
      url.searchParams.set('subid5', params.placement);
    }

    return url.toString();
  } catch {
    return baseUrl;
  }
}
```

#### The 5-Level Attribution Mapping:
| Parameter | Value Assigned | Commercial Purpose |
|---|---|---|
| `subid` | `clickId` (`clk_1793...`) | **Individual Visitor Attribution:** Reconciles 1-to-1 with `referral_click_events.click_id` |
| `subid2` | `sectorCode` (e.g. `SECTOR_B_CONSUMER_TECH`) | **Sector Performance:** Tracks EPC and conversion rates per commercial sector |
| `subid3` | `affiliateCampaignId` (e.g. `camp_amazon_in`) | **Merchant Campaign Tracking:** Measures merchant EPC and payout reliability |
| `subid4` | `offerId` (e.g. `deal_boat_airdopes_141_anc`) | **Product Level Attribution:** Identifies highest converting specific products |
| `subid5` | `placement` (e.g. `deal_redirect`, `buying_guide`) | **Placement Intelligence:** Tracks which UI placement or channel produced the conversion |

### 2.3 Idempotent Link Conversion Registry
File: [`packages/backend/src/commission/autonomous-deal-discovery-engine.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/src/commission/autonomous-deal-discovery-engine.ts)

- Added an in-memory `linkRegistry: Map<string, { trackingUrl: string; isMonetizable: boolean; affiliateCampaignId?: string }>` to cache link conversions.
- Implemented `convertProductUrlToAffiliate(productUrl, merchant)`:
  - If `productUrl` exists in `linkRegistry`, returns the cached affiliate tracking URL immediately without network latency.
  - If not in registry, converts via `client.convertLink()` and stores the result.
  - If merchant is non-affiliated (e.g. Reliance Digital), caches `isMonetizable: false` so upstream APIs are not repeatedly polled for non-participating retailers.

---

## 3. 1-to-1 Sub-ID Transaction Reconciliation Engine

In `CuelinksSyncManager.syncCuelinks()`:
1. When Cuelinks returns transactions via `/transactions`, the engine extracts `subId` (which contains our `clickId`).
2. The engine looks up the originating click event:
   ```sql
   SELECT * FROM referral_click_events WHERE click_id = ? OR id = ? LIMIT 1
   ```
3. Upserts the record into `commission_records`:
   - Links the transaction to the exact originating `referral_id`, `offer_id`, and `partner_id`.
   - Records `external_transaction_id`, `expected_commission_inr`, and `external_status`.
   - Accurately maps external status:
     - `pending` -> `PENDING`
     - `validated` / `payable` / `approved` -> `VERIFIED`
     - `invoice_raised` -> `INVOICE_RAISED` (Receivable commission, strictly separated from cash)
     - `paid` -> `PAID` (Affiliate network disbursed, pending bank credit)
     - `rejected` -> `REVERSED`

---

## 4. Verification Evidence

Verified via [`packages/backend/tests/unit/v4-6-business-logic-and-queue-repair.test.ts`](file:///C:/Users/vardh/.gemini/antigravity/scratch/ai-marketing-organization/packages/backend/tests/unit/v4-6-business-logic-and-queue-repair.test.ts):
- `buildProviderDestinationUrl sets dynamic subid=clickId and hierarchical subids` (PASS)
- `AutonomousDealDiscoveryEngine link registry caches converted URLs idempotently` (PASS)
- `syncReconciliationOnly invokes sync without fetching offers` (PASS)
- `executes HTTP 302 redirect, attaches subids, and records immutable click event` (PASS)
