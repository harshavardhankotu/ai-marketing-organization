# 10_p0_defects.md — Confirmed and Suspected P0 Production Defects

Audit Date: 2026-11-08  
Repository: `https://github.com/harshavardhankotu/ai-marketing-organization`  
Branch: `main` (`b4ee6e5fc58960de48dfa61fa79aff20d5f83e17`)  
Deployment: Render Production (`srv-darecoc9v7es73ea8t2g`)  
Rule: **Read-Only Audit — Zero Code or DB Modifications Made**

---

### Defect 1: `/webhooks/razorpay` Route Crashes in Production on Synchronous DB Read & Missing Table
- **Severity:** P0 — Fatal Runtime Crash / Payment Loss
- **Classification:** CONFIRMED DEFECT
- **File & Line Numbers:**  
  `packages/backend/src/integrations/razorpay.ts:1152-1158`, `packages/backend/src/integrations/razorpay.ts:86-90`, `packages/backend/src/integrations/razorpay.ts:1221`
- **Code Snippet:**
  ```typescript
  // packages/backend/src/integrations/razorpay.ts:86-90
  get: (...params: any[]) => {
    if (isProduction() && !process.env.VITEST) {
      throw new Error(`PRODUCTION D1 ERROR: Synchronous get() is prohibited in RazorpayAdapter in production. All reads must go through D1.`);
    }
    return getDb().prepare(sql).get(...params) as any;
  }

  // packages/backend/src/integrations/razorpay.ts:1152-1158
  if (providerLinkId) {
    storedLink = this.db.prepare(`SELECT * FROM payment_provider_links WHERE provider_link_id = ?`).get(providerLinkId) as any;
    storedPayReq = this.db.prepare(`SELECT * FROM payment_requests WHERE provider_link_id = ?`).get(providerLinkId) as any;
  }
  if (orderId) {
    storedOrder = this.db.prepare(`SELECT * FROM payment_orders WHERE order_id = ?`).get(orderId) as any;
  }

  // packages/backend/src/integrations/razorpay.ts:1221
  await this.d1Repo.executeWrite(
    'idempotent_actions',
    `INSERT INTO idempotent_actions (idempotency_key, action_type, target_id, tenant_id, executed_at, status, result_json) ...`
  );
  ```
- **Reproduction Steps:**
  1. Transmit an authentic, cryptographically signed Razorpay webhook event (`payment.captured` or `order.paid`) to `POST https://ai-marketing-organization.onrender.com/webhooks/razorpay`.
  2. The route invokes `razorpayAdapter.processWebhook()`.
  3. Lines 1152-1158 invoke `this.db.prepare().get()`, which in production immediately throws `PRODUCTION D1 ERROR: Synchronous get() is prohibited in RazorpayAdapter in production`.
  4. Even if that read were bypassed, line 1221 attempts to insert into `idempotent_actions`, a table that does not exist in Cloudflare D1 (`prod-db`), causing a second fatal database rejection (`SQLITE_ERROR: no such table: idempotent_actions`).
- **Impact:** Live customer payments processed through Razorpay's main webhook endpoint are dropped with HTTP 500/400 errors, never verified, and never credited to customer accounts.

---

### Defect 2: Credential Pair-Isolation Failure / Potential Test & Live Credential Mixing
- **Severity:** P0 — Financial Security & Compliance Violation
- **Classification:** CONFIRMED DEFECT
- **File & Line Numbers:**  
  `packages/backend/src/integrations/razorpay.ts:110-120`
- **Code Snippet:**
  ```typescript
  // packages/backend/src/integrations/razorpay.ts:110-120
  public getKeyId(): string {
    return (process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_TEST_KEY_ID || '').trim();
  }

  public getKeySecret(): string {
    return (process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET || '').trim();
  }

  private getWebhookSecret(): string {
    return (process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_TEST_WEBHOOK_SECRET || '').trim();
  }
  ```
- **Reproduction Steps:**
  1. Configure an environment containing `RAZORPAY_KEY_ID=rzp_live_abcd1234` (live Key ID) and `RAZORPAY_TEST_KEY_SECRET=rzp_sec_test5678` (test Key Secret).
  2. Invoke `razorpayAdapter.getKeyId()` -> Returns live key `rzp_live_abcd1234`.
  3. Invoke `razorpayAdapter.getKeySecret()` -> Falls back to test secret `rzp_sec_test5678`.
  4. Outbound calls to `https://api.razorpay.com/v1/orders` transmit an invalid hybrid credential (`rzp_live_...:rzp_sec_test_...`), failing upstream authentication.
  5. Contrast with `packages/backend/src/integrations/razorpay-test-service.ts:35-42`, which explicitly enforces strict isolation: `"Never combines a generic/live Key ID with a Test Key Secret."`
- **Impact:** Misconfigured or partially set deployment secrets cause silent cross-environment credential contamination and unhandled 401 Unauthorized API failures.

---

### Defect 3: Outbound Referral Redirects (`/r/:offerSlug/:referralId`) Reuse Statically Stored sub-IDs Across All Visitors
- **Severity:** P0 — Commercial Revenue Loss & Attribution Corruption
- **Classification:** CONFIRMED DEFECT
- **File & Line Numbers:**  
  `packages/backend/src/commission/referral-tracking.ts:388-413`, `packages/backend/src/routes/api.ts:6512-6513`
- **Code Snippet:**
  ```typescript
  // packages/backend/src/commission/referral-tracking.ts:388-402
  let referral = await this.getReferral(referralIdOrClickId);
  if (!referral) {
    referral = await this.getReferralByClickId(referralIdOrClickId);
  }

  // packages/backend/src/routes/api.ts:6512-6513
  const result = await trackingEngine.resolveReferralClick(offerSlug, referralId, clickData);
  return c.redirect(result.destinationUrl, 302);
  ```
- **Reproduction Steps:**
  1. Create a referral link for an affiliate offer (e.g. `ref_1234567890`), which embeds an initial click ID in `referral.destinationUrl` (e.g. `https://clnk.in/DKX3?subid=clk_abc123`).
  2. Visitor A clicks `/r/akasa-air/ref_1234567890` -> Redirected to `https://clnk.in/DKX3?subid=clk_abc123`.
  3. Visitor B clicks `/r/akasa-air/ref_1234567890` -> `resolveReferralClick` retrieves the stored `referral` from D1 and redirects Visitor B to the *exact same* URL with the *same* `subid=clk_abc123`.
  4. When Visitor A and Visitor B both complete bookings on the affiliate merchant site, the affiliate network (Cuelinks) receives duplicate sub-IDs (`subid=clk_abc123`).
- **Impact:** Downstream affiliate tracking attributes all conversions to a single sub-ID, causing duplicate click collision, transaction rejection, and permanent loss of affiliate commission reconciliation.

---

### Defect 4: Click Classification Query Mismatch Permanently Sets `verifiedHumanOutboundClicks` to Zero
- **Severity:** P0 — Metric & Funnel Telemetry Corruption
- **Classification:** CONFIRMED DEFECT
- **File & Line Numbers:**  
  `packages/backend/src/routes/api.ts:5902`, `packages/backend/src/routes/api.ts:6507`
- **Code Snippet:**
  ```typescript
  // packages/backend/src/routes/api.ts:6507 (Redirect Route)
  deviceClass: c.req.header('sec-ch-ua-mobile') === '?1' 
    ? 'mobile' 
    : (c.req.header('user-agent')?.includes('Mobile') ? 'mobile' : 'desktop'),

  // packages/backend/src/routes/api.ts:5902 (Funnel Telemetry Query)
  COALESCE(SUM(CASE WHEN device_class = 'human' AND NOT ${diagnosticCond} THEN 1 ELSE 0 END), 0) as human,
  COALESCE(SUM(CASE WHEN (device_class = 'unknown' OR device_class IS NULL) AND NOT ${diagnosticCond} THEN 1 ELSE 0 END), 0) as unk
  ```
- **Reproduction Steps:**
  1. A real human mobile user opens a referral link `/r/:slug/:id`.
  2. The route records `device_class: 'mobile'` (or `'desktop'`) in `referral_click_events`.
  3. Query `GET /api/v1/public/revenue-funnel`.
  4. The query filters `device_class = 'human'` to calculate `verifiedHumanOutboundClicks`.
  5. Because `/r/` writes `'mobile'` or `'desktop'` and never writes `'human'`, the sum evaluates to `0`.
  6. The click falls through into the `unknownClicks` bucket (`unk`).
- **Impact:** `externalOutboundClicks` and `verifiedHumanOutboundClicks` permanently report `0`, giving a false metric of `0.00% CTR` even when real visitors click outbound links.

---

### Defect 5: Silent Swallowing of D1 Database Failures in Owner Outreach Endpoints
- **Severity:** P0 — Silent Data Loss & False 404 Statuses
- **Classification:** CONFIRMED DEFECT
- **File & Line Numbers:**  
  `packages/backend/src/routes/api.ts:8475-8482`, `packages/backend/src/routes/api.ts:8531-8538`
- **Code Snippet:**
  ```typescript
  // packages/backend/src/routes/api.ts:8475-8482
  let rows: any[] = [];
  try {
    rows = await d1Repo.query<any>('direct_outreach_log', sql);
  } catch (err: any) {
    try {
      const db = getDb();
      rows = db.prepare(sql).all() as any[];
    } catch {}
  }

  // packages/backend/src/routes/api.ts:8531-8538
  let draft: any;
  try {
    draft = await d1Repo.queryOne<any>('direct_outreach_log', 'SELECT * FROM direct_outreach_log WHERE id = ?', [id]);
  } catch {}
  if (!draft) {
    try {
      draft = db.prepare('SELECT * FROM direct_outreach_log WHERE id = ?').get(id);
    } catch {}
  }
  if (!draft) {
    return c.json({ success: false, error: 'Draft not found' }, 404);
  }
  ```
- **Reproduction Steps:**
  1. If Cloudflare D1 experiences transient network throttling or authentication expiry, `d1Repo.query()` throws.
  2. In production, `getDb()` either accesses an unmigrated in-memory SQLite store or fails.
  3. The `catch {}` block completely swallows the exception.
  4. In `GET /owner/direct-outreach`, it returns `{ success: true, count: 0, data: [] }` (falsely indicating 0 drafts exist).
  5. In `POST /owner/direct-outreach/:id/approve`, it returns `{ success: false, error: 'Draft not found' }` with HTTP 404, when the record actually exists in D1.
- **Impact:** Prevents the business owner from reviewing or approving outreach drafts during transient database errors, silently masking fatal connectivity failures.

---

### Defect 6: Google PageSpeed Keyless Fallback Fails Globally with HTTP 429
- **Severity:** P0 — External Service Unavailability
- **Classification:** CONFIRMED DEFECT
- **File & Line Numbers:**  
  `packages/backend/src/integrations/google-pagespeed-client.ts:50-95`, `evidence/09_sitefix_check.md`
- **Code Snippet:**
  ```http
  HTTP/1.1 429 Too Many Requests
  {
    "error": {
      "code": 429,
      "message": "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'pagespeedonline.googleapis.com' for consumer 'project_number:583797351490'.",
      "status": "RESOURCE_EXHAUSTED",
      "details": [{ "quota_limit_value": "0" }]
    }
  }
  ```
- **Reproduction Steps:**
  1. No `GOOGLE_PAGESPEED_API_KEY` is configured in `.env*`.
  2. The client initiates keyless GET request to `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed`.
  3. Google rejects all unauthenticated queries for consumer project `583797351490` because the default unauthenticated quota is `0 queries/day`.
- **Impact:** Live audits on external domains fail to collect PageSpeed scores; `site_audits.pagespeed_status` remains at `0` completed audits.
