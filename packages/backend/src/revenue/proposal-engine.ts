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
        input.offerId || null,
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

  public acceptProposal(proposalId: string): { proposal: CommercialProposal; paymentLink: string } {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE proposals
      SET status = 'ACCEPTED', updated_at = ?
      WHERE id = ?
    `).run(now, proposalId);

    const proposal = this.getProposal(proposalId)!;
    const paymentLink = `https://rzp.io/l/lead-conversion-setup-${proposal.id}`;

    // Create payment_request entry
    const payReqId = `payrq_${Date.now()}`;
    try {
      db.prepare(`
        INSERT INTO payment_requests (
          id, business_id, organization_id, lead_id, offer_description,
          amount_inr, payment_link_url, status, classification, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SENT', 'REAL', datetime('now'))
      `).run(
        payReqId,
        proposal.businessId,
        proposal.organizationId,
        proposal.prospectId,
        `Setup fee: ${proposal.title}`,
        proposal.setupPriceINR,
        paymentLink
      );
    } catch {}

    return {
      proposal,
      paymentLink
    };
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
