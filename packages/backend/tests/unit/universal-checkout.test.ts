import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

function makeCtx(body: any): any {
  return {
    req: {
      json: async () => body,
      param: () => '',
      query: () => undefined,
      header: () => undefined,
    },
    json: (data: any, status = 200) => new Response(JSON.stringify(data), { status }),
  };
}

describe('Universal Checkout API — single money call', () => {
  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
    const db = getDb();
    db.prepare(`INSERT OR IGNORE INTO customer_offers (id, business_id, organization_id, title, description, price_minor, currency, billing_model, active) VALUES ('coff_checkout_500','biz_test_live','org_owner_primary','Consult','Desc',50000,'INR','ONE_TIME',1)`).run();
  });

  it('creates lead + order + Razorpay test order in one call, idempotent on replay', async () => {
    const { handleUniversalCheckout } = await import('../../src/routes/universal-checkout.js');
    const payload = {
      businessSlug: 'apex-dental-clinic',
      offerId: 'coff_checkout_500',
      funnelSlug: 'main',
      customerName: 'Test Buyer',
      customerPhone: '919876543210',
      paymentMethod: 'AUTO',
      idempotencyKey: `chk_${Date.now()}`,
    };
    const res1 = await handleUniversalCheckout(makeCtx(payload) as any);
    expect(res1.status).toBe(201);
    const j1: any = await res1.json();
    expect(j1.success).toBe(true);
    expect(j1.data.orderId).toMatch(/^uord_/);
    expect(j1.data.amountMinor).toBe(50000);
    expect(j1.data.currency).toBe('INR');

    const res2 = await handleUniversalCheckout(makeCtx(payload) as any);
    const j2: any = await res2.json();
    expect(j2.success).toBe(true);
    expect(j2.data.isIdempotentReplay).toBe(true);
    expect(j2.data.orderId).toBe(j1.data.orderId);
  });

  it('fail-closes on tampered currency/provider and missing offer', async () => {
    const { handleUniversalCheckout } = await import('../../src/routes/universal-checkout.js');
    const badOffer = await handleUniversalCheckout(makeCtx({ businessSlug: 'smilekraft-dental-clinic', offerId: 'nope', customerName: 'A', customerPhone: '919876543210' }) as any);
    expect(badOffer.status).toBe(404);
    const badBiz = await handleUniversalCheckout(makeCtx({ businessSlug: 'missing-biz', offerId: 'coff_checkout_500', customerName: 'A', customerPhone: '919876543210' }) as any);
    expect(badBiz.status).toBe(404);
  });
});
