/**
 * public-tenant-guard.ts
 *
 * Enforces privacy and public boundaries:
 * 1. Blocks demo businesses (smilekraft-dental-clinic, smilekraft-dental-clinic-2, platform-aro)
 *    from every /api/v1/public/* route.
 * 2. Enforces public_live = 1 on all public endpoints (business lookup, funnels, leads, checkout, booking, availability).
 */

export const DEMO_BUSINESS_IDENTIFIERS = new Set([
  'smilekraft-dental-clinic',
  'smilekraft-dental-clinic-2',
  'platform-aro',
  'biz_smilekraft_hyd',
  'biz_1790714233800',
  'biz_platform_aro'
]);

export function isDemoBusiness(identifier?: string | null): boolean {
  if (!identifier) return false;
  return DEMO_BUSINESS_IDENTIFIERS.has(identifier.trim().toLowerCase());
}

export function isPublicLiveBusiness(biz: {
  id?: string;
  public_slug?: string;
  public_live?: number | boolean;
} | null | undefined): boolean {
  if (!biz) return false;
  if (isDemoBusiness(biz.id) || isDemoBusiness(biz.public_slug)) {
    return false;
  }
  return Number(biz.public_live) === 1 || biz.public_live === true;
}
