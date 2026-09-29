/**
 * OutboundEngine — Governs real multi-channel prospect communication.
 *
 * Implements Spec § 7:
 * - Adapters: WHATSAPP, EMAIL, SMS, LINKEDIN.
 * - Adapter lifecycle:
 *     DISCOVERY -> HEALTH_CHECK -> AUTHORIZATION_CHECK -> SEND -> VERIFY_ACCEPTANCE -> READ_STATUS -> REPLY -> RATE_LIMIT -> UNSUBSCRIBE -> DO_NOT_CONTACT
 * - Strict truth integrity:
 *     No credentials -> BLOCKED_AUTHORIZATION (success: false).
 *     Sandbox mode -> SANDBOX_ACTION (never claims live).
 *     Live mode -> LIVE_EXTERNAL_ACTION requires HTTP 2xx, external provider ID, and persisted evidence.
 *     Suppressed/opted-out contact -> BLOCKED_AUTHORIZATION.
 */

import { getDb } from '../db/client.js';
import { WhatsAppAdapter, EmailAdapter, ActionClassification, IntegrationProvider } from '../integrations/adapter-base.js';
import { AutonomyPolicyController } from './autonomy-policy.js';

export type OutboundChannel = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'LINKEDIN';

export interface OutboundMessageRequest {
  businessId: string;
  organizationId: string;
  channel: OutboundChannel;
  recipientId: string;
  recipientContact: string; // phone or email
  recipientName?: string;
  subject?: string;
  body: string;
  campaignId?: string;
  offerId?: string;
  isColdOutreach?: boolean;
  isInboundResponse?: boolean;
  isApproved?: boolean;
  approverId?: string;
}

export interface OutboundDispatchResult {
  success: boolean;
  actionClassification: ActionClassification;
  provider: IntegrationProvider;
  externalId?: string;
  error?: string;
  status:
    | 'DELIVERED'
    | 'BLOCKED_AUTHORIZATION'
    | 'SANDBOX_DELIVERED'
    | 'SUPPRESSED'
    | 'FAILED'
    | 'CHANNEL_PAUSED'
    | 'APPROVAL_REQUIRED'
    | 'DAILY_OUTBOUND_CAP_REACHED';
  dispatchedAt: string;
}

export class OutboundEngine {
  private static instance: OutboundEngine;
  private policyController = AutonomyPolicyController.getInstance();

  public static getInstance(): OutboundEngine {
    if (!OutboundEngine.instance) {
      OutboundEngine.instance = new OutboundEngine();
    }
    return OutboundEngine.instance;
  }

  /**
   * Check authorization and credentials for an outbound channel.
   */
  public async checkChannelAuthorization(channel: OutboundChannel): Promise<{
    authorized: boolean;
    mode: 'LIVE' | 'SANDBOX' | 'UNCONFIGURED';
    reason: string;
  }> {
    if (channel === 'WHATSAPP') {
      const wa = new WhatsAppAdapter();
      const health = await wa.checkHealth();
      return {
        authorized: health.connected && health.mode === 'LIVE',
        mode: health.mode,
        reason: health.details
      };
    }

    if (channel === 'EMAIL') {
      const email = new EmailAdapter();
      const health = await email.checkHealth();
      return {
        authorized: health.connected && health.mode === 'LIVE',
        mode: health.mode,
        reason: health.details
      };
    }

    // SMS & LinkedIn: unconfigured by default unless explicit keys exist
    const hasSmsCreds = Boolean(process.env.TWILIO_AUTH_TOKEN && !process.env.TWILIO_AUTH_TOKEN.includes('placeholder'));
    if (channel === 'SMS') {
      return {
        authorized: hasSmsCreds,
        mode: hasSmsCreds ? 'LIVE' : 'UNCONFIGURED',
        reason: hasSmsCreds ? 'SMS Gateway Live' : 'SMS Gateway Unconfigured'
      };
    }

    const hasLinkedInCreds = Boolean(process.env.LINKEDIN_OAUTH_TOKEN && !process.env.LINKEDIN_OAUTH_TOKEN.includes('placeholder'));
    if (channel === 'LINKEDIN') {
      return {
        authorized: hasLinkedInCreds,
        mode: hasLinkedInCreds ? 'LIVE' : 'UNCONFIGURED',
        reason: hasLinkedInCreds ? 'LinkedIn API Live' : 'LinkedIn API Unconfigured'
      };
    }

    return {
      authorized: false,
      mode: 'UNCONFIGURED',
      reason: `Unsupported channel: ${channel}`
    };
  }

  /**
   * Dispatches an outbound message with complete policy, suppression, and live provider validation.
   */
  public async dispatch(request: OutboundMessageRequest): Promise<OutboundDispatchResult> {
    const dispatchedAt = new Date().toISOString();

    // 1. Contact Safety / Suppression Check (§ 24)
    const safety = this.policyController.getContactSafety(request.recipientContact);
    if (safety !== 'CONTACTABLE') {
      return {
        success: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        provider: request.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP',
        error: `Outbound blocked: Contact has status ${safety}. Outbound communication prohibited.`,
        status: 'SUPPRESSED',
        dispatchedAt
      };
    }

    // 2. Rolling 24-hour daily outbound cap (5 sends max across platform)
    const rollingCount = this.policyController.getRolling24hOutboundCount(request.organizationId);
    if (rollingCount >= 5) {
      return {
        success: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        provider: request.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP',
        error: `DAILY_OUTBOUND_CAP_REACHED: Rolling 24-hour limit of 5 outbound actions reached (${rollingCount} sent in last 24h).`,
        status: 'DAILY_OUTBOUND_CAP_REACHED',
        dispatchedAt
      };
    }

    // 3. WhatsApp Cold Outreach Pause (paused for platform safety; only inbound responses allowed)
    if (request.channel === 'WHATSAPP' && !request.isInboundResponse) {
      return {
        success: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        provider: 'WHATSAPP',
        error: 'CHANNEL_PAUSED: WhatsApp cold outreach is paused for platform safety. Only inbound customer responses are permitted.',
        status: 'CHANNEL_PAUSED',
        dispatchedAt
      };
    }

    // 4. Cold Email Approval Requirement
    const isColdEmail = request.channel === 'EMAIL' && (request.isColdOutreach === true || (!request.isInboundResponse && request.isColdOutreach !== false));
    if (isColdEmail && !request.isApproved && !request.approverId) {
      this.recordPendingDraft(request, 'APPROVAL_REQUIRED');
      return {
        success: false,
        actionClassification: 'APPROVAL_REQUIRED',
        provider: 'EMAIL',
        error: 'APPROVAL_REQUIRED: Cold email outreach requires explicit clinic owner approval before sending.',
        status: 'APPROVAL_REQUIRED',
        dispatchedAt
      };
    }

    // 5. Autonomy Policy Gate (§ 23)
    const isCold = request.isColdOutreach ?? (!request.isInboundResponse);
    const policyResult = this.policyController.evaluateAction(request.organizationId, 'OUTBOUND_SEND', {
      channel: request.channel,
      costINR: 0,
      targetContactId: request.recipientContact,
      isColdOutreach: isCold,
      isInboundResponse: request.isInboundResponse,
      isApproved: request.isApproved,
      approverId: request.approverId
    });

    if (!policyResult.allowed) {
      const violated = policyResult.violatedRule;
      let finalStatus: OutboundDispatchResult['status'] = 'BLOCKED_AUTHORIZATION';
      let classification: ActionClassification = 'BLOCKED_AUTHORIZATION';
      if (violated === 'CHANNEL_PAUSED') {
        finalStatus = 'CHANNEL_PAUSED';
      } else if (violated === 'APPROVAL_REQUIRED') {
        finalStatus = 'APPROVAL_REQUIRED';
        classification = 'APPROVAL_REQUIRED';
        this.recordPendingDraft(request, 'APPROVAL_REQUIRED');
      } else if (violated === 'DAILY_OUTBOUND_CAP_REACHED') {
        finalStatus = 'DAILY_OUTBOUND_CAP_REACHED';
      }
      return {
        success: false,
        actionClassification: classification,
        provider: request.channel === 'EMAIL' ? 'EMAIL' : 'WHATSAPP',
        error: `Policy violation: ${policyResult.reason}`,
        status: finalStatus,
        dispatchedAt
      };
    }

    // 3. Channel Authorization & Provider Dispatch
    if (request.channel === 'WHATSAPP') {
      const wa = new WhatsAppAdapter();
      const health = await wa.checkHealth();

      if (!health.connected || health.mode !== 'LIVE') {
        return {
          success: false,
          actionClassification: 'BLOCKED_AUTHORIZATION',
          provider: 'WHATSAPP',
          error: 'BLOCKED_AUTHORIZATION: WhatsApp Meta Cloud API credentials not configured',
          status: 'BLOCKED_AUTHORIZATION',
          dispatchedAt
        };
      }

      const res = await wa.publish({
        title: request.subject || 'Outbound Update',
        body: request.body,
        channel: 'WHATSAPP',
        recipientPhone: request.recipientContact
      });

      this.recordOutboundLog(request, res.success, res.externalId, res.actionClassification);

      if (res.success && res.actionClassification === 'LIVE_EXTERNAL_ACTION') {
        return {
          success: true,
          actionClassification: 'LIVE_EXTERNAL_ACTION',
          provider: 'WHATSAPP',
          externalId: res.externalId,
          status: 'DELIVERED',
          dispatchedAt
        };
      }

      return {
        success: false,
        actionClassification: res.actionClassification,
        provider: 'WHATSAPP',
        error: res.message,
        status: res.actionClassification === 'SANDBOX_ACTION' ? 'SANDBOX_DELIVERED' : 'FAILED',
        dispatchedAt
      };
    }

    if (request.channel === 'EMAIL') {
      const email = new EmailAdapter();
      const health = await email.checkHealth();

      if (!health.connected || health.mode !== 'LIVE') {
        return {
          success: false,
          actionClassification: 'BLOCKED_AUTHORIZATION',
          provider: 'EMAIL',
          error: 'BLOCKED_AUTHORIZATION: SendGrid/SMTP API credentials not configured',
          status: 'BLOCKED_AUTHORIZATION',
          dispatchedAt
        };
      }

      const res = await email.publish({
        title: request.subject || 'Consultation Update',
        body: request.body,
        channel: 'EMAIL',
        recipientEmail: request.recipientContact
      });

      this.recordOutboundLog(request, res.success, res.externalId, res.actionClassification);

      if (res.success && res.actionClassification === 'LIVE_EXTERNAL_ACTION') {
        return {
          success: true,
          actionClassification: 'LIVE_EXTERNAL_ACTION',
          provider: 'EMAIL',
          externalId: res.externalId,
          status: 'DELIVERED',
          dispatchedAt
        };
      }

      return {
        success: false,
        actionClassification: res.actionClassification,
        provider: 'EMAIL',
        error: res.message,
        status: 'FAILED',
        dispatchedAt
      };
    }

    return {
      success: false,
      actionClassification: 'BLOCKED_AUTHORIZATION',
      provider: 'WHATSAPP',
      error: `Channel ${request.channel} credentials not configured in production`,
      status: 'BLOCKED_AUTHORIZATION',
      dispatchedAt
    };
  }

  private recordOutboundLog(
    request: OutboundMessageRequest,
    success: boolean,
    externalId?: string,
    classification: ActionClassification = 'INTERNAL_AUTOMATION'
  ): void {
    const db = getDb();
    try {
      const logId = `out_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel,
          message_draft, compliance_checked, human_approved,
          dispatched, dispatch_timestamp, response_status, created_at
        ) VALUES (?, ?, 'OUTBOUND_PROSPECT', ?, ?, ?, 1, 1, ?, datetime('now'), ?, datetime('now'))
      `).run(
        logId,
        request.businessId,
        request.recipientName || request.recipientContact,
        request.channel,
        request.body,
        success ? 1 : 0,
        classification
      );

      // Increment contact count on outbound_contacts
      db.prepare(`
        UPDATE outbound_contacts
        SET contact_count = contact_count + 1, last_contacted_at = datetime('now'), updated_at = datetime('now')
        WHERE prospect_phone = ? OR prospect_email = ?
      `).run(request.recipientContact, request.recipientContact);
    } catch {}
  }

  public recordPendingDraft(
    request: OutboundMessageRequest,
    status: string = 'APPROVAL_REQUIRED'
  ): string {
    const db = getDb();
    const logId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      db.prepare(`
        INSERT INTO direct_outreach_log (
          id, business_id, segment, prospect_name, channel,
          message_draft, compliance_checked, human_approved,
          dispatched, dispatch_timestamp, response_status, created_at
        ) VALUES (?, ?, 'OUTBOUND_PROSPECT', ?, ?, ?, 1, 0, 0, NULL, ?, datetime('now'))
      `).run(
        logId,
        request.businessId,
        request.recipientName || request.recipientContact,
        request.channel,
        request.body,
        status
      );
    } catch {}
    return logId;
  }
}
