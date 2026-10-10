import { OwnOffer, OwnOfferClickEvent } from './own-offer-types.js';
import { getDb } from '../db/client.js';

export class OwnOfferEngine {
  private static instance: OwnOfferEngine;

  public static getInstance(): OwnOfferEngine {
    if (!OwnOfferEngine.instance) {
      OwnOfferEngine.instance = new OwnOfferEngine();
    }
    return OwnOfferEngine.instance;
  }

  /**
   * Validates Razorpay Payment Link / Page URL.
   * Permitted hostnames: strictly 'rzp.io', 'razorpay.com', 'pages.razorpay.com'.
   * Rejects lookalikes, subdomains, phishing domains, non-HTTPS protocols.
   */
  public static validateRazorpayUrl(rawUrl: string): boolean {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:') return false;

      const host = parsed.hostname.toLowerCase();
      const validHosts = new Set(['rzp.io', 'razorpay.com', 'pages.razorpay.com']);
      if (!validHosts.has(host)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates and registers a new Own Offer with strict field and host validation.
   */
  public createOwnOffer(input: Omit<OwnOffer, 'id' | 'offerType' | 'paymentMode' | 'deliveryMethod' | 'createdAt' | 'updatedAt'>): OwnOffer {
    if (!OwnOfferEngine.validateRazorpayUrl(input.paymentLinkUrl)) {
      throw new Error(`INVALID_PAYMENT_URL: Payment link '${input.paymentLinkUrl}' is not an authorized Razorpay host. Only https://rzp.io and https://razorpay.com are permitted.`);
    }

    if (!input.categoryAttestation) {
      throw new Error('ATTESTATION_REQUIRED: Owner must attest that the offer fits the business category approved on the Razorpay account.');
    }

    if (!input.priceINR || input.priceINR <= 0) {
      throw new Error('INVALID_PRICE: Offer price in INR must be a positive number typed by the owner.');
    }

    const now = new Date().toISOString();
    const offer: OwnOffer = {
      ...input,
      id: `ownoff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      offerType: 'OWN_OFFER',
      paymentMode: 'MANUAL_LINK',
      deliveryMethod: 'OWNER_MANUAL',
      createdAt: now,
      updatedAt: now
    };

    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS own_offers (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        one_sentence_promise TEXT NOT NULL,
        price_inr REAL NOT NULL,
        price_set_date TEXT NOT NULL,
        refund_policy_text TEXT NOT NULL,
        delivery_method TEXT NOT NULL DEFAULT 'OWNER_MANUAL',
        payment_link_url TEXT NOT NULL,
        category_attestation INTEGER NOT NULL,
        what_buyer_gets_json TEXT NOT NULL,
        who_it_is_for_json TEXT NOT NULL,
        who_should_not_buy_json TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    db.prepare(`
      INSERT INTO own_offers (
        id, organization_id, name, one_sentence_promise, price_inr, price_set_date,
        refund_policy_text, delivery_method, payment_link_url, category_attestation,
        what_buyer_gets_json, who_it_is_for_json, who_should_not_buy_json,
        contact_email, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OWNER_MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      offer.id,
      offer.organizationId,
      offer.name,
      offer.oneSentencePromise,
      offer.priceINR,
      offer.priceSetDate,
      offer.refundPolicyText,
      offer.paymentLinkUrl,
      offer.categoryAttestation ? 1 : 0,
      JSON.stringify(offer.whatBuyerGets),
      JSON.stringify(offer.whoItIsFor),
      JSON.stringify(offer.whoShouldNotBuy),
      offer.contactEmail,
      offer.active ? 1 : 0,
      offer.createdAt,
      offer.updatedAt
    );

    return offer;
  }

  /**
   * Builds the static landing page for an own offer.
   */
  public generateLandingPageHtml(offer: OwnOffer): string {
    const getsList = offer.whatBuyerGets.map(item => `<li>${item}</li>`).join('\n        ');
    const forList = offer.whoItIsFor.map(item => `<li>${item}</li>`).join('\n        ');
    const notForList = offer.whoShouldNotBuy.map(item => `<li>${item}</li>`).join('\n        ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${offer.name} — Direct Offer</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    .promise { font-size: 1.25rem; color: #444; margin-bottom: 2rem; font-weight: 500; }
    .price-box { background: #f8fafc; border: 2px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 2rem; }
    .price { font-size: 2rem; font-weight: bold; color: #0f172a; }
    .price-date { font-size: 0.85rem; color: #64748b; margin-top: 4px; }
    .section { margin-bottom: 2rem; }
    .section h2 { font-size: 1.3rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    .cta-btn { display: inline-block; background: #2563eb; color: #fff; padding: 14px 28px; font-size: 1.1rem; font-weight: 600; text-decoration: none; border-radius: 6px; }
    .cta-btn:hover { background: #1d4ed8; }
    .contact { font-size: 0.9rem; color: #64748b; margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>${offer.name}</h1>
  <p class="promise">${offer.oneSentencePromise}</p>

  <div class="price-box">
    <div class="price">₹${offer.priceINR.toLocaleString('en-IN')}</div>
    <div class="price-date">Price established on: ${offer.priceSetDate}</div>
    <div style="margin-top: 16px;">
      <a href="${offer.paymentLinkUrl}" class="cta-btn" target="_blank" rel="noopener noreferrer">Proceed to Secure Payment</a>
    </div>
  </div>

  <div class="section">
    <h2>What You Get</h2>
    <ul>
      ${getsList}
    </ul>
  </div>

  <div class="section">
    <h2>Who This Is For</h2>
    <ul>
      ${forList}
    </ul>
  </div>

  <div class="section">
    <h2>Who Should NOT Buy</h2>
    <ul>
      ${notForList}
    </ul>
  </div>

  <div class="section">
    <h2>Refund Policy</h2>
    <p>${offer.refundPolicyText}</p>
  </div>

  <div class="contact">
    <p>Contact Support / Questions: <a href="mailto:${offer.contactEmail}">${offer.contactEmail}</a></p>
    <p>Delivery Method: Manual delivery direct from business owner (${offer.deliveryMethod}).</p>
  </div>
</body>
</html>`;
  }

  /**
   * Generates required compliance static pages: refund, shipping/delivery, contact.
   * All pages are marked "needs owner review".
   */
  public generatePolicyPages(offer: OwnOffer): { refundHtml: string; deliveryHtml: string; contactHtml: string } {
    const badge = '<div style="background:#fef3c7;border:1px solid #f59e0b;color:#92400e;padding:10px 16px;border-radius:6px;margin-bottom:20px;font-weight:600;">⚠️ NEEDS OWNER REVIEW: Verify and approve before linking publicly.</div>';

    const refundHtml = `<!DOCTYPE html><html><head><title>Refund Policy - ${offer.name}</title></head><body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;">
${badge}
<h1>Cancellation and Refund Policy</h1>
<p>${offer.refundPolicyText}</p>
<p>For refund inquiries, contact: <a href="mailto:${offer.contactEmail}">${offer.contactEmail}</a></p>
</body></html>`;

    const deliveryHtml = `<!DOCTYPE html><html><head><title>Shipping and Delivery - ${offer.name}</title></head><body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;">
${badge}
<h1>Shipping & Delivery Terms</h1>
<p>Delivery method for this service/product is <strong>OWNER_MANUAL</strong>.</p>
<p>Delivery commences immediately upon verified payment capture. The owner directly provides the deliverables outlined in the service agreement within 1-3 business days.</p>
<p>Inquiries: <a href="mailto:${offer.contactEmail}">${offer.contactEmail}</a></p>
</body></html>`;

    const contactHtml = `<!DOCTYPE html><html><head><title>Contact Us - ${offer.name}</title></head><body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;">
${badge}
<h1>Contact Information</h1>
<p>For any pre-purchase questions, onboarding support, or payment queries, please reach out directly:</p>
<p><strong>Email:</strong> <a href="mailto:${offer.contactEmail}">${offer.contactEmail}</a></p>
<p>Response time: Under 24 business hours.</p>
</body></html>`;

    return { refundHtml, deliveryHtml, contactHtml };
  }

  /**
   * Records an outbound click event to the payment link.
   * INVARIANT: An outbound click is NEVER revenue.
   */
  public recordOutboundPaymentClick(offerId: string, ipHash: string, userAgent?: string): OwnOfferClickEvent {
    const refId = `ref_pay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const event: OwnOfferClickEvent = {
      id: `clk_${Date.now()}`,
      offerId,
      refId,
      timestamp: new Date().toISOString(),
      ipHash,
      userAgent,
      isRevenue: false
    };

    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS own_offer_clicks (
        id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL,
        ref_id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        user_agent TEXT,
        is_revenue INTEGER NOT NULL DEFAULT 0
      );
    `);

    db.prepare(`
      INSERT INTO own_offer_clicks (id, offer_id, ref_id, timestamp, ip_hash, user_agent, is_revenue)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(event.id, event.offerId, event.refId, event.timestamp, event.ipHash, event.userAgent || null);

    return event;
  }
}
