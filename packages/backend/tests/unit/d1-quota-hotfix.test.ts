import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../../src/index.js';
import { D1Client } from '../../src/db/d1-client.js';
import { DurableRateLimiter } from '../../src/security/durable-rate-limiter.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';

describe('D1 quota circuit-breaker hotfix', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf_account_test';
    process.env.CLOUDFLARE_D1_DATABASE_ID = 'cf_database_test';
    process.env.CLOUDFLARE_D1_API_TOKEN = 'cf_token_test';
    process.env.RENDER = 'true';
    delete process.env.VITEST;
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    DurableRateLimiter.resetInstanceForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    DurableRateLimiter.resetInstanceForTesting();
    RazorpayStandardAdapter.resetInstance();
    vi.restoreAllMocks();
  });

  it('trips only the read breaker and still allows a remote financial INSERT', async () => {
    const client = D1Client.getInstance();
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        "Your account has exceeded D1's free tier daily row read limit (Error 7500)",
        { status: 400 }
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ result: [{ results: [], meta: { rows_read: 0, rows_written: 1 } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ));

    await client.executeQuery('SELECT 1 AS value', [], false, 'P0');
    expect(client.getRemoteQuotaCircuitState()).toMatchObject({
      readExhausted: true,
      writeExhausted: false
    });

    const result = await client.executeQuery(
      'INSERT INTO universal_orders (id) VALUES (?)',
      ['order_d1_read_quota_test'],
      true,
      'P0'
    );

    expect(result.source).toBe('CLOUDFLARE_D1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('trips the write breaker and blocks subsequent financial writes', async () => {
    const client = D1Client.getInstance();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      "Your account has exceeded D1's free tier daily row written limit (Error 7500)",
      { status: 400 }
    ));

    await expect(client.executeQuery(
      'INSERT INTO universal_orders (id) VALUES (?)',
      ['order_d1_write_quota_test'],
      true,
      'P0'
    )).rejects.toThrow('D1_DURABLE_WRITE_UNAVAILABLE');

    expect(client.getRemoteQuotaCircuitState()).toMatchObject({
      readExhausted: false,
      writeExhausted: true
    });
    await expect(client.executeQuery(
      'INSERT INTO universal_orders (id) VALUES (?)',
      ['order_d1_write_quota_test_2'],
      true,
      'P0'
    )).rejects.toThrow('D1_DURABLE_WRITE_UNAVAILABLE');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails public scans closed when either D1 quota circuit is open', async () => {
    process.env.ENFORCE_PUBLIC_SCAN_LIMITS_IN_TEST = 'true';
    const client = D1Client.getInstance();
    for (const quotaMessage of [
      "Your account has exceeded D1's free tier daily row read limit (Error 7500)",
      "Your account has exceeded D1's free tier daily row written limit (Error 7500)"
    ]) {
      client.resetQuotaCircuitBreakerForTesting();
      client.tripQuotaCircuitBreakerPublic(quotaMessage);
      const response = await app.request('/api/v1/public/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://example.com',
          confirmAuthorized: true,
          source: 'web_open_graph'
        })
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'RATE_LIMITER_UNAVAILABLE' });
    }
  });

  it('accepts order input aliases but retains the canonical ₹499 price lock', async () => {
    const adapter = RazorpayStandardAdapter.getInstance();
    const createOrder = vi.spyOn(adapter, 'createStandardOrder').mockResolvedValue({
      success: true,
      keyId: 'rzp_test_public_key',
      orderId: 'local_order_test',
      razorpayOrderId: 'order_test_d1_quota',
      amount: 49900,
      currency: 'INR',
      isTestMode: true
    });

    const primary = await app.request('/api/v1/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'SITEFIX_AI_PACK_V1',
        amountINR: 499,
        buyerEmail: 'buyer@example.com',
        domainOrUrl: 'https://buyer.example.com'
      })
    });
    expect(primary.status).toBe(200);

    const aliases = await app.request('/api/v1/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'SITEFIX_AI_PACK_V1',
        amountINR: 499,
        email: 'alias@example.com',
        domain: 'https://alias.example.com'
      })
    });
    expect(aliases.status).toBe(200);
    expect(createOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({
      buyerEmail: 'alias@example.com',
      domainOrUrl: 'https://alias.example.com'
    }));

    const tamperedPrice = await app.request('/api/v1/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: 'SITEFIX_AI_PACK_V1',
        amountINR: 1,
        email: 'alias@example.com',
        domain: 'https://alias.example.com'
      })
    });
    expect(tamperedPrice.status).toBe(400);
    expect(createOrder).toHaveBeenCalledTimes(2);
  });
});
