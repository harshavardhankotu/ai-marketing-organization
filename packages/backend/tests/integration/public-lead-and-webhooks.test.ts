import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Public Lead Capture & Payment Webhook Ingestion (Integration)', () => {
  const businessId = 'biz_smilekraft_hyd';
  const orgId = 'org_smilekraft_01';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  it('POST /api/v1/public/lead captures real public patient lead and creates REAL journey', async () => {
    const res = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        organizationId: orgId,
        customerName: 'Aditya Varma',
        customerPhone: '+91-98765-43210',
        customerEmail: 'aditya.varma@gmail.com',
        channel: 'WHATSAPP',
        campaignId: 'camp_seed_aligners_01',
        source: 'meta_ads_gachibowli_campaign',
        serviceOfInterest: 'Invisible Clear Aligners',
        notes: 'Interested in ₹2,999/mo 0% EMI option for aligners',
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.stage).toBe('LEAD');
    expect(json.data.journeyId).toBeDefined();

    // Verify in DB that it was persisted with classification: REAL
    const db = getDb();
    const journeyInDb = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(json.data.journeyId) as any;
    expect(journeyInDb).toBeDefined();
    expect(journeyInDb.customer_name).toBe('Aditya Varma');
    expect(journeyInDb.customer_phone).toBe('+91-98765-43210');
    expect(journeyInDb.classification).toBe('REAL');
    expect(journeyInDb.stage).toBe('LEAD');
  });

  it('POST /api/v1/public/lead rejects invalid phone numbers', async () => {
    const res = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        organizationId: orgId,
        customerName: 'Test Patient',
        customerPhone: '1234', // Invalid short phone number
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Invalid phone number/);
  });

  it('POST /api/v1/revenue/verified-entry records audited REAL revenue', async () => {
    const res = await app.request('/api/v1/revenue/verified-entry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-organization-id': orgId,
        'x-user-id': 'usr_owner_01',
      },
      body: JSON.stringify({
        invoiceNumber: 'INV-CLINIC-VERIFIED-001',
        amountINR: 45000,
        paymentMethod: 'UPI',
        transactionRef: 'upi_phonepe_utr_998822',
        verificationSource: 'BANK_STATEMENT',
        serviceRendered: 'Invisible Clear Aligners - Full 6-Month Course',
        campaignId: 'camp_seed_aligners_01',
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.classification).toBe('REAL');
    expect(json.data.amountINR).toBe(45000);

    // Verify revenue summary now reflects ₹45,000 in REAL revenue
    const sumRes = await app.request('/api/v1/revenue/summary', {
      headers: { 'x-organization-id': orgId },
    });
    const sumJson = await sumRes.json() as any;
    expect(sumJson.data.realRevenueINR).toBe(45000);
  });

  it('POST /api/v1/webhooks/payments/:gateway ingests payment events and avoids duplicates', async () => {
    const webhookPayload = {
      order_id: 'order_hyd_aligner_5521',
      payment_id: 'pay_rzp_webhook_9911',
      amount: 28000,
      payment_method: 'UPI',
      business_id: businessId,
      organization_id: orgId,
      notes: { service: 'Titanium Dental Implant' },
      test_mode: false,
    };

    // First ingestion: SUCCESS
    const res1 = await app.request('/api/v1/webhooks/payments/razorpay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    expect(res1.status).toBe(200);
    const json1 = await res1.json() as any;
    expect(json1.success).toBe(true);
    expect(json1.transactionId).toBeDefined();

    // Replay duplicate webhook: returns 200 with duplicate: true to avoid webhook storm
    const res2 = await app.request('/api/v1/webhooks/payments/razorpay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    expect(res2.status).toBe(200);
    const json2 = await res2.json() as any;
    expect(json2.duplicate).toBe(true);
  });

  it('POST /api/v1/public/lead silently drops bots that fill honeypot fields', async () => {
    const res = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        organizationId: orgId,
        customerName: 'Scraper Bot',
        customerPhone: '+919988776655',
        website_url_hp: 'https://spam-phishing-link.ru/trap', // Filled by scraper bot
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe('FILTERED');
    expect(json.data.leadId).toBe('lead_hp_bot');

    // Confirm no real customer journey was created
    const db = getDb();
    const botRow = db.prepare("SELECT * FROM customer_journeys WHERE customer_name = 'Scraper Bot'").get();
    expect(botRow).toBeUndefined();
  });

  it('POST /api/v1/public/lead records DPDP Act 2023 patient consent', async () => {
    const res = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        organizationId: orgId,
        customerName: 'Pooja Hegde',
        customerPhone: '+91-98765-99887',
        serviceOfInterest: 'Invisible Clear Aligners',
        dpdpConsentGiven: true,
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.data.dpdpConsentCaptured).toBe(true);

    const db = getDb();
    const consentRow = db.prepare("SELECT * FROM patient_dpdp_consents WHERE customer_name = 'Pooja Hegde'").get() as any;
    expect(consentRow).toBeDefined();
    expect(consentRow.status).toBe('ACTIVE');
    expect(consentRow.purpose).toContain('Direct dental consultation coordination');
  });

  it('POST /api/v1/payments/razorpay/create-order generates verified payment order', async () => {
    const res = await app.request('/api/v1/payments/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        amountINR: 45000,
        receipt: 'rcpt_order_aligners_001',
        service: 'Invisible Clear Aligners Deposit'
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.orderId).toBeDefined();
    expect(json.data.amountINR).toBe(45000);
    expect(json.data.currency).toBe('INR');
  });

  it('POST /api/v1/compliance/dpdp/erasure processes Section 12 patient right to erasure', async () => {
    const db = getDb();
    const phone = '+91-99881-12233';

    // Seed patient
    db.prepare(`
      INSERT INTO customer_journeys (
        id, organization_id, business_id, visitor_id, customer_name, customer_phone,
        stage, first_touch_channel, last_touch_channel, touchpoints_json,
        total_lifetime_value_inr, classification, created_at, updated_at
      ) VALUES ('journey_erasure_route', ?, ?, 'vis_era_01', 'Sunil Gavaskar', ?,
        'LEAD', 'WHATSAPP', 'WHATSAPP', '[]', 0, 'REAL', datetime('now'), datetime('now'))
    `).run(orgId, businessId, phone);

    const res = await app.request('/api/v1/compliance/dpdp/erasure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        phoneOrJourneyId: phone,
        reason: 'Patient exercised DPDP Section 12 right to erasure'
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.anonymizedRecordsCount).toBe(1);

    const check = db.prepare("SELECT * FROM customer_journeys WHERE id = 'journey_erasure_route'").get() as any;
    expect(check.customer_name).toContain('Anonymized Patient');
    expect(check.customer_phone).toBeNull();
  });
});
