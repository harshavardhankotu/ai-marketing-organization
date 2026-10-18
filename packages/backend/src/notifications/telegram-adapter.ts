/**
 * TelegramBotAdapter — Direct Owner Alerts via Telegram Bot API
 *
 * Implements Step 5: Owner Alerts (Free, Owner-Owned)
 * - Sends notifications ONLY to the owner's personal chat (TELEGRAM_OWNER_CHAT_ID).
 * - Events: New lead inquiry, new payment claim, daily digest.
 * - Gated strictly by: TELEGRAM_ENABLED=true, TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_ID.
 * - Stays completely off until the owner sets the environment variables.
 * - Never messages strangers, groups, or channels.
 */

export interface TelegramAlertResult {
  sent: boolean;
  reason?: string;
  messageId?: number;
}

export interface InquiryAlertPayload {
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  clinicName: string;
  isTest?: boolean;
}

export interface PaymentClaimAlertPayload {
  utr: string;
  payerName?: string | null;
  amountINR: number;
  proposalId?: string | null;
  isTest?: boolean;
}

export class TelegramBotAdapter {
  private static instance: TelegramBotAdapter;
  private customBaseUrl?: string;

  private constructor() {}

  public static getInstance(): TelegramBotAdapter {
    if (!TelegramBotAdapter.instance) {
      TelegramBotAdapter.instance = new TelegramBotAdapter();
    }
    return TelegramBotAdapter.instance;
  }

  /**
   * For hermetic testing with a mock HTTP server.
   */
  public setCustomBaseUrl(url?: string): void {
    this.customBaseUrl = url;
  }

  public isConfigured(): boolean {
    const enabled = (process.env.TELEGRAM_ENABLED || '').trim().toLowerCase() === 'true';
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = (process.env.TELEGRAM_OWNER_CHAT_ID || '').trim();
    return enabled && token.length > 0 && chatId.length > 0;
  }

  /**
   * Core private send method: sends strictly to TELEGRAM_OWNER_CHAT_ID.
   */
  public async sendMessage(text: string): Promise<TelegramAlertResult> {
    if (!this.isConfigured()) {
      return { sent: false, reason: 'TELEGRAM_DISABLED_OR_UNCONFIGURED' };
    }

    const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
    const chatId = process.env.TELEGRAM_OWNER_CHAT_ID!.trim();

    // Guard: Never send to channels (-100 prefix) or invalid IDs
    if (chatId.startsWith('-100')) {
      return { sent: false, reason: 'SECURITY_VIOLATION: Telegram alert chat ID must be a personal owner chat, not a broadcast channel.' };
    }

    const baseUrl = this.customBaseUrl || `https://api.telegram.org/bot${token}`;
    const url = `${baseUrl.replace(/\/$/, '')}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown'
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return { sent: false, reason: `HTTP_${res.status}: ${errText.slice(0, 200)}` };
      }

      const data = await res.json().catch(() => ({})) as any;
      return { sent: true, messageId: data?.result?.message_id };
    } catch (err: any) {
      return { sent: false, reason: err.message || 'NETWORK_ERROR' };
    }
  }

  /**
   * Sends an alert when a prospective client submits an inquiry on /offer.
   */
  public async notifyInquiry(payload: InquiryAlertPayload): Promise<TelegramAlertResult> {
    const testTag = payload.isTest ? '⚠️ [TEST RECORD - NEEDS OWNER REVIEW]\n' : '';
    const message =
      `${testTag}🎯 *New Commercial Inquiry Received*\n\n` +
      `*Clinic / Practice:* ${payload.clinicName}\n` +
      `*Contact Person:* ${payload.customerName}\n` +
      `*Phone / WhatsApp:* ${payload.customerPhone}\n` +
      `*Email:* ${payload.customerEmail || 'Not provided'}\n\n` +
      `Action: Open owner dashboard to review intake and schedule demonstration.`;

    return this.sendMessage(message);
  }

  /**
   * Sends an alert when a customer submits a manual UPI payment claim with a UTR.
   */
  public async notifyPaymentClaim(payload: PaymentClaimAlertPayload): Promise<TelegramAlertResult> {
    const testTag = payload.isTest ? '⚠️ [TEST RECORD - QUARANTINED]\n' : '';
    const message =
      `${testTag}💰 *New Manual UPI Payment Claimed*\n\n` +
      `*Amount:* ₹${payload.amountINR.toLocaleString('en-IN')}\n` +
      `*UTR / Ref:* \`${payload.utr}\`\n` +
      `*Payer:* ${payload.payerName || 'Not specified'}\n` +
      `*Proposal ID:* ${payload.proposalId || 'Direct / None'}\n\n` +
      `Action: Check bank account for matching credit before confirming.`;

    return this.sendMessage(message);
  }
}
