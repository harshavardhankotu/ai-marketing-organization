import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import app from '../../src/index.js';
import { getDb } from '../../src/db/client.js';
import { DURABLE_REQUIRED_TABLES } from '../../src/db/d1-client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { TelegramBotAdapter } from '../../src/notifications/telegram-adapter.js';
import { EventTracker } from '../../src/analytics/event-tracker.js';
import { EXACT_ROUTE_POLICY } from '../../src/routes/api.js';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('PR #98: Education Lead Intake, Durable D1 Batch, Fast Owner Inbox & Mobile/Demo Truth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('1. DURABLE_REQUIRED_TABLES includes platform_prospects, opportunities, and sales_pipeline and blocks production SQLite fallback', async () => {
    expect(DURABLE_REQUIRED_TABLES).toContain('platform_prospects');
    expect(DURABLE_REQUIRED_TABLES).toContain('opportunities');
    expect(DURABLE_REQUIRED_TABLES).toContain('sales_pipeline');

    process.env.NODE_ENV = 'production';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf_acc_pr98_test';
    process.env.CLOUDFLARE_D1_DATABASE_ID = 'cf_db_pr98_test';
    process.env.CLOUDFLARE_D1_API_TOKEN = 'cf_tok_pr98_test';

    const { D1Client } = await import('../../src/db/d1-client.js');
    vi.spyOn(D1Client.getInstance(), 'isRemoteD1WriteAllowed').mockReturnValue(false);

    const repo = D1RevenueRepository.getInstance();
    await expect(
      repo.executeWrite('platform_prospects', 'SELECT 1', [])
    ).rejects.toThrow(/D1_DURABLE_WRITE_UNAVAILABLE/);

    await expect(
      repo.executeBatch([{ table: 'sales_pipeline', sql: 'SELECT 1', params: [] }])
    ).rejects.toThrow(/D1_DURABLE_WRITE_UNAVAILABLE/);
  });

  it('2. POST /api/v1/offer/inquiry stores education vertical, extracts URL evidence cleanly, sets zero fake values, omits customer_journeys, and echoes zero PII', async () => {
    const res = await app.request('/api/v1/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Sandeep Reddy',
        customerPhone: '9849011223',
        customerEmail: 'founder@pragaticoding.in',
        serviceOfInterest: 'Pragati Coding Institute, Hyderabad',
        notes: 'Need mobile form repair for https://pragaticoding.in/courses asap.',
        consentGiven: true
      })
    });

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.status).toBe('PENDING_OWNER_REVIEW');
    expect(json.deletionCode).toMatch(/^del_/);
    expect(json.journeyId).toBeUndefined();
    expect(json.structuredTriageRecord).toBeUndefined();
    expect(json.calendarIcs).toBeUndefined();
    expect(json.csvRow).toBeUndefined();
    const rawResp = JSON.stringify(json);
    expect(rawResp).not.toContain('9849011223');
    expect(rawResp).not.toContain('founder@pragaticoding.in');

    const db = getDb();
    const p = db.prepare('SELECT * FROM platform_prospects WHERE id = ?').get(json.prospectId) as any;
    expect(p.vertical).toBe('education');
    expect(p.prospect_vertical).toBe('education');
    expect(p.source).toBe('OFFER_PAGE_INQUIRY');
    expect(p.discovery_source).toBe('DIRECT_INBOUND');
    expect(p.fit_score).toBe(0);
    expect(p.prospect_website).toBe('https://pragaticoding.in/courses');
    expect(p.is_test).toBe(0);

    const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(json.opportunityId) as any;
    expect(opp.estimated_value_inr).toBe(0);
    expect(opp.probability).toBe(0);
    expect(opp.next_best_action).toBe('OWNER_REVIEW_INBOUND_ENQUIRY');

    const pipe = db.prepare('SELECT * FROM sales_pipeline WHERE id = ?').get(json.pipelineId) as any;
    expect(pipe.stage).toBe('LEAD');
    expect(pipe.journey_id).toBeNull();
    expect(pipe.expected_revenue_inr).toBe(0);
  });

  it('3. Enforces honeypot, consent, and HTTP 503 when D1 batch fails', async () => {
    const noConsent = await app.request('/api/v1/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Consent Missing',
        customerPhone: '9849011223',
        serviceOfInterest: 'Demo Academy',
        consentGiven: false
      })
    });
    expect(noConsent.status).toBe(400);

    const hp = await app.request('/api/v1/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Bot User',
        customerPhone: '9849099887',
        website_trap: 'https://spam.invalid',
        consentGiven: true
      })
    });
    expect(hp.status).toBe(200);
    expect(getDb().prepare('SELECT COUNT(*) as c FROM platform_prospects WHERE phone = ?').get('9849099887')).toEqual({ c: 0 });

    const spy = vi.spyOn(D1RevenueRepository.getInstance(), 'executeBatch').mockRejectedValue(
      new Error('SERVICE_UNAVAILABLE: D1_DURABLE_WRITE_UNAVAILABLE: timeout')
    );
    const failRes = await app.request('/api/v1/offer/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'D1 Fail User',
        customerPhone: '9849011223',
        serviceOfInterest: 'Pragati Coding Institute, Hyderabad',
        consentGiven: true
      })
    });
    expect(failRes.status).toBe(503);
    spy.mockRestore();
  });

  it('4. TelegramBotAdapter.notifyInquiry uses Business / Institute heading with zero clinic wording', async () => {
    process.env.TELEGRAM_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = '123456:FakeTestToken';
    process.env.TELEGRAM_OWNER_CHAT_ID = '987654321';

    const adapter = TelegramBotAdapter.getInstance();
    const sentTexts: string[] = [];
    vi.spyOn(adapter, 'sendMessage').mockImplementation(async (text: string) => {
      sentTexts.push(text);
      return { sent: true, messageId: 1 };
    });

    await adapter.notifyInquiry({
      customerName: 'Kiran Rao',
      customerPhone: '9849012345',
      businessName: 'Pragati Coding Institute',
      need: 'Mobile enquiry repair'
    });

    expect(sentTexts.length).toBe(1);
    expect(sentTexts[0]).toContain('*Business / Institute:* Pragati Coding Institute');
    expect(sentTexts[0]).toContain('******2345');
    expect(sentTexts[0]).not.toMatch(/Clinic \/ Practice/i);
  });

  it('5. GET /api/v1/owner/enquiries requires owner auth (401 unauthenticated) and returns bounded education leads when authenticated', async () => {
    expect(EXACT_ROUTE_POLICY.PUBLIC).not.toContain('/owner/enquiries');

    process.env.NODE_ENV = 'production';
    process.env.OWNER_API_KEY = 'pr98_owner_test_key_only';

    const unauth = await app.request('/api/v1/owner/enquiries');
    expect(unauth.status).toBe(401);

    const session = OwnerAuthService.getInstance().createSession('127.0.0.1');
    const authRes = await app.request('/api/v1/owner/enquiries', {
      headers: { 'Cookie': `owner_session=${session.token}` }
    });
    expect(authRes.status).toBe(200);
    const body = await authRes.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data.enquiries)).toBe(true);
  });

  it('6. EventTracker.getDashboardMetrics returns 0 revenueINR (never hardcoded 148000) and UI copy aligns cleanly', () => {
    const db = getDb();
    db.prepare(`DELETE FROM analytics_events WHERE business_id = 'biz_pr98_empty'`).run();
    const metrics = EventTracker.getDashboardMetrics('biz_pr98_empty');
    expect(metrics.revenueINR).toBe(0);
    expect(metrics.spentINR).toBe(0);
    expect(metrics.impressions).toBe(0);
    expect(metrics.roas).toBe(0);

    const demoSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages/frontend/src/pages/PublicDemoPage.tsx'), 'utf8');
    expect(demoSrc).toContain('Sample WhatsApp Message Preview');
    expect(demoSrc).toContain('React state');
    expect(demoSrc).toContain('flex-wrap');

    const homeSrc = fs.readFileSync(path.join(REPO_ROOT, 'packages/backend/src/revenue/direct-offer-page.ts'), 'utf8');
    expect(homeSrc).not.toContain('with instant email notification');
  });
});
