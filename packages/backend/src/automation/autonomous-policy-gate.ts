import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';

export type AutonomousActionType =
  | 'PUBLISH_VERIFIED_DEAL'
  | 'TRIGGER_PAGESPEED_AUDIT'
  | 'SUBMIT_SEARCH_INDEXING'
  | 'REFRESH_SITEMAP_CONTENT'
  | 'UPDATE_EXPLORATION_BANDIT'
  | 'OUTBOUND_COLD_MESSAGING'
  | 'FINANCIAL_SPEND_DEBIT'
  | 'MODIFY_STATUTORY_DISCLOSURE'
  | 'EXECUTE_BINDING_CONTRACT';

export interface PolicyEvaluationRequest {
  actionType: AutonomousActionType;
  entityId?: string;
  entityType?: string;
  evidenceReferences?: string[];
  quotaReservationId?: string;
  isOwnerExplicit?: boolean;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  requiresHumanApproval: boolean;
  humanApproved: 0 | 1; // Strict invariant: AutonomousPolicyGate NEVER sets this to 1
  approvalSource: 'AUTONOMOUS_POLICY_GATE' | 'OWNER_EXPLICIT_APPROVAL' | 'REJECTED';
  policyId: string;
  policyVersion: string;
  policyEvaluationId: string;
  decisionTimestamp: string;
  evidenceReferences: string[];
  quotaReservationId?: string;
  reason: string;
}

/**
 * AutonomousPolicyGate (Spec V5.4 Phase 2)
 *
 * Implements strict segregation of autonomous execution vs human approval:
 * 1. ZERO FALSE APPROVALS: AutonomousPolicyGate NEVER fabricates human_approved = 1.
 *    Any action permitted autonomously records approval_source = 'AUTONOMOUS_POLICY_GATE'
 *    with human_approved = 0.
 * 2. Whitelist of Auto-Approved Safe Operations:
 *    - Publishing verified, in-stock, affiliated deals from canonical sectors (Sectors A-G)
 *    - Triggering PageSpeed / technical audits for consented / public business URLs
 *    - Indexing submission for live canonical site routes
 *    - Content refresh / sitemap regeneration
 *    - Exploration bandit model updates
 * 3. Strictly Human-Gated Operations (Requires owner click at /owner/today):
 *    - Outbound B2B cold messaging / emails / WhatsApp dispatches to unconsented contacts
 *    - Any financial spend or debit > ₹0.00
 *    - Modifying statutory / legal disclosures / terms
 *    - Contractual terms binding the company
 */
export class AutonomousPolicyGate {
  private static instance: AutonomousPolicyGate;
  public static readonly POLICY_VERSION = 'v5.4.0';

  public static getInstance(): AutonomousPolicyGate {
    if (!AutonomousPolicyGate.instance) {
      AutonomousPolicyGate.instance = new AutonomousPolicyGate();
    }
    return AutonomousPolicyGate.instance;
  }

  public evaluateAction(request: PolicyEvaluationRequest): PolicyEvaluationResult {
    const policyEvaluationId = `eval_${randomUUID().substring(0, 12)}`;
    const decisionTimestamp = new Date().toISOString();
    const policyId = `pol_${request.actionType.toLowerCase()}_${AutonomousPolicyGate.POLICY_VERSION}`;

    // If owner explicitly approved via owner authenticated session
    if (request.isOwnerExplicit === true) {
      return {
        allowed: true,
        requiresHumanApproval: false,
        humanApproved: 1,
        approvalSource: 'OWNER_EXPLICIT_APPROVAL',
        policyId,
        policyVersion: AutonomousPolicyGate.POLICY_VERSION,
        policyEvaluationId,
        decisionTimestamp,
        evidenceReferences: request.evidenceReferences || [],
        quotaReservationId: request.quotaReservationId,
        reason: 'Authorized via explicit owner authenticated action.'
      };
    }

    switch (request.actionType) {
      // 1. Auto-approved safe commercial & operational tasks
      case 'PUBLISH_VERIFIED_DEAL':
      case 'TRIGGER_PAGESPEED_AUDIT':
      case 'SUBMIT_SEARCH_INDEXING':
      case 'REFRESH_SITEMAP_CONTENT':
      case 'UPDATE_EXPLORATION_BANDIT':
        return {
          allowed: true,
          requiresHumanApproval: false,
          humanApproved: 0, // Invariant: Autonomous gate NEVER sets human_approved = 1
          approvalSource: 'AUTONOMOUS_POLICY_GATE',
          policyId,
          policyVersion: AutonomousPolicyGate.POLICY_VERSION,
          policyEvaluationId,
          decisionTimestamp,
          evidenceReferences: request.evidenceReferences || [],
          quotaReservationId: request.quotaReservationId,
          reason: `Auto-approved by policy ${policyId}: Whitelisted low-risk autonomous operation.`
        };

      // 2. Strictly human-gated high-risk operations (Owner review mandatory)
      case 'OUTBOUND_COLD_MESSAGING':
        return {
          allowed: false,
          requiresHumanApproval: true,
          humanApproved: 0,
          approvalSource: 'REJECTED',
          policyId,
          policyVersion: AutonomousPolicyGate.POLICY_VERSION,
          policyEvaluationId,
          decisionTimestamp,
          evidenceReferences: request.evidenceReferences || [],
          quotaReservationId: request.quotaReservationId,
          reason: 'STRICT_HUMAN_GATE: Outbound cold outreach requires human_approved = 1 signed off by business owner.'
        };

      case 'FINANCIAL_SPEND_DEBIT':
        return {
          allowed: false,
          requiresHumanApproval: true,
          humanApproved: 0,
          approvalSource: 'REJECTED',
          policyId,
          policyVersion: AutonomousPolicyGate.POLICY_VERSION,
          policyEvaluationId,
          decisionTimestamp,
          evidenceReferences: request.evidenceReferences || [],
          quotaReservationId: request.quotaReservationId,
          reason: 'ZERO_PAID_SPEND_POLICY: Autonomous engine operates with ₹0.00 advertising / API expense. All disbursements require owner approval.'
        };

      case 'MODIFY_STATUTORY_DISCLOSURE':
      case 'EXECUTE_BINDING_CONTRACT':
        return {
          allowed: false,
          requiresHumanApproval: true,
          humanApproved: 0,
          approvalSource: 'REJECTED',
          policyId,
          policyVersion: AutonomousPolicyGate.POLICY_VERSION,
          policyEvaluationId,
          decisionTimestamp,
          evidenceReferences: request.evidenceReferences || [],
          quotaReservationId: request.quotaReservationId,
          reason: 'LEGAL_RESTRAINT: Legal disclosures and binding contracts cannot be modified autonomously.'
        };

      default:
        return {
          allowed: false,
          requiresHumanApproval: true,
          humanApproved: 0,
          approvalSource: 'REJECTED',
          policyId,
          policyVersion: AutonomousPolicyGate.POLICY_VERSION,
          policyEvaluationId,
          decisionTimestamp,
          evidenceReferences: request.evidenceReferences || [],
          quotaReservationId: request.quotaReservationId,
          reason: 'FAIL_CLOSED: Unrecognized action type rejected by autonomous policy gate.'
        };
    }
  }

  /**
   * Helper to verify if an action record is legally authorized to execute:
   * (human_approved === 1 OR approval_source === 'AUTONOMOUS_POLICY_GATE')
   */
  public isActionAuthorized(record: {
    human_approved?: number | boolean;
    approval_source?: string;
  }): boolean {
    const isHumanApproved = record.human_approved === 1 || record.human_approved === true;
    const isPolicyApproved = record.approval_source === 'AUTONOMOUS_POLICY_GATE';
    return isHumanApproved || isPolicyApproved;
  }
}
