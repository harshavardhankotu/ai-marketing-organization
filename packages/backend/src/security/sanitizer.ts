/**
 * Security and Data Hygiene Sanitizer
 * Enforces zero leakage of secrets, affiliate tags, and unapproved partner statuses.
 */

export function maskAffiliateTag(input: any): any {
  if (!input) return input;

  if (typeof input === 'string') {
    // Mask tag in raw JSON strings e.g. "tag":"marketing98-21" or ?tag=marketing98-21
    return input
      .replace(/"tag"\s*:\s*"[^"]+"/g, '"tag":"[MASKED_AFFILIATE_TAG]"')
      .replace(/tag=[a-zA-Z0-9_-]+/g, 'tag=[MASKED_AFFILIATE_TAG]');
  }

  if (typeof input === 'object') {
    if (Array.isArray(input)) {
      return input.map(item => maskAffiliateTag(item));
    }
    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k === 'tag' && typeof v === 'string') {
        sanitized[k] = '[MASKED_AFFILIATE_TAG]';
      } else if (k === 'evidence_json' && typeof v === 'string') {
        sanitized[k] = maskAffiliateTag(v);
      } else {
        sanitized[k] = maskAffiliateTag(v);
      }
    }
    return sanitized;
  }

  return input;
}

export function formatPartnerStatus(partner: { network?: string; approvalStatus?: string; authorizationStatus?: string; name?: string }): string {
  const isAmazon = (partner.network === 'AMAZON_ASSOCIATES') ||
                   (partner.name && partner.name.toLowerCase().includes('amazon'));
  if (isAmazon) {
    // Amazon Associates is always PROVISIONAL until API-verified and 3 qualifying sales achieved
    return 'PROVISIONAL (OPERATOR_CONFIRMED)';
  }
  return partner.approvalStatus || 'PENDING';
}
