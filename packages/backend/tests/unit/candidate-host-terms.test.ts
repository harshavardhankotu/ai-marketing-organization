import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';

describe('Candidate Host Terms & Approval Flow (Step 6)', () => {
  let app: Hono;

  const ownerKey = 'test_owner_api_key_valid_12345';

  beforeEach(() => {
    process.env.OWNER_API_KEY = ownerKey;
    const db = getDb();
    // Reset test candidate hosts
    db.prepare(`
      INSERT INTO source_rules (host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes, terms_url, terms_checked_at)
      VALUES ('candidate-test.com', 1, 0, 1, 0, 0, 'Test candidate host', 'https://candidate-test.com/terms', NULL)
      ON CONFLICT(host) DO UPDATE SET
        owner_approved = 0,
        terms_checked_at = NULL,
        terms_url = 'https://candidate-test.com/terms';
    `).run();

    app = new Hono();
    app.route('/api/v1', apiRouter);
  });

  it('rejects approval when terms_checked_at is null', async () => {
    const res = await app.request('/api/v1/owner/demand/source-rules/candidate-test.com/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey }
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('TERMS_NOT_CHECKED');

    const db = getDb();
    const row = db.prepare('SELECT owner_approved FROM source_rules WHERE host = ?').get('candidate-test.com') as any;
    expect(row.owner_approved).toBe(0);
  });

  it('allows owner to confirm reading terms and then successfully approve host', async () => {
    // 1. Confirm reading terms
    const checkRes = await app.request('/api/v1/owner/demand/source-rules/candidate-test.com/check-terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey }
    });

    expect(checkRes.status).toBe(200);
    const checkBody = await checkRes.json() as any;
    expect(checkBody.success).toBe(true);
    expect(checkBody.data.terms_checked_at).toBeDefined();

    // Verify in db
    const db = getDb();
    const afterCheck = db.prepare('SELECT terms_checked_at, owner_approved FROM source_rules WHERE host = ?').get('candidate-test.com') as any;
    expect(afterCheck.terms_checked_at).not.toBeNull();
    expect(afterCheck.owner_approved).toBe(0);

    // 2. Approve host
    const approveRes = await app.request('/api/v1/owner/demand/source-rules/candidate-test.com/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ownerKey }
    });

    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json() as any;
    expect(approveBody.success).toBe(true);
    expect(approveBody.data.owner_approved).toBe(true);

    const afterApprove = db.prepare('SELECT owner_approved FROM source_rules WHERE host = ?').get('candidate-test.com') as any;
    expect(afterApprove.owner_approved).toBe(1);
  });
});
