import type { Context } from 'hono';

export interface TrustedClientIpInfo {
  ip: string;
  isUnknown: boolean;
  maxRequests: number;
}

/**
 * Derives trusted client IP behind Render's reverse proxy.
 *
 * Proxy Header Semantics:
 * - When an HTTP request passes through a reverse proxy (e.g. Render's load balancer/Envoy),
 *   the proxy appends the client IP it observed to the right-hand end of the X-Forwarded-For header:
 *     X-Forwarded-For: <client_untrusted_left>, ..., <appended_by_proxy_right>
 * - In Render's architecture, Render's edge terminates TLS and appends the connecting client IP.
 *   The exact internal proxy tier depth beyond the outer ingress is labeled UNKNOWN in official docs.
 * - Therefore, we take the entry appended by the platform proxy (rightmost, configurable via
 *   TRUSTED_PROXY_HOPS, default 1) and ignore all client-controlled entries to its left.
 * - cf-connecting-ip is ignored unless process.env.TRUST_CF_HEADER === 'true'.
 *
 * Fallback Policy:
 * - If X-Forwarded-For is missing or resolves to local (127.0.0.1)/empty, requests map to a
 *   single 'unknown' bucket with a stricter rate limit (unknownLimit, default 5 requests per window).
 */
export function getTrustedClientIp(
  c: Context,
  standardLimit = 10,
  unknownLimit = 5
): TrustedClientIpInfo {
  const trustCf = process.env.TRUST_CF_HEADER === 'true';
  const cfIp = c.req.header('cf-connecting-ip');

  if (trustCf && cfIp && cfIp.trim()) {
    const ip = cfIp.trim();
    const isUnknown = !ip || ip === '127.0.0.1' || ip.toLowerCase() === 'unknown';
    return {
      ip: isUnknown ? 'unknown' : ip,
      isUnknown,
      maxRequests: isUnknown ? unknownLimit : standardLimit
    };
  }

  const xff = c.req.header('x-forwarded-for');
  let candidateIp = '';

  if (xff) {
    const parts = xff.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const hops = parseInt(process.env.TRUSTED_PROXY_HOPS || '1', 10);
      const targetIndex = parts.length - hops;
      if (targetIndex >= 0 && targetIndex < parts.length) {
        candidateIp = parts[targetIndex];
      } else {
        candidateIp = parts[parts.length - 1];
      }
    }
  }

  const isUnknown = !candidateIp || candidateIp === '127.0.0.1' || candidateIp.toLowerCase() === 'unknown';
  const ip = isUnknown ? 'unknown' : candidateIp;
  const maxRequests = isUnknown ? unknownLimit : standardLimit;

  return { ip, isUnknown, maxRequests };
}
