import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { TelegramBotAdapter } from '../../src/notifications/telegram-adapter.js';

describe('Telegram Bot Adapter for Owner-Only Alerts (Step 5)', () => {
  let server: http.Server;
  let serverPort: number;
  let receivedRequests: any[] = [];

  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  const originalEnabled = process.env.TELEGRAM_ENABLED;

  beforeEach(async () => {
    receivedRequests = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          body: body ? JSON.parse(body) : null
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 12345 } }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });

    TelegramBotAdapter.getInstance().setCustomBaseUrl(`http://127.0.0.1:${serverPort}`);
  });

  afterEach(async () => {
    TelegramBotAdapter.getInstance().setCustomBaseUrl(undefined);
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    if (originalToken) process.env.TELEGRAM_BOT_TOKEN = originalToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;

    if (originalChatId) process.env.TELEGRAM_OWNER_CHAT_ID = originalChatId;
    else delete process.env.TELEGRAM_OWNER_CHAT_ID;

    if (originalEnabled) process.env.TELEGRAM_ENABLED = originalEnabled;
    else delete process.env.TELEGRAM_ENABLED;
  });

  it('1. Returns TELEGRAM_DISABLED_OR_UNCONFIGURED when variables are unset', async () => {
    delete process.env.TELEGRAM_ENABLED;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_OWNER_CHAT_ID;

    const adapter = TelegramBotAdapter.getInstance();
    const result = await adapter.sendMessage('Test');

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('TELEGRAM_DISABLED_OR_UNCONFIGURED');
    expect(receivedRequests.length).toBe(0);
  });

  it('2. Rejects broadcast channels (-100 prefix) to prevent messaging non-owner audiences', async () => {
    process.env.TELEGRAM_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAFakeTokenForTestPurposeOnly';
    process.env.TELEGRAM_OWNER_CHAT_ID = '-1001234567890'; // Channel ID

    const adapter = TelegramBotAdapter.getInstance();
    const result = await adapter.sendMessage('Test');

    expect(result.sent).toBe(false);
    expect(result.reason).toContain('SECURITY_VIOLATION');
    expect(receivedRequests.length).toBe(0);
  });

  it('3. Successfully dispatches inquiry alert to owner chat on mock server', async () => {
    process.env.TELEGRAM_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAFakeTokenForTestPurposeOnly';
    process.env.TELEGRAM_OWNER_CHAT_ID = '987654321'; // Personal user ID

    const adapter = TelegramBotAdapter.getInstance();
    const result = await adapter.notifyInquiry({
      customerName: 'Dr. Ramesh Sharma',
      customerPhone: '9876543210',
      customerEmail: 'ramesh@clinic.in',
      clinicName: 'Ramesh Dental Care'
    });

    expect(result.sent).toBe(true);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.chat_id).toBe('987654321');
    expect(receivedRequests[0].body.text).toContain('Ramesh Dental Care');
    expect(receivedRequests[0].body.text).toContain('Dr. Ramesh Sharma');
  });

  it('4. Successfully dispatches manual payment claim alert to owner chat on mock server', async () => {
    process.env.TELEGRAM_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAFakeTokenForTestPurposeOnly';
    process.env.TELEGRAM_OWNER_CHAT_ID = '987654321';

    const adapter = TelegramBotAdapter.getInstance();
    const result = await adapter.notifyPaymentClaim({
      utr: 'BANK1122334455',
      payerName: 'Dr. Anand',
      amountINR: 15000,
      proposalId: 'prop_real_01'
    });

    expect(result.sent).toBe(true);
    expect(receivedRequests.length).toBe(1);
    expect(receivedRequests[0].body.chat_id).toBe('987654321');
    expect(receivedRequests[0].body.text).toContain('BANK1122334455');
    expect(receivedRequests[0].body.text).toContain('₹15,000');
  });
});
