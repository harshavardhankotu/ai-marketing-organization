import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../../src/db/schema.js';
import { applySqliteMigrations } from '../../src/db/sqlite-migration-runner.js';
import { apiRouter } from '../../src/routes/api.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';

describe('Schema Parity Verification & Inquiry Lifecycle (Steps 2, 3, 4, 6)', () => {
  it('1. Fresh database with SCHEMA_SQL and all migrations prepares every query from funnel, status, and owner routes without missing columns', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    const { applied } = applySqliteMigrations(db);

    expect(applied.length).toBeGreaterThanOrEqual(1);

    // List of every SQL statement used across the funnel, status, owner, and inquiry routes
    const queries = [
      // Funnel & Pipeline queries
      `SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND is_test = 0 AND is_junk = 0`,
      `SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND is_test = 0 AND is_junk = 0 AND stage IN ('CONTACTED','REPLIED','QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`,
      `SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND is_test = 0 AND is_junk = 0 AND stage IN ('REPLIED','QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`,
      `SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND is_test = 0 AND is_junk = 0 AND stage IN ('QUALIFIED','MEETING_BOOKED','PAID','ONBOARDED')`,
      `SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND is_test = 0 AND is_junk = 0 AND stage IN ('MEETING_BOOKED','PAID','ONBOARDED')`,
      `SELECT COUNT(*) as count FROM sales_pipeline WHERE business_id = ? AND is_test = 0 AND is_junk = 0 AND stage IN ('PROPOSAL_SENT','PAID','ONBOARDED')`,
      `SELECT COUNT(*) as count FROM payment_requests WHERE business_id = ? AND is_test = 0`,
      `SELECT COUNT(*) as count FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`,
      `SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND stage = 'CUSTOMER'`,
      `SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND stage = 'ACTIVE'`,
      `SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'`,
      `SELECT COUNT(*) as count FROM demand_signals WHERE organization_id = ?`,
      `SELECT COUNT(*) as count FROM platform_prospects WHERE is_test = 0 AND is_junk = 0`,
      `SELECT COUNT(*) as count FROM platform_prospects WHERE is_test = 0 AND is_junk = 0 AND (fit_score >= 0.70 OR status = 'QUALIFIED')`,
      `SELECT COUNT(*) as count FROM partner_offers WHERE organization_id = ? AND status = 'ACTIVE' AND active = 1`,
      `SELECT COUNT(*) as count FROM commission_content_assets WHERE organization_id = ? AND status IN ('DRAFT', 'PUBLISH_READY', 'PUBLISHED')`,
      `SELECT COUNT(*) as count FROM proposals WHERE is_test = 0 AND status IN ('DRAFT', 'SENT', 'ACCEPTED')`,
      `SELECT COUNT(*) as count FROM proposals WHERE is_test = 0 AND status = 'DRAFT'`,
      `SELECT COUNT(*) as count FROM proposals WHERE is_test = 0 AND status IN ('SENT', 'ACCEPTED')`,
      `SELECT COUNT(*) as count FROM manual_upi_claims WHERE is_test = 0`,
      `SELECT COUNT(*) as count FROM commission_records WHERE organization_id = ? AND status IN ('CONVERSION_REPORTED', 'COMMISSION_PENDING', 'COMMISSION_APPROVED', 'COMMISSION_PAID')`,

      // Status, CEO Dashboard & Owner routes
      `SELECT * FROM businesses WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1`,
      `SELECT * FROM business_goals WHERE organization_id = ?`,
      `SELECT * FROM autonomous_cycle_log WHERE organization_id = ? ORDER BY cycle_start DESC LIMIT 1`,
      `SELECT * FROM provider_quota_state WHERE provider = ?`,
      `SELECT * FROM automation_health WHERE organization_id = ?`,
      `SELECT * FROM cron_telemetry WHERE id = 'cloudflare_worker_cron'`,
      `SELECT * FROM outreach_log WHERE is_test = 0 ORDER BY created_at DESC LIMIT 100`,
      `SELECT * FROM reply_desk_drafts WHERE is_test = 0`,
      `SELECT * FROM reply_desk_query_runs ORDER BY created_at`,
      `SELECT * FROM direct_offer_attestation WHERE offer_id = ?`,
      `SELECT * FROM owner_configuration WHERE id = ?`,
      `SELECT * FROM mistakes_board WHERE status = 'OPEN'`,
      `SELECT * FROM provider_drift_records`,

      // Inbound Offer Inquiry & Deletion statements
      `INSERT OR REPLACE INTO platform_prospects (id, business_name, prospect_business_name, prospect_owner_name, phone, prospect_phone, email, prospect_email, city, prospect_city, vertical, prospect_vertical, source, discovery_source, fit_score, status, stage, is_test, is_junk, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      `UPDATE platform_prospects SET status = 'DELETION_REQUESTED', stage = 'DELETION_REQUESTED', prospect_owner_name = '[DELETED]', email = NULL, prospect_email = NULL, notes = ?, updated_at = datetime('now') WHERE phone LIKE ? OR prospect_phone LIKE ?`,
      `UPDATE customer_journeys SET stage = 'DELETION_REQUESTED', customer_name = '[DELETED]', customer_email = NULL, updated_at = datetime('now') WHERE customer_phone LIKE ?`
    ];

    // Every single query must prepare without throwing an error (fails if any column is missing)
    for (const sql of queries) {
      expect(() => {
        const stmt = db.prepare(sql);
        expect(stmt).toBeDefined();
      }).not.toThrow();
    }

    db.close();
  });

  describe('2. Inquiry Form Consent, Honeypot & Deletion Lifecycle (Step 4)', () => {
    beforeEach(() => {
      resetDbForTesting();
    });

    it('a) Refuses submission without explicit consent (400)', async () => {
      const req = new Request('http://localhost/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. No Consent',
          customerPhone: '9876543299',
          serviceOfInterest: 'Dental Clinic, Hyderabad',
          consentGiven: false
        })
      });

      const res = await apiRouter.fetch(req);
      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toContain('Explicit consent is required');
    });

    it('b) Honeypot field trap returns generic 200 without persisting lead in database', async () => {
      const req = new Request('http://localhost/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Spam Bot',
          customerPhone: '9876543298',
          serviceOfInterest: 'Spam Clinic',
          website_trap: 'http://spam-link.example.com',
          consentGiven: true
        })
      });

      const res = await apiRouter.fetch(req);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.message).toBe('Thank you. The owner will contact you on the number you gave.');

      const db = getDb();
      const count = (db.prepare(`SELECT COUNT(*) as cnt FROM platform_prospects WHERE phone = '9876543298'`).get() as any)?.cnt;
      expect(count).toBe(0);
    });

    it('c) Success message does not promise automated architecture review', async () => {
      const req = new Request('http://localhost/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Real Inquiry',
          customerPhone: '9876543297',
          serviceOfInterest: 'Premier Dental, Hyderabad',
          notes: 'Evening inquiries drop off after 8 PM.',
          consentGiven: true
        })
      });

      const res = await apiRouter.fetch(req);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.message).toBe('Thank you. The owner will contact you on the number you gave.');
      expect(json.message).not.toContain('Automated architecture review');
    });

    it('d) POST /offer/inquiry/delete-request scrubs personal data and marks DELETION_REQUESTED', async () => {
      // First create a legitimate lead
      const postReq = new Request('http://localhost/offer/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Dr. Erasure Test',
          customerPhone: '9876543296',
          customerEmail: 'erasure@testclinic.in',
          serviceOfInterest: 'Erasure Dental Care, Hyderabad',
          consentGiven: true
        })
      });
      await apiRouter.fetch(postReq);

      // Now request deletion
      const delReq = new Request('http://localhost/offer/inquiry/delete-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: '9876543296',
          reason: 'Exercising DPDP right to erasure'
        })
      });

      const delRes = await apiRouter.fetch(delReq);
      expect(delRes.status).toBe(200);
      const delJson = await delRes.json() as any;
      expect(delJson.success).toBe(true);

      const db = getDb();
      const prospect = db.prepare(`SELECT * FROM platform_prospects WHERE phone = '9876543296'`).get() as any;
      expect(prospect).toBeDefined();
      expect(prospect.status).toBe('DELETION_REQUESTED');
      expect(prospect.prospect_owner_name).toBe('[DELETION_REQUESTED]');
      expect(prospect.email).toBeNull();
    });

    it('e) GET /privacy returns DPDP Act 2023 compliance document', async () => {
      const req = new Request('http://localhost/privacy', { method: 'GET' });
      const res = await apiRouter.fetch(req);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Privacy Policy');
      expect(html).toContain('Digital Personal Data Protection (DPDP) Act 2023');
      expect(html).toContain('30 days');
    });
  });

  describe('3. Lane Facts Status & Gated DIRECT_OFFER_TERMS_SHA256 (Step 3)', () => {
    it('returns affiliateLane, directLane, optional groups and flags SET_BY_UNKNOWN without confirmation', async () => {
      const prevConfirmed = process.env.OWN_OFFER_CONFIRMED;
      const prevHash = process.env.DIRECT_OFFER_TERMS_SHA256;
      try {
        delete process.env.OWN_OFFER_CONFIRMED;
        process.env.DIRECT_OFFER_TERMS_SHA256 = 'abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';

        const req = new Request('http://localhost/owner/facts-status', { method: 'GET' });
        const res = await apiRouter.fetch(req);
        expect(res.status).toBe(200);
        const json = await res.json() as any;

        expect(json.success).toBe(true);
        expect(json.data.affiliateLane).toBeDefined();
        expect(json.data.directLane).toBeDefined();
        expect(json.data.optional).toBeDefined();

        expect(json.data.directLane.ready).toBe(false);
        expect(json.data.directLane.missingNames).toContain('OWN_OFFER_CONFIRMED');
        expect(json.data.directLane.invalidNames).toContain('DIRECT_OFFER_TERMS_SHA256');

        const shaFact = json.data.allFacts.find((f: any) => f.field === 'DIRECT_OFFER_TERMS_SHA256');
        expect(shaFact).toBeDefined();
        expect(shaFact.status).toBe('SET_BY_UNKNOWN');
        expect(shaFact.validity).toBe('INVALID');
        expect(shaFact.note).toContain('Delete it in Render or let owner-apply.mjs overwrite it');
      } finally {
        if (prevConfirmed !== undefined) process.env.OWN_OFFER_CONFIRMED = prevConfirmed;
        else delete process.env.OWN_OFFER_CONFIRMED;
        if (prevHash !== undefined) process.env.DIRECT_OFFER_TERMS_SHA256 = prevHash;
        else delete process.env.DIRECT_OFFER_TERMS_SHA256;
      }
    });
  });
});
