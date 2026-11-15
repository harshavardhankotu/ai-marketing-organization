import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { D1Client } from '../../src/db/d1-client.js';
import { InstagramBusinessAdapter, isDirectImageUrl } from '../../src/integrations/instagram-business-adapter.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { getDb } from '../../src/db/client.js';
import { DurableEventBus } from '../../src/revenue/durable-event-bus.js';
import { generateBuyerIntentHubs } from '../../src/commission/static-site-generator.js';

describe('Stage P — Production Hardening & Security Locking', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    InstagramBusinessAdapter.resetInstance();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    D1Client.getInstance().resetQuotaCircuitBreakerForTesting();
    InstagramBusinessAdapter.resetInstance();
  });

  it('Task 1: D1Client.isDailyQuotaError rejects SQLite schema/syntax errors and preserves circuit state', () => {
    const client = D1Client.getInstance();

    // Syntax or schema errors should NEVER trip daily quota circuit breaker
    expect(client.isDailyQuotaError(400, 'no such table: pipeline_transitions')).toBe(false);
    expect(client.isDailyQuotaError(400, 'sqlite_error: UNIQUE constraint failed')).toBe(false);
    expect(client.isDailyQuotaError(400, 'Error 7500: syntax error near "SELECT"')).toBe(false);
    expect(client.isDailyQuotaError(400, 'no such column: is_verified')).toBe(false);

    // True daily quota exhaustion errors DO trip
    expect(client.isDailyQuotaError(400, 'Cloudflare D1 daily read limit reached (code 7500)')).toBe(true);
    expect(client.isDailyQuotaError(429, 'Rate limit exceeded: daily quota')).toBe(true);
    expect(client.isDailyQuotaError(400, 'quota exceeded for current billing cycle')).toBe(true);
  });

  it('Task 1: pipeline_transitions is eliminated and emits durable_events with PIPELINE_TRANSITION', async () => {
    const emittedEvents: any[] = [];
    const emitSpy = vi.spyOn(DurableEventBus, 'emitAsync').mockImplementation(async (event: any) => {
      emittedEvents.push(event);
      return { eventId: 'evt_test_1', persisted: true };
    });

    const { SalesConversationEngine } = await import('../../src/revenue/sales-conversation-engine.js');
    const engine = SalesConversationEngine.getInstance();

    // Transition an inquiry pipeline state
    await (engine as any).updatePipelineStageAsync('test@example.com', 'QUALIFIED', 'Stage P test reason', 'journey_123');

    expect(emitSpy).toHaveBeenCalled();
    const transitionEvent = emittedEvents.find(e => e.eventType === 'PIPELINE_TRANSITION');
    expect(transitionEvent).toBeDefined();
    expect(transitionEvent.payload.journeyId).toBe('journey_123');
    expect(transitionEvent.payload.toStage).toBe('QUALIFIED');
    expect(transitionEvent.payload.reason).toBe('Stage P test reason');

    emitSpy.mockRestore();
  });

  it('Task 2: Instagram signed state generation and verification (valid vs expired/tampered)', () => {
    const authSecret = 'stage_p_test_secret_for_hmac';
    const validState = InstagramBusinessAdapter.generateSignedState(authSecret);
    expect(typeof validState).toBe('string');
    expect(validState.split('.').length).toBe(3);

    // Valid state verification
    const checkValid = InstagramBusinessAdapter.verifySignedState(validState, authSecret);
    expect(checkValid.valid).toBe(true);

    // Tampered state verification
    const tampered = validState.slice(0, -4) + 'abcd';
    const checkTampered = InstagramBusinessAdapter.verifySignedState(tampered, authSecret);
    expect(checkTampered.valid).toBe(false);
    expect(checkTampered.error).toBe('TAMPERED_STATE');

    // Missing state verification
    const checkMissing = InstagramBusinessAdapter.verifySignedState(undefined, authSecret);
    expect(checkMissing.valid).toBe(false);
    expect(checkMissing.error).toBe('MISSING_STATE');

    // Expired state verification (older than 15 minutes)
    const oldTimestamp = Date.now() - 20 * 60 * 1000;
    const crypto = require('crypto');
    const nonce = 'abcdef0123456789';
    const oldHmac = crypto.createHmac('sha256', authSecret).update(`${oldTimestamp}.${nonce}`).digest('hex');
    const expiredState = `${oldTimestamp}.${nonce}.${oldHmac}`;
    const checkExpired = InstagramBusinessAdapter.verifySignedState(expiredState, authSecret);
    expect(checkExpired.valid).toBe(false);
    expect(checkExpired.error).toBe('EXPIRED_STATE');
  });

  it('Task 2: Direct image URL validator rejects HTML endpoints and accepts direct media assets', () => {
    expect(isDirectImageUrl('https://example.com/deals')).toBe(false);
    expect(isDirectImageUrl('https://example.com/deals/')).toBe(false);
    expect(isDirectImageUrl('https://ai-marketing-organization.onrender.com/deals')).toBe(false);
    expect(isDirectImageUrl('javascript:alert(1)')).toBe(false);
    expect(isDirectImageUrl('')).toBe(false);

    expect(isDirectImageUrl('https://images.boat-lifestyle.com/products/airdopes-141.png')).toBe(true);
    expect(isDirectImageUrl('https://cdn.shopify.com/s/files/1/perfume.jpg?v=123')).toBe(true);
    expect(isDirectImageUrl('https://media.gonoise.com/smartwatch.webp')).toBe(true);
  });

  it('Task 2: publishDealToInstagram rejects deals with non-direct image URLs', async () => {
    const adapter = new InstagramBusinessAdapter();
    const result = await adapter.publishDealToInstagram({
      id: 'deal_test_no_image',
      title: 'Valid boAt Headphone',
      merchant: 'boAt',
      currentPriceINR: 999,
      productVerified: true,
      socialMediaPublishersAllowed: true,
      imageUrl: 'https://ai-marketing-organization.onrender.com/deals' // non-direct HTML URL
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('INVALID_OR_NON_DIRECT_IMAGE_URL');
  });

  it('Task 3: /api/v1/mcp requires owner authentication across environments', async () => {
    const { apiRouter } = await import('../../src/routes/api.js');
    const app = new Hono();
    app.route('/api/v1', apiRouter);

    // Unauthenticated GET /mcp -> 401
    const unauthGet = await app.request('/api/v1/mcp');
    expect(unauthGet.status).toBe(401);

    // Unauthenticated POST /mcp -> 401
    const unauthPost = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    expect(unauthPost.status).toBe(401);

    // Authenticated with owner session -> 200
    const session = OwnerAuthService.getInstance().createSession('127.0.0.1', 'Vitest');
    const authGet = await app.request('/api/v1/mcp', {
      headers: { Authorization: `Bearer ${session.token}` }
    });
    expect(authGet.status).toBe(200);
    const getJson = (await authGet.json()) as any;
    expect(getJson.serverInfo?.name).toBe('ai-marketing-organization-mcp');

    const authPost = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    });
    expect(authPost.status).toBe(200);
    const postJson = (await authPost.json()) as any;
    expect(Array.isArray(postJson.result?.tools)).toBe(true);
  });

  it('Task 3: generateBuyerIntentHubs strictly requires genuine category deals and omits hubs with insufficient category inventory', () => {
    // Zero perfume/grooming deals in input catalog
    const testDeals = [
      {
        id: 'deal_electronics_1',
        title: 'boAt Airdopes 141 ANC',
        merchant: 'boAt Lifestyle',
        category: 'Audio',
        currentPriceINR: 1299,
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        availability: 'IN_STOCK',
        affiliateNetwork: 'CUELINKS'
      },
      {
        id: 'deal_electronics_2',
        title: 'Noise ColorFit Ultra 3 Smartwatch',
        merchant: 'Noise Store',
        category: 'Wearables',
        currentPriceINR: 899, // under 1000
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        availability: 'IN_STOCK',
        affiliateNetwork: 'CUELINKS'
      }
    ];

    const hubsWithoutGrooming = generateBuyerIntentHubs(testDeals, 'https://ai-marketing-organization.onrender.com', 10);
    const groomingHubMissing = hubsWithoutGrooming.find(h => h.intentSlug === 'grooming-and-perfume-bundles-under-1000');
    expect(groomingHubMissing).toBeUndefined();

    // Now supply genuine perfume & grooming deals
    const testDealsWithGrooming = [
      ...testDeals,
      {
        id: 'deal_grooming_1',
        title: 'The Man Company Blanc Body Perfume',
        merchant: 'The Man Company',
        category: 'Perfume',
        currentPriceINR: 499,
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        availability: 'IN_STOCK',
        affiliateNetwork: 'CUELINKS'
      },
      {
        id: 'deal_grooming_2',
        title: 'Bombay Shaving Company Charcoal Grooming Kit',
        merchant: 'Bombay Shaving Company',
        category: 'Grooming',
        currentPriceINR: 799,
        productVerified: true,
        affiliateVerified: true,
        isMonetizable: true,
        availability: 'IN_STOCK',
        affiliateNetwork: 'CUELINKS'
      }
    ];
    const hubsWithGrooming = generateBuyerIntentHubs(testDealsWithGrooming, 'https://ai-marketing-organization.onrender.com', 10);
    const groomingHubPresent = hubsWithGrooming.find(h => h.intentSlug === 'grooming-and-perfume-bundles-under-1000');
    expect(groomingHubPresent).toBeDefined();
    expect(groomingHubPresent?.deals.length).toBeGreaterThanOrEqual(2);
    expect(groomingHubPresent?.canonicalUrl).toBe('https://ai-marketing-organization.onrender.com/best/grooming-and-perfume-bundles-under-1000');
  });

  it('Task 3: Webhook POST /webhooks/instagram verifies X-Hub-Signature-256 with INSTAGRAM_APP_SECRET', async () => {
    process.env.INSTAGRAM_APP_SECRET = 'test_meta_app_secret_999';
    const { apiRouter } = await import('../../src/routes/api.js');
    const app = new Hono();
    app.route('/api/v1', apiRouter);

    const rawPayload = JSON.stringify({ entry: [] });

    // Missing signature -> 401
    const resNoSig = await app.request('/api/v1/webhooks/instagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawPayload
    });
    expect(resNoSig.status).toBe(401);

    // Invalid signature -> 401
    const resBadSig = await app.request('/api/v1/webhooks/instagram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000'
      },
      body: rawPayload
    });
    expect(resBadSig.status).toBe(401);

    // Valid HMAC-SHA256 signature -> 200
    const crypto = require('crypto');
    const validSig = 'sha256=' + crypto.createHmac('sha256', 'test_meta_app_secret_999').update(rawPayload).digest('hex');
    const resGoodSig = await app.request('/api/v1/webhooks/instagram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': validSig
      },
      body: rawPayload
    });
    expect(resGoodSig.status).toBe(200);
  });

  it('Task 1: Fail-closed on Render (process.env.RENDER=true) when D1 circuit breaker is open', async () => {
    process.env.RENDER = 'true';
    const d1 = D1Client.getInstance();
    d1.tripQuotaCircuitBreakerPublic('Daily quota reached (code 7500)');

    const { apiRouter } = await import('../../src/routes/api.js');
    const app = new Hono();
    app.route('/api/v1', apiRouter);

    // /api/v1/health reports degraded 503
    const healthRes = await app.request('/api/v1/health');
    expect(healthRes.status).toBe(503);
    const healthJson = (await healthRes.json()) as any;
    expect(healthJson.status).toBe('degraded');
    expect(healthJson.d1CircuitBreaker.exhausted).toBe(true);

    // /offer/upi-claim fails closed with 503
    const upiRes = await app.request('/api/v1/offer/upi-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utr: '123456789012',
        offerId: 'sitefix_core_499',
        buyerEmail: 'test@example.com'
      })
    });
    expect(upiRes.status).toBe(503);
    const upiJson = (await upiRes.json()) as any;
    expect(upiJson.error).toBe('SERVICE_UNAVAILABLE');
  });
});
