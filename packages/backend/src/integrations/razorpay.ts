import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { RevenueReconciliationEngine } from '../revenue/revenue-reconciliation.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { PaymentMethod } from '@ai-marketing/shared';

export interface RazorpayOrderInput {
  businessId: string;
  journeyId?: string;
  amountINR: number;
  receipt: string;
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

export class RazorpayAdapter {
  private get db() {
    return getDb();
  }

  private revenueEngine = new RevenueReconciliationEngine();
  private journeyTracker = new CustomerJourneyTracker();

  private getKeyId(): string {
    return process.env.RAZORPAY_KEY_ID || 'rzp_live_smilekraft_banjara';
  }

  private getKeySecret(): string {
    return process.env.RAZORPAY_KEY_SECRET || 'smilekraft_live_secret_2026';
  }

  private getWebhookSecret(): string {
    return process.env.RAZORPAY_WEBHOOK_SECRET || 'smilekraft_webhook_hmac_secret_2026';
  }

  /**
   * Cryptographically verifies Razorpay webhook signature using HMAC-SHA256.
   * Uses constant-time buffer comparison to prevent timing side-channel attacks.
   */
  public verifyWebhookSignature(rawBody: string, signature: string, secret?: string): boolean {
    if (!rawBody || !signature) return false;
    const webhookSecret = secret || this.getWebhookSecret();
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Creates a payment order for patient treatments or initial deposits.
   */
  public async createPaymentOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResult> {
    if (input.amountINR <= 0) {
      throw new Error('Payment order amount must be greater than ₹0.');
    }

    const orderId = `order_${randomUUID().replace(/-/g, '').substring(0, 14)}`;
    const id = `po_${randomUUID().substring(0, 10)}`;

    this.db
      .prepare(
        `INSERT INTO payment_orders (
          id, business_id, journey_id, order_id, amount_inr, currency,
          status, receipt, notes_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'INR', 'CREATED', ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        id,
        input.businessId,
        input.journeyId || null,
        orderId,
        input.amountINR,
        input.receipt,
        input.notes ? JSON.stringify(input.notes) : null
      );

    return {
      orderId,
      amountINR: input.amountINR,
      currency: 'INR',
      receipt: input.receipt,
      status: 'created',
      keyId: this.getKeyId(),
    };
  }

  /**
   * Processes a verified webhook event from Razorpay (e.g. payment.captured, order.paid).
   * Automatically commits verified real revenue into the immutable ledger.
   */
  public async processWebhook(params: {
    rawBody: string;
    signature: string;
    event: any;
    overrideSecret?: string;
  }): Promise<{
    processed: boolean;
    reason?: string;
    transactionId?: string;
    amountINR?: number;
    journeyId?: string;
  }> {
    // 1. Verify Cryptographic Signature
    const isValid = this.verifyWebhookSignature(params.rawBody, params.signature, params.overrideSecret);
    if (!isValid) {
      throw new Error('SECURITY VIOLATION: Invalid Razorpay webhook signature. Request forged or secret mismatch.');
    }

    const event = params.event;
    const eventType = event.event;

    // We process captured payments and paid orders
    if (eventType !== 'payment.captured' && eventType !== 'order.paid') {
      return { processed: false, reason: `Ignored unmonitored event type: ${eventType}` };
    }

    const payment = event.payload?.payment?.entity;
    if (!payment) {
      return { processed: false, reason: 'Missing payment entity in webhook payload' };
    }

    const paymentId = payment.id;
    const amountINR = Math.round((payment.amount || 0) / 100); // Razorpay passes amounts in paise
    const orderId = payment.order_id;
    const notes = payment.notes || {};
    const businessId = notes.business_id || notes.businessId || 'biz_smilekraft_hyd';
    const journeyId = notes.journey_id || notes.journeyId || undefined;
    const invoiceNumber = notes.invoice_number || notes.invoiceNumber || `INV-RZP-${Date.now()}`;
    const serviceRendered = notes.service || payment.description || 'Dental Clinical Consultation & Treatment';

    // Map method
    let paymentMethod: PaymentMethod = 'UPI';
    if (payment.method === 'upi') paymentMethod = 'UPI';
    else if (payment.method === 'netbanking') paymentMethod = 'NETBANKING';
    else if (payment.method === 'card') paymentMethod = 'CREDIT_CARD';
    else if (payment.method === 'emi') paymentMethod = 'NO_COST_EMI';

    // 2. Idempotency Check: Don't process same payment twice
    const existingTx = this.db
      .prepare('SELECT id FROM transactions WHERE transaction_ref = ?')
      .get(paymentId) as any;

    if (existingTx) {
      return {
        processed: true,
        reason: `Payment ${paymentId} already processed (idempotency key matched).`,
        transactionId: existingTx.id,
        amountINR,
        journeyId,
      };
    }

    // 3. Update payment_orders record if present
    if (orderId) {
      this.db
        .prepare(
          `UPDATE payment_orders 
           SET status = 'PAID', payment_id = ?, updated_at = datetime('now')
           WHERE order_id = ?`
        )
        .run(paymentId, orderId);
    }

    // 4. Record Verified REAL Revenue Transaction
    const tx = this.revenueEngine.recordTransaction({
      businessId,
      journeyId,
      invoiceNumber,
      amountINR,
      paymentMethod,
      paymentGateway: 'RAZORPAY',
      transactionRef: paymentId,
      status: 'SUCCESS',
      classification: 'REAL',
      serviceRendered,
    });

    // 5. Elevate Customer Journey to CUSTOMER if journeyId is provided
    if (journeyId) {
      const jRow = this.db
        .prepare('SELECT * FROM customer_journeys WHERE id = ?')
        .get(journeyId) as any;

      if (jRow && jRow.stage !== 'CUSTOMER') {
        this.journeyTracker.advanceStage({
          businessId,
          visitorId: jRow.visitor_id,
          targetStage: 'CUSTOMER',
        });
      }
    }

    return {
      processed: true,
      transactionId: tx.id,
      amountINR: tx.amountINR,
      journeyId,
    };
  }
}
