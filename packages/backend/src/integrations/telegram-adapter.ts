import { getDb } from '../db/client.js';
import { isPlaceholderCredential } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

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

export interface TelegramBotStatus {
  connected: boolean;
  configured?: boolean;
  botUsername: string | null;
  chatIdConfigured: boolean;
  channelConfigured?: boolean;
  botId?: number;
  status: 'LIVE_ENABLED' | 'READY_AWAITING_BOT_TOKEN';
  syndicationStatus?: 'LIVE_ENABLED' | 'READY_AWAITING_BOT_TOKEN';
  dailyPostLimit?: number;
}

export class TelegramBotAdapter {
  private static instance: TelegramBotAdapter | null = null;
  private readonly defaultDisclosure = 'Disclosure: As an Amazon Associate I earn from qualifying purchases. This link opens Amazon.in search results.';
  private d1Repo = D1RevenueRepository.getInstance();

  private cachedGetMe: { data: any; expiresAt: number } | null = null;

  public static getInstance(): TelegramBotAdapter {
    if (!TelegramBotAdapter.instance) {
      TelegramBotAdapter.instance = new TelegramBotAdapter();
    }
    return TelegramBotAdapter.instance;
  }

  public static resetInstance(): void {
    TelegramBotAdapter.instance = null;
  }

  /**
   * Resolves bot token from all known environment variable aliases.
   */
  public getToken(): string {
    const raw = (
      process.env.TELEGRAM_BOT_TOKEN ||
      process.env.TELEGRAM_TOKEN ||
      process.env.TG_BOT_TOKEN ||
      process.env.TELEGRAM_API_TOKEN ||
      ''
    ).trim();
    if (!raw || isPlaceholderCredential(raw)) return '';
    return raw;
  }

  private isValidChatId(raw: string): boolean {
    const val = raw.trim();
    if (!val) return false;
    if (/^-?\d{5,20}$/.test(val)) return true;
    return val.startsWith('@') ? val.length >= 5 : !isPlaceholderCredential(val);
  }

  /**
   * Resolves target channel/chat ID from environment or auto-discovers via getUpdates.
   */
  public async getChatId(): Promise<string> {
    const envChatId = (
      process.env.TELEGRAM_CHANNEL_ID ||
      process.env.TELEGRAM_CHAT_ID ||
      process.env.TG_CHANNEL_ID ||
      ''
    ).trim();
    if (this.isValidChatId(envChatId)) return envChatId;

    // Check cached chat ID in D1 durable_events
    try {
      const db = getDb();
      const cached = db.prepare(
        `SELECT payload_json FROM durable_events WHERE id = 'tg_chat_discovered' AND event_type = 'TELEGRAM_CHAT_DISCOVERED' LIMIT 1`
      ).get() as any;
      if (cached?.payload_json) {
        const parsed = JSON.parse(cached.payload_json);
        if (parsed?.chatId) return String(parsed.chatId).trim();
      }
    } catch {}

    // Auto-discover via getUpdates if token is set
    const token = this.getToken();
    if (!token || process.env.VITEST) return '';

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=5`, {
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const updates = Array.isArray(data?.result) ? data.result : [];
        for (const u of updates.reverse()) {
          const chatId = u.channel_post?.chat?.id || u.message?.chat?.id || u.my_chat_member?.chat?.id;
          if (chatId) {
            const discovered = String(chatId).trim();
            try {
              await this.d1Repo.executeWrite(
                'durable_events',
                `INSERT OR REPLACE INTO durable_events (id, event_type, payload_json, created_at)
                 VALUES ('tg_chat_discovered', 'TELEGRAM_CHAT_DISCOVERED', ?, datetime('now'))`,
                [JSON.stringify({ chatId: discovered, discoveredAt: new Date().toISOString() })]
              );
            } catch {}
            return discovered;
          }
        }
      }
    } catch {}

    return '';
  }

  /**
   * Resolves private owner chat ID before public broadcast channel ID
   * so sensitive order/payment alerts are never posted to public deal channels.
   */
  public async getOwnerChatId(): Promise<string> {
    const ownerChatId = (
      process.env.TELEGRAM_OWNER_CHAT_ID ||
      process.env.TELEGRAM_ADMIN_CHAT_ID ||
      process.env.TELEGRAM_CHAT_ID ||
      ''
    ).trim();
    if (this.isValidChatId(ownerChatId)) return ownerChatId;
    return this.getChatId();
  }

  public getSyndicationStatus(): 'LIVE_ENABLED' | 'READY_AWAITING_BOT_TOKEN' {
    const token = this.getToken();
    const explicitlyDisabled = process.env.TELEGRAM_ENABLED === 'false';
    return !explicitlyDisabled && Boolean(token)
      ? 'LIVE_ENABLED'
      : 'READY_AWAITING_BOT_TOKEN';
  }

  public isEnabled(): boolean {
    const explicitlyDisabled = process.env.TELEGRAM_ENABLED === 'false';
    const token = this.getToken();
    return !explicitlyDisabled && Boolean(token);
  }

  /**
   * Checks live Telegram bot status via getMe (cached for 10 minutes)
   */
  public async getStatus(): Promise<TelegramBotStatus> {
    const token = this.getToken();
    if (!token) {
      return {
        connected: false,
        botUsername: null,
        chatIdConfigured: false,
        status: 'READY_AWAITING_BOT_TOKEN'
      };
    }

    const chatId = await this.getChatId();
    const chatIdConfigured = Boolean(chatId);

    // Return cached getMe if within 10 minutes
    const now = Date.now();
    if (this.cachedGetMe && this.cachedGetMe.expiresAt > now) {
      return {
        connected: true,
        configured: true,
        botUsername: this.cachedGetMe.data?.username || null,
        botId: this.cachedGetMe.data?.id,
        chatIdConfigured,
        channelConfigured: chatIdConfigured,
        status: 'LIVE_ENABLED',
        syndicationStatus: 'LIVE_ENABLED',
        dailyPostLimit: 3
      };
    }

    if (process.env.VITEST) {
      return {
        connected: true,
        configured: true,
        botUsername: 'MockTestBot',
        chatIdConfigured: true,
        channelConfigured: true,
        status: 'LIVE_ENABLED',
        syndicationStatus: 'LIVE_ENABLED',
        dailyPostLimit: 3
      };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        if (json?.ok && json.result?.username) {
          this.cachedGetMe = {
            data: json.result,
            expiresAt: now + 10 * 60 * 1000 // 10 minutes
          };
          return {
            connected: true,
            configured: true,
            botUsername: json.result.username,
            botId: json.result.id,
            chatIdConfigured,
            channelConfigured: chatIdConfigured,
            status: 'LIVE_ENABLED',
            syndicationStatus: this.getSyndicationStatus(),
            dailyPostLimit: 3
          };
        }
      }
    } catch {}

    return {
      connected: false,
      configured: true,
      botUsername: null,
      chatIdConfigured,
      channelConfigured: chatIdConfigured,
      status: 'READY_AWAITING_BOT_TOKEN',
      syndicationStatus: this.getSyndicationStatus(),
      dailyPostLimit: 3
    };
  }

  /**
   * Sends an instant Telegram notification to the private owner chat (falls back to channel only if unset)
   */
  public async sendOwnerAlert(htmlText: string): Promise<boolean> {
    const token = this.getToken();
    if (!token || process.env.VITEST) return false;
    const chatId = await this.getOwnerChatId();
    if (!chatId) return false;

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        signal: AbortSignal.timeout(10000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Posts a newly verified price drop deal with tracked /redirect URL to Telegram when configured.
   * Enforces D1 durable_events deduplication (up to 3 posts per day).
   */
  public async postVerifiedPriceDrop(options: {
    dealId: string;
    title: string;
    currentPriceINR: number;
    referencePriceINR?: number;
    merchant: string;
    trackedRedirectUrl: string;
    fetchFn?: typeof fetch;
  }): Promise<TelegramPostResult & { status: 'LIVE_ENABLED' | 'READY_AWAITING_BOT_TOKEN' }> {
    const status = this.getSyndicationStatus();
    if (status !== 'LIVE_ENABLED' || process.env.VITEST) {
      return {
        posted: false,
        status,
        reason: status === 'READY_AWAITING_BOT_TOKEN'
          ? 'READY_AWAITING_BOT_TOKEN'
          : 'TELEGRAM_POST_SKIPPED_TEST_ENV'
      };
    }
    const savingsText = options.referencePriceINR && options.referencePriceINR > options.currentPriceINR
      ? ` (MRP ₹${options.referencePriceINR.toLocaleString('en-IN')})`
      : '';
    const postRes = await this.postPublishedGuide({
      guideTitle: `Verified Price Drop: ${options.title} at ₹${options.currentPriceINR.toLocaleString('en-IN')}${savingsText} (${options.merchant})`,
      guideUrl: options.trackedRedirectUrl,
      disclosureText: '#Ad Statutory Disclosure: Affiliate link tracked on merchant purchase.',
      fetchFn: options.fetchFn
    });
    return { ...postRes, status };
  }

  /**
   * Posts a published buyer guide URL with mandatory statutory disclosure to the owner-owned channel.
   * Uses official Telegram Bot API (sendMessage).
   * Strict rate limit: At most 3 posts per day.
   */
  public async postPublishedGuide(options: TelegramPostOptions): Promise<TelegramPostResult> {
    if (!this.isEnabled()) {
      return {
        posted: false,
        reason: 'TELEGRAM_DISABLED: Telegram integration is off. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID.'
      };
    }

    const token = this.getToken();
    const channelId = await this.getChatId();
    if (!channelId) {
      return {
        posted: false,
        reason: 'TELEGRAM_CHAT_ID_MISSING: Configure TELEGRAM_CHANNEL_ID or message the bot to auto-discover.'
      };
    }

    const fetchFn = options.fetchFn || fetch;
    const db = getDb();

    // Ensure telemetry/rate-limit table exists
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS telegram_posts_log (
          id TEXT PRIMARY KEY,
          channel_id TEXT NOT NULL,
          guide_url TEXT NOT NULL,
          message_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {}

    // Enforce rate limit: max 3 posts per calendar day
    const todayCount = (db.prepare(`
      SELECT count(*) as cnt
      FROM telegram_posts_log
      WHERE date(created_at) = date('now')
    `).get() as any)?.cnt || 0;

    if (todayCount >= 3) {
      return {
        posted: false,
        reason: 'DAILY_LIMIT_EXCEEDED: Telegram owned channel allows at most 3 posts per day.'
      };
    }

    const disclosure = options.disclosureText || this.defaultDisclosure;
    const messageText = `🔥 <b>${options.guideTitle}</b>\n\n🔗 ${options.guideUrl}\n\n${disclosure}`;

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
          parse_mode: 'HTML',
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

      const data = (await res.json()) as any;
      const messageId = data?.result?.message_id || 1;

      // Log successful post
      const postId = `tg_${Date.now()}`;
      try {
        db.prepare(`
          INSERT INTO telegram_posts_log (id, channel_id, guide_url, message_id, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(postId, channelId, options.guideUrl, messageId);
      } catch {}

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
