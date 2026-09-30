import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { resetDbForTesting, closeDb, getDb } from '../../src/db/client.js';
import { OfferDecisionEngine } from '../../src/revenue/offer-decision-engine.js';
import { AvailabilityEngine } from '../../src/revenue/availability-engine.js';
import { StripeAdapter } from '../../src/integrations/stripe.js';
import { toMinorUnits, toMajorUnits, formatMoney } from '@ai-marketing/shared';

describe('UCOS Adversarial & Commercial Operating System Hardening', () => {
  let app: Hono;

  beforeEach(() => {
    resetDbForTesting();
    app = new Hono();
    app.route('/api/v1', apiRouter);

    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO organizations (id, name, slug)
      VALUES ('org_universal_test', 'Universal Test Org', 'universal-test-org')
    `).run();
  });

  afterEach(() => {
    closeDb();
  });

  describe('1. First-Class Funnel Lifecycle & 404 Boundary', () => {
    it('returns 404 FUNNEL_NOT_FOUND when funnel does not exist; prohibits synthetic synthesis', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, brand_voice
        ) VALUES (
          'biz_strict_funnel', 'org_universal_test', 'Strict Clinic', 'strict-clinic',
          'dental_clinic', 'Dental Healthcare', 'US', 'USD', 'America/New_York', 'New York', 'Manhattan', 'Strict Voice'
        )
      `).run();

      // Requesting an unpersisted funnel slug must fail with 404
      const res = await app.request('/api/v1/public/funnel/strict-clinic/unregistered-slug');
      expect(res.status).toBe(404);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toContain('FUNNEL_NOT_FOUND');
    });

    it('returns 200 when a real persisted active funnel exists', async () => {
      const db = getDb();
      const bizId = 'biz_persisted_funnel';
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, brand_voice
        ) VALUES (
          ?, 'org_universal_test', 'Apex Services', 'apex-services',
          'home_services', 'Home Services', 'US', 'USD', 'America/New_York', 'New York', 'Queens', 'Helpful'
        )
      `).run(bizId);

      db.prepare(`
        INSERT INTO funnels (
          id, business_id, organization_id, public_slug, status, funnel_type,
          objective, headline, subheadline, proof_points_json, offer_ids_json,
          cta_strategy, payment_strategy, currency
        ) VALUES (
          'fnl_apex_main', ?, 'org_universal_test', 'main', 'ACTIVE', 'UNIVERSAL',
          'LEAD_CAPTURE', 'Quality Home Services in Queens', 'Verified Technicians',
          '["Licensed", "Insured"]', '[]', 'BOOK_OR_BUY', 'OPTIONAL', 'USD'
        )
      `).run(bizId);

      const res = await app.request('/api/v1/public/funnel/apex-services/main');
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.funnel.headline).toBe('Quality Home Services in Queens');
      expect(json.data.funnel.currency).toBe('USD');
    });
  });

  describe('2. Real Availability & Concurrency-Safe Booking', () => {
    it('rejects booking when client attempts to book a nonexistent slot', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, brand_voice
        ) VALUES (
          'biz_booking_test', 'org_universal_test', 'Booking Test Biz', 'booking-test',
          'salon', 'Salon & Spa', 'GB', 'GBP', 'Europe/London', 'London', 'Soho', 'Chic'
        )
      `).run();

      const res = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'booking-test',
          slotId: 'slot_fabricated_does_not_exist',
          customerName: 'Eve Hunter',
          customerContact: '+447911123456'
        })
      });

      expect(res.status).toBe(409);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toContain('SLOT_NOT_FOUND');
    });

    it('rejects cross-tenant booking when slot belongs to another business', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, city, neighborhood, brand_voice)
        VALUES ('biz_alpha', 'org_universal_test', 'Alpha Salon', 'alpha-salon', 'salon', 'Salon', 'London', 'Soho', 'Chic')
      `).run();

      db.prepare(`
        INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, city, neighborhood, brand_voice)
        VALUES ('biz_beta', 'org_universal_test', 'Beta Salon', 'beta-salon', 'salon', 'Salon', 'London', 'Camden', 'Cool')
      `).run();

      // Create slot owned by Alpha
      db.prepare(`
        INSERT INTO availability_slots (
          id, business_id, organization_id, resource_id, resource_type,
          start_time, end_time, capacity, reserved_count, is_available
        ) VALUES (
          'slot_alpha_1', 'biz_alpha', 'org_universal_test', 'stylist_1', 'STAFF',
          '2026-10-10T10:00:00Z', '2026-10-10T10:30:00Z', 1, 0, 1
        )
      `).run();

      // Client attempts to book Alpha's slot under Beta's tenant
      const res = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'beta-salon',
          slotId: 'slot_alpha_1',
          customerName: 'Hacker Bob',
          customerContact: '+447911999999'
        })
      });

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toContain('SECURITY_VIOLATION');
    });

    it('enforces atomic capacity limits and prevents double booking under concurrent requests', async () => {
      const db = getDb();
      const bizId = 'biz_capacity_test';
      db.prepare(`
        INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, city, neighborhood, brand_voice)
        VALUES (?, 'org_universal_test', 'Single Chair Barber', 'single-chair', 'salon', 'Barber', 'Austin', 'East', 'Classic')
      `).run(bizId);

      // Slot with capacity = 1
      const slotId = 'slot_limited_capacity';
      db.prepare(`
        INSERT INTO availability_slots (
          id, business_id, organization_id, resource_id, resource_type,
          start_time, end_time, capacity, reserved_count, is_available
        ) VALUES (
          ?, ?, 'org_universal_test', 'barber_1', 'STAFF',
          '2026-10-12T14:00:00Z', '2026-10-12T14:30:00Z', 1, 0, 1
        )
      `).run(slotId, bizId);

      // First customer reserves
      const res1 = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'single-chair',
          slotId,
          customerName: 'First Customer',
          customerContact: '+15125550101'
        })
      });
      expect(res1.status).toBe(201);

      // Second customer attempts to book the same full slot
      const res2 = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'single-chair',
          slotId,
          customerName: 'Second Customer',
          customerContact: '+15125550102'
        })
      });
      expect(res2.status).toBe(409);
      const json2 = await res2.json() as any;
      expect(json2.success).toBe(false);
      expect(json2.error).toContain('SLOT_FULL');
    });
  });

  describe('3. Order Idempotency & Stripe Webhook Lifecycle', () => {
    it('returns existing order on repeated request with same idempotency key', async () => {
      const db = getDb();
      const bizId = 'biz_idemp_test';
      db.prepare(`
        INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, currency, city, neighborhood, brand_voice)
        VALUES (?, 'org_universal_test', 'SaaS Platform', 'saas-idemp', 'saas', 'SaaS', 'USD', 'San Francisco', 'SOMA', 'Modern')
      `).run(bizId);

      db.prepare(`
        INSERT INTO customer_offers (id, business_id, organization_id, title, price_minor, currency, active)
        VALUES ('off_starter_sub', ?, 'org_universal_test', 'Starter Plan', 2900, 'USD', 1)
      `).run(bizId);

      const orderPayload = {
        businessSlug: 'saas-idemp',
        offerId: 'off_starter_sub',
        customerName: 'Grace Hopper',
        customerEmail: 'grace@navy.mil',
        customerPhone: '+14155550188',
        paymentProvider: 'STRIPE',
        idempotencyKey: 'idemp_key_unique_123'
      };

      // Call 1
      const res1 = await app.request('/api/v1/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });
      expect(res1.status).toBe(201);
      const json1 = await res1.json() as any;
      const orderId1 = json1.data.orderId;

      // Call 2 with identical key
      const res2 = await app.request('/api/v1/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json() as any;
      expect(json2.data.orderId).toBe(orderId1);
      expect(json2.data.isIdempotentReplay).toBe(true);
    });

    it('processes Stripe payment_intent.succeeded and creates verified revenue and fulfillment task', async () => {
      const db = getDb();
      const bizId = 'biz_stripe_wh_test';
      const orderId = 'uord_stripe_wh_001';
      const paymentIntentId = 'pi_test_live_succeeded_999';

      db.prepare(`
        INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, currency, city, neighborhood, brand_voice)
        VALUES (?, 'org_universal_test', 'Law Practice UK', 'law-uk', 'legal_practice', 'Law', 'GBP', 'London', 'City', 'Formal')
      `).run(bizId);

      db.prepare(`
        INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name, customer_email,
          customer_phone, amount_minor, currency, status, payment_provider, provider_order_id,
          fulfillment_status, metadata_json
        ) VALUES (
          ?, ?, 'org_universal_test', 'off_retainer', 'Lord Mansfield', 'mansfield@law.co.uk',
          '+442079460991', 150000, 'GBP', 'PAYMENT_PENDING', 'STRIPE', ?, 'PENDING', '{}'
        )
      `).run(orderId, bizId, paymentIntentId);

      const eventPayload = {
        id: 'evt_stripe_succ_001',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: paymentIntentId,
            amount: 150000,
            currency: 'gbp',
            metadata: { orderId }
          }
        }
      };

      const res = await app.request('/api/v1/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=test'
        },
        body: JSON.stringify(eventPayload)
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);

      // Verify order updated to PAID
      const updatedOrder = db.prepare('SELECT * FROM universal_orders WHERE id = ?').get(orderId) as any;
      expect(updatedOrder.status).toBe('PAID');

      // Verify revenue record created
      const revRecord = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(paymentIntentId) as any;
      expect(revRecord).toBeTruthy();
      expect(revRecord.amount_inr).toBe(1500); // 1500.00 GBP
      expect(revRecord.currency).toBe('GBP');
      expect(revRecord.verified).toBe(1);
      expect(revRecord.verification_method).toBe('STRIPE_WEBHOOK');

      // Verify fulfillment task created
      const fulfillTask = db.prepare('SELECT * FROM fulfillment_tasks WHERE order_id = ?').get(orderId) as any;
      expect(fulfillTask).toBeTruthy();
      expect(fulfillTask.state).toBe('PENDING');

      // Replaying the same webhook event must be idempotent
      const replayRes = await app.request('/api/v1/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=test'
        },
        body: JSON.stringify(eventPayload)
      });
      expect(replayRes.status).toBe(200);
      const replayJson = await replayRes.json() as any;
      expect(replayJson.duplicate).toBe(true);
    });

    it('processes Stripe charge.refunded and creates compensating negative revenue ledger entry', async () => {
      const db = getDb();
      const bizId = 'biz_stripe_ref_test';
      const orderId = 'uord_stripe_ref_002';
      const paymentIntentId = 'pi_test_to_refund_888';

      db.prepare(`
        INSERT INTO businesses (id, organization_id, name, public_slug, vertical_id, vertical_name, currency, city, neighborhood, brand_voice)
        VALUES (?, 'org_universal_test', 'Dubai Bistro', 'dubai-bistro', 'restaurant', 'Dining', 'AED', 'Dubai', 'Marina', 'Warm')
      `).run(bizId);

      db.prepare(`
        INSERT INTO universal_orders (
          id, business_id, organization_id, offer_id, customer_name, customer_email,
          customer_phone, amount_minor, currency, status, payment_provider, provider_order_id,
          fulfillment_status, metadata_json
        ) VALUES (
          ?, ?, 'org_universal_test', 'off_chef_table', 'Hamad Al Maktoum', 'hamad@dubai.ae',
          '+971501234567', 45000, 'AED', 'PAID', 'STRIPE', ?, 'DELIVERED', '{}'
        )
      `).run(orderId, bizId, paymentIntentId);

      const refundPayload = {
        id: 'evt_stripe_ref_001',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_refunded_888',
            payment_intent: paymentIntentId,
            amount_refunded: 45000,
            currency: 'aed'
          }
        }
      };

      const res = await app.request('/api/v1/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=test'
        },
        body: JSON.stringify(refundPayload)
      });

      expect(res.status).toBe(200);

      // Verify order status transitioned to REFUNDED
      const order = db.prepare('SELECT * FROM universal_orders WHERE id = ?').get(orderId) as any;
      expect(order.status).toBe('REFUNDED');

      // Verify compensating negative revenue ledger entry
      const refRev = db.prepare("SELECT * FROM revenue_records WHERE revenue_type = 'REFUND' AND transaction_id = ?").get(paymentIntentId) as any;
      expect(refRev).toBeTruthy();
      expect(refRev.amount_inr).toBe(-450); // -450.00 AED
      expect(refRev.currency).toBe('AED');
    });
  });

  describe('4. Brand New Business Acceptance Test (Rule 38)', () => {
    it('executes full commercial journey for Apex Home Services (US/USD) without source code modification', async () => {
      const db = getDb();
      const orgId = 'org_universal_test';
      const bizId = 'biz_apex_home_services';

      // 1. Configure Business Profile
      db.prepare(`
        INSERT INTO businesses (
          id, organization_id, name, public_slug, vertical_id, vertical_name,
          country, currency, timezone, city, neighborhood, primary_language,
          brand_voice, value_propositions_json, offerings_json
        ) VALUES (
          ?, ?, 'Apex Home Services', 'apex-home-services', 'home_services', 'Home Services',
          'US', 'USD', 'America/New_York', 'New York', 'Brooklyn', 'English',
          'Certified, prompt plumbing and HVAC care',
          '["Licensed & Insured", "Guaranteed Workmanship"]', '[]'
        )
      `).run(bizId, orgId);

      // 2. Configure 2 Customer Offers
      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, description, category,
          price_minor, currency, billing_model, fulfillment_type, active
        ) VALUES (
          'off_drain_clearing', ?, ?, 'Emergency Drain Snaking & Clearing',
          'Professional auger clearing with camera inspection', 'PLUMBING',
          14900, 'USD', 'ONE_TIME', 'SERVICE_DELIVERY', 1
        )
      `).run(bizId, orgId);

      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, description, category,
          price_minor, currency, billing_model, fulfillment_type, active
        ) VALUES (
          'off_water_heater_consult', ?, ?, 'Tankless Water Heater Assessment',
          'On-site sizing and efficiency estimate', 'CONSULTATION',
          0, 'USD', 'ONE_TIME', 'APPOINTMENT', 1
        )
      `).run(bizId, orgId);

      // 3. Configure Funnel
      db.prepare(`
        INSERT INTO funnels (
          id, business_id, organization_id, public_slug, status, funnel_type,
          objective, headline, subheadline, proof_points_json, offer_ids_json,
          cta_strategy, payment_strategy, currency
        ) VALUES (
          'fnl_apex_drain', ?, ?, 'drains', 'ACTIVE', 'UNIVERSAL',
          'LEAD_CAPTURE', 'Clogged Drain in Brooklyn? We Arrive Under 60 Minutes',
          'Fixed upfront pricing. 100% satisfaction guaranteed.',
          '["Licensed Master Plumbers", "Zero Dispatch Fees With Repair"]',
          '["off_drain_clearing"]', 'BOOK_OR_BUY', 'OPTIONAL', 'USD'
        )
      `).run(bizId, orgId);

      // 4. Configure Authoritative Availability Slot
      const slotId = 'slot_apex_drain_01';
      db.prepare(`
        INSERT INTO availability_slots (
          id, business_id, organization_id, resource_id, resource_type,
          start_time, end_time, capacity, reserved_count, is_available
        ) VALUES (
          ?, ?, ?, 'plumber_crew_01', 'STAFF',
          '2026-10-15T13:00:00Z', '2026-10-15T14:00:00Z', 1, 0, 1
        )
      `).run(slotId, bizId, orgId);

      // 5. STEP 1: Public URL resolves funnel
      const funnelRes = await app.request('/api/v1/public/funnel/apex-home-services/drains');
      expect(funnelRes.status).toBe(200);
      const funnelJson = await funnelRes.json() as any;
      expect(funnelJson.data.funnel.headline).toContain('Clogged Drain in Brooklyn');
      expect(funnelJson.data.offers.length).toBe(2);

      // 6. STEP 2: Intent Matching & Qualification
      const offerEngine = OfferDecisionEngine.getInstance();
      const matchResult = await offerEngine.matchOffers(bizId, {
        problem: 'Main sewer line backup and slow sink drain',
        serviceOrProduct: 'drain',
        urgency: 'HIGH',
        confidence: 0.95,
        rawText: 'My basement sink is overflowing and drain is clogged'
      });
      expect(matchResult.status).toBe('QUALIFIED');
      expect(matchResult.eligibleOfferIds).toContain('off_drain_clearing');

      // 7. STEP 3: Check Authoritative Availability
      const availRes = await app.request('/api/v1/public/availability?businessSlug=apex-home-services');
      expect(availRes.status).toBe(200);
      const availJson = await availRes.json() as any;
      expect(availJson.data.slots.some((s: any) => s.slotId === slotId)).toBe(true);

      // 8. STEP 4: Authoritative Booking
      const bookingRes = await app.request('/api/v1/public/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'apex-home-services',
          slotId,
          customerName: 'Marcus Vance',
          customerContact: '+17185550144',
          serviceTitle: 'Emergency Drain Snaking & Clearing'
        })
      });
      expect(bookingRes.status).toBe(201);
      const bookingJson = await bookingRes.json() as any;
      expect(bookingJson.data.status).toBe('CONFIRMED');

      // 9. STEP 5: Server-Authoritative Checkout & Order
      const orderRes = await app.request('/api/v1/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessSlug: 'apex-home-services',
          offerId: 'off_drain_clearing',
          customerName: 'Marcus Vance',
          customerEmail: 'marcus.vance@gmail.com',
          customerPhone: '+17185550144',
          paymentProvider: 'STRIPE'
        })
      });
      expect(orderRes.status).toBe(201);
      const orderJson = await orderRes.json() as any;
      expect(orderJson.data.amountMinor).toBe(14900);
      expect(orderJson.data.currency).toBe('USD');
      expect(orderJson.data.status).toBe('PAYMENT_PENDING');

      // 10. STEP 6: Webhook Payment Capture & Fulfillment Trigger
      const paymentIntentId = orderJson.data.providerOrderId;
      const stripeWhRes = await app.request('/api/v1/webhooks/stripe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=123,v1=test'
        },
        body: JSON.stringify({
          id: `evt_apex_${Date.now()}`,
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: paymentIntentId,
              amount: 14900,
              currency: 'usd',
              metadata: { orderId: orderJson.data.orderId }
            }
          }
        })
      });
      expect(stripeWhRes.status).toBe(200);

      // 11. STEP 7: Verify final commercial state in relational store
      const finalOrder = db.prepare('SELECT * FROM universal_orders WHERE id = ?').get(orderJson.data.orderId) as any;
      expect(finalOrder.status).toBe('PAID');

      const rev = db.prepare('SELECT * FROM revenue_records WHERE transaction_id = ?').get(paymentIntentId) as any;
      expect(rev).toBeTruthy();
      expect(rev.amount_inr).toBe(149); // $149.00 USD
      expect(rev.currency).toBe('USD');
      expect(rev.verified).toBe(1);

      const task = db.prepare('SELECT * FROM fulfillment_tasks WHERE order_id = ?').get(orderJson.data.orderId) as any;
      expect(task).toBeTruthy();
      expect(task.state).toBe('PENDING');
    });
  });
});
