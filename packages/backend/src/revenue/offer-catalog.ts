/**
 * OfferCatalogService — Authoritative server-side offer resolution and platform commercial catalog.
 *
 * Implements Spec § 4 & § 5:
 * - Server-side authoritative pricing: Never trust amountINR submitted from browser.
 * - Single source of truth:
 *     resolveAuthorizedOffer(offer_id, business_id, organization_id)
 *     returns exact server-side price, currency, billing model, and ownership.
 * - Manages canonical platform offers for 'biz_platform_aro':
 *     - PLATFORM_SETUP: ₹15,000 (ONE_TIME)
 *     - PLATFORM_MONTHLY: ₹8,000 (MONTHLY)
 * - Resolves client business offers for local services/clinics.
 */

import { getDb } from '../db/client.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { DirectCommercialOfferPage } from './direct-offer-page.js';
import { isProduction } from '../config/env.js';

export interface AuthorizedOffer {
  offerId: string;
  offerName: string;
  description: string;
  deliverables: string[];
  priceINR: number;
  billingModel: 'ONE_TIME' | 'MONTHLY';
  currency: string;
  businessId: string;
  organizationId: string;
  active: boolean;
  deliveryTimeDays: number;
  qualificationRequirements: string[];
  paymentProvider: string;
  paymentConfiguration: Record<string, unknown>;
}

export class OfferCatalogService {
  private static instance: OfferCatalogService;

  public static readonly PLATFORM_SETUP_OFFER_ID = 'PLATFORM_SETUP';
  public static readonly PLATFORM_MONTHLY_OFFER_ID = 'PLATFORM_MONTHLY';
  public static readonly SITEFIX_AI_PACK_OFFER_ID = 'SITEFIX_AI_PACK_V1';
  public static readonly HEALTHCARE_SETUP_OFFER_ID = 'HEALTHCARE_SETUP';
  public static readonly HEALTHCARE_RETAINER_OFFER_ID = 'HEALTHCARE_RETAINER';
  public static readonly EDUCATION_SETUP_OFFER_ID = 'EDUCATION_SETUP';
  public static readonly EDUCATION_RETAINER_OFFER_ID = 'EDUCATION_RETAINER';

  private constructor() {
    this.ensurePlatformOffers();
  }

  public static getInstance(): OfferCatalogService {
    if (!OfferCatalogService.instance) {
      OfferCatalogService.instance = new OfferCatalogService();
    }
    return OfferCatalogService.instance;
  }

  /**
   * Seeds the authoritative platform offers for the owner organization.
   */
  public ensurePlatformOffers(): void {
    const db = getDb();
    const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
    const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;

    // Ensure platform org and biz exist
    try {
      db.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug)
        VALUES (?, 'Primary Commercial Organization', 'primary-owner-org')
      `).run(orgId);

      db.prepare(`
        INSERT OR IGNORE INTO businesses (
          id, organization_id, name, vertical_id, vertical_name, risk_tier,
          country, currency, timezone, city, neighborhood, brand_voice
        ) VALUES (?, ?, 'AI Marketing Organization', 'AI_SERVICES', 'Marketing Automation', 'LOW', 'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'HITEC City', 'Authoritative & Outcome-Driven')
      `).run(bizId, orgId);
    } catch {}

    const canonicalOffers = [
      {
        id: OfferCatalogService.SITEFIX_AI_PACK_OFFER_ID,
        name: 'SiteFix AI — Website Audit & Optimization Fix-Pack',
        description: 'Deterministic pre-deployment website QA audit, copy-paste HTML/Schema/robots/sitemap fix-pack, and included verification recheck.',
        deliverables: [
          'Diagnostic Technical Site Audit Report',
          'Search Engine & Social Media <head> Snippets',
          'Verified Schema.org Structured Data',
          'Included Post-Fix Verification Recheck'
        ],
        priceINR: 499,
        billingModel: 'ONE_TIME' as const,
        deliveryTimeDays: 0,
        qualificationRequirements: ['Public website URL']
      },
      {
        id: OfferCatalogService.PLATFORM_SETUP_OFFER_ID,
        name: 'AI Inbound Lead Conversion System — Day 0-5 Setup & Integration',
        description: 'Complete setup, CRM & workflow integration, qualification rules, and lead conversion activation.',
        deliverables: [
          'Custom inquiry triage and FAQ workflow',
          'Instant web & profile lead capture',
          'Multi-touch follow-up workflow',
          'Direct calendar booking integration',
          'Live system handover report'
        ],
        priceINR: 15000,
        billingModel: 'ONE_TIME' as const,
        deliveryTimeDays: 5,
        qualificationRequirements: ['Active business website or messaging channel']
      },
      {
        id: OfferCatalogService.PLATFORM_MONTHLY_OFFER_ID,
        name: 'AI Inbound Lead Conversion System — Monthly Retainer & SLA',
        description: 'Continuous optimization, automated follow-up sequences, reminder workflows, and monthly conversion analytics.',
        deliverables: [
          'Automated lead response workflow tuning',
          'Ongoing prompt & qualification rubric tuning',
          'Weekly conversion reporting',
          'Continuous DPDP compliance monitoring'
        ],
        priceINR: 8000,
        billingModel: 'MONTHLY' as const,
        deliveryTimeDays: 30,
        qualificationRequirements: ['Active platform setup completed']
      }
    ];

    // Quarantine any previously seeded legacy healthcare/education offers in SQLite
    try {
      db.prepare(`
        UPDATE offers
        SET status = 'ARCHIVED', updated_at = datetime('now')
        WHERE id IN ('HEALTHCARE_SETUP', 'HEALTHCARE_RETAINER', 'EDUCATION_SETUP', 'EDUCATION_RETAINER', 'CONSULTATION_DEPOSIT')
          AND status = 'ACTIVE'
      `).run();
    } catch {}

    for (const off of canonicalOffers) {
      try {
        const existing = db.prepare('SELECT id FROM offers WHERE id = ?').get(off.id);
        if (!existing) {
          db.prepare(`
            INSERT INTO offers (
              id, business_id, organization_id, offer_name, offer_type,
              problem, solution, deliverables_json, price_inr, pricing_model,
              expected_customer_value_inr, delivery_time_days, guarantee_or_terms,
              sales_message, qualification_questions_json, payment_method, status,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'APPOINTMENT_CONVERSION_SYSTEM', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RAZORPAY', 'ACTIVE', datetime('now'), datetime('now'))
          `).run(
            off.id,
            bizId,
            orgId,
            off.name,
            off.description,
            off.description,
            JSON.stringify(off.deliverables),
            off.priceINR,
            off.billingModel,
            off.priceINR * 5,
            off.deliveryTimeDays,
            off.id === OfferCatalogService.PLATFORM_SETUP_OFFER_ID
              ? '100% money back if not live within 5 days'
              : 'Cancel anytime prior to next billing date. Prorated refunds on request.',
            off.description,
            JSON.stringify(off.qualificationRequirements)
          );
        }
      } catch (err: any) {
        // Safe if table doesn't exist yet or constraint met
      }
    }
  }

  /**
   * Authoritative server-side resolution:
   * Maps an offer ID and tenant scope to an immutable, authorized price and billing structure.
   */
  public resolveAuthorizedOffer(
    offerId: string,
    businessId?: string,
    organizationId?: string
  ): AuthorizedOffer {
    if (!offerId || typeof offerId !== 'string') {
      throw new Error('INVALID_OFFER_REQUEST: offer_id is required for server-side pricing resolution.');
    }

    const trimmedOfferId = offerId.trim();
    const db = getDb();

    // Check platform offers first
    if (
      trimmedOfferId === OfferCatalogService.SITEFIX_AI_PACK_OFFER_ID ||
      trimmedOfferId === 'SITEFIX_AI_PACK_V1' ||
      trimmedOfferId === 'SITE_AUDIT_FIXPACK' ||
      trimmedOfferId === 'sitefix_core_499' ||
      trimmedOfferId === 'offer_sitefix_pack'
    ) {
      return {
        offerId: OfferCatalogService.SITEFIX_AI_PACK_OFFER_ID,
        offerName: 'SiteFix AI — Website Audit & Optimization Pack',
        description: 'Instant technical diagnostic audit and optimization deliverable fix-pack.',
        deliverables: [
          'Diagnostic Technical Site Audit Report',
          'Search Engine & Social Media <head> Snippets',
          'Verified Schema.org Structured Data',
          'Implementation Checklist & Guidance'
        ],
        priceINR: 499,
        billingModel: 'ONE_TIME',
        currency: 'INR',
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        active: true,
        deliveryTimeDays: 0,
        qualificationRequirements: ['Public website URL'],
        paymentProvider: 'RAZORPAY',
        paymentConfiguration: {}
      };
    }

    if (trimmedOfferId === OfferCatalogService.PLATFORM_SETUP_OFFER_ID || trimmedOfferId === 'PLATFORM_SETUP' || trimmedOfferId === 'offer_platform_setup') {
      // Scope enforcement: platform offers are ONLY valid for the platform business/org
      if (businessId && businessId !== OwnerAuthService.PLATFORM_BUSINESS_ID) {
        throw new Error(`UNAUTHORIZED_OFFER: PLATFORM_SETUP offer is restricted to the platform business (${OwnerAuthService.PLATFORM_BUSINESS_ID}). Caller supplied businessId='${businessId}'.`);
      }
      if (organizationId && organizationId !== OwnerAuthService.OWNER_ORGANIZATION_ID) {
        throw new Error(`UNAUTHORIZED_OFFER: PLATFORM_SETUP offer is restricted to the owner organization (${OwnerAuthService.OWNER_ORGANIZATION_ID}). Caller supplied organizationId='${organizationId}'.`);
      }
      // Gate: In production (or strict test mode), direct commercial terms must be explicitly attested by owner
      if ((isProduction() || process.env.STRICT_DIRECT_OFFER_ATTESTATION === 'true') && !DirectCommercialOfferPage.isDirectOfferAttested()) {
        throw new Error(`COMMERCIAL_TERMS_UNATTESTED: Platform direct offer (${trimmedOfferId}) terms have not been attested by the owner. Commercial payment flows are blocked in production.`);
      }
      return {
        offerId: OfferCatalogService.PLATFORM_SETUP_OFFER_ID,
        offerName: 'AI Inbound Lead Conversion System — Day 0-5 Setup & Integration',
        description: 'Complete setup, CRM & WhatsApp integration, qualification rules, and 24/7 lead conversion activation.',
        deliverables: [
          'Custom WhatsApp triage and FAQ response bot',
          'Google Business Profile instant lead capture',
          'Multi-touch follow-up workflow',
          'Direct calendar booking integration',
          'Live system handover report'
        ],
        priceINR: 15000,
        billingModel: 'ONE_TIME',
        currency: 'INR',
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        active: true,
        deliveryTimeDays: 5,
        qualificationRequirements: ['Active WhatsApp Business number', 'Claimed Google Business Profile'],
        paymentProvider: 'RAZORPAY',
        paymentConfiguration: {}
      };
    }

    if (trimmedOfferId === OfferCatalogService.PLATFORM_MONTHLY_OFFER_ID || trimmedOfferId === 'PLATFORM_MONTHLY' || trimmedOfferId === 'offer_platform_monthly') {
      // Scope enforcement: platform offers are ONLY valid for the platform business/org
      if (businessId && businessId !== OwnerAuthService.PLATFORM_BUSINESS_ID) {
        throw new Error(`UNAUTHORIZED_OFFER: PLATFORM_MONTHLY offer is restricted to the platform business (${OwnerAuthService.PLATFORM_BUSINESS_ID}). Caller supplied businessId='${businessId}'.`);
      }
      if (organizationId && organizationId !== OwnerAuthService.OWNER_ORGANIZATION_ID) {
        throw new Error(`UNAUTHORIZED_OFFER: PLATFORM_MONTHLY offer is restricted to the owner organization (${OwnerAuthService.OWNER_ORGANIZATION_ID}). Caller supplied organizationId='${organizationId}'.`);
      }
      // Gate: In production (or strict test mode), direct commercial terms must be explicitly attested by owner
      if ((isProduction() || process.env.STRICT_DIRECT_OFFER_ATTESTATION === 'true') && !DirectCommercialOfferPage.isDirectOfferAttested()) {
        throw new Error(`COMMERCIAL_TERMS_UNATTESTED: Platform direct offer (${trimmedOfferId}) terms have not been attested by the owner. Commercial payment flows are blocked in production.`);
      }
      return {
        offerId: OfferCatalogService.PLATFORM_MONTHLY_OFFER_ID,
        offerName: 'AI Inbound Lead Conversion System — Monthly Retainer & SLA',
        description: 'Continuous AI triage optimization, automated follow-up sequences, appointment reminder workflows, and monthly conversion analytics.',
        deliverables: [
          '24/7 automated lead response under 2 minutes',
          'Ongoing prompt & qualification rubric tuning',
          'Weekly appointment show-rate reporting',
          'Continuous DPDP compliance monitoring'
        ],
        priceINR: 8000,
        billingModel: 'MONTHLY',
        currency: 'INR',
        businessId: OwnerAuthService.PLATFORM_BUSINESS_ID,
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        active: true,
        deliveryTimeDays: 30,
        qualificationRequirements: ['Active platform setup completed'],
        paymentProvider: 'RAZORPAY',
        paymentConfiguration: {}
      };
    }

    // Standing Order #8 / SiteFix Launch Gate: Legacy healthcare & education offers are quarantined from active storefront checkout
    if (
      trimmedOfferId === OfferCatalogService.HEALTHCARE_SETUP_OFFER_ID ||
      trimmedOfferId === 'HEALTHCARE_SETUP' ||
      trimmedOfferId === OfferCatalogService.HEALTHCARE_RETAINER_OFFER_ID ||
      trimmedOfferId === 'HEALTHCARE_RETAINER' ||
      trimmedOfferId === OfferCatalogService.EDUCATION_SETUP_OFFER_ID ||
      trimmedOfferId === 'EDUCATION_SETUP' ||
      trimmedOfferId === OfferCatalogService.EDUCATION_RETAINER_OFFER_ID ||
      trimmedOfferId === 'EDUCATION_RETAINER'
    ) {
      throw new Error(
        `QUARANTINED_LEGACY_OFFER: Offer '${trimmedOfferId}' is quarantined and disabled for active storefront checkout. Use canonical '${OfferCatalogService.SITEFIX_AI_PACK_OFFER_ID}'.`
      );
    }

    // Lookup in customer_offers (Universal Commercial OS first-class offers: coff_*)
    // This bridges UniversalFunnel (OfferDecisionEngine) pricing with Razorpay checkout.
    try {
      const custRow: any = db.prepare('SELECT * FROM customer_offers WHERE id = ?').get(trimmedOfferId);
      if (custRow) {
        if (Number(custRow.active) !== 1) {
          throw new Error(`UNAUTHORIZED_OFFER: Offer '${trimmedOfferId}' is inactive or archived.`);
        }
        if (businessId && custRow.business_id && custRow.business_id !== businessId) {
          throw new Error(`UNAUTHORIZED_OFFER: Offer '${trimmedOfferId}' does not belong to business '${businessId}'.`);
        }
        const custCurrency = (custRow.currency || 'INR').toUpperCase();
        const priceMinor = Number(custRow.price_minor || 0);
        // Convert minor units to major for legacy priceINR field using currency decimals
        const decimals = custCurrency === 'JPY' || custCurrency === 'KRW' ? 0 : (custCurrency === 'KWD' || custCurrency === 'BHD' || custCurrency === 'OMR' ? 3 : 2);
        const priceMajor = priceMinor / Math.pow(10, decimals);
        let custDeliverables: string[] = [];
        try { custDeliverables = JSON.parse(custRow.deliverables_json || '[]'); } catch {}
        return {
          offerId: custRow.id,
          offerName: custRow.title,
          description: custRow.description || custRow.title,
          deliverables: custDeliverables,
          priceINR: priceMajor,
          billingModel: custRow.billing_model === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME',
          currency: custCurrency,
          businessId: custRow.business_id,
          organizationId: custRow.organization_id,
          active: true,
          deliveryTimeDays: 5,
          qualificationRequirements: [],
          paymentProvider: custCurrency === 'INR' ? 'RAZORPAY' : 'STRIPE',
          paymentConfiguration: {}
        };
      }
    } catch (e: any) {
      if (e?.message?.startsWith('UNAUTHORIZED_OFFER')) throw e;
      // table may not exist in older sqlite — fall through
    }

    // Lookup in database offers table
    let offerRow: any = null;
    try {
      offerRow = db.prepare('SELECT * FROM offers WHERE id = ?').get(trimmedOfferId);
    } catch {}

    if (offerRow) {
      if (offerRow.status !== 'ACTIVE') {
        throw new Error(`UNAUTHORIZED_OFFER: Offer '${trimmedOfferId}' is inactive or archived.`);
      }

      if (businessId && offerRow.business_id && offerRow.business_id !== businessId) {
        throw new Error(`UNAUTHORIZED_OFFER: Offer '${trimmedOfferId}' does not belong to business '${businessId}'.`);
      }

      let deliverables: string[] = [];
      try { deliverables = JSON.parse(offerRow.deliverables_json || '[]'); } catch {}

      let qualificationRequirements: string[] = [];
      try { qualificationRequirements = JSON.parse(offerRow.qualification_questions_json || '[]'); } catch {}

      return {
        offerId: offerRow.id,
        offerName: offerRow.offer_name,
        description: offerRow.problem || offerRow.solution || offerRow.offer_name,
        deliverables,
        priceINR: offerRow.price_inr,
        billingModel: offerRow.pricing_model === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME',
        currency: 'INR',
        businessId: offerRow.business_id,
        organizationId: offerRow.organization_id,
        active: true,
        deliveryTimeDays: offerRow.delivery_time_days || 5,
        qualificationRequirements,
        paymentProvider: offerRow.payment_method || 'RAZORPAY',
        paymentConfiguration: {}
      };
    }

    // Legacy clinical consultation deposit is quarantined from active storefront checkout
    if (trimmedOfferId === 'CONSULTATION_DEPOSIT' || trimmedOfferId === 'standard_consultation') {
      throw new Error(
        `QUARANTINED_LEGACY_OFFER: Offer '${trimmedOfferId}' is quarantined and disabled for active storefront checkout.`
      );
    }

    throw new Error(
      `UNAUTHORIZED_OFFER: Could not resolve authorized offer '${trimmedOfferId}'. Browser price tampering or invalid offer.`
    );
  }

  /**
   * Lists all active offers for a business.
   */
  public getOffers(businessId: string): AuthorizedOffer[] {
    const db = getDb();
    try {
      const rows = db.prepare(`SELECT * FROM offers WHERE business_id = ? AND status = 'ACTIVE'`).all(businessId) as any[];
      return rows.map(r => ({
        offerId: r.id,
        offerName: r.offer_name,
        description: r.problem || r.solution || r.offer_name,
        deliverables: JSON.parse(r.deliverables_json || '[]'),
        priceINR: r.price_inr,
        billingModel: r.pricing_model === 'MONTHLY' ? 'MONTHLY' : 'ONE_TIME',
        currency: 'INR',
        businessId: r.business_id,
        organizationId: r.organization_id,
        active: true,
        deliveryTimeDays: r.delivery_time_days || 5,
        qualificationRequirements: JSON.parse(r.qualification_questions_json || '[]'),
        paymentProvider: r.payment_method || 'RAZORPAY',
        paymentConfiguration: {}
      }));
    } catch {
      return [];
    }
  }
}

export function resolveAuthorizedOffer(
  offerId: string,
  businessId?: string,
  organizationId?: string
): AuthorizedOffer {
  return OfferCatalogService.getInstance().resolveAuthorizedOffer(offerId, businessId, organizationId);
}
