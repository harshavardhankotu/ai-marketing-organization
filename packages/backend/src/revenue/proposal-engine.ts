/**
 * ProposalEngine — Generates and manages immutable commercial proposals for qualified prospects.
 *
 * Implements Spec § 15 & § 16:
 * - Proposal Content:
 *     customer_problem, proposed_solution, deliverables, timeline_days, setup_price_inr,
 *     monthly_price_inr, payment_terms, scope_boundary, next_step, status
 * - Strict Invariant:
 *     AI is strictly prohibited from altering approved price or deliverables during sales conversations.
 *     Every proposal has an idempotency key: proposal:{prospect_id}.
 *     Acceptance automatically transitions to payment request creation.
 */

import { getDb } from '../db/client.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { OfferCatalogService } from './offer-catalog.js';

export interface CommercialProposal {
  id: string;
  organizationId: string;
  businessId: string;
  prospectId: string;
  offerId?: string;
  title: string;
  customerProblem: string;
  proposedSolution: string;
  deliverables: string[];
  timelineDays: number;
  setupPriceINR: number;
  monthlyPriceINR: number;
  paymentTerms: string;
  scopeBoundary: string;
  nextStep: string;
  status: 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED';
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProposalInput {
  organizationId: string;
  businessId: string;
  prospectId: string;
  offerId?: string;
  title: string;
  customerProblem: string;
  proposedSolution: string;
  deliverables: string[];
  timelineDays?: number;
  setupPriceINR?: number;
  monthlyPriceINR?: number;
  paymentTerms?: string;
  scopeBoundary?: string;
  nextStep?: string;
}

export class ProposalEngine {
  private static instance: ProposalEngine;

  public static getInstance(): ProposalEngine {
    if (!ProposalEngine.instance) {
      ProposalEngine.instance = new ProposalEngine();
    }
    return ProposalEngine.instance;
  }

  /**
   * Creates an approved commercial proposal with strict price immutability and idempotency.
   */
  public createProposal(input: CreateProposalInput): CommercialProposal {
    const db = getDb();
    const idempotencyKey = `proposal:${input.prospectId}`;

    // Check existing proposal for this prospect
    try {
      const existing = db.prepare(`SELECT * FROM proposals WHERE idempotency_key = ?`).get(idempotencyKey) as any;
      if (existing) {
        return this.mapRow(existing);
      }
    } catch {}

    const id = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const timelineDays = input.timelineDays || 5;
    const setupPriceINR = input.setupPriceINR !== undefined ? input.setupPriceINR : 15000;
    const monthlyPriceINR = input.monthlyPriceINR !== undefined ? input.monthlyPriceINR : 8000;
    const paymentTerms = input.paymentTerms || '50% upfront setup on approval, 50% on Day 5 delivery handover. Monthly subscription begins Day 30.';
    const scopeBoundary = input.scopeBoundary || 'Includes WhatsApp Business integration and GBP optimization. Does not include paid media advertising spend or third-party CRM software licenses.';
    const nextStep = input.nextStep || 'Authorize online via secure Razorpay payment link to initiate Day 0 onboarding.';

    try {
      db.prepare(`
        INSERT INTO proposals (
          id, organization_id, business_id, prospect_id, offer_id,
          title, customer_problem, proposed_solution, deliverables_json,
          timeline_days, setup_price_inr, monthly_price_inr, payment_terms,
          scope_boundary, next_step, status, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SENT', ?, ?, ?)
      `).run(
        id,
        input.organizationId,
        input.businessId,
        input.prospectId,
        input.offerId || OfferCatalogService.PLATFORM_SETUP_OFFER_ID,
        input.title,
        input.customerProblem,
        input.proposedSolution,
        JSON.stringify(input.deliverables),
        timelineDays,
        setupPriceINR,
        monthlyPriceINR,
        paymentTerms,
        scopeBoundary,
        nextStep,
        idempotencyKey,
        now,
        now
      );
    } catch {}

    return {
      id,
      organizationId: input.organizationId,
      businessId: input.businessId,
      prospectId: input.prospectId,
      offerId: input.offerId,
      title: input.title,
      customerProblem: input.customerProblem,
      proposedSolution: input.proposedSolution,
      deliverables: input.deliverables,
      timelineDays,
      setupPriceINR,
      monthlyPriceINR,
      paymentTerms,
      scopeBoundary,
      nextStep,
      status: 'SENT',
      idempotencyKey,
      createdAt: now,
      updatedAt: now
    };
  }

  public getProposal(proposalId: string): CommercialProposal | null {
    const db = getDb();
    try {
      const row = db.prepare(`SELECT * FROM proposals WHERE id = ?`).get(proposalId) as any;
      if (row) return this.mapRow(row);
    } catch {}
    return null;
  }

  /**
   * Marks proposal ACCEPTED and creates a payment_request record.
   * Does NOT create a fake payment URL.
   * Returns:
   *   - paymentLink: null (caller must use RazorpayAdapter.createPaymentLink to get a real link)
   *   - manualPaymentPage: the canonical Razorpay.me direct payment page (fallback only, not a transaction)
   * The proposal remains status=ACCEPTED/PENDING_PAYMENT until provider-verified payment occurs.
   */
  public acceptProposal(proposalId: string): { proposal: CommercialProposal; paymentLink: string | null; manualPaymentPage: string; status: 'PAYMENT_LINK_NOT_CREATED' } {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE proposals
      SET status = 'ACCEPTED', updated_at = ?
      WHERE id = ?
    `).run(now, proposalId);

    const proposal = this.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`PROPOSAL_NOT_FOUND: Proposal ${proposalId} not found after acceptance.`);
    }

    // Create payment_request in DRAFT state — no payment link yet
    const payReqId = `payrq_${Date.now()}`;
    const paymentRequestCreated = (() => {
      try {
        db.prepare(`
          INSERT INTO payment_requests (
            id, business_id, organization_id, prospect_id, offer_description,
            amount_inr, status, classification, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', 'REAL', datetime('now'), datetime('now'))
        `).run(
          payReqId,
          proposal.businessId,
          proposal.organizationId,
          proposal.prospectId,
          `Setup fee: ${proposal.title}`,
          proposal.setupPriceINR
        );
        return true;
      } catch (e: any) {
        console.error(`[ProposalEngine] Failed to create payment_request for proposal ${proposalId}: ${e.message}`);
        return false;
      }
    })();

    // Emit PROPOSAL_ACCEPTED event
    try {
      const { DurableEventBus } = require('./durable-event-bus.js');
      DurableEventBus.emit({
        eventType: 'PROPOSAL_ACCEPTED',
        organizationId: proposal.organizationId,
        businessId: proposal.businessId,
        payload: { proposalId: proposal.id, prospectId: proposal.prospectId }
      });
    } catch {}

    return {
      proposal,
      paymentLink: null, // Caller must call executeProposalPaymentLinkCreation() or RazorpayAdapter.createPaymentLink()
      manualPaymentPage: OwnerAuthService.PLATFORM_RAZORPAY_PAYMENT_PAGE_URL,
      status: 'PAYMENT_LINK_NOT_CREATED'
    };
  }

  /**
   * Authoritative transition from PROPOSAL_ACCEPTED to PAYMENT_REQUESTED:
   * 1. Resolves proposal & associated DRAFT payment request
   * 2. Calls RazorpayAdapter.createPaymentLink with authoritative price & offer
   * 3. Binds provider_link_id and short_url to payment_requests
   * 4. Updates proposal status to PAYMENT_REQUESTED
   * 5. If provider or credentials block creation, explicitly sets BLOCKED_PAYMENT_PROVIDER
   *    and never remains silently at PAYMENT_LINK_NOT_CREATED.
   */
  public async executeProposalPaymentLinkCreation(proposalId: string): Promise<{
    success: boolean;
    status: 'PAYMENT_REQUESTED' | 'BLOCKED_PAYMENT_PROVIDER' | 'RECONCILIATION_REQUIRED';
    paymentLinkUrl?: string;
    providerLinkId?: string;
    error?: string;
  }> {
    const db = getDb();
    const proposal = this.getProposal(proposalId);
    if (!proposal) {
      throw new Error(`PROPOSAL_NOT_FOUND: Proposal ${proposalId} does not exist.`);
    }

    const { RazorpayAdapter } = await import('../integrations/razorpay.js');
    const razorpay = new RazorpayAdapter();

    try {
      const linkRes = await razorpay.createPaymentLink({
        organizationId: proposal.organizationId,
        businessId: proposal.businessId,
        offerId: proposal.offerId || OfferCatalogService.PLATFORM_SETUP_OFFER_ID,
        proposalId: proposal.id,
        prospectId: proposal.prospectId,
        amountINR: proposal.setupPriceINR,
        customer: {
          name: proposal.title
        }
      });

      if (linkRes.reconciliationRequired) {
        db.prepare(`
          UPDATE proposals
          SET status = 'RECONCILIATION_REQUIRED', updated_at = datetime('now')
          WHERE id = ?
        `).run(proposalId);

        return {
          success: false,
          status: 'RECONCILIATION_REQUIRED',
          error: 'Payment link created at provider but canonical persistence failed.'
        };
      }

      // Bind provider link to draft payment_request
      db.prepare(`
        UPDATE payment_requests
        SET provider_link_id = ?, short_url = ?, payment_link = ?, status = 'SENT', updated_at = datetime('now')
        WHERE prospect_id = ?
      `).run(linkRes.providerLinkId, linkRes.shortUrl, linkRes.shortUrl, proposal.prospectId);

      // Update proposal status to PAYMENT_REQUESTED
      db.prepare(`
        UPDATE proposals
        SET status = 'PAYMENT_REQUESTED', updated_at = datetime('now')
        WHERE id = ?
      `).run(proposalId);

      // Update pipeline stage to PAYMENT_PENDING
      db.prepare(`
        UPDATE sales_pipeline
        SET stage = 'PAYMENT_PENDING', next_action = 'COLLECT_PAYMENT', updated_at = datetime('now')
        WHERE outbound_contact_id = ?
      `).run(proposal.prospectId);

      return {
        success: true,
        status: 'PAYMENT_REQUESTED',
        paymentLinkUrl: linkRes.shortUrl,
        providerLinkId: linkRes.providerLinkId
      };
    } catch (err: any) {
      db.prepare(`
        UPDATE proposals
        SET status = 'BLOCKED_PAYMENT_PROVIDER', updated_at = datetime('now')
        WHERE id = ?
      `).run(proposalId);

      return {
        success: false,
        status: 'BLOCKED_PAYMENT_PROVIDER',
        error: `BLOCKED_PAYMENT_PROVIDER: ${err.message}`
      };
    }
  }

  public formatProposalText(proposalId: string): string {
    const p = this.getProposal(proposalId);
    if (!p) return 'Proposal not found.';

    return (
      `========================================\n` +
      `COMMERCIAL PROPOSAL: ${p.title.toUpperCase()}\n` +
      `========================================\n\n` +
      `1. PROBLEM IDENTIFIED:\n${p.customerProblem}\n\n` +
      `2. PROPOSED SOLUTION:\n${p.proposedSolution}\n\n` +
      `3. DELIVERABLES:\n` +
      p.deliverables.map((d, i) => `  ${i + 1}. ${d}`).join('\n') +
      `\n\n4. IMPLEMENTATION TIMELINE:\n${p.timelineDays} business days from onboarding kickoff.\n\n` +
      `5. COMMERCIAL TERMS:\n` +
      `  • Setup & Deployment: ₹${p.setupPriceINR.toLocaleString('en-IN')}\n` +
      `  • Monthly Maintenance & Hosting: ₹${p.monthlyPriceINR.toLocaleString('en-IN')}/month\n` +
      `  • Terms: ${p.paymentTerms}\n\n` +
      `6. SCOPE BOUNDARIES:\n${p.scopeBoundary}\n\n` +
      `7. NEXT STEP:\n${p.nextStep}\n` +
      `========================================`
    );
  }

  private mapRow(r: any): CommercialProposal {
    return {
      id: r.id,
      organizationId: r.organization_id,
      businessId: r.business_id,
      prospectId: r.prospect_id,
      offerId: r.offer_id,
      title: r.title,
      customerProblem: r.customer_problem,
      proposedSolution: r.proposed_solution,
      deliverables: JSON.parse(r.deliverables_json || '[]'),
      timelineDays: r.timeline_days,
      setupPriceINR: r.setup_price_inr,
      monthlyPriceINR: r.monthly_price_inr,
      paymentTerms: r.payment_terms,
      scopeBoundary: r.scope_boundary,
      nextStep: r.next_step,
      status: r.status,
      idempotencyKey: r.idempotency_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
}
