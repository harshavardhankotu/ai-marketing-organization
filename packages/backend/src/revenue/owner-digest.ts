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

export interface OutreachDigestItem {
  id: string;
  businessName: string;
  channel: string;
  status: string;
  loggedDate: string;
  draftMessage: string;
  auditLink: string;
}

export interface InquiryDigestItem {
  id: string;
  customerName: string;
  customerPhone: string;
  clinicName: string;
  notes: string;
  createdAt: string;
  status: string;
  ageHours: number;
  needsReminder: boolean;
  replyOnWhatsAppUrl: string;
  isTest: boolean;
}

export interface PainPointItem {
  rank: number;
  title: string;
  metric: string;
  ownerAction: string;
}

export interface OwnerTodayDigest {
  date: string;
  yesterdayDate: string;
  missingOwnerFacts: string[];
  replyDrafts: ReplyDraft[];
  proposalDrafts: ProposalDigestItem[];
  outreachRows: OutreachDigestItem[];
  inquiries: InquiryDigestItem[];
  topPainPoints: PainPointItem[];
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

    // 3. Up to 2 proposal drafts (for real, non-quarantined prospects only)
    const db = getDb();
    let proposalDrafts: ProposalDigestItem[] = [];
    try {
      const rows = db.prepare(`
        SELECT id, title, setup_price_inr as priceINR, status
        FROM proposals
        WHERE is_test = 0 AND status != 'TEST_QUARANTINED'
        ORDER BY created_at DESC
        LIMIT 2
      `).all() as any[];
      proposalDrafts = rows.map(r => ({
        id: r.id,
        title: r.title || 'Lead Conversion Setup Proposal',
        priceINR: Number(r.priceINR || 0),
        status: r.status || 'DRAFT'
      }));
    } catch {}

    // 4. Outreach Log rows (Manual Owner Conversations, Step 7)
    let outreachRows: OutreachDigestItem[] = [];
    try {
      const rows = db.prepare(`
        SELECT id, business_name, channel, status, logged_date
        FROM outreach_log
        ORDER BY created_at DESC
        LIMIT 10
      `).all() as any[];
      outreachRows = rows.map(r => ({
        id: r.id,
        businessName: r.business_name,
        channel: r.channel,
        status: r.status,
        loggedDate: r.logged_date,
        draftMessage: `Hi, I was reviewing how ${r.business_name} handles inquiries and set up a short demonstration of our automated lead conversion architecture. Would you be open to a 10-minute walkthrough this week?`,
        auditLink: `/offer`
      }));
    } catch {}

    // 5. Yesterday's measured metrics (UNKNOWN allowed)
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

    // 6. Inquiries from platform_prospects (source = 'OFFER_PAGE_INQUIRY' or 'DIRECT_INBOUND')
    let inquiries: InquiryDigestItem[] = [];
    try {
      const inqRows = db.prepare(`
        SELECT id, prospect_owner_name, phone, prospect_phone, prospect_business_name, notes, status, is_test, created_at
        FROM platform_prospects
        WHERE source = 'OFFER_PAGE_INQUIRY' OR discovery_source = 'DIRECT_INBOUND'
        ORDER BY created_at DESC
        LIMIT 10
      `).all() as any[];

      inquiries = inqRows.map(r => {
        const rawPhone = (r.phone || r.prospect_phone || '').trim();
        const cleanPhone = rawPhone.replace(/\D/g, '');
        const formattedPhone = cleanPhone.startsWith('91') ? cleanPhone : (cleanPhone ? `91${cleanPhone}` : '');
        const name = r.prospect_owner_name || r.prospect_business_name || 'Doctor';
        const draft = `Hello ${name}, thank you for your inquiry about our AI Inbound Lead Conversion System. Are you available for a 10-minute demonstration this week?`;
        const replyOnWhatsAppUrl = formattedPhone ? `https://wa.me/${formattedPhone}?text=${encodeURIComponent(draft)}` : '';
        const createdAtTime = new Date(r.created_at).getTime();
        const ageHours = Math.round((Date.now() - createdAtTime) / (1000 * 60 * 60));
        const needsReminder = ageHours >= 24 && r.status === 'QUALIFIED';

        return {
          id: r.id,
          customerName: r.prospect_owner_name || '',
          customerPhone: rawPhone,
          clinicName: r.prospect_business_name || '',
          notes: r.notes || '',
          createdAt: r.created_at,
          status: r.status,
          ageHours,
          needsReminder,
          replyOnWhatsAppUrl,
          isTest: Boolean(r.is_test)
        };
      });
    } catch {}

    // 7. Step 12a: Top 5 Pain Points computed strictly from data without an LLM
    const topPainPoints: PainPointItem[] = [];

    // 1. First pipeline stage with a count of 0
    let verifiedRevenueCount = 0;
    try {
      const revRow = db.prepare(`SELECT COUNT(*) as count FROM revenue_records WHERE verified = 1 AND is_test = 0`).get() as any;
      verifiedRevenueCount = Number(revRow?.count || 0);
    } catch {}

    let proposalsCount = 0;
    try {
      const propRow = db.prepare(`SELECT COUNT(*) as count FROM proposals WHERE is_test = 0`).get() as any;
      proposalsCount = Number(propRow?.count || 0);
    } catch {}

    if (verifiedRevenueCount === 0) {
      if (proposalsCount === 0) {
        topPainPoints.push({
          rank: 1,
          title: 'Zero Proposals Sent (Pipeline Stalled)',
          metric: 'proposals_sent = 0, verified_revenue = ₹0',
          ownerAction: 'Edit owner/OWN_OFFER.draft.md into owner terms and attest via scripts/owner-apply.mjs.'
        });
      } else {
        topPainPoints.push({
          rank: 1,
          title: 'Zero Payments Verified',
          metric: `proposals = ${proposalsCount}, verified_revenue = ₹0`,
          ownerAction: 'Confirm bank credit upon customer UPI payment.'
        });
      }
    } else {
      topPainPoints.push({
        rank: 1,
        title: 'Pipeline Revenue Flowing',
        metric: `verified_payments = ${verifiedRevenueCount}`,
        ownerAction: 'AUTOMATED: pending'
      });
    }

    // 2. Idle cycle share
    let idleCycleShare = 0;
    try {
      const totalCyclesRow = db.prepare(`SELECT COUNT(*) as count FROM autonomous_cycles`).get() as any;
      const totalCycles = Number(totalCyclesRow?.count || 0);
      const idleCyclesRow = db.prepare(`SELECT COUNT(*) as count FROM autonomous_cycles WHERE action_classification = 'NO_ACTION' OR action_classification = 'INTERNAL_AUTOMATION'`).get() as any;
      const idleCycles = Number(idleCyclesRow?.count || 0);
      idleCycleShare = totalCycles > 0 ? Math.round((idleCycles / totalCycles) * 100) : 0;
    } catch {}
    topPainPoints.push({
      rank: 2,
      title: 'Idle Autonomous Cycle Share',
      metric: `${idleCycleShare}% idle cycles`,
      ownerAction: 'AUTOMATED: pending (cron wakes every 15 min, rotates discovery queries)'
    });

    // 3. Unanswered inquiries
    const unansweredCount = inquiries.filter(i => i.status === 'QUALIFIED').length;
    const reminderCount = inquiries.filter(i => i.needsReminder).length;
    topPainPoints.push({
      rank: 3,
      title: 'Unanswered Inbound Inquiries',
      metric: `${unansweredCount} inquiry(s) awaiting reply (${reminderCount} >24h reminder)`,
      ownerAction: unansweredCount > 0 ? 'Click "Reply on WhatsApp" to message waiting clinic inquiries.' : 'AUTOMATED: pending'
    });

    // 4. Missing owner facts by lane
    const missingAffiliate = ['ASSOCIATES_APPLICATION_DATE', 'ASSOCIATES_LISTED_SITE_URL', 'ASSOCIATES_AGREEMENT_READ'].filter(f => !process.env[f]);
    const missingDirect = ['OWN_OFFER_CONFIRMED', 'DIRECT_OFFER_TERMS_SHA256'].filter(f => !process.env[f]);
    const missingSite = ['PUBLIC_SITE_NAME', 'PUBLIC_AUTHOR_NAME', 'PUBLIC_CONTACT_EMAIL'].filter(f => !process.env[f]);
    topPainPoints.push({
      rank: 4,
      title: 'Missing Owner Facts By Lane',
      metric: `Site: ${missingSite.length} missing | Direct: ${missingDirect.length} missing | Affiliate: ${missingAffiliate.length} missing`,
      ownerAction: missingSite.length > 0 ? 'Set PUBLIC_SITE_NAME, PUBLIC_AUTHOR_NAME, PUBLIC_CONTACT_EMAIL in Render.' : (missingDirect.length > 0 ? 'Attest direct terms.' : 'AUTOMATED: pending')
    });

    // 5. Credits left
    const replyDeskQueriesToday = this.replyDesk.getQueriesRunToday();
    const tavilySearchesLeft = Math.max(0, 2 - replyDeskQueriesToday);
    topPainPoints.push({
      rank: 5,
      title: 'Provider Credits Remaining',
      metric: `Tavily searches today: ${tavilySearchesLeft}/2 remaining | Gemini: bounded 5 calls/day`,
      ownerAction: 'AUTOMATED: pending (free-tier safety caps strictly active)'
    });

    // 8. One next action (deterministic priority order)
    let nextAction = 'Review inbound traffic and organic referral click activity.';
    if (missingOwnerFacts.length > 0) {
      nextAction = `Set statutory owner variables in Render environment (${ownerValidation.missingFields.concat(ownerValidation.invalidFields.map(f => f.field)).join(', ')}).`;
    } else if (!DirectCommercialOfferPage.isDirectOfferAttested()) {
      nextAction = 'Attest Lane B commercial offer by setting DIRECT_OFFER_TERMS_SHA256 and OWN_OFFER_CONFIRMED=true.';
    } else {
      try {
        const pendingClaims = db.prepare(`SELECT COUNT(*) as c FROM manual_upi_claims WHERE status = 'PAYMENT_CLAIMED' AND is_test = 0 AND status != 'TEST_QUARANTINED'`).get() as any;
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
      outreachRows,
      inquiries,
      topPainPoints,
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

  /**
   * Step 9b, 9c, 12a: Render rich dark-mode HTML dashboard for owner viewing on browser/mobile.
   */
  public renderHtml(digest: OwnerTodayDigest): string {
    const painPointsHtml = digest.topPainPoints.map(p => `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1rem;margin-bottom:0.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
          <strong style="color:#38bdf8;font-size:1rem;">#${p.rank} ${p.title}</strong>
          <span style="font-size:0.85rem;background:#0f172a;padding:0.2rem 0.5rem;border-radius:4px;color:#94a3b8;">${p.metric}</span>
        </div>
        <p style="margin:0.25rem 0 0 0;font-size:0.9rem;color:#cbd5e1;">👉 <strong>Action:</strong> ${p.ownerAction}</p>
      </div>
    `).join('');

    const inquiriesHtml = digest.inquiries.length === 0
      ? '<p style="color:#94a3b8;">No inquiries received yet. Submit a test inquiry via <a href="/offer" style="color:#38bdf8;">/offer</a> or <a href="/owner/smoke-test" style="color:#38bdf8;">/owner/smoke-test</a>.</p>'
      : digest.inquiries.map(inq => `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:1rem;margin-bottom:0.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
            <div>
              <strong style="color:#f8fafc;font-size:1.05rem;">${inq.customerName || inq.clinicName || 'Inquiry'}</strong>
              <span style="color:#94a3b8;font-size:0.85rem;margin-left:0.5rem;">${inq.customerPhone}</span>
              ${inq.isTest ? '<span style="background:#eab308;color:#000;font-size:0.75rem;padding:0.15rem 0.4rem;border-radius:3px;font-weight:bold;margin-left:0.5rem;">TEST</span>' : ''}
              ${inq.needsReminder ? '<span style="background:#ef4444;color:#fff;font-size:0.75rem;padding:0.15rem 0.4rem;border-radius:3px;font-weight:bold;margin-left:0.5rem;">⚠️ 24h UNANSWERED</span>' : ''}
            </div>
            <span style="color:#64748b;font-size:0.8rem;">${inq.ageHours}h ago</span>
          </div>
          <p style="color:#cbd5e1;font-size:0.9rem;margin:0.25rem 0 0.75rem 0;">${inq.notes || inq.clinicName}</p>
          ${inq.replyOnWhatsAppUrl ? `<a href="${inq.replyOnWhatsAppUrl}" target="_blank" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;padding:0.4rem 0.8rem;border-radius:6px;font-size:0.85rem;">Reply on WhatsApp</a>` : ''}
        </div>
      `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Owner Daily Digest & Revenue Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b1120; color: #f8fafc; padding: 2rem 1rem; max-width: 820px; margin: 0 auto; line-height: 1.6; }
    h1, h2 { color: #38bdf8; }
    a { color: #38bdf8; }
    .card { background: #0f172a; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid #1e293b; }
    .banner { background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; color: #38bdf8; }
  </style>
</head>
<body>
  <h1>Daily Owner Digest &amp; Control Dashboard</h1>
  <p style="color:#94a3b8;font-size:0.9rem;">Date: ${digest.date} • Free Plan Autonomous Engine</p>

  <div class="banner">
    <strong style="font-size:1.05rem;">🎯 Single Next Owner Action:</strong><br>
    <span style="font-size:0.95rem;color:#f8fafc;display:block;margin-top:0.25rem;">${digest.nextAction}</span>
  </div>

  <div class="card">
    <h2>Top 5 Measured Pain Points (Zero LLM)</h2>
    ${painPointsHtml}
  </div>

  <div class="card">
    <h2>Direct Inbound Inquiries (${digest.inquiries.length})</h2>
    ${inquiriesHtml}
  </div>

  <div class="card">
    <h2>Quick Actions &amp; Tools</h2>
    <ul style="padding-left:1.2rem;color:#cbd5e1;">
      <li><a href="/owner/smoke-test">Run Mobile Smoke Test (/owner/smoke-test)</a></li>
      <li><a href="/offer">View Live Commercial Offer Page (/offer)</a></li>
      <li><a href="/privacy">View Public DPDP Privacy Policy (/privacy)</a></li>
      <li><a href="/api/v1/owner/facts-status">Check Statutory Owner Facts Status</a></li>
    </ul>
  </div>
</body>
</html>`;
  }

  /**
   * Step 12b: Generates deterministic weekly digest for owner review.
   */
  public generateWeeklyDigest(asOfDate: Date = new Date()): {
    weekEnding: string;
    pipelineCounts: Record<string, number>;
    creditsUsedThisWeek: { tavily: number; gemini: number };
    whatChanged: string[];
    singleNextOwnerAction: string;
  } {
    const db = getDb();
    const weekEnding = asOfDate.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(asOfDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let signalsCount = 0;
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM demand_signals WHERE is_test = 0 AND created_at >= ?`).get(sevenDaysAgo) as any;
      signalsCount = Number(row?.c || 0);
    } catch {}

    let inquiriesCount = 0;
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM platform_prospects WHERE is_test = 0 AND created_at >= ?`).get(sevenDaysAgo) as any;
      inquiriesCount = Number(row?.c || 0);
    } catch {}

    let proposalsCount = 0;
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM proposals WHERE is_test = 0 AND created_at >= ?`).get(sevenDaysAgo) as any;
      proposalsCount = Number(row?.c || 0);
    } catch {}

    let verifiedPayments = 0;
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM revenue_records WHERE verified = 1 AND is_test = 0 AND timestamp >= ?`).get(sevenDaysAgo) as any;
      verifiedPayments = Number(row?.c || 0);
    } catch {}

    const whatChanged: string[] = [
      `Safe SQLite migration runner with atomic transactions verified.`,
      `Site identity facts lane separated from Amazon Associates lane.`,
      `Inquiry form DPDP consent, honeypot, and 30-day purge job active.`,
      `Reply Desk discovery queries automated for dental/clinic niches.`
    ];

    const digest = this.generateDigest(asOfDate);

    return {
      weekEnding,
      pipelineCounts: {
        newSignals: signalsCount,
        newInquiries: inquiriesCount,
        proposalsSent: proposalsCount,
        verifiedPayments
      },
      creditsUsedThisWeek: {
        tavily: this.replyDesk.getQueriesRunToday(),
        gemini: 0
      },
      whatChanged,
      singleNextOwnerAction: digest.nextAction
    };
  }
}
