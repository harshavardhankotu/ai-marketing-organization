import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';
import { DPDPComplianceManager } from '../../src/compliance/dpdp-manager.js';

describe('Steps 3c, 9d, 9e: Inquiry Lifecycle, D1 Persistence, Purge Job & Deletion Code', () => {
  const db = getDb();
  const testPhone = '919988776655';

  beforeEach(() => {
    try {
      db.prepare(`DELETE FROM platform_prospects WHERE phone LIKE '%9988776655%' OR prospect_phone LIKE '%9988776655%'`).run();
    } catch {}
  });

  afterEach(() => {
    try {
      db.prepare(`DELETE FROM platform_prospects WHERE phone LIKE '%9988776655%' OR prospect_phone LIKE '%9988776655%'`).run();
    } catch {}
  });

  it('Step 9e: Inquiry returns a unique deletionCode and deletes only when code matches', async () => {
    // 1. Submit valid inquiry
    const postReq = new Request('http://localhost/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Dr. Deletion Test',
        customerPhone: testPhone,
        customerEmail: 'deletion@test.in',
        serviceOfInterest: 'Test Clinic, Bangalore',
        consentGiven: true
      })
    });

    const postRes = await apiRouter.fetch(postReq);
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json() as any;
    expect(postJson.success).toBe(true);
    expect(postJson.deletionCode).toBeDefined();
    expect(postJson.deletionCode).toMatch(/^del_[a-f0-9]{16}$/);

    const validCode = postJson.deletionCode;

    // 2. Attempt deletion with WRONG code fails
    const badDelReq = new Request('http://localhost/offer/inquiry/delete-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testPhone,
        code: 'del_wrongcode00000',
        reason: 'Exercising DPDP right to erasure'
      })
    });
    const badDelRes = await apiRouter.fetch(badDelReq);
    expect(badDelRes.status).toBe(403);

    // 3. Deletion with VALID code succeeds
    const goodDelReq = new Request('http://localhost/offer/inquiry/delete-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testPhone,
        code: validCode,
        reason: 'Exercising DPDP right to erasure'
      })
    });
    const goodDelRes = await apiRouter.fetch(goodDelReq);
    expect(goodDelRes.status).toBe(200);
    const goodDelJson = await goodDelRes.json() as any;
    expect(goodDelJson.success).toBe(true);

    // Verify row scrubbed in DB
    const row = db.prepare(`SELECT * FROM platform_prospects WHERE prospect_phone LIKE '%9988776655%' OR phone LIKE '%9988776655%'`).get() as any;
    expect(row).toBeDefined();
    expect(row.status).toBe('DELETION_REQUESTED');
    expect(row.email).toBeNull();
  });

  it('Step 9d: Daily purge job purges unconverted inquiries older than 30 days', () => {
    const expiredPhone = '919988776699';
    const oldDateStr = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();

    // Insert lead created 35 days ago
    db.prepare(`
      INSERT INTO platform_prospects (
        id, business_name, prospect_business_name, prospect_owner_name,
        phone, prospect_phone, email, prospect_email, city, prospect_city, vertical, prospect_vertical,
        source, discovery_source, fit_score, status, stage, is_test, created_at, updated_at
      ) VALUES (
        'prosp_old_35d', 'Old Clinic', 'Old Clinic', 'Dr. Old Lead',
        ?, ?, 'old@clinic.in', 'old@clinic.in', 'Hyderabad', 'Hyderabad', 'dental', 'dental',
        'OFFER_PAGE_INQUIRY', 'DIRECT_INBOUND', 0.9, 'QUALIFIED', 'LEAD', 0, ?, ?
      )
    `).run(expiredPhone, expiredPhone, oldDateStr, oldDateStr);

    const dpdp = DPDPComplianceManager.getInstance();
    const purgeResult = dpdp.purgeExpiredInquiries(30);

    expect(purgeResult.purgedCount).toBeGreaterThanOrEqual(1);

    const purgedRow = db.prepare(`SELECT * FROM platform_prospects WHERE id = 'prosp_old_35d'`).get() as any;
    expect(purgedRow.status).toBe('PURGED_RETENTION_EXPIRED');
    expect(purgedRow.phone).toBeNull();
    expect(purgedRow.email).toBeNull();
    expect(purgedRow.prospect_owner_name).toBe('[PURGED_RETENTION_EXPIRED]');

    // Clean up
    db.prepare(`DELETE FROM platform_prospects WHERE id = 'prosp_old_35d'`).run();
  });
});
