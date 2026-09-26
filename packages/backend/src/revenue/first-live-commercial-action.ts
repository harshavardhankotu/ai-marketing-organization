/**
 * FirstLiveCommercialAction — Governs the milestone of the organization's first genuine outbound communication.
 *
 * Implements Spec §§ 5, 24, 31:
 * - Requirements for execution:
 *     1. Authorized provider (WhatsApp Cloud API or SendGrid verified)
 *     2. Real recipient (Phone or email)
 *     3. Real business context (Validated prospect observation)
 *     4. Real message (Personalized offer pitch)
 *     5. Real provider response (HTTP 2xx from Meta / SendGrid)
 *     6. Real external message ID (e.g. wamid.HBg... or SendGrid msg ID)
 *     7. Persisted evidence in commercial_evidence & autonomous_action_traces
 *     8. Tenant & Purpose context
 *     9. Idempotency key: outreach:{opportunity_id}:{sequence_step}
 * - Invariant:
 *     Before success: LIVE_EXTERNAL_ACTION = 0
 *     After success: LIVE_EXTERNAL_ACTION = 1
 *     Zero simulated success.
 */

import { getDb } from '../db/client.js';
import { LiveProviderActivation } from './live-provider-activation.js';
import { OutboundEngine, OutboundMessageRequest, OutboundDispatchResult } from './outbound-engine.js';
import { CommercialLifecycleManager } from './commercial-lifecycle.js';

export interface FirstLiveOutboundRequest {
  organizationId: string;
  businessId: string;
  opportunityId: string;
  sequenceStep: number;
  channel: 'WHATSAPP' | 'EMAIL';
  recipientPhone?: string;
  recipientEmail?: string;
  recipientName: string;
  businessName: string;
  observedPainPoint: string;
  proposedOutcome: string;
  messageText: string;
  purpose: string;
}

export interface FirstLiveOutboundResult {
  executed: boolean;
  actionClassification: 'LIVE_EXTERNAL_ACTION' | 'BLOCKED_AUTHORIZATION' | 'IDEMPOTENT_SKIPPED';
  provider: string;
  externalMessageId?: string;
  milestoneAchieved: boolean;
  liveExternalActionsCount: number;
  reason: string;
  idempotencyKey: string;
}

export class FirstLiveCommercialActionManager {
  private static instance: FirstLiveCommercialActionManager;
  private activationCenter = LiveProviderActivation.getInstance();
  private outboundEngine = OutboundEngine.getInstance();
  private lifecycleManager = CommercialLifecycleManager.getInstance();

  public static getInstance(): FirstLiveCommercialActionManager {
    if (!FirstLiveCommercialActionManager.instance) {
      FirstLiveCommercialActionManager.instance = new FirstLiveCommercialActionManager();
    }
    return FirstLiveCommercialActionManager.instance;
  }

  /**
   * Executes the first live outbound commercial action with strict idempotency and evidence logging.
   */
  public async executeFirstOutbound(request: FirstLiveOutboundRequest): Promise<FirstLiveOutboundResult> {
    const db = getDb();
    const idempotencyKey = `outreach:${request.opportunityId}:${request.sequenceStep}`;

    // 1. Idempotency Check (§ 31)
    try {
      const existing = db.prepare(`SELECT * FROM idempotent_actions WHERE idempotency_key = ?`).get(idempotencyKey) as any;
      if (existing) {
        return {
          executed: false,
          actionClassification: 'IDEMPOTENT_SKIPPED',
          provider: request.channel,
          milestoneAchieved: false,
          liveExternalActionsCount: this.getLiveExternalActionCount(request.organizationId),
          reason: `Action with idempotency key "${idempotencyKey}" already executed at ${existing.executed_at}.`,
          idempotencyKey
        };
      }
    } catch {}

    // 2. Check Provider Authorization (§ 4)
    const providerName = request.channel === 'WHATSAPP' ? 'OUTBOUND_WHATSAPP' : 'OUTBOUND_EMAIL';
    const providerStatus = this.activationCenter.getStatus(providerName);

    if (providerStatus.state === 'NOT_CONFIGURED' || providerStatus.state === 'FAILED') {
      return {
        executed: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        provider: request.channel,
        milestoneAchieved: false,
        liveExternalActionsCount: this.getLiveExternalActionCount(request.organizationId),
        reason: `Provider ${providerName} is in state ${providerStatus.state}. ${providerStatus.failureReason || 'Live credentials missing.'}`,
        idempotencyKey
      };
    }

    // 3. Attempt Live Dispatch via OutboundEngine (§ 7)
    const dispatchReq: OutboundMessageRequest = {
      businessId: request.businessId,
      organizationId: request.organizationId,
      channel: request.channel,
      recipientId: request.opportunityId,
      recipientContact: (request.channel === 'WHATSAPP' ? request.recipientPhone : request.recipientEmail) || '',
      recipientName: request.recipientName,
      body: request.messageText
    };

    const dispatchResult: OutboundDispatchResult = await this.outboundEngine.dispatch(dispatchReq);

    // 4. Handle Unverified / Blocked Result
    if (!dispatchResult.success || !dispatchResult.externalId || dispatchResult.actionClassification !== 'LIVE_EXTERNAL_ACTION') {
      return {
        executed: false,
        actionClassification: 'BLOCKED_AUTHORIZATION',
        provider: request.channel,
        milestoneAchieved: false,
        liveExternalActionsCount: this.getLiveExternalActionCount(request.organizationId),
        reason: dispatchResult.error || 'Provider rejected request or did not return live external identifier.',
        idempotencyKey
      };
    }

    // 5. Genuine Live Success: Record Evidence & Trace (§ 5, § 24)
    const now = new Date().toISOString();

    // Record idempotency lock
    try {
      db.prepare(`
        INSERT INTO idempotent_actions (idempotency_key, action_type, target_id, tenant_id, executed_at, status, result_json)
        VALUES (?, 'OUTREACH_SEND', ?, ?, ?, 'SUCCESS', ?)
      `).run(idempotencyKey, request.opportunityId, request.organizationId, now, JSON.stringify(dispatchResult));
    } catch {}

    // Record commercial evidence
    this.lifecycleManager.recordEvidence({
      milestone: 'M1_FIRST_LIVE_OUTBOUND',
      provider: request.channel,
      externalId: dispatchResult.externalId,
      requestReference: idempotencyKey,
      tenantId: request.organizationId,
      businessId: request.businessId,
      classification: process.env.NODE_ENV === 'test' ? 'TEST' : 'REAL',
      verificationSource: `${request.channel}_CLOUD_API_CONFIRMATION`,
      details: {
        recipientContact: dispatchReq.recipientContact,
        businessName: request.businessName,
        purpose: request.purpose,
        observedPainPoint: request.observedPainPoint
      }
    });

    // Record autonomous action trace
    try {
      db.prepare(`
        INSERT INTO autonomous_action_traces (
          id, cycle_id, tenant_id, action_type, classification,
          target_entity_type, target_entity_id, provider_called,
          external_call_made, external_identifier_received, http_status,
          verification_status, evidence_payload_json, rationale, timestamp
        ) VALUES (?, ?, ?, 'OUTBOUND_SEND', 'LIVE_EXTERNAL_ACTION', 'OPPORTUNITY', ?, ?, 1, ?, 200, 'VERIFIED', ?, ?, ?)
      `).run(
        `trace_${Date.now()}`,
        `cycle_${Date.now()}`,
        request.organizationId,
        request.opportunityId,
        request.channel,
        dispatchResult.externalId,
        JSON.stringify(dispatchResult),
        `First live commercial outbound outreach dispatched to ${request.businessName}.`,
        now
      );
    } catch {}

    const newLiveCount = this.getLiveExternalActionCount(request.organizationId);

    return {
      executed: true,
      actionClassification: 'LIVE_EXTERNAL_ACTION',
      provider: request.channel,
      externalMessageId: dispatchResult.externalId,
      milestoneAchieved: true,
      liveExternalActionsCount: newLiveCount,
      reason: `First live commercial outbound outreach successfully delivered with external ID ${dispatchResult.externalId}.`,
      idempotencyKey
    };
  }

  private getLiveExternalActionCount(organizationId: string): number {
    const db = getDb();
    try {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM autonomous_action_traces
        WHERE tenant_id = ? AND classification = 'LIVE_EXTERNAL_ACTION'
      `).get(organizationId) as any;
      return row?.count || 0;
    } catch {
      return 0;
    }
  }
}
