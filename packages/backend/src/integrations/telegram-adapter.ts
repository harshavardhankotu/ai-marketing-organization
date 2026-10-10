import { getDb } from '../db/client.js';

export interface TelegramPostOptions {
  guideTitle: string;
  guideUrl: string;
  disclosureText?: string;
  fetchFn?: typeof fetch;
}

export interface TelegramPostResult {
  posted: boolean;
  messageId?: number;
  reason?: string;
}

export class TelegramBotAdapter {
  private static instance: TelegramBotAdapter | null = null;
  private readonly defaultDisclosure = 'Disclosure: As an Amazon Associate I earn from qualifying purchases. This link opens Amazon.in search results.';

  public static getInstance(): TelegramBotAdapter {
    if (!TelegramBotAdapter.instance) {
      TelegramBotAdapter.instance = new TelegramBotAdapter();
    }
    return TelegramBotAdapter.instance;
  }

  /**
   * Checks whether the Telegram owned channel is configured and enabled.
   * Stays strictly off until TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, and TELEGRAM_ENABLED=true are set by owner.
   */
  public isEnabled(): boolean {
    const isEnabled = process.env.TELEGRAM_ENABLED === 'true';
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const channelId = process.env.TELEGRAM_CHANNEL_ID?.trim();
    return Boolean(isEnabled && token && channelId);
  }

  /**
   * Posts a published buyer guide URL with mandatory statutory disclosure to the owner-owned channel.
   * Uses official Telegram Bot API (sendMessage).
   * Strict rate limit: At most 1 post per day.
   */
  public async postPublishedGuide(options: TelegramPostOptions): Promise<TelegramPostResult> {
    if (!this.isEnabled()) {
      return {
        posted: false,
        reason: 'TELEGRAM_DISABLED: Telegram integration is off. Requires TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, and TELEGRAM_ENABLED=true.'
      };
    }

    const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
    const channelId = process.env.TELEGRAM_CHANNEL_ID!.trim();
    const fetchFn = options.fetchFn || fetch;
    const db = getDb();

    // Ensure telemetry/rate-limit table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_posts_log (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        guide_url TEXT NOT NULL,
        message_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Enforce rate limit: max 1 post per calendar day
    const todayCount = (db.prepare(`
      SELECT count(*) as cnt
      FROM telegram_posts_log
      WHERE date(created_at) = date('now')
    `).get() as any)?.cnt || 0;

    if (todayCount >= 1) {
      return {
        posted: false,
        reason: 'DAILY_LIMIT_EXCEEDED: Telegram owned channel allows at most 1 post per day.'
      };
    }

    const disclosure = options.disclosureText || this.defaultDisclosure;
    const messageText = `📖 New Buyer Guide: ${options.guideTitle}\n\n${options.guideUrl}\n\n${disclosure}`;

    const endpoint = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: channelId,
          text: messageText,
          disable_web_page_preview: false
        })
      });

      if (!res.ok) {
        const errorBody = await res.text();
        return {
          posted: false,
          reason: `TELEGRAM_API_ERROR: HTTP ${res.status}: ${errorBody}`
        };
      }

      const data = await res.json() as any;
      const messageId = data?.result?.message_id || 1;

      // Log successful post
      const postId = `tg_${Date.now()}`;
      db.prepare(`
        INSERT INTO telegram_posts_log (id, channel_id, guide_url, message_id, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(postId, channelId, options.guideUrl, messageId);

      return {
        posted: true,
        messageId
      };
    } catch (err: any) {
      return {
        posted: false,
        reason: `NETWORK_ERROR: ${err.message}`
      };
    }
  }
}
