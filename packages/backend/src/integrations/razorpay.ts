import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { RevenueReconciliationEngine } from '../revenue/revenue-reconciliation.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { PaymentMethod, DataClassification } from '@ai-marketing/shared';
import { isPlaceholderCredential, isProduction } from '../config/env.js';

export interface RazorpayOrderInput {
  businessId: string;
  journeyId?: string;
  amountINR: number;
  receipt?: string;
  service?: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  orderId: string;
  amountINR: number;
  currency: string;
  receipt: string;
  status: string;
  keyId: string;
}

export interface RazorpayPaymentLinkInput {
  organizationId: string;
  businessId: string;
  prospectId?: string;
  journeyId?: string;
  proposalId?: string;
  amountINR: number;
  description: string;
  customer?: {
    name?: string;
    email?: string;
    contact?: string;
  };
}

export interface RazorpayPaymentLinkResult {
  id: string;
  providerLinkId: string;
  shortUrl: string;
  referenceId: string;
  amountINR: number;
  currency: string;
  status: string;
}

export interface ManualUpiClaimInput {
  businessId: string;
  journeyId?: string;
  utr: string;
  amountINR: number;
  serviceRendered?: string;
  notes?: string;
}

export class RazorpayAdapter {
  private get db() {
    return getDb();
  }

  private revenueEngine = new RevenueReconciliationEngine();
  private journeyTracker = new CustomerJourneyTracker();

  // Standard server-side deposit policies
  public static readonly STANDARD_CONSULTATION_DEPOSIT_INR = 500;
  public static readonly PLATFORM_SETUP_FEE_INR = 15000;
  public static readonly PLATFORM_MONTHLY_FEE_INR = 8000;

  public getKeyId(): string {
    return (process.env.RAZORPAY_KEY_ID || '').trim();
  }

  public getKeySecret(): string {
    return (process.env.RAZORPAY_KEY_SECRET || '').trim();
  }

  private getWebhookSecret(): string {
    return (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
  }

  public isLiveConfigured(): boolean {
    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    return Boolean(
      keyId &&
      keySecret &&
      !isPlaceholderCredential(keyId) &&
      !isPlaceholderCredential(keySecret) &&
      !keyId.startsWith('rzp_test_') &&
      !keyId.includes('sandbox')
    );
  }

  public hasAnyValidCredentials(): boolean {
    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    return Boolean(keyId && keySecret && !isPlaceholderCredential(keyId) && !isPlaceholderCredential(keySecret));
  }

  /**
   * Evaluates whether the payment gateway is verified in live production with active KYC.
   * If not explicitly verified with live credentials, classification is strictly TEST.
   */
  private getClassification(): DataClassification {
    return this.isLiveConfigured() && isProduction() ? 'REAL' : 'TEST';
  }

  /**
   * Validates server-side permitted deposit amount.
   * A client cannot send arbitrary amounts (e.g. changing ₹500 to ₹1).
   */
  public validatePermittedDeposit(amountINR: number, serviceName?: string): void {
    const rounded = Math.round(amountINR);
    const permittedAmounts = [
      RazorpayAdapter.STANDARD_CONSULTATION_DEPOSIT_INR, // 500
      1500,
      2999,
      RazorpayAdapter.PLATFORM_MONTHLY_FEE_INR, // 8000
      RazorpayAdapter.PLATFORM_SETUP_FEE_INR, // 15000
      RazorpayAdapter.PLATFORM_SETUP_FEE_INR + RazorpayAdapter.PLATFORM_MONTHLY_FEE_INR, // 23000
      45000, // Aligners deposit
      50000  // Comprehensive procedure deposit
    ];

    if (!permittedAmounts.includes(rounded)) {
      throw new Error(
        `PAYMENT_TAMPER_DETECTED: Requested amount ₹${amountINR} is not a valid authorized deposit. Permitted amounts: ₹${permittedAmounts.join(', ₹')}`
      );
    }
  }

  /**
   * Cryptographically verifies Razorpay webhook signature using HMAC-SHA256.
   */
  public verifyWebhookSignature(rawBody: string, signature: string, secret?: string): boolean {
    if (!rawBody || !signature) return false;
    const webhookSecret = (secret || this.getWebhookSecret()).trim();

    if (isProduction()) {
      if (!webhookSecret || isPlaceholderCredential(webhookSecret)) {
        console.error(
          '[SECURITY VIOLATION] Razorpay webhook signature rejected in production: ' +
          'RAZORPAY_WEBHOOK_SECRET is missing or matches a known default/placeholder secret.'
        );
        return false;
      }
    }

    const effectiveSecret = webhookSecret || 'unverified_webhook_hmac_secret';
    const expected = createHmac('sha256', effectiveSecret).update(rawBody).digest('hex');

    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Cryptographically verifies Razorpay Standard Checkout payment signature.
   * HMAC-SHA256 of (order_id + "|" + razorpay_payment_id) with key_secret.
   */
  public verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret?: string): boolean {
    if (!orderId || !paymentId || !signature) return false;
    const keySecret = (secret || this.getKeySecret()).trim();

    if (isProduction()) {
      if (!keySecret || isPlaceholderCredential(keySecret)) {
        console.error(
          '[SECURITY VIOLATION] Razorpay payment signature rejected in production: ' +
          'RAZORPAY_KEY_SECRET is missing or matches a known default/placeholder secret.'
        );
        return false;
      }
    }

    const effectiveSecret = keySecret || 'unverified_sandbox_secret';
    const payload = `${orderId}|${paymentId}`;
    const expected = createHmac('sha256', effectiveSecret).update(payload).digest('hex');

    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Creates a payment order via Razorpay Orders API.
   * In production: calls real Razorpay endpoint https://api.razorpay.com/v1/orders
   * Never creates fake order_${Date.now()} in production!
   */
  public async createPaymentOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResult> {
    if (!input.amountINR || input.amountINR <= 0) {
      throw new Error('Payment order amount must be greater than ₹0.');
    }

    // Server-side validation of permitted deposit amount
    this.validatePermittedDeposit(input.amountINR, input.service);

    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const amountPaise = Math.round(input.amountINR * 100);
    const receipt = input.receipt || `rcpt_${randomUUID().substring(0, 8)}`;

    let orderId: string;
    let orderStatus = 'created';

    // If live or sandbox credentials exist, call Razorpay Orders API
    if (this.hasAnyValidCredentials()) {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const payload = {
        amount: amountPaise,
        currency: 'INR',
        receipt,
        notes: {
          business_id: input.businessId,
          journey_id: input.journeyId || '',
          service: input.service || 'Consultation Deposit',
          ...(input.notes || {})
        }
      };

      try {
        const res = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Razorpay API error (${res.status}): ${errText}`);
        }

        const data = await res.json() as any;
        orderId = data.id; // Real Razorpay order ID (e.g. order_...)
        orderStatus = data.status || 'created';
      } catch (err: any) {
        if (isProduction()) {
          throw new Error(`PAYMENT_PROVIDER_FAULT: Could not create real Razorpay order in production: ${err.message}`);
        }
        console.warn(`[RazorpayAdapter] Live order creation failed in dev/test (${err.message}). Using test sandbox order.`);
        orderId = `order_test_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
      }
    } else {
      if (isProduction()) {
        throw new Error(
          'CREDENTIAL_FAULT: Production payment orders require valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Simulated orders are prohibited.'
        );
      }
      // Non-production test environment fallback
      orderId = `order_test_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
    }

    const id = `po_${randomUUID().substring(0, 10)}`;

    this.db
      .prepare(
        `INSERT INTO payment_orders (
          id, business_id, journey_id, order_id, amount_inr, currency,
          status, receipt, notes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        id,
        input.businessId,
        input.journeyId || null,
        orderId,
        input.amountINR,
        orderStatus.toUpperCase(),
        receipt,
        input.notes ? JSON.stringify(input.notes) : null
      );

    return {
      orderId,
      amountINR: input.amountINR,
      currency: 'INR',
      receipt,
      status: orderStatus,
      keyId: keyId || 'rzp_test_placeholder'
    };
  }

  /**
   * Creates a real Razorpay UPI Payment Link (Spec § 11 & § 12).
   * Calls POST https://api.razorpay.com/v1/payment_links with upi_link=true.
   * Stores real short_url in payment_provider_links.
   */
  public async createPaymentLink(input: RazorpayPaymentLinkInput): Promise<RazorpayPaymentLinkResult> {
    if (!input.amountINR || input.amountINR <= 0) {
      throw new Error('Payment link amount must be greater than ₹0.');
    }

    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const amountPaise = Math.round(input.amountINR * 100);
    const referenceId = `ref_${randomUUID().substring(0, 12)}`;

    let providerLinkId: string;
    let shortUrl: string;
    let status = 'CREATED';
    let rawResponse = '{}';

    if (this.hasAnyValidCredentials()) {
      const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const payload: any = {
        amount: amountPaise,
        currency: 'INR',
        accept_partial: false,
        reference_id: referenceId,
        description: input.description,
        upi_link: true,
        notify: {
          sms: true,
          email: true
        },
        notes: {
          organization_id: input.organizationId,
          business_id: input.businessId,
          proposal_id: input.proposalId || '',
          prospect_id: input.prospectId || ''
        }
      };

      if (input.customer) {
        payload.customer = {
          name: input.customer.name,
          contact: input.customer.contact,
          email: input.customer.email
        };
      }

      try {
        const res = await fetch('https://api.razorpay.com/v1/payment_links', {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Razorpay Payment Links API error (${res.status}): ${errText}`);
        }

        const data = await res.json() as any;
        providerLinkId = data.id; // e.g. plink_...
        shortUrl = data.short_url; // Real provider URL returned by Razorpay
        status = (data.status || 'CREATED').toUpperCase();
        rawResponse = JSON.stringify(data);
      } catch (err: any) {
        if (isProduction()) {
          throw new Error(`PAYMENT_PROVIDER_FAULT: Could not create real Razorpay payment link in production: ${err.message}`);
        }
        console.warn(`[RazorpayAdapter] Live payment link creation failed in dev/test (${err.message}). Using test link.`);
        providerLinkId = `plink_test_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
        shortUrl = `https://rzp.io/i/test_${randomUUID().substring(0, 6)}`;
      }
    } else {
      if (isProduction()) {
        throw new Error(
          'CREDENTIAL_FAULT: Production payment links require valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
        );
      }
      providerLinkId = `plink_test_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
      shortUrl = `https://rzp.io/i/test_${randomUUID().substring(0, 6)}`;
    }

    const id = `ppl_${randomUUID().substring(0, 10)}`;

    this.db
      .prepare(`
        INSERT INTO payment_provider_links (
          id, organization_id, business_id, prospect_id, journey_id, proposal_id,
          provider, provider_link_id, short_url, reference_id, amount_inr,
          currency, status, created_at, provider_response_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'RAZORPAY', ?, ?, ?, ?, 'INR', ?, datetime('now'), ?)
      `)
      .run(
        id,
        input.organizationId,
        input.businessId,
        input.prospectId || null,
        input.journeyId || null,
        input.proposalId || null,
        providerLinkId,
        shortUrl,
        referenceId,
        input.amountINR,
        status,
        rawResponse
      );

    return {
      id,
      providerLinkId,
      shortUrl,
      referenceId,
      amountINR: input.amountINR,
      currency: 'INR',
      status
    };
  }

  /**
   * Confirms payment received from client checkout (Razorpay / UPI), verifies signature,
   * validates against stored order, records transaction with strict classification.
   *
   * Spec § 8: order_id is the AUTHORITATIVE source for business_id, amount, journey_id.
   */
  public async confirmClientPayment(params: {
    orderId: string;
    paymentId: string;
    signature: string;
    method?: PaymentMethod;
    secret?: string;
    classification?: DataClassification;
  }): Promise<{
    success: boolean;
    transactionId?: string;
    amountINR?: number;
    journeyId?: string;
    error?: string;
  }> {
    // 1. Look up authoritative stored order
    const order = this.db
      .prepare('SELECT * FROM payment_orders WHERE order_id = ?')
      .get(params.orderId) as any;

    if (!order) {
      throw new Error(`PAYMENT_VERIFICATION_REJECTED: Stored order not found for order_id: ${params.orderId}`);
    }

    // 2. Cryptographic signature check
    const isSigValid = this.verifyPaymentSignature(
      params.orderId,
      params.paymentId,
      params.signature,
      params.secret
    );

    if (!isSigValid) {
      throw new Error('SECURITY VIOLATION: Invalid Razorpay payment signature. Payment verification failed.');
    }

    // 3. Extract authoritative attributes from stored order
    const businessId = order.business_id;
    const journeyId = order.journey_id || undefined;
    const amountINR = order.amount_inr;
    const paymentMethod: PaymentMethod = params.method || 'UPI';
    const classification = params.classification || this.getClassification();

    // 4. Idempotency check: don't process same payment ID twice
    const existingTx = this.db
      .prepare('SELECT id FROM transactions WHERE transaction_ref = ?')
      .get(params.paymentId) as any;

    if (existingTx) {
      return {
        success: true,
        transactionId: existingTx.id,
        amountINR,
        journeyId
      };
    }

    // 5. Update payment order status to PAID
    this.db
      .prepare(
        `UPDATE payment_orders 
         SET status = 'PAID', payment_id = ?, updated_at = datetime('now')
         WHERE order_id = ?`
      )
      .run(params.paymentId, params.orderId);

    // 6. Record transaction
    const tx = this.revenueEngine.recordTransaction({
      businessId,
      journeyId,
      invoiceNumber: `INV-RZP-${Date.now()}`,
      amountINR,
      paymentMethod,
      paymentGateway: 'RAZORPAY',
      transactionRef: params.paymentId,
      status: 'SUCCESS',
      classification,
      serviceRendered: 'Consultation Deposit & 3D Assessment'
    });

    // 7. Advance Customer Journey if associated
    if (journeyId) {
      const jRow = this.db
        .prepare('SELECT * FROM customer_journeys WHERE id = ?')
        .get(journeyId) as any;

      if (jRow && jRow.stage !== 'CUSTOMER') {
        this.journeyTracker.advanceStage({
          businessId,
          visitorId: jRow.visitor_id,
          targetStage: 'CUSTOMER'
        });
      }
    }

    return {
      success: true,
      transactionId: tx.id,
      amountINR: tx.amountINR,
      journeyId
    };
  }

  /**
   * Records a customer-claimed manual UPI payment (Spec § 15 & § 18).
   * Status is set to PAYMENT_CLAIMED, NOT verified revenue!
   */
  public recordManualUpiClaim(input: ManualUpiClaimInput): {
    claimId: string;
    status: 'PAYMENT_CLAIMED';
    utr: string;
    amountINR: number;
  } {
    const trimmedUtr = (input.utr || '').trim();
    if (!trimmedUtr || trimmedUtr.length < 6 || trimmedUtr.startsWith('utr_')) {
      throw new Error('INVALID_UTR: Please provide a valid bank UTR / transaction reference (min 6 characters). Auto-generated UTRs are rejected.');
    }

    // Validate business exists
    const biz = this.db.prepare('SELECT id, organization_id FROM businesses WHERE id = ?').get(input.businessId) as any;
    if (!biz) {
      throw new Error(`BUSINESS_NOT_FOUND: Business ${input.businessId} does not exist.`);
    }

    // Validate deposit amount
    this.validatePermittedDeposit(input.amountINR, input.serviceRendered);

    const claimId = `claim_upi_${randomUUID().substring(0, 10)}`;

    this.db.prepare(`
      INSERT INTO manual_upi_claims (
        id, organization_id, business_id, journey_id, utr,
        amount_inr, service_rendered, status, claimed_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PAYMENT_CLAIMED', datetime('now'), ?)
    `).run(
      claimId,
      biz.organization_id,
      input.businessId,
      input.journeyId || null,
      trimmedUtr,
      input.amountINR,
      input.serviceRendered || 'Manual UPI Payment Claim',
      input.notes || null
    );

    return {
      claimId,
      status: 'PAYMENT_CLAIMED',
      utr: trimmedUtr,
      amountINR: input.amountINR
    };
  }

  /**
   * Owner-Only Manual UPI Confirmation (Spec § 15 & § 18).
   * Changes status to HUMAN_VERIFIED_PAYMENT and records HUMAN_VERIFIED_REVENUE.
   */
  public confirmManualUpiClaim(params: {
    claimId?: string;
    utr: string;
    businessId: string;
    amountINR: number;
    journeyId?: string;
    ownerUserId: string;
    organizationId: string;
    invoiceNumber?: string;
    serviceRendered?: string;
  }): {
    success: boolean;
    transactionId: string;
    classification: 'MANUAL_VERIFIED';
    status: 'HUMAN_VERIFIED_PAYMENT';
  } {
    const trimmedUtr = params.utr.trim();
    if (!trimmedUtr || trimmedUtr.startsWith('utr_')) {
      throw new Error('INVALID_UTR: Manual verification requires a verified banking UTR.');
    }

    // Check existing transaction
    const existing = this.db.prepare('SELECT id FROM transactions WHERE transaction_ref = ?').get(trimmedUtr) as any;
    if (existing) {
      return {
        success: true,
        transactionId: existing.id,
        classification: 'MANUAL_VERIFIED',
        status: 'HUMAN_VERIFIED_PAYMENT'
      };
    }

    // Update claim status if row exists
    if (params.claimId) {
      this.db.prepare(`
        UPDATE manual_upi_claims
        SET status = 'HUMAN_VERIFIED_PAYMENT', verified_at = datetime('now'), verified_by = ?
        WHERE id = ?
      `).run(params.ownerUserId, params.claimId);
    } else {
      this.db.prepare(`
        UPDATE manual_upi_claims
        SET status = 'HUMAN_VERIFIED_PAYMENT', verified_at = datetime('now'), verified_by = ?
        WHERE utr = ? AND status = 'PAYMENT_CLAIMED'
      `).run(params.ownerUserId, trimmedUtr);
    }

    const tx = this.revenueEngine.recordTransaction({
      businessId: params.businessId,
      organizationId: params.organizationId,
      journeyId: params.journeyId,
      invoiceNumber: params.invoiceNumber || `INV-MANUAL-${Date.now()}`,
      amountINR: params.amountINR,
      paymentMethod: 'UPI',
      paymentGateway: 'MANUAL',
      transactionRef: trimmedUtr,
      status: 'SUCCESS',
      classification: 'MANUAL_VERIFIED',
      serviceRendered: params.serviceRendered || 'Manual UPI Payment - Owner Confirmed'
    });

    if (params.journeyId) {
      try {
        this.journeyTracker.advanceStage({
          businessId: params.businessId,
          visitorId: params.journeyId,
          targetStage: 'CUSTOMER'
        });
      } catch {}
    }

    return {
      success: true,
      transactionId: tx.id,
      classification: 'MANUAL_VERIFIED',
      status: 'HUMAN_VERIFIED_PAYMENT'
    };
  }

  /**
   * Processes a verified webhook event from Razorpay (e.g. payment.captured, order.paid, payment_link.paid).
   */
  public async processWebhook(params: {
    rawBody: string;
    signature: string;
    event: any;
    overrideSecret?: string;
    overrideClassification?: DataClassification;
  }): Promise<{
    processed: boolean;
    reason?: string;
    transactionId?: string;
    amountINR?: number;
    journeyId?: string;
  }> {
    const webhookSecret = params.overrideSecret || this.getWebhookSecret();
    if (isProduction() && (!webhookSecret || isPlaceholderCredential(webhookSecret))) {
      throw new Error(
        'SECURITY VIOLATION: Razorpay webhooks are disabled in production because RAZORPAY_WEBHOOK_SECRET is unset or using a known placeholder/default secret.'
      );
    }

    const isValid = this.verifyWebhookSignature(params.rawBody, params.signature, params.overrideSecret);
    if (!isValid) {
      throw new Error('SECURITY VIOLATION: Invalid Razorpay webhook signature. Request forged or secret mismatch.');
    }

    const event = params.event;
    const eventType = event.event;

    // Monitor captured payments, paid orders, and paid payment links
    const supportedEvents = ['payment.captured', 'order.paid', 'payment_link.paid'];
    if (!supportedEvents.includes(eventType)) {
      return { processed: false, reason: `Ignored unmonitored event type: ${eventType}` };
    }

    const payment = event.payload?.payment?.entity || event.payload?.payment_link?.entity;
    if (!payment) {
      return { processed: false, reason: 'Missing payment entity in webhook payload' };
    }

    const paymentId = payment.id;
    const amountINR = Math.round((payment.amount || payment.amount_paid || 0) / 100);
    const orderId = payment.order_id;
    const notes = payment.notes || {};
    const businessId = notes.business_id || notes.businessId;

    if (!businessId) {
      throw new Error('SECURITY VIOLATION: Missing business_id in Razorpay webhook metadata.');
    }

    const journeyId = notes.journey_id || notes.journeyId || undefined;
    const invoiceNumber = notes.invoice_number || notes.invoiceNumber || `INV-RZP-${Date.now()}`;
    const serviceRendered = notes.service || payment.description || 'Consultation & Treatment Checkout';
    const classification = params.overrideClassification || (notes.classification as DataClassification) || this.getClassification();

    // Map method
    let paymentMethod: PaymentMethod = 'UPI';
    if (payment.method === 'upi') paymentMethod = 'UPI';
    else if (payment.method === 'netbanking') paymentMethod = 'NETBANKING';
    else if (payment.method === 'card') paymentMethod = 'CREDIT_CARD';
    else if (payment.method === 'emi') paymentMethod = 'NO_COST_EMI';

    // Idempotency Check
    const existingTx = this.db
      .prepare('SELECT id FROM transactions WHERE transaction_ref = ?')
      .get(paymentId) as any;

    if (existingTx) {
      return {
        processed: true,
        reason: `Payment ${paymentId} already processed (idempotency key matched).`,
        transactionId: existingTx.id,
        amountINR,
        journeyId
      };
    }

    // Update payment_orders record if present
    if (orderId) {
      this.db
        .prepare(
          `UPDATE payment_orders 
           SET status = 'PAID', payment_id = ?, updated_at = datetime('now')
           WHERE order_id = ?`
        )
        .run(paymentId, orderId);
    }

    // Update payment_provider_links record if present
    if (eventType === 'payment_link.paid' || payment.payment_link_id) {
      const linkId = payment.payment_link_id || payment.id;
      this.db
        .prepare(`
          UPDATE payment_provider_links
          SET status = 'PAID', paid_at = datetime('now'), payment_id = ?
          WHERE provider_link_id = ?
        `)
        .run(paymentId, linkId);
    }

    // Record Transaction with verified classification
    const tx = this.revenueEngine.recordTransaction({
      businessId,
      journeyId,
      invoiceNumber,
      amountINR,
      paymentMethod,
      paymentGateway: 'RAZORPAY',
      transactionRef: paymentId,
      status: 'SUCCESS',
      classification,
      serviceRendered
    });

    if (journeyId) {
      const jRow = this.db
        .prepare('SELECT * FROM customer_journeys WHERE id = ?')
        .get(journeyId) as any;

      if (jRow && jRow.stage !== 'CUSTOMER') {
        this.journeyTracker.advanceStage({
          businessId,
          visitorId: jRow.visitor_id,
          targetStage: 'CUSTOMER'
        });
      }
    }

    return {
      processed: true,
      transactionId: tx.id,
      amountINR: tx.amountINR,
      journeyId
    };
  }
}
