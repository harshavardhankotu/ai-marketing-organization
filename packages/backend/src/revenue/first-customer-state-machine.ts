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
 * Persistence: Cloudflare D1 authoritative in production, SQLite in dev/test. Zero getDb() import.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';
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
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): FirstCustomerStateMachine {
    if (!FirstCustomerStateMachine.instance) {
      FirstCustomerStateMachine.instance = new FirstCustomerStateMachine();
    }
    return FirstCustomerStateMachine.instance;
  }

  /**
   * Evaluates the current milestone asynchronously (production-safe Cloudflare D1 execution).
   */
  public async evaluateStateAsync(
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID,
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID
  ): Promise<StateMachineEvaluation> {
    // 1. Check customers
    const custRow = await this.d1Repo.queryOne('customer_journeys', `SELECT COUNT(*) as count FROM customer_journeys WHERE organization_id = ? AND stage IN ('CUSTOMER', 'CONVERTED')`, [organizationId]);
    const customerCount = Number(custRow?.count || 0);

    const prospectCountRow = await this.d1Repo.queryOne('platform_prospects', `SELECT COUNT(*) as count FROM platform_prospects WHERE is_opted_out = 0`);
    const prospectCount = Number(prospectCountRow?.count || 0);

    let outreachSentCount = 0;
    try {
      const outreachRow = await this.d1Repo.queryOne('sales_pipeline', `SELECT COUNT(*) as count FROM sales_pipeline WHERE organization_id = ? AND stage IN ('CONTACTED', 'REPLIED', 'QUALIFIED')`, [organizationId]);
      outreachSentCount += Number(outreachRow?.count || 0);
    } catch {}
    try {
      const ledgerRow = await this.d1Repo.queryOne('outbound_action_ledger', `SELECT COUNT(*) as count FROM outbound_action_ledger WHERE tenant_id = ?`, [organizationId]);
      outreachSentCount += Number(ledgerRow?.count || 0);
    } catch {}
    try {
      const evRow = await this.d1Repo.queryOne('commercial_evidence', `SELECT COUNT(*) as count FROM commercial_evidence WHERE tenant_id = ? AND milestone = 'M1_FIRST_LIVE_OUTBOUND'`, [organizationId]);
      outreachSentCount += Number(evRow?.count || 0);
    } catch {}
    const outreachSent = outreachSentCount > 0;

    let responseReceivedCount = 0;
    try {
      const responseRow = await this.d1Repo.queryOne('sales_pipeline', `SELECT COUNT(*) as count FROM sales_pipeline WHERE organization_id = ? AND stage IN ('REPLIED', 'QUALIFIED')`, [organizationId]);
      responseReceivedCount += Number(responseRow?.count || 0);
    } catch {}
    try {
      const eventRow = await this.d1Repo.queryOne('durable_events', `SELECT COUNT(*) as count FROM durable_events WHERE organization_id = ? AND event_type IN ('LEAD_REPLIED', 'QUALIFICATION_COMPLETED', 'PROPOSAL_ACCEPTED')`, [organizationId]);
      responseReceivedCount += Number(eventRow?.count || 0);
    } catch {}
    const responseReceived = responseReceivedCount > 0;

    const revForCustomer = await this.d1Repo.queryOne('revenue_records', `
      SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records
      WHERE organization_id = ? AND verified = 1 AND revenue_type = 'PLATFORM_REVENUE'
    `, [organizationId]);
    const verifiedRevenueForCustomer = Number(revForCustomer?.total || 0);

    const wfRow = await this.d1Repo.queryOne('workflows', `SELECT COUNT(*) as count FROM workflows WHERE organization_id = ? AND status = 'COMPLETED'`, [organizationId]);
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
    const revRow = await this.d1Repo.queryOne('revenue_records', `
      SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records
      WHERE organization_id = ? AND verified = 1 AND revenue_type = 'PLATFORM_REVENUE'
    `, [organizationId]);
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
    const paidReq = await this.d1Repo.queryOne('payment_requests', `
      SELECT * FROM payment_requests
      WHERE organization_id = ? AND status = 'PAID'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (paidReq) {
      return {
        currentStage: 'PAYMENT_VERIFIED',
        nextStage: 'REVENUE_RECORDED',
        executable: true,
        evidence: { prospectCount, outreachSent, responseReceived, verifiedRevenueINR: 0, customerCount: 0 }
      };
    }

    // 4. Check active payment links
    const activeReq = await this.d1Repo.queryOne('payment_requests', `
      SELECT * FROM payment_requests
      WHERE organization_id = ? AND (status = 'SENT' OR payment_link IS NOT NULL OR short_url IS NOT NULL)
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

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
          outreachSent,
          responseReceived,
          paymentLinkUrl: linkUrl,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 5. Check proposals
    const propAccepted = await this.d1Repo.queryOne('proposals', `
      SELECT * FROM proposals
      WHERE organization_id = ? AND status = 'ACCEPTED'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (propAccepted) {
      return {
        currentStage: 'ACCEPTED',
        nextStage: 'PAYMENT_REQUESTED',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: propAccepted.prospect_id,
          outreachSent,
          responseReceived,
          proposalId: propAccepted.id,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    const propSent = await this.d1Repo.queryOne('proposals', `
      SELECT * FROM proposals
      WHERE organization_id = ? AND status = 'SENT'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (propSent) {
      return {
        currentStage: 'PROPOSAL_SENT',
        nextStage: 'ACCEPTED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PROPOSAL_ACCEPTANCE: Commercial proposal dispatched; awaiting client confirmation.',
        evidence: {
          prospectCount,
          activeProspectId: propSent.prospect_id,
          outreachSent,
          responseReceived,
          proposalId: propSent.id,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 6. Check sales pipeline for QUALIFIED or REPLIED
    const qualPipe = await this.d1Repo.queryOne('sales_pipeline', `
      SELECT * FROM sales_pipeline
      WHERE organization_id = ? AND stage IN ('QUALIFIED', 'REPLIED')
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (qualPipe) {
      const stage = qualPipe.stage === 'QUALIFIED' ? 'QUALIFIED' : 'RESPONSE_RECEIVED';
      return {
        currentStage: stage,
        nextStage: stage === 'RESPONSE_RECEIVED' ? 'QUALIFIED' : 'PROPOSAL_SENT',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: qualPipe.outbound_contact_id,
          outreachSent,
          responseReceived,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 7. Check CONTACTED prospects
    const contactedPipe = await this.d1Repo.queryOne('sales_pipeline', `
      SELECT * FROM sales_pipeline
      WHERE organization_id = ? AND stage = 'CONTACTED'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (contactedPipe) {
      return {
        currentStage: 'CONTACTED',
        nextStage: 'RESPONSE_RECEIVED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PROSPECT_RESPONSE: Live outbound pitch delivered; waiting for prospect inbound webhook response.',
        evidence: {
          prospectCount,
          activeProspectId: contactedPipe.outbound_contact_id,
          outreachSent,
          responseReceived,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 8. Check prospects in platform_prospects
    const prospects = await this.d1Repo.queryOne('platform_prospects', `
      SELECT * FROM platform_prospects
      WHERE is_opted_out = 0
      ORDER BY created_at DESC LIMIT 1
    `);

    if (prospects) {
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
   * Evaluates the current milestone in the 16-stage first customer pipeline.
   * Synchronous for dev/test runners; fails closed in production.
   */
  public evaluateState(
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID,
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID
  ): StateMachineEvaluation {
    if (isProduction()) {
      throw new Error('PRODUCTION D1 ERROR: Synchronous evaluateState is not permitted in production. Use evaluateStateAsync.');
    }

    // 1. Check customers
    const custRow = this.d1Repo.queryOneSync('customer_journeys', `SELECT COUNT(*) as count FROM customer_journeys WHERE organization_id = ? AND stage IN ('CUSTOMER', 'CONVERTED')`, [organizationId]);
    const customerCount = Number(custRow?.count || 0);

    const prospectCountRow = this.d1Repo.queryOneSync('platform_prospects', `SELECT COUNT(*) as count FROM platform_prospects WHERE is_opted_out = 0`);
    const prospectCount = Number(prospectCountRow?.count || 0);

    let outreachSentCount = 0;
    try {
      const outreachRow = this.d1Repo.queryOneSync('sales_pipeline', `SELECT COUNT(*) as count FROM sales_pipeline WHERE organization_id = ? AND stage IN ('CONTACTED', 'REPLIED', 'QUALIFIED')`, [organizationId]);
      outreachSentCount += Number(outreachRow?.count || 0);
    } catch {}
    try {
      const ledgerRow = this.d1Repo.queryOneSync('outbound_action_ledger', `SELECT COUNT(*) as count FROM outbound_action_ledger WHERE tenant_id = ?`, [organizationId]);
      outreachSentCount += Number(ledgerRow?.count || 0);
    } catch {}
    try {
      const evRow = this.d1Repo.queryOneSync('commercial_evidence', `SELECT COUNT(*) as count FROM commercial_evidence WHERE tenant_id = ? AND milestone = 'M1_FIRST_LIVE_OUTBOUND'`, [organizationId]);
      outreachSentCount += Number(evRow?.count || 0);
    } catch {}
    const outreachSent = outreachSentCount > 0;

    let responseReceivedCount = 0;
    try {
      const responseRow = this.d1Repo.queryOneSync('sales_pipeline', `SELECT COUNT(*) as count FROM sales_pipeline WHERE organization_id = ? AND stage IN ('REPLIED', 'QUALIFIED')`, [organizationId]);
      responseReceivedCount += Number(responseRow?.count || 0);
    } catch {}
    try {
      const eventRow = this.d1Repo.queryOneSync('durable_events', `SELECT COUNT(*) as count FROM durable_events WHERE organization_id = ? AND event_type IN ('LEAD_REPLIED', 'QUALIFICATION_COMPLETED', 'PROPOSAL_ACCEPTED')`, [organizationId]);
      responseReceivedCount += Number(eventRow?.count || 0);
    } catch {}
    const responseReceived = responseReceivedCount > 0;

    const revForCustomer = this.d1Repo.queryOneSync('revenue_records', `
      SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records
      WHERE organization_id = ? AND verified = 1 AND revenue_type = 'PLATFORM_REVENUE'
    `, [organizationId]);
    const verifiedRevenueForCustomer = Number(revForCustomer?.total || 0);

    const wfRow = this.d1Repo.queryOneSync('workflows', `SELECT COUNT(*) as count FROM workflows WHERE organization_id = ? AND status = 'COMPLETED'`, [organizationId]);
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
    const revRow = this.d1Repo.queryOneSync('revenue_records', `
      SELECT COALESCE(SUM(amount_inr), 0) as total FROM revenue_records
      WHERE organization_id = ? AND verified = 1 AND revenue_type = 'PLATFORM_REVENUE'
    `, [organizationId]);
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
    const paidReq = this.d1Repo.queryOneSync('payment_requests', `
      SELECT * FROM payment_requests
      WHERE organization_id = ? AND status = 'PAID'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (paidReq) {
      return {
        currentStage: 'PAYMENT_VERIFIED',
        nextStage: 'REVENUE_RECORDED',
        executable: true,
        evidence: { prospectCount, outreachSent, responseReceived, verifiedRevenueINR: 0, customerCount: 0 }
      };
    }

    // 4. Check active payment links
    const activeReq = this.d1Repo.queryOneSync('payment_requests', `
      SELECT * FROM payment_requests
      WHERE organization_id = ? AND (status = 'SENT' OR payment_link IS NOT NULL OR short_url IS NOT NULL)
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

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
          outreachSent,
          responseReceived,
          paymentLinkUrl: linkUrl,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 5. Check proposals
    const propAccepted = this.d1Repo.queryOneSync('proposals', `
      SELECT * FROM proposals
      WHERE organization_id = ? AND status = 'ACCEPTED'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (propAccepted) {
      return {
        currentStage: 'ACCEPTED',
        nextStage: 'PAYMENT_REQUESTED',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: propAccepted.prospect_id,
          outreachSent,
          responseReceived,
          proposalId: propAccepted.id,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    const propSent = this.d1Repo.queryOneSync('proposals', `
      SELECT * FROM proposals
      WHERE organization_id = ? AND status = 'SENT'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (propSent) {
      return {
        currentStage: 'PROPOSAL_SENT',
        nextStage: 'ACCEPTED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PROPOSAL_ACCEPTANCE: Commercial proposal dispatched; awaiting client confirmation.',
        evidence: {
          prospectCount,
          activeProspectId: propSent.prospect_id,
          outreachSent,
          responseReceived,
          proposalId: propSent.id,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 6. Check sales pipeline for QUALIFIED or REPLIED
    const qualPipe = this.d1Repo.queryOneSync('sales_pipeline', `
      SELECT * FROM sales_pipeline
      WHERE organization_id = ? AND stage IN ('QUALIFIED', 'REPLIED')
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (qualPipe) {
      const stage = qualPipe.stage === 'QUALIFIED' ? 'QUALIFIED' : 'RESPONSE_RECEIVED';
      return {
        currentStage: stage,
        nextStage: stage === 'RESPONSE_RECEIVED' ? 'QUALIFIED' : 'PROPOSAL_SENT',
        executable: true,
        evidence: {
          prospectCount,
          activeProspectId: qualPipe.outbound_contact_id,
          outreachSent,
          responseReceived,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 7. Check CONTACTED prospects
    const contactedPipe = this.d1Repo.queryOneSync('sales_pipeline', `
      SELECT * FROM sales_pipeline
      WHERE organization_id = ? AND stage = 'CONTACTED'
      ORDER BY updated_at DESC LIMIT 1
    `, [organizationId]);

    if (contactedPipe) {
      return {
        currentStage: 'CONTACTED',
        nextStage: 'RESPONSE_RECEIVED',
        executable: false,
        blockageReason: 'BLOCKED_AWAITING_PROSPECT_RESPONSE: Live outbound pitch delivered; waiting for prospect inbound webhook response.',
        evidence: {
          prospectCount,
          activeProspectId: contactedPipe.outbound_contact_id,
          outreachSent,
          responseReceived,
          verifiedRevenueINR: 0,
          customerCount: 0
        }
      };
    }

    // 8. Check prospects in platform_prospects
    const prospects = this.d1Repo.queryOneSync('platform_prospects', `
      SELECT * FROM platform_prospects
      WHERE is_opted_out = 0
      ORDER BY created_at DESC LIMIT 1
    `);

    if (prospects) {
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
    const evalState = isProduction()
      ? await this.evaluateStateAsync(businessId, organizationId)
      : this.evaluateState(businessId, organizationId);

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
