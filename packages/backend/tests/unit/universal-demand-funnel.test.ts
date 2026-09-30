import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import app from '../../src/index.js';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Universal Demand-Capture Funnel and Tenant Resolution', () => {
  const originalEnv = { ...process.env };
  const orgId = 'org_smilekraft_01';
  const businessId = 'biz_smilekraft_hyd';

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbForTesting();
    seedDatabase();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('GET /api/v1/public/business/:slug returns sanitized public business profile by id or slug', async () => {
    const db = getDb();
    // Verify seeded business has public_slug backfilled
    const biz = db.prepare('SELECT id, public_slug FROM businesses WHERE id = ?').get(businessId) as any;
    expect(biz).toBeDefined();
    expect(biz.public_slug).toBeDefined();

    // Query via public slug
    const res = await app.request(`/api/v1/public/business/${biz.public_slug}`);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.id).toBe(businessId);
    expect(json.data.name).toBe('SmileKraft Dental Clinic Hyderabad');
    expect(json.data.public_slug).toBe(biz.public_slug);
    // Ensure sensitive fields (kill switch, constraints, brand voice, budget) are not leaked
    expect(json.data.kill_switch_active).toBeUndefined();
    expect(json.data.brand_voice).toBeUndefined();
    expect(json.data.constraints_json).toBeUndefined();

    // Query via id as slug
    const resId = await app.request(`/api/v1/public/business/${businessId}`);
    expect(resId.status).toBe(200);
    const jsonId = await resId.json() as any;
    expect(jsonId.success).toBe(true);
    expect(jsonId.data.id).toBe(businessId);
  });

  it('GET /api/v1/public/business/:slug returns 404 for non-existent business', async () => {
    const res = await app.request('/api/v1/public/business/non-existent-business-xyz-999');
    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.success).toBe(false);
    expect(json.error).toContain('PUBLIC_BUSINESS_NOT_FOUND');
  });

  it('POST /api/v1/public/lead rejects requests without businessId and without businessSlug', async () => {
    const res = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Anonymous Visitor',
        customerPhone: '+1-415-555-2671'
      })
    });

    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.success).toBe(false);
    expect(json.error).toContain('PUBLIC_BUSINESS_REQUIRED');
  });

  it('POST /api/v1/public/lead resolves tenant via businessSlug and stores intent metadata in notes', async () => {
    const db = getDb();
    const biz = db.prepare('SELECT id, public_slug FROM businesses WHERE id = ?').get(businessId) as any;

    const res = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessSlug: biz.public_slug,
        customerName: 'Jane Doe',
        customerPhone: '+44 7911 123456',
        customerEmail: 'jane.doe@example.co.uk',
        intent: 'Emergency roof leak repair',
        funnelSlug: 'roof-leak-urgent',
        landingPage: `/f/${biz.public_slug}/roof-leak-urgent`,
        location: 'London',
        notes: 'Needs immediate assistance after storm damage',
        consentGiven: true
      })
    });

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.journeyId).toBeDefined();

    const journey = db.prepare('SELECT * FROM customer_journeys WHERE id = ?').get(json.data.journeyId) as any;
    expect(journey).toBeDefined();
    expect(journey.business_id).toBe(businessId);
    expect(journey.customer_name).toBe('Jane Doe');
    expect(journey.customer_phone).toBe('+44 7911 123456');

    const touchpoints = JSON.parse(journey.touchpoints_json || '[]');
    expect(touchpoints.length).toBeGreaterThan(0);
    const notes = touchpoints[0].metadata?.notes || '';
    expect(notes).toContain('Intent: Emergency roof leak repair');
    expect(notes).toContain('Funnel: roof-leak-urgent');
    expect(notes).toContain('Landing: /f/');
    expect(notes).toContain('Location: London');
  });

  it('POST /api/v1/public/lead accepts international phone numbers (8 to 15 digits)', async () => {
    // Valid US number (+1 415 555 2671 -> 11 digits)
    const resUS = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        customerName: 'US Customer',
        customerPhone: '+1-415-555-2671'
      })
    });
    expect(resUS.status).toBe(201);

    // Invalid short phone number (< 8 digits)
    const resShort = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        customerName: 'Short Phone',
        customerPhone: '12345'
      })
    });
    expect(resShort.status).toBe(400);

    // Invalid long phone number (> 15 digits)
    const resLong = await app.request('/api/v1/public/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessId,
        customerName: 'Long Phone',
        customerPhone: '+123456789012345678'
      })
    });
    expect(resLong.status).toBe(400);
  });

  it('POST /api/v1/business creates business with public_slug and resolves collision', async () => {
    const createRes1 = await app.request('/api/v1/business', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'usr_owner_01',
        'x-organization-id': orgId
      },
      body: JSON.stringify({
        name: 'Apex Roof Care',
        verticalId: 'vert_roofing',
        verticalName: 'Roofing Services',
        country: 'US',
        currency: 'USD',
        timezone: 'America/Chicago',
        city: 'Austin',
        neighborhood: 'Downtown',
        primaryLanguage: 'English',
        secondaryLanguages: ['Spanish'],
        brandVoice: 'Professional',
        valuePropositions: ['24/7 Rapid Response'],
        offerings: [{
          title: 'Roof Inspection',
          description: 'Full roof drone & physical inspection',
          priceINR: 2000,
          targetSegment: 'Homeowners'
        }],
        monthlyBudgetINR: 50000,
        autonomyMode: 'ASSISTED'
      })
    });
    expect(createRes1.status).toBe(200);
    const json1 = await createRes1.json() as any;
    expect(json1.success).toBe(true);
    expect(json1.data.publicSlug).toBe('apex-roof-care');

    // Create duplicate name -> collision resolved with -2
    const createRes2 = await app.request('/api/v1/business', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'usr_owner_01',
        'x-organization-id': orgId
      },
      body: JSON.stringify({
        name: 'Apex Roof Care',
        verticalId: 'vert_roofing',
        verticalName: 'Roofing Services',
        country: 'US',
        currency: 'USD',
        timezone: 'America/Chicago',
        city: 'Dallas',
        neighborhood: 'North',
        primaryLanguage: 'English',
        secondaryLanguages: ['Spanish'],
        brandVoice: 'Professional',
        valuePropositions: ['Commercial Roofing'],
        offerings: [{
          title: 'Commercial Inspection',
          description: 'Commercial flat-roof thermal audit',
          priceINR: 5000,
          targetSegment: 'Commercial property managers'
        }],
        monthlyBudgetINR: 60000,
        autonomyMode: 'ASSISTED'
      })
    });
    expect(createRes2.status).toBe(200);
    const json2 = await createRes2.json() as any;
    expect(json2.success).toBe(true);
    expect(json2.data.publicSlug).toBe('apex-roof-care-2');
  });
});
