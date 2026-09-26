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

export interface NextBestAction {
  actionType: ActionType;
  /** Subject of the action (opportunityId, journeyId, leadId, etc.) */
  targetId: string;
  targetType: 'OPPORTUNITY' | 'LEAD' | 'PAYMENT_REQUEST' | 'EXPERIMENT' | 'RESEARCH_GAP' | 'PROSPECT' | 'NONE';
  ownerAgent: string;
  rationale: string;
  expectedRevenueINR: number;
  probabilityOfSuccess: number;
  timeToRevenueDays: number;
  /** Higher = better. Score = (expectedRevenue × probability) / timeToRevenue */
  score: number;
  authorizationRequired: boolean;
  estimatedCostINR: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
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
  public choose(businessId: string, organizationId: string): NextBestAction {
    const candidates: NextBestAction[] = [];

    // Priority 1: Paid customers who need onboarding
    const pendingOnboarding = this.getPendingOnboardingCustomers(businessId);
    for (const cust of pendingOnboarding) {
      const cooldown = ActionCooldownManager.check(cust.id, 'ONBOARD_CUSTOMER');
      if (cooldown.eligible) {
        candidates.push({
          actionType: 'ONBOARD_CUSTOMER',
          targetId: cust.id,
          targetType: 'LEAD',
          ownerAgent: 'onboarding-agent',
          rationale: `Customer ${cust.customer_name || cust.id} has paid ₹${cust.total_lifetime_value_inr || 0}. Immediate onboarding required.`,
          expectedRevenueINR: cust.total_lifetime_value_inr || 15000,
          probabilityOfSuccess: 1.0,
          timeToRevenueDays: 1,
          score: 1000, // Highest priority: service delivery to paying customer
          authorizationRequired: false,
          estimatedCostINR: 0,
          riskLevel: 'LOW'
        });
      }
    }

    // Priority 2: Unpaid payment requests (chase money)
    const unpaidRequests = this.getUnpaidPaymentRequests(businessId);
    for (const req of unpaidRequests) {
      const cooldown = ActionCooldownManager.check(req.id, 'COLLECT_PAYMENT');
      if (cooldown.eligible) {
        candidates.push(this.buildCollectPaymentAction(req));
      }
    }

    // Priority 3: Overdue pipeline follow-ups (hot leads)
    const overduePipeline = this.getOverduePipelineItems(businessId);
    for (const item of overduePipeline) {
      const cooldown = ActionCooldownManager.check(item.id, 'FOLLOW_UP_LEAD');
      if (cooldown.eligible) {
        candidates.push(this.buildFollowUpAction(item));
      }
    }

    // Priority 4: Active opportunities ranked by score
    const opportunities = this.oppEngine.scoreAndRank(businessId);
    for (const opp of opportunities.slice(0, 10)) {
      const cooldown = ActionCooldownManager.check(opp.id, 'PURSUE_OPPORTUNITY');
      if (cooldown.eligible) {
        candidates.push(this.buildOpportunityAction(opp));
      }
    }

    // Priority 5: Experiments ready to evaluate
    const readyExperiments = this.getEvaluatableExperiments(businessId);
    for (const exp of readyExperiments.slice(0, 3)) {
      candidates.push(this.buildExperimentAction(exp));
    }

    // Priority 6: Retained customers ready for referral ask
    const referralEligible = this.getReferralEligibleCustomers(businessId);
    for (const cust of referralEligible) {
      const cooldown = ActionCooldownManager.check(cust.id, 'REQUEST_REFERRAL');
      if (cooldown.eligible) {
        candidates.push({
          actionType: 'REQUEST_REFERRAL',
          targetId: cust.id,
          targetType: 'LEAD',
          ownerAgent: 'referral-agent',
          rationale: `Satisfied customer ${cust.customer_name || cust.id} eligible for referral & review request.`,
          expectedRevenueINR: 5000,
          probabilityOfSuccess: 0.3,
          timeToRevenueDays: 14,
          score: (5000 * 0.3) / 14,
          authorizationRequired: false,
          estimatedCostINR: 0,
          riskLevel: 'LOW'
        });
      }
    }

    // Priority 7: Prospect discovery (only if pipeline is thin)
    const activePipelineCount = this.getActivePipelineCount(businessId);
    if (activePipelineCount < 5) {
      const cooldown = ActionCooldownManager.check(businessId, 'DISCOVER_PROSPECTS');
      if (cooldown.eligible) {
        candidates.push({
          actionType: 'DISCOVER_PROSPECTS',
          targetId: businessId,
          targetType: 'RESEARCH_GAP',
          ownerAgent: 'prospect-discovery-agent',
          rationale: `Active sales pipeline thin (${activePipelineCount} leads). Discover new qualified prospects via real research.`,
          expectedRevenueINR: 15000,
          probabilityOfSuccess: 0.2,
          timeToRevenueDays: 45,
          score: (15000 * 0.2) / 45, // approx 66.6
          authorizationRequired: false,
          estimatedCostINR: 0,
          riskLevel: 'LOW'
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
        expectedRevenueINR: 0,
        probabilityOfSuccess: 0,
        timeToRevenueDays: 0,
        score: 0,
        authorizationRequired: false,
        estimatedCostINR: 0,
        riskLevel: 'LOW'
      };
    }

    // Sort by expected value score descending
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    console.log(
      `[NextBestActionEngine] Selected action for ${businessId}: ${best.actionType} ` +
      `(score=${best.score.toFixed(2)}, expected=₹${best.expectedRevenueINR.toFixed(0)})`
    );

    return best;
  }

  public rankAll(businessId: string, organizationId: string): NextBestAction[] {
    const opps = this.oppEngine.scoreAndRank(businessId);
    return opps.map(opp => this.buildOpportunityAction(opp));
  }

  private buildOpportunityAction(opp: Opportunity): NextBestAction {
    const score = (opp.estimatedValueINR * opp.probability) / Math.max(1, opp.timeToRevenueDays);
    const riskPenalty = opp.riskLevel === 'HIGH' ? 0.5 : opp.riskLevel === 'MEDIUM' ? 0.8 : 1.0;
    return {
      actionType: 'PURSUE_OPPORTUNITY',
      targetId: opp.id,
      targetType: 'OPPORTUNITY',
      ownerAgent: 'outreach-agent',
      rationale: `Opportunity (${opp.source}): ₹${opp.estimatedValueINR.toFixed(0)} at ${(opp.probability * 100).toFixed(0)}% probability. ${opp.nextBestAction}`,
      expectedRevenueINR: opp.expectedRevenueINR,
      probabilityOfSuccess: opp.probability,
      timeToRevenueDays: opp.timeToRevenueDays,
      score: score * riskPenalty,
      authorizationRequired: opp.authorizationRequirements.length > 0,
      estimatedCostINR: opp.acquisitionCostINR,
      riskLevel: opp.riskLevel
    };
  }

  private buildFollowUpAction(item: any): NextBestAction {
    const daysSinceContact = Math.max(1, item.days_since_contact || 1);
    const score = (item.expected_revenue_inr * (item.probability || 0.25)) / Math.max(1, daysSinceContact);
    return {
      actionType: 'FOLLOW_UP_LEAD',
      targetId: item.id,
      targetType: 'LEAD',
      ownerAgent: 'follow-up-agent',
      rationale: `Lead "${item.customer_name || item.id}" overdue for follow-up (${daysSinceContact}d since contact).`,
      expectedRevenueINR: item.expected_revenue_inr || 8000,
      probabilityOfSuccess: item.probability || 0.25,
      timeToRevenueDays: 7,
      score: Math.max(10, score),
      authorizationRequired: false,
      estimatedCostINR: 0,
      riskLevel: 'LOW'
    };
  }

  private buildCollectPaymentAction(req: any): NextBestAction {
    const score = (req.amount_inr * 0.8) / 2; // high score: direct revenue collection
    return {
      actionType: 'COLLECT_PAYMENT',
      targetId: req.id,
      targetType: 'PAYMENT_REQUEST',
      ownerAgent: 'payment-follow-up-agent',
      rationale: `Uncollected payment request of ₹${req.amount_inr} (Status: ${req.status}). Immediate follow-up required.`,
      expectedRevenueINR: req.amount_inr || 0,
      probabilityOfSuccess: 0.8,
      timeToRevenueDays: 2,
      score: Math.max(100, score),
      authorizationRequired: false,
      estimatedCostINR: 0,
      riskLevel: 'LOW'
    };
  }

  private buildExperimentAction(exp: any): NextBestAction {
    return {
      actionType: 'EVALUATE_EXPERIMENT',
      targetId: exp.id,
      targetType: 'EXPERIMENT',
      ownerAgent: 'experiment-evaluator',
      rationale: `Experiment "${exp.title}" has sufficient real data for evaluation.`,
      expectedRevenueINR: 0,
      probabilityOfSuccess: 0.9,
      timeToRevenueDays: 1,
      score: 1.0,
      authorizationRequired: false,
      estimatedCostINR: 0,
      riskLevel: 'LOW'
    };
  }

  private getPendingOnboardingCustomers(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT cj.* FROM customer_journeys cj
      WHERE cj.business_id = ?
        AND cj.stage = 'CUSTOMER'
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
}
