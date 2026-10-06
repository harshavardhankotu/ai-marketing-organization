import type { Context } from 'hono';

export interface TrustedClientIpInfo {
  ip: string;
  isUnknown: boolean;
  maxRequests: number;
}

/**
 * Derives trusted client IP behind Render's reverse proxy.
 *
 * Render Proxy Headers (Render Docs: Reverse Proxy Architecture):
 * - x-forwarded-for: Comma-separated list containing client IP and intermediate proxies.
 * - x-forwarded-proto: 'http' or 'https'
 * - x-forwarded-port: Connecting port ('80' or '443')
 *
 * UNTRUSTED Headers:
 * - cf-connecting-ip: Render does NOT set this header for standard *.onrender.com deployments.
 *   Any cf-connecting-ip sent by a client is untrusted and MUST NOT be used for rate limiting.
 *
 * Fallback Policy:
 * - If x-forwarded-for is missing, empty, or local (127.0.0.1), requests fall into a single
 *   'unknown' bucket with a stricter rate limit (unknownLimit, default 5 requests per window).
 */
export function getTrustedClientIp(
  c: Context,
  standardLimit = 10,
  unknownLimit = 5
): TrustedClientIpInfo {
  const xff = c.req.header('x-forwarded-for');
  let candidateIp = '';

  if (xff) {
    const parts = xff.split(',');
    if (parts.length > 0 && parts[0].trim()) {
      candidateIp = parts[0].trim();
    }
  }

  const isUnknown = !candidateIp || candidateIp === '127.0.0.1' || candidateIp.toLowerCase() === 'unknown';
  const ip = isUnknown ? 'unknown' : candidateIp;
  const maxRequests = isUnknown ? unknownLimit : standardLimit;

  return { ip, isUnknown, maxRequests };
}
