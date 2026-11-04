/**
 * Secure URL Fetcher with Strict OWASP SSRF Prevention & DNS Rebinding Defense
 * Implements V6.1 Specification Phase 2.
 */

import https from 'https';
import dns from 'dns';
import net from 'net';
import { URL } from 'url';

export class SecureFetchError extends Error {
  public readonly code:
    | 'INVALID_URL'
    | 'UNSUPPORTED_PROTOCOL'
    | 'EMBEDDED_CREDENTIALS_REJECTED'
    | 'NON_STANDARD_PORT_REJECTED'
    | 'BLOCKED_HOSTNAME'
    | 'DNS_RESOLUTION_FAILED'
    | 'SSRF_BLOCKED_IP'
    | 'TOO_MANY_REDIRECTS'
    | 'FETCH_TIMEOUT'
    | 'PAYLOAD_TOO_LARGE'
    | 'INVALID_CONTENT_TYPE'
    | 'NETWORK_ERROR';
  public readonly statusCode?: number;

  constructor(
    code:
      | 'INVALID_URL'
      | 'UNSUPPORTED_PROTOCOL'
      | 'EMBEDDED_CREDENTIALS_REJECTED'
      | 'NON_STANDARD_PORT_REJECTED'
      | 'BLOCKED_HOSTNAME'
      | 'DNS_RESOLUTION_FAILED'
      | 'SSRF_BLOCKED_IP'
      | 'TOO_MANY_REDIRECTS'
      | 'FETCH_TIMEOUT'
      | 'PAYLOAD_TOO_LARGE'
      | 'INVALID_CONTENT_TYPE'
      | 'NETWORK_ERROR',
    message: string,
    statusCode?: number
  ) {
    super(`${code}: ${message}`);
    this.name = 'SecureFetchError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, SecureFetchError.prototype);
  }
}

export interface SecureFetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  timingMs: number;
  bytesReceived: number;
  contentType: string;
  redirectChain: string[];
}

export interface SecureFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxSizeBytes?: number;
  acceptContentTypes?: string[];
  userAgent?: string;
  allowHttpForTesting?: boolean;
}

export class SecureUrlFetcher {
  public static readonly DEFAULT_TIMEOUT_MS = 5000; // Strict 5-second timeout (V6.1)
  public static readonly DEFAULT_MAX_REDIRECTS = 3;
  public static readonly DEFAULT_MAX_SIZE_BYTES = 512 * 1024; // Strict 512 KB limit (V6.1)
  public static readonly DEFAULT_USER_AGENT = 'SiteFixAI-SecurityBot/1.0 (+https://ai-marketing-organization.onrender.com/tools/site-audit)';

  // Blocked IPv4 Subnets (CIDR) per V6.1 Spec
  public static readonly IPV4_BLOCKED_CIDRS = [
    '0.0.0.0/8',       // Current network
    '10.0.0.0/8',      // Private network (RFC 1918)
    '100.64.0.0/10',   // Carrier-grade NAT (RFC 6598)
    '127.0.0.0/8',     // Loopback (RFC 1122)
    '169.254.0.0/16',  // Link-local / Cloud metadata (RFC 3927)
    '172.16.0.0/12',   // Private network (RFC 1918)
    '192.0.0.0/24',    // IETF Protocol Assignments
    '192.0.2.0/24',    // TEST-NET-1 (RFC 5737)
    '192.88.99.0/24',  // 6to4 Relay Anycast
    '192.168.0.0/16',  // Private network (RFC 1918)
    '198.18.0.0/15',   // Network benchmark tests (RFC 2544)
    '198.51.100.0/24', // TEST-NET-2 (RFC 5737)
    '203.0.113.0/24',  // TEST-NET-3 (RFC 5737)
    '224.0.0.0/4',     // Multicast / Reserved (RFC 5771)
    '240.0.0.0/4',     // Reserved (RFC 1112)
    '255.255.255.255/32' // Broadcast
  ];

  // Blocked IPv6 Subnets (CIDR) per V6.1 Spec
  public static readonly IPV6_BLOCKED_CIDRS = [
    '::/128',          // Unspecified
    '::1/128',         // Loopback
    '64:ff9b::/96',    // IPv4/IPv6 translation
    '100::/64',        // Discard prefix
    '2001::/32',       // TEREDO
    '2001:20::/28',    // ORCHIDv2
    '2001:db8::/32',   // Documentation
    '2002::/16',       // 6to4
    'fc00::/7',        // Unique Local Address (ULA) - private
    'fe80::/10',       // Link-local Unicast
    'ff00::/8'         // Multicast
  ];

  /**
   * Helper: converts IPv4 string to 32-bit unsigned integer
   */
  public static ipv4ToLong(ip: string): number {
    return (
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
    );
  }

  /**
   * Helper: checks if IPv4 is within a given CIDR
   */
  public static isIpv4InCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const prefixLen = parseInt(bits, 10);
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
    return (SecureUrlFetcher.ipv4ToLong(ip) & mask) === (SecureUrlFetcher.ipv4ToLong(range) & mask);
  }

  /**
   * Helper: converts IPv6 string to bigint (128-bit)
   */
  public static ipv6ToBigInt(ip: string): bigint {
    // Handle IPv4-mapped IPv6 address (::ffff:192.0.2.1)
    if (ip.toLowerCase().startsWith('::ffff:') && ip.includes('.')) {
      const v4 = ip.slice(7);
      const parts = v4.split('.').map(Number);
      return (
        (BigInt(0xffff) << 32n) |
        (BigInt(parts[0]) << 24n) |
        (BigInt(parts[1]) << 16n) |
        (BigInt(parts[2]) << 8n) |
        BigInt(parts[3])
      );
    }

    let sections = ip.split(':');
    const dblColon = ip.indexOf('::');
    if (dblColon !== -1) {
      const left = ip.slice(0, dblColon).split(':').filter(Boolean);
      const right = ip.slice(dblColon + 2).split(':').filter(Boolean);
      const missing = 8 - (left.length + right.length);
      sections = [...left, ...Array(missing).fill('0'), ...right];
    }
    let res = 0n;
    for (const s of sections) {
      res = (res << 16n) | BigInt(parseInt(s || '0', 16));
    }
    return res;
  }

  /**
   * Helper: checks if IPv6 is within a given CIDR
   */
  public static isIpv6InCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const prefixLen = BigInt(parseInt(bits, 10));
    const mask =
      prefixLen === 0n
        ? 0n
        : ((1n << 128n) - 1n) ^ ((1n << (128n - prefixLen)) - 1n);
    return (
      (SecureUrlFetcher.ipv6ToBigInt(ip) & mask) ===
      (SecureUrlFetcher.ipv6ToBigInt(range) & mask)
    );
  }

  /**
   * Evaluates if a given IP address (v4 or v6) is private/reserved/dangerous.
   */
  public static isIpBlocked(ip: string): { blocked: boolean; reason?: string } {
    const family = net.isIP(ip);
    if (family === 0) {
      return { blocked: true, reason: `Invalid IP address format: ${ip}` };
    }

    if (family === 4) {
      for (const cidr of SecureUrlFetcher.IPV4_BLOCKED_CIDRS) {
        if (SecureUrlFetcher.isIpv4InCidr(ip, cidr)) {
          return { blocked: true, reason: `IPv4 address ${ip} falls into restricted range ${cidr}` };
        }
      }
      return { blocked: false };
    }

    if (family === 6) {
      // Check IPv4-mapped IPv6 address (::ffff:0:0/96)
      if (ip.toLowerCase().startsWith('::ffff:')) {
        const suffix = ip.slice(7);
        if (suffix.includes('.')) {
          return SecureUrlFetcher.isIpBlocked(suffix);
        }
        // Check hex IPv4-mapped IPv6 like ::ffff:7f00:0001
        const parts = suffix.split(':');
        if (parts.length <= 2) {
          const hex = parts.map(p => p.padStart(4, '0')).join('');
          if (hex.length === 8) {
            const b1 = parseInt(hex.slice(0, 2), 16);
            const b2 = parseInt(hex.slice(2, 4), 16);
            const b3 = parseInt(hex.slice(4, 6), 16);
            const b4 = parseInt(hex.slice(6, 8), 16);
            return SecureUrlFetcher.isIpBlocked(`${b1}.${b2}.${b3}.${b4}`);
          }
        }
      }
      for (const cidr of SecureUrlFetcher.IPV6_BLOCKED_CIDRS) {
        if (SecureUrlFetcher.isIpv6InCidr(ip, cidr)) {
          return { blocked: true, reason: `IPv6 address ${ip} falls into restricted range ${cidr}` };
        }
      }
      return { blocked: false };
    }

    return { blocked: true, reason: 'Unsupported IP family' };
  }

  /**
   * Validates target URL format, protocol, port, credentials, and hostname before DNS lookup.
   * V6.1 Rule: Enforces https: on standard port 443 only. Rejects credentials and raw IP literals.
   */
  public static validateUrlStructure(rawUrl: string, allowHttpForTesting: boolean = false): URL {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new SecureFetchError('INVALID_URL', 'Target URL is missing or not a string.');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new SecureFetchError('INVALID_URL', `Failed to parse URL: '${rawUrl}'`);
    }

    // 1. Strict Protocol check: HTTPS only (standard port 443)
    if (parsed.protocol !== 'https:') {
      if (!allowHttpForTesting || parsed.protocol !== 'http:') {
        throw new SecureFetchError(
          'UNSUPPORTED_PROTOCOL',
          `Protocol '${parsed.protocol}' is forbidden. Only https: is permitted.`
        );
      }
    }

    // 2. Reject credentials in URL
    if (parsed.username || parsed.password) {
      throw new SecureFetchError(
        'EMBEDDED_CREDENTIALS_REJECTED',
        'URLs with embedded user credentials (user:pass@) are strictly forbidden.'
      );
    }

    // 3. Port check: Standard HTTPS port 443 only (or port 80 if allowHttpForTesting)
    if (parsed.port) {
      const allowedPort = parsed.protocol === 'https:' ? '443' : '80';
      if (parsed.port !== allowedPort) {
        throw new SecureFetchError(
          'NON_STANDARD_PORT_REJECTED',
          `Port '${parsed.port}' is non-standard. Only standard port ${allowedPort} is permitted.`
        );
      }
    }

    // Check for obfuscated or raw numeric IP notation in the raw URL
    const rawHostMatch = rawUrl.match(/^https?:\/\/([^/?#:]+)/i);
    const rawHost = rawHostMatch ? rawHostMatch[1].trim() : '';
    if (
      /^0x[0-9a-f]+$/i.test(rawHost) ||
      /^\d+$/.test(rawHost) ||
      /^0[0-7]+(\.0[0-7]+)*$/.test(rawHost)
    ) {
      throw new SecureFetchError(
        'BLOCKED_HOSTNAME',
        `Obfuscated or raw numeric IP notation '${rawHost}' is rejected.`
      );
    }

    // 4. Hostname validation
    const hostname = parsed.hostname.toLowerCase().trim();
    if (!hostname) {
      throw new SecureFetchError('BLOCKED_HOSTNAME', 'Hostname cannot be empty.');
    }

    // Direct IP literal in URL hostname is rejected when a domain name is expected
    if (net.isIP(hostname)) {
      throw new SecureFetchError(
        'BLOCKED_HOSTNAME',
        `Raw IP literal '${hostname}' is rejected. A valid public domain name is required.`
      );
    }

    // Reject obvious internal/local destinations
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.corp') ||
      hostname === 'metadata.google.internal' ||
      hostname === 'metadata'
    ) {
      throw new SecureFetchError(
        'BLOCKED_HOSTNAME',
        `Hostname '${hostname}' is an internal or local reserved domain.`
      );
    }

    return parsed;
  }

  /**
   * Resolves hostname via DNS and strictly validates every returned A and AAAA record.
   * Returns the first validated safe IP address.
   */
  public static async resolveAndValidateHost(hostname: string): Promise<string> {
    // If hostname is already a direct IP literal, validate it directly
    if (net.isIP(hostname)) {
      const check = SecureUrlFetcher.isIpBlocked(hostname);
      if (check.blocked) {
        throw new SecureFetchError('SSRF_BLOCKED_IP', check.reason || 'IP is in a restricted range.');
      }
      return hostname;
    }

    let records: dns.LookupAddress[];
    try {
      records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch (err: any) {
      throw new SecureFetchError('DNS_RESOLUTION_FAILED', `DNS resolution failed for '${hostname}': ${err.message}`);
    }

    if (!records || records.length === 0) {
      throw new SecureFetchError('DNS_RESOLUTION_FAILED', `No DNS records found for host '${hostname}'.`);
    }

    // Validate ALL resolved addresses (both IPv4 and IPv6)
    // If ANY address resolves to a restricted/internal subnet, reject the host to prevent multi-A record SSRF / rebinding
    for (const record of records) {
      const check = SecureUrlFetcher.isIpBlocked(record.address);
      if (check.blocked) {
        throw new SecureFetchError(
          'SSRF_BLOCKED_IP',
          `Host '${hostname}' resolved to blocked IP ${record.address} (${check.reason}).`
        );
      }
    }

    // Return the first safe resolved IP
    return records[0].address;
  }

  /**
   * Executes a secure, SSRF-hardened fetch with DNS rebinding defense, redirect limits, and payload capping.
   */
  public async fetch(
    targetUrl: string,
    options: SecureFetchOptions = {}
  ): Promise<SecureFetchResult> {
    const timeoutMs = options.timeoutMs ?? SecureUrlFetcher.DEFAULT_TIMEOUT_MS;
    const maxRedirects = options.maxRedirects ?? SecureUrlFetcher.DEFAULT_MAX_REDIRECTS;
    const maxSizeBytes = options.maxSizeBytes ?? SecureUrlFetcher.DEFAULT_MAX_SIZE_BYTES;
    const userAgent = options.userAgent ?? SecureUrlFetcher.DEFAULT_USER_AGENT;
    const acceptTypes = options.acceptContentTypes ?? ['text/html', 'application/xhtml+xml'];

    const redirectChain: string[] = [];
    let currentUrl = targetUrl;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const parsedUrl = SecureUrlFetcher.validateUrlStructure(currentUrl, options.allowHttpForTesting);
      redirectChain.push(parsedUrl.href);

      // Pre-resolve DNS and validate against SSRF blocklist
      const resolvedIp = await SecureUrlFetcher.resolveAndValidateHost(parsedUrl.hostname);

      const startTime = Date.now();
      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 443;

      const fetchPromise = new Promise<SecureFetchResult>((resolve, reject) => {
        let isTimedOut = false;
        const timeoutTimer = setTimeout(() => {
          isTimedOut = true;
          req.destroy(new SecureFetchError('FETCH_TIMEOUT', `Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        // Security: DNS rebinding defense. Pin connection to pre-validated resolvedIp
        // while preserving TLS SNI servername and HTTP Host header.
        const reqOptions: https.RequestOptions = {
          protocol: 'https:',
          hostname: resolvedIp, // Connect to verified safe IP
          port,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'Host': parsedUrl.hostname, // Preserve virtual host
            'User-Agent': userAgent,
            'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
            'Accept-Encoding': 'identity', // Plain text for exact byte count and streaming limit
            'Connection': 'close'
          },
          servername: parsedUrl.hostname // TLS SNI
        };

        const req = https.request(reqOptions, (res) => {
          const timingMs = Date.now() - startTime;
          const statusCode = res.statusCode || 0;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
            }
          }

          // Check for redirects (301, 302, 303, 307, 308) - manual redirection only
          if ([301, 302, 303, 307, 308].includes(statusCode) && headers['location']) {
            clearTimeout(timeoutTimer);
            res.resume(); // Discard redirect body
            const nextUrl = new URL(headers['location'], currentUrl).href;
            resolve({
              url: targetUrl,
              finalUrl: nextUrl,
              statusCode,
              headers,
              body: '',
              timingMs,
              bytesReceived: 0,
              contentType: headers['content-type'] || '',
              redirectChain
            });
            return;
          }

          // Content-Type validation
          const rawContentType = (headers['content-type'] || '').toLowerCase();
          const isAllowedType = acceptTypes.some((type) => rawContentType.includes(type));
          if (!isAllowedType && statusCode === 200) {
            clearTimeout(timeoutTimer);
            req.destroy();
            reject(
              new SecureFetchError(
                'INVALID_CONTENT_TYPE',
                `Expected HTML content-type, but server returned '${rawContentType}'.`,
                statusCode
              )
            );
            return;
          }

          let bodyBuffer = '';
          let bytesReceived = 0;

          res.on('data', (chunk: Buffer) => {
            bytesReceived += chunk.length;
            if (bytesReceived > maxSizeBytes) {
              clearTimeout(timeoutTimer);
              req.destroy(
                new SecureFetchError(
                  'PAYLOAD_TOO_LARGE',
                  `Response body exceeded maximum allowed limit of ${maxSizeBytes} bytes.`
                )
              );
              return;
            }
            bodyBuffer += chunk.toString('utf8');
          });

          res.on('end', () => {
            clearTimeout(timeoutTimer);
            resolve({
              url: targetUrl,
              finalUrl: currentUrl,
              statusCode,
              headers,
              body: bodyBuffer,
              timingMs,
              bytesReceived,
              contentType: rawContentType,
              redirectChain
            });
          });

          res.on('error', (err) => {
            clearTimeout(timeoutTimer);
            reject(new SecureFetchError('NETWORK_ERROR', `Stream reading error: ${err.message}`));
          });
        });

        req.on('error', (err: any) => {
          clearTimeout(timeoutTimer);
          if (isTimedOut || err.code === 'FETCH_TIMEOUT') {
            reject(new SecureFetchError('FETCH_TIMEOUT', `Request timed out after ${timeoutMs}ms`));
          } else if (err instanceof SecureFetchError) {
            reject(err);
          } else {
            reject(new SecureFetchError('NETWORK_ERROR', `Connection failed: ${err.message}`));
          }
        });

        req.end();
      });

      const result = await fetchPromise;

      // If it was a redirect, re-validate the hop through full validator
      if ([301, 302, 303, 307, 308].includes(result.statusCode) && result.headers['location']) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new SecureFetchError(
            'TOO_MANY_REDIRECTS',
            `Exceeded maximum redirect limit of ${maxRedirects} hops.`
          );
        }
        currentUrl = result.finalUrl;
        continue;
      }

      return result;
    }

    throw new SecureFetchError('TOO_MANY_REDIRECTS', `Exceeded maximum redirect limit of ${maxRedirects} hops.`);
  }
}
