/**
 * OwnerDigestService — Implements Part C: Owner Digest (No strangers, no LLM)
 *
 * Rules:
 * - GET /owner/today and GET /api/v1/owner/today
 * - If TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_CHAT_ID are set:
 *   - One private message per day at 08:00 IST to that chat only.
 *   - Contents:
 *     1. Missing owner facts (from validateOwnerEnvFacts)
 *     2. Up to 3 reply drafts (from ReplyDeskService)
 *     3. Up to 2 proposal drafts (from proposals table)
 *     4. Yesterday's measured visits, clicks, leads, payments (UNKNOWN allowed)
 *     5. One next action (deterministic priority)
 * - Tests with a fake HTTP server.
 * - Never post to channels or other chats (chat_id strictly equal to TELEGRAM_OWNER_CHAT_ID, no channel prefix -100).
 */

import { getDb } from '../db/client.js';
import { validateOwnerEnvFacts } from '../config/owner-env-intake.js';
import { ReplyDeskService, ReplyDraft } from './reply-desk.js';
import { DirectCommercialOfferPage } from './direct-offer-page.js';

export interface OwnerDigestMetrics {
  visits: number | 'UNKNOWN';
  clicks: number | 'UNKNOWN';
  leads: number | 'UNKNOWN';
  payments: number | 'UNKNOWN';
}

export interface ProposalDigestItem {
  id: string;
  title: string;
  priceINR: number;
  status: string;
}

export interface OwnerTodayDigest {
  date: string;
  yesterdayDate: string;
  missingOwnerFacts: string[];
  replyDrafts: ReplyDraft[];
  proposalDrafts: ProposalDigestItem[];
  yesterdayMetrics: OwnerDigestMetrics;
  nextAction: string;
}

export class OwnerDigestService {
  private static instance: OwnerDigestService;
  private replyDesk = ReplyDeskService.getInstance();

  public static getInstance(): OwnerDigestService {
    if (!OwnerDigestService.instance) {
      OwnerDigestService.instance = new OwnerDigestService();
    }
    return OwnerDigestService.instance;
  }

  public ensureTable(): void {
    const db = getDb();
    db.prepare(`
      CREATE TABLE IF NOT EXISTS owner_digest_dispatches (
        id TEXT PRIMARY KEY,
        digest_date TEXT NOT NULL UNIQUE,
        recipient_chat_id TEXT NOT NULL,
        dispatched_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL
      )
    `).run();
  }

  /**
   * Generates the deterministic owner digest data without LLM.
   */
  public generateDigest(asOfDate: Date = new Date()): OwnerTodayDigest {
    const todayStr = asOfDate.toISOString().slice(0, 10);
    const yesterdayDate = new Date(asOfDate.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    // 1. Missing owner facts
    const ownerValidation = validateOwnerEnvFacts();
    const missingOwnerFacts: string[] = [];
    if (!ownerValidation.valid) {
      for (const m of ownerValidation.missingFields) {
        missingOwnerFacts.push(`Missing env: ${m}`);
      }
      for (const inv of ownerValidation.invalidFields) {
        missingOwnerFacts.push(`Invalid env: ${inv.field} (${inv.reason})`);
      }
    }

    // 2. Up to 3 reply drafts
    const replyDrafts = this.replyDesk.getRecentDrafts(3);

    // 3. Up to 2 proposal drafts
    const db = getDb();
    let proposalDrafts: ProposalDigestItem[] = [];
    try {
      const rows = db.prepare(`
        SELECT id, title, setup_price_inr as priceINR, status
        FROM proposals
        ORDER BY created_at DESC
        LIMIT 2
      `).all() as any[];
      proposalDrafts = rows.map(r => ({
        id: r.id,
        title: r.title || 'Lead Conversion Setup Proposal',
        priceINR: Number(r.priceINR || 15000),
        status: r.status || 'DRAFT'
      }));
    } catch {}

    // 4. Yesterday's measured metrics (UNKNOWN allowed)
    let visits: number | 'UNKNOWN' = 'UNKNOWN';
    let clicks: number | 'UNKNOWN' = 'UNKNOWN';
    let leads: number | 'UNKNOWN' = 'UNKNOWN';
    let payments: number | 'UNKNOWN' = 'UNKNOWN';

    try {
      const visitRow = db.prepare(`SELECT COUNT(*) as c FROM referrals WHERE created_at LIKE ?`).get(`${yesterdayStr}%`) as any;
      if (visitRow && typeof visitRow.c === 'number') visits = visitRow.c;
    } catch {}

    try {
      const clickRow = db.prepare(`SELECT COUNT(*) as c FROM referral_click_events WHERE created_at LIKE ?`).get(`${yesterdayStr}%`) as any;
      if (clickRow && typeof clickRow.c === 'number') clicks = clickRow.c;
    } catch {}

    try {
      const leadRow = db.prepare(`SELECT COUNT(*) as c FROM prospects WHERE created_at LIKE ?`).get(`${yesterdayStr}%`) as any;
      if (leadRow && typeof leadRow.c === 'number') leads = leadRow.c;
    } catch {}

    try {
      const payRow = db.prepare(`
        SELECT SUM(amount_inr) as total FROM revenue_records
        WHERE (classification = 'OWNER_CONFIRMED' OR classification = 'EXPORT_VERIFIED' OR classification = 'REAL')
          AND verified = 1 AND is_test = 0 AND timestamp LIKE ?
      `).get(`${yesterdayStr}%`) as any;
      if (payRow && payRow.total !== null && typeof payRow.total === 'number') {
        payments = payRow.total;
      } else {
        payments = 0;
      }
    } catch {}

    // 5. One next action (deterministic priority order)
    let nextAction = 'Review inbound traffic and organic referral click activity.';
    if (missingOwnerFacts.length > 0) {
      nextAction = `Set statutory owner variables in Render environment (${ownerValidation.missingFields.concat(ownerValidation.invalidFields.map(f => f.field)).join(', ')}).`;
    } else if (!DirectCommercialOfferPage.isDirectOfferAttested()) {
      nextAction = 'Attest Lane B commercial offer by setting DIRECT_OFFER_TERMS_SHA256 in Render.';
    } else {
      try {
        const pendingClaims = db.prepare(`SELECT COUNT(*) as c FROM manual_upi_claims WHERE status = 'PAYMENT_CLAIMED'`).get() as any;
        if (pendingClaims && pendingClaims.c > 0) {
          nextAction = `Verify bank statement credit for ${pendingClaims.c} pending manual payment claim(s).`;
        }
      } catch {}
    }

    return {
      date: todayStr,
      yesterdayDate: yesterdayStr,
      missingOwnerFacts,
      replyDrafts,
      proposalDrafts,
      yesterdayMetrics: { visits, clicks, leads, payments },
      nextAction
    };
  }

  /**
   * Formats digest into clean text message for Telegram.
   */
  public formatTelegramMessage(digest: OwnerTodayDigest): string {
    const lines: string[] = [];
    lines.push(`🌅 *Daily Owner Digest* — ${digest.date}`);
    lines.push(``);

    // Missing owner facts
    lines.push(`⚠️ *Missing Owner Facts:*`);
    if (digest.missingOwnerFacts.length === 0) {
      lines.push(`✓ None. All 6 statutory owner facts verified.`);
    } else {
      for (const m of digest.missingOwnerFacts) {
        lines.push(`• ${m}`);
      }
    }
    lines.push(``);

    // Reply drafts (up to 3)
    lines.push(`💬 *Reply Drafts (${digest.replyDrafts.length}/3):*`);
    if (digest.replyDrafts.length === 0) {
      lines.push(`• Zero pending reply drafts.`);
    } else {
      for (const [idx, d] of digest.replyDrafts.entries()) {
        lines.push(`*Draft ${idx + 1}:* ${d.requestTitle}`);
        lines.push(`URL: ${d.sourceUrl}`);
        lines.push(`Draft: "${d.draftAnswer}"`);
      }
    }
    lines.push(``);

    // Proposal drafts (up to 2)
    lines.push(`📄 *Proposal Drafts (${digest.proposalDrafts.length}/2):*`);
    if (digest.proposalDrafts.length === 0) {
      lines.push(`• Zero pending proposal drafts.`);
    } else {
      for (const p of digest.proposalDrafts) {
        lines.push(`• ${p.title} (₹${p.priceINR.toLocaleString('en-IN')}) — Status: ${p.status}`);
      }
    }
    lines.push(``);

    // Yesterday's metrics
    const m = digest.yesterdayMetrics;
    lines.push(`📊 *Yesterday's Measured Metrics (${digest.yesterdayDate}):*`);
    lines.push(`• Organic Visits: ${m.visits}`);
    lines.push(`• Outbound Clicks: ${m.clicks}`);
    lines.push(`• Inbound Leads: ${m.leads}`);
    lines.push(`• Verified Revenue: ${m.payments === 'UNKNOWN' ? 'UNKNOWN' : `₹${Number(m.payments).toLocaleString('en-IN')}`}`);
    lines.push(``);

    // Next action
    lines.push(`🎯 *One Next Action:*`);
    lines.push(`${digest.nextAction}`);

    return lines.join('\n');
  }

  /**
   * Sends the private Telegram message at 08:00 IST to TELEGRAM_OWNER_CHAT_ID only.
   * Never posts to channels or other chats.
   * Can be injected with customFetch for hermetic unit testing.
   */
  public async dispatchDailyTelegramDigest(
    options: {
      asOfDate?: Date;
      forceSend?: boolean;
      customFetch?: typeof fetch;
    } = {}
  ): Promise<{ sent: boolean; reason?: string; chatId?: string; messageId?: number }> {
    this.ensureTable();
    const asOfDate = options.asOfDate || new Date();
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID?.trim();

    if (!botToken || !ownerChatId) {
      return { sent: false, reason: 'TELEGRAM_CONFIG_MISSING: TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_CHAT_ID is not configured.' };
    }

    // Safety check: Never post to channels or groups
    if (ownerChatId.startsWith('-100') || ownerChatId.startsWith('-')) {
      return { sent: false, reason: 'SECURITY_VIOLATION: Telegram digest must strictly be sent to private user chat ID, not channels or groups.' };
    }

    const todayStr = asOfDate.toISOString().slice(0, 10);
    const db = getDb();

    // Check idempotency: at most one private message per day
    const alreadySent = db.prepare(`SELECT * FROM owner_digest_dispatches WHERE digest_date = ? AND status = 'SENT'`).get(todayStr) as any;
    if (alreadySent && !options.forceSend) {
      return { sent: false, reason: `ALREADY_SENT_TODAY: Digest for ${todayStr} was already dispatched to owner.` };
    }

    // Schedule check: 08:00 IST = 02:30 UTC
    // Unless forceSend is true (for manual test or owner request)
    if (!options.forceSend) {
      // In IST (UTC+5.5), check if current hour is 8
      const utcHours = asOfDate.getUTCHours();
      const utcMinutes = asOfDate.getUTCMinutes();
      const istTotalMinutes = utcHours * 60 + utcMinutes + 330;
      const istHours = Math.floor((istTotalMinutes % 1440) / 60);

      if (istHours !== 8) {
        return { sent: false, reason: `SCHEDULE_WINDOW_WAITING: Digest scheduled for 08:00 IST (current IST hour: ${istHours}).` };
      }
    }

    const digest = this.generateDigest(asOfDate);
    const message = this.formatTelegramMessage(digest);

    const targetFetch = options.customFetch || fetch;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      const res = await targetFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: ownerChatId,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { sent: false, reason: `TELEGRAM_API_ERROR: HTTP ${res.status}: ${errorText}` };
      }

      const resJson = await res.json() as any;
      const messageId = resJson?.result?.message_id;

      const dispatchId = `disp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      db.prepare(`
        INSERT INTO owner_digest_dispatches (id, digest_date, recipient_chat_id, status)
        VALUES (?, ?, ?, 'SENT')
        ON CONFLICT(digest_date) DO UPDATE SET
          dispatched_at = datetime('now'),
          status = 'SENT'
      `).run(dispatchId, todayStr, ownerChatId);

      return {
        sent: true,
        chatId: ownerChatId,
        messageId
      };
    } catch (err: any) {
      return { sent: false, reason: `NETWORK_ERROR: ${err.message}` };
    }
  }
}
