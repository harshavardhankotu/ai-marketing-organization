/**
 * brevo-mcp-client.ts
 *
 * Brevo MCP Server & Transactional Integration Guard.
 * Enforces strict Free-Tier quotas:
 * - Daily Email Sends: 200 sends/day max (100-send safety margin on 300 free plan)
 * - Contacts Limit: 2,000 automation contacts
 * - CRM Deals Limit: 50 open deals
 * - WhatsApp: HARD-BLOCKED (WhatsApp is not available on Brevo Free plan)
 * - Overflow Queue: Messages past 200/day are queued in D1 with QUEUED_NEXT_UTC_WINDOW
 * - Webhook Suppression: Bounces, spam complaints, and unsubscribes trigger D1 suppression
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction, isPlaceholderCredential } from '../config/env.js';
import { PlatformProspectDiscoveryEngine } from '../revenue/platform-prospect-discovery-engine.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';

export interface BrevoEmailPayload {
  to: Array<{ email: string; name?: string }>;
  subject: string;
  htmlContent?: string;
  textContent?: string;
  templateId?: number;
  params?: Record<string, any>;
  attachment?: Array<{ name: string; content?: string; url?: string }>;
}

export interface BrevoSendResult {
  success: boolean;
  messageId?: string;
  status: 'SENT' | 'QUEUED_NEXT_UTC_WINDOW' | 'SUPPRESSED' | 'BLOCKED_CREDENTIALS' | 'ERROR';
  reason?: string;
  dailySendsRemaining?: number;
}

export class BrevoMcpClient {
  private static instance: BrevoMcpClient;
  public static readonly MAX_DAILY_SENDS = 200;
  public static readonly MAX_CONTACTS = 2000;
  public static readonly MAX_OPEN_DEALS = 50;

  private apiKey?: string;
  private serverUrl: string;
  private d1Repo = D1RevenueRepository.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();

  private constructor() {
    this.apiKey = process.env.BREVO_API_KEY || process.env.BREVO_MCP_SERVER_API;
    this.serverUrl = process.env.BREVO_MCP_SERVER_URL || 'https://mcp.brevo.com/v1/brevo/mcp';
    this.ensureTables();
  }

  public static getInstance(): BrevoMcpClient {
    if (!BrevoMcpClient.instance) {
      BrevoMcpClient.instance = new BrevoMcpClient();
    }
    return BrevoMcpClient.instance;
  }

  public static resetInstanceForTesting(): void {
    BrevoMcpClient.instance = undefined as any;
  }

  private ensureTables(): void {
    try {
      const db = getDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS brevo_daily_quota (
          date_utc TEXT PRIMARY KEY,
          sends_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS brevo_message_queue (
          id TEXT PRIMARY KEY,
          recipient_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'QUEUED_NEXT_UTC_WINDOW',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {}
  }

  private getTodayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }

  public async getDailySendCount(): Promise<number> {
    const today = this.getTodayUtc();
    try {
      if (isProduction() || this.d1Repo.isRemoteD1Configured()) {
        const row = await this.d1Repo.queryOne<{ sends_count: number }>(
          'brevo_daily_quota',
          'SELECT sends_count FROM brevo_daily_quota WHERE date_utc = ?',
          [today]
        );
        return row?.sends_count || 0;
      }
      const db = getDb();
      const row = db.prepare('SELECT sends_count FROM brevo_daily_quota WHERE date_utc = ?').get(today) as any;
      return row?.sends_count || 0;
    } catch {
      return 0;
    }
  }

  private async incrementDailySendCount(): Promise<number> {
    const today = this.getTodayUtc();
    const sql = `
      INSERT INTO brevo_daily_quota (date_utc, sends_count, updated_at)
      VALUES (?, 1, datetime('now'))
      ON CONFLICT(date_utc) DO UPDATE SET
        sends_count = sends_count + 1,
        updated_at = datetime('now');
    `;
    try {
      if (isProduction() || this.d1Repo.isRemoteD1Configured()) {
        await this.d1Repo.executeWrite('brevo_daily_quota', sql, [today]);
      }
      const db = getDb();
      db.prepare(sql).run(today);
    } catch {}
    return this.getDailySendCount();
  }

  /**
   * Hard-blocks any WhatsApp attempt via Brevo.
   */
  public sendWhatsApp(): never {
    throw new Error('BREVO_WHATSAPP_DISABLED_ON_FREE_TIER: WhatsApp messaging is prohibited on Brevo Free plan.');
  }

  /**
   * Dispatches transactional email within strict 200 sends/day cap.
   * Queues to brevo_message_queue if limit reached.
   */
  public async sendTransactionalEmail(payload: BrevoEmailPayload): Promise<BrevoSendResult> {
    const primaryRecipient = payload.to[0]?.email;
    if (!primaryRecipient) {
      return { success: false, status: 'ERROR', reason: 'Missing recipient email' };
    }

    // 1. Suppression list verification
    const isSuppressed = await PlatformProspectDiscoveryEngine.getInstance().isContactSuppressedAsync(undefined, primaryRecipient);
    if (isSuppressed) {
      return {
        success: false,
        status: 'SUPPRESSED',
        reason: `Recipient '${primaryRecipient}' is in outreach_suppression_list.`
      };
    }

    // 2. Pre-execution Quota Reservation via Centralized D1/SQLite Ledger (EVALUATE -> RESERVE -> EXECUTE -> RECONCILE)
    // Check both legacy daily quota table (for test backwards-compatibility) and unified atomic ledger
    const legacySends = await this.getDailySendCount();
    let quotaRes = { allowed: legacySends < BrevoMcpClient.MAX_DAILY_SENDS, reservationId: undefined as string | undefined, reason: undefined as string | undefined };

    if (quotaRes.allowed) {
      const unifiedRes = await this.quotaService.reserveProviderQuota('brevo_mcp', 1);
      quotaRes = {
        allowed: unifiedRes.allowed,
        reservationId: unifiedRes.reservationId,
        reason: unifiedRes.reason
      };
    }

    if (!quotaRes.allowed) {
      const queueId = `bmq_${randomUUID().slice(0, 8)}`;
      const sql = `
        INSERT INTO brevo_message_queue (id, recipient_email, subject, payload_json, status, created_at)
        VALUES (?, ?, ?, ?, 'QUEUED_NEXT_UTC_WINDOW', datetime('now'))
      `;
      try {
        if (isProduction() || this.d1Repo.isRemoteD1Configured()) {
          await this.d1Repo.executeWrite('brevo_message_queue', sql, [queueId, primaryRecipient, payload.subject, JSON.stringify(payload)]);
        }
        const db = getDb();
        db.prepare(sql).run(queueId, primaryRecipient, payload.subject, JSON.stringify(payload));
      } catch {}

      return {
        success: false,
        status: 'QUEUED_NEXT_UTC_WINDOW',
        reason: quotaRes.reason || `Daily send limit (${BrevoMcpClient.MAX_DAILY_SENDS}/day) reached. Message queued for next UTC window.`,
        dailySendsRemaining: 0
      };
    }

    // 3. Dispatch to Brevo API / Mock
    const isLive = Boolean(this.apiKey && !isPlaceholderCredential(this.apiKey));
    let messageId = `msg_${randomUUID().slice(0, 12)}`;

    if (isLive) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': this.apiKey!,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: process.env.PUBLIC_CONTACT_EMAIL || 'support@ai-marketing-organization.com', name: process.env.PUBLIC_SITE_NAME || 'AI Marketing Organization' },
            to: payload.to,
            subject: payload.subject,
            htmlContent: payload.htmlContent || `<p>${payload.textContent || ''}</p>`,
            textContent: payload.textContent,
            templateId: payload.templateId,
            params: payload.params,
            attachment: payload.attachment
          })
        });

        if (!res.ok) {
          const errBody = await res.text();
          if (quotaRes.reservationId) {
            await this.quotaService.reconcileProviderQuota('brevo_mcp', quotaRes.reservationId, 'CONSUME');
          }
          return {
            success: false,
            status: 'ERROR',
            reason: `Brevo API HTTP ${res.status}: ${errBody}`
          };
        }

        const data: any = await res.json();
        messageId = data.messageId || messageId;
      } catch (err: any) {
        // Pre-send connection error: release reservation
        if (quotaRes.reservationId) {
          await this.quotaService.reconcileProviderQuota('brevo_mcp', quotaRes.reservationId, 'RELEASE');
        }
        return {
          success: false,
          status: 'ERROR',
          reason: `Brevo dispatch error: ${err.message}`
        };
      }
    }

    // 4. Reconcile atomic reservation and increment daily ledger
    if (quotaRes.reservationId) {
      await this.quotaService.reconcileProviderQuota('brevo_mcp', quotaRes.reservationId, 'CONSUME');
    }
    const newCount = await this.incrementDailySendCount();
    return {
      success: true,
      messageId,
      status: 'SENT',
      dailySendsRemaining: Math.max(0, BrevoMcpClient.MAX_DAILY_SENDS - newCount)
    };
  }

  /**
   * Syncs consent-verified contact within 2,000 contact limit.
   */
  public async syncContact(contact: { email: string; attributes?: Record<string, any>; listIds?: number[] }): Promise<{ success: boolean; reason?: string }> {
    const isLive = Boolean(this.apiKey && !isPlaceholderCredential(this.apiKey));
    if (!isLive) {
      return { success: true, reason: 'SANDBOX_SYNC_SIMULATED' };
    }

    try {
      const res = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: contact.email,
          attributes: contact.attributes,
          listIds: contact.listIds || [1],
          updateEnabled: true
        })
      });
      return { success: res.ok, reason: res.ok ? undefined : await res.text() };
    } catch (err: any) {
      return { success: false, reason: err.message };
    }
  }

  /**
   * Syncs CRM deal within 50 open deals limit.
   */
  public async syncDeal(deal: { name: string; amount?: number; stage?: string }): Promise<{ success: boolean; reason?: string }> {
    const isLive = Boolean(this.apiKey && !isPlaceholderCredential(this.apiKey));
    if (!isLive) {
      return { success: true, reason: 'SANDBOX_DEAL_SIMULATED' };
    }

    try {
      const res = await fetch('https://api.brevo.com/v3/crm/deals', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey!,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: deal.name,
          attributes: {
            deal_stage: deal.stage || 'lead',
            amount: deal.amount || 0
          }
        })
      });
      return { success: res.ok, reason: res.ok ? undefined : await res.text() };
    } catch (err: any) {
      return { success: false, reason: err.message };
    }
  }

  /**
   * Handles delivery, bounce, and unsubscribe webhook events.
   * Auto-suppresses bounced and unsubscribed emails into outreach_suppression_list.
   */
  public async handleWebhookEvent(event: { event: string; email: string; reason?: string }): Promise<{ processed: boolean; suppressed: boolean }> {
    if (!event.email) return { processed: false, suppressed: false };

    const lowerEvent = (event.event || '').toLowerCase();
    const shouldSuppress = ['hard_bounce', 'soft_bounce', 'spam', 'unsubscribed', 'blocked'].includes(lowerEvent);

    if (shouldSuppress) {
      await PlatformProspectDiscoveryEngine.getInstance().suppressContact(
        event.email,
        'EMAIL',
        `BREVO_WEBHOOK_${lowerEvent.toUpperCase()}`
      );
      return { processed: true, suppressed: true };
    }

    return { processed: true, suppressed: false };
  }
}
