import type { Context } from 'hono';
import { createHash } from 'crypto';

export interface TrustedClientIpInfo {
  ip: string;
  isUnknown: boolean;
  maxRequests: number;
}

/**
 * Computes a salted cryptographic hash of the client IP address (DPDP compliant).
 */
export function hashClientIp(rawIp: string): string {
  const salt = process.env.IP_HASH_SALT || 'aro_default_ip_salt_prelaunch';
  return createHash('sha256').update(`${(rawIp || 'unknown').trim()}:${salt}`).digest('hex');
}

/**
 * Converts an IPv4 string into an unsigned 32-bit integer.
 */
function ipToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (let i = 0; i < 4; i++) {
    const octet = parseInt(parts[i], 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    num = (num << 8) | octet;
  }
  return num >>> 0;
}

interface CidrRange {
  base: number;
  mask: number;
}

function parseCidr(cidr: string): CidrRange {
  const [ipStr, bitsStr] = cidr.split('/');
  const base = ipToLong(ipStr)!;
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

/**
 * Standard private / reserved IPv4 address ranges (RFC 1918, RFC 1122, RFC 3927).
 */
const PRIVATE_AND_RESERVED_CIDRS: string[] = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '169.254.0.0/16'
];

/**
 * Cloudflare published IPv4 address ranges (source: https://www.cloudflare.com/ips-v4, retrieved 2026-10-06).
 */
const CLOUDFLARE_PUBLISHED_IPV4_CIDRS: string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22'
];

const DROPPABLE_PROXY_RANGES: CidrRange[] = [
  ...PRIVATE_AND_RESERVED_CIDRS,
  ...CLOUDFLARE_PUBLISHED_IPV4_CIDRS
].map(parseCidr);

/**
 * Returns true if an IP is a private address or within Cloudflare's published edge ranges.
 */
export function isPrivateOrCloudflareIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();
  if (trimmed === 'unknown' || trimmed === '127.0.0.1' || trimmed === '::1' || trimmed === 'localhost') {
    return true;
  }
  const num = ipToLong(trimmed);
  if (num === null) {
    return trimmed.startsWith('10.') || trimmed.startsWith('192.168.') || trimmed.startsWith('172.');
  }
  return DROPPABLE_PROXY_RANGES.some(r => ((num & r.mask) >>> 0) === r.base);
}

/**
 * Derives trusted client IP behind Cloudflare and Render reverse proxies.
 *
 * Trailing Proxy Dropping Semantics:
 * - When an HTTP request passes through Cloudflare and Render's reverse proxy tiers,
 *   the proxies append their observed egress / gateway IPs to the right-hand end of X-Forwarded-For:
 *     X-Forwarded-For: <client_untrusted_left>, ..., <client_real>, <cloudflare_proxy>, <render_proxy>
 * - We take the XFF list, drop trailing entries that are private/reserved addresses
 *   (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8) and Cloudflare published IP ranges,
 *   then select the rightmost remaining entry.
 * - This makes client IP derivation robust to hop count changes across reverse proxies.
 * - cf-connecting-ip is ignored unless process.env.TRUST_CF_HEADER === 'true' (default: false).
 * - If only private/proxy IPs remain or header is missing, maps to 'unknown' with stricter limit.
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
    // Drop trailing entries that are private/reserved addresses or Cloudflare published ranges
    while (parts.length > 0 && isPrivateOrCloudflareIp(parts[parts.length - 1])) {
      parts.pop();
    }
    if (parts.length > 0) {
      // Use the rightmost remaining entry
      candidateIp = parts[parts.length - 1];
    }
  }

  const isUnknown = !candidateIp || candidateIp.toLowerCase() === 'unknown' || isPrivateOrCloudflareIp(candidateIp);
  const ip = isUnknown ? 'unknown' : candidateIp;
  const maxRequests = isUnknown ? unknownLimit : standardLimit;

  return { ip, isUnknown, maxRequests };
}
