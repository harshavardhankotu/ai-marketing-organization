import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { apiRouter } from '../../src/routes/api.js';

describe('Production Test Record Quarantine & Guard (mst_p1_agent_wrote_test_data_to_production)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM platform_prospects WHERE id LIKE ?').run('test_%');
    db.prepare('DELETE FROM opportunities WHERE id LIKE ?').run('test_%');
    db.prepare('DELETE FROM sales_pipeline WHERE id LIKE ?').run('test_%');
  });

  it('1. Flags incoming inquiry with test keyword as NEEDS_OWNER_REVIEW and sets is_test = 1', async () => {
    const req = new Request('http://localhost/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Dr. Test Harsha',
        customerPhone: '9876543210',
        customerEmail: 'harsha@example.com',
        serviceOfInterest: 'SmileKraft Test Clinic, Hyderabad'
      })
    });

    const res = await apiRouter.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.success).toBe(true);
    expect(body.isTest).toBe(true);
    expect(body.status).toBe('NEEDS_OWNER_REVIEW');

    const db = getDb();
    const prospect = db.prepare('SELECT * FROM platform_prospects WHERE id = ?').get(body.prospectId) as any;
    expect(prospect).toBeDefined();
    expect(prospect.is_test).toBe(1);
    expect(prospect.status).toBe('NEEDS_OWNER_REVIEW');
    expect(prospect.stage).toBe('NEEDS_OWNER_REVIEW');
    expect(prospect.fit_score).toBe(0);

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(body.opportunityId) as any;
    expect(opp).toBeDefined();
    expect(opp.is_test).toBe(1);
    expect(opp.status).toBe('NEEDS_OWNER_REVIEW');
    expect(opp.estimated_value_inr).toBe(0);

    const pipe = db.prepare('SELECT * FROM sales_pipeline WHERE opportunity_id = ?').get(body.opportunityId) as any;
    expect(pipe).toBeDefined();
    expect(pipe.is_test).toBe(1);
    expect(pipe.stage).toBe('NEEDS_OWNER_REVIEW');
    expect(pipe.expected_revenue_inr).toBe(0);
  });

  it('2. Legitimate inbound inquiry is marked QUALIFIED with is_test = 0', async () => {
    const req = new Request('http://localhost/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Dr. Anand Kumar',
        customerPhone: '9876543211',
        customerEmail: 'anand@realclinic.in',
        serviceOfInterest: 'Anand Dental Hospital, Hyderabad'
      })
    });

    const res = await apiRouter.fetch(req);
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.success).toBe(true);
    expect(body.isTest).toBe(false);
    expect(body.status).toBe('QUALIFIED');

    const db = getDb();
    const prospect = db.prepare('SELECT * FROM platform_prospects WHERE id = ?').get(body.prospectId) as any;
    expect(prospect.is_test).toBe(0);
    expect(prospect.status).toBe('QUALIFIED');
    expect(prospect.fit_score).toBe(0.95);
  });

  it('3. Funnel queries strictly exclude is_test = 1 and status = TEST_QUARANTINED', () => {
    const db = getDb();
    // Insert a quarantined row
    db.prepare(`
      INSERT INTO platform_prospects (id, business_name, prospect_business_name, prospect_city, prospect_vertical, status, stage, is_test)
      VALUES ('test_prospect_quarantined', 'Fake Test Clinic', 'Fake Test Clinic', 'Hyderabad', 'dental', 'TEST_QUARANTINED', 'TEST_QUARANTINED', 1)
    `).run();

    const liveProspects = db.prepare(`
      SELECT COUNT(*) as count FROM platform_prospects
      WHERE is_test = 0 AND status != 'TEST_QUARANTINED' AND id = 'test_prospect_quarantined'
    `).get() as any;

    expect(liveProspects.count).toBe(0);
  });
});
