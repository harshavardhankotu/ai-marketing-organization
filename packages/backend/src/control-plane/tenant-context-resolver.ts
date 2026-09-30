import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';

export interface TenantContext {
  businessId: string;
  organizationId: string;
  name: string;
  publicSlug: string;
  verticalId: string;
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  city: string;
  autonomyMode: string;
  killSwitchActive: boolean;
}

export interface ResolveTenantOptions {
  businessId?: string;
  businessSlug?: string;
  organizationId?: string;
  funnelSlug?: string;
  allowDevFallback?: boolean;
}

export class TenantContextResolver {
  private static instance: TenantContextResolver;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): TenantContextResolver {
    if (!TenantContextResolver.instance) {
      TenantContextResolver.instance = new TenantContextResolver();
    }
    return TenantContextResolver.instance;
  }

  /**
   * Resolves authoritative business tenant context without guessing or illegal fallbacks.
   * In production:
   * - Queries Cloudflare D1 first/authoritatively.
   * - Rejects missing tenants with null or errors (never falls back to LIMIT 1 or hardcoded IDs).
   * - Enforces organization boundary if organizationId is also provided.
   */
  public async resolveTenant(options: ResolveTenantOptions): Promise<TenantContext | null> {
    const { businessId, businessSlug, organizationId, funnelSlug } = options;

    let bizRow: any = null;

    if (businessSlug) {
      const cleanSlug = businessSlug.trim().toLowerCase();
      bizRow = await this.d1Repo.queryOne<any>(
        'businesses',
        `SELECT * FROM businesses WHERE lower(public_slug) = ? LIMIT 1`,
        [cleanSlug]
      );
    } else if (businessId) {
      const cleanId = businessId.trim();
      bizRow = await this.d1Repo.queryOne<any>(
        'businesses',
        `SELECT * FROM businesses WHERE id = ? LIMIT 1`,
        [cleanId]
      );
    } else if (funnelSlug) {
      // Look up business through funnel
      const funnel = await this.d1Repo.queryOne<any>(
        'funnels',
        `SELECT business_id, organization_id FROM funnels WHERE lower(public_slug) = ? AND status = 'ACTIVE' LIMIT 1`,
        [funnelSlug.trim().toLowerCase()]
      );
      if (funnel) {
        bizRow = await this.d1Repo.queryOne<any>(
          'businesses',
          `SELECT * FROM businesses WHERE id = ? LIMIT 1`,
          [funnel.business_id]
        );
      }
    }

    // In non-production tests or dev only, if D1 had no results, allow SQLite check
    if (!bizRow && (!isProduction() || process.env.VITEST)) {
      try {
        const db = getDb();
        if (businessSlug) {
          bizRow = db.prepare('SELECT * FROM businesses WHERE lower(public_slug) = ? LIMIT 1').get(businessSlug.trim().toLowerCase());
        } else if (businessId) {
          bizRow = db.prepare('SELECT * FROM businesses WHERE id = ? LIMIT 1').get(businessId.trim());
        } else if (funnelSlug) {
          const funnel = db.prepare(`SELECT business_id FROM funnels WHERE lower(public_slug) = ? AND status = 'ACTIVE' LIMIT 1`).get(funnelSlug.trim().toLowerCase()) as any;
          if (funnel) {
            bizRow = db.prepare('SELECT * FROM businesses WHERE id = ? LIMIT 1').get(funnel.business_id);
          }
        } else if (options.allowDevFallback) {
          bizRow = db.prepare('SELECT * FROM businesses LIMIT 1').get();
        }
      } catch {}
    }

    if (!bizRow) {
      return null;
    }

    // Tenant Isolation Enforcement: if organizationId was explicitly provided, verify match
    if (organizationId && bizRow.organization_id !== organizationId) {
      throw new Error(
        `TENANT_SECURITY_VIOLATION: Organization mismatch. Target business '${bizRow.id}' belongs to organization '${bizRow.organization_id}', but caller provided '${organizationId}'.`
      );
    }

    return {
      businessId: bizRow.id,
      organizationId: bizRow.organization_id,
      name: bizRow.name,
      publicSlug: bizRow.public_slug,
      verticalId: bizRow.vertical_id,
      country: bizRow.country || 'US',
      currency: bizRow.currency || 'USD',
      timezone: bizRow.timezone || 'UTC',
      locale: bizRow.locale || 'en-US',
      city: bizRow.city || '',
      autonomyMode: bizRow.autonomy_mode || 'AUTONOMOUS',
      killSwitchActive: Boolean(bizRow.kill_switch_active)
    };
  }
}
