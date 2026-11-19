import { createHmac, timingSafeEqual, randomUUID, createHash } from 'crypto';
import { RevenueReconciliationEngine } from '../revenue/revenue-reconciliation.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { PaymentMethod, DataClassification } from '@ai-marketing/shared';
import { isPlaceholderCredential, isProduction, getTrustedPublicSiteUrl, normalizeSecretValue } from '../config/env.js';
import { resolveAuthorizedOffer } from '../revenue/offer-catalog.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';

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
  proposalId?: string;
  offerId?: string;
  invoiceRef?: string;
  payerName?: string;
  payerPhone?: string;
  payerVpa?: string;
  utr: string;
  amountINR: number;
  serviceRendered?: string;
  notes?: string;
}

export class RazorpayAdapter {
  private d1Repo = D1RevenueRepository.getInstance();

  private get db() {
    return {
      prepare: (sql: string) => ({
        run: (...params: any[]) => {
          if (isProduction() && !process.env.VITEST) {
            throw new Error(`PRODUCTION D1 VIOLATION: Synchronous/unawaited write in RazorpayAdapter is strictly prohibited in production. All writes must use await this.d1Repo.executeWrite().`);
          }
          return getDb().prepare(sql).run(...params);
        },
        get: (...params: any[]) => {
          if (isProduction() && !process.env.VITEST) {
            throw new Error(`PRODUCTION D1 ERROR: Synchronous get() is prohibited in RazorpayAdapter in production. All reads must go through D1.`);
          }
          return getDb().prepare(sql).get(...params) as any;
        },
        all: (...params: any[]) => {
          if (isProduction() && !process.env.VITEST) {
            throw new Error(`PRODUCTION D1 ERROR: Synchronous all() is prohibited in RazorpayAdapter in production. All reads must go through D1.`);
          }
          return getDb().prepare(sql).all(...params) as any[];
        }
      })
    };
  }

  private revenueEngine = new RevenueReconciliationEngine();
  private journeyTracker = new CustomerJourneyTracker();

  // Standard server-side deposit policies
  public static readonly STANDARD_CONSULTATION_DEPOSIT_INR = 500;
  public static readonly PLATFORM_SETUP_FEE_INR = 15000;
  public static readonly PLATFORM_MONTHLY_FEE_INR = 8000;

  public getCredentialPair(): {
    keyId: string;
    keySecret: string;
    webhookSecret: string;
    mode: 'LIVE' | 'SANDBOX_TEST' | 'MISCONFIGURED_CREDENTIAL_PAIR' | 'UNCONFIGURED';
  } {
    const rawMode = (process.env.RAZORPAY_MODE || '').trim().toLowerCase();
    const liveKeyId = normalizeSecretValue(process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY);
    const liveKeySecret = normalizeSecretValue(process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET);
    const liveWebhookSecret = normalizeSecretValue(process.env.RAZORPAY_WEBHOOK_SECRET);

    const testKeyId = normalizeSecretValue(process.env.RAZORPAY_TEST_KEY_ID);
    const testKeySecret = normalizeSecretValue(process.env.RAZORPAY_TEST_KEY_SECRET);
    const testWebhookSecret = normalizeSecretValue(process.env.RAZORPAY_TEST_WEBHOOK_SECRET);

    const isLiveKeySet = Boolean(liveKeyId && !isPlaceholderCredential(liveKeyId));
    const isLiveSecretSet = Boolean(liveKeySecret && !isPlaceholderCredential(liveKeySecret));

    // Strictly block cross-mixing rzp_test_ / rzp_live_
    if (
      (liveKeyId.startsWith('rzp_test_') && liveKeySecret.startsWith('rzp_live_')) ||
      (liveKeyId.startsWith('rzp_live_') && liveKeySecret.startsWith('rzp_test_')) ||
      testKeyId.startsWith('rzp_live_') ||
      testKeySecret.startsWith('rzp_live_')
    ) {
      return { keyId: '', keySecret: '', webhookSecret: '', mode: 'MISCONFIGURED_CREDENTIAL_PAIR' };
    }

    // Support rzp_test_* in RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET when RAZORPAY_MODE === 'test' (if RAZORPAY_TEST_KEY_ID is unset)
    if (rawMode === 'test') {
      const isTestKeySet = Boolean(testKeyId && !isPlaceholderCredential(testKeyId));
      const isTestSecretSet = Boolean(testKeySecret && !isPlaceholderCredential(testKeySecret));
      if (isTestKeySet && isTestSecretSet) {
        return {
          keyId: testKeyId,
          keySecret: testKeySecret,
          webhookSecret: testWebhookSecret || liveWebhookSecret,
          mode: 'SANDBOX_TEST'
        };
      }
      if (!isTestKeySet && liveKeyId.startsWith('rzp_test_') && isLiveSecretSet) {
        return {
          keyId: liveKeyId,
          keySecret: liveKeySecret,
          webhookSecret: liveWebhookSecret || testWebhookSecret,
          mode: 'SANDBOX_TEST'
        };
      }
      if (liveKeyId.startsWith('rzp_live_')) {
        return { keyId: '', keySecret: '', webhookSecret: '', mode: 'MISCONFIGURED_CREDENTIAL_PAIR' };
      }
      return { keyId: '', keySecret: '', webhookSecret: '', mode: 'UNCONFIGURED' };
    }

    // Imposter test key placed in live slot when mode is live or default
    if (liveKeyId.startsWith('rzp_test_') || liveKeySecret.startsWith('rzp_test_')) {
      return { keyId: '', keySecret: '', webhookSecret: '', mode: 'MISCONFIGURED_CREDENTIAL_PAIR' };
    }

    // Live Key ID without Live Secret: NEVER fall back to test secret!
    if (isLiveKeySet && !isLiveSecretSet) {
      return { keyId: '', keySecret: '', webhookSecret: '', mode: 'MISCONFIGURED_CREDENTIAL_PAIR' };
    }

    // Both live credentials provided
    if (isLiveKeySet && isLiveSecretSet) {
      return {
        keyId: liveKeyId,
        keySecret: liveKeySecret,
        webhookSecret: liveWebhookSecret,
        mode: 'LIVE'
      };
    }

    // Only secret provided (e.g. for signature verification in test/sandbox)
    if (isLiveSecretSet && !liveKeyId) {
      return {
        keyId: '',
        keySecret: liveKeySecret,
        webhookSecret: liveWebhookSecret || liveKeySecret,
        mode: 'SANDBOX_TEST'
      };
    }

    // Check test credentials
    const isTestKeySet = Boolean(testKeyId && !isPlaceholderCredential(testKeyId));
    const isTestSecretSet = Boolean(testKeySecret && !isPlaceholderCredential(testKeySecret));

    if (isTestKeySet && isTestSecretSet) {
      return {
        keyId: testKeyId,
        keySecret: testKeySecret,
        webhookSecret: testWebhookSecret,
        mode: 'SANDBOX_TEST'
      };
    }

    if (isTestSecretSet && !testKeyId) {
      return {
        keyId: '',
        keySecret: testKeySecret,
        webhookSecret: testWebhookSecret || testKeySecret,
        mode: 'SANDBOX_TEST'
      };
    }

    if (testKeyId || testKeySecret) {
      return { keyId: '', keySecret: '', webhookSecret: '', mode: 'MISCONFIGURED_CREDENTIAL_PAIR' };
    }

    return { keyId: '', keySecret: '', webhookSecret: '', mode: 'UNCONFIGURED' };
  }

  public getKeyId(): string {
    return this.getCredentialPair().keyId;
  }

  public getKeySecret(): string {
    return this.getCredentialPair().keySecret;
  }

  public getWebhookSecret(): string {
    const pair = this.getCredentialPair();
    if (pair.webhookSecret && !isPlaceholderCredential(pair.webhookSecret)) {
      return normalizeSecretValue(pair.webhookSecret);
    }
    const rawMode = (process.env.RAZORPAY_MODE || '').trim().toLowerCase();
    if (rawMode === 'test') {
      const testSecret = normalizeSecretValue(process.env.RAZORPAY_TEST_WEBHOOK_SECRET);
      if (testSecret && !isPlaceholderCredential(testSecret)) {
        return testSecret;
      }
      return normalizeSecretValue(process.env.RAZORPAY_WEBHOOK_SECRET || '');
    }
    return normalizeSecretValue(process.env.RAZORPAY_WEBHOOK_SECRET || '');
  }

  public isLiveConfigured(): boolean {
    return this.getCredentialPair().mode === 'LIVE';
  }

  public hasAnyValidCredentials(): boolean {
    const pair = this.getCredentialPair();
    return Boolean(pair.keyId && pair.keySecret);
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
      499, // SiteFix AI Core Technical Fix-Pack self-serve SKU
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
          'CREDENTIAL_FAULT: Production payment orders require valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (or RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET for sandbox testing). Simulated orders are prohibited.'
        );
      }
      // Non-production test environment fallback
      orderId = `order_test_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
    }

    const id = `po_${randomUUID().substring(0, 10)}`;

    D1RevenueRepository.getInstance().assertDurableStorage('payment_orders');

    await this.d1Repo.executeWrite(
      'payment_orders',
      `INSERT INTO payment_orders (
        id, business_id, journey_id, order_id, amount_inr, currency,
        status, receipt, notes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        id,
        input.businessId,
        input.journeyId || null,
        orderId,
        finalAmountINR,
        orderStatus.toUpperCase(),
        receipt,
        input.notes ? JSON.stringify(input.notes) : null
      ]
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
    let authoritativeAmountINR: number;
    let billingModel = input.billingModel || 'ONE_TIME';
    let description = input.description;
    let proposal: any = null;

    if (input.proposalId) {
      if (isProduction()) {
        proposal = await this.d1Repo.queryOne<any>('proposals', 'SELECT id, organization_id, business_id, setup_price_inr, prospect_id, status FROM proposals WHERE id = ?', [input.proposalId]);
      } else {
        proposal = this.db.prepare('SELECT id, organization_id, business_id, setup_price_inr, prospect_id, status FROM proposals WHERE id = ?').get(input.proposalId) as any;
      }
      if (!proposal) {
        throw new Error(`PROPOSAL_NOT_FOUND: Proposal '${input.proposalId}' does not exist.`);
      }

      // Tenant ownership check to prevent IDOR (CWE-639)
      if (input.businessId && proposal.business_id !== input.businessId) {
        throw new Error(`UNAUTHORIZED_PROPOSAL: Proposal '${input.proposalId}' belongs to business '${proposal.business_id}', but caller supplied '${input.businessId}'.`);
      }
      if (input.organizationId && proposal.organization_id !== input.organizationId) {
        throw new Error(`UNAUTHORIZED_PROPOSAL: Proposal '${input.proposalId}' belongs to organization '${proposal.organization_id}', but caller supplied '${input.organizationId}'.`);
      }

      // Proposal status check to prevent payable links for draft, rejected or unapproved proposals (CWE-863)
      const proposalStatus = (proposal.status || '').toUpperCase();
      const eligibleStatuses = ['APPROVED', 'ACCEPTED', 'SENT'];
      if (!eligibleStatuses.includes(proposalStatus)) {
        throw new Error(`UNAUTHORIZED_PROPOSAL_STATUS: Proposal '${input.proposalId}' has status '${proposal.status}', but must be one of [${eligibleStatuses.join(', ')}] to create a payment link.`);
      }

      authoritativeAmountINR = proposal.setup_price_inr !== undefined ? proposal.setup_price_inr : (proposal as any).setupPriceINR;
      description = description || `Proposal ${input.proposalId} Setup & Integration`;
    } else {
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
      authoritativeAmountINR = offer.priceINR;
      billingModel = input.billingModel || offer.billingModel || 'ONE_TIME';
      description = description || offer.offerName;
    }

    // Backward compatibility assertion: caller amount === authoritative amount
    if (input.amountINR !== undefined && input.amountINR !== null) {
      if (Number(input.amountINR) !== authoritativeAmountINR) {
        throw new Error(`SECURITY VIOLATION: AMOUNT MISMATCH: Caller supplied amount ₹${input.amountINR} does not match authoritative ${input.proposalId ? 'proposal' : 'offer'} price ₹${authoritativeAmountINR}. Arbitrary pricing is rejected.`);
      }
    }

    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const amountPaise = Math.round(authoritativeAmountINR * 100);
    const referenceId = `ref_${randomUUID().substring(0, 12)}`;

    let resolvedProspectId = input.prospectId;
    if (input.proposalId && proposal && !resolvedProspectId) {
      resolvedProspectId = proposal.prospect_id;
    }
    const custEmail = input.customer?.email || (input as any).customerEmail;
    const custPhone = input.customer?.contact || (input as any).customerPhone;
    if (!resolvedProspectId && (custEmail || custPhone)) {
      if (isProduction()) {
        const pRow = await this.d1Repo.queryOne<any>('platform_prospects', `
          SELECT id FROM platform_prospects
          WHERE (prospect_email = ? AND ? != '') OR (prospect_phone = ? AND ? != '')
          LIMIT 1
        `, [custEmail || '', custEmail || '', custPhone || '', custPhone || '']);
        resolvedProspectId = pRow?.id;
      } else {
        const pRow = this.db.prepare(`
          SELECT id FROM platform_prospects
          WHERE (prospect_email = ? AND ? != '') OR (prospect_phone = ? AND ? != '')
          LIMIT 1
        `).get(custEmail || '', custEmail || '', custPhone || '', custPhone || '') as any;
        resolvedProspectId = pRow?.id;
      }
    }

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
          prospect_id: resolvedProspectId || ''
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
        if (OwnerAuthService.isDisallowedFixedPaymentLink(shortUrl) || OwnerAuthService.isDisallowedFixedPaymentLink(providerLinkId)) {
          throw new Error(`SECURITY VIOLATION: DISALLOWED_FIXED_PAYMENT_LINK: Razorpay returned a known fixed test link (${shortUrl}). Refusing to register for commercial invoice.`);
        }
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
          'CREDENTIAL_FAULT: Production payment links require valid RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (or RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET for sandbox testing).'
        );
      }
      providerLinkId = `plink_test_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
      shortUrl = `https://rzp.io/i/test_${randomUUID().substring(0, 6)}`;
    }

    // Spec § 2: Payment link persistence must not fail silently
    const id = `ppl_${randomUUID().substring(0, 10)}`;
    const payReqId = `payrq_${Date.now()}_${randomUUID().substring(0, 6)}`;

    try {
      await this.d1Repo.executeWrite(
        'payment_provider_links',
        `INSERT INTO payment_provider_links (
          id, organization_id, business_id, prospect_id, journey_id, proposal_id,
          provider, provider_link_id, short_url, reference_id, amount_inr,
          currency, status, created_at, provider_response_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'RAZORPAY', ?, ?, ?, ?, 'INR', ?, datetime('now'), ?)`,
        [
          id,
          input.organizationId,
          input.businessId,
          resolvedProspectId || null,
          input.journeyId || null,
          input.proposalId || null,
          providerLinkId,
          shortUrl,
          referenceId,
          authoritativeAmountINR,
          status,
          rawResponse
        ]
      );

      await this.d1Repo.executeWrite(
        'payment_requests',
        `INSERT INTO payment_requests (
          id, organization_id, business_id, prospect_id, opportunity_id,
          journey_id, proposal_id, offer_id, offer_description, amount_inr, currency,
          billing_model, provider, provider_link_id, short_url, reference_id,
          classification, status, payment_link, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, 'RAZORPAY', ?, ?, ?, ?, 'PROVIDER_CREATED', ?, datetime('now'), datetime('now'))`,
        [
          payReqId,
          input.organizationId,
          input.businessId,
          resolvedProspectId || null,
          input.opportunityId || null,
          input.journeyId || null,
          input.proposalId || null,
          input.offerId,
          description,
          authoritativeAmountINR,
          billingModel,
          providerLinkId,
          shortUrl,
          referenceId,
          this.getClassification(),
          shortUrl
        ]
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
    await this.d1Repo.executeWrite(
      'payment_orders',
      `UPDATE payment_orders 
       SET status = 'PAID', payment_id = ?, updated_at = datetime('now')
       WHERE order_id = ?`,
      [params.paymentId, params.orderId]
    );

    // 12. Record transaction with verified REAL revenue
    const tx = await this.revenueEngine.recordTransactionAsync({
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

  public static readonly MANUAL_UPI_LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
    PAYMENT_CLAIMED: ['HUMAN_VERIFIED_PAYMENT', 'REJECTED'],
    HUMAN_VERIFIED_PAYMENT: ['FULFILLMENT_IN_PROGRESS', 'REFUNDED'],
    FULFILLMENT_IN_PROGRESS: ['FULFILLED', 'REFUNDED'],
    FULFILLED: ['REFUNDED'],
    REJECTED: [],
    REFUNDED: []
  };

  /**
   * Resolves server-authoritative claim context (`amountINR`, `sku`, `businessId`, `invoiceRef`)
   * from a verified `site_audits` / `SITE_AUDIT_SCAN` record or a server-created `payment_requests` / `payment_orders` row.
   * Never trusts client-supplied amount, businessId, or invoiceRef for offer claims.
   */
  public async resolveAuthoritativeOfferClaimContext(params: {
    auditId?: string;
    paymentRequestId?: string;
    orderId?: string;
    proposalId?: string;
  }): Promise<{
    verified: boolean;
    amountINR: number;
    sku: string;
    businessId: string;
    organizationId: string;
    invoiceRef: string;
    proposalId?: string;
    serviceRendered: string;
    referenceType: 'SITE_AUDIT' | 'PAYMENT_REQUEST' | 'PAYMENT_ORDER';
  } | null> {
    const useRemoteD1 = isProduction() && !process.env.VITEST;
    const queryOne = async (table: string, sql: string, qParams: any[]) => {
      if (useRemoteD1) {
        return this.d1Repo.queryOne<any>(table, sql, qParams);
      }
      try {
        return getDb().prepare(sql).get(...qParams) as any;
      } catch {
        return null;
      }
    };

    const rawAuditId = params.auditId ? String(params.auditId).trim() : '';
    if (rawAuditId) {
      // 1a. Check site_audits by exact domain (normalized or raw)
      const normalizedDomain = rawAuditId
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0]
        .trim()
        .toLowerCase();
      let auditRow = await queryOne(
        'site_audits',
        'SELECT domain, target_url, business_name, status FROM site_audits WHERE domain = ? OR domain = ? LIMIT 1',
        [rawAuditId, normalizedDomain]
      );
      // 1b. Check commercial_evidence for scan IDs (e.g. `audit_<hex>`) and confirm corresponding site_audits row exists
      if (!auditRow) {
        const ceRow = await queryOne(
          'commercial_evidence',
          "SELECT request_reference, external_id, details_json FROM commercial_evidence WHERE request_reference = ? AND milestone = 'SITE_AUDIT_SCAN' LIMIT 1",
          [rawAuditId]
        );
        if (ceRow) {
          let ceDomain = '';
          try {
            const parsedUrl = ceRow.external_id || JSON.parse(ceRow.details_json || '{}')?.audit?.url;
            if (parsedUrl) {
              ceDomain = new URL(String(parsedUrl).startsWith('http') ? parsedUrl : `https://${parsedUrl}`).hostname.toLowerCase().replace(/^www\./, '');
            }
          } catch {}
          if (ceDomain) {
            auditRow = await queryOne(
              'site_audits',
              'SELECT domain, target_url, business_name, status FROM site_audits WHERE domain = ? LIMIT 1',
              [ceDomain]
            );
          }
          if (!auditRow) {
            // Verified scan row in commercial_evidence
            auditRow = { domain: ceDomain || rawAuditId, status: 'COMPLETED' };
          }
        }
      }
      if (auditRow) {
        return {
          verified: true,
          amountINR: 499,
          sku: 'SITEFIX_CORE_FIXPACK',
          businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
          organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
          invoiceRef: rawAuditId,
          serviceRendered: 'SiteFix AI Core Technical Fix-Pack',
          referenceType: 'SITE_AUDIT'
        };
      }
    }

    const reqRef = params.paymentRequestId || params.proposalId;
    if (reqRef) {
      const prRow = await queryOne(
        'payment_requests',
        'SELECT id, organization_id, business_id, proposal_id, offer_id, offer_description, amount_inr, status FROM payment_requests WHERE id = ? OR proposal_id = ? LIMIT 1',
        [String(reqRef).trim(), String(reqRef).trim()]
      );
      if (prRow && Number(prRow.amount_inr) > 0) {
        return {
          verified: true,
          amountINR: Number(prRow.amount_inr),
          sku: String(prRow.offer_id || 'COMMERCIAL_SERVICE'),
          businessId: String(prRow.business_id || OwnerAuthService.PLATFORM_BUSINESS_ID),
          organizationId: String(prRow.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID),
          invoiceRef: String(prRow.id),
          proposalId: prRow.proposal_id ? String(prRow.proposal_id) : undefined,
          serviceRendered: String(prRow.offer_description || 'Commercial Service'),
          referenceType: 'PAYMENT_REQUEST'
        };
      }
    }

    if (params.orderId) {
      const cleanOrdId = String(params.orderId).trim();
      const ordRow = await queryOne(
        'payment_orders',
        'SELECT id, business_id, order_id, amount_inr, receipt, notes_json FROM payment_orders WHERE id = ? OR order_id = ? LIMIT 1',
        [cleanOrdId, cleanOrdId]
      );
      if (ordRow && Number(ordRow.amount_inr) > 0) {
        let notesObj: any = {};
        try { notesObj = JSON.parse(ordRow.notes_json || '{}'); } catch {}
        return {
          verified: true,
          amountINR: Number(ordRow.amount_inr),
          sku: String(notesObj.sku || (Math.round(Number(ordRow.amount_inr)) === 499 ? 'SITEFIX_CORE_FIXPACK' : 'COMMERCIAL_ORDER')),
          businessId: String(ordRow.business_id || OwnerAuthService.PLATFORM_BUSINESS_ID),
          organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
          invoiceRef: String(ordRow.order_id || ordRow.id),
          serviceRendered: String(notesObj.serviceRendered || ordRow.receipt || 'Commercial Service'),
          referenceType: 'PAYMENT_ORDER'
        };
      }
      // Stage I.2: Server-created Customer Desk / owned checkout orders also persist in payment_requests (id / reference_id)
      const prOrdRow = await queryOne(
        'payment_requests',
        'SELECT id, organization_id, business_id, proposal_id, offer_id, offer_description, amount_inr, status FROM payment_requests WHERE id = ? OR reference_id = ? LIMIT 1',
        [cleanOrdId, cleanOrdId]
      );
      if (prOrdRow && Number(prOrdRow.amount_inr) > 0) {
        return {
          verified: true,
          amountINR: Number(prOrdRow.amount_inr),
          sku: String(prOrdRow.offer_id || 'COMMERCIAL_SERVICE'),
          businessId: String(prOrdRow.business_id || OwnerAuthService.PLATFORM_BUSINESS_ID),
          organizationId: String(prOrdRow.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID),
          invoiceRef: String(prOrdRow.id),
          proposalId: prOrdRow.proposal_id ? String(prOrdRow.proposal_id) : undefined,
          serviceRendered: String(prOrdRow.offer_description || 'Commercial Service'),
          referenceType: 'PAYMENT_REQUEST'
        };
      }
    }

    return null;
  }

  /**
   * Records a customer-claimed manual UPI payment (Spec § 15 & § 18).
   * Enforces atomic UTR uniqueness via conditional INSERT ... WHERE NOT EXISTS.
   * Status is set to PAYMENT_CLAIMED, NOT verified revenue!
   */
  public async recordManualUpiClaim(input: ManualUpiClaimInput): Promise<{
    claimId: string;
    status: 'PAYMENT_CLAIMED';
    utr: string;
    amountINR: number;
    invoiceRef?: string;
    proposalId?: string;
  }> {
    const trimmedUtr = (input.utr || '').trim();
    if (!trimmedUtr || trimmedUtr.length < 6 || trimmedUtr.startsWith('utr_')) {
      throw new Error('INVALID_UTR: Please provide a valid bank UTR / transaction reference (min 6 characters). Auto-generated UTRs are rejected.');
    }

    if (
      OwnerAuthService.isDisallowedFixedPaymentLink(trimmedUtr) ||
      OwnerAuthService.isDisallowedFixedPaymentLink(input.notes) ||
      OwnerAuthService.isDisallowedFixedPaymentLink(input.invoiceRef)
    ) {
      throw new Error('SECURITY VIOLATION: DISALLOWED_FIXED_PAYMENT_LINK: Fixed ₹100 test payment links cannot be used as UTR reference or payment notes.');
    }

    // Check business & proposal upfront (UTR uniqueness is ALSO enforced atomically at INSERT write boundary)
    let existingClaim: any = null;
    let biz: any = null;
    let prop: any = null;

    if (isProduction() && !process.env.VITEST) {
      existingClaim = await this.d1Repo.queryOne<any>('manual_upi_claims', 'SELECT id, status FROM manual_upi_claims WHERE utr = ?', [trimmedUtr]);
      biz = await this.d1Repo.queryOne<any>('businesses', 'SELECT id, organization_id FROM businesses WHERE id = ?', [input.businessId]);
      if (input.proposalId) {
        prop = await this.d1Repo.queryOne<any>('proposals', 'SELECT id, setup_price_inr FROM proposals WHERE id = ?', [input.proposalId]);
      }
    } else {
      existingClaim = getDb().prepare('SELECT id, status FROM manual_upi_claims WHERE utr = ?').get(trimmedUtr) as any;
      biz = getDb().prepare('SELECT id, organization_id FROM businesses WHERE id = ?').get(input.businessId) as any;
      if (input.proposalId) {
        prop = getDb().prepare('SELECT id, setup_price_inr FROM proposals WHERE id = ?').get(input.proposalId) as any;
      }
    }

    if (existingClaim) {
      throw new Error(`DUPLICATE_UTR_CLAIM: UTR '${trimmedUtr}' has already been registered (current status: ${existingClaim.status}). Duplicate submissions are rejected.`);
    }

    // Validate business exists
    if (!biz) {
      throw new Error(`BUSINESS_NOT_FOUND: Business ${input.businessId} does not exist.`);
    }

    // Validate deposit amount against proposal, offer, or permitted deposit amounts
    if (input.proposalId) {
      if (!prop) {
        throw new Error(`PROPOSAL_NOT_FOUND: Proposal '${input.proposalId}' does not exist.`);
      }
      if (Math.round(input.amountINR * 100) !== Math.round(prop.setup_price_inr * 100)) {
        throw new Error(`AMOUNT_MISMATCH: Claim amount ₹${input.amountINR} does not match proposal invoice amount ₹${prop.setup_price_inr}.`);
      }
    } else {
      // Check if invoiceRef binds to an issued payment link or order snapshot
      let issuedPriceINR: number | null = null;
      if (input.invoiceRef) {
        let linkRow: any = null;
        if (isProduction() && !process.env.VITEST) {
          linkRow = await this.d1Repo.queryOne<any>(
            'payment_provider_links',
            'SELECT amount_inr, business_id, organization_id FROM payment_provider_links WHERE (id = ? OR provider_link_id = ?) LIMIT 1',
            [input.invoiceRef, input.invoiceRef]
          );
        } else {
          linkRow = getDb().prepare(
            'SELECT amount_inr, business_id, organization_id FROM payment_provider_links WHERE (id = ? OR provider_link_id = ?) LIMIT 1'
          ).get(input.invoiceRef, input.invoiceRef) as any;
        }
        if (linkRow) {
          if (linkRow.business_id !== input.businessId || linkRow.organization_id !== biz.organization_id) {
            throw new Error(`UNAUTHORIZED_LINK_REFERENCE: Payment link '${input.invoiceRef}' does not belong to business '${input.businessId}'.`);
          }
          if (typeof linkRow.amount_inr === 'number' && linkRow.amount_inr > 0) {
            issuedPriceINR = linkRow.amount_inr;
          }
        } else {
          // Check if invoiceRef is an authentic issued order reference (e.g. HMAC-signed quote)
          const { DirectCommercialOfferPage } = await import('../revenue/direct-offer-page.js');
          const verifiedQuote = DirectCommercialOfferPage.verifyIssuedOrderReference(input.invoiceRef);
          if (verifiedQuote && verifiedQuote.valid && verifiedQuote.amountINR > 0) {
            if (verifiedQuote.boundOfferId && input.offerId && input.offerId !== verifiedQuote.boundOfferId) {
              throw new Error(`OFFER_MISMATCH: Order reference '${input.invoiceRef}' was issued for offer '${verifiedQuote.boundOfferId}', but caller supplied offer '${input.offerId}'.`);
            }
            issuedPriceINR = verifiedQuote.amountINR;
          }
        }
      }

      if (issuedPriceINR !== null) {
        if (Math.round(input.amountINR * 100) !== Math.round(issuedPriceINR * 100)) {
          throw new Error(`AMOUNT_MISMATCH: Claim amount ₹${input.amountINR} does not match issued payment link amount ₹${issuedPriceINR}.`);
        }
      } else if (input.offerId) {
        const offer = resolveAuthorizedOffer(input.offerId, input.businessId, biz.organization_id);
        if (!offer) {
          throw new Error(`UNAUTHORIZED_OFFER: Offer '${input.offerId}' could not be resolved.`);
        }
        if (Math.round(input.amountINR * 100) !== Math.round(offer.priceINR * 100)) {
          throw new Error(`AMOUNT_MISMATCH: Claim amount ₹${input.amountINR} does not match authoritative offer price ₹${offer.priceINR}.`);
        }
      } else {
        this.validatePermittedDeposit(input.amountINR, input.serviceRendered);
      }
    }

    const claimId = `claim_upi_${randomUUID().substring(0, 10)}`;

    let notesPayload: string | null = null;
    try {
      let baseNotes: Record<string, any> = {};
      if (input.notes) {
        baseNotes = typeof input.notes === 'string' ? JSON.parse(input.notes) : input.notes;
      }
      notesPayload = JSON.stringify({
        ...baseNotes,
        offerId: input.offerId || (input.invoiceRef?.startsWith('LCM') ? 'PLATFORM_MONTHLY' : (input.invoiceRef?.startsWith('LCS') ? 'PLATFORM_SETUP' : undefined)),
        amountINR: input.amountINR,
        serviceRendered: input.serviceRendered
      });
    } catch {
      notesPayload = input.notes ? String(input.notes) : null;
    }

    // Atomic conditional insert guarantees duplicate concurrent UTR submissions cannot race past check
    const atomicInsertSql = `
      INSERT INTO manual_upi_claims (
        id, organization_id, business_id, journey_id, proposal_id, invoice_ref,
        payer_name, payer_phone, payer_vpa, utr, amount_inr, service_rendered,
        status, claimed_at, notes
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAYMENT_CLAIMED', datetime('now'), ?
      WHERE NOT EXISTS (SELECT 1 FROM manual_upi_claims WHERE utr = ?)
    `;
    const insertParams = [
      claimId,
      biz.organization_id,
      input.businessId,
      input.journeyId || null,
      input.proposalId || null,
      input.invoiceRef || null,
      input.payerName || null,
      input.payerPhone || null,
      input.payerVpa || null,
      trimmedUtr,
      input.amountINR,
      input.serviceRendered || 'Manual UPI Payment Claim',
      notesPayload,
      trimmedUtr
    ];

    try {
      if (isProduction() && !process.env.VITEST) {
        const writeRes = await this.d1Repo.executeWrite('manual_upi_claims', atomicInsertSql, insertParams);
        if (!writeRes || writeRes.rowsAffected !== 1) {
          throw new Error(`DUPLICATE_UTR_CLAIM: UTR '${trimmedUtr}' already exists in manual_upi_claims.`);
        }
        if (input.proposalId) {
          try {
            await this.d1Repo.executeWrite(
              'payment_requests',
              `UPDATE payment_requests SET status = 'PAYMENT_CLAIMED', updated_at = datetime('now') WHERE proposal_id = ?`,
              [input.proposalId]
            );
          } catch {}
        }
      } else {
        const info = getDb().prepare(atomicInsertSql).run(...insertParams);
        if (!info || info.changes !== 1) {
          throw new Error(`DUPLICATE_UTR_CLAIM: UTR '${trimmedUtr}' already exists in manual_upi_claims.`);
        }
        if (input.proposalId) {
          try {
            getDb().prepare(`
              UPDATE payment_requests
              SET status = 'PAYMENT_CLAIMED', updated_at = datetime('now')
              WHERE proposal_id = ?
            `).run(input.proposalId);
          } catch {}
        }
      }
    } catch (writeErr: any) {
      const msg = String(writeErr?.message || '');
      if (msg.includes('DUPLICATE_UTR_CLAIM') || /UNIQUE constraint/i.test(msg)) {
        throw new Error(`DUPLICATE_UTR_CLAIM: UTR '${trimmedUtr}' has already been registered. Duplicate submissions are rejected.`);
      }
      throw writeErr;
    }

    return {
      claimId,
      status: 'PAYMENT_CLAIMED',
      utr: trimmedUtr,
      amountINR: input.amountINR,
      invoiceRef: input.invoiceRef,
      proposalId: input.proposalId
    };
  }

  /**
   * Advances a manual UPI claim through the explicit verified lifecycle:
   * PAYMENT_CLAIMED -> HUMAN_VERIFIED_PAYMENT -> FULFILLMENT_IN_PROGRESS -> FULFILLED
   * (plus REJECTED from PAYMENT_CLAIMED, and REFUNDED from post-verification states).
   */
  public async advanceManualUpiClaimLifecycle(params: {
    claimId: string;
    targetStatus: 'FULFILLMENT_IN_PROGRESS' | 'FULFILLED' | 'REJECTED' | 'REFUNDED';
    ownerUserId: string;
    reason?: string;
  }): Promise<{ claimId: string; fromStatus: string; status: string }> {
    const useRemoteD1 = isProduction() && !process.env.VITEST;
    const claimRow = useRemoteD1
      ? await this.d1Repo.queryOne<any>('manual_upi_claims', 'SELECT * FROM manual_upi_claims WHERE id = ?', [params.claimId])
      : (getDb().prepare('SELECT * FROM manual_upi_claims WHERE id = ?').get(params.claimId) as any);

    if (!claimRow) {
      throw new Error(`CLAIM_NOT_FOUND: Manual UPI claim '${params.claimId}' not found.`);
    }

    const fromStatus = String(claimRow.status || 'PAYMENT_CLAIMED').toUpperCase();
    const allowedNext = RazorpayAdapter.MANUAL_UPI_LIFECYCLE_TRANSITIONS[fromStatus] || [];
    if (!allowedNext.includes(params.targetStatus)) {
      throw new Error(
        `INVALID_CLAIM_TRANSITION: Cannot transition manual UPI claim '${params.claimId}' from '${fromStatus}' to '${params.targetStatus}'. Allowed: ${allowedNext.join(', ') || 'NONE'}.`
      );
    }

    const sql = params.targetStatus === 'REJECTED'
      ? `UPDATE manual_upi_claims SET status = ?, verified_at = datetime('now'), verified_by = ?, rejection_reason = ? WHERE id = ? AND status = ?`
      : `UPDATE manual_upi_claims SET status = ?, verified_at = COALESCE(verified_at, datetime('now')), verified_by = COALESCE(verified_by, ?) WHERE id = ? AND status = ?`;
    const sqlParams = params.targetStatus === 'REJECTED'
      ? [params.targetStatus, params.ownerUserId, params.reason || 'Rejected by owner after bank statement check', params.claimId, fromStatus]
      : [params.targetStatus, params.ownerUserId, params.claimId, fromStatus];

    if (useRemoteD1) {
      const res = await this.d1Repo.executeWrite('manual_upi_claims', sql, sqlParams);
      if (res.rowsAffected !== 1) {
        throw new Error(`CONCURRENT_CLAIM_UPDATE: Failed to update claim '${params.claimId}' from '${fromStatus}'.`);
      }
    } else {
      const info = getDb().prepare(sql).run(...sqlParams);
      if (info.changes !== 1) {
        throw new Error(`CONCURRENT_CLAIM_UPDATE: Failed to update claim '${params.claimId}' from '${fromStatus}'.`);
      }
    }

    return {
      claimId: params.claimId,
      fromStatus,
      status: params.targetStatus
    };
  }

  /**
   * Owner-Only Manual UPI Confirmation (Spec § 15, § 18 & Stage R Tasks 1 & 2).
   * Verifies bank credit, records revenue with authoritative tenant attribution,
   * generates SiteFix deliverable, and idempotently dispatches Brevo receipt email.
   * Only transitions to FULFILLED if both deliverable and receipt email succeeded.
   */
  public async confirmManualUpiClaim(params: {
    claimId?: string;
    utr: string;
    businessId: string;
    amountINR: number;
    journeyId?: string;
    ownerUserId: string;
    organizationId: string;
    invoiceNumber?: string;
    serviceRendered?: string;
  }): Promise<{
    success: boolean;
    transactionId: string;
    classification: 'MANUAL_VERIFIED';
    status: 'FULFILLED' | 'HUMAN_VERIFIED_PAYMENT';
    fulfillment?: any;
    downloadToken?: string;
    downloadUrl?: string;
    deliverableStatus?: string;
    emailReceiptStatus?: string;
  }> {
    let claimRow: any = null;

    if (isProduction() && !process.env.VITEST) {
      if (params.claimId) {
        claimRow = await this.d1Repo.queryOne<any>('manual_upi_claims', 'SELECT * FROM manual_upi_claims WHERE id = ?', [params.claimId]);
      } else if (params.utr) {
        claimRow = await this.d1Repo.queryOne<any>('manual_upi_claims', 'SELECT * FROM manual_upi_claims WHERE utr = ?', [params.utr.trim()]);
      }
    } else {
      if (params.claimId) {
        claimRow = getDb().prepare('SELECT * FROM manual_upi_claims WHERE id = ?').get(params.claimId) as any;
      } else if (params.utr) {
        claimRow = getDb().prepare('SELECT * FROM manual_upi_claims WHERE utr = ?').get(params.utr.trim()) as any;
      }
    }

    if (params.claimId && !claimRow) {
      throw new Error(`CLAIM_NOT_FOUND: Claim ID '${params.claimId}' does not exist.`);
    }

    const trimmedUtr = (params.utr || claimRow?.utr || '').trim();
    if (!trimmedUtr || trimmedUtr.startsWith('utr_')) {
      throw new Error('INVALID_UTR: Manual verification requires a verified banking UTR.');
    }

    if (claimRow) {
      if (params.utr && params.utr.trim() !== String(claimRow.utr || '').trim()) {
        throw new Error(`UTR_MISMATCH: Provided UTR '${params.utr.trim()}' does not match claimed UTR '${claimRow.utr}'.`);
      }
      if (params.amountINR !== undefined && params.amountINR !== null && claimRow.amount_inr !== undefined && claimRow.amount_inr !== null) {
        const pNum = Number(params.amountINR);
        const cNum = Number(claimRow.amount_inr);
        if (!Number.isFinite(pNum) || pNum <= 0 || !Number.isFinite(cNum) || cNum <= 0) {
          throw new Error(`AMOUNT_MISMATCH: Invalid or non-positive amount provided.`);
        }
        const pPaise = Math.round(pNum * 100);
        const cPaise = Math.round(cNum * 100);
        if (pPaise !== cPaise) {
          throw new Error(`AMOUNT_MISMATCH: Provided amount INR ${params.amountINR} does not match claimed amount ${claimRow.amount_inr}.`);
        }
      }
      if (claimRow.status === 'REJECTED' || claimRow.status === 'REFUNDED') {
        throw new Error(`CONFLICTING_CLAIM_STATUS: Claim ${claimRow.id} is marked as ${claimRow.status} and cannot be verified.`);
      }
    }

    // Check existing transaction for duplicate UTR idempotency
    let existing: any = null;
    if (isProduction() && !process.env.VITEST) {
      existing = await this.d1Repo.queryOne<any>('transactions', 'SELECT id FROM transactions WHERE transaction_ref = ?', [trimmedUtr]);
    } else {
      existing = getDb().prepare('SELECT id FROM transactions WHERE transaction_ref = ?').get(trimmedUtr) as any;
    }

    if (existing) {
      return {
        success: true,
        transactionId: existing.id,
        classification: 'MANUAL_VERIFIED',
        status: (claimRow?.status === 'FULFILLED' ? 'FULFILLED' : 'HUMAN_VERIFIED_PAYMENT') as any
      };
    }

    let notesObj: any = {};
    try {
      notesObj = typeof claimRow?.notes === 'string' ? JSON.parse(claimRow.notes) : (claimRow?.notes || {});
    } catch {}

    // Authoritative tenant attribution (Stage R Task 1: Never overwrite tenant business_id with platform default)
    const authoritativeBusinessId = claimRow?.business_id || params.businessId || OwnerAuthService.PLATFORM_BUSINESS_ID;
    const authoritativeOrgId = claimRow?.organization_id || params.organizationId || OwnerAuthService.OWNER_ORGANIZATION_ID;
    const authoritativeAmountINR = (claimRow?.amount_inr !== undefined && claimRow?.amount_inr !== null)
      ? Number(claimRow.amount_inr)
      : Number(params.amountINR || 499);
    const authoritativeJourneyId = claimRow?.journey_id || notesObj.journeyId || params.journeyId || undefined;
    const authoritativeService = claimRow?.service_rendered || notesObj.serviceRendered || params.serviceRendered || 'Manual UPI Payment - Owner Confirmed';
    const linkedProposalId: string | undefined = claimRow?.proposal_id;

    // Durably record transaction BEFORE publishing verified status (Spec Stage R.1 Task 2.3 & Comment #5)
    const tx = await this.revenueEngine.recordTransactionAsync({
      businessId: authoritativeBusinessId,
      organizationId: authoritativeOrgId,
      journeyId: authoritativeJourneyId,
      invoiceNumber: params.invoiceNumber || `INV-MANUAL-${Date.now()}`,
      amountINR: authoritativeAmountINR,
      paymentMethod: 'UPI',
      paymentGateway: 'MANUAL',
      transactionRef: trimmedUtr,
      status: 'SUCCESS',
      classification: 'MANUAL_VERIFIED',
      serviceRendered: authoritativeService
    });

    const isPlatform = authoritativeBusinessId === OwnerAuthService.PLATFORM_BUSINESS_ID || authoritativeBusinessId === 'biz_platform_aro';
    if (isPlatform) {
      try {
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite(
            'revenue_records',
            `INSERT INTO revenue_records (
              id, organization_id, business_id, revenue_type, source, transaction_id,
              amount_inr, currency, verified, verification_method, classification,
              recurring_model, timestamp
            ) VALUES (?, ?, ?, 'PLATFORM_REVENUE', 'MANUAL_VERIFIED', ?, ?, 'INR', 1, 'OWNER_MANUAL', 'MANUAL_VERIFIED', 'ONE_TIME', datetime('now'))
            ON CONFLICT(id) DO NOTHING`,
            [
              `rev_${trimmedUtr}`,
              authoritativeOrgId,
              authoritativeBusinessId,
              trimmedUtr,
              authoritativeAmountINR
            ]
          );
        } else {
          this.db.prepare(`
            INSERT INTO revenue_records (
              id, organization_id, business_id, revenue_type, source, transaction_id,
              amount_inr, currency, verified, verification_method, classification,
              recurring_model, timestamp
            ) VALUES (?, ?, ?, 'PLATFORM_REVENUE', 'MANUAL_VERIFIED', ?, ?, 'INR', 1, 'OWNER_MANUAL', 'MANUAL_VERIFIED', 'ONE_TIME', datetime('now'))
            ON CONFLICT(id) DO NOTHING
          `).run(
            `rev_${trimmedUtr}`,
            authoritativeOrgId,
            authoritativeBusinessId,
            trimmedUtr,
            authoritativeAmountINR
          );
        }
      } catch {}
    }

    // Transition claim status to HUMAN_VERIFIED_PAYMENT only after durable transaction write succeeds
    if (params.claimId) {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'manual_upi_claims',
          `UPDATE manual_upi_claims SET status = 'HUMAN_VERIFIED_PAYMENT', verified_at = datetime('now'), verified_by = ? WHERE id = ?`,
          [params.ownerUserId, params.claimId]
        );
      } else {
        this.db.prepare(`
          UPDATE manual_upi_claims
          SET status = 'HUMAN_VERIFIED_PAYMENT', verified_at = datetime('now'), verified_by = ?
          WHERE id = ?
        `).run(params.ownerUserId, params.claimId);
      }
    } else {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'manual_upi_claims',
          `UPDATE manual_upi_claims SET status = 'HUMAN_VERIFIED_PAYMENT', verified_at = datetime('now'), verified_by = ? WHERE utr = ? AND status = 'PAYMENT_CLAIMED'`,
          [params.ownerUserId, trimmedUtr]
        );
      } else {
        this.db.prepare(`
          UPDATE manual_upi_claims
          SET status = 'HUMAN_VERIFIED_PAYMENT', verified_at = datetime('now'), verified_by = ?
          WHERE utr = ? AND status = 'PAYMENT_CLAIMED'
        `).run(params.ownerUserId, trimmedUtr);
      }
    }

    // Update universal_orders if present for this UTR
    try {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'universal_orders',
          `UPDATE universal_orders SET status = 'PAID', fulfillment_status = 'COMPLETED', updated_at = datetime('now') WHERE provider_payment_id = ?`,
          [trimmedUtr]
        );
      } else {
        this.db.prepare(`
          UPDATE universal_orders
          SET status = 'PAID', fulfillment_status = 'COMPLETED', updated_at = datetime('now')
          WHERE provider_payment_id = ?
        `).run(trimmedUtr);
      }
    } catch {}

    // If claim is tied to a proposal, mark proposal and payment_request PAID
    if (linkedProposalId) {
      try {
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite('proposals', `UPDATE proposals SET status = 'PAID', updated_at = datetime('now') WHERE id = ?`, [linkedProposalId]);
          await this.d1Repo.executeWrite('payment_requests', `UPDATE payment_requests SET status = 'PAID', updated_at = datetime('now') WHERE proposal_id = ?`, [linkedProposalId]);
        } else {
          this.db.prepare(`UPDATE proposals SET status = 'PAID', updated_at = datetime('now') WHERE id = ?`).run(linkedProposalId);
          this.db.prepare(`UPDATE payment_requests SET status = 'PAID', updated_at = datetime('now') WHERE proposal_id = ?`).run(linkedProposalId);
        }
      } catch {}
    }

    if (authoritativeJourneyId) {
      try {
        this.journeyTracker.advanceStage({
          businessId: authoritativeBusinessId,
          visitorId: authoritativeJourneyId,
          targetStage: 'CUSTOMER'
        });
      } catch {}
    }

    // Connect Owner-Verified UPI Confirmation to full SiteFix Delivery
    const cleanDomain = (notesObj.domainOrUrl || notesObj.domain || claimRow?.invoice_ref || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .trim();
    const buyerEmail = (notesObj.buyerEmail || notesObj.email || claimRow?.payer_email || '').trim();

    let downloadToken: string | undefined;
    let downloadUrl: string | undefined;
    let siteFixDelivery: any = null;
    let emailReceiptStatus = 'PENDING_RETRY';
    let receiptAlreadySent = false;

    if (cleanDomain && (authoritativeAmountINR === 499 || Math.round(authoritativeAmountINR) === 499 || String(notesObj.sku || '').toLowerCase().includes('sitefix') || String(params.serviceRendered || '').toLowerCase().includes('sitefix'))) {
      try {
        const { SiteAuditService } = await import('../tools/site-audit/site-audit-service.js');
        const auditService = SiteAuditService.getInstance();
        let audit = await auditService.getAuditByDomain(cleanDomain);
        if (!audit) {
          audit = await auditService.runScan(`https://${cleanDomain}`);
          await auditService.persistAuditToD1(audit);
        }
        // Dot-free audit identifier prevents malformed delivery token split (Spec Stage R.1 Task 1 / Comment #6)
        const resolvedAuditId = (audit.auditId || audit.id || `audit_${cleanDomain}`).replace(/\./g, '_');
        audit.auditId = resolvedAuditId;
        auditService.setAuditInCache(audit);

        let uOrder: any = null;
        try {
          if (isProduction() && !process.env.VITEST) {
            uOrder = await this.d1Repo.queryOne<any>('universal_orders', 'SELECT id FROM universal_orders WHERE provider_payment_id = ?', [trimmedUtr]);
          } else {
            uOrder = this.db.prepare('SELECT id FROM universal_orders WHERE provider_payment_id = ?').get(trimmedUtr) as any;
          }
        } catch {}

        const effectiveOrderId = notesObj.orderId || uOrder?.id || claimRow?.id || `ord_upi_${trimmedUtr}`;
        await auditService.generateDeliverable(resolvedAuditId, effectiveOrderId);

        downloadToken = auditService.generateSignedDeliveryToken(effectiveOrderId, resolvedAuditId, trimmedUtr, 72);
        const siteUrl = getTrustedPublicSiteUrl().replace(/\/$/, '');
        downloadUrl = `${siteUrl}/api/v1/offer/download/${encodeURIComponent(downloadToken)}`;

        const resolvedJourneyId = authoritativeJourneyId || claimRow?.journey_id || notesObj.journeyId || params.journeyId || `cj_upi_${effectiveOrderId}`;
        try {
          const { RazorpayStandardAdapter } = await import('../payments/razorpay-adapter.js');
          await RazorpayStandardAdapter.getInstance().ensureCustomerJourney(
            resolvedJourneyId,
            buyerEmail || 'buyer@example.com',
            claimRow?.payer_name || 'UPI Customer',
            true, // isLive
            'PAYMENT_VERIFIED',
            authoritativeOrgId,
            authoritativeBusinessId
          );
        } catch {}

        const taskId = `deliv_${effectiveOrderId}_${trimmedUtr}`;
        await this.d1Repo.executeWrite(
          'delivery_tasks',
          `INSERT INTO delivery_tasks (
            id, organization_id, business_id, customer_journey_id,
            service_type, stage, deliverables_json, results_json,
            action_classification, completed_at, created_at
          ) VALUES (?, ?, ?, ?, 'SITE_AUDIT_FIXPACK', 'COMPLETED', ?, ?, 'INTERNAL_AUTOMATION', datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET stage = 'COMPLETED', deliverables_json = excluded.deliverables_json, results_json = excluded.results_json, completed_at = datetime('now')`,
          [
            taskId,
            authoritativeOrgId,
            authoritativeBusinessId,
            resolvedJourneyId,
            JSON.stringify({ auditId: resolvedAuditId, domain: cleanDomain, downloadToken, sku: notesObj.sku || 'sitefix_core_499' }),
            JSON.stringify({ status: 'DELIVERABLE_READY_EMAIL_PENDING', deliveredTo: buyerEmail, paymentId: trimmedUtr })
          ]
        );

        // Brevo receipt dispatch with per-payment idempotency
        const brevoReceiptKey = `brevo_receipt_${trimmedUtr}`;
        let shouldSendReceipt = false;

        if (buyerEmail && buyerEmail.includes('@')) {
          try {
            const existingReceipt = await this.d1Repo.queryOne<any>(
              'durable_events',
              `SELECT id, processed, error_message, created_at FROM durable_events WHERE id = ?`,
              [brevoReceiptKey]
            );

            if (existingReceipt) {
              if (existingReceipt.processed === 1) {
                receiptAlreadySent = true;
                emailReceiptStatus = 'SENT';
              } else {
                const isRetryable = typeof existingReceipt.error_message === 'string' && existingReceipt.error_message.startsWith('RETRYABLE:');
                const createdAtMs = new Date(existingReceipt.created_at).getTime();
                const isStale = isNaN(createdAtMs) || (Date.now() - createdAtMs > 600000); // 10m lease

                if (isRetryable || isStale) {
                  const reclaim = await this.d1Repo.executeWrite(
                    'durable_events',
                    `UPDATE durable_events SET error_message = 'PROCESSING', created_at = datetime('now') WHERE id = ? AND processed = 0 AND (error_message IS NULL OR error_message <> 'PROCESSING' OR created_at <= datetime('now', '-10 minutes'))`,
                    [brevoReceiptKey]
                  ).catch(() => ({ rowsAffected: 0 }));

                  const changes = (reclaim as any)?.rowsAffected ?? (reclaim as any)?.meta?.changes ?? 0;
                  if (changes === 1) {
                    shouldSendReceipt = true;
                  } else {
                    emailReceiptStatus = 'IN_FLIGHT';
                  }
                } else {
                  emailReceiptStatus = 'IN_FLIGHT';
                }
              }
            } else {
              try {
                await this.d1Repo.executeWrite(
                  'durable_events',
                  `INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
                   VALUES (?, 'BREVO_RECEIPT_CLAIMED', 'org_owner_primary', ?, 0, 'PROCESSING', datetime('now'))`,
                  [brevoReceiptKey, JSON.stringify({ orderId: effectiveOrderId, paymentId: trimmedUtr, buyerEmail, domain: cleanDomain })]
                );
                shouldSendReceipt = true;
              } catch (reserveErr: any) {
                const check = await this.d1Repo.queryOne<any>(
                  'durable_events',
                  'SELECT processed FROM durable_events WHERE id = ?',
                  [brevoReceiptKey]
                ).catch(() => null);
                if (check && check.processed === 1) {
                  receiptAlreadySent = true;
                  emailReceiptStatus = 'SENT';
                } else {
                  emailReceiptStatus = 'PENDING_RETRY';
                }
              }
            }
          } catch (e: any) {
            console.warn(`[confirmManualUpiClaim] Brevo receipt idempotency check notice: ${e.message}`);
          }

          if (shouldSendReceipt) {
            try {
              const { BrevoMcpClient } = await import('../integrations/brevo-mcp-client.js');
              const brevo = BrevoMcpClient.getInstance();
              const emailRes = await brevo.sendTransactionalEmail({
                to: buyerEmail,
                subject: `Payment Receipt & Fix-Pack Download (${effectiveOrderId})`,
                htmlContent: `
                  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
                    <h2 style="color:#0f172a;">Thank You for Your Order!</h2>
                    <p>Your payment of <strong>₹${Number(authoritativeAmountINR).toFixed(2)}</strong> for <strong>${cleanDomain}</strong> was verified successfully by the owner.</p>
                    <p><strong>Order ID:</strong> ${effectiveOrderId}<br><strong>Payment Ref (UTR):</strong> ${trimmedUtr}</p>
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
                await this.d1Repo.executeWrite(
                  'durable_events',
                  `UPDATE durable_events SET processed = 1, processed_at = datetime('now'), payload_json = ?, error_message = NULL WHERE id = ?`,
                  [
                    JSON.stringify({
                      orderId: effectiveOrderId,
                      paymentId: trimmedUtr,
                      buyerEmail,
                      domain: cleanDomain,
                      messageId: emailRes.messageId || null,
                      status: 'SENT'
                    }),
                    brevoReceiptKey
                  ]
                ).catch(() => {});
              } else {
                const failStatus = emailRes?.status || 'UNKNOWN_ERROR';
                await this.d1Repo.executeWrite(
                  'durable_events',
                  `UPDATE durable_events SET error_message = ? WHERE id = ? AND processed = 0`,
                  [`RETRYABLE:${failStatus}`, brevoReceiptKey]
                ).catch(() => {});
              }
            } catch (brevoErr: any) {
              await this.d1Repo.executeWrite(
                'durable_events',
                `UPDATE durable_events SET error_message = ? WHERE id = ? AND processed = 0`,
                [`RETRYABLE:${brevoErr.message}`, brevoReceiptKey]
              ).catch(() => {});
            }
          }
        }

        const finalFulfillmentStatus = (emailReceiptStatus === 'SENT' || receiptAlreadySent) ? 'EMAIL_ACCEPTED' : 'DELIVERABLE_READY_EMAIL_PENDING';
        await this.d1Repo.executeWrite(
          'universal_orders',
          `UPDATE universal_orders SET status = 'PAID', fulfillment_status = ?, updated_at = datetime('now') WHERE id = ? OR provider_payment_id = ?`,
          [finalFulfillmentStatus, effectiveOrderId, trimmedUtr]
        ).catch(() => {});

        siteFixDelivery = {
          auditId: resolvedAuditId,
          domain: cleanDomain,
          downloadToken,
          downloadUrl,
          fulfillmentStatus: finalFulfillmentStatus,
          deliverableStatus: 'READY'
        };
      } catch (siteFixErr: any) {
        console.error(`[confirmManualUpiClaim] SiteFix delivery error: ${siteFixErr.message}`);
      }
    }

    // Trigger verified fulfillment provisioning with authoritative IDs
    let fulfillment: any = null;
    try {
      const { DeliveryEngine } = await import('../revenue/delivery-engine.js');
      const skuFromClaim = (() => {
        try {
          const parsedNotes = typeof claimRow?.notes === 'string' ? JSON.parse(claimRow.notes) : claimRow?.notes;
          return parsedNotes?.sku || params.serviceRendered || parsedNotes?.offerId || 'SITEFIX_CORE_499';
        } catch {
          return params.serviceRendered || 'SITEFIX_CORE_499';
        }
      })();
      fulfillment = await DeliveryEngine.getInstance().provisionVerifiedOrderFulfillment({
        organizationId: authoritativeOrgId,
        businessId: authoritativeBusinessId,
        customerJourneyId: authoritativeJourneyId,
        claimId: params.claimId || claimRow?.id,
        paymentId: trimmedUtr,
        sku: String(skuFromClaim),
        serviceType: String(skuFromClaim),
        amountINR: authoritativeAmountINR,
        verificationSource: 'HUMAN_VERIFIED_PAYMENT',
        isDiagnostic: Number(claimRow?.is_test || 0) === 1
      });
    } catch {}

    const hasFixPack = Boolean(downloadToken || siteFixDelivery?.downloadToken);
    const hasEmailReceipt = Boolean(emailReceiptStatus === 'SENT' || (receiptAlreadySent && buyerEmail && buyerEmail.includes('@')));
    const isFullyFulfilled = Boolean(hasFixPack && hasEmailReceipt && buyerEmail && buyerEmail.includes('@'));

    let finalStatus: 'FULFILLED' | 'HUMAN_VERIFIED_PAYMENT' = isFullyFulfilled ? 'FULFILLED' : 'HUMAN_VERIFIED_PAYMENT';

    if (isFullyFulfilled) {
      try {
        const claimIdentifier = claimRow?.id || trimmedUtr;
        const whereField = claimRow?.id ? 'id' : 'utr';
        const sql = `UPDATE manual_upi_claims SET status = 'FULFILLED' WHERE ${whereField} = ? AND status IN ('HUMAN_VERIFIED_PAYMENT', 'FULFILLMENT_IN_PROGRESS', 'PAYMENT_CLAIMED')`;
        let rowsAffected = 0;
        if (isProduction() && !process.env.VITEST) {
          const res = await this.d1Repo.executeWrite('manual_upi_claims', sql, [claimIdentifier]);
          rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.meta?.changes ?? 0;
        } else {
          const res = this.db.prepare(sql).run(claimIdentifier);
          rowsAffected = res.changes;
        }
        if (rowsAffected === 0) {
          const latest = isProduction() && !process.env.VITEST
            ? await this.d1Repo.queryOne<any>('manual_upi_claims', `SELECT status FROM manual_upi_claims WHERE ${whereField} = ?`, [claimIdentifier])
            : this.db.prepare(`SELECT status FROM manual_upi_claims WHERE ${whereField} = ?`).get(claimIdentifier) as any;
          finalStatus = (latest?.status || 'HUMAN_VERIFIED_PAYMENT') as any;
        }
      } catch (err: any) {
        console.error(`[confirmManualUpiClaim] Failed to update claim status to FULFILLED: ${err.message}`);
        finalStatus = 'HUMAN_VERIFIED_PAYMENT';
      }
    }

    return {
      success: true,
      transactionId: tx.id,
      classification: 'MANUAL_VERIFIED',
      status: finalStatus,
      fulfillment: siteFixDelivery || fulfillment,
      downloadToken,
      downloadUrl,
      deliverableStatus: (hasFixPack || fulfillment) ? 'READY' : undefined,
      emailReceiptStatus
    };
  }

  /**
   * Idempotent owner-authenticated fulfillment retry for verified manual UPI claims (Stage R Task 2).
   * Re-runs domain audit Fix-Pack generation & signed token issuance,
   * plus idempotent Brevo receipt dispatch (brevo_receipt_<utr>).
   */
  public async retryManualUpiFulfillment(
    claimIdOrUtr: string,
    options?: { ownerUserId?: string }
  ): Promise<{
    success: boolean;
    status: 'FULFILLED' | 'FULFILLMENT_IN_PROGRESS';
    claimId: string;
    utr: string;
    downloadUrl?: string;
    downloadToken?: string;
    emailReceiptStatus: string;
    deliverableStatus: string;
  }> {
    const rawId = String(claimIdOrUtr || '').trim();
    if (!rawId) {
      throw new Error('INVALID_CLAIM_IDENTIFIER: claimId or utr is required.');
    }

    let claimRow: any = null;
    if (isProduction() && !process.env.VITEST) {
      claimRow = await this.d1Repo.queryOne<any>(
        'manual_upi_claims',
        'SELECT * FROM manual_upi_claims WHERE id = ? OR utr = ? ORDER BY claimed_at DESC LIMIT 1',
        [rawId, rawId]
      );
    } else {
      claimRow = getDb().prepare(
        'SELECT * FROM manual_upi_claims WHERE id = ? OR utr = ? ORDER BY claimed_at DESC LIMIT 1'
      ).get(rawId, rawId) as any;
    }

    if (!claimRow) {
      throw new Error(`CLAIM_NOT_FOUND: Manual UPI claim '${rawId}' does not exist.`);
    }

    if (claimRow.status === 'PAYMENT_CLAIMED') {
      throw new Error(`UNVERIFIED_PAYMENT: Claim '${claimRow.id}' has not been confirmed by the owner yet. Bank credit must be verified first.`);
    }

    if (claimRow.status === 'REJECTED' || claimRow.status === 'REFUNDED') {
      throw new Error(`CONFLICTING_CLAIM_STATUS: Claim '${claimRow.id}' has status '${claimRow.status}' and cannot be fulfilled.`);
    }

    let notesObj: any = {};
    try {
      notesObj = typeof claimRow.notes === 'string' ? JSON.parse(claimRow.notes) : (claimRow.notes || {});
    } catch {}

    const cleanDomain = (notesObj.domainOrUrl || notesObj.domain || claimRow.invoice_ref || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '')
      .trim();
    const buyerEmail = (notesObj.buyerEmail || notesObj.email || claimRow.payer_email || '').trim();
    const effectiveOrderId = notesObj.orderId || claimRow.id || `ord_upi_${claimRow.utr}`;
    const trimmedUtr = claimRow.utr;
    const authoritativeBusinessId = claimRow.business_id || OwnerAuthService.PLATFORM_BUSINESS_ID;
    const authoritativeOrgId = claimRow.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;

    // Ensure durable transaction record exists before advancing to fulfillment (Spec Stage R.1 Task 2.3 & Comment #5)
    let existingTx: any = null;
    if (isProduction() && !process.env.VITEST) {
      existingTx = await this.d1Repo.queryOne<any>('transactions', 'SELECT id FROM transactions WHERE transaction_ref = ?', [trimmedUtr]);
    } else {
      existingTx = getDb().prepare('SELECT id FROM transactions WHERE transaction_ref = ?').get(trimmedUtr) as any;
    }

    if (!existingTx) {
      try {
        await this.revenueEngine.recordTransactionAsync({
          businessId: authoritativeBusinessId,
          organizationId: authoritativeOrgId,
          journeyId: claimRow.journey_id || notesObj.journeyId || undefined,
          invoiceNumber: `INV-MANUAL-${trimmedUtr}`,
          amountINR: Number(claimRow.amount_inr || 499),
          paymentMethod: 'UPI',
          paymentGateway: 'MANUAL',
          transactionRef: trimmedUtr,
          status: 'SUCCESS',
          classification: 'MANUAL_VERIFIED',
          serviceRendered: 'Manual UPI Payment - Owner Confirmed'
        });
      } catch (err: any) {
        throw new Error(`TRANSACTION_PERSISTENCE_FAILED: Cannot fulfill claim without durable transaction: ${err.message}`);
      }
    }

    let downloadToken: string | undefined;
    let downloadUrl: string | undefined;
    let deliverableStatus = 'PENDING';

    if (cleanDomain) {
      try {
        const { SiteAuditService } = await import('../tools/site-audit/site-audit-service.js');
        const auditService = SiteAuditService.getInstance();
        let audit = await auditService.getAuditByDomain(cleanDomain);
        if (!audit) {
          audit = await auditService.runScan(`https://${cleanDomain}`);
          await auditService.persistAuditToD1(audit);
        }
        // Dot-free audit identifier prevents malformed delivery token split (Spec Stage R.1 Task 1 / Comment #6)
        const resolvedAuditId = (audit.auditId || audit.id || `audit_${cleanDomain}`).replace(/\./g, '_');
        audit.auditId = resolvedAuditId;
        auditService.setAuditInCache(audit);

        await auditService.generateDeliverable(resolvedAuditId, effectiveOrderId);
        downloadToken = auditService.generateSignedDeliveryToken(effectiveOrderId, resolvedAuditId, trimmedUtr, 72);
        const siteUrl = getTrustedPublicSiteUrl().replace(/\/$/, '');
        downloadUrl = `${siteUrl}/api/v1/offer/download/${encodeURIComponent(downloadToken)}`;
        deliverableStatus = 'READY';

        const journeyId = claimRow.journey_id || notesObj.journeyId || `cj_upi_${effectiveOrderId}`;
        try {
          const { RazorpayStandardAdapter } = await import('../payments/razorpay-adapter.js');
          await RazorpayStandardAdapter.getInstance().ensureCustomerJourney(
            journeyId,
            buyerEmail || 'buyer@example.com',
            claimRow.payer_name || 'UPI Customer',
            true,
            'PAYMENT_VERIFIED',
            authoritativeOrgId,
            authoritativeBusinessId
          );
        } catch {}

        const taskId = `deliv_${effectiveOrderId}_${trimmedUtr}`;
        await this.d1Repo.executeWrite(
          'delivery_tasks',
          `INSERT INTO delivery_tasks (
            id, organization_id, business_id, customer_journey_id,
            service_type, stage, deliverables_json, results_json,
            action_classification, completed_at, created_at
          ) VALUES (?, ?, ?, ?, 'SITE_AUDIT_FIXPACK', 'COMPLETED', ?, ?, 'INTERNAL_AUTOMATION', datetime('now'), datetime('now'))
          ON CONFLICT(id) DO UPDATE SET stage = 'COMPLETED', deliverables_json = excluded.deliverables_json, results_json = excluded.results_json, completed_at = datetime('now')`,
          [
            taskId,
            authoritativeOrgId,
            authoritativeBusinessId,
            journeyId,
            JSON.stringify({ auditId: resolvedAuditId, domain: cleanDomain, downloadToken, sku: notesObj.sku || 'sitefix_core_499' }),
            JSON.stringify({ status: 'DELIVERABLE_READY', deliveredTo: buyerEmail, paymentId: trimmedUtr })
          ]
        );
      } catch (err: any) {
        console.error(`[retryManualUpiFulfillment] Deliverable generation error: ${err.message}`);
      }
    }

    // Brevo receipt dispatch
    let emailReceiptStatus = 'PENDING_RETRY';
    const brevoReceiptKey = `brevo_receipt_${trimmedUtr}`;
    let shouldSendReceipt = false;
    let receiptAlreadySent = false;

    if (buyerEmail && buyerEmail.includes('@')) {
      try {
        const existingReceipt = await this.d1Repo.queryOne<any>(
          'durable_events',
          `SELECT id, processed, error_message, created_at FROM durable_events WHERE id = ?`,
          [brevoReceiptKey]
        );

        if (existingReceipt) {
          if (existingReceipt.processed === 1) {
            receiptAlreadySent = true;
            emailReceiptStatus = 'SENT';
          } else {
            const isRetryable = typeof existingReceipt.error_message === 'string' && existingReceipt.error_message.startsWith('RETRYABLE:');
            const createdAtMs = new Date(existingReceipt.created_at).getTime();
            const isStale = isNaN(createdAtMs) || (Date.now() - createdAtMs > 600000); // 10m lease

            if (isRetryable || isStale) {
              const reclaim = await this.d1Repo.executeWrite(
                'durable_events',
                `UPDATE durable_events SET error_message = 'PROCESSING', created_at = datetime('now') WHERE id = ? AND processed = 0 AND (error_message IS NULL OR error_message <> 'PROCESSING' OR created_at <= datetime('now', '-10 minutes'))`,
                [brevoReceiptKey]
              ).catch(() => ({ rowsAffected: 0 }));
              const changes = (reclaim as any)?.rowsAffected ?? (reclaim as any)?.meta?.changes ?? 0;
              if (changes === 1) {
                shouldSendReceipt = true;
              } else {
                emailReceiptStatus = 'IN_FLIGHT';
              }
            } else {
              emailReceiptStatus = 'IN_FLIGHT';
            }
          }
        } else {
          try {
            await this.d1Repo.executeWrite(
              'durable_events',
              `INSERT INTO durable_events (id, event_type, organization_id, payload_json, processed, error_message, created_at)
               VALUES (?, 'BREVO_RECEIPT_CLAIMED', 'org_owner_primary', ?, 0, 'PROCESSING', datetime('now'))`,
              [brevoReceiptKey, JSON.stringify({ orderId: effectiveOrderId, paymentId: trimmedUtr, buyerEmail, domain: cleanDomain })]
            );
            shouldSendReceipt = true;
          } catch {
            const check = await this.d1Repo.queryOne<any>(
              'durable_events',
              'SELECT processed FROM durable_events WHERE id = ?',
              [brevoReceiptKey]
            ).catch(() => null);
            if (check && check.processed === 1) {
              receiptAlreadySent = true;
              emailReceiptStatus = 'SENT';
            } else {
              emailReceiptStatus = 'PENDING_RETRY';
            }
          }
        }
      } catch (e: any) {
        console.warn(`[retryManualUpiFulfillment] Brevo idempotency check notice: ${e.message}`);
      }

      if (shouldSendReceipt && downloadUrl) {
        try {
          const { BrevoMcpClient } = await import('../integrations/brevo-mcp-client.js');
          const brevo = BrevoMcpClient.getInstance();
          const emailRes = await brevo.sendTransactionalEmail({
            to: buyerEmail,
            subject: `Payment Receipt & Fix-Pack Download (${effectiveOrderId})`,
            htmlContent: `
              <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #e2e8f0;border-radius:8px;">
                <h2 style="color:#0f172a;">Thank You for Your Order!</h2>
                <p>Your payment of <strong>₹${Number(claimRow.amount_inr || 499).toFixed(2)}</strong> for <strong>${cleanDomain}</strong> was verified successfully.</p>
                <p><strong>Order ID:</strong> ${effectiveOrderId}<br><strong>Payment Ref (UTR):</strong> ${trimmedUtr}</p>
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
            await this.d1Repo.executeWrite(
              'durable_events',
              `UPDATE durable_events SET processed = 1, processed_at = datetime('now'), payload_json = ?, error_message = NULL WHERE id = ?`,
              [
                JSON.stringify({
                  orderId: effectiveOrderId,
                  paymentId: trimmedUtr,
                  buyerEmail,
                  domain: cleanDomain,
                  messageId: emailRes.messageId || null,
                  status: 'SENT'
                }),
                brevoReceiptKey
              ]
            ).catch(() => {});
          } else {
            const failStatus = emailRes?.status || 'UNKNOWN_ERROR';
            await this.d1Repo.executeWrite(
              'durable_events',
              `UPDATE durable_events SET error_message = ? WHERE id = ? AND processed = 0`,
              [`RETRYABLE:${failStatus}`, brevoReceiptKey]
            ).catch(() => {});
          }
        } catch (brevoErr: any) {
          await this.d1Repo.executeWrite(
            'durable_events',
            `UPDATE durable_events SET error_message = ? WHERE id = ? AND processed = 0`,
            [`RETRYABLE:${brevoErr.message}`, brevoReceiptKey]
          ).catch(() => {});
        }
      }
    }

    if (!buyerEmail || !buyerEmail.includes('@')) {
      emailReceiptStatus = 'MISSING_BUYER_EMAIL';
    }

    const isDeliverableReady = deliverableStatus === 'READY' && Boolean(downloadToken);
    const hasEmailReceipt = Boolean(emailReceiptStatus === 'SENT' || (receiptAlreadySent && buyerEmail && buyerEmail.includes('@')));
    const isFulfilled = Boolean(isDeliverableReady && hasEmailReceipt && buyerEmail && buyerEmail.includes('@'));

    let finalStatus: 'FULFILLED' | 'FULFILLMENT_IN_PROGRESS' = isFulfilled ? 'FULFILLED' : 'FULFILLMENT_IN_PROGRESS';
    const finalFulfillmentStatus = isFulfilled ? 'EMAIL_ACCEPTED' : 'DELIVERABLE_READY_EMAIL_PENDING';

    if (isFulfilled) {
      try {
        const sql = `UPDATE manual_upi_claims SET status = 'FULFILLED' WHERE id = ? AND status IN ('HUMAN_VERIFIED_PAYMENT', 'FULFILLMENT_IN_PROGRESS')`;
        let rowsAffected = 0;
        if (isProduction() && !process.env.VITEST) {
          const res = await this.d1Repo.executeWrite('manual_upi_claims', sql, [claimRow.id]);
          rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.meta?.changes ?? 0;
        } else {
          const res = this.db.prepare(sql).run(claimRow.id);
          rowsAffected = res.changes;
        }
        if (rowsAffected === 0) {
          const latest = isProduction() && !process.env.VITEST
            ? await this.d1Repo.queryOne<any>('manual_upi_claims', 'SELECT status FROM manual_upi_claims WHERE id = ?', [claimRow.id])
            : this.db.prepare('SELECT status FROM manual_upi_claims WHERE id = ?').get(claimRow.id) as any;
          finalStatus = (latest?.status || 'FULFILLMENT_IN_PROGRESS') as any;
        }
      } catch (err: any) {
        console.error(`[retryManualUpiFulfillment] Failed to update status to FULFILLED: ${err.message}`);
        finalStatus = 'FULFILLMENT_IN_PROGRESS';
      }
    } else {
      try {
        const sql = `UPDATE manual_upi_claims SET status = 'FULFILLMENT_IN_PROGRESS' WHERE id = ? AND status IN ('HUMAN_VERIFIED_PAYMENT', 'FULFILLMENT_IN_PROGRESS')`;
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite('manual_upi_claims', sql, [claimRow.id]);
        } else {
          this.db.prepare(sql).run(claimRow.id);
        }
      } catch {}
    }

    await this.d1Repo.executeWrite(
      'universal_orders',
      `UPDATE universal_orders SET status = 'PAID', fulfillment_status = ?, updated_at = datetime('now') WHERE id = ? OR provider_payment_id = ?`,
      [finalFulfillmentStatus, effectiveOrderId, trimmedUtr]
    ).catch(() => {});

    return {
      success: true,
      status: finalStatus,
      claimId: claimRow.id,
      utr: trimmedUtr,
      downloadUrl,
      downloadToken,
      emailReceiptStatus,
      deliverableStatus
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
    handled?: boolean;
    duplicate?: boolean;
    status?: string;
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
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite('payment_orders', `UPDATE payment_orders SET status = 'FAILED', updated_at = datetime('now') WHERE order_id = ?`, [orderId]);
        } else {
          try {
            getDb().prepare(`UPDATE payment_orders SET status = 'FAILED', updated_at = datetime('now') WHERE order_id = ?`).run(orderId);
          } catch {}
        }
      }
      if (linkId) {
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite('payment_requests', `UPDATE payment_requests SET status = 'FAILED', updated_at = datetime('now') WHERE provider_link_id = ?`, [linkId]);
          await this.d1Repo.executeWrite('payment_provider_links', `UPDATE payment_provider_links SET status = 'FAILED' WHERE provider_link_id = ?`, [linkId]);
        } else {
          try {
            getDb().prepare(`UPDATE payment_requests SET status = 'FAILED', updated_at = datetime('now') WHERE provider_link_id = ?`).run(linkId);
            getDb().prepare(`UPDATE payment_provider_links SET status = 'FAILED' WHERE provider_link_id = ?`).run(linkId);
          } catch {}
        }
      }
      return { processed: true, handled: true, status: 'failed_recorded', reason: 'Payment failed event recorded.' };
    }

    if (eventType === 'refund.processed') {
      const refund = event.payload?.refund?.entity;
      const orderId = refund?.order_id;
      if (orderId) {
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite('payment_orders', `UPDATE payment_orders SET status = 'REFUNDED', updated_at = datetime('now') WHERE order_id = ?`, [orderId]);
        } else {
          try {
            getDb().prepare(`UPDATE payment_orders SET status = 'REFUNDED', updated_at = datetime('now') WHERE order_id = ?`).run(orderId);
          } catch {}
        }
      }
      return { processed: true, handled: true, status: 'refund_recorded', reason: 'Refund processed event recorded.' };
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
    let receivedAmountPaise = Number(payment?.amount || paymentLink?.amount_paid || paymentLink?.amount || 0);

    // Stage I.2-A: In live production with Razorpay credentials configured, independently verify capture with Razorpay API
    if (!process.env.VITEST && isProduction() && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      const providerPayment = await this.fetchPayment(paymentId);
      const providerStatus = String(providerPayment?.status || '').toLowerCase();
      if (providerStatus !== 'captured' && providerStatus !== 'authorized') {
        throw new Error(`SECURITY VIOLATION: Provider payment '${paymentId}' status is '${providerStatus || 'unknown'}', expected 'captured'.`);
      }
      if (typeof providerPayment?.amount === 'number' && providerPayment.amount > 0) {
        receivedAmountPaise = providerPayment.amount;
      }
    }
    const amountINR = receivedAmountPaise / 100;

    // Spec § 5: Webhook identity must come from internal stored records
    let storedLink: any = null;
    let storedPayReq: any = null;
    let storedOrder: any = null;

    if (providerLinkId) {
      if (isProduction() && !process.env.VITEST) {
        storedLink = await this.d1Repo.queryOne('payment_provider_links', `SELECT * FROM payment_provider_links WHERE provider_link_id = ?`, [providerLinkId]);
        storedPayReq = await this.d1Repo.queryOne('payment_requests', `SELECT * FROM payment_requests WHERE provider_link_id = ?`, [providerLinkId]);
      } else {
        try {
          storedLink = getDb().prepare(`SELECT * FROM payment_provider_links WHERE provider_link_id = ?`).get(providerLinkId) as any;
          storedPayReq = getDb().prepare(`SELECT * FROM payment_requests WHERE provider_link_id = ?`).get(providerLinkId) as any;
        } catch {}
      }
    }

    if (orderId) {
      if (isProduction() && !process.env.VITEST) {
        storedOrder = await this.d1Repo.queryOne('payment_orders', `SELECT * FROM payment_orders WHERE order_id = ?`, [orderId]);
        if (!storedOrder) {
          storedOrder = await this.d1Repo.queryOne('universal_orders', `SELECT id as order_id, business_id, organization_id, amount_minor, customer_phone FROM universal_orders WHERE id = ? OR provider_order_id = ?`, [orderId, orderId]);
        }
      } else {
        try {
          storedOrder = getDb().prepare(`SELECT * FROM payment_orders WHERE order_id = ?`).get(orderId) as any;
          if (!storedOrder) {
            storedOrder = getDb().prepare(`SELECT id as order_id, business_id, organization_id, amount_minor, customer_phone FROM universal_orders WHERE id = ? OR provider_order_id = ?`).get(orderId, orderId) as any;
          }
        } catch {}
      }
    }

    if (!storedLink && !storedPayReq && !storedOrder) {
      throw new Error(`SECURITY VIOLATION: Unrecognized provider transaction. Payment link record not found for link '${providerLinkId}' or order '${orderId}'. Revenue cannot be created without stored internal authority.`);
    }

    // 4. Derive tenant strictly from stored internal record
    const businessId = storedLink?.business_id || storedPayReq?.business_id || storedOrder?.business_id;
    let organizationId = storedLink?.organization_id || storedPayReq?.organization_id || storedOrder?.organization_id;
    if (!organizationId && businessId) {
      if (isProduction() && !process.env.VITEST) {
        const bizRow = await this.d1Repo.queryOne('businesses', 'SELECT organization_id FROM businesses WHERE id = ?', [businessId]);
        organizationId = bizRow?.organization_id;
      } else {
        try {
          const bizRow = getDb().prepare('SELECT organization_id FROM businesses WHERE id = ?').get(businessId) as any;
          organizationId = bizRow?.organization_id;
        } catch {}
      }
    }
    if (!organizationId) {
      organizationId = OwnerAuthService.OWNER_ORGANIZATION_ID;
    }

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

    // Item 3: Atomic Webhook Idempotency via unique-constraint insert into processed_webhook_events
    const eventId = event?.id || (paymentId ? `rzp_evt_${paymentId}` : `rzp_evt_${Date.now()}`);
    const payloadHash = createHash('sha256').update(params.rawBody).digest('hex');

    let isDuplicate = false;
    if (isProduction() && !process.env.VITEST) {
      try {
        await this.d1Repo.executeWrite(
          'processed_webhook_events',
          `INSERT INTO processed_webhook_events (
            event_id, event_type, payload_hash, order_id, payment_id, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
          [eventId, eventType, payloadHash, orderId || null, paymentId || null]
        );
      } catch (insertErr: any) {
        const isConflict =
          insertErr?.message?.includes('UNIQUE constraint failed') ||
          insertErr?.message?.includes('PRIMARY KEY must be unique') ||
          insertErr?.message?.includes('already exists') ||
          insertErr?.code === 'SQLITE_CONSTRAINT';

        if (isConflict) {
          isDuplicate = true;
        } else {
          throw insertErr;
        }
      }
    } else {
      // Local dev / test SQLite environment
      try {
        getDb().prepare(`
          INSERT INTO processed_webhook_events (
            event_id, event_type, payload_hash, order_id, payment_id, created_at
          ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).run(eventId, eventType, payloadHash, orderId || null, paymentId || null);
      } catch (insertErr: any) {
        const isConflict =
          insertErr?.message?.includes('UNIQUE constraint failed') ||
          insertErr?.message?.includes('PRIMARY KEY must be unique') ||
          insertErr?.message?.includes('already exists') ||
          insertErr?.code === 'SQLITE_CONSTRAINT';

        if (isConflict) {
          isDuplicate = true;
        }
      }

      try {
        getDb().prepare(`
          INSERT INTO idempotent_actions (
            idempotency_key, action_type, target_id, tenant_id, executed_at, status, result_json
          ) VALUES (?, 'RAZORPAY_WEBHOOK', ?, ?, datetime('now'), 'PROCESSING', '{}')
        `).run(eventId, paymentId || eventId, businessId);
      } catch (insertErr: any) {
        const isConflict =
          insertErr?.message?.includes('UNIQUE constraint failed') ||
          insertErr?.message?.includes('PRIMARY KEY must be unique') ||
          insertErr?.message?.includes('already exists') ||
          insertErr?.code === 'SQLITE_CONSTRAINT';

        if (isConflict) {
          isDuplicate = true;
        }
      }
    }

    if (isDuplicate) {
      let existingTx: any = null;
      if (isProduction() && !process.env.VITEST) {
        existingTx = await this.d1Repo.queryOne('transactions', 'SELECT id FROM transactions WHERE transaction_ref = ?', [paymentId]);
      } else {
        try {
          existingTx = getDb().prepare('SELECT id FROM transactions WHERE transaction_ref = ?').get(paymentId) as any;
        } catch {}
      }
      return {
        processed: true,
        handled: true,
        duplicate: true,
        status: 'duplicate_ignored',
        reason: `Payment ${paymentId} / event ${eventId} already processed (idempotency key matched).`,
        transactionId: existingTx?.id,
        amountINR,
        journeyId
      };
    }

    // Assert D1 durable storage in production before state transitions
    if (orderId) {
      D1RevenueRepository.getInstance().assertDurableStorage('payment_orders');
    }
    if (providerLinkId) {
      D1RevenueRepository.getInstance().assertDurableStorage('payment_provider_links');
      D1RevenueRepository.getInstance().assertDurableStorage('payment_requests');
    }
    D1RevenueRepository.getInstance().assertDurableStorage('transactions');

    // Record explicit economic entity revenue_records in D1 durable storage (Spec § 3, § 24, § 25, Item 6: Fail-Closed)
    const isPlatformRevenue = businessId === OwnerAuthService.PLATFORM_BUSINESS_ID || businessId === 'biz_platform_aro';
    const revenueType = isPlatformRevenue ? 'PLATFORM_REVENUE' : 'CLIENT_REVENUE';
    const matchedLinkId = providerLinkId;
    const revRecordId = `rev_${Date.now()}_${randomUUID().substring(0, 6)}`;
    const d1Repo = D1RevenueRepository.getInstance();

    // Assert D1 durable storage in production before state transitions
    if (orderId) {
      d1Repo.assertDurableStorage('payment_orders');
    }
    if (providerLinkId) {
      d1Repo.assertDurableStorage('payment_provider_links');
      d1Repo.assertDurableStorage('payment_requests');
    }
    d1Repo.assertDurableStorage('transactions');
    d1Repo.assertDurableStorage('revenue_records');

    // Fail-Closed Gate: Write revenue_records to D1 repository FIRST.
    // If writing revenue_records to D1 throws or fails, payment status MUST NOT transition to PAID
    // or success, and the customer MUST NOT be marked ONBOARDED.
    // Set status to RECONCILIATION_REQUIRED, log error, and throw so webhook returns 500 and Razorpay retries.
    try {
      await d1Repo.executeWrite(
        'revenue_records',
        `INSERT INTO revenue_records (
          id, organization_id, business_id, revenue_type, source, transaction_id,
          amount_inr, currency, verified, verification_method, classification,
          recurring_model, timestamp
        ) VALUES (?, ?, ?, ?, 'RAZORPAY', ?, ?, 'INR', 1, 'RAZORPAY_WEBHOOK', ?, 'ONE_TIME', datetime('now'))`,
        [
          revRecordId,
          organizationId,
          businessId,
          revenueType,
          paymentId,
          amountINR,
          classification
        ]
      );
    } catch (d1Err: any) {
      console.error(`[RazorpayAdapter] FAIL-CLOSED: Failed to write revenue_records to D1 for payment ${paymentId}: ${d1Err.message}. Transitioning status to RECONCILIATION_REQUIRED.`);
      
      // Release in-flight idempotency key so retry can succeed
      if (eventId) {
        try {
          if (isProduction() && !process.env.VITEST) {
            await this.d1Repo.executeWrite('processed_webhook_events', `DELETE FROM processed_webhook_events WHERE event_id = ?`, [eventId]).catch(() => {});
          } else {
            try {
              getDb().prepare(`DELETE FROM processed_webhook_events WHERE event_id = ?`).run(eventId);
            } catch {}
          }
        } catch {}
      }

      if (orderId) {
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite(
            'payment_orders',
            `UPDATE payment_orders SET status = 'RECONCILIATION_REQUIRED', payment_id = ?, updated_at = datetime('now') WHERE order_id = ?`,
            [paymentId, orderId]
          ).catch(e => console.error(`[RazorpayAdapter] Failed to mark payment_order RECONCILIATION_REQUIRED: ${e.message}`));
        } else {
          try {
            getDb().prepare(`
              UPDATE payment_orders 
              SET status = 'RECONCILIATION_REQUIRED', payment_id = ?, updated_at = datetime('now')
              WHERE order_id = ?
            `).run(paymentId, orderId);
          } catch {}
        }
      }
      if (matchedLinkId) {
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite(
            'payment_provider_links',
            `UPDATE payment_provider_links SET status = 'RECONCILIATION_REQUIRED', payment_id = ? WHERE provider_link_id = ?`,
            [paymentId, matchedLinkId]
          ).catch(e => console.error(`[RazorpayAdapter] Failed to mark payment_provider_links RECONCILIATION_REQUIRED: ${e.message}`));

          await this.d1Repo.executeWrite(
            'payment_requests',
            `UPDATE payment_requests SET status = 'RECONCILIATION_REQUIRED', payment_id = ?, updated_at = datetime('now') WHERE provider_link_id = ?`,
            [paymentId, matchedLinkId]
          ).catch(e => console.error(`[RazorpayAdapter] Failed to mark payment_requests RECONCILIATION_REQUIRED: ${e.message}`));
        } else {
          try {
            getDb().prepare(`
              UPDATE payment_provider_links
              SET status = 'RECONCILIATION_REQUIRED', payment_id = ?
              WHERE provider_link_id = ?
            `).run(paymentId, matchedLinkId);

            getDb().prepare(`
              UPDATE payment_requests
              SET status = 'RECONCILIATION_REQUIRED', payment_id = ?, updated_at = datetime('now')
              WHERE provider_link_id = ?
            `).run(paymentId, matchedLinkId);
          } catch {}
        }
      }

      throw new Error(`REVENUE_PERSISTENCE_FAILED: D1 write failed for revenue_records: ${d1Err.message}`);
    }

    // --- ONLY REACHED IF D1 WRITE SUCCEEDED ---

    // Single-use idempotent state transition: update payment_orders to PAID
    if (orderId) {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'payment_orders',
          `UPDATE payment_orders SET status = 'PAID', payment_id = ?, updated_at = datetime('now') WHERE order_id = ? AND status IN ('CREATED', 'PENDING', 'ATTEMPTED')`,
          [paymentId, orderId]
        );
      } else {
        try {
          getDb().prepare(
            `UPDATE payment_orders 
             SET status = 'PAID', payment_id = ?, updated_at = datetime('now')
             WHERE order_id = ? AND status IN ('CREATED', 'PENDING', 'ATTEMPTED')`
          ).run(paymentId, orderId);
        } catch {}
      }
    }

    // Single-use idempotent state transition: update payment_provider_links and payment_requests to PAID
    if (matchedLinkId) {
      if (isProduction() && !process.env.VITEST) {
        await this.d1Repo.executeWrite(
          'payment_provider_links',
          `UPDATE payment_provider_links SET status = 'PAID', paid_at = datetime('now'), payment_id = ? WHERE provider_link_id = ? AND status != 'PAID'`,
          [paymentId, matchedLinkId]
        );
        await this.d1Repo.executeWrite(
          'payment_requests',
          `UPDATE payment_requests SET status = 'PAID', payment_id = ?, payment_verified_at = datetime('now'),
              verified_at = datetime('now'), verification_method = 'RAZORPAY_WEBHOOK',
              updated_at = datetime('now') WHERE provider_link_id = ? AND status != 'PAID'`,
          [paymentId, matchedLinkId]
        );
      } else {
        try {
          getDb().prepare(`
            UPDATE payment_provider_links
            SET status = 'PAID', paid_at = datetime('now'), payment_id = ?
            WHERE provider_link_id = ? AND status != 'PAID'
          `).run(paymentId, matchedLinkId);

          getDb().prepare(`
            UPDATE payment_requests
            SET status = 'PAID', payment_id = ?, payment_verified_at = datetime('now'),
                verified_at = datetime('now'), verification_method = 'RAZORPAY_WEBHOOK',
                updated_at = datetime('now')
            WHERE provider_link_id = ? AND status != 'PAID'
          `).run(paymentId, matchedLinkId);
        } catch {}
      }
    }

    // Record Transaction with verified classification
    const tx = await this.revenueEngine.recordTransactionAsync({
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

    // Mark idempotent action as EXECUTED in local dev/test if table exists
    if (eventId && (!isProduction() || process.env.VITEST)) {
      try {
        getDb().prepare(`
          UPDATE idempotent_actions SET status = 'EXECUTED', result_json = ? WHERE idempotency_key = ?
        `).run(JSON.stringify({ transactionId: tx.id, amountINR, journeyId }), eventId);
      } catch {}
    }

    // If platform customer paid, initialize 5-Day Delivery Blueprint fulfillment (Spec § 38 & § 39)
    if (isPlatformRevenue) {
      try {
        const payerEmail = payment?.email || paymentLink?.customer?.email;
        const payerPhone = payment?.contact || paymentLink?.customer?.contact;
        let candidateCustId = storedPayReq?.prospect_id || storedLink?.prospect_id;
        
        if (!candidateCustId && journeyId) {
          if (isProduction() && !process.env.VITEST) {
            const jRow = await this.d1Repo.queryOne('customer_journeys', 'SELECT prospect_id, id FROM customer_journeys WHERE id = ?', [journeyId]);
            candidateCustId = jRow?.prospect_id || journeyId;
          } else {
            try {
              const jRow = getDb().prepare('SELECT prospect_id, id FROM customer_journeys WHERE id = ?').get(journeyId) as any;
              candidateCustId = jRow?.prospect_id || journeyId;
            } catch {}
          }
        }

        if (!candidateCustId && (payerEmail || payerPhone)) {
          if (isProduction() && !process.env.VITEST) {
            const prospect = await this.d1Repo.queryOne('platform_prospects', `
              SELECT id FROM platform_prospects
              WHERE (prospect_email = ? AND ? != '') OR (prospect_phone = ? AND ? != '')
              LIMIT 1
            `, [payerEmail || '', payerEmail || '', payerPhone || '', payerPhone || '']);
            candidateCustId = prospect?.id;
          } else {
            try {
              const prospect = getDb().prepare(`
                SELECT id FROM platform_prospects
                WHERE (prospect_email = ? AND ? != '') OR (prospect_phone = ? AND ? != '')
                LIMIT 1
              `).get(payerEmail || '', payerEmail || '', payerPhone || '', payerPhone || '') as any;
              candidateCustId = prospect?.id;
            } catch {}
          }
        }

        if (!candidateCustId && (payerEmail || payerPhone)) {
          if (isProduction() && !process.env.VITEST) {
            const journey = await this.d1Repo.queryOne('customer_journeys', `
              SELECT id FROM customer_journeys
              WHERE (customer_email = ? AND ? != '') OR (customer_phone = ? AND ? != '')
              LIMIT 1
            `, [payerEmail || '', payerEmail || '', payerPhone || '', payerPhone || '']);
            candidateCustId = journey?.id;
          } else {
            try {
              const journey = getDb().prepare(`
                SELECT id FROM customer_journeys
                WHERE (customer_email = ? AND ? != '') OR (customer_phone = ? AND ? != '')
                LIMIT 1
              `).get(payerEmail || '', payerEmail || '', payerPhone || '', payerPhone || '') as any;
              candidateCustId = journey?.id;
            } catch {}
          }
        }

        if (!candidateCustId) {
          throw new Error(`EXACT_LINEAGE_VIOLATION: Cannot trace customer ID to a real opportunity, lead, or customer journey for link ${matchedLinkId}. Fabricated customer IDs are strictly prohibited.`);
        }
        const custId = candidateCustId;
        if (isProduction() && !process.env.VITEST) {
          await this.d1Repo.executeWrite(
            'platform_customer_deliveries',
            `INSERT OR IGNORE INTO platform_customer_deliveries (
              id, customer_id, organization_id, business_id, offer_id, payment_id,
              stage, contract_terms, deliverables_json, success_metrics_json, renewal_date, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'ONBOARDING', 'Standard Service Agreement: 5-Day Delivery & SLA', '["WhatsApp Integration", "Google Business Profile Lead Capture", "Automated Triage", "24/7 Booking Bot"]', '["Response time < 2 mins", "30% show rate"]', datetime('now', '+30 days'), datetime('now'), datetime('now'))`,
            [
              `deliv_${Date.now()}`,
              custId,
              organizationId,
              businessId,
              storedPayReq?.offer_id || 'PLATFORM_SETUP',
              paymentId
            ]
          );
        } else {
          try {
            getDb().prepare(`
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
          } catch {}
        }
      } catch (e: any) {
        console.warn(`[RazorpayAdapter] Failed to initialize customer delivery: ${e.message}`);
      }
    }

    // Advance customer journey if present
    // Stage I.2 (P3): Verified Razorpay CAPTURED payment triggers DeliveryEngine fulfillment provisioning
    try {
      const { DeliveryEngine } = await import('../revenue/delivery-engine.js');
      await DeliveryEngine.getInstance().provisionVerifiedOrderFulfillment({
        organizationId,
        businessId,
        customerJourneyId: journeyId,
        orderId: orderId || storedPayReq?.id || undefined,
        paymentId,
        sku: storedPayReq?.offer_id || notes?.sku || 'SITEFIX_CORE_499',
        serviceType: serviceRendered,
        amountINR: Number(amountINR || 0),
        verificationSource: 'RAZORPAY_CAPTURED',
        isDiagnostic: classification !== 'REAL'
      });
    } catch (fulfillErr: any) {
      console.warn(`[RazorpayAdapter] Verified fulfillment bridge notice: ${fulfillErr?.message}`);
    }

    if (journeyId) {
      try {
        let jRow: any = null;
        if (isProduction() && !process.env.VITEST) {
          jRow = await this.d1Repo.queryOne('customer_journeys', 'SELECT * FROM customer_journeys WHERE id = ?', [journeyId]);
        } else {
          jRow = getDb().prepare('SELECT * FROM customer_journeys WHERE id = ?').get(journeyId) as any;
        }
        if (jRow && jRow.stage !== 'CUSTOMER') {
          this.journeyTracker.advanceStage({
            businessId,
            visitorId: jRow.visitor_id,
            targetStage: 'CUSTOMER'
          });
        }
      } catch (err: any) {
        console.warn(`[RazorpayAdapter] Journey stage advancement notice: ${err.message}`);
      }
    }

    return {
      processed: true,
      handled: true,
      duplicate: false,
      status: 'success',
      transactionId: tx.id,
      amountINR,
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
      if (!isProduction() || process.env.VITEST) {
        const linkRow = getDb().prepare(`
          SELECT created_at, paid_at FROM payment_provider_links ORDER BY created_at DESC LIMIT 1
        `).get() as any;
        if (linkRow) {
          lastPaymentEvent = linkRow.paid_at || linkRow.created_at || null;
        }

        const revRow = getDb().prepare(`
          SELECT timestamp FROM revenue_records WHERE source = 'RAZORPAY' AND verified = 1 ORDER BY timestamp DESC LIMIT 1
        `).get() as any;
        if (revRow) {
          lastVerifiedPayment = revRow.timestamp || null;
        }
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
