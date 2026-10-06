/**
 * AutonomyPolicy — Authoritative bounds and safety controller for autonomous execution.
 *
 * Implements Spec §§ 21, 22, 23, 24:
 * - Zero-budget economics: marketing_budget = ₹0, paid_acquisition_allowed = false.
 * - Max actions per wake: 1 (bounded execution).
 * - Max external actions per day: 50.
 * - Contact safety & DPDP Act 2023 compliance:
 *     Status: CONTACTABLE | NO_CONSENT | DO_NOT_CONTACT | UNSUBSCRIBED | BOUNCED | INVALID | BLOCKED
 *     Explicit opt-out creates permanent suppression that overrides all agent recommendations.
 * - Strict gating: Agent Proposal -> AutonomyPolicy -> Authorization -> Quota -> Execution.
 */

import { getDb } from '../db/client.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

export type ContactSafetyStatus =
  | 'CONTACTABLE'
  | 'NO_CONSENT'
  | 'DO_NOT_CONTACT'
  | 'UNSUBSCRIBED'
  | 'BOUNCED'
  | 'INVALID'
  | 'BLOCKED';

export interface AutonomyPolicyConfig {
  organizationId: string;
  maxActionsPerWake: number;
  maxExternalActionsPerDay: number;
  maxMessagesPerContact: number;
  followupCooldownHours: number;
  paymentRetryPolicy: { maxRetries: number; backoffHours: number };
  researchDailyBudgetCredits: number;
  aiDailyBudgetRequests: number;
  marketingBudgetINR: number;
  paidAcquisitionAllowed: boolean;
  allowedChannels: string[];
  allowedRegions: string[];
  consentPolicy: string;
  killSwitch: boolean;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason: string;
  violatedRule?: string;
  policy: AutonomyPolicyConfig;
}

export class AutonomyPolicyController {
  private static instance: AutonomyPolicyController;

  public static getInstance(): AutonomyPolicyController {
    if (!AutonomyPolicyController.instance) {
      AutonomyPolicyController.instance = new AutonomyPolicyController();
    }
    return AutonomyPolicyController.instance;
  }

  /**
   * Retrieves policy configuration for an organization, or standard zero-spend default.
   */
  public getPolicy(organizationId: string): AutonomyPolicyConfig {
    const db = getDb();
    try {
      const row = db.prepare(`SELECT * FROM autonomy_policy_config WHERE organization_id = ?`).get(organizationId) as any;
      if (row) {
        return {
          organizationId: row.organization_id,
          maxActionsPerWake: row.max_actions_per_wake,
          maxExternalActionsPerDay: row.max_external_actions_per_day,
          maxMessagesPerContact: row.max_messages_per_contact,
          followupCooldownHours: row.followup_cooldown_hours,
          paymentRetryPolicy: JSON.parse(row.payment_retry_policy_json || '{"maxRetries":3,"backoffHours":24}'),
          researchDailyBudgetCredits: row.research_daily_budget_credits,
          aiDailyBudgetRequests: row.ai_daily_budget_requests,
          marketingBudgetINR: row.marketing_budget_inr,
          paidAcquisitionAllowed: Boolean(row.paid_acquisition_allowed),
          allowedChannels: JSON.parse(row.allowed_channels_json || '["WHATSAPP","EMAIL","LOCAL_SEARCH"]'),
          allowedRegions: JSON.parse(row.allowed_regions_json || '["IN"]'),
          consentPolicy: row.consent_policy,
          killSwitch: Boolean(row.kill_switch)
        };
      }
    } catch {}

    // Default authoritative policy: strictly ₹0 budget, 1 action per wake, 5 external actions/day max
    return {
      organizationId,
      maxActionsPerWake: 1,
      maxExternalActionsPerDay: 5,
      maxMessagesPerContact: 3,
      followupCooldownHours: 24,
      paymentRetryPolicy: { maxRetries: 3, backoffHours: 24 },
      researchDailyBudgetCredits: 800,
      aiDailyBudgetRequests: 1200,
      marketingBudgetINR: 0.0,
      paidAcquisitionAllowed: false,
      allowedChannels: ['WHATSAPP', 'EMAIL', 'LOCAL_SEARCH'],
      allowedRegions: ['IN'],
      consentPolicy: 'DPDP_2023_EXPLICIT',
      killSwitch: false
    };
  }

  /**
   * Evaluates whether a proposed action complies with safety, budget, and channel policies.
   */
  public evaluateAction(
    organizationId: string,
    actionType: string,
    params: {
      channel?: string;
      costINR?: number;
      targetContactId?: string;
      region?: string;
      isColdOutreach?: boolean;
      isInboundResponse?: boolean;
      isApproved?: boolean;
      approverId?: string;
    } = {}
  ): PolicyEvaluationResult {
    const policy = this.getPolicy(organizationId);

    // 1. Kill switch check
    if (policy.killSwitch) {
      return {
        allowed: false,
        reason: 'Organization kill switch is active. All autonomous actions suspended.',
        violatedRule: 'KILL_SWITCH',
        policy
      };
    }

    // 2. Budget and paid acquisition checks
    const cost = params.costINR || 0;
    if (cost > 0 && !policy.paidAcquisitionAllowed) {
      return {
        allowed: false,
        reason: `Action requires ₹${cost} spend, but policy enforces strict ₹0 budget and paidAcquisitionAllowed=false.`,
        violatedRule: 'ZERO_BUDGET_POLICY',
        policy
      };
    }

    // 3. Channel authorization check
    if (params.channel) {
      const channelUpper = params.channel.toUpperCase();
      if (!policy.allowedChannels.includes(channelUpper)) {
        return {
          allowed: false,
          reason: `Channel "${params.channel}" is not permitted under organization policy. Allowed: ${policy.allowedChannels.join(', ')}.`,
          violatedRule: 'CHANNEL_NOT_ALLOWED',
          policy
        };
      }
    }

    // 4. Contact safety and suppression check
    if (params.targetContactId) {
      const contactSafety = this.getContactSafety(params.targetContactId);
      if (contactSafety !== 'CONTACTABLE') {
        return {
          allowed: false,
          reason: `Contact ${params.targetContactId} is suppressed (${contactSafety}). Outbound communication permanently blocked.`,
          violatedRule: 'CONTACT_SUPPRESSED',
          policy
        };
      }
    }

    // 5. WhatsApp Cold Outreach Pause
    if (params.channel && params.channel.toUpperCase() === 'WHATSAPP') {
      if (params.isColdOutreach === true && !params.isInboundResponse) {
        return {
          allowed: false,
          reason: 'WhatsApp cold outreach is paused for platform safety. Only inbound customer responses are permitted.',
          violatedRule: 'CHANNEL_PAUSED',
          policy
        };
      }
    }

    // 6. Cold Email Approval Requirement
    if (params.channel && params.channel.toUpperCase() === 'EMAIL') {
      if (params.isColdOutreach === true && !params.isApproved && !params.approverId) {
        return {
          allowed: false,
          reason: 'Cold email outreach requires explicit clinic owner approval before sending.',
          violatedRule: 'APPROVAL_REQUIRED',
          policy
        };
      }
    }

    // 7. Rolling 24-hour daily outbound cap
    const rollingCount = this.getRolling24hOutboundCount(organizationId);
    if (rollingCount >= 5) {
      return {
        allowed: false,
        reason: `Rolling 24-hour outbound action limit (5) reached (${rollingCount} sent in last 24h). Execution deferred.`,
        violatedRule: 'DAILY_OUTBOUND_CAP_REACHED',
        policy
      };
    }

    // 8. Daily external action volume check
    const todayExternalActions = this.getTodayExternalActionsCount(organizationId);
    if (todayExternalActions >= policy.maxExternalActionsPerDay) {
      return {
        allowed: false,
        reason: `Daily external action limit (${policy.maxExternalActionsPerDay}) reached for today. Execution deferred.`,
        violatedRule: 'DAILY_EXTERNAL_LIMIT_EXCEEDED',
        policy
      };
    }

    return {
      allowed: true,
      reason: 'Action conforms to all autonomy and safety policies.',
      policy
    };
  }

  public static readonly FORBIDDEN_CONTACTS = new Set([
    '+919999999999',
    '9999999999',
    'support@smilekraft.in',
    'admin@smilekraft.in',
    'platform@aimarketing.local',
    'owner@aimarketing.local'
  ]);

  /**
   * Verifies the contact safety and suppression status of a lead or outbound contact.
   */
  public getContactSafety(contactIdOrPhoneOrEmail: string): ContactSafetyStatus {
    const raw = contactIdOrPhoneOrEmail.trim();
    const cleanPhone = raw.replace(/[^0-9+]/g, '');

    // 1. Check forbidden system and seed contacts
    if (AutonomyPolicyController.FORBIDDEN_CONTACTS.has(raw) || AutonomyPolicyController.FORBIDDEN_CONTACTS.has(cleanPhone)) {
      return 'BLOCKED';
    }

    const db = getDb();
    try {
      // Check outbound_contacts table
      const outbound = db.prepare(`
        SELECT is_opted_out, is_bounced, is_suppressed, suppression_reason, status
        FROM outbound_contacts
        WHERE id = ? OR prospect_email = ? OR prospect_phone = ?
      `).get(raw, raw, raw) as any;

      if (outbound) {
        if (outbound.status === 'REJECTED' || outbound.suppression_reason === 'REJECTED') return 'BLOCKED';
        if (outbound.is_opted_out || outbound.suppression_reason === 'DO_NOT_CONTACT') return 'DO_NOT_CONTACT';
        if (outbound.suppression_reason === 'UNSUBSCRIBED') return 'UNSUBSCRIBED';
        if (outbound.is_bounced) return 'BOUNCED';
        if (outbound.is_suppressed) return 'BLOCKED';
      }

      // Check platform_prospects table
      const prospect = db.prepare(`
        SELECT is_opted_out, stage, status
        FROM platform_prospects
        WHERE id = ? OR prospect_email = ? OR prospect_phone = ?
      `).get(raw, raw, raw) as any;

      if (prospect) {
        if (prospect.status === 'REJECTED') return 'BLOCKED';
        if (prospect.is_opted_out || prospect.stage === 'DO_NOT_CONTACT') return 'DO_NOT_CONTACT';
      }

      // Check customer_journeys opt-out
      const journey = db.prepare(`
        SELECT stage
        FROM customer_journeys
        WHERE id = ? OR customer_email = ? OR customer_phone = ?
      `).get(raw, raw, raw) as any;

      if (journey) {
        if (journey.stage === 'DO_NOT_CONTACT') return 'DO_NOT_CONTACT';
      }
    } catch {}

    return 'CONTACTABLE';
  }

  /**
   * Enforces permanent contact suppression upon opt-out / unsubscribe.
   */
  public suppressContact(contactIdentifier: string, reason: ContactSafetyStatus = 'DO_NOT_CONTACT'): void {
    const db = getDb();
    try {
      const updated1 = db.prepare(`
        UPDATE outbound_contacts
        SET is_opted_out = 1, is_suppressed = 1, suppression_reason = ?, updated_at = datetime('now')
        WHERE id = ? OR prospect_email = ? OR prospect_phone = ?
      `).run(reason, contactIdentifier, contactIdentifier, contactIdentifier);

      if (updated1.changes === 0) {
        const isEmail = contactIdentifier.includes('@');
        const suppId = `supp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const existingJourney = db.prepare('SELECT business_id, organization_id FROM customer_journeys WHERE customer_email = ? OR customer_phone = ? OR id = ?').get(contactIdentifier, contactIdentifier, contactIdentifier) as any;
        let targetBizId = existingJourney?.business_id || OwnerAuthService.PLATFORM_BUSINESS_ID;
        let targetOrgId = existingJourney?.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID;
        if (targetBizId && targetOrgId) {
          db.prepare(`
            INSERT INTO outbound_contacts (
              id, business_id, organization_id, prospect_name,
              prospect_email, prospect_phone, source, is_opted_out, is_suppressed, suppression_reason
            ) VALUES (?, ?, ?, 'Suppressed Contact', ?, ?, 'OPT_OUT', 1, 1, ?)
          `).run(suppId, targetBizId, targetOrgId, isEmail ? contactIdentifier : null, isEmail ? null : contactIdentifier, reason);
        }
      }

      db.prepare(`
        UPDATE platform_prospects
        SET is_opted_out = 1, stage = 'LOST', notes = 'DO_NOT_CONTACT', updated_at = datetime('now')
        WHERE prospect_email = ? OR prospect_phone = ? OR id = ?
      `).run(contactIdentifier, contactIdentifier, contactIdentifier);

      db.prepare(`
        UPDATE customer_journeys
        SET stage = 'DO_NOT_CONTACT', updated_at = datetime('now')
        WHERE id = ? OR customer_email = ? OR customer_phone = ?
      `).run(contactIdentifier, contactIdentifier, contactIdentifier);
    } catch {}
  }

  /**
   * Calculates the rolling 24-hour count of outbound actions across:
   * 1. outbound_action_ledger (status IN ('SENT', 'DELIVERED'))
   * 2. direct_outreach_log (dispatched = 1)
   * 3. autonomous_action_traces (classification = 'LIVE_EXTERNAL_ACTION' and action_type matching outbound)
   */
  public getRolling24hOutboundCount(organizationId?: string): number {
    const db = getDb();
    try {
      // 1. outbound_action_ledger
      let ledgerCount = 0;
      try {
        if (organizationId) {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM outbound_action_ledger
            WHERE (organization_id = ? OR business_id = ?)
              AND status IN ('SENT', 'DELIVERED')
              AND created_at >= datetime('now', '-24 hours')
          `).get(organizationId, organizationId) as any;
          ledgerCount = row?.count || 0;
          if (ledgerCount === 0) {
            const anyRow = db.prepare(`
              SELECT COUNT(*) as count FROM outbound_action_ledger
              WHERE status IN ('SENT', 'DELIVERED')
                AND created_at >= datetime('now', '-24 hours')
            `).get() as any;
            if ((anyRow?.count || 0) > 0) ledgerCount = anyRow.count;
          }
        } else {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM outbound_action_ledger
            WHERE status IN ('SENT', 'DELIVERED')
              AND created_at >= datetime('now', '-24 hours')
          `).get() as any;
          ledgerCount = row?.count || 0;
        }
      } catch {}

      // 2. direct_outreach_log
      let outreachCount = 0;
      try {
        if (organizationId) {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM direct_outreach_log
            WHERE (
              business_id = ?
              OR business_id IN (SELECT id FROM businesses WHERE organization_id = ?)
            )
            AND dispatched = 1
            AND (
              (dispatch_timestamp IS NOT NULL AND dispatch_timestamp >= datetime('now', '-24 hours'))
              OR (created_at >= datetime('now', '-24 hours'))
            )
          `).get(organizationId, organizationId) as any;
          outreachCount = row?.count || 0;
          if (outreachCount === 0) {
            const anyRow = db.prepare(`
              SELECT COUNT(*) as count FROM direct_outreach_log
              WHERE dispatched = 1
                AND (
                  (dispatch_timestamp IS NOT NULL AND dispatch_timestamp >= datetime('now', '-24 hours'))
                  OR (created_at >= datetime('now', '-24 hours'))
                )
            `).get() as any;
            if ((anyRow?.count || 0) > 0) outreachCount = anyRow.count;
          }
        } else {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM direct_outreach_log
            WHERE dispatched = 1
              AND (
                (dispatch_timestamp IS NOT NULL AND dispatch_timestamp >= datetime('now', '-24 hours'))
                OR (created_at >= datetime('now', '-24 hours'))
              )
          `).get() as any;
          outreachCount = row?.count || 0;
        }
      } catch {}

      // 3. autonomous_action_traces
      let tracesCount = 0;
      try {
        if (organizationId) {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM autonomous_action_traces
            WHERE (tenant_id = ? OR tenant_id = 'default' OR tenant_id = 'org_owner_primary')
              AND classification = 'LIVE_EXTERNAL_ACTION'
              AND (action_type LIKE '%OUTBOUND%' OR action_type LIKE '%SEND%' OR action_type = 'OUTREACH_SEND')
              AND timestamp >= datetime('now', '-24 hours')
          `).get(organizationId) as any;
          tracesCount = row?.count || 0;
          if (tracesCount === 0) {
            const anyRow = db.prepare(`
              SELECT COUNT(*) as count FROM autonomous_action_traces
              WHERE classification = 'LIVE_EXTERNAL_ACTION'
                AND (action_type LIKE '%OUTBOUND%' OR action_type LIKE '%SEND%' OR action_type = 'OUTREACH_SEND')
                AND timestamp >= datetime('now', '-24 hours')
            `).get() as any;
            if ((anyRow?.count || 0) > 0) tracesCount = anyRow.count;
          }
        } else {
          const row = db.prepare(`
            SELECT COUNT(*) as count FROM autonomous_action_traces
            WHERE classification = 'LIVE_EXTERNAL_ACTION'
              AND (action_type LIKE '%OUTBOUND%' OR action_type LIKE '%SEND%' OR action_type = 'OUTREACH_SEND')
              AND timestamp >= datetime('now', '-24 hours')
          `).get() as any;
          tracesCount = row?.count || 0;
        }
      } catch {}

      return Math.max(ledgerCount, outreachCount, tracesCount);
    } catch {
      return 0;
    }
  }

  private getTodayExternalActionsCount(organizationId: string): number {
    const db = getDb();
    try {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM autonomous_action_traces
        WHERE tenant_id = ? AND classification = 'LIVE_EXTERNAL_ACTION'
          AND timestamp >= date('now')
      `).get(organizationId) as any;
      return row?.count || 0;
    } catch {
      return 0;
    }
  }
}
