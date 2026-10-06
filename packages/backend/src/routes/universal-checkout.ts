import { Context } from 'hono';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { OfferDecisionEngine } from '../revenue/offer-decision-engine.js';
import { AvailabilityEngine } from '../revenue/availability-engine.js';
import { CustomerJourneyTracker } from '../revenue/customer-journey-tracker.js';
import { RazorpayAdapter } from '../integrations/razorpay.js';
import { StripeAdapter } from '../integrations/stripe.js';
import { getCurrencyMetadata, toMajorUnits } from '@ai-marketing/shared';
import { isDemoBusiness, isPublicLiveBusiness } from '../security/public-tenant-guard.js';
import { DurableRateLimiter } from '../security/durable-rate-limiter.js';

export interface UniversalCheckoutInput {
  businessId?: string;
  businessSlug?: string;
  offerId: string;
  funnelSlug?: string;
  funnelId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  slotId?: string;
  preferredDate?: string;
  preferredTime?: string;
  paymentMethod?: 'AUTO' | 'RAZORPAY' | 'STRIPE' | 'UPI_QR' | 'PAYMENT_LINK' | 'MANUAL';
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  consentGiven?: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

function buildUpiPayload(vpa: string, payeeName: string, amountMajor: number, note: string): string | null {
  if (!vpa || !vpa.includes('@')) return null;
  const amt = Number(amountMajor).toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName.slice(0, 60))}&am=${amt}&cu=INR&tn=${encodeURIComponent(note.slice(0, 80))}`;
}

/**
 * POST /api/v1/public/checkout — single universal money API.
 * Does lead + slot reservation + server-authoritative order + provider checkout
 * (Razorpay / Stripe / UPI-QR / payment-link) in ONE idempotent call.
 */
export async function handleUniversalCheckout(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => ({}))) as UniversalCheckoutInput;
  const d1Repo = D1RevenueRepository.getInstance();

  const businessId = (body.businessId || '').trim();
  const businessSlug = (body.businessSlug || '').trim().toLowerCase();
  const offerId = (body.offerId || '').trim();
  const idempotencyKey = (body.idempotencyKey || '').trim();
  const paymentMethod = (body.paymentMethod || 'AUTO').toUpperCase();

  if (!businessId && !businessSlug) {
    return c.json({ success: false, error: 'BUSINESS_REQUIRED: Provide businessId or businessSlug.' }, 400);
  }
  if (!offerId) {
    return c.json({ success: false, error: 'OFFER_REQUIRED: offerId must be specified for checkout.' }, 400);
  }

  // 0. Durable Rate Limiter (Max 10 per 10 mins per IP hash)
  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const limiter = DurableRateLimiter.getInstance();
  const rateLimit = await limiter.checkRateLimit('/public/checkout', clientIp, 10, 600);
  if (!rateLimit.allowed) {
    return c.json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED: Too many checkout attempts. Please wait a few minutes.',
      retryAfterSeconds: rateLimit.retryAfterSeconds
    }, 429);
  }

  // Hide demo businesses
  if (isDemoBusiness(businessId) || isDemoBusiness(businessSlug)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid businessId or businessSlug required.' }, 404);
  }

  const customerName = (body.customerName || '').trim();
  const customerPhone = (body.customerPhone || '').trim();
  const customerEmail = (body.customerEmail || '').trim();
  if (!customerName || !customerPhone) {
    return c.json({ success: false, error: 'CUSTOMER_DETAILS_REQUIRED: Name and phone are required.' }, 400);
  }
  const digits = customerPhone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) {
    return c.json({ success: false, error: 'INVALID_PHONE: Provide a valid international phone number.' }, 400);
  }

  // 1. Resolve business
  let biz: any = null;
  if (businessId) {
    biz = await d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE id = ?`, [businessId]);
  } else {
    biz = await d1Repo.queryOne('businesses', `SELECT * FROM businesses WHERE lower(public_slug) = ? LIMIT 1`, [businessSlug]);
  }
  if (!biz || !isPublicLiveBusiness(biz)) {
    return c.json({ success: false, error: 'BUSINESS_NOT_FOUND: Valid businessId or businessSlug required.' }, 404);
  }

  // 2. Resolve offer at server price
  const offerEngine = OfferDecisionEngine.getInstance();
  const allOffers = await offerEngine.getOffersForBusiness(biz.id);
  const targetOffer = allOffers.find((o) => o.id === offerId);
  if (!targetOffer) {
    return c.json({ success: false, error: `OFFER_NOT_FOUND: Offer '${offerId}' does not exist for this business.` }, 404);
  }
  const serverAmountMinor = Number(targetOffer.priceMinor || 0);
  const orderCurrency = (targetOffer.currency || biz.currency || 'INR').toUpperCase();
  let currencyMeta;
  try {
    currencyMeta = getCurrencyMetadata(orderCurrency);
  } catch {
    return c.json({ success: false, error: `CURRENCY_UNSUPPORTED: ${orderCurrency} is not supported.` }, 400);
  }

  // 3. Idempotency: replay same checkout
  if (idempotencyKey) {
    const existing = await d1Repo.queryOne<any>(
      'universal_orders',
      `SELECT * FROM universal_orders WHERE business_id = ? AND json_extract(metadata_json, '$.idempotencyKey') = ? LIMIT 1`,
      [biz.id, idempotencyKey]
    );
    if (existing) {
      if (existing.offer_id === targetOffer.id && existing.customer_phone === customerPhone) {
        return c.json({
          success: true,
          data: {
            orderId: existing.id,
            offerId: existing.offer_id,
            offerTitle: targetOffer.title,
            amountMinor: existing.amount_minor,
            currency: existing.currency,
            status: existing.status,
            paymentProvider: existing.payment_provider,
            providerOrderId: existing.provider_order_id,
            isIdempotentReplay: true,
          },
        }, 200);
      }
      return c.json({ success: false, error: 'IDEMPOTENCY_CONFLICT: key used with different parameters.' }, 409);
    }
  }

  // 4. Best-effort lead (never blocks money)
  let journeyId: string | null = null;
  try {
    const tracker = new CustomerJourneyTracker();
    const journey: any = tracker.recordRealLead({
      businessId: biz.id,
      organizationId: biz.organization_id,
      customerName,
      customerPhone,
      customerEmail: customerEmail || undefined,
      channel: 'WHATSAPP',
      source: body.utmSource || `checkout:${body.funnelSlug || 'direct'}`,
      serviceOfInterest: targetOffer.title,
      classification: undefined,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
    });
    journeyId = journey?.id || null;
  } catch (e) {
    console.warn('[Checkout] lead capture best-effort failed:', (e as Error).message);
  }

  // 5. Best-effort slot reservation
  let reservation: any = null;
  if (body.slotId || body.preferredDate) {
    try {
      const avail = AvailabilityEngine.getInstance();
      const res: any = await avail.reserveSlot({
        businessId: biz.id,
        slotId: body.slotId,
        preferredDate: body.preferredDate,
        preferredTime: body.preferredTime,
        customerName,
        customerContact: customerPhone,
        customerEmail: customerEmail || undefined,
        serviceTitle: targetOffer.title,
        funnelId: body.funnelId,
        metadata: body.metadata,
      });
      if (res?.success) reservation = res.reservation || res;
    } catch (e) {
      console.warn('[Checkout] slot reservation best-effort failed:', (e as Error).message);
    }
  }

  // 6. Resolve provider (server-authoritative, never browser-controlled)
  let provider: 'RAZORPAY' | 'STRIPE' | 'MANUAL' = orderCurrency === 'INR' ? 'RAZORPAY' : 'STRIPE';
  if (paymentMethod === 'UPI_QR' || paymentMethod === 'MANUAL' || paymentMethod === 'PAYMENT_LINK') {
    provider = orderCurrency === 'INR' ? 'RAZORPAY' : 'STRIPE';
  } else if (paymentMethod === 'RAZORPAY' || paymentMethod === 'STRIPE') {
    provider = paymentMethod as any;
  }
  if (!(currencyMeta.supportedPaymentProviders as string[]).includes(provider)) {
    return c.json({ success: false, error: `PROVIDER_UNSUPPORTED: ${provider} does not support ${orderCurrency}.` }, 400);
  }

  // 7. Persist order FIRST
  const orderId = `uord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const initialStatus = serverAmountMinor === 0 ? 'PAID' : 'PAYMENT_PENDING';
  const metadata = { ...(body.metadata || {}), ...(idempotencyKey ? { idempotencyKey } : {}), funnelSlug: body.funnelSlug, journeyId, reservationId: reservation?.id || null, requestedPaymentMethod: paymentMethod };
  await d1Repo.executeWrite(
    'universal_orders',
    `INSERT INTO universal_orders (id, business_id, organization_id, offer_id, funnel_id, customer_name, customer_email, customer_phone, amount_minor, currency, status, payment_provider, provider_order_id, fulfillment_status, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'PENDING', ?, datetime('now'), datetime('now'))`,
    [orderId, biz.id, biz.organization_id, targetOffer.id, body.funnelId || null, customerName, customerEmail || null, customerPhone, serverAmountMinor, orderCurrency, initialStatus, provider === 'MANUAL' ? 'MANUAL' : provider, JSON.stringify(metadata)]
  );

  // Free order — no provider needed
  if (serverAmountMinor === 0) {
    return c.json({ success: true, data: { orderId, offerId: targetOffer.id, offerTitle: targetOffer.title, amountMinor: 0, currency: orderCurrency, status: 'PAID', paymentProvider: provider, journeyId, reservation } }, 201);
  }

  let providerOrderId: string | undefined;
  let providerClientSecret: string | undefined;
  let paymentLinkUrl: string | undefined;
  let upiPayload: string | null = null;

  try {
    if (provider === 'STRIPE') {
      const stripe = StripeAdapter.getInstance();
      const intent = await stripe.createPaymentIntent({
        businessId: biz.id,
        amountMinor: serverAmountMinor,
        currency: orderCurrency,
        customerEmail: customerEmail || undefined,
        customerName,
        description: `${biz.name} - ${targetOffer.title}`,
        metadata: { orderId, offerId },
      });
      providerOrderId = intent.paymentIntentId;
      providerClientSecret = intent.clientSecret;
    } else {
      const rzp = new RazorpayAdapter();
      const rzpOrder = await rzp.createPaymentOrder({
        businessId: biz.id,
        organizationId: biz.organization_id,
        amountINR: toMajorUnits(serverAmountMinor, orderCurrency),
        receipt: orderId,
        service: targetOffer.title,
        notes: { orderId, offerId, customerName, customerPhone },
        offerId: targetOffer.id,
      });
      providerOrderId = rzpOrder.orderId;

      // Attach a payment-link for WhatsApp/share + UPI QR payload (INR only)
      try {
        const link = await rzp.createPaymentLink({
          organizationId: biz.organization_id,
          businessId: biz.id,
          offerId: targetOffer.id,
          amountINR: toMajorUnits(serverAmountMinor, orderCurrency),
          description: `${biz.name} - ${targetOffer.title}`,
          customer: { name: customerName, contact: customerPhone, email: customerEmail || undefined },
        } as any);
        paymentLinkUrl = (link as any)?.shortUrl || (link as any)?.short_url;
      } catch (e) {
        console.warn('[Checkout] payment-link best-effort failed:', (e as Error).message);
      }
      const vpa = (process.env.PLATFORM_UPI_VPA || '').trim();
      if (vpa) {
        upiPayload = buildUpiPayload(vpa, biz.name || 'Consultation', toMajorUnits(serverAmountMinor, orderCurrency), `Order ${orderId}`);
      }
    }

    await d1Repo.executeWrite(
      'universal_orders',
      `UPDATE universal_orders SET provider_order_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [providerOrderId || null, orderId]
    ).catch(async (d1Err: Error) => {
      await d1Repo.executeWrite(
        'universal_orders',
        `UPDATE universal_orders SET recovery_state = 'PROVIDER_CREATED_D1_UPDATE_FAILED', failure_reason = ?, updated_at = datetime('now') WHERE id = ?`,
        [String(d1Err.message || d1Err), orderId]
      ).catch(() => {});
    });
  } catch (providerErr: any) {
    await d1Repo.executeWrite(
      'universal_orders',
      `UPDATE universal_orders SET status = 'PAYMENT_PROVIDER_FAILED', updated_at = datetime('now') WHERE id = ?`,
      [orderId]
    );
    // Still return UPI fallback so money is possible without live creds
    const vpa = (process.env.PLATFORM_UPI_VPA || '').trim();
    if (orderCurrency === 'INR' && vpa) {
      upiPayload = buildUpiPayload(vpa, biz.name || 'Consultation', toMajorUnits(serverAmountMinor, orderCurrency), `Order ${orderId}`);
      return c.json({
        success: true,
        data: { orderId, offerId: targetOffer.id, offerTitle: targetOffer.title, amountMinor: serverAmountMinor, currency: orderCurrency, status: 'PAYMENT_PROVIDER_FAILED', paymentProvider: provider, providerError: providerErr.message, upiPayload, paymentLinkUrl, journeyId, reservation, fallback: 'UPI_QR' },
      }, 201);
    }
    return c.json({ success: false, error: `PAYMENT_PROVIDER_FAILED: ${providerErr.message}`, orderId }, 502);
  }

  return c.json({
    success: true,
    data: {
      orderId, offerId: targetOffer.id, offerTitle: targetOffer.title,
      amountMinor: serverAmountMinor, amountMajor: toMajorUnits(serverAmountMinor, orderCurrency),
      currency: orderCurrency, status: initialStatus, paymentProvider: provider,
      providerOrderId, providerClientSecret, paymentLinkUrl, upiPayload,
      journeyId, reservation,
    },
  }, 201);
}
