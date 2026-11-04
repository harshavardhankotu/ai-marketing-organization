import { describe, it, expect } from 'vitest';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { apiRouter } from '../../src/routes/api.js';

describe('SiteFix AI: Commercial Terms, Entitlements & Automated Delivery (Part 2.5 & 3.1-3.4)', () => {
  const service = SiteAuditService.getInstance();
  const scanner = new SiteAuditScanner();

  it('correctly provides attested commercial terms and supports explicit gating', () => {
    // 1. Attested by default for self-serve checkout
    const terms = service.getCommercialTerms();
    expect(terms.sku).toBe('SITEFIX_AI_PACK_V1');
    expect(terms.proposedPriceINR).toBe(499);
    expect(terms.amountPaise).toBe(49900);
    expect(terms.currency).toBe('INR');
    expect(terms.isAttestedByOwner).toBe(true);
    expect(terms.disclaimer).toContain('This tool does not modify the customer\'s website');

    // 2. Explicit gating when SITE_AUDIT_TERMS_ATTESTED === 'false'
    const prev = process.env.SITE_AUDIT_TERMS_ATTESTED;
    try {
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'false';
      const gatedTerms = service.getCommercialTerms();
      expect(gatedTerms.isAttestedByOwner).toBe(false);
    } finally {
      if (prev !== undefined) process.env.SITE_AUDIT_TERMS_ATTESTED = prev;
      else delete process.env.SITE_AUDIT_TERMS_ATTESTED;
    }
  });

  it('generates cryptographically signed HMAC delivery tokens', () => {
    const orderId = 'order_test_987';
    const auditId = 'audit_test_123';
    const token = service.generateDeliveryToken(orderId, auditId, 24);

    expect(typeof token).toBe('string');
    const parts = token.split('.');
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe(orderId);
    expect(parts[1]).toBe(auditId);
    expect(Number(parts[2])).toBeGreaterThan(Date.now());
    expect(parts[3].length).toBe(64); // 256-bit HMAC hex
  });

  it('validates authentic delivery tokens and rejects expired, mismatched, or tampered tokens', async () => {
    const orderId = 'order_test_456';
    const auditId = 'audit_test_789';
    const validToken = service.generateDeliveryToken(orderId, auditId, 2);

    // 1. Valid token
    const resValid = await service.verifyDeliveryToken(validToken, auditId);
    expect(resValid.valid).toBe(true);
    expect(resValid.orderId).toBe(orderId);

    // 2. Mismatched audit ID
    const resMismatch = await service.verifyDeliveryToken(validToken, 'audit_different_target');
    expect(resMismatch.valid).toBe(false);
    expect(resMismatch.error).toBe('AUDIT_ID_MISMATCH');

    // 3. Expired token (set expiry 1 second in the past)
    const expiredToken = service.generateDeliveryToken(orderId, auditId, -1);
    const resExpired = await service.verifyDeliveryToken(expiredToken, auditId);
    expect(resExpired.valid).toBe(false);
    expect(resExpired.error).toBe('TOKEN_EXPIRED');

    // 4. Tampered signature
    const parts = validToken.split('.');
    parts[3] = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const tamperedToken = parts.join('.');
    const resTampered = await service.verifyDeliveryToken(tamperedToken, auditId);
    expect(resTampered.valid).toBe(false);
    expect(resTampered.error).toBe('INVALID_SIGNATURE');

    // 5. Malformed token
    const resMalformed = await service.verifyDeliveryToken('not-a-valid-token', auditId);
    expect(resMalformed.valid).toBe(false);
    expect(resMalformed.error).toBe('MALFORMED_DELIVERY_TOKEN');
  });

  it('supports automated deliverable generation and idempotent regeneration', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Pune Logistics Hub</title></head>
      <body><a href="tel:+912012345678">Contact</a></body>
      </html>
    `;

    const audit = await scanner.scanUrl(
      { url: 'https://punelogistics.example.com', userConfirmedOwnership: true },
      {
        url: 'https://punelogistics.example.com',
        finalUrl: 'https://punelogistics.example.com',
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: mockHtml,
        timingMs: 120,
        bytesReceived: mockHtml.length,
        contentType: 'text/html',
        redirectChain: ['https://punelogistics.example.com']
      }
    );

    service.setAuditInCache(audit);

    // First generation
    const deliverable1 = service.generateDeliverable(audit.auditId, 'order_test_999');
    expect(deliverable1.auditId).toBe(audit.auditId);
    expect(deliverable1.targetUrl).toBe('https://punelogistics.example.com');
    expect(deliverable1.headMetadataSnippet).toContain('<title>Pune Logistics Hub</title>');

    // Second (regenerated) download request returns identical deliverable
    const deliverable2 = service.generateDeliverable(audit.auditId, 'order_test_999');
    expect(deliverable2.headMetadataSnippet).toBe(deliverable1.headMetadataSnippet);
  });
});

describe('SiteFix AI: Route Integration Tests via Hono apiRouter', () => {
  it('serves interactive tool HTML page at GET /tools/site-audit', async () => {
    const res = await apiRouter.request('/tools/site-audit', { method: 'GET' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('SiteFix AI');
    expect(html).toContain('Instant Website Audit & Optimization Pack');
    expect(html).toContain('targetUrl');
  });

  it('rejects POST /api/v1/tools/site-audit/scan without target URL', async () => {
    const res = await apiRouter.request('/api/v1/tools/site-audit/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userConfirmedOwnership: true })
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('MISSING_URL');
  });

  it('rejects POST /api/v1/tools/site-audit/scan without ownership confirmation', async () => {
    const res = await apiRouter.request('/api/v1/tools/site-audit/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', userConfirmedOwnership: false })
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('OWNERSHIP_CONFIRMATION_REQUIRED');
  });

  it('handles checkout request with attested ₹499 digital Fix-Pack', async () => {
    const res = await apiRouter.request('/api/v1/tools/site-audit/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        auditId: 'audit_test_demo',
        customerEmail: 'buyer@example.com'
      })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.order.sku).toBe('SITEFIX_AI_PACK_V1');
    expect(json.order.amountINR).toBe(499);
    expect(json.order.amountPaise).toBe(49900);
    expect(json.order.currency).toBe('INR');
  });

  it('rejects checkout when explicitly gated with SITE_AUDIT_TERMS_ATTESTED=false in production', async () => {
    const prevAttested = process.env.SITE_AUDIT_TERMS_ATTESTED;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.SITE_AUDIT_TERMS_ATTESTED = 'false';
      process.env.NODE_ENV = 'production';
      const res = await apiRouter.request('/api/v1/tools/site-audit/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId: 'audit_test_gated' })
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.status).toBe('PENDING_OWNER_ATTESTATION');
    } finally {
      if (prevAttested !== undefined) process.env.SITE_AUDIT_TERMS_ATTESTED = prevAttested;
      else delete process.env.SITE_AUDIT_TERMS_ATTESTED;
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  it('verifies Razorpay raw-body HMAC signature and delivers fix-pack on payment.captured', async () => {
    const crypto = await import('crypto');
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'test_webhook_secret_123';
    process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
    const eventId = `evt_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const payload = {
      entity: 'event',
      account_id: 'acc_test_123',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: 'pay_test_sitefix_001',
            entity: 'payment',
            amount: 49900,
            currency: 'INR',
            status: 'captured',
            order_id: 'order_test_hook_001',
            notes: {
              auditId: 'audit_test_captured',
              sku: 'SITEFIX_AI_PACK_V1'
            }
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    };

    const rawBody = JSON.stringify(payload);
    const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

    // 1. Invalid signature is rejected
    const badRes = await apiRouter.request('/api/v1/tools/site-audit/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'invalid_signature_hex'
      },
      body: rawBody
    });
    expect(badRes.status).toBe(400);

    // 2. Valid signature is processed and returns download token
    const goodRes = await apiRouter.request('/api/v1/tools/site-audit/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    });
    expect(goodRes.status).toBe(200);
    const goodJson = await goodRes.json();
    expect(goodJson.success).toBe(true);
    expect(goodJson.processed).toBe(true);
    expect(goodJson.downloadToken).toBeDefined();
    expect(goodJson.downloadUrl).toContain('/api/v1/tools/site-audit/audit_test_captured/deliverable?token=');

    // 3. Deduplication via x-razorpay-event-id returns duplicate: true
    const dupRes = await apiRouter.request('/api/v1/tools/site-audit/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': validSignature,
        'x-razorpay-event-id': eventId
      },
      body: rawBody
    });
    expect(dupRes.status).toBe(200);
    const dupJson = await dupRes.json();
    expect(dupJson.duplicate).toBe(true);
  });

  it('rejects unauthorized download attempts at GET /api/v1/tools/site-audit/:auditId/deliverable', async () => {
    const res = await apiRouter.request('/api/v1/tools/site-audit/audit_test_123/deliverable?token=invalid_token', {
      method: 'GET'
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('DELIVERY_UNAUTHORIZED');
  });
});
