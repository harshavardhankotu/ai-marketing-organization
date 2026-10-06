import { Context } from 'hono';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OfferDecisionEngine } from '../revenue/offer-decision-engine.js';
import { AvailabilityEngine } from '../revenue/availability-engine.js';
import { RazorpayAdapter } from '../integrations/razorpay.js';
import { StripeAdapter } from '../integrations/stripe.js';
import { FunnelPublicProfile, UniversalOrder, toMinorUnits, toMajorUnits, formatMoney, getCurrencyMetadata } from '@ai-marketing/shared';
import { isProduction } from '../config/env.js';
import { isDemoBusiness, isPublicLiveBusiness } from '../security/public-tenant-guard.js';
import { DurableRateLimiter } from '../security/durable-rate-limiter.js';

import { TenantContextResolver } from '../control-plane/tenant-context-resolver.js';

export async function handleGetPublicFunnel(c: Context): Promise<Response> {
  const businessSlug = (c.req.param('businessSlug') || '').trim().toLowerCase();
  const funnelSlug = (c.req.param('funnelSlug') || 'main').trim().toLowerCase();

  if (!businessSlug) {
    return c.json({ success: false, error: 'BUSINESS_SLUG_REQUIRED: Provide a valid business slug in path.' }, 400);
  }

  if (isDemoBusiness(businessSlug)) {
    return c.json({ success: false, error: `BUSINESS_NOT_FOUND: No business registered with slug '${businessSlug}'.` }, 404);
  }

  const d1Repo = D1RevenueRepository.getInstance();

  try {
    const biz = await d1Repo.queryOne<any>(
      'businesses',
      `SELECT id, organization_id, name, public_slug, vertical_id, vertical_name, country, currency, timezone, city, neighborhood, website_url, phone, email, brand_voice, value_propositions_json, offerings_json, public_live FROM businesses WHERE lower(public_slug) = ? LIMIT 1`,
      [businessSlug]
    );

    if (!biz || !isPublicLiveBusiness(biz)) {
      return c.json({ success: false, error: `BUSINESS_NOT_FOUND: No business registered with slug '${businessSlug}'.` }, 404);
    }

    // 1. Fetch the funnel record from durable funnels table — NEVER synthesize runtime funnels
    const funnelRow = await d1Repo.queryOne<any>(
      'funnels',
      `SELECT * FROM funnels WHERE business_id = ? AND lower(public_slug) = ? AND status = 'ACTIVE' LIMIT 1`,
      [biz.id, funnelSlug]
    );

    if (!funnelRow) {
      return c.json({
        success: false,
        error: `FUNNEL_NOT_FOUND: No active funnel '${funnelSlug}' found for business '${biz.name}'. Runtime funnel synthesis is prohibited.`
      }, 404);
    }

    let valProps: string[] = [];
    try {
      valProps = typeof biz.value_propositions_json === 'string' ? JSON.parse(biz.value_propositions_json || '[]') : (biz.value_propositions_json || []);
    } catch {
      valProps = [];
    }

    let proofPoints: string[] = [];
    try {
      proofPoints = typeof funnelRow.proof_points_json === 'string' ? JSON.parse(funnelRow.proof_points_json || '[]') : (funnelRow.proof_points_json || []);
    } catch {
      proofPoints = valProps;
    }

    // 2. Fetch active customer offers using the OfferDecisionEngine
    const offerEngine = OfferDecisionEngine.getInstance();
    const customerOffers = await offerEngine.getOffersForBusiness(biz.id);

    const publicProfile: FunnelPublicProfile = {
      business: {
        id: biz.id,
        publicSlug: biz.public_slug || businessSlug,
        name: biz.name,
        verticalId: biz.vertical_id,
        verticalName: biz.vertical_name,
        country: biz.country || 'US',
        currency: biz.currency || 'USD',
        timezone: biz.timezone || 'UTC',
        city: biz.city,
        neighborhood: biz.neighborhood,
        websiteUrl: biz.website_url,
        phone: biz.phone,
        email: biz.email,
        valuePropositions: valProps
      },
      funnel: {
        id: funnelRow.id,
        publicSlug: funnelRow.public_slug,
        funnelType: funnelRow.funnel_type,
        headline: funnelRow.headline || `${biz.name}`,
        subheadline: funnelRow.subheadline,
        proofPoints,
        ctaStrategy: funnelRow.cta_strategy || 'BOOK_OR_BUY',
        paymentStrategy: funnelRow.payment_strategy || 'OPTIONAL',
        currency: funnelRow.currency || biz.currency || 'USD'
      },
      offers: customerOffers.map(o => ({
        id: o.id,
        title: o.title,
        description: o.description,
        priceMinor: o.priceMinor,
        priceINR: toMajorUnits(o.priceMinor, o.currency),
        currency: o.currency,
        targetSegment: o.targetSegment || 'General'
      }))
    };

    return c.json({ success: true, data: publicProfile });
  } catch (err: any) {
    console.error(`[UniversalFunnel] Error fetching funnel '${businessSlug}/${funnelSlug}':`, err);
    return c.json({ success: false, error: err.message }, 500);
  }
}

export async function handleCreateUniversalOrder(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => ({}));
  const d1Repo = D1RevenueRepository.getInstance();

  const businessId = typeof body.businessId === 'string' ? body.businessId.trim() : '';
  const businessSlug = typeof body.businessSlug === 'string' ? body.businessSlug.trim().toLowerCase() : '';
  const offerId = typeof body.offerId === 'string' ? body.offerId.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';

  if (!offerId) {
    return c.json({ success: false, error: 'OFFER_REQUIRED: offerId must be specified for checkout.' }, 400);
  }

  // 0. Durable Rate Limiter (Max 10 per 10 mins per IP hash)
  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const limiter = DurableRateLimiter.getInstance();
  const rateLimit = await limiter.checkRateLimit('/public/order', clientIp, 10, 600);
  if (!rateLimit.allowed) {
    return c.json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED: Too many order attempts. Please wait a few minutes.',
      retryAfterSeconds: rateLimit.retryAfterSeconds
    }, 429);
  }

  // Hide demo businesses
  if (isDemoBusiness(businessId) || isDemoBusiness(businessSlug)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid businessId or businessSlug required.' }, 404);
  }

  // 1. Resolve business
  let biz: any = null;
  if (businessId) {
    biz = await d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE id = ?`, [businessId]);
  } else if (businessSlug) {
    biz = await d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug]);
  }

  if (!biz || !isPublicLiveBusiness(biz)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid businessId or businessSlug required.' }, 404);
  }

  const resolvedBusinessId = biz.id;
  const orgId = biz.organization_id;
  const currency = biz.currency || 'USD';

  // 2. Resolve offer & SERVER-AUTHORITATIVE PRICE
  const offerEngine = OfferDecisionEngine.getInstance();
  const allOffers = await offerEngine.getOffersForBusiness(resolvedBusinessId);
  const targetOffer = allOffers.find(o => o.id === offerId);

  if (!targetOffer) {
    return c.json({ success: false, error: `OFFER_NOT_FOUND: Offer '${offerId}' does not exist for this business.` }, 404);
  }

  const serverAmountMinor = targetOffer.priceMinor;
  const orderCurrency = targetOffer.currency || currency;

  // Security Check: If client passed an explicit price, verify it matches server price to reject tampering
  if (body.amountMinor !== undefined && Math.round(Number(body.amountMinor)) !== serverAmountMinor) {
    return c.json({
      success: false,
      error: `PRICE_TAMPER_DETECTED: Submitted amount (${body.amountMinor}) does not match server-authoritative offer price (${serverAmountMinor}).`
    }, 400);
  }

  const customerName = (body.customerName || body.name || '').trim();
  const customerPhone = (body.customerPhone || body.phone || '').trim();
  const customerEmail = (body.customerEmail || body.email || '').trim();

  if (!customerName || !customerPhone) {
    return c.json({ success: false, error: 'CUSTOMER_DETAILS_REQUIRED: Name and phone are required for order creation.' }, 400);
  }

  // 3. Idempotency Check: if idempotencyKey supplied, return existing order or reject conflict
  if (idempotencyKey) {
    const existingOrder = await d1Repo.queryOne<any>(
      'universal_orders',
      `SELECT * FROM universal_orders 
       WHERE business_id = ? AND json_extract(metadata_json, '$.idempotencyKey') = ?
       LIMIT 1`,
      [resolvedBusinessId, idempotencyKey]
    );

    if (existingOrder) {
      if (existingOrder.offer_id === targetOffer.id && existingOrder.customer_phone === customerPhone) {
        return c.json({
          success: true,
          data: {
            orderId: existingOrder.id,
            businessId: existingOrder.business_id,
            offerId: existingOrder.offer_id,
            offerTitle: targetOffer.title,
            amountMinor: existingOrder.amount_minor,
            currency: existingOrder.currency,
            status: existingOrder.status,
            paymentProvider: existingOrder.payment_provider,
            providerOrderId: existingOrder.provider_order_id,
            isIdempotentReplay: true
          }
        }, 200);
      } else {
        return c.json({
          success: false,
          error: 'IDEMPOTENCY_CONFLICT: Idempotency key was previously used with different parameters.'
        }, 409);
      }
    }
  }

  const orderId = `uord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  // Item 1: Provider MUST NOT be browser-controlled (body.paymentProvider completely removed).
  // Resolve via CURRENCY_REGISTRY: INR prefers RAZORPAY, all others STRIPE. Fail closed on unknown currency.
  const normalizedCurrency = (orderCurrency || 'USD').toUpperCase();
  const currencyMeta = getCurrencyMetadata(normalizedCurrency);
  const provider = normalizedCurrency === 'INR' ? 'RAZORPAY' : 'STRIPE';
  if (!currencyMeta.supportedPaymentProviders.includes(provider as any)) {
    return c.json({ success: false, error: `PROVIDER_UNSUPPORTED: ${provider} does not support ${normalizedCurrency}.` }, 400);
  }

  // 4. Persistence First: Insert internal order into D1 BEFORE provider creation
  const initialStatus = serverAmountMinor === 0 ? 'PAID' : 'PAYMENT_PENDING';
  const metadata = {
    ...(body.metadata || {}),
    ...(idempotencyKey ? { idempotencyKey } : {})
  };

  await d1Repo.executeWrite(
    'universal_orders',
    `INSERT INTO universal_orders (
      id, business_id, organization_id, offer_id, funnel_id,
      customer_name, customer_email, customer_phone,
      amount_minor, currency, status, payment_provider,
      provider_order_id, fulfillment_status, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, datetime('now'), datetime('now'))`,
    [
      orderId,
      resolvedBusinessId,
      orgId,
      targetOffer.id,
      body.funnelId || null,
      customerName,
      customerEmail || null,
      customerPhone,
      serverAmountMinor,
      orderCurrency,
      initialStatus,
      provider,
      JSON.stringify(metadata)
    ]
  );

  let providerOrderId: string | undefined;
  let providerClientSecret: string | undefined;

  // 5. Initiate payment with server-authoritative provider
  try {
    if (provider === 'STRIPE') {
      const stripe = StripeAdapter.getInstance();
      const stripeIntent = await stripe.createPaymentIntent({
        businessId: resolvedBusinessId,
        amountMinor: serverAmountMinor,
        currency: orderCurrency,
        customerEmail: customerEmail || undefined,
        customerName,
        description: `${biz.name} - ${targetOffer.title}`,
        metadata: { orderId, offerId }
      });
      providerOrderId = stripeIntent.paymentIntentId;
      providerClientSecret = stripeIntent.clientSecret;
    } else {
      const rzp = new RazorpayAdapter();
      const rzpOrder = await rzp.createPaymentOrder({
        businessId: resolvedBusinessId,
        amountINR: toMajorUnits(serverAmountMinor, orderCurrency),
        receipt: orderId,
        service: targetOffer.title,
        notes: { orderId, offerId, customerName, customerPhone },
        offerId: targetOffer.id,
      });
      providerOrderId = rzpOrder.orderId;
    }

    // Update order with provider details — handle recoverable failure if D1 write fails
    try {
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET provider_order_id = ?, updated_at = datetime('now') WHERE id = ?`,
        [providerOrderId || null, orderId]
      );
    } catch (d1Err: any) {
      console.error(`[CRITICAL] PROVIDER_CREATED_D1_UPDATE_FAILED: Order ${orderId} created at provider ${providerOrderId}, but failed to update D1: ${d1Err.message}`);
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET recovery_state = 'PROVIDER_CREATED_D1_UPDATE_FAILED', failure_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        [d1Err.message, orderId]
      ).catch(() => {});
      return c.json({
        success: true,
        data: {
          orderId,
          businessId: resolvedBusinessId,
          offerId: targetOffer.id,
          offerTitle: targetOffer.title,
          amountMinor: serverAmountMinor,
          currency: orderCurrency,
          status: initialStatus,
          paymentProvider: provider,
          providerOrderId,
          providerClientSecret,
          recoveryWarning: 'PROVIDER_CREATED_D1_UPDATE_FAILED'
        }
      }, 201);
    }
  } catch (providerErr: any) {
    console.error(`[UniversalOrder] Payment provider '${provider}' creation failed: ${providerErr.message}`);
    // Transition internal order to PAYMENT_PROVIDER_FAILED
    await d1Repo.executeWrite(
      'universal_orders',
      `UPDATE universal_orders SET status = 'PAYMENT_PROVIDER_FAILED', updated_at = datetime('now') WHERE id = ?`,
      [orderId]
    );

    return c.json({
      success: false,
      error: `PAYMENT_PROVIDER_FAILED: Failed to create checkout with ${provider}: ${providerErr.message}`,
      orderId
    }, 502);
  }

  return c.json({
    success: true,
    data: {
      orderId,
      businessId: resolvedBusinessId,
      offerId: targetOffer.id,
      offerTitle: targetOffer.title,
      amountMinor: serverAmountMinor,
      currency: orderCurrency,
      status: initialStatus,
      paymentProvider: provider,
      providerOrderId,
      providerClientSecret
    }
  }, 201);
}

export async function handleCreateBookingReservation(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => ({}));
  const d1Repo = D1RevenueRepository.getInstance();

  const businessId = typeof body.businessId === 'string' ? body.businessId.trim() : '';
  const businessSlug = typeof body.businessSlug === 'string' ? body.businessSlug.trim().toLowerCase() : '';

  // 0. Durable Rate Limiter (Max 10 per 10 mins per IP hash)
  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const limiter = DurableRateLimiter.getInstance();
  const rateLimit = await limiter.checkRateLimit('/public/booking', clientIp, 10, 600);
  if (!rateLimit.allowed) {
    return c.json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED: Too many booking attempts. Please wait a few minutes.',
      retryAfterSeconds: rateLimit.retryAfterSeconds
    }, 429);
  }

  // Hide demo businesses
  if (isDemoBusiness(businessId) || isDemoBusiness(businessSlug)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid public live business required.' }, 404);
  }

  let bizRow: any = null;
  if (businessId) {
    bizRow = await d1Repo.queryOne('businesses', `SELECT id, organization_id, public_slug, public_live FROM businesses WHERE id = ?`, [businessId]);
  } else if (businessSlug) {
    bizRow = await d1Repo.queryOne('businesses', `SELECT id, organization_id, public_slug, public_live FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug]);
  }

  if (!bizRow || !isPublicLiveBusiness(bizRow)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid public live business required.' }, 404);
  }

  const availabilityEngine = AvailabilityEngine.getInstance();
  const resResult = await availabilityEngine.reserveSlot({
    businessId: bizRow.id,
    slotId: body.slotId,
    preferredDate: body.preferredDate,
    preferredTime: body.preferredTime,
    customerName: body.customerName || body.name,
    customerContact: body.customerContact || body.phone || body.customerPhone,
    customerEmail: body.customerEmail || body.email,
    serviceTitle: body.serviceTitle || body.service,
    funnelId: body.funnelId,
    metadata: body.metadata
  });

  if (!resResult.success) {
    const statusCode = resResult.status === 'CONFLICT' ? 409 : (resResult.status === 'UNAVAILABLE' ? 409 : 400);
    return c.json({
      success: false,
      status: resResult.status,
      error: resResult.error
    }, statusCode);
  }

  return c.json({
    success: true,
    data: {
      reservationId: resResult.reservation?.id,
      ...resResult.reservation
    }
  }, 201);
}

export async function handleGetAvailability(c: Context): Promise<Response> {
  const businessId = c.req.query('businessId');
  const businessSlug = c.req.query('businessSlug');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const resourceId = c.req.query('resourceId');
  const resourceType = c.req.query('resourceType');

  if (isDemoBusiness(businessId) || isDemoBusiness(businessSlug)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Provide valid businessId or businessSlug query param.' }, 404);
  }

  const d1Repo = D1RevenueRepository.getInstance();

  let biz: any = null;
  if (businessId) {
    biz = await d1Repo.queryOne('businesses', `SELECT id, name, timezone, public_slug, public_live FROM businesses WHERE id = ?`, [businessId]);
  } else if (businessSlug) {
    biz = await d1Repo.queryOne('businesses', `SELECT id, name, timezone, public_slug, public_live FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug.toLowerCase()]);
  }

  if (!biz || !isPublicLiveBusiness(biz)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Provide valid businessId or businessSlug query param.' }, 404);
  }

  const availabilityEngine = AvailabilityEngine.getInstance();
  const slots = await availabilityEngine.getAvailability(biz.id, {
    startDate,
    endDate,
    resourceId,
    resourceType
  });

  return c.json({
    success: true,
    data: {
      businessId: biz.id,
      businessName: biz.name,
      timezone: biz.timezone || 'UTC',
      slots
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Funnel Management Handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCreateFunnel(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => ({}));
  const d1Repo = D1RevenueRepository.getInstance();

  const businessId = (body.businessId || '').trim();
  const publicSlug = (body.publicSlug || '').trim().toLowerCase();
  const headline = (body.headline || '').trim();
  const objective = (body.objective || 'LEAD_CAPTURE').trim();

  if (!businessId || !publicSlug || !headline) {
    return c.json({ success: false, error: 'MISSING_FIELDS: businessId, publicSlug, and headline are required.' }, 400);
  }

  const biz = await d1Repo.queryOne<any>('businesses', `SELECT id, organization_id, currency FROM businesses WHERE id = ?`, [businessId]);
  if (!biz) {
    return c.json({ success: false, error: `BUSINESS_NOT_FOUND: Business '${businessId}' not found.` }, 404);
  }

  const existing = await d1Repo.queryOne<any>('funnels', `SELECT id FROM funnels WHERE business_id = ? AND public_slug = ?`, [businessId, publicSlug]);
  if (existing) {
    return c.json({ success: false, error: `SLUG_EXISTS: A funnel with slug '${publicSlug}' already exists for this business.` }, 409);
  }

  const funnelId = `fnl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await d1Repo.executeWrite(
    'funnels',
    `INSERT INTO funnels (
      id, business_id, organization_id, public_slug, status, funnel_type,
      objective, headline, subheadline, proof_points_json, offer_ids_json,
      cta_strategy, payment_strategy, currency, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      funnelId,
      biz.id,
      biz.organization_id,
      publicSlug,
      body.funnelType || 'UNIVERSAL',
      objective,
      headline,
      body.subheadline || null,
      JSON.stringify(body.proofPoints || []),
      JSON.stringify(body.offerIds || []),
      body.ctaStrategy || 'BOOK_OR_BUY',
      body.paymentStrategy || 'OPTIONAL',
      body.currency || biz.currency || 'USD'
    ]
  );

  return c.json({
    success: true,
    data: {
      funnelId,
      businessId: biz.id,
      publicSlug,
      status: 'ACTIVE'
    }
  }, 201);
}

export async function handleListFunnels(c: Context): Promise<Response> {
  const businessId = c.req.query('businessId');
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: businessId query param required.' }, 400);
  }

  const d1Repo = D1RevenueRepository.getInstance();
  const funnels = await d1Repo.query<any>('funnels', `SELECT * FROM funnels WHERE business_id = ? ORDER BY created_at DESC`, [businessId]);

  return c.json({ success: true, data: funnels });
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Customer Offer Management Handlers
// ─────────────────────────────────────────────────────────────────────────────

export async function handleCreateCustomerOffer(c: Context): Promise<Response> {
  const body = await c.req.json().catch(() => ({}));
  const d1Repo = D1RevenueRepository.getInstance();

  const businessId = (body.businessId || '').trim();
  const title = (body.title || '').trim();
  const priceMinor = Number(body.priceMinor ?? 0);

  if (!businessId || !title) {
    return c.json({ success: false, error: 'MISSING_FIELDS: businessId and title are required.' }, 400);
  }

  const biz = await d1Repo.queryOne<any>('businesses', `SELECT id, organization_id, currency FROM businesses WHERE id = ?`, [businessId]);
  if (!biz) {
    return c.json({ success: false, error: `BUSINESS_NOT_FOUND: Business '${businessId}' not found.` }, 404);
  }

  const offerId = `coff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await d1Repo.executeWrite(
    'customer_offers',
    `INSERT INTO customer_offers (
      id, business_id, organization_id, title, description, category,
      price_minor, currency, billing_model, deposit_minor, target_segment,
      deliverables_json, qualification_rules_json, availability_rules_json,
      fulfillment_type, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    [
      offerId,
      biz.id,
      biz.organization_id,
      title,
      body.description || '',
      body.category || 'GENERAL',
      priceMinor,
      body.currency || biz.currency || 'USD',
      body.billingModel || 'ONE_TIME',
      body.depositMinor ? Number(body.depositMinor) : null,
      body.targetSegment || null,
      JSON.stringify(body.deliverables || []),
      JSON.stringify(body.qualificationRules || []),
      JSON.stringify(body.availabilityRules || {}),
      body.fulfillmentType || 'SERVICE_DELIVERY'
    ]
  );

  return c.json({
    success: true,
    data: {
      offerId,
      businessId: biz.id,
      title,
      priceMinor,
      currency: body.currency || biz.currency || 'USD'
    }
  }, 201);
}

export async function handleListCustomerOffers(c: Context): Promise<Response> {
  const businessId = c.req.query('businessId');
  if (!businessId) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: businessId query param required.' }, 400);
  }

  const engine = OfferDecisionEngine.getInstance();
  const offers = await engine.getOffersForBusiness(businessId);

  return c.json({ success: true, data: offers });
}
