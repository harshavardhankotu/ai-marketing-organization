import { createHash } from 'crypto';
import { getDb } from '../db/client.js';
import { isPlaceholderCredential } from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface TelegramPostOptions {
  guideTitle: string;
  guideUrl: string;
  dealId?: string;
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
  missingRequirement: 'MISSING_BOT_TOKEN' | 'MISSING_CHAT_ID' | null;
}

export class TelegramBotAdapter {
  private static instance: TelegramBotAdapter | null = null;
  private readonly defaultDisclosure = 'Disclosure: As an Amazon Associate I earn from qualifying purchases. This link opens Amazon.in search results.';
  private d1Repo = D1RevenueRepository.getInstance();

  private cachedGetMe: { data: any; expiresAt: number } | null = null;
  private static telegramPostCountCache: { count: number; expiresAt: number } | null = null;

  public static getInstance(): TelegramBotAdapter {
    if (!TelegramBotAdapter.instance) {
      TelegramBotAdapter.instance = new TelegramBotAdapter();
    }
    return TelegramBotAdapter.instance;
  }

  public static resetInstance(): void {
    TelegramBotAdapter.instance = null;
    TelegramBotAdapter.telegramPostCountCache = null;
  }

  public static resetTelegramPostCountCacheForTesting(): void {
    TelegramBotAdapter.telegramPostCountCache = null;
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
        status: 'READY_AWAITING_BOT_TOKEN',
        missingRequirement: 'MISSING_BOT_TOKEN'
      };
    }

    const chatId = await this.getChatId();
    const chatIdConfigured = Boolean(chatId);
    const resolvedStatus: 'LIVE_ENABLED' | 'READY_AWAITING_BOT_TOKEN' = chatIdConfigured
      ? 'LIVE_ENABLED'
      : 'READY_AWAITING_BOT_TOKEN';
    const missingRequirement: 'MISSING_BOT_TOKEN' | 'MISSING_CHAT_ID' | null = chatIdConfigured
      ? null
      : 'MISSING_CHAT_ID';

    // Return cached getMe if within 10 minutes
    const now = Date.now();
    if (this.cachedGetMe && this.cachedGetMe.expiresAt > now) {
      return {
        connected: chatIdConfigured,
        configured: true,
        botUsername: this.cachedGetMe.data?.username || null,
        botId: this.cachedGetMe.data?.id,
        chatIdConfigured,
        channelConfigured: chatIdConfigured,
        status: resolvedStatus,
        syndicationStatus: resolvedStatus,
        dailyPostLimit: 3,
        missingRequirement
      };
    }

    if (process.env.VITEST) {
      return {
        connected: chatIdConfigured,
        configured: true,
        botUsername: 'MockTestBot',
        chatIdConfigured,
        channelConfigured: chatIdConfigured,
        status: resolvedStatus,
        syndicationStatus: resolvedStatus,
        dailyPostLimit: 3,
        missingRequirement
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
            connected: chatIdConfigured,
            configured: true,
            botUsername: json.result.username,
            botId: json.result.id,
            chatIdConfigured,
            channelConfigured: chatIdConfigured,
            status: resolvedStatus,
            syndicationStatus: resolvedStatus,
            dailyPostLimit: 3,
            missingRequirement
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
      dailyPostLimit: 3,
      missingRequirement
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
      dealId: options.dealId,
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

    // Enforce durable rate limit: max 3 posts per calendar day via D1 durable_events + local fallback
    const shouldCache = !process.env.VITEST || process.env.ALLOW_D1_CACHE_IN_TEST === 'true';
    let maxTodayCount = 0;
    if (shouldCache && TelegramBotAdapter.telegramPostCountCache && Date.now() < TelegramBotAdapter.telegramPostCountCache.expiresAt) {
      maxTodayCount = TelegramBotAdapter.telegramPostCountCache.count;
    } else {
      const now = new Date();
      const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
      let durableTodayCount = 0;
      try {
        const durableRow = await this.d1Repo.queryOne<{ cnt: number }>(
          'durable_events',
          `SELECT COUNT(*) as cnt
           FROM durable_events
           WHERE event_type IN ('TELEGRAM_POST_CLAIMED', 'TELEGRAM_GUIDE_POSTED')
             AND created_at >= date('now')`
        );
        durableTodayCount = Number(durableRow?.cnt || 0);
      } catch {}

      const localTodayCount = Number(
        (db.prepare(`
          SELECT count(*) as cnt
          FROM telegram_posts_log
          WHERE created_at >= date('now')
        `).get() as any)?.cnt || 0
      );

      maxTodayCount = Math.max(durableTodayCount, localTodayCount);
      if (shouldCache) {
        TelegramBotAdapter.telegramPostCountCache = {
          count: maxTodayCount,
          expiresAt: Math.min(Date.now() + 5 * 60 * 1000, nextUtcMidnight) // earlier of 5-min cache or UTC midnight
        };
      }
    }

    if (maxTodayCount >= 3) {
      return {
        posted: false,
        reason: 'DAILY_LIMIT_EXCEEDED: Telegram owned channel allows at most 3 posts per day.'
      };
    }

    // Atomic per-deal/per-day durable claim to prevent duplicate concurrent syndication
    let claimId: string | null = null;
    if (options.dealId) {
      const utcDate = new Date().toISOString().split('T')[0];
      const claimHash = createHash('sha256').update(`${utcDate}:${options.dealId}`).digest('hex').slice(0, 36);
      claimId = `tg_post_claim_${claimHash}`;
      try {
        const existingClaim = await this.d1Repo.queryOne<{ id: string }>(
          'durable_events',
          `SELECT id FROM durable_events WHERE id = ? LIMIT 1`,
          [claimId]
        );
        if (existingClaim?.id) {
          return {
            posted: false,
            reason: `DUPLICATE_DEAL_POST_BLOCKED: Deal '${options.dealId}' already claimed for ${utcDate}.`
          };
        }
        await this.d1Repo.executeWrite(
          'durable_events',
          `INSERT INTO durable_events (id, event_type, organization_id, payload_json, created_at)
           VALUES (?, 'TELEGRAM_POST_CLAIMED', 'org_owner_primary', ?, datetime('now'))`,
          [claimId, JSON.stringify({ dealId: options.dealId, guideUrl: options.guideUrl, channelId, claimedAt: new Date().toISOString() })]
        );
        TelegramBotAdapter.telegramPostCountCache = null;
      } catch (claimErr: any) {
        if (String(claimErr?.message || '').toLowerCase().includes('unique')) {
          return {
            posted: false,
            reason: `DUPLICATE_DEAL_POST_BLOCKED: Deal '${options.dealId}' already claimed.`
          };
        }
      }
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
        // PR #82: Release claim ONLY on deterministic rejections (e.g. HTTP 400, 401, 403, 404).
        // Release BEFORE reading error body so body-read failures cannot leave the rejected post's claim held.
        // For uncertain outcomes (HTTP 429 rate limit or 5xx server errors), PRESERVE the claim to prevent duplicate syndication.
        const isDeterministicRejection = res.status >= 400 && res.status < 500 && res.status !== 429;
        if (claimId && isDeterministicRejection) {
          try {
            await this.d1Repo.executeWrite(
              'durable_events',
              `DELETE FROM durable_events WHERE id = ? AND event_type = 'TELEGRAM_POST_CLAIMED'`,
              [claimId]
            );
          } catch {}
          TelegramBotAdapter.telegramPostCountCache = null;
        }

        let errorBody = '';
        try {
          errorBody = await res.text();
        } catch {
          errorBody = '<failed to read error response body>';
        }

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

      if (!claimId) {
        try {
          await this.d1Repo.executeWrite(
            'durable_events',
            `INSERT OR IGNORE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
             VALUES (?, 'TELEGRAM_GUIDE_POSTED', 'org_owner_primary', ?, datetime('now'))`,
            [postId, JSON.stringify({ guideUrl: options.guideUrl, channelId, messageId })]
          );
        } catch {}
      }

      TelegramBotAdapter.telegramPostCountCache = null;
      return {
        posted: true,
        messageId
      };
    } catch (err: any) {
      // PR #82: On network errors, timeouts, or aborts, outcome is uncertain — Telegram may have broadcast.
      // Do NOT delete the claim; preserving it prevents duplicate posting.
      return {
        posted: false,
        reason: `NETWORK_ERROR: ${err.message}`
      };
    }
  }
}
