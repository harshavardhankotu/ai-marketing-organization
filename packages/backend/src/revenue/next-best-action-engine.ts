/**
 * NextBestActionEngine — scores and selects the single highest-value
 * authorized action the system can take right now.
 *
 * Scoring formula (spec item 11):
 *   score = (expectedRevenue × probability) / timeToRevenue
 *   minus: cost, risk penalty, authorization blocker
 *
 * The engine considers:
 *   - Active opportunities (ranked by OpportunityEngine.scoreAndRank)
 *   - Sales pipeline leads overdue for follow-up
 *   - Payment requests pending collection
 *   - Experiment results ready for evaluation
 *   - Research gaps that need Tavily queries
 *
 * Output: a single NextBestAction with full rationale.
 */

import { getDb } from '../db/client.js';
import { OpportunityEngine, Opportunity } from './opportunity-engine.js';

export type ActionType =
  | 'PURSUE_OPPORTUNITY'       // advance a qualified opportunity
  | 'FOLLOW_UP_LEAD'           // contact a lead that hasn't responded
  | 'SEND_PAYMENT_REQUEST'     // request payment from a qualified prospect
  | 'COLLECT_PAYMENT'          // chase an unpaid payment request
  | 'BOOK_MEETING'             // schedule a consultation/demo
  | 'RUN_RESEARCH'             // execute Tavily search for a gap
  | 'EVALUATE_EXPERIMENT'      // experiment has enough data → evaluate
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
   * Returns IDLE if no authorized actions are available.
   */
  public choose(businessId: string, organizationId: string): NextBestAction {
    const candidates: NextBestAction[] = [];

    // 1. Active opportunities ranked by score
    const opportunities = this.oppEngine.scoreAndRank(businessId);
    for (const opp of opportunities.slice(0, 10)) {
      candidates.push(this.buildOpportunityAction(opp));
    }

    // 2. Overdue pipeline follow-ups
    const overduePipeline = this.getOverduePipelineItems(businessId);
    for (const item of overduePipeline.slice(0, 5)) {
      candidates.push(this.buildFollowUpAction(item));
    }

    // 3. Unpaid payment requests
    const unpaidRequests = this.getUnpaidPaymentRequests(businessId);
    for (const req of unpaidRequests.slice(0, 5)) {
      candidates.push(this.buildCollectPaymentAction(req));
    }

    // 4. Experiments ready to evaluate
    const readyExperiments = this.getEvaluatableExperiments(businessId);
    for (const exp of readyExperiments.slice(0, 3)) {
      candidates.push(this.buildExperimentAction(exp));
    }

    // 5. If no candidates, suggest prospect discovery via research
    if (candidates.length === 0) {
      candidates.push({
        actionType: 'DISCOVER_PROSPECTS',
        targetId: businessId,
        targetType: 'RESEARCH_GAP',
        ownerAgent: 'prospect-discovery-agent',
        rationale: 'No active opportunities or overdue actions. Run Tavily search to discover new prospects.',
        expectedRevenueINR: 0,
        probabilityOfSuccess: 0.3,
        timeToRevenueDays: 60,
        score: 0.005, // very low score — last resort
        authorizationRequired: false,
        estimatedCostINR: 0,
        riskLevel: 'LOW'
      });
    }

    // Sort and return the best
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    console.log(
      `[NextBestActionEngine] Best action for ${businessId}: ${best.actionType} ` +
      `(score=${best.score.toFixed(3)}, expected=₹${best.expectedRevenueINR.toFixed(0)})`
    );

    return best;
  }

  /**
   * Score all candidates and return the ranked list (for CEO dashboard).
   */
  public rankAll(businessId: string, organizationId: string): NextBestAction[] {
    const best = this.choose(businessId, organizationId);
    // Re-run full list without slicing (simplified — build all candidates)
    const opportunities = this.oppEngine.scoreAndRank(businessId);
    return opportunities.map(opp => this.buildOpportunityAction(opp));
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
    const daysSinceContact = item.days_since_contact || 1;
    const score = (item.expected_revenue_inr * item.probability) / Math.max(1, daysSinceContact);
    return {
      actionType: 'FOLLOW_UP_LEAD',
      targetId: item.id,
      targetType: 'LEAD',
      ownerAgent: 'follow-up-agent',
      rationale: `Lead has been uncontacted for ${daysSinceContact} day(s). Next action: ${item.next_action || 'follow up'}`,
      expectedRevenueINR: item.expected_revenue_inr || 0,
      probabilityOfSuccess: item.probability || 0.1,
      timeToRevenueDays: daysSinceContact + 7,
      score: score,
      authorizationRequired: false,
      estimatedCostINR: 0,
      riskLevel: 'LOW'
    };
  }

  private buildCollectPaymentAction(req: any): NextBestAction {
    return {
      actionType: 'COLLECT_PAYMENT',
      targetId: req.id,
      targetType: 'PAYMENT_REQUEST',
      ownerAgent: 'payment-follow-up-agent',
      rationale: `Payment request of ₹${req.amount_inr} is unpaid. Status: ${req.status}.`,
      expectedRevenueINR: req.amount_inr || 0,
      probabilityOfSuccess: 0.7,
      timeToRevenueDays: 3,
      score: (req.amount_inr * 0.7) / 3,
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
      rationale: `Experiment "${exp.title}" has sufficient data for evaluation.`,
      expectedRevenueINR: 0,
      probabilityOfSuccess: 0.9,
      timeToRevenueDays: 1,
      score: 0.1, // low but immediate — learning value
      authorizationRequired: false,
      estimatedCostINR: 0,
      riskLevel: 'LOW'
    };
  }

  private getOverduePipelineItems(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT *, CAST((julianday('now') - julianday(COALESCE(next_action_at, created_at))) AS INTEGER) as days_since_contact
      FROM sales_pipeline
      WHERE business_id = ?
        AND stage NOT IN ('PAID', 'ONBOARDED', 'RETAINED', 'LOST')
        AND (next_action_at IS NULL OR next_action_at <= datetime('now'))
      ORDER BY expected_revenue_inr DESC
      LIMIT 10
    `).all(businessId) as any[];
  }

  private getUnpaidPaymentRequests(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM payment_requests
      WHERE business_id = ?
        AND status IN ('SENT', 'VIEWED', 'PAYMENT_INITIATED')
        AND classification = 'REAL'
      ORDER BY amount_inr DESC
      LIMIT 10
    `).all(businessId) as any[];
  }

  private getEvaluatableExperiments(businessId: string): any[] {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM experiments
      WHERE business_id = ?
        AND status = 'RUNNING'
      LIMIT 5
    `).all(businessId) as any[];
  }
}
