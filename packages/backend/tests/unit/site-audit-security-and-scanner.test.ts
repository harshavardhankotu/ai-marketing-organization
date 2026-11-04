import { describe, it, expect } from 'vitest';
import { SecureUrlFetcher, SecureFetchError } from '../../src/tools/site-audit/secure-url-fetcher.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';
import { SiteAuditFixPackGenerator } from '../../src/tools/site-audit/site-audit-fixpack-generator.js';

describe('SiteFix AI: Secure URL Fetcher & OWASP SSRF Defense (Part 2.2 & 8.1)', () => {
  it('rejects invalid or non-HTTP/HTTPS protocols', () => {
    expect(() => SecureUrlFetcher.validateUrlStructure('ftp://example.com')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('file:///etc/passwd')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('gopher://example.com')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('javascript:alert(1)')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('data:text/html,<b>hi</b>')).toThrow(SecureFetchError);
  });

  it('rejects embedded user credentials in URLs', () => {
    expect(() => SecureUrlFetcher.validateUrlStructure('https://admin:secret@example.com')).toThrow(SecureFetchError);
  });

  it('rejects non-standard ports (e.g. 22, 6379, 8080)', () => {
    expect(() => SecureUrlFetcher.validateUrlStructure('http://example.com:8080')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('https://example.com:22')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('http://example.com:6379')).toThrow(SecureFetchError);
  });

  it('allows standard ports (80 and 443)', () => {
    expect(() => SecureUrlFetcher.validateUrlStructure('http://example.com:80')).not.toThrow();
    expect(() => SecureUrlFetcher.validateUrlStructure('https://example.com:443')).not.toThrow();
    expect(() => SecureUrlFetcher.validateUrlStructure('https://example.com')).not.toThrow();
  });

  it('rejects internal and reserved hostnames', () => {
    expect(() => SecureUrlFetcher.validateUrlStructure('http://localhost')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('http://sub.localhost')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('http://internal.service.local')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('http://metadata.google.internal')).toThrow(SecureFetchError);
  });

  it('rejects hex/octal/integer obfuscated IP notations in hostnames', () => {
    expect(() => SecureUrlFetcher.validateUrlStructure('http://0x7f000001')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('http://2130706433')).toThrow(SecureFetchError);
    expect(() => SecureUrlFetcher.validateUrlStructure('http://0177.0.0.1')).toThrow(SecureFetchError);
  });

  it('detects and blocks all restricted IPv4 ranges (loopback, private, link-local, metadata, multicast, broadcast)', () => {
    // Loopback 127.0.0.0/8
    expect(SecureUrlFetcher.isIpBlocked('127.0.0.1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('127.1.2.3').blocked).toBe(true);

    // Private RFC 1918
    expect(SecureUrlFetcher.isIpBlocked('10.0.0.1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('10.254.1.1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('172.16.0.1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('172.31.255.255').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('192.168.1.1').blocked).toBe(true);

    // Cloud Metadata / Link-local RFC 3927 (169.254.0.0/16)
    expect(SecureUrlFetcher.isIpBlocked('169.254.169.254').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('169.254.1.1').blocked).toBe(true);

    // Carrier-grade NAT (100.64.0.0/10)
    expect(SecureUrlFetcher.isIpBlocked('100.64.0.1').blocked).toBe(true);

    // Current network & Broadcast
    expect(SecureUrlFetcher.isIpBlocked('0.0.0.0').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('255.255.255.255').blocked).toBe(true);

    // Multicast (224.0.0.0/4)
    expect(SecureUrlFetcher.isIpBlocked('224.0.0.1').blocked).toBe(true);

    // Valid public IPv4 addresses MUST NOT be blocked
    expect(SecureUrlFetcher.isIpBlocked('8.8.8.8').blocked).toBe(false);
    expect(SecureUrlFetcher.isIpBlocked('93.184.216.34').blocked).toBe(false);
    expect(SecureUrlFetcher.isIpBlocked('104.21.50.10').blocked).toBe(false);
  });

  it('detects and blocks all restricted IPv6 ranges (loopback, ULA, link-local, IPv4-mapped)', () => {
    // Loopback
    expect(SecureUrlFetcher.isIpBlocked('::1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('::').blocked).toBe(true);

    // Unique Local Address (fc00::/7)
    expect(SecureUrlFetcher.isIpBlocked('fc00::1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('fd12:3456:789a::1').blocked).toBe(true);

    // Link-local Unicast (fe80::/10)
    expect(SecureUrlFetcher.isIpBlocked('fe80::1').blocked).toBe(true);

    // IPv4-mapped IPv6 pointing to private address
    expect(SecureUrlFetcher.isIpBlocked('::ffff:127.0.0.1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('::ffff:192.168.0.1').blocked).toBe(true);
    expect(SecureUrlFetcher.isIpBlocked('::ffff:169.254.169.254').blocked).toBe(true);

    // Public IPv6 address MUST NOT be blocked
    expect(SecureUrlFetcher.isIpBlocked('2607:f8b0:4005:805::200e').blocked).toBe(false);
  });
});

describe('SiteFix AI: Deterministic Website Audit Scanner (Part 2.1 & 8.1)', () => {
  const scanner = new SiteAuditScanner();

  it('accurately parses optimal HTML title, meta description, and canonical tags', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Apollo Dental Clinic Hyderabad — Root Canal & Implants</title>
        <meta name="description" content="Award-winning multi-specialty dental clinic in Jubilee Hills, Hyderabad offering laser dentistry, painless root canals, and dental implants.">
        <link rel="canonical" href="https://apollodental.example.com">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta property="og:title" content="Apollo Dental Clinic Hyderabad">
        <meta property="og:image" content="https://apollodental.example.com/cover.jpg">
        <meta name="twitter:card" content="summary_large_image">
      </head>
      <body>
        <a href="tel:+919876543210">Call Us</a>
      </body>
      </html>
    `;

    const result = await scanner.scanUrl(
      { url: 'https://apollodental.example.com', userConfirmedOwnership: true },
      {
        url: 'https://apollodental.example.com',
        finalUrl: 'https://apollodental.example.com',
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: mockHtml,
        timingMs: 140,
        bytesReceived: mockHtml.length,
        contentType: 'text/html; charset=utf-8',
        redirectChain: ['https://apollodental.example.com']
      }
    );

    expect(result.overallStatus).toBe('OPTIMIZED');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.preview.title).toBe('Apollo Dental Clinic Hyderabad — Root Canal & Implants');
    expect(result.preview.metaDescription).toContain('Award-winning multi-specialty dental clinic');
    expect(result.metrics.httpStatus).toBe(200);
    expect(result.findings.some(f => f.id === 'meta_title_optimal' && f.status === 'PASS')).toBe(true);
    expect(result.findings.some(f => f.id === 'canonical_tag_present' && f.status === 'PASS')).toBe(true);
    expect(result.disclosures.notFullCrawl).toBe(true);
    expect(result.disclosures.noRankGuarantee).toBe(true);
  });

  it('detects critical issues: missing title, missing viewport, and robots noindex', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="robots" content="noindex, nofollow">
      </head>
      <body>
        <h1>Under Construction</h1>
      </body>
      </html>
    `;

    const result = await scanner.scanUrl(
      { url: 'https://broken.example.com', userConfirmedOwnership: true },
      {
        url: 'https://broken.example.com',
        finalUrl: 'https://broken.example.com',
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: mockHtml,
        timingMs: 400,
        bytesReceived: mockHtml.length,
        contentType: 'text/html',
        redirectChain: ['https://broken.example.com']
      }
    );

    expect(result.overallStatus).toBe('ACTION_REQUIRED');
    expect(result.score).toBeLessThan(60);

    const missingTitle = result.findings.find(f => f.id === 'meta_title_missing');
    expect(missingTitle).toBeDefined();
    expect(missingTitle?.status).toBe('ISSUE');
    expect(missingTitle?.severity).toBe('CRITICAL');

    const noindexFinding = result.findings.find(f => f.id === 'robots_noindex_detected');
    expect(noindexFinding).toBeDefined();
    expect(noindexFinding?.status).toBe('ISSUE');
    expect(noindexFinding?.severity).toBe('CRITICAL');

    const viewportFinding = result.findings.find(f => f.id === 'viewport_missing');
    expect(viewportFinding).toBeDefined();
    expect(viewportFinding?.status).toBe('ISSUE');
  });

  it('validates Schema.org JSON-LD and detects syntax errors', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Store Name - Premium Products</title>
        <script type="application/ld+json">
          { "@context": "https://schema.org", "@type": "LocalBusiness", "name": "Dental Care", }
        </script>
      </head>
      <body></body>
      </html>
    `;

    const result = await scanner.scanUrl(
      { url: 'https://syntax-err.example.com', userConfirmedOwnership: true },
      {
        url: 'https://syntax-err.example.com',
        finalUrl: 'https://syntax-err.example.com',
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: mockHtml,
        timingMs: 150,
        bytesReceived: mockHtml.length,
        contentType: 'text/html',
        redirectChain: ['https://syntax-err.example.com']
      }
    );

    const syntaxErrorFinding = result.findings.find(f => f.id.startsWith('schema_jsonld_syntax_error'));
    expect(syntaxErrorFinding).toBeDefined();
    expect(syntaxErrorFinding?.status).toBe('ISSUE');
    expect(syntaxErrorFinding?.severity).toBe('CRITICAL');
  });

  it('correctly identifies valid Schema.org entities without hallucinating fields', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Elite Bangalore Motors - Car Service</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            "name": "Elite Bangalore Motors",
            "url": "https://elitemotors.example.com"
          }
        </script>
      </head>
      <body></body>
      </html>
    `;

    const result = await scanner.scanUrl(
      { url: 'https://elitemotors.example.com', userConfirmedOwnership: true },
      {
        url: 'https://elitemotors.example.com',
        finalUrl: 'https://elitemotors.example.com',
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: mockHtml,
        timingMs: 200,
        bytesReceived: mockHtml.length,
        contentType: 'text/html',
        redirectChain: ['https://elitemotors.example.com']
      }
    );

    expect(result.metrics.jsonLdTypesFound).toContain('LocalBusiness');
    // Checks that telephone missing was flagged as NEEDS_USER_CONFIRMATION rather than invented
    const telFinding = result.findings.find(f => f.id === 'schema_missing_telephone');
    expect(telFinding).toBeDefined();
    expect(telFinding?.status).toBe('NEEDS_USER_CONFIRMATION');
    expect(telFinding?.recommendation).toContain('Insert your official contact number');
  });
});

describe('SiteFix AI: Optimization Fix-Pack Deliverable Generator (Part 2.4)', () => {
  const generator = new SiteAuditFixPackGenerator();
  const scanner = new SiteAuditScanner();

  it('generates complete copy-paste head metadata, Open Graph, and Schema.org templates with clear placeholders', async () => {
    const mockHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Quick Fix Plumbing Delhi</title>
      </head>
      <body></body>
      </html>
    `;

    const audit = await scanner.scanUrl(
      { url: 'https://delhiplumber.example.com', userConfirmedOwnership: true },
      {
        url: 'https://delhiplumber.example.com',
        finalUrl: 'https://delhiplumber.example.com',
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
        body: mockHtml,
        timingMs: 200,
        bytesReceived: mockHtml.length,
        contentType: 'text/html',
        redirectChain: ['https://delhiplumber.example.com']
      }
    );

    const deliverable = generator.generateFixPack(audit, 'order_test_123');

    expect(deliverable.targetUrl).toBe('https://delhiplumber.example.com');
    expect(deliverable.orderId).toBe('order_test_123');
    expect(deliverable.headMetadataSnippet).toContain('<title>Quick Fix Plumbing Delhi</title>');
    expect(deliverable.headMetadataSnippet).toContain('<link rel="canonical" href="https://delhiplumber.example.com">');
    expect(deliverable.openGraphSnippet).toContain('<meta property="og:title"');
    expect(deliverable.twitterCardSnippet).toContain('summary_large_image');

    // Verify Schema JSON-LD has honest placeholders, NOT invented fake phone numbers or reviews
    expect(deliverable.schemaJsonLdSnippet).toContain('[INSERT_YOUR_BUSINESS_PHONE_NUMBER');
    expect(deliverable.schemaJsonLdSnippet).toContain('[INSERT_STREET_ADDRESS]');
    expect(deliverable.schemaJsonLdSnippet).not.toContain('fake-phone');
    expect(deliverable.schemaJsonLdSnippet).not.toContain('aggregateRating');

    // Checklist has CMS instructions
    expect(deliverable.checklistMarkdown).toContain('WordPress');
    expect(deliverable.checklistMarkdown).toContain('Shopify');
    expect(deliverable.checklistMarkdown).toContain('LEGAL NOTICE');
    expect(deliverable.disclosure).toBe(SiteAuditFixPackGenerator.LEGAL_DISCLOSURE);
  });
});
