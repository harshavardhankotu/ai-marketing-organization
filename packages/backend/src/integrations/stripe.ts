import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  PaymentProvider,
  PaymentIntentOptions,
  PaymentIntentResult,
  RefundOptions,
  RefundResult
} from './payment-provider.js';

export interface StripePaymentIntentParams {
  businessId: string;
  amountMinor: number;
  currency: string;
  customerEmail?: string;
  customerName?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface StripePaymentIntentResult {
  clientSecret: string;
  paymentIntentId: string;
  status: 'requires_payment_method' | 'succeeded' | 'requires_action';
  amountMinor: number;
  currency: string;
}

export class StripeAdapter implements PaymentProvider {
  private static instance: StripeAdapter;
  public readonly providerName = 'STRIPE' as const;

  public static getInstance(): StripeAdapter {
    if (!StripeAdapter.instance) {
      StripeAdapter.instance = new StripeAdapter();
    }
    return StripeAdapter.instance;
  }

  public isConfigured(): boolean {
    const key = process.env.STRIPE_SECRET_KEY;
    return Boolean(key && !isPlaceholderCredential(key));
  }

  public getPublishableKey(): string {
    return process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder';
  }

  /**
   * Universal Payment Provider interface implementation
   */
  public async createPayment(options: PaymentIntentOptions): Promise<PaymentIntentResult> {
    const res = await this.createPaymentIntent({
      businessId: options.businessId,
      amountMinor: options.amountMinor,
      currency: options.currency,
      customerEmail: options.customerEmail,
      customerName: options.customerName,
      description: options.description || `Order ${options.orderId}`,
      metadata: { orderId: options.orderId, ...(options.metadata || {}) }
    });

    return {
      provider: 'STRIPE',
      providerOrderId: res.paymentIntentId,
      clientSecret: res.clientSecret,
      status: res.status === 'succeeded' ? 'PAID' : 'PAYMENT_PENDING',
      amountMinor: res.amountMinor,
      currency: res.currency
    };
  }

  /**
   * Creates a payment intent for server-authoritative checkout.
   * If real Stripe API key is configured, invokes the Stripe REST API.
   * In non-production test mode without key, generates a mock intent for integration testing.
   */
  public async createPaymentIntent(params: StripePaymentIntentParams): Promise<StripePaymentIntentResult> {
    const { businessId, amountMinor, currency, customerEmail, customerName, description, metadata = {} } = params;

    if (amountMinor <= 0) {
      throw new Error('STRIPE_INVALID_AMOUNT: Amount must be greater than zero minor units.');
    }

    const cur = (currency || 'USD').toLowerCase();

    if (this.isConfigured()) {
      const apiKey = process.env.STRIPE_SECRET_KEY!;
      const postData = new URLSearchParams({
        amount: String(Math.round(amountMinor)),
        currency: cur,
        ...(description ? { description } : {}),
        ...(customerEmail ? { receipt_email: customerEmail } : {}),
        'metadata[businessId]': businessId,
        ...(customerName ? { 'metadata[customerName]': customerName } : {})
      });

      for (const [k, v] of Object.entries(metadata)) {
        postData.append(`metadata[${k}]`, String(v));
      }

      const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: postData.toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`STRIPE_API_ERROR: Stripe returned status ${response.status}: ${errText.substring(0, 200)}`);
      }

      const json = await response.json() as any;
      return {
        clientSecret: json.client_secret,
        paymentIntentId: json.id,
        status: json.status,
        amountMinor: Number(json.amount),
        currency: json.currency.toUpperCase()
      };
    }

    if (isProduction() && !process.env.VITEST) {
      throw new Error('STRIPE_NOT_CONFIGURED: STRIPE_SECRET_KEY is required in production.');
    }

    // Mock response for dev / testing environments
    const mockIntentId = `pi_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      clientSecret: `${mockIntentId}_secret_${Math.random().toString(36).substring(2, 9)}`,
      paymentIntentId: mockIntentId,
      status: 'requires_payment_method',
      amountMinor: Math.round(amountMinor),
      currency: cur.toUpperCase()
    };
  }

  /**
   * Retrieves a payment intent from Stripe.
   */
  public async getPayment(paymentId: string): Promise<any> {
    if (this.isConfigured()) {
      const apiKey = process.env.STRIPE_SECRET_KEY!;
      const response = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentId)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });
      if (!response.ok) {
        throw new Error(`STRIPE_API_ERROR: Failed to retrieve payment intent ${paymentId}: ${response.status}`);
      }
      return await response.json();
    }

    if (isProduction() && !process.env.VITEST) {
      throw new Error('STRIPE_NOT_CONFIGURED: STRIPE_SECRET_KEY is required in production.');
    }

    return {
      id: paymentId,
      status: 'succeeded',
      amount: 1000,
      currency: 'usd'
    };
  }

  /**
   * Issues a refund against a Stripe charge / payment intent.
   */
  public async refundPayment(options: RefundOptions): Promise<RefundResult> {
    const { paymentId, amountMinor, currency = 'USD', reason } = options;

    if (this.isConfigured()) {
      const apiKey = process.env.STRIPE_SECRET_KEY!;
      const bodyParams = new URLSearchParams({
        payment_intent: paymentId,
        ...(amountMinor !== undefined ? { amount: String(Math.round(amountMinor)) } : {}),
        ...(reason ? { reason: 'requested_by_customer' } : {})
      });

      const response = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyParams.toString()
      });

      if (!response.ok) {
        const errText = await response.text();
        return {
          success: false,
          refundId: '',
          status: 'FAILED',
          amountMinor: amountMinor || 0,
          currency,
          error: `STRIPE_REFUND_ERROR: ${errText.substring(0, 200)}`
        };
      }

      const json = await response.json() as any;
      return {
        success: true,
        refundId: json.id,
        status: json.status === 'succeeded' ? 'REFUNDED' : 'REFUND_PENDING',
        amountMinor: Number(json.amount),
        currency: (json.currency || currency).toUpperCase()
      };
    }

    if (isProduction() && !process.env.VITEST) {
      throw new Error('STRIPE_NOT_CONFIGURED: STRIPE_SECRET_KEY is required in production.');
    }

    // Mock refund for dev / testing environments
    const mockRefundId = `re_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      success: true,
      refundId: mockRefundId,
      status: 'REFUNDED',
      amountMinor: amountMinor || 1000,
      currency: currency.toUpperCase()
    };
  }

  /**
   * Verifies and processes a Stripe webhook payload.
   */
  public verifyWebhook(rawBody: string, signature: string): boolean {
    return this.verifyWebhookSignature(rawBody, signature);
  }

  public verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret || isPlaceholderCredential(webhookSecret)) {
      if (!isProduction() || process.env.VITEST) return true;
      return false;
    }

    // Stripe signature header format: t=timestamp,v1=signature
    const parts = signatureHeader.split(',');
    let timestamp = '';
    let v1 = '';
    for (const part of parts) {
      const [k, v] = part.split('=');
      if (k === 't') timestamp = v;
      if (k === 'v1') v1 = v;
    }

    if (!timestamp || !v1) return false;

    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSig = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

    try {
      return timingSafeEqual(Buffer.from(v1), Buffer.from(expectedSig));
    } catch {
      return false;
    }
  }
}
