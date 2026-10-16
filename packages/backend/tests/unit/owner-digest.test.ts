import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { ReplyDeskService } from '../../src/revenue/reply-desk.js';
import app from '../../src/index.js';

describe('Part C: Owner Digest (Deterministic, No Strangers, No LLM)', () => {
  const digestService = OwnerDigestService.getInstance();
  const replyDesk = ReplyDeskService.getInstance();

  const resetEnv = () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_OWNER_CHAT_ID;
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;

    const db = getDb();
    try {
      db.prepare(`DELETE FROM owner_digest_dispatches`).run();
      db.prepare(`DELETE FROM reply_desk_drafts WHERE source_url LIKE '%test-inquiry%'`).run();
    } catch {}
  };

  beforeEach(resetEnv);
  afterEach(resetEnv);

  it('1. generates complete deterministic digest on GET /owner/today and GET /api/v1/owner/today', async () => {
    const resTop = await app.request('/owner/today');
    expect(resTop.status).toBe(200);
    const jsonTop = await resTop.json() as any;
    expect(jsonTop.success).toBe(true);

    const data = jsonTop.data;
    expect(data.date).toBeDefined();
    expect(data.yesterdayDate).toBeDefined();
    expect(Array.isArray(data.missingOwnerFacts)).toBe(true);
    expect(Array.isArray(data.replyDrafts)).toBe(true);
    expect(data.replyDrafts.length).toBeLessThanOrEqual(3);
    expect(Array.isArray(data.proposalDrafts)).toBe(true);
    expect(data.proposalDrafts.length).toBeLessThanOrEqual(2);
    expect(data.yesterdayMetrics).toBeDefined();
    expect(data.yesterdayMetrics.visits).toBeDefined();
    expect(data.yesterdayMetrics.clicks).toBeDefined();
    expect(data.yesterdayMetrics.leads).toBeDefined();
    expect(data.yesterdayMetrics.payments).toBeDefined();
    expect(typeof data.nextAction).toBe('string');

    // Also check GET /api/v1/owner/today
    const resApi = await app.request('/api/v1/owner/today');
    expect(resApi.status).toBe(200);
    const jsonApi = await resApi.json() as any;
    expect(jsonApi.success).toBe(true);
    expect(jsonApi.data.date).toBe(data.date);
  });

  it('2. formats Telegram message strictly without hallucinations and lists missing facts', () => {
    // When owner facts are missing
    const digest = digestService.generateDigest();
    const formatted = digestService.formatTelegramMessage(digest);

    expect(formatted).toContain('Daily Owner Digest');
    expect(formatted).toContain('Missing Owner Facts');
    expect(formatted).toContain('ASSOCIATES_APPLICATION_DATE');
    expect(formatted).toContain('Yesterday\'s Measured Metrics');
    expect(formatted).toContain('One Next Action');
  });

  it('3. dispatches private Telegram message to TELEGRAM_OWNER_CHAT_ID only (tested with fake HTTP server)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE_BOT_TOKEN';
    process.env.TELEGRAM_OWNER_CHAT_ID = '987654321'; // Private chat ID

    let capturedUrl = '';
    let capturedBody: any = null;

    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(JSON.stringify({
        ok: true,
        result: { message_id: 42, chat: { id: 987654321 } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await digestService.dispatchDailyTelegramDigest({
      forceSend: true,
      customFetch: fakeFetch
    });

    expect(res.sent).toBe(true);
    expect(res.chatId).toBe('987654321');
    expect(res.messageId).toBe(42);

    expect(capturedUrl).toBe('https://api.telegram.org/bot123456:FAKE_BOT_TOKEN/sendMessage');
    expect(capturedBody.chat_id).toBe('987654321');
    expect(capturedBody.text).toContain('Daily Owner Digest');
    expect(capturedBody.text).toContain('One Next Action');
  });

  it('4. strictly blocks sending to channels or groups (-100... / -...) to prevent public broadcast', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE_BOT_TOKEN';
    process.env.TELEGRAM_OWNER_CHAT_ID = '-1001234567890'; // Channel ID

    const res = await digestService.dispatchDailyTelegramDigest({ forceSend: true });
    expect(res.sent).toBe(false);
    expect(res.reason).toContain('SECURITY_VIOLATION');
  });

  it('5. enforces at most one message per day (idempotent)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE_BOT_TOKEN';
    process.env.TELEGRAM_OWNER_CHAT_ID = '987654321';

    const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }));

    // First send
    const res1 = await digestService.dispatchDailyTelegramDigest({ forceSend: true, customFetch: fakeFetch });
    expect(res1.sent).toBe(true);

    // Second send without forceSend -> blocked by daily idempotency guard
    const res2 = await digestService.dispatchDailyTelegramDigest({ forceSend: false, customFetch: fakeFetch });
    expect(res2.sent).toBe(false);
    expect(res2.reason).toContain('ALREADY_SENT_TODAY');
  });
});
