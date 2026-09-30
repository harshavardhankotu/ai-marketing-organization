/**
 * Universal Payment Provider Contract
 * Common abstraction for Razorpay, Stripe, and manual payment verification.
 */

export interface PaymentIntentOptions {
  businessId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  provider: 'STRIPE' | 'RAZORPAY' | 'MANUAL';
  providerOrderId: string;
  providerPaymentId?: string;
  clientSecret?: string;
  status: 'PAYMENT_PENDING' | 'PAID' | 'PAYMENT_FAILED';
  amountMinor: number;
  currency: string;
}

export interface RefundOptions {
  businessId: string;
  paymentId: string;
  amountMinor?: number;
  currency?: string;
  reason?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  status: 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'REFUND_PENDING' | 'FAILED';
  amountMinor: number;
  currency: string;
  error?: string;
}

export interface PaymentProvider {
  readonly providerName: 'STRIPE' | 'RAZORPAY' | 'MANUAL';
  isConfigured(): boolean;
  createPayment(options: PaymentIntentOptions): Promise<PaymentIntentResult>;
  getPayment(paymentId: string): Promise<any>;
  verifyWebhook(rawBody: string, signature: string): boolean;
  refundPayment(options: RefundOptions): Promise<RefundResult>;
}
