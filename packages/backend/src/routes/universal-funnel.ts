import { Context } from 'hono';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OfferDecisionEngine } from '../revenue/offer-decision-engine.js';
import { RazorpayAdapter } from '../integrations/razorpay.js';
import { StripeAdapter } from '../integrations/stripe.js';
import { FunnelPublicProfile, UniversalOrder, toMinorUnits, toMajorUnits } from '@ai-marketing/shared';
import { isProduction } from '../config/env.js';

export async function handleGetPublicFunnel(c: Context): Promise<Response> {
  const businessSlug = (c.req.param('businessSlug') || '').trim().toLowerCase();
  const funnelSlug = (c.req.param('funnelSlug') || 'main').trim().toLowerCase();

  if (!businessSlug) {
    return c.json({ success: false, error: 'BUSINESS_SLUG_REQUIRED: Provide a valid business slug in path.' }, 400);
  }

  const d1Repo = D1RevenueRepository.getInstance();

  try {
    const biz = await d1Repo.queryOne<any>(
      'businesses',
      `SELECT id, organization_id, name, public_slug, vertical_id, vertical_name, country, currency, timezone, city, neighborhood, website_url, phone, email, brand_voice, value_propositions_json, offerings_json FROM businesses WHERE lower(public_slug) = ? LIMIT 1`,
      [businessSlug]
    );

    if (!biz) {
      return c.json({ success: false, error: `BUSINESS_NOT_FOUND: No business registered with slug '${businessSlug}'.` }, 404);
    }

    // 1. Fetch or synthesize the funnel record
    let funnelRow = await d1Repo.queryOne<any>(
      'funnels',
      `SELECT * FROM funnels WHERE business_id = ? AND lower(public_slug) = ? AND status = 'ACTIVE' LIMIT 1`,
      [biz.id, funnelSlug]
    );

    let valProps: string[] = [];
    try {
      valProps = typeof biz.value_propositions_json === 'string' ? JSON.parse(biz.value_propositions_json || '[]') : (biz.value_propositions_json || []);
    } catch {
      valProps = [];
    }

    if (!funnelRow) {
      // Synthesize a universal demand funnel from the business profile
      funnelRow = {
        id: `funnel_${biz.id}_${funnelSlug}`,
        business_id: biz.id,
        public_slug: funnelSlug,
        funnel_type: 'UNIVERSAL',
        headline: `${biz.name} — Premium ${biz.vertical_name}`,
        subheadline: `Serving ${biz.city} and surrounding areas with verified expertise.`,
        proof_points_json: JSON.stringify(valProps.length > 0 ? valProps : ['Transparent pricing', 'Fast scheduling', 'Verified quality']),
        cta_strategy: 'BOOK_OR_BUY',
        payment_strategy: 'OPTIONAL',
        currency: biz.currency || 'INR'
      };
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
        country: biz.country || 'IN',
        currency: biz.currency || 'INR',
        timezone: biz.timezone || 'Asia/Kolkata',
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
        currency: funnelRow.currency || biz.currency || 'INR'
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

  if (!offerId) {
    return c.json({ success: false, error: 'OFFER_REQUIRED: offerId must be specified for checkout.' }, 400);
  }

  // 1. Resolve business
  let biz: any = null;
  if (businessId) {
    biz = await d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE id = ?`, [businessId]);
  } else if (businessSlug) {
    biz = await d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug]);
  }

  if (!biz) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid businessId or businessSlug required.' }, 404);
  }

  const resolvedBusinessId = biz.id;
  const orgId = biz.organization_id;
  const currency = biz.currency || 'INR';

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

  const orderId = `uord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const provider = (body.paymentProvider || (orderCurrency === 'INR' ? 'RAZORPAY' : 'STRIPE')).toUpperCase();

  let providerOrderId: string | undefined;
  let providerClientSecret: string | undefined;

  // 3. Initiate payment with respective provider
  if (provider === 'RAZORPAY') {
    const rzp = new RazorpayAdapter();
    const rzpOrder = await rzp.createPaymentOrder({
      businessId: resolvedBusinessId,
      amountINR: toMajorUnits(serverAmountMinor, orderCurrency),
      receipt: orderId,
      service: targetOffer.title,
      notes: { orderId, offerId, customerName, customerPhone }
    });
    providerOrderId = rzpOrder.orderId;
  } else if (provider === 'STRIPE') {
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
  }

  // 4. Persist Universal Order to D1
  const initialStatus = serverAmountMinor === 0 ? 'PAID' : 'PAYMENT_PENDING';
  await d1Repo.executeWrite(
    'universal_orders',
    `INSERT INTO universal_orders (
      id, business_id, organization_id, offer_id, funnel_id,
      customer_name, customer_email, customer_phone,
      amount_minor, currency, status, payment_provider,
      provider_order_id, fulfillment_status, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, datetime('now'), datetime('now'))`,
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
      providerOrderId || null,
      JSON.stringify(body.metadata || {})
    ]
  );

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

  let biz: any = null;
  if (businessId) {
    biz = await d1Repo.queryOne('businesses', `SELECT id, organization_id, name FROM businesses WHERE id = ?`, [businessId]);
  } else if (businessSlug) {
    biz = await d1Repo.queryOne('businesses', `SELECT id, organization_id, name FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug]);
  }

  if (!biz) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid businessId or businessSlug required.' }, 404);
  }

  const customerName = (body.customerName || body.name || '').trim();
  const customerContact = (body.customerContact || body.phone || body.customerPhone || '').trim();
  const serviceTitle = (body.serviceTitle || body.service || 'Consultation').trim();
  const startTime = body.startTime || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const endTime = body.endTime || new Date(Date.now() + 25 * 3600 * 1000).toISOString();
  const slotId = body.slotId || `slot_${Date.now()}`;

  if (!customerName || !customerContact) {
    return c.json({ success: false, error: 'NAME_AND_CONTACT_REQUIRED: customerName and customerContact are required.' }, 400);
  }

  const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  await d1Repo.executeWrite(
    'booking_reservations',
    `INSERT INTO booking_reservations (
      id, business_id, organization_id, slot_id,
      customer_name, customer_contact, customer_email, service_title,
      status, start_time, end_time, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, datetime('now'), datetime('now'))`,
    [
      reservationId,
      biz.id,
      biz.organization_id,
      slotId,
      customerName,
      customerContact,
      body.customerEmail || null,
      serviceTitle,
      startTime,
      endTime,
      JSON.stringify(body.metadata || {})
    ]
  );

  return c.json({
    success: true,
    data: {
      reservationId,
      businessId: biz.id,
      businessName: biz.name,
      customerName,
      serviceTitle,
      startTime,
      endTime,
      status: 'CONFIRMED'
    }
  }, 201);
}

export async function handleGetAvailability(c: Context): Promise<Response> {
  const businessId = c.req.query('businessId');
  const businessSlug = c.req.query('businessSlug');
  const d1Repo = D1RevenueRepository.getInstance();

  let biz: any = null;
  if (businessId) {
    biz = await d1Repo.queryOne('businesses', `SELECT id, name, timezone FROM businesses WHERE id = ?`, [businessId]);
  } else if (businessSlug) {
    biz = await d1Repo.queryOne('businesses', `SELECT id, name, timezone FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug.toLowerCase()]);
  }

  if (!biz) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Provide valid businessId or businessSlug query param.' }, 404);
  }

  // Generate tomorrow's availability slots (30 min increments between 10:00 and 17:00)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  const slots = [
    { slotId: `slot_${dateStr}_1000`, startTime: `${dateStr}T10:00:00Z`, endTime: `${dateStr}T10:30:00Z`, isAvailable: true },
    { slotId: `slot_${dateStr}_1130`, startTime: `${dateStr}T11:30:00Z`, endTime: `${dateStr}T12:00:00Z`, isAvailable: true },
    { slotId: `slot_${dateStr}_1400`, startTime: `${dateStr}T14:00:00Z`, endTime: `${dateStr}T14:30:00Z`, isAvailable: true },
    { slotId: `slot_${dateStr}_1530`, startTime: `${dateStr}T15:30:00Z`, endTime: `${dateStr}T16:00:00Z`, isAvailable: true },
    { slotId: `slot_${dateStr}_1630`, startTime: `${dateStr}T16:30:00Z`, endTime: `${dateStr}T17:00:00Z`, isAvailable: true }
  ];

  return c.json({
    success: true,
    data: {
      businessId: biz.id,
      businessName: biz.name,
      timezone: biz.timezone || 'UTC',
      date: dateStr,
      slots
    }
  });
}
