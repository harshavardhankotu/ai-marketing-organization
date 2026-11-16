import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { SiteAuditFixPackGenerator } from '../tools/site-audit/site-audit-fixpack-generator.js';
import { TelegramBotAdapter } from '../integrations/telegram-adapter.js';
import { BrevoMcpClient } from '../integrations/brevo-mcp-client.js';
import { getTrustedPublicSiteUrl } from '../config/env.js';

export interface RazorpayStandardOrderParams {
  sku?: string;
  domainOrUrl?: string;
  buyerEmail?: string;
  customerName?: string;
  amountINR?: number;
  notes?: Record<string, string>;
}

export interface RazorpayStandardOrderResult {
  success: boolean;
  keyId: string;
  orderId: string;
  razorpayOrderId: string;
  amount: number; // in paise
  currency: 'INR';
  isTestMode: boolean;
}

export interface RazorpayVerifyParams {
  orderId?: string;
  razorpay_order_id?: string;
  razorpay_payment_id: string;
  razorpay_signature?: string;
  method?: string;
  isWebhook?: boolean;
}

export interface RazorpayVerifyResult {
  success: boolean;
  paymentCaptured?: boolean;
  orderId: string;
  razorpayPaymentId: string;
  status: 'CAPTURED' | 'TEST_CAPTURED';
  downloadUrl?: string;
  mode: 'LIVE' | 'TEST_SANDBOX';
  fulfillmentStatus?: string;
  deliverableStatus?: 'READY' | 'PENDING';
  emailReceiptStatus?: 'SENT' | 'PENDING_RETRY' | 'SKIPPED_UNCONFIGURED';
  retryRequired?: boolean;
  message?: string;
}

export class RazorpayStandardAdapter {
  private static instance: RazorpayStandardAdapter;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): RazorpayStandardAdapter {
    if (!RazorpayStandardAdapter.instance) {
      RazorpayStandardAdapter.instance = new RazorpayStandardAdapter();
    }
    return RazorpayStandardAdapter.instance;
  }

  public static resetInstance(): void {
    (RazorpayStandardAdapter as any).instance = undefined;
  }

  /**
   * Flexible paired credential resolution (Spec Stage P.3.3 Task 4):
   * Key ID and Secret must form a complete, matching pair.
   * Supports optional process.env.RAZORPAY_MODE ('test' or 'live').
   * Supports rzp_test_* in RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET or RAZORPAY_TEST_KEY_ID + RAZORPAY_TEST_KEY_SECRET.
   * Never mixes a key ID from one variable prefix with a secret from another prefix.
   */
  public resolveCredentials(): { keyId: string; keySecret: string; isLive: boolean; mode: 'LIVE' | 'TEST_SANDBOX' } {
    const forcedMode = (process.env.RAZORPAY_MODE || '').trim().toLowerCase();

    const liveKeyId = (process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || '').trim();
    const liveSecret = (process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || '').trim();
    const testKeyId = (process.env.RAZORPAY_TEST_KEY_ID || '').trim();
    const testSecret = (process.env.RAZORPAY_TEST_KEY_SECRET || '').trim();

    const hasLivePair = liveKeyId.startsWith('rzp_live_') &&
      !isPlaceholderCredential(liveKeyId) &&
      liveSecret.length > 0 &&
      !isPlaceholderCredential(liveSecret);

    const hasTestInMainPair = liveKeyId.startsWith('rzp_test_') &&
      !isPlaceholderCredential(liveKeyId) &&
      liveSecret.length > 0 &&
      !isPlaceholderCredential(liveSecret);

    const hasDedicatedTestPair = testKeyId.startsWith('rzp_test_') &&
      !isPlaceholderCredential(testKeyId) &&
      testSecret.length > 0 &&
      !isPlaceholderCredential(testSecret);

    // If forced to test mode
    if (forcedMode === 'test') {
      if (hasDedicatedTestPair) {
        return { keyId: testKeyId, keySecret: testSecret, isLive: false, mode: 'TEST_SANDBOX' };
      }
      if (hasTestInMainPair) {
        return { keyId: liveKeyId, keySecret: liveSecret, isLive: false, mode: 'TEST_SANDBOX' };
      }
    }

    // Default resolution: Live first if available and not forced to test
    if (hasLivePair && forcedMode !== 'test') {
      return { keyId: liveKeyId, keySecret: liveSecret, isLive: true, mode: 'LIVE' };
    }

    // Main pair configured with test keys
    if (hasTestInMainPair) {
      return { keyId: liveKeyId, keySecret: liveSecret, isLive: false, mode: 'TEST_SANDBOX' };
    }

    // Dedicated test pair configured
    if (hasDedicatedTestPair) {
      return { keyId: testKeyId, keySecret: testSecret, isLive: false, mode: 'TEST_SANDBOX' };
    }

    if (!isProduction()) {
      return { keyId: 'rzp_test_sandbox_fallback', keySecret: 'rzp_test_secret_fallback', isLive: false, mode: 'TEST_SANDBOX' };
    }

    throw new Error('PAYMENT_PROVIDER_NOT_CONFIGURED: Valid paired Razorpay credentials (matching key ID and secret) are required.');
  }

  public getCredentialPair(): { keyId: string; keySecret: string; isLive: boolean } {
    const creds = this.resolveCredentials();
    return { keyId: creds.keyId, keySecret: creds.keySecret, isLive: creds.isLive };
  }

  public getKeyId(): string {
    try {
      return this.getCredentialPair().keyId;
    } catch {
      return '';
    }
  }

  public getKeySecret(): string {
    try {
      return this.getCredentialPair().keySecret;
    } catch {
      return '';
    }
  }

  /**
   * Ensures that a genuine customer_journeys record exists for this order before inserting into delivery_tasks.
   * Satisfies the FOREIGN KEY (customer_journey_id) REFERENCES customer_journeys(id) constraint.
   */
  public async ensureCustomerJourney(
    journeyId: string,
    buyerEmail: string,
    customerName: string,
    isLive: boolean,
    stage: string = 'PAYMENT_VERIFIED'
  ): Promise<void> {
    const classification = isLive ? 'REAL' : 'TEST';
    const touchpoints = JSON.stringify([{ channel: 'DIRECT_CHECKOUT', at: new Date().toISOString() }]);

    // Try schema with organization_id first (local SQLite schema.ts)
    try {
      await this.d1Repo.executeWrite(
        'customer_journeys',
        `INSERT INTO customer_journeys (
          id, organization_id, business_id, visitor_id, customer_name,
          customer_email, stage, first_touch_channel, last_touch_channel,
          touchpoints_json, classification, created_at, updated_at
        ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', ?, ?, ?, ?, 'DIRECT_CHECKOUT', 'DIRECT_CHECKOUT', ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          stage = excluded.stage,
          customer_email = excluded.customer_email,
          updated_at = datetime('now')`,
        [journeyId, journeyId, customerName || 'SiteFix Customer', buyerEmail, stage, touchpoints, classification]
      );
    } catch (err: any) {
      if (String(err?.message || '').includes('no such column: organization_id')) {
        await this.d1Repo.executeWrite(
          'customer_journeys',
          `INSERT INTO customer_journeys (
            id, business_id, visitor_id, customer_name,
            customer_email, stage, first_touch_channel, last_touch_channel,
            touchpoints_json, classification, created_at, updated_at
          ) VALUES (?, 'biz_platform_aro', ?, ?, ?, ?, 'DIRECT_CHECKOUT', 'DIRECT_CHECKOUT', ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET
            stage = excluded.stage,
            customer_email = excluded.customer_email,
            updated_at = datetime('now')`,
          [journeyId, journeyId, customerName || 'SiteFix Customer', buyerEmail, stage, touchpoints, classification]
        );
      } else {
        console.error(`[RazorpayAdapter] Failed to ensure customer_journey: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Server-authoritative SKU price resolution (Spec Stage P.3 & P.3.1).
   * Strictly prevents client price tampering and rejects empty/omitted SKUs.
   */
  public resolveAuthoritativePrice(sku?: string, requestedAmountINR?: number): { amountINR: number; amountPaise: number; canonicalSku: string } {
    if (!sku || !String(sku).trim()) {
      throw new Error('INVALID_SKU: SKU is required. Allowed SKUs: sitefix_core_499 (₹499), sitefix_competitor_keyword_pack (₹1,999).');
    }
    const s = String(sku).trim().toLowerCase();

    let expectedINR: number;
    let expectedPaise: number;
    let canonicalSku: string;

    if (s === 'sitefix_competitor_keyword_pack') {
      expectedINR = 1999;
      expectedPaise = 199900;
      canonicalSku = 'sitefix_competitor_keyword_pack';
    } else if (s === 'sitefix_core_499' || s === 'sitefix_ai_pack_v1' || s === 'sitefix_ai_core_fixpack') {
      expectedINR = 499;
      expectedPaise = 49900;
      canonicalSku = 'sitefix_core_499';
    } else {
      throw new Error(`INVALID_SKU: Unknown SKU "${sku}". Allowed SKUs: sitefix_core_499 (₹499), sitefix_competitor_keyword_pack (₹1,999).`);
    }

    if (requestedAmountINR !== undefined && requestedAmountINR !== null) {
      const parsedINR = Number(requestedAmountINR);
      if (!Number.isFinite(parsedINR) || parsedINR !== expectedINR) {
        throw new Error(`INVALID_SKU: Client-tampered amount ₹${requestedAmountINR} does not match authoritative price ₹${expectedINR} for SKU "${canonicalSku}".`);
      }
    }

    return { amountINR: expectedINR, amountPaise: expectedPaise, canonicalSku };
  }

  /**
   * Server-Side Order Creation (POST /api/v1/payments/razorpay/create-order)
   * Calls POST https://api.razorpay.com/v1/orders with Basic Auth
   */
  public async createStandardOrder(params: RazorpayStandardOrderParams): Promise<RazorpayStandardOrderResult> {
    const { amountINR, amountPaise, canonicalSku } = this.resolveAuthoritativePrice(params.sku, params.amountINR);
    const { keyId, keySecret, isLive } = this.getCredentialPair();
    const isTestMode = !isLive;

    const rawDomain = String(params.domainOrUrl || '').trim();
    let cleanDomain = rawDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim().toLowerCase();
    if (!cleanDomain || !cleanDomain.includes('.') || cleanDomain.length < 3) {
      throw new Error('INVALID_DOMAIN: A valid domain or website URL is required.');
    }

    const buyerEmail = String(params.buyerEmail || '').trim().toLowerCase();
    if (!buyerEmail || !buyerEmail.includes('@') || !buyerEmail.includes('.') || buyerEmail.indexOf('@') >= buyerEmail.lastIndexOf('.')) {
      throw new Error('INVALID_EMAIL: A valid buyer email address is required.');
    }

    const internalOrderId = `ord_rzp_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const customerName = String(params.customerName || 'SiteFix Customer').trim();

    let razorpayOrderId = '';

    if (keyId && keySecret && !isPlaceholderCredential(keyId) && !isPlaceholderCredential(keySecret)) {
      const basicAuth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const orderPayload = {
        amount: amountPaise,
        currency: 'INR',
        receipt: internalOrderId.slice(0, 40),
        payment_capture: 1,
        notes: {
          sku: canonicalSku,
          domainOrUrl: cleanDomain,
          buyerEmail,
          internalOrderId,
          ...(params.notes || {})
        }
      };

      try {
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': basicAuth,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(orderPayload),
          signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Razorpay API error (${res.status}): ${errText}`);
        }

        const data = (await res.json()) as any;
        razorpayOrderId = String(data?.id || '').trim();
      } catch (err: any) {
        if (isProduction()) {
          throw new Error(`PAYMENT_PROVIDER_FAULT: Failed to create order with Razorpay: ${err.message}`);
        }
        razorpayOrderId = `order_test_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
      }
    } else {
      razorpayOrderId = `order_test_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    }

    // Persist in D1 universal_orders and customer_journeys (fail-closed)
    const mode = isLive ? 'LIVE' : 'TEST_SANDBOX';
    const journeyId = `cj_rzp_${internalOrderId}`;

    try {
      await this.ensureCustomerJourney(journeyId, buyerEmail, customerName, isLive, 'CHECKOUT_INITIATED');
    } catch (cjErr: any) {
      console.warn(`[RazorpayAdapter] Failed to record initial customer_journey: ${cjErr.message}`);
    }

    const metadataJson = JSON.stringify({
      sku: canonicalSku,
      domainOrUrl: cleanDomain,
      buyerEmail,
      journeyId,
      mode,
      keyId: keyId ? `${keyId.slice(0, 8)}...` : 'NONE',
      notes: params.notes || {}
    });

    try {
      await this.d1Repo.executeWrite(
        'universal_orders',
        `INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name,
          customer_email, customer_phone, amount_minor, currency, status,
          payment_provider, provider_order_id, metadata_json, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', ?, ?, ?, '', ?, 'INR', 'CHECKOUT', 'RAZORPAY', ?, ?, datetime('now'), datetime('now'))`,
        [
          internalOrderId,
          canonicalSku,
          customerName,
          buyerEmail,
          amountPaise,
          razorpayOrderId,
          metadataJson
        ]
      );
    } catch (d1Err: any) {
      console.error(`[RazorpayAdapter] Failed to persist universal_order in D1: ${d1Err.message}`);
      throw new Error(`D1_ORDER_PERSISTENCE_FAILED: Failed to persist order in ledger: ${d1Err.message}`);
    }

    // Also persist in payment_requests (fail-closed in production)
    try {
      await this.d1Repo.executeWrite(
        'payment_requests',
        `INSERT INTO payment_requests (
          id, business_id, organization_id, reference_id, offer_description,
          amount_inr, currency, billing_model, status, classification,
          provider, created_at, updated_at
        ) VALUES (?, 'biz_platform_aro', 'org_owner_primary', ?, ?, ?, 'INR', 'ONE_TIME', 'REQUEST_CREATED', ?, 'RAZORPAY', datetime('now'), datetime('now'))`,
        [
          internalOrderId,
          cleanDomain,
          `SiteFix Fix-Pack (${canonicalSku})`,
          amountINR,
          isLive ? 'REAL' : 'TEST'
        ]
      );
    } catch (prErr: any) {
      console.error(`[RazorpayAdapter] Failed to persist payment_request in D1: ${prErr.message}`);
      if (isProduction()) {
        throw new Error(`D1_ORDER_PERSISTENCE_FAILED: Failed to persist payment_request in ledger: ${prErr.message}`);
      }
    }

    // Send instant Telegram alert for new order creation
    try {
      const tg = TelegramBotAdapter.getInstance();
      tg.sendOwnerAlert(
        `🛍️ <b>New SiteFix Order Created</b>\n\n` +
        `• <b>Order ID:</b> <code>${internalOrderId}</code>\n` +
        `• <b>Razorpay Order:</b> <code>${razorpayOrderId}</code>\n` +
        `• <b>SKU:</b> ${canonicalSku}\n` +
        `• <b>Amount:</b> ₹${amountINR.toLocaleString('en-IN')}\n` +
        `• <b>Domain:</b> ${cleanDomain}\n` +
        `• <b>Customer:</b> ${buyerEmail}\n` +
        `• <b>Mode:</b> ${mode}`
      ).catch(() => {});
    } catch {}

    return {
      success: true,
      keyId: keyId || 'rzp_test_placeholder',
      orderId: internalOrderId,
      razorpayOrderId,
      amount: amountPaise,
      currency: 'INR',
      isTestMode
    };
  }

  /**
   * Cryptographic verification of Razorpay Standard Checkout payment signature.
   * HMAC-SHA256 of (order_id + "|" + razorpay_payment_id) with key_secret.
   */
  public verifyPaymentSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string, secret?: string): boolean {
    if (!razorpayOrderId || !razorpayPaymentId || !signature) return false;
    const keySecret = (secret || this.getKeySecret()).trim();
    if (!keySecret) return false;

    const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expected = createHmac('sha256', keySecret).update(payload).digest('hex');

    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
    } catch {
      return false;
    }
  }

  /**
   * Server-Side Payment Verification & Fulfillment
   * Strict test vs. live separation: rzp_test_ NEVER writes to commission_ledger!
   */
  public async verifyPaymentAndFulfill(params: RazorpayVerifyParams): Promise<RazorpayVerifyResult> {
    const orderId = params.orderId || params.razorpay_order_id;
    const razorpay_order_id = params.razorpay_order_id || params.orderId;
    const { razorpay_payment_id } = params;
    const razorpay_signature = params.razorpay_signature || '';

    if (!orderId || !razorpay_payment_id) {
      throw new Error('MISSING_VERIFICATION_PARAMS: orderId and razorpay_payment_id are required.');
    }

    if (!params.isWebhook) {
      if (!razorpay_signature) {
        throw new Error('MISSING_VERIFICATION_PARAMS: razorpay_signature is required.');
      }
      const keySecret = this.getKeySecret();
      const isSigValid = this.verifyPaymentSignature(razorpay_order_id || orderId, razorpay_payment_id, razorpay_signature, keySecret);
      if (!isSigValid) {
        throw new Error('SECURITY_VIOLATION: Invalid Razorpay payment signature. Verification rejected.');
      }
    }

    // Resolve authoritative order record from D1 universal_orders
    let storedOrder = await this.d1Repo.queryOne<any>(
      'universal_orders',
      'SELECT id, offer_id, amount_minor, customer_email, customer_name, metadata_json, status, fulfillment_status FROM universal_orders WHERE id = ? OR provider_order_id = ? LIMIT 1',
      [orderId, razorpay_order_id]
    );

    if (!storedOrder) {
      const pr = await this.d1Repo.queryOne<any>(
        'payment_requests',
        'SELECT id, reference_id, amount_inr, status FROM payment_requests WHERE id = ? OR reference_id = ? LIMIT 1',
        [orderId, orderId]
      );
      if (pr) {
        storedOrder = {
          id: pr.id,
          offer_id: 'sitefix_core_499',
          amount_minor: Math.round(Number(pr.amount_inr) * 100),
          customer_email: '',
          metadata_json: JSON.stringify({ domainOrUrl: pr.reference_id })
        };
      }
    }

    if (!storedOrder) {
      if (!isProduction() && (orderId.startsWith('order_test_') || orderId.startsWith('ord_test_') || orderId.includes('_test_') || orderId.startsWith('test_'))) {
        storedOrder = {
          id: orderId,
          offer_id: 'sitefix_core_499',
          amount_minor: 49900,
          customer_email: 'test@example.com',
          metadata_json: JSON.stringify({ domainOrUrl: 'test-domain.com', buyerEmail: 'test@example.com' })
        };
      } else {
        throw new Error('ORDER_NOT_FOUND_IN_D1: Order ID not found in database ledger.');
      }
    }

    const verifiedAmountINR = Number(storedOrder.amount_minor || 0) / 100;
    const storedSku = String(storedOrder.offer_id || 'sitefix_core_499');

    let meta: any = {};
    try {
      meta = storedOrder.metadata_json
        ? (typeof storedOrder.metadata_json === 'string' ? JSON.parse(storedOrder.metadata_json) : storedOrder.metadata_json)
        : {};
    } catch {
      meta = {};
    }

    const cleanDomain = String(meta.domainOrUrl || '').trim();
    const buyerEmail = String(storedOrder.customer_email || meta.buyerEmail || '').trim();
    const customerName = String(meta.customerName || (storedOrder as any).customer_name || 'SiteFix Customer').trim();

    if (!cleanDomain) {
      throw new Error('MISSING_ORDER_DOMAIN: Order record does not contain a target domain.');
    }
    if (!buyerEmail || !buyerEmail.includes('@')) {
      throw new Error('MISSING_ORDER_EMAIL: Order record does not contain a valid buyer email address.');
    }

    const { keyId, keySecret, isLive } = this.getCredentialPair();
    const mode: 'LIVE' | 'TEST_SANDBOX' = isLive ? 'LIVE' : 'TEST_SANDBOX';
    const status: 'CAPTURED' | 'TEST_CAPTURED' = isLive ? 'CAPTURED' : 'TEST_CAPTURED';

    const hasRealCredentials = keyId && keySecret && !isPlaceholderCredential(keyId) && !isPlaceholderCredential(keySecret) && !keyId.includes('fallback') && !keySecret.includes('fallback');

    if (hasRealCredentials && !process.env.VITEST) {
      try {
        const basicAuth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const payRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
          headers: { 'Authorization': basicAuth },
          signal: AbortSignal.timeout(15000)
        });
        if (!payRes.ok) {
          const payErr = await payRes.text();
          throw new Error(`Razorpay payment fetch failed (${payRes.status}): ${payErr}`);
        }
        const payment = (await payRes.json()) as any;

        if (payment.order_id && razorpay_order_id && payment.order_id !== razorpay_order_id) {
          throw new Error(`SECURITY_VIOLATION: Razorpay payment order_id mismatch. Expected '${razorpay_order_id}', got '${payment.order_id}'.`);
        }

        const expectedPaise = Math.round(verifiedAmountINR * 100);
        if (payment.amount !== expectedPaise) {
          throw new Error(`SECURITY_VIOLATION: Razorpay payment amount mismatch. Expected ${expectedPaise} paise, got ${payment.amount}.`);
        }

        if (payment.currency !== 'INR') {
          throw new Error(`SECURITY_VIOLATION: Razorpay payment currency mismatch. Expected 'INR', got '${payment.currency}'.`);
        }

        if (payment.status === 'authorized') {
          const capRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}/capture`, {
            method: 'POST',
            headers: { 'Authorization': basicAuth, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: expectedPaise, currency: 'INR' }),
            signal: AbortSignal.timeout(15000)
          });
          if (!capRes.ok) {
            const capErr = await capRes.text();
            throw new Error(`Razorpay capture failed (${capRes.status}): ${capErr}`);
          }
          payment.status = 'captured';
        }

        if (payment.status !== 'captured') {
          throw new Error(`PAYMENT_NOT_CAPTURED: Payment status is '${payment.status}', expected 'captured'.`);
        }
      } catch (fetchErr: any) {
        if (isProduction()) {
          throw new Error(`PAYMENT_PROVIDER_VERIFICATION_FAILED: ${fetchErr.message}`);
        }
      }
    }

    // Step (a): Update D1 universal_orders
    try {
      await this.d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET
          status = ?,
          provider_payment_id = ?,
          updated_at = datetime('now')
        WHERE id = ? OR provider_order_id = ?`,
        [status, razorpay_payment_id, orderId, razorpay_order_id]
      );
    } catch (d1Err: any) {
      console.warn(`[RazorpayAdapter] Failed to update universal_order status: ${d1Err.message}`);
    }

    // STRICT TEST VS. LIVE CASH SEPARATION & IDEMPOTENT ACCOUNTING:
    // Only rzp_live_ verified payments record live cash in transactions / commission_ledger!
    if (isLive) {
      const txId = `tx_rzp_${razorpay_payment_id}`;
      try {
        await this.d1Repo.executeWrite(
          'transactions',
          `INSERT INTO transactions (
            id, organization_id, business_id, invoice_number,
            amount_inr, payment_method, payment_gateway, transaction_ref,
            status, classification, service_rendered, created_at, updated_at
          ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', ?, ?, 'ONLINE', 'RAZORPAY', ?, 'CAPTURED', 'REAL', 'SiteFix AI Technical Fix-Pack', datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')`,
          [txId, orderId, verifiedAmountINR, razorpay_payment_id]
        );
      } catch (txErr: any) {
        console.error(`[RazorpayAdapter] Failed to record transaction in financial ledger: ${txErr.message}`);
        if (isProduction()) {
          throw new Error(`D1_TRANSACTION_PERSISTENCE_FAILED: Failed to record transaction in financial ledger: ${txErr.message}`);
        }
      }
    }

    // Step (b): Generate Fix-Pack deliverable for actual target domain and store signed delivery token
    const siteUrl = getTrustedPublicSiteUrl().replace(/\/$/, '');
    let downloadToken = '';
    let downloadUrl = '';
    let journeyId = meta.journeyId || `cj_rzp_${storedOrder.id || orderId}`;

    try {
      const { SiteAuditService } = await import('../tools/site-audit/site-audit-service.js');
      const auditService = SiteAuditService.getInstance();
      let audit = await auditService.getAuditByDomain(cleanDomain);
      if (!audit) {
        // Run genuine diagnostic scan (never fabricate fake score-55 audit)
        audit = await auditService.runScan(`https://${cleanDomain}`);
        await auditService.persistAuditToD1(audit);
      }

      const resolvedAuditId = audit.auditId || audit.id || `audit_${cleanDomain}`;
      audit.auditId = resolvedAuditId;
      auditService.setAuditInCache(audit);

      downloadToken = auditService.generateSignedDeliveryToken(orderId, resolvedAuditId, razorpay_payment_id, 72);
      downloadUrl = `${siteUrl}/api/v1/offer/download/${encodeURIComponent(downloadToken)}`;

      // Generate deliverable to ensure cache is populated
      await auditService.generateDeliverable(resolvedAuditId, orderId);

      // Task 1: Ensure parent customer_journeys row exists to satisfy FOREIGN KEY constraint
      await this.ensureCustomerJourney(journeyId, buyerEmail, customerName, isLive, 'PAYMENT_VERIFIED');

      // Task 1: Persist in delivery_tasks table with valid customer_journey_id
      const taskId = `deliv_${orderId}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      await this.d1Repo.executeWrite(
        'delivery_tasks',
        `INSERT INTO delivery_tasks (
          id, organization_id, business_id, customer_journey_id,
          service_type, stage, deliverables_json, results_json,
          action_classification, completed_at, created_at
        ) VALUES (?, 'org_owner_primary', 'biz_platform_aro', ?, 'SITE_AUDIT_FIXPACK', 'COMPLETED', ?, ?, 'INTERNAL_AUTOMATION', datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET stage = 'COMPLETED', completed_at = datetime('now')`,
        [
          taskId,
          journeyId,
          JSON.stringify({ auditId: audit.auditId, domain: cleanDomain, downloadToken, sku: storedSku }),
          JSON.stringify({ status: 'DELIVERED', deliveredTo: buyerEmail, paymentId: razorpay_payment_id })
        ]
      );
    } catch (fixPackErr: any) {
      console.error(`[RazorpayAdapter] Fix-Pack generation failed: ${fixPackErr.message}`);
      await this.d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET fulfillment_status = 'PAYMENT_CAPTURED_PENDING_DELIVERY', updated_at = datetime('now') WHERE id = ? OR provider_order_id = ?`,
        [orderId, razorpay_order_id]
      ).catch(() => {});
      return {
        success: true,
        paymentCaptured: true,
        orderId,
        razorpayPaymentId: razorpay_payment_id,
        status,
        mode,
        fulfillmentStatus: 'PAYMENT_CAPTURED_PENDING_DELIVERY',
        deliverableStatus: 'PENDING',
        retryRequired: true,
        message: `Payment captured, deliverable generation pending: ${fixPackErr.message}`
      };
    }

    // Step (c): Send transactional email via Brevo to actual buyer email (Task 2)
    let emailReceiptStatus: 'SENT' | 'PENDING_RETRY' | 'SKIPPED_UNCONFIGURED' = 'PENDING_RETRY';
    const activeBrevoKey = (process.env.BREVO_MCP_SERVER_API || process.env.BREVO_API_KEY || '').trim();
    const isBrevoConfigured = Boolean(activeBrevoKey && !isPlaceholderCredential(activeBrevoKey));

    if (buyerEmail && buyerEmail.includes('@')) {
      try {
        const brevo = BrevoMcpClient.getInstance();
        const emailRes = await brevo.sendTransactionalEmail({
          to: buyerEmail,
          subject: `Payment Receipt & Fix-Pack Download (${orderId})`,
          htmlContent: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
              <h2 style="color:#0f172a;">Thank You for Your Order!</h2>
              <p>Your payment of <strong>₹${verifiedAmountINR.toFixed(2)}</strong> for <strong>${cleanDomain}</strong> was received successfully.</p>
              <p><strong>Order ID:</strong> ${orderId}<br><strong>Payment Ref:</strong> ${razorpay_payment_id}</p>
              <div style="margin:24px 0;">
                <a href="${downloadUrl}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Download Your SiteFix Technical Fix-Pack</a>
              </div>
              <p style="color:#64748b;font-size:12px;">This download link contains your 72-hour cryptographic access token.</p>
              <p style="color:#64748b;font-size:12px;">AI Marketing Organization • Automated Delivery Engine</p>
            </div>
          `
        });

        if (emailRes && emailRes.success === true && emailRes.status === 'SENT') {
          emailReceiptStatus = 'SENT';
        } else {
          emailReceiptStatus = 'PENDING_RETRY';
          console.warn(`[RazorpayAdapter] Brevo receipt send notice: status=${emailRes?.status}, reason=${emailRes?.reason}`);
        }
      } catch (brevoErr: any) {
        console.warn(`[RazorpayAdapter] Brevo receipt send notice: ${brevoErr.message}`);
        emailReceiptStatus = 'PENDING_RETRY';
      }
    } else {
      emailReceiptStatus = isBrevoConfigured ? 'PENDING_RETRY' : 'SKIPPED_UNCONFIGURED';
    }

    // Task 2: State transition
    // Only set fulfillment_status = 'DELIVERED' when real Fix-Pack is stored in delivery_tasks
    // AND (if Brevo configured) email receipt is SENT (otherwise set DELIVERABLE_READY_EMAIL_PENDING)
    const finalFulfillmentStatus = (isBrevoConfigured && emailReceiptStatus !== 'SENT')
      ? 'DELIVERABLE_READY_EMAIL_PENDING'
      : 'DELIVERED';

    const updatedMetadata = JSON.stringify({
      ...meta,
      sku: storedSku,
      domainOrUrl: cleanDomain,
      buyerEmail,
      journeyId,
      deliverable_status: 'READY',
      email_receipt_status: emailReceiptStatus,
      downloadUrl,
      downloadToken
    });

    // Update fulfillment_status and metadata in universal_orders
    try {
      await this.d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET fulfillment_status = ?, metadata_json = ?, updated_at = datetime('now') WHERE id = ? OR provider_order_id = ?`,
        [finalFulfillmentStatus, updatedMetadata, orderId, razorpay_order_id]
      );
    } catch (fulErr: any) {
      console.warn(`[RazorpayAdapter] Failed to update fulfillment_status: ${fulErr.message}`);
    }

    // Instant Telegram Alert for successful payment
    try {
      const tg = TelegramBotAdapter.getInstance();
      tg.sendOwnerAlert(
        `💰 <b>Payment Confirmed (${mode})</b>\n\n` +
        `• <b>Order:</b> <code>${orderId}</code>\n` +
        `• <b>Payment ID:</b> <code>${razorpay_payment_id}</code>\n` +
        `• <b>Domain:</b> ${cleanDomain}\n` +
        `• <b>Customer:</b> ${buyerEmail}\n` +
        `• <b>SKU:</b> ${storedSku}\n` +
        `• <b>Status:</b> ${status}\n` +
        `• <b>Mode:</b> ${mode}\n` +
        `• <b>Fulfillment:</b> ${finalFulfillmentStatus}\n` +
        `• <b>Email Receipt:</b> ${emailReceiptStatus}\n` +
        (isLive ? `• <b>Cash Recognized:</b> ₹${verifiedAmountINR.toFixed(2)}\n` : `• <b>Ledger Note:</b> Sandbox test mode, zero bank revenue recorded\n`) +
        `• <b>Deliverable:</b> <a href="${downloadUrl}">Download Link</a>`
      ).catch(() => {});
    } catch {}

    return {
      success: true,
      paymentCaptured: true,
      orderId,
      razorpayPaymentId: razorpay_payment_id,
      status,
      mode,
      downloadUrl,
      fulfillmentStatus: finalFulfillmentStatus,
      deliverableStatus: 'READY',
      emailReceiptStatus,
      retryRequired: finalFulfillmentStatus !== 'DELIVERED',
      message: finalFulfillmentStatus === 'DELIVERED'
        ? 'Payment verified, deliverable generated, and buyer receipt sent.'
        : 'Payment verified and deliverable generated, but email receipt is pending delivery retry.'
    };
  }
}
