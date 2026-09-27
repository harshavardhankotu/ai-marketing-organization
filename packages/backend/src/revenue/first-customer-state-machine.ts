/**
 * FirstCustomerStateMachine — Authoritative progression engine for acquiring the platform's
 * first real paying customer from an empty system state.
 *
 * Implements:
 * NO_PROSPECTS
 * → DISCOVER_PROSPECTS
 * → platform_prospect_created
 * → evidence_verified
 * → OUTREACH_READY
 * → CONTACTED
 * → RESPONSE_RECEIVED
 * → QUALIFIED
 * → PROPOSAL_SENT
 * → ACCEPTED
 * → PAYMENT_REQUESTED
 * → PAYMENT_CAPTURED
 * → PAYMENT_VERIFIED
 * → REVENUE_RECORDED
 * → CUSTOMER
 * → ONBOARDED
 *
 * If any transition cannot happen automatically, reports explicit BLOCKED_[REASON].
 */

import { getDb } from '../db/client.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { PlatformCommercialEngine } from './platform-commercial-engine.js';
import { PlatformProspectDiscoveryEngine } from './platform-prospect-discovery-engine.js';
import { ProposalEngine } from './proposal-engine.js';
import { AutonomyPolicyController } from './autonomy-policy.js';

export type FirstCustomerStage =
  | 'NO_PROSPECTS'
  | 'DISCOVER_PROSPECTS'
  | 'PLATFORM_PROSPECT_CREATED'
  | 'EVIDENCE_VERIFIED'
  | 'OUTREACH_READY'
  | 'CONTACTED'
  | 'RESPONSE_RECEIVED'
  | 'QUALIFIED'
  | 'PROPOSAL_SENT'
  | 'ACCEPTED'
  | 'PAYMENT_REQUESTED'
  | 'PAYMENT_CAPTURED'
  | 'PAYMENT_VERIFIED'
  | 'REVENUE_RECORDED'
  | 'CUSTOMER'
  | 'ONBOARDED';

export interface StateMachineEvaluation {
  currentStage: FirstCustomerStage;
  nextStage?: FirstCustomerStage;
  executable: boolean;
  blockageReason?: string;
  evidence: {
    prospectCount: number;
    activeProspectId?: string;
    outreachSent: boolean;
    responseReceived: boolean;
    proposalId?: string;
    paymentLinkUrl?: string;
    verifiedRevenueINR: number;
    customerCount: number;
  };
}

export class FirstCustomerStateMachine {
  private static instance: FirstCustomerStateMachine;

  public static getInstance(): FirstCustomerStateMachine {
    if (!FirstCustomerStateMachine.instance) {
      FirstCustomerStateMachine.instance = new FirstCustomerStateMachine();
    }
    return FirstCustomerStateMachine.instance;
  }

  /**
   * Evaluates the current milestone in the 16-stage first customer pipeline.
   */
  public evaluateState(
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID,
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID
  ): StateMachineEvaluation {
    const db = getDb();

    // 1. Check customers
    const custRow = db.prepare(`SELECT COUNT(*) as count FROM customer_journeys WHERE organization_id = ? AND stage IN ('CUSTOMER', 'CONVERTED')`).get(organizationId) as any;
    const customerCount = Number(custRow?.count || 0);

    // Compute actual prospect count from DB (never hardcode)
    const prospectCountRow = db.prepare(`SELECT COUNT(*) as count FROM platform_prospects WHERE is_opted_out = 0`).get() as any;
    const prospectCount = Number(prospectCountRow?.count || 0);

    // Compute actual outreach sent from DB (any CONTACTED pipeline row)
    const outreachRow = db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE organization_id = ? AND stage IN ('CONTACTED', 'REPLIED', 'QUALIFIED')`).get(organizationId) as any;
    const outreachSent = Number(outreachRow?.count || 0) > 0;

    // Compute actual response received from DB
    const responseRow = db.prepare(`SELECT COUNT(*) as count FROM sales_pipeline WHERE organization_id = ? AND stage IN ('REPLIED', 'QUALIFIED')`).get(organizationId) as any;
    const responseReceived = Number(responseRow?.count || 0) > 0;

    // Compute actual verified revenue from DB
    const revForCustomer = db.prepare(`
      SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records
      WHERE organization_id = ? AND verified = 1 AND revenue_type = 'PLATFORM_REVENUE'
    `).get(organizationId) as any;
    const verifiedRevenueForCustomer = Number(revForCustomer?.total || 0);

    // Check onboarded workflow
    const wfRow = db.prepare(`SELECT COUNT(*) as count FROM workflows WHERE organization_id = ? AND status = 'COMPLETED'`).get(organizationId) as any;
    if (customerCount > 0 && Number(wfRow?.count || 0) > 0) {
      return {
        currentStage: 'ONBOARDED',
        executable: false,
        evidence: { prospectCount, outreachSent, responseReceived, verifiedRevenueINR: verifiedRevenueForCustomer, customerCount }
      };
    }

    if (customerCount > 0) {
      return {
        currentStage: 'CUSTOMER',
        nextStage: 'ONBOARDED',
        executable: true,
        evidence: { prospectCount, outreachSent, responseReceived, verifiedRevenueINR: verifiedRevenueForCustomer, customerCount }
      };
    }

    // 2. Check verified revenue records
    const revRow = db.prepare(`
      SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records
      WHERE organization_id = ? AND verified = 1 AND revenue_type = 'PLATFORM_REVENUE'
    `).get(organizationId) as any;
    const verifiedRevenueINR = Number(revRow?.total || 0);

    if (verifiedRevenueINR > 0) {
      return {
        currentStage: 'REVENUE_RECORDED',
        nextStage: 'CUSTOMER',
        executable: true,
        evidence: { prospectCount, outreachSent, responseReceived, verifiedRevenueINR, customerCount: 0 }
      };
    }

    // 3. Check payment orders / payment requests
    const paidReq = db.prepare(`
      SELECT * FROM payment_requests
      WHERE organization_id = ? AND status = 'PAID'
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId) as any;

    if (paidReq) {
      return {
        currentStage: 'PAYMENT_VERIFIED',
        nextStage: 'REVENUE_RECORDED',
        executable: true,
        evidence: { prospectCount, outreachSent, responseReceived, verifiedRevenueINR: 0, customerCount: 0 }
      };
    }

    // 4. Check active payment links
    const activeReq = db.prepare(`
      SELECT * FROM payment_requests
      WHERE organization_id = ? AND (status = 'SENT' OR payment_link IS NOT NULL OR short_url IS NOT NULL)
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId) as any;

    const linkUrl = activeReq?.short_url || activeReq?.payment_link;
    if (activeReq && (activeReq.status === 'SENT' || linkUrl)) {
      return {
        currentStage: 'PAYMENT_REQUESTED',
        nextStage: 'PAYMENT_CAPTURED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PAYMENT_CAPTURE: Razorpay payment link dispatched to prospect; awaiting external payment completion.',
        evidence: {
          prospectCount,
          activeProspectId: activeReq.prospect_id,
          outreachSent: true,  // payment link implies outreach was sent
          responseReceived: true,  // payment link implies response was received
          paymentLinkUrl: linkUrl,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 5. Check proposals
    const propAccepted = db.prepare(`
      SELECT * FROM proposals
      WHERE organization_id = ? AND status = 'ACCEPTED'
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId) as any;

    if (propAccepted) {
      return {
        currentStage: 'ACCEPTED',
        nextStage: 'PAYMENT_REQUESTED',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: propAccepted.prospect_id,
          outreachSent: true,  // proposal accepted implies outreach was sent
          responseReceived: true,  // proposal accepted implies response was received
          proposalId: propAccepted.id,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    const propSent = db.prepare(`
      SELECT * FROM proposals
      WHERE organization_id = ? AND status = 'SENT'
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId) as any;

    if (propSent) {
      return {
        currentStage: 'PROPOSAL_SENT',
        nextStage: 'ACCEPTED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PROPOSAL_ACCEPTANCE: Commercial proposal dispatched; awaiting client confirmation.',
        evidence: {
          prospectCount,
          activeProspectId: propSent.prospect_id,
          outreachSent: true,  // proposal sent implies outreach was done
          responseReceived: true,  // proposal sent implies response was received
          proposalId: propSent.id,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 6. Check sales pipeline for QUALIFIED or REPLIED
    const qualPipe = db.prepare(`
      SELECT * FROM sales_pipeline
      WHERE organization_id = ? AND stage IN ('QUALIFIED', 'REPLIED')
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId) as any;

    if (qualPipe) {
      const stage = qualPipe.stage === 'QUALIFIED' ? 'QUALIFIED' : 'RESPONSE_RECEIVED';
      return {
        currentStage: stage,
        nextStage: stage === 'RESPONSE_RECEIVED' ? 'QUALIFIED' : 'PROPOSAL_SENT',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: qualPipe.outbound_contact_id,
          outreachSent: true,  // QUALIFIED/REPLIED implies outreach and response
          responseReceived: true,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 7. Check CONTACTED prospects
    const contactedPipe = db.prepare(`
      SELECT * FROM sales_pipeline
      WHERE organization_id = ? AND stage = 'CONTACTED'
      ORDER BY updated_at DESC LIMIT 1
    `).get(organizationId) as any;

    if (contactedPipe) {
      return {
        currentStage: 'CONTACTED',
        nextStage: 'RESPONSE_RECEIVED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PROSPECT_RESPONSE: Live outbound pitch delivered; waiting for prospect inbound webhook response.',
        evidence: {
          prospectCount,
          activeProspectId: contactedPipe.outbound_contact_id,
          outreachSent: true,  // CONTACTED stage means outreach was sent
          responseReceived: false,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 8. Check prospects in platform_prospects
    const prospects = db.prepare(`
      SELECT * FROM platform_prospects
      WHERE is_opted_out = 0
      ORDER BY created_at DESC LIMIT 1
    `).get() as any;

    if (prospects) {
      // Check outbound eligibility (quiet hours)
      const dispatch = PlatformCommercialEngine.getInstance().evaluateOutboundDispatchEligibility();
      if (!dispatch.allowed) {
        return {
          currentStage: 'OUTREACH_READY',
          nextStage: 'CONTACTED',
          executable: false,
          blockageReason: `BLOCKED_QUIET_HOURS: ${dispatch.reason}`,
          evidence: {
            prospectCount,
            activeProspectId: prospects.id,
            outreachSent: false,
            responseReceived: false,
            verifiedRevenueINR: 0,
            customerCount: 0
          }
        };
      }

      // Check contact safety
      const contactSafety = AutonomyPolicyController.getInstance().getContactSafety(prospects.prospect_phone || prospects.prospect_email || '');
      if (contactSafety !== 'CONTACTABLE') {
        return {
          currentStage: 'EVIDENCE_VERIFIED',
          nextStage: 'OUTREACH_READY',
          executable: false,
          blockageReason: `BLOCKED_AUTHORIZATION: Contact is suppressed (${contactSafety})`,
          evidence: {
            prospectCount,
            activeProspectId: prospects.id,
            outreachSent: false,
            responseReceived: false,
            verifiedRevenueINR: 0,
            customerCount: 0
          }
        };
      }

      return {
        currentStage: 'OUTREACH_READY',
        nextStage: 'CONTACTED',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: prospects.id,
          outreachSent: false,
          responseReceived: false,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 9. No prospects exist
    return {
      currentStage: 'NO_PROSPECTS',
      nextStage: 'DISCOVER_PROSPECTS',
      executable: true,
      evidence: {
        prospectCount: 0,
        outreachSent: false,
        responseReceived: false,
        verifiedRevenueINR: 0,
        customerCount: 0
      }
    };
  }

  /**
   * Executes the next authorized action to progress the state machine.
   */
  public async advance(
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID,
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID
  ): Promise<{
    transition: string;
    success: boolean;
    newStage: FirstCustomerStage;
    blockageReason?: string;
    details?: any;
  }> {
    const evalState = this.evaluateState(businessId, organizationId);

    if (!evalState.executable && evalState.blockageReason) {
      return {
        transition: `${evalState.currentStage} -> ${evalState.nextStage || 'STALLED'}`,
        success: false,
        newStage: evalState.currentStage,
        blockageReason: evalState.blockageReason
      };
    }

    switch (evalState.currentStage) {
      case 'NO_PROSPECTS':
      case 'DISCOVER_PROSPECTS': {
        const discEngine = PlatformProspectDiscoveryEngine.getInstance();
        const discRes = await discEngine.discoverProspects(businessId, organizationId);

        if (discRes.status === 'BLOCKED_NO_FREE_RESEARCH_CAPABILITY') {
          return {
            transition: 'NO_PROSPECTS -> DISCOVER_PROSPECTS',
            success: false,
            newStage: 'NO_PROSPECTS',
            blockageReason: 'BLOCKED_NO_FREE_RESEARCH_CAPABILITY: Neither free Gemini nor search provider available.'
          };
        }

        if (discRes.count > 0) {
          return {
            transition: 'NO_PROSPECTS -> PLATFORM_PROSPECT_CREATED',
            success: true,
            newStage: 'PLATFORM_PROSPECT_CREATED',
            details: discRes.prospects
          };
        }

        return {
          transition: 'NO_PROSPECTS -> DISCOVER_PROSPECTS',
          success: false,
          newStage: 'NO_PROSPECTS',
          blockageReason: 'BLOCKED_NO_PROSPECTS_DISCOVERED: Discovery cycle executed but returned zero valid candidates.'
        };
      }

      case 'ACCEPTED': {
        if (!evalState.evidence.proposalId) {
          return {
            transition: 'ACCEPTED -> PAYMENT_REQUESTED',
            success: false,
            newStage: 'ACCEPTED',
            blockageReason: 'BLOCKED_AUTHORIZATION: No proposal ID found for accepted proposal.'
          };
        }

        const propEngine = ProposalEngine.getInstance();
        const payRes = await propEngine.executeProposalPaymentLinkCreation(evalState.evidence.proposalId);

        if (payRes.success) {
          return {
            transition: 'ACCEPTED -> PAYMENT_REQUESTED',
            success: true,
            newStage: 'PAYMENT_REQUESTED',
            details: payRes
          };
        }

        return {
          transition: 'ACCEPTED -> PAYMENT_REQUESTED',
          success: false,
          newStage: 'ACCEPTED',
          blockageReason: payRes.error || 'BLOCKED_PAYMENT_PROVIDER'
        };
      }

      default:
        return {
          transition: `${evalState.currentStage} -> ${evalState.nextStage || 'NEXT'}`,
          success: false,
          newStage: evalState.currentStage,
          blockageReason: `BLOCKED_AWAITING_EXTERNAL_EVENT: Stage ${evalState.currentStage} progresses via live external webhook or customer interaction.`
        };
    }
  }
}
