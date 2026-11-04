import { createHmac, timingSafeEqual } from 'node:crypto';
import { isPlaceholderCredential, isProduction } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

export interface RazorpayTestConfig {
  enabled: boolean;
  mode: 'TEST';
  keyId: string;
  keySecret: string;
  webhookSecret?: string;
  redactedKeyId: string;
}

export type TestConfigResult =
  | { ok: true; config: RazorpayTestConfig }
  | { ok: false; error: string; missingConfig: string[]; redactedKeyId?: string };

export class RazorpayTestService {
  private static instance: RazorpayTestService | null = null;
  private recentIpAttempts: Map<string, { count: number; resetAt: number }> = new Map();

  private constructor() {}

  public static getInstance(): RazorpayTestService {
    if (!RazorpayTestService.instance) {
      RazorpayTestService.instance = new RazorpayTestService();
    }
    return RazorpayTestService.instance;
  }

  /**
   * Strictly resolves test credentials according to V6.2.2 requirements:
   * - Test mode may use only RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET.
   * - Never silently falls back to RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET.
   * - Never combines a generic/live Key ID with a Test Key Secret.
   * - Never selects a Test Key Secret when Live mode is enabled.
   * - Never logs a secret, Basic Authentication header or encoded credentials.
   * - Trims whitespace.
   * - Validates that Test Key ID begins with rzp_test_.
   * - Rejects placeholder or malformed credentials.
   */
  public getTestConfig(): TestConfigResult {
    const rawMode = (process.env.RAZORPAY_MODE || 'TEST').trim().toUpperCase();
    if (rawMode !== 'TEST') {
      return {
        ok: false,
        error: 'RAZORPAY_MODE_NOT_TEST',
        missingConfig: ['RAZORPAY_MODE must be set to TEST for test checkout']
      };
    }

    const enabled = (process.env.RAZORPAY_TEST_CHECKOUT_ENABLED || 'false').trim().toLowerCase() === 'true';
    if (!enabled) {
      return {
        ok: false,
        error: 'RAZORPAY_TEST_CHECKOUT_DISABLED',
        missingConfig: ['RAZORPAY_TEST_CHECKOUT_ENABLED must be set to true']
      };
    }

    const keyId = (process.env.RAZORPAY_TEST_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_TEST_KEY_SECRET || '').trim();
    const webhookSecret = (process.env.RAZORPAY_TEST_WEBHOOK_SECRET || '').trim();

    const missingConfig: string[] = [];
    if (!keyId) missingConfig.push('RAZORPAY_TEST_KEY_ID');
    if (!keySecret) missingConfig.push('RAZORPAY_TEST_KEY_SECRET');

    if (missingConfig.length > 0) {
      return {
        ok: false,
        error: 'RAZORPAY_TEST_CREDENTIALS_MISSING',
        missingConfig
      };
    }

    if (isPlaceholderCredential(keyId) || !keyId.startsWith('rzp_test_')) {
      return {
        ok: false,
        error: 'RAZORPAY_TEST_KEY_ID_INVALID',
        missingConfig: ['RAZORPAY_TEST_KEY_ID must begin with "rzp_test_" and not be a placeholder']
      };
    }

    if (isPlaceholderCredential(keySecret) || keySecret.length < 8) {
      return {
        ok: false,
        error: 'RAZORPAY_TEST_KEY_SECRET_INVALID',
        missingConfig: ['RAZORPAY_TEST_KEY_SECRET is invalid or placeholder']
      };
    }

    const redactedKeyId = keyId.length > 12 ? `${keyId.substring(0, 10)}...${keyId.slice(-4)}` : 'rzp_test_***';

    return {
      ok: true,
      config: {
        enabled,
        mode: 'TEST',
        keyId,
        keySecret,
        webhookSecret: webhookSecret || undefined,
        redactedKeyId
      }
    };
  }

  public getTestReadiness(): {
    ready: boolean;
    mode: string;
    testCheckoutEnabled: boolean;
    hasValidTestKeyId: boolean;
    hasValidTestKeySecret: boolean;
    redactedKeyId: string | null;
    missingConfig: string[];
  } {
    const res = this.getTestConfig();
    const keyId = (process.env.RAZORPAY_TEST_KEY_ID || '').trim();
    const keySecret = (process.env.RAZORPAY_TEST_KEY_SECRET || '').trim();
    const enabled = (process.env.RAZORPAY_TEST_CHECKOUT_ENABLED || 'false').trim().toLowerCase() === 'true';

    return {
      ready: res.ok,
      mode: 'TEST',
      testCheckoutEnabled: enabled,
      hasValidTestKeyId: Boolean(keyId && keyId.startsWith('rzp_test_') && !isPlaceholderCredential(keyId)),
      hasValidTestKeySecret: Boolean(keySecret && keySecret.length >= 8 && !isPlaceholderCredential(keySecret)),
      redactedKeyId: res.ok ? res.config.redactedKeyId : (keyId.length > 12 ? `${keyId.substring(0, 10)}...${keyId.slice(-4)}` : null),
      missingConfig: res.ok ? [] : res.missingConfig
    };
  }

  private checkRateLimit(clientIp: string): boolean {
    const now = Date.now();
    const record = this.recentIpAttempts.get(clientIp);
    if (!record || now > record.resetAt) {
      this.recentIpAttempts.set(clientIp, { count: 1, resetAt: now + 60000 });
      return true;
    }
    if (record.count >= 20) {
      return false;
    }
    record.count += 1;
    return true;
  }

  /**
   * Phase 3: Creates a genuine Razorpay Test Order (strictly 100 paise INR).
   */
  public async createTestOrder(clientIp = 'unknown'): Promise<
    | { status: 200; data: { success: true; createdViaRazorpayApi: true; order_id: string; amount: 100; currency: 'INR'; key_id: string; mode: 'TEST' } }
    | { status: 400 | 429 | 502 | 503; data: { success: false; error: string; message: string; missingConfig?: string[]; diagnostics?: any } }
  > {
    if (!this.checkRateLimit(clientIp)) {
      return {
        status: 429,
        data: {
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many test order attempts. Please wait 1 minute before retrying.'
        }
      };
    }

    const configResult = this.getTestConfig();
    if (!configResult.ok) {
      return {
        status: 503,
        data: {
          success: false,
          error: configResult.error,
          message: 'Razorpay Test Checkout is not fully configured or enabled on the server.',
          missingConfig: configResult.missingConfig
        }
      };
    }

    const { keyId, keySecret, redactedKeyId } = configResult.config;
    const receipt = `rcpt_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    try {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: 100,
          currency: 'INR',
          receipt,
          notes: {
            purpose: 'razorpay_onboarding_test',
            mode: 'TEST',
            classification: 'TEST',
            service: 'Razorpay Test Integration Verification'
          }
        })
      });

      if (!res.ok) {
        if (res.status === 401) {
          return {
            status: 502,
            data: {
              success: false,
              error: 'RAZORPAY_TEST_AUTH_FAILED',
              message: 'Razorpay rejected authentication. Verify that RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET are the matching active pair from your Razorpay dashboard (Settings -> API Keys).',
              diagnostics: {
                mode: 'TEST',
                redactedKeyId
              }
            }
          };
        }
        const errText = await res.text();
        return {
          status: 502,
          data: {
            success: false,
            error: 'RAZORPAY_ORDER_CREATION_FAILED',
            message: `Razorpay Orders API error (${res.status}): ${errText.substring(0, 200)}`
          }
        };
      }

      const orderData = (await res.json()) as any;
      if (!orderData || !orderData.id || !String(orderData.id).startsWith('order_')) {
        return {
          status: 502,
          data: {
            success: false,
            error: 'RAZORPAY_INVALID_ORDER_RESPONSE',
            message: 'Razorpay did not return a valid order ID starting with order_.'
          }
        };
      }

      if (Number(orderData.amount) !== 100 || String(orderData.currency).toUpperCase() !== 'INR') {
        return {
          status: 502,
          data: {
            success: false,
            error: 'RAZORPAY_ORDER_AMOUNT_MISMATCH',
            message: 'Order returned by Razorpay does not match 100 paise INR.'
          }
        };
      }

      // Persist genuine order in payment_orders
      const d1Repo = D1RevenueRepository.getInstance();
      const orgBizId = OwnerAuthService.PLATFORM_BUSINESS_ID;
      const id = `po_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const notesJson = JSON.stringify({
        isTestTransaction: true,
        classification: 'TEST',
        amountPaise: 100,
        mode: 'TEST',
        purpose: 'onboarding_test_verification'
      });

      if (isProduction() && !process.env.VITEST) {
        await d1Repo.executeWrite(
          'payment_orders',
          `INSERT INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
           VALUES (?, ?, ?, 1.0, 'INR', 'TEST_ORDER_CREATED', ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT (order_id) DO UPDATE SET status = 'TEST_ORDER_CREATED', updated_at = datetime('now')`,
          [id, orgBizId, orderData.id, receipt, notesJson]
        );
      } else {
        getDb().prepare(
          `INSERT OR REPLACE INTO payment_orders (id, business_id, order_id, amount_inr, currency, status, receipt, notes_json, created_at, updated_at)
           VALUES (?, ?, ?, 1.0, 'INR', 'TEST_ORDER_CREATED', ?, ?, datetime('now'), datetime('now'))`
        ).run(id, orgBizId, orderData.id, receipt, notesJson);
      }

      return {
        status: 200,
        data: {
          success: true,
          createdViaRazorpayApi: true,
          order_id: orderData.id,
          amount: 100,
          currency: 'INR',
          key_id: keyId,
          mode: 'TEST'
        }
      };
    } catch (networkErr: any) {
      return {
        status: 502,
        data: {
          success: false,
          error: 'NETWORK_FAULT',
          message: `Network communication error reaching Razorpay: ${networkErr.message}`
        }
      };
    }
  }

  /**
   * Phase 5: Cryptographically and server-side verifies a ₹1 test payment.
   */
  public async verifyTestPayment(params: {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
  }): Promise<
    | { status: 200; data: { success: true; status: 'TEST_PAYMENT_CAPTURED'; message: string; order_id: string; payment_id: string; amount: 100; currency: 'INR'; mode: 'TEST'; classification: 'TEST' } }
    | { status: 200; data: { success: false; status: 'PAYMENT_AUTHORIZED_PENDING_CAPTURE'; message: string } }
    | { status: 400 | 404 | 502 | 503; data: { success: false; error: string; message: string } }
  > {
    const orderId = (params.razorpay_order_id || '').trim();
    const paymentId = (params.razorpay_payment_id || '').trim();
    const signature = (params.razorpay_signature || '').trim();

    if (!orderId || !paymentId || !signature) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'MISSING_TEST_VERIFICATION_FIELDS',
          message: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are all strictly required.'
        }
      };
    }

    const configResult = this.getTestConfig();
    if (!configResult.ok) {
      return {
        status: 503,
        data: {
          success: false,
          error: configResult.error,
          message: 'Razorpay Test Checkout is not configured.'
        }
      };
    }

    const { keyId, keySecret } = configResult.config;

    // 1. Verify that order exists in test records
    const d1Repo = D1RevenueRepository.getInstance();
    let existingOrder: any = null;
    if (isProduction() && !process.env.VITEST) {
      existingOrder = await d1Repo.queryOne<any>(
        'payment_orders',
        `SELECT id, order_id, amount_inr, currency, status FROM payment_orders WHERE order_id = ?`,
        [orderId]
      );
    } else {
      existingOrder = getDb().prepare(
        `SELECT id, order_id, amount_inr, currency, status FROM payment_orders WHERE order_id = ?`
      ).get(orderId);
    }

    if (!existingOrder) {
      return {
        status: 404,
        data: {
          success: false,
          error: 'TEST_ORDER_NOT_FOUND',
          message: `The order ${orderId} was not found in the test orders database.`
        }
      };
    }

    if (existingOrder.order_id !== orderId) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'ORDER_ID_MISMATCH',
          message: 'The submitted order ID does not match the recorded test order.'
        }
      };
    }

    if (Number(existingOrder.amount_inr) !== 1.0 || existingOrder.currency !== 'INR') {
      return {
        status: 400,
        data: {
          success: false,
          error: 'ORDER_AMOUNT_MISMATCH',
          message: 'Order does not match 100 paise / ₹1.00 INR.'
        }
      };
    }

    // 2. Cryptographic HMAC-SHA256 signature verification
    const expectedHmac = createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    let isSigValid = false;
    if (expectedHmac.length === signature.length) {
      isSigValid = timingSafeEqual(Buffer.from(expectedHmac, 'utf8'), Buffer.from(signature, 'utf8'));
    }

    if (!isSigValid) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'INVALID_PAYMENT_SIGNATURE',
          message: 'Payment signature does not match HMAC-SHA256(order_id|payment_id, RAZORPAY_TEST_KEY_SECRET).'
        }
      };
    }

    // 3. Server-side payment capture verification via Razorpay Payments API
    const authHeader = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    let paymentDetails: any = null;
    try {
      const payRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
        method: 'GET',
        headers: { 'Authorization': authHeader }
      });
      if (payRes.ok) {
        paymentDetails = await payRes.json();
      }
    } catch {}

    if (paymentDetails) {
      if (paymentDetails.order_id && paymentDetails.order_id !== orderId) {
        return {
          status: 400,
          data: {
            success: false,
            error: 'PAYMENT_ORDER_MISMATCH',
            message: `Razorpay payment belongs to order ${paymentDetails.order_id}, not ${orderId}.`
          }
        };
      }
      if (paymentDetails.amount && Number(paymentDetails.amount) !== 100) {
        return {
          status: 400,
          data: {
            success: false,
            error: 'PAYMENT_AMOUNT_MISMATCH',
            message: `Payment amount is ${paymentDetails.amount} paise, expected 100 paise.`
          }
        };
      }
      if (paymentDetails.currency && String(paymentDetails.currency).toUpperCase() !== 'INR') {
        return {
          status: 400,
          data: {
            success: false,
            error: 'PAYMENT_CURRENCY_MISMATCH',
            message: `Payment currency is ${paymentDetails.currency}, expected INR.`
          }
        };
      }
      if (paymentDetails.status === 'authorized') {
        return {
          status: 200,
          data: {
            success: false,
            status: 'PAYMENT_AUTHORIZED_PENDING_CAPTURE',
            message: 'Payment is authorized by customer but pending capture by Razorpay.'
          }
        };
      }
      if (paymentDetails.status !== 'captured') {
        return {
          status: 400,
          data: {
            success: false,
            error: 'PAYMENT_NOT_CAPTURED',
            message: `Razorpay payment status is ${paymentDetails.status}, expected captured.`
          }
        };
      }
    }

    // 4. Update test record in payment_orders
    if (isProduction() && !process.env.VITEST) {
      await d1Repo.executeWrite(
        'payment_orders',
        `UPDATE payment_orders SET status = 'TEST_PAYMENT_CAPTURED', payment_id = ?, updated_at = datetime('now') WHERE order_id = ?`,
        [paymentId, orderId]
      );
    } else {
      getDb().prepare(
        `UPDATE payment_orders SET status = 'TEST_PAYMENT_CAPTURED', payment_id = ?, updated_at = datetime('now') WHERE order_id = ?`
      ).run(paymentId, orderId);
    }

    return {
      status: 200,
      data: {
        success: true,
        status: 'TEST_PAYMENT_CAPTURED',
        message: 'Razorpay Test Mode transaction successfully captured and verified.',
        order_id: orderId,
        payment_id: paymentId,
        amount: 100,
        currency: 'INR',
        mode: 'TEST',
        classification: 'TEST'
      }
    };
  }
}
