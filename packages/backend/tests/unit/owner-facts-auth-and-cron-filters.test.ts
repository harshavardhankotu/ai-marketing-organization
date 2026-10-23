import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { getDb } from '../../src/db/client.js';

describe('Source Code Fixes: Protected facts-status & Cron read filter parity', () => {
  let app: Hono;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    app = new Hono();
    app.route('/api/v1', apiRouter);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('1. Authentication protection on /api/v1/owner/facts-status', () => {
    it('returns 401 Unauthorized for unauthenticated requests in production', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/owner/facts-status', {
        method: 'GET'
      });

      expect(res.status).toBe(401);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('Unauthorized');
    });

    it('returns 200 OK when authenticated with owner x-user-id header in test mode', async () => {
      const res = await app.request('/api/v1/owner/facts-status', {
        method: 'GET',
        headers: {
          'x-user-id': 'usr_owner_primary'
        }
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.siteIdentityLane).toBeDefined();
    });
  });

  describe('2. /api/v1/cron/status read-filter parity', () => {
    it('excludes quarantined, test, and rejected prospects from customerInquiries count', async () => {
      // 1. Get baseline customer inquiries before inserting quarantined/test/rejected rows
      const baseRes = await app.request('/api/v1/cron/status', {
        method: 'GET',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      const baseBody = await baseRes.json() as any;
      const initialCount = baseBody.data.metrics.customerInquiries;

      const db = getDb();
      // Insert test / quarantined prospects into local db
      db.prepare(`
        INSERT OR REPLACE INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_city, prospect_vertical,
          discovery_source, discovery_evidence_json, observed_evidence_json, stage, is_opted_out,
          contact_count, status, source, is_test, is_junk, fit_score, created_at, updated_at
        ) VALUES (
          'test_quarantined_inq_1', 'Quarantined Dental Clinic', 'Quarantined Dental Clinic', 'Hyderabad', 'Dental',
          'DIRECT_INBOUND', '{}', '{}', 'LEAD', 0,
          0, 'QUARANTINED', 'OFFER_PAGE_INQUIRY', 0, 0, 0.8, datetime('now'), datetime('now')
        ), (
          'test_quarantined_inq_2', 'Test Flagged Dental', 'Test Flagged Dental', 'Hyderabad', 'Dental',
          'INBOUND_LEAKAGE_CALCULATOR', '{}', '{}', 'LEAD', 0,
          0, 'TEST_QUARANTINED', 'INBOUND_LEAKAGE_CALCULATOR', 1, 0, 0.8, datetime('now'), datetime('now')
        ), (
          'test_rejected_inq_3', 'Rejected Old Lead', 'Rejected Old Lead', 'Hyderabad', 'Dental',
          'DIRECT_INBOUND', '{}', '{}', 'DISQUALIFIED', 0,
          0, 'REJECTED', 'DIRECT_INBOUND', 0, 0, 0.2, datetime('now'), datetime('now')
        )
      `).run();

      const res = await app.request('/api/v1/cron/status', {
        method: 'GET',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      // Inserting quarantined, test, and rejected rows should NOT increment customerInquiries count
      expect(body.data.metrics.customerInquiries).toBe(initialCount);

      // Clean up test rows
      db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'test_%'`).run();
    });

    it('accurately queries recent autonomous_cycle_log pings with SQLite timestamp formatting', async () => {
      const db = getDb();
      // Insert a recent cycle row using actual column cycle_start
      db.prepare(`
        INSERT OR REPLACE INTO autonomous_cycle_log (
          id, organization_id, trigger_source, cycle_start, status, actions_taken
        ) VALUES (
          'cyc_recent_test_01', 'org_owner_primary', 'CLOUDFLARE_CRON', datetime('now'), 'COMPLETED', 0
        )
      `).run();

      const res = await app.request('/api/v1/cron/status', {
        method: 'GET',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.recentPings24h).toBeGreaterThanOrEqual(1);

      // Clean up
      db.prepare(`DELETE FROM autonomous_cycle_log WHERE id = 'cyc_recent_test_01'`).run();
    });
  });

  describe('3. /api/v1/revenue/funnel exclusions', () => {
    it('excludes rejected and quarantined prospects from discovered and qualified prospect counts', async () => {
      const baseRes = await app.request('/api/v1/revenue/funnel', {
        method: 'GET',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });
      const baseBody = await baseRes.json() as any;
      const initialDiscovered = baseBody.data.stages.find((s: any) => s.id === 'DISCOVERED')?.count || 0;
      const initialQualified = baseBody.data.stages.find((s: any) => s.id === 'QUALIFIED')?.count || 0;

      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO platform_prospects (
          id, business_name, prospect_business_name, prospect_city, prospect_vertical,
          discovery_source, discovery_evidence_json, observed_evidence_json, stage, is_opted_out,
          contact_count, status, is_test, is_junk, fit_score, created_at, updated_at
        ) VALUES (
          'test_funnel_rej_1', 'Rejected Salon', 'Rejected Salon', 'Hyderabad', 'Beauty',
          'DISCOVERY', '{}', '{}', 'DISQUALIFIED', 0,
          0, 'REJECTED', 0, 0, 0.9, datetime('now'), datetime('now')
        ), (
          'test_funnel_quar_2', 'Quarantined Clinic', 'Quarantined Clinic', 'Hyderabad', 'Dental',
          'DISCOVERY', '{}', '{}', 'LEAD', 0,
          0, 'QUARANTINED', 0, 0, 0.85, datetime('now'), datetime('now')
        )
      `).run();

      const res = await app.request('/api/v1/revenue/funnel', {
        method: 'GET',
        headers: { 'x-user-id': 'usr_owner_primary' }
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);

      const afterDiscovered = body.data.stages.find((s: any) => s.id === 'DISCOVERED')?.count || 0;
      const afterQualified = body.data.stages.find((s: any) => s.id === 'QUALIFIED')?.count || 0;

      expect(afterDiscovered).toBe(initialDiscovered);
      expect(afterQualified).toBe(initialQualified);

      // Clean up
      db.prepare(`DELETE FROM platform_prospects WHERE id LIKE 'test_funnel_%'`).run();
    });
  });
});
