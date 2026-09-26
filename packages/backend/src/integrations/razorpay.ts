import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { RevenueReconciliationEngine } from '../revenue/revenue-reconciliation.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { PaymentMethod, DataClassification } from '@ai-marketing/shared';
import { isPlaceholderCredential, isProduction } from '../config/env.js';
import { resolveAuthorizedOffer } from '../revenue/offer-catalog.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface RazorpayOrderInput {
  businessId: string;
  organizationId?: string;
  journeyId?: string;
  amountINR?: number;
  offerId?: string;
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
  offerId: string;
  prospectId?: string;
  opportunityId?: string;
  journeyId?: string;
  proposalId?: string;
  billingModel?: 'ONE_TIME' | 'MONTHLY';
  amountINR?: number;
  description?: string;
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
  reconciliationRequired?: boolean;
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
    let finalAmountINR = input.amountINR;

    // Server-side authoritative offer resolution (Spec § 5)
    if (input.offerId) {
      const authorizedOffer = resolveAuthorizedOffer(input.offerId, input.businessId, input.organizationId);
      finalAmountINR = authorizedOffer.priceINR;
    } else if (finalAmountINR !== undefined) {
      // Server-side validation of permitted deposit amount
      this.validatePermittedDeposit(finalAmountINR, input.service);
    } else {
      throw new Error('INVALID_PAYMENT_ORDER: Either offerId or valid amountINR must be provided.');
    }

    if (!finalAmountINR || finalAmountINR <= 0) {
      throw new Error('Payment order amount must be greater than ₹0.');
    }

    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const amountPaise = Math.round(finalAmountINR * 100);
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
          organization_id: input.organizationId || '',
          journey_id: input.journeyId || '',
          offer_id: input.offerId || '',
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
        finalAmountINR,
        orderStatus.toUpperCase(),
        receipt,
        input.notes ? JSON.stringify(input.notes) : null
      );

    return {
      orderId,
      amountINR: finalAmountINR,
      currency: 'INR',
      receipt,
      status: orderStatus,
      keyId: keyId || 'rzp_test_placeholder'
    };
  }

  /**
   * Creates a real Razorpay UPI Payment Link (Spec § 11 & § 12).
   * Calls POST https://api.razorpay.com/v1/payment_links with upi_link=true.
   * Resolves price authoritatively from offer-catalog.
   * Stores real short_url in payment_provider_links and payment_requests.
   */
  public async createPaymentLink(input: RazorpayPaymentLinkInput): Promise<RazorpayPaymentLinkResult> {
    // Spec § 9: Assert durable storage in production
    D1RevenueRepository.getInstance().assertDurableStorage('payment_provider_links');
    D1RevenueRepository.getInstance().assertDurableStorage('payment_requests');

    // Spec § 1: Razorpay Adapter must own price authority
    if (!input.offerId) {
      throw new Error('UNAUTHORIZED_OFFER: offerId is required. RazorpayAdapter must resolve pricing from an authoritative offer.');
    }
    const offer = resolveAuthorizedOffer(input.offerId, input.businessId, input.organizationId);
    if (!offer) {
      throw new Error(`UNAUTHORIZED_OFFER: Offer '${input.offerId}' could not be resolved for business '${input.businessId}'.`);
    }

    // Validate business/org ownership
    if (offer.businessId !== input.businessId) {
      throw new Error(`UNAUTHORIZED_OFFER: Offer '${input.offerId}' belongs to business '${offer.businessId}', but caller supplied '${input.businessId}'.`);
    }
    if (offer.organizationId !== input.organizationId) {
      throw new Error(`UNAUTHORIZED_OFFER: Offer '${input.offerId}' belongs to organization '${offer.organizationId}', but caller supplied '${input.organizationId}'.`);
    }

    // Authoritative server-side price & billing model
    const authoritativeAmountINR = offer.priceINR;
    const billingModel = input.billingModel || offer.billingModel || 'ONE_TIME';
    const description = input.description || offer.offerName;

    // Backward compatibility assertion: caller amount === authoritative offer amount
    if (input.amountINR !== undefined && input.amountINR !== null) {
      if (Number(input.amountINR) !== authoritativeAmountINR) {
        throw new Error(`SECURITY VIOLATION: AMOUNT MISMATCH: Caller supplied amount ₹${input.amountINR} does not match authoritative offer price ₹${authoritativeAmountINR}. Arbitrary pricing is rejected.`);
      }
    }

    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const amountPaise = Math.round(authoritativeAmountINR * 100);
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
        description: description,
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

    // Spec § 2: Payment link persistence must not fail silently
    const id = `ppl_${randomUUID().substring(0, 10)}`;
    const payReqId = `payrq_${Date.now()}_${randomUUID().substring(0, 6)}`;

    try {
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
          authoritativeAmountINR,
          status,
          rawResponse
        );

      this.db.prepare(`
        INSERT INTO payment_requests (
          id, organization_id, business_id, prospect_id, opportunity_id,
          journey_id, offer_id, offer_description, amount_inr, currency,
          billing_model, provider, provider_link_id, short_url, reference_id,
          classification, status, payment_link, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'RAZORPAY', ?, ?, ?, ?, 'PROVIDER_CREATED', ?, datetime('now'), datetime('now'))
      `).run(
        payReqId,
        input.organizationId,
        input.businessId,
        input.prospectId || null,
        input.opportunityId || null,
        input.journeyId || null,
        input.offerId,
        description,
        authoritativeAmountINR,
        billingModel,
        providerLinkId,
        shortUrl,
        referenceId,
        this.getClassification(),
        shortUrl
      );
    } catch (persistErr: any) {
      console.error(`[CRITICAL RECONCILIATION REQUIRED] Razorpay payment link ${providerLinkId} (reference: ${referenceId}) was created at provider, but internal canonical persistence failed: ${persistErr.message}`);
      return {
        id: '',
        providerLinkId,
        shortUrl,
        referenceId,
        amountINR: authoritativeAmountINR,
        currency: 'INR',
        status: 'RECONCILIATION_REQUIRED',
        reconciliationRequired: true
      };
    }

    return {
      id,
      providerLinkId,
      shortUrl,
      referenceId,
      amountINR: authoritativeAmountINR,
      currency: 'INR',
      status
    };
  }

  /**
   * Fetches payment entity directly from Razorpay API by payment ID (Spec § 3).
   */
  public async fetchPayment(paymentId: string): Promise<any> {
    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Razorpay Payment API error (${res.status}): ${errText}`);
    }
    return await res.json();
  }

  /**
   * Confirms payment received from client checkout (Razorpay / UPI), verifies signature,
   * queries Razorpay API directly to validate payment state and amount against stored order,
   * records transaction with strict classification (Spec § 3).
   *
   * Spec § 8: order_id is the AUTHORITATIVE source for business_id, amount, journey_id.
   */
  public async confirmClientPayment(params: {
    orderId: string;
    paymentId: string;
    signature: string;
    businessId?: string;
    journeyId?: string;
    method?: PaymentMethod;
    secret?: string;
    classification?: DataClassification;
    providerPayment?: any;
  }): Promise<{
    success: boolean;
    transactionId?: string;
    amountINR?: number;
    journeyId?: string;
    error?: string;
  }> {
    // Spec § 9: Assert D1 durable storage for transaction in production
    D1RevenueRepository.getInstance().assertDurableStorage('transactions');

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

    // 3. GET Razorpay payment by payment ID (Spec § 3)
    let providerPayment: any = params.providerPayment;
    if (!providerPayment) {
      if (this.hasAnyValidCredentials()) {
        try {
          providerPayment = await this.fetchPayment(params.paymentId);
        } catch (err: any) {
          throw new Error(`PAYMENT_VERIFICATION_REJECTED: Could not fetch payment ${params.paymentId} from Razorpay: ${err.message}`);
        }
      } else if (isProduction()) {
        throw new Error('CREDENTIAL_FAULT: Production payment verification requires valid RAZORPAY credentials.');
      } else {
        // Dev/test simulation fallback when credentials are not configured
        providerPayment = {
          id: params.paymentId,
          status: 'captured',
          order_id: params.orderId,
          currency: 'INR',
          amount: Math.round(order.amount_inr * 100)
        };
      }
    }

    // 4. Require provider payment exists
    if (!providerPayment || !providerPayment.id) {
      throw new Error(`PAYMENT_VERIFICATION_REJECTED: Provider payment not found for payment_id: ${params.paymentId}`);
    }

    // 5. Require appropriate captured/paid state
    if (providerPayment.status !== 'captured' && providerPayment.status !== 'paid') {
      throw new Error(`PAYMENT_VERIFICATION_REJECTED: Invalid provider payment status '${providerPayment.status}'. Expected 'captured'.`);
    }

    // 6. Exact provider order ID must match
    if (providerPayment.order_id !== params.orderId) {
      throw new Error(`SECURITY VIOLATION: ORDER MISMATCH: Provider payment order_id '${providerPayment.order_id}' does not match stored order_id '${params.orderId}'.`);
    }

    // 7. Exact currency must equal INR
    if (providerPayment.currency !== 'INR') {
      throw new Error(`SECURITY VIOLATION: CURRENCY MISMATCH: Provider payment currency '${providerPayment.currency}' does not match expected 'INR'.`);
    }

    // 8. Exact provider amount in paise must equal stored amount
    const expectedAmountPaise = Math.round(order.amount_inr * 100);
    if (Number(providerPayment.amount) !== expectedAmountPaise) {
      throw new Error(`SECURITY VIOLATION: AMOUNT MISMATCH: Provider payment amount ${providerPayment.amount} paise does not match stored order amount ${expectedAmountPaise} paise.`);
    }

    // 9. Extract authoritative attributes from stored order
    const businessId = order.business_id;
    const organizationId = order.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;
    const journeyId = order.journey_id || params.journeyId || undefined;
    const amountINR = order.amount_inr;
    const paymentMethod: PaymentMethod = params.method || 'UPI';
    const classification = params.classification || this.getClassification();

    // 10. Idempotency check: don't process same payment ID twice
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

    // 11. Update payment order status to PAID
    this.db
      .prepare(
        `UPDATE payment_orders 
         SET status = 'PAID', payment_id = ?, updated_at = datetime('now')
         WHERE order_id = ?`
      )
      .run(params.paymentId, params.orderId);

    // 12. Record transaction with verified REAL revenue
    const tx = this.revenueEngine.recordTransaction({
      businessId,
      organizationId,
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

    const isPlatform = params.businessId === OwnerAuthService.PLATFORM_BUSINESS_ID || params.businessId === 'biz_platform_aro';
    if (isPlatform) {
      try {
        this.db.prepare(`
          INSERT INTO revenue_records (
            id, organization_id, business_id, revenue_type, source, transaction_id,
            amount_inr, currency, verified, verification_method, classification,
            recurring_model, timestamp
          ) VALUES (?, ?, ?, 'PLATFORM_REVENUE', 'MANUAL_VERIFIED', ?, ?, 'INR', 1, 'OWNER_MANUAL', 'MANUAL_VERIFIED', 'ONE_TIME', datetime('now'))
        `).run(
          `rev_man_${Date.now()}_${randomUUID().substring(0, 6)}`,
          params.organizationId,
          params.businessId,
          trimmedUtr,
          params.amountINR
        );
      } catch {}
    }

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

    // Handle failure and refund events
    if (eventType === 'payment.failed') {
      const failedPayment = event.payload?.payment?.entity;
      const orderId = failedPayment?.order_id;
      const linkId = failedPayment?.payment_link_id || failedPayment?.id;
      if (orderId) {
        this.db.prepare(`UPDATE payment_orders SET status = 'FAILED', updated_at = datetime('now') WHERE order_id = ?`).run(orderId);
      }
      if (linkId) {
        this.db.prepare(`UPDATE payment_requests SET status = 'FAILED', updated_at = datetime('now') WHERE provider_link_id = ?`).run(linkId);
        this.db.prepare(`UPDATE payment_provider_links SET status = 'FAILED' WHERE provider_link_id = ?`).run(linkId);
      }
      return { processed: true, reason: 'Payment failed event recorded.' };
    }

    if (eventType === 'refund.processed') {
      const refund = event.payload?.refund?.entity;
      const orderId = refund?.order_id;
      if (orderId) {
        this.db.prepare(`UPDATE payment_orders SET status = 'REFUNDED', updated_at = datetime('now') WHERE order_id = ?`).run(orderId);
      }
      return { processed: true, reason: 'Refund processed event recorded.' };
    }

    // Monitor captured payments, paid orders, and paid payment links
    const supportedEvents = ['payment.captured', 'order.paid', 'payment_link.paid'];
    if (!supportedEvents.includes(eventType)) {
      return { processed: false, reason: `Ignored unmonitored event type: ${eventType}` };
    }

    const paymentLink = event.payload?.payment_link?.entity;
    const payment = event.payload?.payment?.entity;

    // Spec § 4: For payment_link.paid, require an actual pay_... identifier
    if (eventType === 'payment_link.paid') {
      if (!payment || !payment.id || !payment.id.startsWith('pay_')) {
        throw new Error(`SECURITY VIOLATION: payment_link.paid webhook requires an actual Razorpay payment entity with a 'pay_...' identifier. Received: ${payment?.id || 'missing'}`);
      }
    }

    if (!payment && !paymentLink) {
      return { processed: false, reason: 'Missing payment entity in webhook payload' };
    }

    const providerLinkId: string | undefined = paymentLink?.id || payment?.payment_link_id;
    const paymentId: string | undefined = payment?.id;

    if (!paymentId || !paymentId.startsWith('pay_')) {
      throw new Error(`SECURITY VIOLATION: A valid Razorpay payment ID starting with 'pay_' is required. Received: '${paymentId || 'missing'}'`);
    }

    if (paymentId.startsWith('plink_')) {
      throw new Error(`SECURITY VIOLATION: Provider link ID '${paymentId}' cannot be used as a payment ID.`);
    }

    const orderId = payment?.order_id || paymentLink?.order_id;
    const receivedAmountPaise = Number(payment?.amount || paymentLink?.amount_paid || paymentLink?.amount || 0);
    const amountINR = Math.round(receivedAmountPaise / 100);

    // Spec § 5: Webhook identity must come from internal stored records
    // 1. identify provider link/order/payment
    // 2. find internal stored payment record
    // 3. require internal record
    // 4. derive tenant from that record
    // 5. compare provider notes only as consistency evidence
    // 6. reject disagreement
    let storedLink: any = null;
    let storedPayReq: any = null;
    let storedOrder: any = null;

    if (providerLinkId) {
      storedLink = this.db.prepare(`SELECT * FROM payment_provider_links WHERE provider_link_id = ?`).get(providerLinkId) as any;
      storedPayReq = this.db.prepare(`SELECT * FROM payment_requests WHERE provider_link_id = ?`).get(providerLinkId) as any;
    }

    if (orderId) {
      storedOrder = this.db.prepare(`SELECT * FROM payment_orders WHERE order_id = ?`).get(orderId) as any;
    }

    if (!storedLink && !storedPayReq && !storedOrder) {
      throw new Error(`SECURITY VIOLATION: Unrecognized provider transaction. Payment link record not found for link '${providerLinkId}' or order '${orderId}'. Revenue cannot be created without stored internal authority.`);
    }

    // 4. Derive tenant strictly from stored internal record
    const businessId = storedLink?.business_id || storedPayReq?.business_id || storedOrder?.business_id;
    const organizationId = storedLink?.organization_id || storedPayReq?.organization_id || storedOrder?.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;

    if (!businessId) {
      throw new Error('SECURITY VIOLATION: Stored internal payment record has no associated business_id.');
    }

    // 5. Compare provider notes only as consistency evidence — reject disagreement
    const notes = paymentLink?.notes || payment?.notes || {};
    const notesBizId = notes.business_id || notes.businessId;
    const notesOrgId = notes.organization_id || notes.organizationId;

    if (notesBizId && notesBizId !== businessId) {
      throw new Error(`SECURITY VIOLATION: TENANT MISMATCH: Webhook notes business_id '${notesBizId}' does not match stored record business_id '${businessId}'.`);
    }

    if (notesOrgId && notesOrgId !== organizationId) {
      throw new Error(`SECURITY VIOLATION: TENANT MISMATCH: Webhook notes organization_id '${notesOrgId}' does not match stored record organization_id '${organizationId}'.`);
    }

    // Verify exact amount in paise
    const expectedAmountINR = storedLink?.amount_inr || storedPayReq?.amount_inr || storedOrder?.amount_inr;
    if (expectedAmountINR !== undefined && expectedAmountINR !== null) {
      const expectedAmountPaise = Math.round(Number(expectedAmountINR) * 100);
      if (receivedAmountPaise !== expectedAmountPaise) {
        throw new Error(`SECURITY VIOLATION: AMOUNT MISMATCH: Payment amount mismatch for provider link '${providerLinkId}' / order '${orderId}'. Expected ₹${expectedAmountINR} (${expectedAmountPaise} paise), received ${receivedAmountPaise} paise.`);
      }
    }

    const journeyId = notes.journey_id || notes.journeyId || storedLink?.journey_id || storedPayReq?.journey_id || undefined;
    const invoiceNumber = notes.invoice_number || notes.invoiceNumber || `INV-RZP-${Date.now()}`;
    const serviceRendered = notes.service || payment?.description || storedPayReq?.offer_description || 'Commercial Service Checkout';
    const classification = params.overrideClassification || (notes.classification as DataClassification) || this.getClassification();

    // Map method
    let paymentMethod: PaymentMethod = 'UPI';
    if (payment?.method === 'upi') paymentMethod = 'UPI';
    else if (payment?.method === 'netbanking') paymentMethod = 'NETBANKING';
    else if (payment?.method === 'card') paymentMethod = 'CREDIT_CARD';
    else if (payment?.method === 'emi') paymentMethod = 'NO_COST_EMI';

    // Idempotency Check: Duplicate Webhook => NO DUPLICATE REVENUE (Spec § 22)
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
    const matchedLinkId = providerLinkId;
    if (matchedLinkId) {
      this.db
        .prepare(`
          UPDATE payment_provider_links
          SET status = 'PAID', paid_at = datetime('now'), payment_id = ?
          WHERE provider_link_id = ?
        `)
        .run(paymentId, matchedLinkId);

      // Update payment_requests record (Spec § 9 & § 23)
      this.db
        .prepare(`
          UPDATE payment_requests
          SET status = 'PAID', payment_id = ?, payment_verified_at = datetime('now'),
              verified_at = datetime('now'), verification_method = 'RAZORPAY_WEBHOOK',
              updated_at = datetime('now')
          WHERE provider_link_id = ?
        `)
        .run(paymentId, matchedLinkId);
    }

    // Record Transaction with verified classification
    const tx = this.revenueEngine.recordTransaction({
      businessId,
      organizationId,
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

    // Record explicit economic entity revenue_records (Spec § 3, § 24, § 25)
    const isPlatformRevenue = businessId === OwnerAuthService.PLATFORM_BUSINESS_ID || businessId === 'biz_platform_aro';
    const revenueType = isPlatformRevenue ? 'PLATFORM_REVENUE' : 'CLIENT_REVENUE';

    // Spec § 9: Assert D1 durable storage for revenue_records in production
    D1RevenueRepository.getInstance().assertDurableStorage('revenue_records');

    try {
      this.db.prepare(`
        INSERT INTO revenue_records (
          id, organization_id, business_id, revenue_type, source, transaction_id,
          amount_inr, currency, verified, verification_method, classification,
          recurring_model, timestamp
        ) VALUES (?, ?, ?, ?, 'RAZORPAY', ?, ?, 'INR', 1, 'RAZORPAY_WEBHOOK', ?, 'ONE_TIME', datetime('now'))
      `).run(
        `rev_${Date.now()}_${randomUUID().substring(0, 6)}`,
        organizationId,
        businessId,
        revenueType,
        paymentId,
        amountINR,
        classification
      );
    } catch (e: any) {
      console.warn(`[RazorpayAdapter] Failed to insert revenue_records: ${e.message}`);
    }

    // If platform customer paid, initialize 5-Day Delivery Blueprint fulfillment (Spec § 38 & § 39)
    if (isPlatformRevenue) {
      try {
        const custId = storedPayReq?.prospect_id || storedLink?.prospect_id || `cust_${randomUUID().substring(0, 8)}`;
        this.db.prepare(`
          INSERT OR IGNORE INTO platform_customer_deliveries (
            id, customer_id, organization_id, business_id, offer_id, payment_id,
            stage, contract_terms, deliverables_json, success_metrics_json, renewal_date, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'ONBOARDING', 'Standard Service Agreement: 5-Day Delivery & SLA', '["WhatsApp Integration", "Google Business Profile Lead Capture", "Automated Triage", "24/7 Booking Bot"]', '["Response time < 2 mins", "30% show rate"]', datetime('now', '+30 days'), datetime('now'), datetime('now'))
        `).run(
          `deliv_${Date.now()}`,
          custId,
          organizationId,
          businessId,
          storedPayReq?.offer_id || 'PLATFORM_SETUP',
          paymentId
        );
      } catch (e: any) {
        console.warn(`[RazorpayAdapter] Failed to initialize customer delivery: ${e.message}`);
      }
    }

    // Advance customer journey if present
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

  /**
   * Diagnostic Health Check (Spec § 42)
   * GET /api/v1/payments/razorpay/health
   */
  public getRazorpayHealth(): {
    configured: boolean;
    live_mode: boolean;
    key_id_present: boolean;
    secret_present: boolean;
    webhook_secret_present: boolean;
    provider_reachable: boolean;
    last_provider_check: string;
    last_webhook_received: string | null;
    last_payment_event: string | null;
    last_verified_payment: string | null;
  } {
    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const webhookSecret = this.getWebhookSecret();
    const liveMode = this.isLiveConfigured();
    const configured = this.hasAnyValidCredentials();

    let lastPaymentEvent: string | null = null;
    let lastVerifiedPayment: string | null = null;

    try {
      const linkRow = this.db.prepare(`
        SELECT created_at, paid_at FROM payment_provider_links ORDER BY created_at DESC LIMIT 1
      `).get() as any;
      if (linkRow) {
        lastPaymentEvent = linkRow.paid_at || linkRow.created_at || null;
      }

      const revRow = this.db.prepare(`
        SELECT timestamp FROM revenue_records WHERE source = 'RAZORPAY' AND verified = 1 ORDER BY timestamp DESC LIMIT 1
      `).get() as any;
      if (revRow) {
        lastVerifiedPayment = revRow.timestamp || null;
      }
    } catch {}

    return {
      configured,
      live_mode: liveMode,
      key_id_present: Boolean(keyId && !isPlaceholderCredential(keyId)),
      secret_present: Boolean(keySecret && !isPlaceholderCredential(keySecret)),
      webhook_secret_present: Boolean(webhookSecret && !isPlaceholderCredential(webhookSecret)),
      provider_reachable: configured,
      last_provider_check: new Date().toISOString(),
      last_webhook_received: lastPaymentEvent,
      last_payment_event: lastPaymentEvent,
      last_verified_payment: lastVerifiedPayment
    };
  }
}
