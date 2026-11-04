import { describe, it, expect } from 'vitest';
import { SiteAuditService } from '../../src/tools/site-audit/site-audit-service.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { apiRouter } from '../../src/routes/api.js';

describe('SiteFix AI: Commercial Terms, Entitlements & Automated Delivery (Part 2.5 & 3.1-3.4)', () => {
  const service = SiteAuditService.getInstance();
  const scanner = new SiteAuditScanner();

  it('correctly provides proposed commercial terms and gates production checkout without owner attestation', () => {
    const terms = service.getCommercialTerms();
    expect(terms.sku).toBe('SITE_AUDIT_FIXPACK');
    expect(terms.proposedPriceINR).toBe(499);
    expect(terms.currency).toBe('INR');
    // Without explicit owner attestation in env, isAttestedByOwner must strictly be false
    expect(terms.isAttestedByOwner).toBe(false);
    expect(terms.disclaimer).toContain('This tool does not modify the customer\'s website');
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

  it('handles checkout request with x-test-mode header', async () => {
    const res = await apiRouter.request('/api/v1/tools/site-audit/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-mode': 'true'
      },
      body: JSON.stringify({
        auditId: 'audit_test_demo',
        customerEmail: 'buyer@example.com'
      })
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.order.sku).toBe('SITE_AUDIT_FIXPACK');
    expect(json.order.amountINR).toBe(499);
    expect(json.order.currency).toBe('INR');
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
