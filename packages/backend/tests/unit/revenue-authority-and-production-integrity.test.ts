import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createHmac } from 'crypto';
import { apiRouter } from '../../src/routes/api.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { RazorpayAdapter } from '../../src/integrations/razorpay.js';
import { OfferCatalogService } from '../../src/revenue/offer-catalog.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { D1Client } from '../../src/db/d1-client.js';

describe('Revenue Authority, Payment Link Integrity & Production Security Guarantees (Spec §§ 1–12)', () => {
  let app: Hono;
  let razorpay: RazorpayAdapter;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    OfferCatalogService.getInstance().ensurePlatformOffers();
    razorpay = new RazorpayAdapter();
    app = new Hono();
    app.route('/api/v1', apiRouter);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. PRICE AUTHORITY
  // ────────────────────────────────────────────────────────────────────────────
  it('1. Arbitrary amount vs authoritative offer price -> rejected', async () => {
    await expect(
      razorpay.createPaymentLink({
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
        offerId: 'PLATFORM_SETUP',
        amountINR: 999 // Authoritative price is ₹15,000
      })
    ).rejects.toThrow(/AMOUNT MISMATCH/i);
  });

  it('2. Wrong platform business for PLATFORM_SETUP -> rejected', async () => {
    await expect(
      razorpay.createPaymentLink({
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        businessId: 'biz_smilekraft_hyd', // Wrong business for platform offer
        offerId: 'PLATFORM_SETUP'
      })
    ).rejects.toThrow(/UNAUTHORIZED_OFFER/i);
  });

  it('3. Wrong platform organization for PLATFORM_SETUP -> rejected', async () => {
    await expect(
      razorpay.createPaymentLink({
        organizationId: 'org_impostor_99', // Wrong organization
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
        offerId: 'PLATFORM_SETUP'
      })
    ).rejects.toThrow(/UNAUTHORIZED_OFFER/i);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. PERSISTENCE INTEGRITY & RECONCILIATION
  // ────────────────────────────────────────────────────────────────────────────
  it('4. Payment persistence failure returns RECONCILIATION_REQUIRED, never silent success', async () => {
    // Break the table temporarily to simulate persistence failure
    const db = getDb();
    db.exec(`DROP TABLE IF EXISTS payment_provider_links`);

    const result = await razorpay.createPaymentLink({
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
      offerId: 'PLATFORM_SETUP'
    });

    expect(result.status).toBe('RECONCILIATION_REQUIRED');
    expect(result.reconciliationRequired).toBe(true);
    expect(result.providerLinkId).toBeDefined();
    expect(result.referenceId).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. CONFIRM PAYMENT PROVIDER VALIDATION
  // ────────────────────────────────────────────────────────────────────────────
  it('5. Invalid provider payment status -> rejected', async () => {
    const order = await razorpay.createPaymentOrder({
      businessId: 'biz_smilekraft_hyd',
      amountINR: 500
    });

    const secret = 'test_secret_123';
    const paymentId = 'pay_status_check_01';
    const sig = createHmac('sha256', secret).update(`${order.orderId}|${paymentId}`).digest('hex');

    await expect(
      razorpay.confirmClientPayment({
        orderId: order.orderId,
        paymentId,
        signature: sig,
        secret,
        providerPayment: {
          id: paymentId,
          status: 'failed', // Invalid status
          order_id: order.orderId,
          currency: 'INR',
          amount: 50000
        }
      })
    ).rejects.toThrow(/Invalid provider payment status/i);
  });

  it('6. Wrong provider amount -> rejected', async () => {
    const order = await razorpay.createPaymentOrder({
      businessId: 'biz_smilekraft_hyd',
      amountINR: 500
    });

    const secret = 'test_secret_123';
    const paymentId = 'pay_amount_check_01';
    const sig = createHmac('sha256', secret).update(`${order.orderId}|${paymentId}`).digest('hex');

    await expect(
      razorpay.confirmClientPayment({
        orderId: order.orderId,
        paymentId,
        signature: sig,
        secret,
        providerPayment: {
          id: paymentId,
          status: 'captured',
          order_id: order.orderId,
          currency: 'INR',
          amount: 10000 // 100 INR instead of 500 INR (50,000 paise)
        }
      })
    ).rejects.toThrow(/AMOUNT MISMATCH/i);
  });

  it('7. Wrong currency -> rejected', async () => {
    const order = await razorpay.createPaymentOrder({
      businessId: 'biz_smilekraft_hyd',
      amountINR: 500
    });

    const secret = 'test_secret_123';
    const paymentId = 'pay_curr_check_01';
    const sig = createHmac('sha256', secret).update(`${order.orderId}|${paymentId}`).digest('hex');

    await expect(
      razorpay.confirmClientPayment({
        orderId: order.orderId,
        paymentId,
        signature: sig,
        secret,
        providerPayment: {
          id: paymentId,
          status: 'captured',
          order_id: order.orderId,
          currency: 'USD', // Not INR
          amount: 50000
        }
      })
    ).rejects.toThrow(/CURRENCY MISMATCH/i);
  });

  it('8. Wrong order ID -> rejected', async () => {
    const order = await razorpay.createPaymentOrder({
      businessId: 'biz_smilekraft_hyd',
      amountINR: 500
    });

    const secret = 'test_secret_123';
    const paymentId = 'pay_order_check_01';
    const sig = createHmac('sha256', secret).update(`${order.orderId}|${paymentId}`).digest('hex');

    await expect(
      razorpay.confirmClientPayment({
        orderId: order.orderId,
        paymentId,
        signature: sig,
        secret,
        providerPayment: {
          id: paymentId,
          status: 'captured',
          order_id: 'order_completely_different_999',
          currency: 'INR',
          amount: 50000
        }
      })
    ).rejects.toThrow(/ORDER MISMATCH/i);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4 & 5. WEBHOOK IDENTITY & PAYMENT ID GUARDS
  // ────────────────────────────────────────────────────────────────────────────
  it('9. payment_link.paid without pay_ ID -> rejected', async () => {
    const webhookSecret = 'test_whsec_999';
    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_test_without_pay',
            amount: 1500000,
            status: 'paid'
          }
        },
        payment: {
          entity: {
            id: 'plink_forged_as_pay' // Not a pay_ identifier!
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = createHmac('sha256', webhookSecret).update(raw).digest('hex');

    await expect(
      razorpay.processWebhook({
        rawBody: raw,
        signature: sig,
        event: payload,
        overrideSecret: webhookSecret
      })
    ).rejects.toThrow(/requires an actual Razorpay payment entity with a 'pay_\.\.\.' identifier/i);
  });

  it('10. plink_ ID is never stored as payment ID or transaction reference', async () => {
    const linkResult = await razorpay.createPaymentLink({
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
      offerId: 'PLATFORM_SETUP'
    });

    const webhookSecret = 'test_whsec_valid';
    const payload = {
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: linkResult.providerLinkId,
            amount: 1500000,
            amount_paid: 1500000,
            currency: 'INR',
            status: 'paid'
          }
        },
        payment: {
          entity: {
            id: 'pay_valid_verified_unique_7788',
            amount: 1500000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };

    const raw = JSON.stringify(payload);
    const sig = createHmac('sha256', webhookSecret).update(raw).digest('hex');

    const result = await razorpay.processWebhook({
      rawBody: raw,
      signature: sig,
      event: payload,
      overrideSecret: webhookSecret
    });

    expect(result.processed).toBe(true);

    const db = getDb();
    const tx = db.prepare(`SELECT * FROM transactions WHERE transaction_ref LIKE 'plink_%'`).all();
    expect(tx).toHaveLength(0);

    const rev = db.prepare(`SELECT * FROM revenue_records WHERE transaction_id LIKE 'plink_%'`).all();
    expect(rev).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6 & 7. WHATSAPP WEBHOOK FAIL-CLOSED & TENANT AUTHORITY
  // ────────────────────────────────────────────────────────────────────────────
  it('11. Unsigned WhatsApp production payload -> rejected', async () => {
    process.env.NODE_ENV = 'production';
    process.env.META_APP_SECRET = 'meta_secret_production_xyz';

    const res = await app.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: []
      })
    });

    expect(res.status).toBe(401);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Missing Meta webhook signature/i);
  });

  it('12. Invalid Meta signature -> rejected', async () => {
    process.env.NODE_ENV = 'production';
    process.env.META_APP_SECRET = 'meta_secret_production_xyz';

    const res = await app.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid_forged_hash'
      },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: []
      })
    });

    expect(res.status).toBe(401);
    const json = await res.json() as any;
    expect(json.error).toMatch(/Invalid Meta webhook signature/i);
  });

  it('13. Unknown WhatsApp phone_number_id -> rejected without falling back to biz_platform_aro', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'unknown_phone_id_99999' },
                messages: [
                  {
                    from: '+919988776655',
                    id: 'wamid_unknown_01',
                    text: { body: 'Hello' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res = await app.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toMatch(/BLOCKED_UNMAPPED_PROVIDER/i);
  });

  it('14. Known mapped phone_number_id -> accepted', async () => {
    const db = getDb();
    const phoneId = 'phone_mapped_valid_123';
    db.prepare(`
      INSERT OR REPLACE INTO integration_phone_mappings (
        id, provider, external_phone_number_id, organization_id, business_id
      ) VALUES ('ipm_test_01', 'WHATSAPP', ?, 'org_owner_primary', 'biz_platform_aro')
    `).run(phoneId);

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: phoneId },
                messages: [
                  {
                    from: '+919988776655',
                    id: 'wamid_mapped_01',
                    text: { body: 'I want to book an appointment' }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const res = await app.request('/api/v1/webhooks/whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.processed).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 8. EMAIL TENANT AUTHORITY
  // ────────────────────────────────────────────────────────────────────────────
  it('15. Unknown email provider identity in production -> rejected', async () => {
    process.env.NODE_ENV = 'production';

    const res = await app.request('/api/v1/webhooks/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'prospect@gmail.com',
        to: 'unknown_unmapped_inbox@domain.com',
        text: 'Inquiry about service'
      })
    });

    expect(res.status).toBe(401);
    const json = await res.json() as any;
    expect(json.error).toMatch(/BLOCKED_UNMAPPED_PROVIDER/i);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 9. D1 PRODUCTION REVENUE STATE
  // ────────────────────────────────────────────────────────────────────────────
  it('16. D1 unavailable in production -> irreversible action blocked', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CLOUDFLARE_D1_DATABASE_ID;
    delete process.env.CLOUDFLARE_D1_API_TOKEN;

    const d1Repo = D1RevenueRepository.getInstance();

    expect(() => d1Repo.assertDurableStorage('revenue_records')).toThrow(/PERSISTENCE_FAULT/i);
    expect(() => d1Repo.assertDurableStorage('payment_requests')).toThrow(/PERSISTENCE_FAULT/i);
    expect(() => d1Repo.assertDurableStorage('transactions')).toThrow(/PERSISTENCE_FAULT/i);
  });
});
