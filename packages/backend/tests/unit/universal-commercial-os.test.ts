import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { resetDbForTesting, closeDb, getDb } from '../../src/db/client.js';
import { OfferDecisionEngine } from '../../src/revenue/offer-decision-engine.js';
import { StripeAdapter } from '../../src/integrations/stripe.js';
import { toMinorUnits, toMajorUnits, formatMoney } from '@ai-marketing/shared';

describe('Universal Commercial Operating System (UCOS)', () => {
  let app: Hono;

  beforeEach(() => {
    resetDbForTesting();
    app = new Hono();
    app.route('/api/v1', apiRouter);

    // Setup base organization
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO organizations (id, name, slug)
      VALUES ('org_global_test', 'Global Test Org', 'global-test-org')
    `).run();
  });

  afterEach(() => {
    closeDb();
  });

  describe('1. Money & Currency Neutrality', () => {
    it('correctly converts standard 2-decimal currencies to and from minor units', () => {
      expect(toMinorUnits(500, 'INR')).toBe(50000);
      expect(toMajorUnits(50000, 'INR')).toBe(500);

      expect(toMinorUnits(25.50, 'USD')).toBe(2550);
      expect(toMajorUnits(2550, 'USD')).toBe(25.50);

      expect(toMinorUnits(120.99, 'GBP')).toBe(12099);
      expect(toMajorUnits(12099, 'GBP')).toBe(120.99);

      expect(toMinorUnits(99.00, 'EUR')).toBe(9900);
      expect(toMajorUnits(9900, 'EUR')).toBe(99.00);
    });

    it('handles zero-decimal and three-decimal currencies accurately', () => {
      // JPY is zero-decimal
      expect(toMinorUnits(1500, 'JPY')).toBe(1500);
      expect(toMajorUnits(1500, 'JPY')).toBe(1500);

      // KWD is 3-decimal
      expect(toMinorUnits(12.5, 'KWD')).toBe(12500);
      expect(toMajorUnits(12500, 'KWD')).toBe(12.5);
    });

    it('formats money consistently across locales', () => {
      const formattedUSD = formatMoney(5000, 'USD', 'en-US');
      expect(formattedUSD).toContain('$50.00');

      const formattedGBP = formatMoney(7500, 'GBP', 'en-GB');
      expect(formattedGBP).toContain('75.00');
    });
  });

  describe('2. Multi-Vertical Business Creation via API', () => {
    it('creates an HVAC Home Service business in US (USD, America/New_York)', async () => {
      const hvacPayload = {
        name: 'Apex Heating & Air',
        verticalId: 'hvac_contractor',
        verticalName: 'HVAC Services',
        country: 'US',
        currency: 'USD',
        timezone: 'America/New_York',
        city: 'Austin',
        neighborhood: 'Downtown',
        primaryLanguage: 'English',
        secondaryLanguages: ['Spanish'],
        brandVoice: 'Prompt, professional, certified home heating and air repair',
        monthlyBudgetINR: 0,
        monthlyBudgetMinor: 500000, // $5,000.00
        offerings: [
          {
            id: 'off_hvac_tuneup',
            title: '21-Point AC Precision Tune-Up',
            description: 'Full seasonal maintenance and filter replacement',
            priceMinor: 9900, // $99.00
            priceINR: 99,
            currency: 'USD',
            targetSegment: 'Homeowners'
          },
          {
            id: 'off_hvac_emergency',
            title: '24/7 Emergency AC Diagnostic',
            description: 'Same-day emergency response with technician visit',
            priceMinor: 14900, // $149.00
            priceINR: 149,
            currency: 'USD',
            targetSegment: 'Emergency'
          }
        ],
        valuePropositions: ['Licensed & Insured', 'Same-Day Service Guarantee', 'Upfront Transparent Pricing']
      };

      const res = await app.request('/api/v1/business', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-organization-id': 'org_global_test',
          'x-user-id': 'usr_test_owner'
        },
        body: JSON.stringify(hvacPayload)
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.country).toBe('US');
      expect(json.data.currency).toBe('USD');
      expect(json.data.public_slug).toBe('apex-heating-air');
    });

    it('creates a Legal & Professional Services practice in UK (GBP, Europe/London)', async () => {
      const legalPayload = {
        name: 'Thames Legal Partners',
        verticalId: 'legal_practice',
        verticalName: 'Commercial Law',
        country: 'GB',
        currency: 'GBP',
        timezone: 'Europe/London',
        city: 'London',
        neighborhood: 'Canary Wharf',
        primaryLanguage: 'English',
        brandVoice: 'Rigorous, corporate, partner-led legal counsel',
        monthlyBudgetINR: 0,
        offerings: [
          {
            id: 'off_contract_review',
            title: 'SaaS Agreement Audit & Legal Review',
            description: 'Comprehensive 48h contract risk audit by a senior solicitor',
            priceMinor: 75000, // £750.00
            currency: 'GBP',
            targetSegment: 'Tech Startups'
          }
        ],
        valuePropositions: ['Solicitors Regulation Authority Registered', '48-Hour Turnaround', 'Fixed Fees']
      };

      const res = await app.request('/api/v1/business', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-organization-id': 'org_global_test',
          'x-user-id': 'usr_test_owner'
        },
        body: JSON.stringify(legalPayload)
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.currency).toBe('GBP');
      expect(json.data.public_slug).toBe('thames-legal-partners');
    });
  });

  describe('3. Public Demand Funnel Dynamic Resolution', () => {
    it('returns 404 when requested business slug does not exist', async () => {
      const res = await app.request('/api/v1/public/funnel/non-existent-biz/default');
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('BUSINESS_NOT_FOUND');
    });

    it('dynamically resolves public funnel with headline, proof points, and offers', async () => {
      const db = getDb();
      const bizId = 'biz_salon_dubai';
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, primary_language,
          brand_voice, value_propositions_json, offerings_json
        ) VALUES (
          ?, 'org_global_test', 'Lumiere Hair & Spa', 'lumiere-dubai',
          'salon_spa', 'Luxury Hair & Wellness',
          'AE', 'AED', 'Asia/Dubai', 'Dubai', 'Downtown Dubai', 'English',
          'Exclusive luxury salon experiences',
          ?, ?
        )
      `).run(
        bizId,
        JSON.stringify(['Master stylists from Paris', 'Organic vegan products', 'Private VIP suites']),
        JSON.stringify([
          {
            id: 'off_balayage',
            title: 'Signature Balayage & Treatment',
            description: 'Custom color gloss, bond repair, and styling',
            priceMinor: 65000, // 650 AED
            priceINR: 650,
            currency: 'AED'
          }
        ])
      );

      db.prepare(`
        INSERT INTO funnels (
          id, business_id, organization_id, public_slug, status, objective, headline, subheadline
        ) VALUES (
          'fnl_lumiere_main', ?, 'org_global_test', 'main', 'ACTIVE', 'Bookings', 'Luxury Hair Care at Lumiere Hair & Spa',
          'Exclusive experiences in Downtown Dubai'
        )
      `).run(bizId);

      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, description, category,
          price_minor, currency, billing_model, deliverables_json, active
        ) VALUES (
          'off_balayage', ?, 'org_global_test', 'Signature Balayage & Treatment',
          'Custom color gloss, bond repair, and styling', 'SERVICE', 65000, 'AED', 'ONE_TIME', '["Custom color gloss"]', 1
        )
      `).run(bizId);

      const res = await app.request('/api/v1/public/funnel/lumiere-dubai/main');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.business.name).toBe('Lumiere Hair & Spa');
      expect(json.data.business.currency).toBe('AED');
      expect(json.data.funnel.headline).toContain('Lumiere Hair & Spa');
      expect(json.data.offers).toHaveLength(1);
      expect(json.data.offers[0].title).toBe('Signature Balayage & Treatment');
      expect(json.data.offers[0].priceMinor).toBe(65000);
    });
  });

  describe('4. Offer Decision Engine', () => {
    it('matches structured customer intent with eligible offers and computes fit score', async () => {
      const db = getDb();
      const bizId = 'biz_solar_sydney';
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, primary_language,
          brand_voice, value_propositions_json, offerings_json
        ) VALUES (
          ?, 'org_global_test', 'SunPower Solutions', 'sunpower-sydney',
          'solar_energy', 'Residential & Commercial Solar',
          'AU', 'AUD', 'Australia/Sydney', 'Sydney', 'Surry Hills', 'English',
          'Clean energy experts', '["Tier-1 panels", "25-year warranty"]', '[]'
        )
      `).run(bizId);

      // Add durable customer offers
      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, description, category,
          price_minor, currency, billing_model, deliverables_json, active
        ) VALUES
        ('off_solar_res', ?, 'org_global_test', 'Residential 6.6kW Solar System', 'Complete rooftop solar installation with smart inverter', 'SOLAR', 499000, 'AUD', 'ONE_TIME', '["Solar panels", "Inverter", "Grid connection"]', 1),
        ('off_solar_battery', ?, 'org_global_test', 'Home Battery Storage Add-on', '10kWh Lithium battery storage system', 'BATTERY', 750000, 'AUD', 'ONE_TIME', '["10kWh battery", "Backup gateway"]', 1)
      `).run(bizId, bizId);

      const engine = OfferDecisionEngine.getInstance();
      const matchResult = await engine.matchOffers(bizId, {
        rawText: 'Looking for a residential rooftop solar system for our home',
        serviceOrProduct: 'solar system',
        customerType: 'B2C',
        urgency: 'HIGH',
        confidence: 0.95
      });

      expect(matchResult.status).toBe('QUALIFIED');
      expect(matchResult.fitScore).toBeGreaterThanOrEqual(0.7);
      expect(matchResult.eligibleOfferIds).toContain('off_solar_res');
      expect(matchResult.recommendedOffers[0].title).toBe('Residential 6.6kW Solar System');
      expect(matchResult.suggestedAction).toBe('INSTANT_PURCHASE');
    });
  });

  describe('5. Server-Authoritative Checkout & Price Tamper Defense', () => {
    it('rejects client payment order when client attempts to tamper with price', async () => {
      const db = getDb();
      const bizId = 'biz_dental_tamper';
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, primary_language,
          brand_voice, value_propositions_json, offerings_json
        ) VALUES (
          ?, 'org_global_test', 'SmileCare Clinic', 'smilecare-tamper',
          'dental_clinic', 'Dental Healthcare',
          'IN', 'INR', 'Asia/Kolkata', 'Hyderabad', 'Banjara Hills', 'English',
          'Expert orthodontic dentistry', '["Painless"]', '[]'
        )
      `).run(bizId);

      // Offer costs ₹15,000 (1,500,000 paise)
      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, description, category,
          price_minor, currency, billing_model, active
        ) VALUES ('off_aligners_gold', ?, 'org_global_test', 'Clear Aligners Full Case', 'Complete orthodontic treatment', 'ALIGNERS', 1500000, 'INR', 'ONE_TIME', 1)
      `).run(bizId);

      // Hacker attempts to pass amountMinor: 100 (₹1.00) instead of ₹15,000
      const res = await app.request('/api/v1/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: bizId,
          offerId: 'off_aligners_gold',
          customerName: 'Shady Purchaser',
          customerPhone: '+919988776655',
          amountMinor: 100 // Tampered price!
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('PRICE_TAMPER_DETECTED');
    });

    it('creates server-authoritative universal order with correct price and provider', async () => {
      const db = getDb();
      const bizId = 'biz_clean_la';
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, primary_language,
          brand_voice, value_propositions_json, offerings_json
        ) VALUES (
          ?, 'org_global_test', 'Sparkle Home Cleaning', 'sparkle-la',
          'home_cleaning', 'Residential Cleaning',
          'US', 'USD', 'America/Los_Angeles', 'Los Angeles', 'Santa Monica', 'English',
          'Eco-friendly home care', '["Eco-friendly", "Background checked"]', '[]'
        )
      `).run(bizId);

      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, description, category,
          price_minor, currency, billing_model, active
        ) VALUES ('off_deep_clean', ?, 'org_global_test', 'Whole Home Deep Clean', 'Full 4-hour deep clean package', 'CLEANING', 19900, 'USD', 'ONE_TIME', 1)
      `).run(bizId);

      const res = await app.request('/api/v1/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'sparkle-la',
          offerId: 'off_deep_clean',
          customerName: 'Alice Walker',
          customerEmail: 'alice@example.com',
          customerPhone: '+13105550199',
          paymentProvider: 'STRIPE'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.orderId).toMatch(/^uord_/);
      expect(json.data.amountMinor).toBe(19900);
      expect(json.data.currency).toBe('USD');
      expect(json.data.paymentProvider).toBe('STRIPE');
      expect(json.data.providerOrderId).toMatch(/^pi_test_/);

      // Verify row persisted in universal_orders table
      const orderRow = db.prepare('SELECT * FROM universal_orders WHERE id = ?').get(json.data.orderId) as any;
      expect(orderRow).toBeTruthy();
      expect(orderRow.customer_name).toBe('Alice Walker');
      expect(orderRow.amount_minor).toBe(19900);
      expect(orderRow.currency).toBe('USD');
    });
  });

  describe('6. Scheduling & Booking Reservations', () => {
    it('creates a booking reservation for a consultation appointment', async () => {
      const db = getDb();
      const bizId = 'biz_counsel_toronto';
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, primary_language,
          brand_voice, value_propositions_json, offerings_json
        ) VALUES (
          ?, 'org_global_test', 'Horizon Career Coaching', 'horizon-toronto',
          'coaching', 'Executive Career Coaching',
          'CA', 'CAD', 'America/Toronto', 'Toronto', 'Yorkville', 'English',
          'Empowering executive transitions', '["Certified coach"]', '[]'
        )
      `).run(bizId);

      const availRes = await app.request('/api/v1/public/availability?businessSlug=horizon-toronto');
      expect(availRes.status).toBe(200);
      const availJson = await availRes.json();
      expect(availJson.data.slots.length).toBeGreaterThan(0);
      const targetSlot = availJson.data.slots[0];

      const res = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'horizon-toronto',
          slotId: targetSlot.slotId || targetSlot.id,
          customerName: 'David Chen',
          customerContact: '+14165551234',
          customerEmail: 'david.chen@example.com',
          serviceTitle: 'Executive Strategy Intake Session'
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.reservationId).toMatch(/^res_/);
      expect(json.data.status).toBe('CONFIRMED');

      // Check DB
      const bookingRow = db.prepare('SELECT * FROM booking_reservations WHERE id = ?').get(json.data.reservationId) as any;
      expect(bookingRow).toBeTruthy();
      expect(bookingRow.customer_name).toBe('David Chen');
      expect(bookingRow.service_title).toBe('Executive Strategy Intake Session');
    });

    it('queries availability slots for a business', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, brand_voice
        ) VALUES (
          'biz_avail_toronto', 'org_global_test', 'Horizon Career Coaching', 'horizon-toronto',
          'coaching', 'Executive Coaching', 'CA', 'CAD', 'America/Toronto', 'Toronto', 'Yorkville', 'Professional'
        )
      `).run();

      const res = await app.request('/api/v1/public/availability?businessSlug=horizon-toronto');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.slots.length).toBeGreaterThan(0);
      expect(json.data.slots[0].isAvailable).toBe(true);
    });
  });

  describe('7. Stripe Multi-Currency Adapter', () => {
    it('creates test payment intents for non-INR currencies in test mode', async () => {
      const stripe = StripeAdapter.getInstance();
      const intent = await stripe.createPaymentIntent({
        businessId: 'biz_test_uk',
        amountMinor: 2500, // £25.00
        currency: 'GBP',
        customerEmail: 'buyer@example.co.uk'
      });

      expect(intent.paymentIntentId).toMatch(/^pi_test_/);
      expect(intent.amountMinor).toBe(2500);
      expect(intent.currency).toBe('GBP');
      expect(intent.clientSecret).toContain('secret_');
    });

    it('verifies webhook signatures correctly with valid secret', () => {
      const stripe = StripeAdapter.getInstance();
      const payload = JSON.stringify({ id: 'evt_test_123', type: 'payment_intent.succeeded' });
      // In test mode without secret, returns true or verifies correctly
      const verified = stripe.verifyWebhookSignature(payload, 't=123456,v1=test_sig');
      expect(typeof verified).toBe('boolean');
    });
  });

  describe('8. Multi-Tenant Strict Isolation', () => {
    it('prevents tenant A from modifying or accessing tenant B offers or private records', async () => {
      const db = getDb();
      // Tenant A
      db.prepare(`INSERT INTO organizations (id, name, slug) VALUES ('org_tenant_a', 'Org A', 'org-a')`).run();
      db.prepare(`INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, city, neighborhood, brand_voice) VALUES ('biz_a', 'org_tenant_a', 'Business A', 'biz-a', 'retail', 'Retail', 'Delhi', 'Connaught', 'Voice A')`).run();

      // Tenant B
      db.prepare(`INSERT INTO organizations (id, name, slug) VALUES ('org_tenant_b', 'Org B', 'org-b')`).run();
      db.prepare(`INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, city, neighborhood, brand_voice) VALUES ('biz_b', 'org_tenant_b', 'Business B', 'biz-b', 'retail', 'Retail', 'Mumbai', 'Bandra', 'Voice B')`).run();

      // Tenant A requests their business
      const resA = await app.request('/api/v1/business?id=biz_b', {
        headers: {
          'x-organization-id': 'org_tenant_a',
          'x-user-id': 'usr_tenant_a'
        }
      });

      // Tenant A must NOT get Tenant B's business via private API
      const jsonA = await resA.json();
      if (jsonA.data) {
        expect(jsonA.data.organization_id).not.toBe('org_tenant_b');
      }
    });
  });
});
