import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { TelegramBotAdapter } from '../../src/integrations/telegram-adapter.js';
import { getDb } from '../../src/db/client.js';

describe('Step 9: Telegram Bot API Adapter for Owned Channel', () => {
  const adapter = TelegramBotAdapter.getInstance();
  let server: http.Server;
  let receivedRequests: Array<{ url: string; body: any }> = [];
  let port: number;

  beforeEach(async () => {
    receivedRequests = [];
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_posts_log (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        guide_url TEXT NOT NULL,
        message_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(`DELETE FROM telegram_posts_log`).run();

    // Start fake Telegram HTTP server
    server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      const parsedBody = body ? JSON.parse(body) : {};
      receivedRequests.push({ url: req.url || '', body: parsedBody });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        result: {
          message_id: 42,
          date: Math.floor(Date.now() / 1000),
          chat: { id: parsedBody.chat_id }
        }
      }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    delete process.env.TELEGRAM_ENABLED;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHANNEL_ID;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('stays off by default when environment variables are not configured (Step 9)', async () => {
    delete process.env.TELEGRAM_ENABLED;
    expect(adapter.isEnabled()).toBe(false);

    const res = await adapter.postPublishedGuide({
      guideTitle: 'Phomemo M110 Buyer Guide',
      guideUrl: 'https://aimarketing.org/guides/guide-phomemo-m110.html'
    });

    expect(res.posted).toBe(false);
    expect(res.reason).toContain('TELEGRAM_DISABLED');
  });

  it('posts a guide with disclosure text using the official API when enabled (Step 9)', async () => {
    process.env.TELEGRAM_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-12345';
    process.env.TELEGRAM_CHANNEL_ID = '@my_owned_channel';

    expect(adapter.isEnabled()).toBe(true);

    // Mock fetchFn redirecting to our local fake server
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = `http://127.0.0.1:${port}/botmock-bot-token-12345/sendMessage`;
      return fetch(url, init);
    };

    const res = await adapter.postPublishedGuide({
      guideTitle: 'Phomemo M110 Buyer Guide',
      guideUrl: 'https://aimarketing.org/guides/guide-phomemo-m110.html',
      fetchFn: fakeFetch
    });

    expect(res.posted).toBe(true);
    expect(res.messageId).toBe(42);

    expect(receivedRequests.length).toBe(1);
    const req = receivedRequests[0];
    expect(req.body.chat_id).toBe('@my_owned_channel');
    expect(req.body.text).toContain('Phomemo M110 Buyer Guide');
    expect(req.body.text).toContain('https://aimarketing.org/guides/guide-phomemo-m110.html');
    expect(req.body.text).toContain('Disclosure: As an Amazon Associate I earn from qualifying purchases.');
  });

  it('enforces rate limit of at most 1 post per day (Step 9)', async () => {
    process.env.TELEGRAM_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = 'mock-bot-token-12345';
    process.env.TELEGRAM_CHANNEL_ID = '@my_owned_channel';

    const fakeFetch: typeof fetch = async (input, init) => {
      const url = `http://127.0.0.1:${port}/botmock-bot-token-12345/sendMessage`;
      return fetch(url, init);
    };

    // First post succeeds
    const firstRes = await adapter.postPublishedGuide({
      guideTitle: 'First Guide',
      guideUrl: 'https://aimarketing.org/guides/guide-first.html',
      fetchFn: fakeFetch
    });
    expect(firstRes.posted).toBe(true);

    // Second post on same day is blocked
    const secondRes = await adapter.postPublishedGuide({
      guideTitle: 'Second Guide',
      guideUrl: 'https://aimarketing.org/guides/guide-second.html',
      fetchFn: fakeFetch
    });
    expect(secondRes.posted).toBe(false);
    expect(secondRes.reason).toContain('DAILY_LIMIT_EXCEEDED');
  });
});
