/**
 * NextBestActionEngine — scores and selects the single highest-value
 * authorized action the system can take right now.
 *
 * Implements Spec §§ 11, 25, 27, 28:
 * Real-time inspection priority order:
 *   1. Payment received -> ONBOARD_CUSTOMER
 *   2. New customer -> REQUEST_REFERRAL / RETENTION
 *   3. Active lead / reply -> QUALIFY / BOOK_MEETING
 *   4. Payment pending -> COLLECT_PAYMENT
 *   5. Overdue follow-up -> FOLLOW_UP_LEAD
 *   6. Active sales opportunity -> PURSUE_OPPORTUNITY
 *   7. Research need -> RUN_RESEARCH
 *   8. Prospect discovery -> DISCOVER_PROSPECTS
 *
 * Cooldown-aware: candidates on cooldown are excluded.
 * Deterministic fallback: works even if AI/Gemini is unavailable or locked.
 */

import { getDb } from '../db/client.js';
import { OpportunityEngine, Opportunity } from './opportunity-engine.js';
import { ActionCooldownManager } from './action-cooldown-manager.js';

export type ActionType =
  | 'RECONCILE_COMMISSION'     // reconcile pending partner conversions to verified commissions
  | 'RECONCILE_CONVERSION'     // process incoming/pending conversion reports
  | 'CREATE_CONTENT_ASSET'     // generate public comparison/guide/recommendation page
  | 'CREATE_REFERRAL_LINK'     // generate tracked referral link for active offer
  | 'OPTIMIZE_FUNNEL'          // tune high-intent conversion paths
  | 'DISCOVER_PARTNER'         // discover new legitimate affiliate/referral programs
  | 'DISCOVER_OFFER'           // discover new commercial offers for verified partners
  | 'DISCOVER_DEMAND'          // autonomous research of high-intent search queries
  | 'QUARANTINE_BAD_PROVIDER'  // isolate broken or unverified partner/offer
  | 'PURSUE_OPPORTUNITY'       // advance a qualified opportunity
  | 'FOLLOW_UP_LEAD'           // contact a lead that hasn't responded
  | 'SEND_PAYMENT_REQUEST'     // request payment from a qualified prospect
  | 'COLLECT_PAYMENT'          // chase an unpaid payment request
  | 'BOOK_MEETING'             // schedule a consultation/demo
  | 'RUN_RESEARCH'             // execute Tavily search for a gap
  | 'EVALUATE_EXPERIMENT'      // experiment has enough data -> evaluate
  | 'ONBOARD_CUSTOMER'         // new paid customer needs onboarding
  | 'REQUEST_REFERRAL'         // customer retention + referral ask
  | 'DISCOVER_PROSPECTS'       // find new platform prospects via Tavily
  | 'IDLE';                    // nothing to do — no authorized actions available

export type ActionPriorityTier = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';

export interface NextBestAction {
  actionType: ActionType;
  /** Subject of the action (opportunityId, journeyId, leadId, etc.) */
  targetId: string;
  targetType: 'OPPORTUNITY' | 'LEAD' | 'PAYMENT_REQUEST' | 'EXPERIMENT' | 'RESEARCH_GAP' | 'PROSPECT' | 'COMMISSION_RECORD' | 'DEMAND_SIGNAL' | 'PARTNER' | 'OFFER' | 'CONTENT_ASSET' | 'NONE';
  ownerAgent: string;
  rationale: string;
  estimatedRevenueINR: number;
  expectedRevenueINR: number;
  probabilityOfSuccess: number;
  timeToRevenueDays: number;
  externalCostINR: number;
  quotaCost: number;
  customerValueINR: number;
  urgency: number;
  cooldownActive: boolean;
  authorizationAvailable: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedValueINR: number;
  priorityScore: number;
  priorityTier: ActionPriorityTier;
  /** Backwards compatibility alias for priorityScore */
  score: number;
  authorizationRequired: boolean;
  estimatedCostINR: number;
}

export class NextBestActionEngine {
  private static instance: NextBestActionEngine;
  private oppEngine = OpportunityEngine.getInstance();

  public static getInstance(): NextBestActionEngine {
    if (!NextBestActionEngine.instance) {
      NextBestActionEngine.instance = new NextBestActionEngine();
    }
    return NextBestActionEngine.instance;
  }

  /**
   * Choose the single highest-value authorized action for a business.
   * Priority-ordered according to Spec § 25:
   *   1. Payment received -> ONBOARD_CUSTOMER
   *   2. Customer without referral ask -> REQUEST_REFERRAL
   *   3. Unpaid payment requests -> COLLECT_PAYMENT
   *   4. Overdue lead follow-ups -> FOLLOW_UP_LEAD
   *   5. Active opportunities -> PURSUE_OPPORTUNITY
   *   6. Experiments ready -> EVALUATE_EXPERIMENT
   *   7. Prospect discovery -> DISCOVER_PROSPECTS
   *   8. IDLE
   */
  public choose(businessId: string, organizationId: string, options?: { ignoreCooldown?: boolean }): NextBestAction {
    const candidates: NextBestAction[] = [];

    // SQL lookup: Structured empirical learning rules from learning_records before scoring (Spec Part C & Step 1)
    const db = getDb();
    let failedRules: Array<{ what: string; outcome: string; cause: string; rule: string }> = [];
    try {
      failedRules = db.prepare(`
        SELECT coalesce(what, decision) as what,
               coalesce(outcome, result) as outcome,
               coalesce(cause, hypothesis) as cause,
               coalesce(rule, action) as rule
        FROM learning_records
        WHERE outcome = 'FAILED' OR result = 'FAILED'
      `).all() as any[];
    } catch {}

    // Priority 0.1 (P0): Verified commission reconciliation (Spec § 22)
    const pendingCommissions = this.getPendingCommissions(organizationId);
    for (const comm of pendingCommissions) {
      const cooldown = ActionCooldownManager.check(comm.id, 'RECONCILE_COMMISSION');
      if (cooldown.eligible || options?.ignoreCooldown) {
        const estRev = comm.expected_commission_inr || 1000;
        candidates.push({
          actionType: 'RECONCILE_COMMISSION',
          targetId: comm.id,
          targetType: 'COMMISSION_RECORD',
          ownerAgent: 'commission-reconciliation-agent',
          rationale: `Pending commission record ${comm.id} (${comm.event_type} on partner ${comm.partner_id}, expected ₹${estRev}). Provider reconciliation needed.`,
          estimatedRevenueINR: estRev,
          expectedRevenueINR: estRev,
          probabilityOfSuccess: 0.9,
          timeToRevenueDays: 1,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: estRev,
          urgency: 1.0,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: estRev,
          priorityScore: 1200,
          priorityTier: 'P0',
          score: 1200,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 0.2 (P0): Quarantine broken partner offers affecting live traffic
    const brokenOffers = this.getBrokenOffers(organizationId);
    for (const off of brokenOffers) {
      const cooldown = ActionCooldownManager.check(off.id, 'QUARANTINE_BAD_PROVIDER');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push({
          actionType: 'QUARANTINE_BAD_PROVIDER',
          targetId: off.id,
          targetType: 'OFFER',
          ownerAgent: 'partner-compliance-agent',
          rationale: `Offer ${off.title} (${off.id}) has invalid or missing tracking destination. Quarantine to protect user experience.`,
          estimatedRevenueINR: 0,
          expectedRevenueINR: 0,
          probabilityOfSuccess: 1.0,
          timeToRevenueDays: 0,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: 0,
          urgency: 0.98,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'HIGH',
          expectedValueINR: 0,
          priorityScore: 1100,
          priorityTier: 'P0',
          score: 1100,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 1 (P0): Paid customers who need onboarding
    const pendingOnboarding = this.getPendingOnboardingCustomers(businessId);
    for (const cust of pendingOnboarding) {
      const cooldown = ActionCooldownManager.check(cust.id, 'ONBOARD_CUSTOMER');
      if (cooldown.eligible || options?.ignoreCooldown) {
        const estRev = cust.total_lifetime_value_inr || 15000;
        candidates.push({
          actionType: 'ONBOARD_CUSTOMER',
          targetId: cust.id,
          targetType: 'LEAD',
          ownerAgent: 'onboarding-agent',
          rationale: `Customer ${cust.customer_name || cust.id} has paid ₹${cust.total_lifetime_value_inr || 0}. Immediate onboarding required.`,
          estimatedRevenueINR: estRev,
          expectedRevenueINR: estRev,
          probabilityOfSuccess: 1.0,
          timeToRevenueDays: 1,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: estRev,
          urgency: 1.0,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: estRev,
          priorityScore: 1000,
          priorityTier: 'P0',
          score: 1000,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 2 (P0): Unpaid payment requests (chase money)
    const unpaidRequests = this.getUnpaidPaymentRequests(businessId);
    for (const req of unpaidRequests) {
      const cooldown = ActionCooldownManager.check(req.id, 'COLLECT_PAYMENT');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push(this.buildCollectPaymentAction(req));
      }
    }

    // Priority 3 (P1): Overdue pipeline follow-ups (hot leads)
    const overduePipeline = this.getOverduePipelineItems(businessId);
    for (const item of overduePipeline) {
      const cooldown = ActionCooldownManager.check(item.id, 'FOLLOW_UP_LEAD');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push(this.buildFollowUpAction(item));
      }
    }

    // Priority 4 (P2): Active opportunities ranked by score
    const opportunities = this.oppEngine.scoreAndRank(businessId);
    for (const opp of opportunities.slice(0, 10)) {
      const cooldown = ActionCooldownManager.check(opp.id, 'PURSUE_OPPORTUNITY');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push(this.buildOpportunityAction(opp));
      }
    }

    // Priority 5 (P1): Retained customers ready for referral ask
    const referralEligible = this.getReferralEligibleCustomers(businessId);
    for (const cust of referralEligible) {
      const cooldown = ActionCooldownManager.check(cust.id, 'REQUEST_REFERRAL');
      if (cooldown.eligible || options?.ignoreCooldown) {
        const estRev = 5000;
        const prob = 0.3;
        const timeDays = 14;
        const ev = estRev * prob;
        const pScore = ev / timeDays;
        candidates.push({
          actionType: 'REQUEST_REFERRAL',
          targetId: cust.id,
          targetType: 'LEAD',
          ownerAgent: 'referral-agent',
          rationale: `Satisfied customer ${cust.customer_name || cust.id} eligible for referral & review request.`,
          estimatedRevenueINR: estRev,
          expectedRevenueINR: ev,
          probabilityOfSuccess: prob,
          timeToRevenueDays: timeDays,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: estRev,
          urgency: 0.85,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: ev,
          priorityScore: pScore + 50,
          priorityTier: 'P1',
          score: pScore + 50,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 5.0 (P1): Active partner offers needing a buyer guide generated
    const unguidedActiveOffers = this.getUnguidedActiveOffers(organizationId);
    for (const off of unguidedActiveOffers) {
      const cooldown = ActionCooldownManager.check(off.id, 'CREATE_CONTENT_ASSET');
      if (cooldown.eligible || options?.ignoreCooldown) {
        const estRev = 3000;
        const prob = 0.5;
        const ev = estRev * prob;
        candidates.push({
          actionType: 'CREATE_CONTENT_ASSET',
          targetId: off.id,
          targetType: 'OFFER',
          ownerAgent: 'content-asset-engine',
          rationale: `Active offer '${off.title}' (${off.id}) has no published or ready guide. Generate guide DRAFT using verified listing facts and advance to PUBLISH_READY.`,
          estimatedRevenueINR: estRev,
          expectedRevenueINR: ev,
          probabilityOfSuccess: prob,
          timeToRevenueDays: 3,
          externalCostINR: 0,
          quotaCost: 1,
          customerValueINR: estRev,
          urgency: 0.95,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: ev,
          priorityScore: 900,
          priorityTier: 'P1',
          score: 900,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 5.1 (P1): Demand signals ready for acquisition content asset generation (Spec § 21 & § 22)
    // STOP CONDITION (Spec § 21): If zero active offers exist, stop building commercial content to avoid unmonetized dead ends.
    if (this.getActiveOffersCount(organizationId) > 0) {
      const demandSignals = this.getUnfulfilledDemandSignals(organizationId);
      for (const sig of demandSignals) {
        const cooldown = ActionCooldownManager.check(sig.id, 'CREATE_CONTENT_ASSET');
        if (cooldown.eligible || options?.ignoreCooldown) {
          const estRev = 2500;
          const prob = 0.35;
          const ev = estRev * prob;
          candidates.push({
            actionType: 'CREATE_CONTENT_ASSET',
            targetId: sig.id,
            targetType: 'DEMAND_SIGNAL',
            ownerAgent: 'content-asset-engine',
            rationale: `Commercial demand discovered for '${sig.topic}' (Est. monthly volume: ${sig.estimated_monthly_volume}). Create acquisition comparison/guide asset with tracked referrals.`,
            estimatedRevenueINR: estRev,
            expectedRevenueINR: ev,
            probabilityOfSuccess: prob,
            timeToRevenueDays: 7,
            externalCostINR: 0,
            quotaCost: 1,
            customerValueINR: estRev,
            urgency: 0.85,
            cooldownActive: false,
            authorizationAvailable: true,
            riskLevel: 'LOW',
            expectedValueINR: ev,
            priorityScore: 850,
            priorityTier: 'P1',
            score: 850,
            authorizationRequired: false,
            estimatedCostINR: 0
          });
        }
      }
    }

    // Priority 5.2 (P1): Active partner offers needing tracked referral links
    const offersNeedingLinks = this.getOffersNeedingReferralLinks(organizationId);
    for (const off of offersNeedingLinks) {
      const cooldown = ActionCooldownManager.check(off.id, 'CREATE_REFERRAL_LINK');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push({
          actionType: 'CREATE_REFERRAL_LINK',
          targetId: off.id,
          targetType: 'OFFER',
          ownerAgent: 'referral-tracking-engine',
          rationale: `Active offer '${off.title}' has no referral link created. Generate first-party attribution tracking link.`,
          estimatedRevenueINR: off.commission_amount_inr || 1000,
          expectedRevenueINR: (off.commission_amount_inr || 1000) * 0.4,
          probabilityOfSuccess: 0.8,
          timeToRevenueDays: 3,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: off.price_inr || 5000,
          urgency: 0.8,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: (off.commission_amount_inr || 1000) * 0.4,
          priorityScore: 800,
          priorityTier: 'P1',
          score: 800,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 5.3 (P2): Partner / Offer discovery if catalog is thin (Spec § 22)
    const partnerCount = this.getActivePartnersCount(organizationId);
    if (partnerCount < 3) {
      const cooldown = ActionCooldownManager.check(businessId, 'DISCOVER_PARTNER');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push({
          actionType: 'DISCOVER_PARTNER',
          targetId: businessId,
          targetType: 'PARTNER',
          ownerAgent: 'partner-discovery-agent',
          rationale: `Active verified partner catalog thin (${partnerCount} partners). Discover verified Indian affiliate & referral partner programs.`,
          estimatedRevenueINR: 5000,
          expectedRevenueINR: 1000,
          probabilityOfSuccess: 0.3,
          timeToRevenueDays: 14,
          externalCostINR: 0,
          quotaCost: 1,
          customerValueINR: 5000,
          urgency: 0.65,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: 1000,
          priorityScore: 500,
          priorityTier: 'P2',
          score: 500,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 5.4 (P3): Demand discovery if demand signals are thin (Spec § 22)
    const demandCount = this.getDemandSignalsCount(organizationId);
    if (demandCount < 3) {
      const cooldown = ActionCooldownManager.check(businessId, 'DISCOVER_DEMAND');
      if (cooldown.eligible || options?.ignoreCooldown) {
        candidates.push({
          actionType: 'DISCOVER_DEMAND',
          targetId: businessId,
          targetType: 'DEMAND_SIGNAL',
          ownerAgent: 'demand-discovery-engine',
          rationale: `Demand signals thin (${demandCount} active). Discover high-intent Indian purchase and comparison queries via Tavily/Gemini.`,
          estimatedRevenueINR: 3000,
          expectedRevenueINR: 600,
          probabilityOfSuccess: 0.4,
          timeToRevenueDays: 10,
          externalCostINR: 0,
          quotaCost: 1,
          customerValueINR: 3000,
          urgency: 0.6,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: 600,
          priorityScore: 250,
          priorityTier: 'P3',
          score: 250,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // Priority 6 (P3): Experiments ready to evaluate
    const readyExperiments = this.getEvaluatableExperiments(businessId);
    for (const exp of readyExperiments.slice(0, 3)) {
      candidates.push(this.buildExperimentAction(exp));
    }

    // Priority 7 (P3): Prospect discovery (only if pipeline is thin)
    const activePipelineCount = this.getActivePipelineCount(businessId);
    if (activePipelineCount < 5) {
      const cooldown = ActionCooldownManager.check(businessId, 'DISCOVER_PROSPECTS');
      if (cooldown.eligible || options?.ignoreCooldown) {
        const estRev = 15000;
        const prob = 0.2;
        const timeDays = 45;
        const ev = estRev * prob;
        const pScore = ev / timeDays;
        candidates.push({
          actionType: 'DISCOVER_PROSPECTS',
          targetId: businessId,
          targetType: 'RESEARCH_GAP',
          ownerAgent: 'prospect-discovery-agent',
          rationale: `Active sales pipeline thin (${activePipelineCount} leads). Discover new qualified prospects via real research.`,
          estimatedRevenueINR: estRev,
          expectedRevenueINR: ev,
          probabilityOfSuccess: prob,
          timeToRevenueDays: timeDays,
          externalCostINR: 0,
          quotaCost: 1,
          customerValueINR: estRev,
          urgency: 0.5,
          cooldownActive: false,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: ev,
          priorityScore: pScore,
          priorityTier: 'P3',
          score: pScore,
          authorizationRequired: false,
          estimatedCostINR: 0
        });
      }
    }

    // If still no candidates, return IDLE
    if (candidates.length === 0) {
      return {
        actionType: 'IDLE',
        targetId: businessId,
        targetType: 'NONE',
        ownerAgent: 'orchestrator',
        rationale: 'All current tasks are within cooldown periods or no active work is due. System in resting state.',
        estimatedRevenueINR: 0,
        expectedRevenueINR: 0,
        probabilityOfSuccess: 0,
        timeToRevenueDays: 0,
        externalCostINR: 0,
        quotaCost: 0,
        customerValueINR: 0,
        urgency: 0,
        cooldownActive: false,
        authorizationAvailable: true,
        riskLevel: 'LOW',
        expectedValueINR: 0,
        priorityScore: 0,
        priorityTier: 'P4',
        score: 0,
        authorizationRequired: false,
        estimatedCostINR: 0
      };
    }

    // Filter out candidates blocked by learning records with outcome = 'FAILED'
    const eligibleCandidates = candidates.filter(c => {
      const blockCheck = this.isActionBlockedByFailedRules(c, failedRules);
      if (blockCheck.blocked) {
        console.warn(`[NextBestActionEngine] Candidate action ${c.actionType} blocked by FAILED learning rule: ${blockCheck.matchingRule?.rule || blockCheck.matchingRule?.what}`);
        return false;
      }
      return true;
    });

    if (eligibleCandidates.length === 0) {
      return {
        actionType: 'IDLE',
        targetId: businessId,
        targetType: 'NONE',
        ownerAgent: 'orchestrator',
        rationale: 'All candidate actions were blocked by FAILED empirical learning rules or are on cooldown.',
        estimatedRevenueINR: 0,
        expectedRevenueINR: 0,
        probabilityOfSuccess: 0,
        timeToRevenueDays: 0,
        externalCostINR: 0,
        quotaCost: 0,
        customerValueINR: 0,
        urgency: 0,
        cooldownActive: false,
        authorizationAvailable: true,
        riskLevel: 'LOW',
        expectedValueINR: 0,
        priorityScore: 0,
        priorityTier: 'P4',
        score: 0,
        authorizationRequired: false,
        estimatedCostINR: 0
      };
    }

    // Sort by priority tier first, then by priority score descending
    const tierWeights: Record<ActionPriorityTier, number> = {
      P0: 1000000,
      P1: 10000,
      P2: 1000,
      P3: 100,
      P4: 1
    };

    eligibleCandidates.sort((a, b) => {
      const scoreA = (tierWeights[a.priorityTier] || 0) + a.score;
      const scoreB = (tierWeights[b.priorityTier] || 0) + b.score;
      return scoreB - scoreA;
    });

    const best = eligibleCandidates[0];

    console.log(
      `[NextBestActionEngine] Selected action for ${businessId}: ${best.actionType} ` +
      `(score=${best.score.toFixed(2)}, expected=₹${best.expectedRevenueINR.toFixed(0)})`
    );

    return best;
  }

  /**
   * Evaluates if a given action is blocked by any learning record with outcome = 'FAILED'.
   */
  public isActionBlockedByFailedRules(
    action: { actionType: string; targetId?: string; targetType?: string; rationale?: string },
    failedRules?: Array<{ what: string; rule: string; cause?: string; outcome?: string }>
  ): { blocked: boolean; matchingRule?: any } {
    if (!failedRules) {
      try {
        const db = getDb();
        failedRules = db.prepare(`
          SELECT coalesce(what, decision) as what,
                 coalesce(outcome, result) as outcome,
                 coalesce(cause, hypothesis) as cause,
                 coalesce(rule, action) as rule
          FROM learning_records
          WHERE outcome = 'FAILED' OR result = 'FAILED'
        `).all() as any[];
      } catch {
        failedRules = [];
      }
    }

    for (const r of failedRules) {
      const whatLower = (r.what || '').toLowerCase().trim();
      const ruleLower = (r.rule || '').toLowerCase().trim();
      const actionTypeLower = action.actionType.toLowerCase().trim();

      // Explicit action type matching
      if (
        whatLower === actionTypeLower ||
        ruleLower === `block_${actionTypeLower}` ||
        ruleLower === `block:${actionTypeLower}` ||
        ruleLower.includes(`block_${actionTypeLower}`) ||
        ruleLower.includes(`block action: ${actionTypeLower}`) ||
        whatLower.includes(`block_${actionTypeLower}`) ||
        whatLower.includes(`block:${actionTypeLower}`) ||
        (ruleLower.includes('block') && ruleLower.includes(actionTypeLower))
      ) {
        return { blocked: true, matchingRule: r };
      }

      // Target matching if applicable
      if (action.targetId && (whatLower.includes(action.targetId.toLowerCase()) || ruleLower.includes(action.targetId.toLowerCase()))) {
        return { blocked: true, matchingRule: r };
      }
    }

    return { blocked: false };
  }

  public rankAll(businessId: string, organizationId: string): NextBestAction[] {
    const opps = this.oppEngine.scoreAndRank(businessId);
    return opps.map(opp => this.buildOpportunityAction(opp));
  }

  private buildOpportunityAction(opp: Opportunity): NextBestAction {
    const expectedValue = (opp.estimatedValueINR * opp.probability) - opp.acquisitionCostINR;
    const score = expectedValue / Math.max(1, opp.timeToRevenueDays);
    const riskPenalty = opp.riskLevel === 'HIGH' ? 0.5 : opp.riskLevel === 'MEDIUM' ? 0.8 : 1.0;
    const finalScore = score * riskPenalty;

    return {
      actionType: 'PURSUE_OPPORTUNITY',
      targetId: opp.id,
      targetType: 'OPPORTUNITY',
      ownerAgent: 'outreach-agent',
      rationale: `Opportunity (${opp.source}): ₹${opp.estimatedValueINR.toFixed(0)} at ${(opp.probability * 100).toFixed(0)}% probability. ${opp.nextBestAction}`,
      estimatedRevenueINR: opp.estimatedValueINR,
      expectedRevenueINR: opp.expectedRevenueINR,
      probabilityOfSuccess: opp.probability,
      timeToRevenueDays: opp.timeToRevenueDays,
      externalCostINR: opp.acquisitionCostINR,
      quotaCost: 1,
      customerValueINR: opp.estimatedValueINR,
      urgency: 0.7,
      cooldownActive: false,
      authorizationAvailable: true,
      riskLevel: opp.riskLevel,
      expectedValueINR: expectedValue,
      priorityScore: finalScore,
      priorityTier: 'P2',
      score: finalScore,
      authorizationRequired: opp.authorizationRequirements.length > 0,
      estimatedCostINR: opp.acquisitionCostINR
    };
  }

  private buildFollowUpAction(item: any): NextBestAction {
    const daysSinceContact = Math.max(1, item.days_since_contact || 1);
    const estRev = item.expected_revenue_inr || 8000;
    const prob = item.probability || 0.25;
    const ev = estRev * prob;
    const score = ev / Math.max(1, daysSinceContact);
    const finalScore = Math.max(10, score);

    return {
      actionType: 'FOLLOW_UP_LEAD',
      targetId: item.id,
      targetType: 'LEAD',
      ownerAgent: 'follow-up-agent',
      rationale: `Lead "${item.customer_name || item.id}" overdue for follow-up (${daysSinceContact}d since contact).`,
      estimatedRevenueINR: estRev,
      expectedRevenueINR: ev,
      probabilityOfSuccess: prob,
      timeToRevenueDays: 7,
      externalCostINR: 0,
      quotaCost: 1,
      customerValueINR: estRev,
      urgency: 0.8,
      cooldownActive: false,
      authorizationAvailable: true,
      riskLevel: 'LOW',
      expectedValueINR: ev,
      priorityScore: finalScore,
      priorityTier: 'P1',
      score: finalScore,
      authorizationRequired: false,
      estimatedCostINR: 0
    };
  }

  private buildCollectPaymentAction(req: any): NextBestAction {
    const estRev = req.amount_inr || 0;
    const prob = 0.8;
    const ev = estRev * prob;
    const score = Math.max(100, (estRev * 0.8) / 2);

    return {
      actionType: 'COLLECT_PAYMENT',
      targetId: req.id,
      targetType: 'PAYMENT_REQUEST',
      ownerAgent: 'payment-follow-up-agent',
      rationale: `Uncollected payment request of ₹${req.amount_inr} (Status: ${req.status}). Immediate follow-up required.`,
      estimatedRevenueINR: estRev,
      expectedRevenueINR: ev,
      probabilityOfSuccess: prob,
      timeToRevenueDays: 2,
      externalCostINR: 0,
      quotaCost: 1,
      customerValueINR: estRev,
      urgency: 0.95,
      cooldownActive: false,
      authorizationAvailable: true,
      riskLevel: 'LOW',
      expectedValueINR: ev,
      priorityScore: score,
      priorityTier: 'P0',
      score: score,
      authorizationRequired: false,
      estimatedCostINR: 0
    };
  }

  private buildExperimentAction(exp: any): NextBestAction {
    return {
      actionType: 'EVALUATE_EXPERIMENT',
      targetId: exp.id,
      targetType: 'EXPERIMENT',
      ownerAgent: 'experiment-evaluator',
      rationale: `Experiment "${exp.title}" has sufficient real data for evaluation.`,
      estimatedRevenueINR: 0,
      expectedRevenueINR: 0,
      probabilityOfSuccess: 0.9,
      timeToRevenueDays: 1,
      externalCostINR: 0,
      quotaCost: 0,
      customerValueINR: 0,
      urgency: 0.3,
      cooldownActive: false,
      authorizationAvailable: true,
      riskLevel: 'LOW',
      expectedValueINR: 0,
      priorityScore: 1.0,
      priorityTier: 'P3',
      score: 1.0,
      authorizationRequired: false,
      estimatedCostINR: 0
    };
  }

  private getPendingOnboardingCustomers(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT cj.* FROM customer_journeys cj
      WHERE cj.business_id = ?
        AND cj.stage = 'CUSTOMER'
        AND cj.classification = 'REAL'
        AND cj.id NOT IN (
          SELECT target_id FROM action_cooldowns WHERE action_type = 'ONBOARD_CUSTOMER' AND exhausted = 1
        )
      LIMIT 3
    `).all(businessId) as any[];
  }

  private getOverduePipelineItems(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT sp.*, cj.customer_name, cj.customer_phone,
             CAST((julianday('now') - julianday(COALESCE(sp.next_action_at, sp.created_at))) AS INTEGER) as days_since_contact
      FROM sales_pipeline sp
      LEFT JOIN customer_journeys cj ON sp.journey_id = cj.id
      WHERE sp.business_id = ?
        AND sp.stage NOT IN ('PAID', 'ONBOARDED', 'RETAINED', 'LOST')
        AND (sp.next_action_at IS NULL OR sp.next_action_at <= datetime('now'))
      ORDER BY sp.expected_revenue_inr DESC
      LIMIT 5
    `).all(businessId) as any[];
  }

  private getUnpaidPaymentRequests(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM payment_requests
      WHERE business_id = ?
        AND status IN ('SENT', 'VIEWED', 'PAYMENT_INITIATED', 'PENDING')
        AND classification = 'REAL'
      ORDER BY amount_inr DESC
      LIMIT 5
    `).all(businessId) as any[];
  }

  private getEvaluatableExperiments(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM experiments
      WHERE business_id = ?
        AND status = 'RUNNING'
      LIMIT 3
    `).all(businessId) as any[];
  }

  private getReferralEligibleCustomers(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM customer_journeys
      WHERE business_id = ?
        AND stage = 'CUSTOMER'
        AND classification = 'REAL'
        AND created_at <= datetime('now', '-7 days')
      LIMIT 3
    `).all(businessId) as any[];
  }

  private getActivePipelineCount(businessId: string): number {
    const db = getDb();
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM sales_pipeline
      WHERE business_id = ? AND stage NOT IN ('LOST', 'RETAINED')
    `).get(businessId) as any;
    return row?.cnt || 0;
  }

  private getPendingCommissions(organizationId: string): any[] {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT * FROM commission_records
        WHERE status IN ('COMMISSION_PENDING', 'CONVERSION_REPORTED', 'EXTERNAL_CONVERSION_PENDING')
        ORDER BY created_at ASC
        LIMIT 5
      `).all() as any[];
    } catch {
      return [];
    }
  }

  private getBrokenOffers(organizationId: string): any[] {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT * FROM partner_offers
        WHERE active = 1 AND (authorized_tracking_url IS NULL OR trim(authorized_tracking_url) = '' OR destination_url IS NULL OR trim(destination_url) = '')
        LIMIT 5
      `).all() as any[];
    } catch {
      return [];
    }
  }

  private getUnguidedActiveOffers(organizationId: string): any[] {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT po.* FROM partner_offers po
        WHERE po.organization_id = ? AND po.status = 'ACTIVE' AND po.active = 1
          AND po.id NOT IN (
            SELECT COALESCE(primary_offer_id, '') FROM commission_content_assets
            WHERE status IN ('PUBLISHED', 'PUBLISH_READY')
          )
        ORDER BY po.created_at DESC
        LIMIT 5
      `).all(organizationId) as any[];
    } catch {
      return [];
    }
  }

  private getUnfulfilledDemandSignals(organizationId: string): any[] {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT ds.* FROM demand_signals ds
        WHERE ds.status IN ('DISCOVERED', 'MATCHED')
        ORDER BY ds.urgency DESC, ds.estimated_monthly_volume DESC
        LIMIT 5
      `).all() as any[];
    } catch {
      return [];
    }
  }

  private getOffersNeedingReferralLinks(organizationId: string): any[] {
    const db = getDb();
    try {
      return db.prepare(`
        SELECT po.* FROM partner_offers po
        LEFT JOIN referrals r ON po.id = r.offer_id
        WHERE po.active = 1 AND r.id IS NULL
        LIMIT 5
      `).all() as any[];
    } catch {
      return [];
    }
  }

  private getActivePartnersCount(organizationId: string): number {
    const db = getDb();
    try {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM partners WHERE active_status = 1`).get() as any;
      return row?.cnt || 0;
    } catch {
      return 0;
    }
  }

  private getActiveOffersCount(organizationId: string): number {
    const db = getDb();
    try {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM partner_offers WHERE active = 1 AND status = 'ACTIVE'`).get() as any;
      return row?.cnt || 0;
    } catch {
      return 0;
    }
  }

  private getDemandSignalsCount(organizationId: string): number {
    const db = getDb();
    try {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM demand_signals`).get() as any;
      return row?.cnt || 0;
    } catch {
      return 0;
    }
  }
}
