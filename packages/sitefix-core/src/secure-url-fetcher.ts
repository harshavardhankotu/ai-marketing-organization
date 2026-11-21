/**
 * Secure URL Fetcher with Strict OWASP SSRF Prevention & DNS Rebinding Defense
 * Pure Node.js implementation (zero DB or framework dependencies).
 */

import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { URL } from 'node:url';
import type { SecureFetchOptions, SecureFetchResult } from './types.js';

export type SecureFetchErrorCode =
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

export class SecureFetchError extends Error {
  public readonly code: SecureFetchErrorCode;
  public readonly statusCode?: number;

  constructor(code: SecureFetchErrorCode, message: string, statusCode?: number) {
    super(`${code}: ${message}`);
    this.name = 'SecureFetchError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, SecureFetchError.prototype);
  }
}

export class SecureUrlFetcher {
  public static readonly DEFAULT_TIMEOUT_MS = 5000; // Strict 5-second timeout
  public static readonly DEFAULT_MAX_REDIRECTS = 3;
  public static readonly DEFAULT_MAX_SIZE_BYTES = 512 * 1024; // 512 KB default (configurable up to 1 MB)
  public static readonly PUBLIC_SCAN_MAX_SIZE_BYTES = 1024 * 1024; // 1 MB body cap for public scan API
  public static readonly DEFAULT_USER_AGENT =
    'SiteFixAI-SecurityBot/1.0 (+https://ai-marketing-organization.onrender.com/tools/site-audit)';

  // Blocked IPv4 Subnets (CIDR)
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

  // Blocked IPv6 Subnets (CIDR)
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

  private readonly defaultFetchImpl?: typeof fetch;
  private readonly defaultSkipDnsForInjectedFetch: boolean;

  constructor(config?: { fetchImpl?: typeof fetch; skipDnsForInjectedFetch?: boolean }) {
    this.defaultFetchImpl = config?.fetchImpl;
    this.defaultSkipDnsForInjectedFetch = Boolean(config?.skipDnsForInjectedFetch);
  }

  public static ipv4ToLong(ip: string): number {
    return (
      ip
        .split('.')
        .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
    );
  }

  public static isIpv4InCidr(ip: string, cidr: string): boolean {
    const [range, bits] = cidr.split('/');
    const prefixLen = parseInt(bits, 10);
    const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
    return (SecureUrlFetcher.ipv4ToLong(ip) & mask) === (SecureUrlFetcher.ipv4ToLong(range) & mask);
  }

  public static ipv6ToBigInt(ip: string): bigint {
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
      if (ip.toLowerCase().startsWith('::ffff:')) {
        const suffix = ip.slice(7);
        if (suffix.includes('.')) {
          return SecureUrlFetcher.isIpBlocked(suffix);
        }
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
   * Enforces https: on standard port 443 only (or http:80 when allowHttpForTesting=true).
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

    if (parsed.protocol !== 'https:') {
      if (!allowHttpForTesting || parsed.protocol !== 'http:') {
        throw new SecureFetchError(
          'UNSUPPORTED_PROTOCOL',
          `Protocol '${parsed.protocol}' is forbidden. Only https: is permitted.`
        );
      }
    }

    if (parsed.username || parsed.password) {
      throw new SecureFetchError(
        'EMBEDDED_CREDENTIALS_REJECTED',
        'URLs with embedded user credentials (user:pass@) are strictly forbidden.'
      );
    }

    if (parsed.port) {
      const allowedPort = parsed.protocol === 'https:' ? '443' : '80';
      if (parsed.port !== allowedPort) {
        throw new SecureFetchError(
          'NON_STANDARD_PORT_REJECTED',
          `Port '${parsed.port}' is non-standard. Only standard port ${allowedPort} is permitted.`
        );
      }
    }

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

    const hostname = parsed.hostname.toLowerCase().trim();
    if (!hostname) {
      throw new SecureFetchError('BLOCKED_HOSTNAME', 'Hostname cannot be empty.');
    }

    if (net.isIP(hostname)) {
      throw new SecureFetchError(
        'BLOCKED_HOSTNAME',
        `Raw IP literal '${hostname}' is rejected. A valid public domain name is required.`
      );
    }

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
   * Returns the first validated safe public IP address.
   */
  public static async resolveAndValidateHost(hostname: string): Promise<string> {
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

    for (const record of records) {
      const check = SecureUrlFetcher.isIpBlocked(record.address);
      if (check.blocked) {
        throw new SecureFetchError(
          'SSRF_BLOCKED_IP',
          `Host '${hostname}' resolved to blocked IP ${record.address} (${check.reason}).`
        );
      }
    }

    return records[0].address;
  }

  /**
   * Executes a secure, SSRF-hardened fetch with DNS rebinding defense, redirect hop revalidation,
   * strict timeout, and streaming body byte cap.
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
    const injectedFetch = options.fetchImpl ?? this.defaultFetchImpl;
    const skipDnsForInjected = Boolean(
      injectedFetch && (options.skipDnsForInjectedFetch ?? this.defaultSkipDnsForInjectedFetch)
    );

    const redirectChain: string[] = [];
    let currentUrl = targetUrl;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const parsedUrl = SecureUrlFetcher.validateUrlStructure(currentUrl, options.allowHttpForTesting);
      redirectChain.push(parsedUrl.href);

      if (injectedFetch) {
        if (!skipDnsForInjected) {
          await SecureUrlFetcher.resolveAndValidateHost(parsedUrl.hostname);
        }

        const startTime = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response: Response;
        try {
          response = await injectedFetch(parsedUrl.href, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              'User-Agent': userAgent,
              'Accept': acceptTypes.join(', ') + ';q=0.9,*/*;q=0.1'
            }
          });
        } catch (err: any) {
          clearTimeout(timer);
          if (err?.name === 'AbortError') {
            throw new SecureFetchError('FETCH_TIMEOUT', `Request timed out after ${timeoutMs}ms`);
          }
          if (err instanceof SecureFetchError) throw err;
          throw new SecureFetchError('NETWORK_ERROR', `Connection failed: ${err?.message || String(err)}`);
        }

        const timingMs = Date.now() - startTime;
        const statusCode = response.status;
        const headers: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });

        if ([301, 302, 303, 307, 308].includes(statusCode) && headers['location']) {
          clearTimeout(timer);
          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new SecureFetchError(
              'TOO_MANY_REDIRECTS',
              `Exceeded maximum redirect limit of ${maxRedirects} hops.`
            );
          }
          currentUrl = new URL(headers['location'], currentUrl).href;
          continue;
        }

        const rawContentType = (headers['content-type'] || '').toLowerCase();
        const isAllowedType = acceptTypes.some(type => rawContentType.includes(type));
        if (!isAllowedType && statusCode === 200) {
          clearTimeout(timer);
          throw new SecureFetchError(
            'INVALID_CONTENT_TYPE',
            `Expected allowed content-type (${acceptTypes.join(', ')}), but server returned '${rawContentType}'.`,
            statusCode
          );
        }

        let bodyText = '';
        let bytesReceived = 0;
        try {
          if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                bytesReceived += value.byteLength;
                if (bytesReceived > maxSizeBytes) {
                  await reader.cancel().catch(() => {});
                  throw new SecureFetchError(
                    'PAYLOAD_TOO_LARGE',
                    `Response body exceeded maximum allowed limit of ${maxSizeBytes} bytes.`
                  );
                }
                bodyText += decoder.decode(value, { stream: true });
              }
            }
            bodyText += decoder.decode();
          } else {
            bodyText = await response.text();
            bytesReceived = Buffer.byteLength(bodyText, 'utf8');
            if (bytesReceived > maxSizeBytes) {
              throw new SecureFetchError(
                'PAYLOAD_TOO_LARGE',
                `Response body exceeded maximum allowed limit of ${maxSizeBytes} bytes.`
              );
            }
          }
        } catch (err: any) {
          clearTimeout(timer);
          if (err instanceof SecureFetchError) throw err;
          if (err?.name === 'AbortError') {
            throw new SecureFetchError('FETCH_TIMEOUT', `Request timed out after ${timeoutMs}ms`);
          }
          throw new SecureFetchError('NETWORK_ERROR', `Stream reading error: ${err?.message || String(err)}`);
        }

        clearTimeout(timer);
        return {
          url: targetUrl,
          finalUrl: currentUrl,
          statusCode,
          headers,
          body: bodyText,
          timingMs,
          bytesReceived,
          contentType: rawContentType,
          redirectChain
        };
      }

      // Native Node.js resolve-then-connect with pinned IP & TLS SNI (DNS rebinding defense)
      const resolvedIp = await SecureUrlFetcher.resolveAndValidateHost(parsedUrl.hostname);
      const startTime = Date.now();
      const isHttps = parsedUrl.protocol === 'https:';
      const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : isHttps ? 443 : 80;

      const fetchPromise = new Promise<SecureFetchResult>((resolve, reject) => {
        let isTimedOut = false;
        const timeoutTimer = setTimeout(() => {
          isTimedOut = true;
          req.destroy(new SecureFetchError('FETCH_TIMEOUT', `Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        const baseReqOptions = {
          protocol: parsedUrl.protocol,
          hostname: resolvedIp, // Connect strictly to pre-validated public IP
          port,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'Host': parsedUrl.hostname,
            'User-Agent': userAgent,
            'Accept': acceptTypes.join(', ') + ';q=0.9,*/*;q=0.1',
            'Accept-Encoding': 'identity',
            'Connection': 'close'
          }
        };

        const handleRes = (res: http.IncomingMessage) => {
          const timingMs = Date.now() - startTime;
          const statusCode = res.statusCode || 0;
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (v !== undefined) {
              headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
            }
          }

          if ([301, 302, 303, 307, 308].includes(statusCode) && headers['location']) {
            clearTimeout(timeoutTimer);
            res.resume();
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

          const rawContentType = (headers['content-type'] || '').toLowerCase();
          const isAllowedType = acceptTypes.some(type => rawContentType.includes(type));
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

          res.on('error', err => {
            clearTimeout(timeoutTimer);
            reject(new SecureFetchError('NETWORK_ERROR', `Stream reading error: ${err.message}`));
          });
        };

        const req = isHttps
          ? https.request({ ...baseReqOptions, servername: parsedUrl.hostname }, handleRes)
          : http.request(baseReqOptions, handleRes);

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
