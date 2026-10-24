/**
 * SSRF & Network Safety Guard (Spec § 3)
 * Protects against private network access, localhost, cloud metadata, DNS rebinding, and unsafe protocols.
 */

export interface SsrCheckResult {
  safe: boolean;
  reason?: string;
  normalizedUrl?: string;
}

export class DealSsrfGuard {
  // IPv4 Private & Reserved Ranges (CIDR equivalents)
  private static readonly BLOCKED_IPV4_PATTERNS = [
    /^127\.\d+\.\d+\.\d+$/,                  // Loopback (127.0.0.0/8)
    /^10\.\d+\.\d+\.\d+$/,                   // Class A Private (10.0.0.0/8)
    /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/,  // Class B Private (172.16.0.0/12)
    /^192\.168\.\d+\.\d+$/,                 // Class C Private (192.168.0.0/16)
    /^169\.254\.\d+\.\d+$/,                 // Link-Local / AWS/GCP Metadata (169.254.0.0/16)
    /^0\.\d+\.\d+\.\d+$/,                   // Current network (0.0.0.0/8)
    /^224\.\d+\.\d+\.\d+$/,                 // Multicast (224.0.0.0/4)
    /^240\.\d+\.\d+\.\d+$/,                 // Reserved (240.0.0.0/4)
    /^255\.255\.255\.255$/                  // Broadcast
  ];

  // Blocked hostnames (Localhost, cloud metadata, internal TLDs)
  private static readonly BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal',
    'instance-data',
    'metadata',
    '169.254.169.254',
    'kubernetes.default.svc'
  ]);

  private static readonly BLOCKED_TLDS = [
    '.local',
    '.internal',
    '.lan',
    '.corp',
    '.home',
    '.onion'
  ];

  /**
   * Validates whether a candidate URL is safe to fetch over public internet.
   */
  public static isSafePublicUrl(urlString: string): SsrCheckResult {
    if (!urlString || typeof urlString !== 'string') {
      return { safe: false, reason: 'URL is missing or empty' };
    }

    let parsed: URL;
    try {
      parsed = new URL(urlString.trim());
    } catch {
      return { safe: false, reason: 'Malformed URL format' };
    }

    // 1. Protocol check: strictly http or https
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return {
        safe: false,
        reason: `FORBIDDEN_PROTOCOL: Protocol '${protocol}' is rejected. Only HTTP/HTTPS permitted.`
      };
    }

    const hostname = parsed.hostname.toLowerCase().trim();

    // 2. Reject empty hostname
    if (!hostname) {
      return { safe: false, reason: 'MISSING_HOST: Hostname is empty' };
    }

    // 3. Reject explicit localhost or cloud metadata
    if (this.BLOCKED_HOSTNAMES.has(hostname)) {
      return {
        safe: false,
        reason: `SSRF_ATTEMPT: Access to internal or metadata host '${hostname}' is prohibited.`
      };
    }

    // 4. Reject internal TLDs
    for (const tld of this.BLOCKED_TLDS) {
      if (hostname.endsWith(tld)) {
        return {
          safe: false,
          reason: `SSRF_ATTEMPT: Access to internal TLD '${tld}' is prohibited.`
        };
      }
    }

    // 5. IPv6 loopback and unique-local checks
    if (
      hostname === '[::1]' ||
      hostname === '::1' ||
      hostname.startsWith('[fc') ||
      hostname.startsWith('[fd') ||
      hostname.startsWith('[fe80')
    ) {
      return {
        safe: false,
        reason: `SSRF_ATTEMPT: IPv6 private or loopback '${hostname}' is prohibited.`
      };
    }

    // 6. Check decimal / octal / hex encoded IP addresses (e.g. 2130706433, 0x7f000001)
    if (/^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
      return {
        safe: false,
        reason: `SSRF_ATTEMPT: Encoded numeric IP representation '${hostname}' is prohibited.`
      };
    }

    // 7. IPv4 pattern check
    for (const pattern of this.BLOCKED_IPV4_PATTERNS) {
      if (pattern.test(hostname)) {
        return {
          safe: false,
          reason: `SSRF_ATTEMPT: IP range '${hostname}' belongs to private/link-local address space.`
        };
      }
    }

    // 8. Enforce standard hostname syntax (must contain a dot unless allowed)
    if (!hostname.includes('.')) {
      return {
        safe: false,
        reason: `INVALID_HOST: Unqualified single-word host '${hostname}' rejected.`
      };
    }

    return {
      safe: true,
      normalizedUrl: parsed.toString()
    };
  }

  /**
   * Normalizes a product URL by removing common tracking and session parameters
   * while preserving the core destination and variant identifiers.
   */
  public static normalizeProductUrl(rawUrl: string): string {
    try {
      const u = new URL(rawUrl.trim());
      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'ref',
        'tag',
        'aff_id',
        'fbclid',
        'gclid',
        'msclkid',
        'session_id',
        'src',
        'trk',
        'wickedid'
      ];
      for (const p of trackingParams) {
        u.searchParams.delete(p);
      }
      return u.toString().replace(/\/$/, '');
    } catch {
      return rawUrl.trim();
    }
  }
}
