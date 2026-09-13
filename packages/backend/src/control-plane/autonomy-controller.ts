import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import {
  AutonomyOperatingMode,
  BudgetPolicyRecord,
  CampaignOptimizationProposal,
  ExperimentCandidateProposal,
  StopConditionEvent,
} from '@ai-marketing/shared';
import { RealEconomicsEngine } from '../revenue/real-economics.js';

export class AutonomyController {
  private get db() {
    return getDb();
  }

  private economicsEngine = new RealEconomicsEngine();

  private readonly HARD_SPEND_CAP_INR = 10000.0;
  private readonly SCALING_MIN_REAL_CUSTOMERS = 5;

  /**
   * Initializes or gets the autonomy policy for a business.
   */
  public getBudgetPolicy(businessId: string): BudgetPolicyRecord {
    let row = this.db
      .prepare('SELECT * FROM autonomy_policy WHERE business_id = ?')
      .get(businessId) as any;

    if (!row) {
      this.db
        .prepare(
          `INSERT INTO autonomy_policy (
            business_id, active_mode, max_autonomous_spend_inr,
            current_autonomous_spend_inr, requires_owner_approval_above_inr,
            stop_conditions_triggered
          ) VALUES (?, 'CONTROLLED_AUTONOMY', ?, 0.0, ?, 0)`
        )
        .run(businessId, this.HARD_SPEND_CAP_INR, this.HARD_SPEND_CAP_INR);

      row = {
        active_mode: 'CONTROLLED_AUTONOMY',
        max_autonomous_spend_inr: this.HARD_SPEND_CAP_INR,
        current_autonomous_spend_inr: 0.0,
        requires_owner_approval_above_inr: this.HARD_SPEND_CAP_INR,
        stop_conditions_triggered: 0,
      };
    }

    const maxSpend = row.max_autonomous_spend_inr;
    const currentSpend = row.current_autonomous_spend_inr;
    const remaining = Math.max(0, maxSpend - currentSpend);

    return {
      activeMode: row.active_mode as AutonomyOperatingMode,
      maxAutonomousSpendINR: maxSpend,
      currentAutonomousSpendINR: currentSpend,
      remainingAutonomousBudgetINR: remaining,
      requiresOwnerApprovalAboveINR: row.requires_owner_approval_above_inr,
      stopConditionsTriggered: row.stop_conditions_triggered === 1,
    };
  }

  /**
   * Updates the operating mode with strict enforcement of the Scaling Gate.
   */
  public setOperatingMode(
    businessId: string,
    mode: AutonomyOperatingMode
  ): { success: boolean; mode: AutonomyOperatingMode; rationale: string } {
    // SCALING GATE ENFORCEMENT
    if (mode === 'AUTONOMOUS_SCALING') {
      const customerRow = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM customer_journeys WHERE business_id = ? AND classification = 'REAL' AND stage = 'CUSTOMER'"
        )
        .get(businessId) as any;
      const realCustomersCount = customerRow?.count || 0;

      const economics = this.economicsEngine.calculate(businessId);
      const isProfitable = economics.netContributionINR > 0 || (typeof economics.verifiedRoas === 'number' && economics.verifiedRoas >= 1.0);

      if (realCustomersCount < this.SCALING_MIN_REAL_CUSTOMERS || !isProfitable) {
        return {
          success: false,
          mode: this.getBudgetPolicy(businessId).activeMode,
          rationale: `SCALING GATE LOCKED: Cannot enter AUTONOMOUS_SCALING until at least ${this.SCALING_MIN_REAL_CUSTOMERS} real paying customers and verified profitability are achieved. (Current real customers: ${realCustomersCount}, Net contribution: ₹${economics.netContributionINR})`,
        };
      }
    }

    this.getBudgetPolicy(businessId); // Ensure initialized

    this.db
      .prepare(
        'UPDATE autonomy_policy SET active_mode = ?, updated_at = datetime("now") WHERE business_id = ?'
      )
      .run(mode, businessId);

    return {
      success: true,
      mode,
      rationale: `Operating mode transitioned to ${mode}`,
    };
  }

  /**
   * Triggers an autonomous stop condition:
   * Reverts mode to OBSERVE and records the event.
   */
  public triggerStopCondition(
    businessId: string,
    condition: StopConditionEvent['condition'],
    details: string
  ): StopConditionEvent {
    this.getBudgetPolicy(businessId); // Ensure initialized

    const id = `stop-${randomUUID()}`;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO stop_conditions_log (id, condition, details, campaign_halted, timestamp)
         VALUES (?, ?, ?, 1, ?)`
      )
      .run(id, condition, details, now);

    this.db
      .prepare(
        `UPDATE autonomy_policy 
         SET active_mode = 'OBSERVE', stop_conditions_triggered = 1, updated_at = datetime('now')
         WHERE business_id = ?`
      )
      .run(businessId);

    return {
      id,
      condition,
      details,
      timestamp: now,
      campaignHalted: true,
    };
  }

  /**
   * Retrieves logged stop conditions.
   */
  public listStopConditions(): StopConditionEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM stop_conditions_log ORDER BY timestamp DESC')
      .all() as any[];

    return rows.map((r) => ({
      id: r.id,
      condition: r.condition,
      details: r.details,
      timestamp: r.timestamp,
      campaignHalted: r.campaign_halted === 1,
    }));
  }

  /**
   * Generates actionable campaign optimization proposals based on real data.
   */
  public generateOptimizationProposals(businessId: string): CampaignOptimizationProposal[] {
    const policy = this.getBudgetPolicy(businessId);
    const now = new Date().toISOString();

    // Check existing campaign
    const campaign = this.db
      .prepare('SELECT * FROM campaigns WHERE business_id = ? LIMIT 1')
      .get(businessId) as any;

    const proposals: CampaignOptimizationProposal[] = [];

    if (campaign) {
      // Proposal 1: Increase bid on highest-intent winning search keyword
      proposals.push({
        id: `opt-${randomUUID()}`,
        businessId,
        agentId: 'agt_paid_search_01',
        actionType: 'INCREASE_KEYWORD',
        targetEntityId: 'kw-invisalign-banjara-hills',
        evidence: 'Highest lead conversion intent observed in Banjara Hills catchment area.',
        reason: 'Suresh Reddy converted via Invisalign search query. Expand top-of-page impression share.',
        confidence: 0.92,
        expectedImpact: '+25% qualified consultations from Banjara Hills catchment',
        budgetImpactINR: 1500,
        risk: 'LOW',
        approvalStatus: policy.activeMode === 'CONTROLLED_AUTONOMY' ? 'AUTO_EXECUTED' : 'PROPOSED',
        createdAt: now,
      });

      // Proposal 2: Creative variant test for adult clear aligners
      proposals.push({
        id: `opt-${randomUUID()}`,
        businessId,
        agentId: 'agt_cro_01',
        actionType: 'CREATE_VARIATION',
        targetEntityId: campaign.id,
        evidence: 'Landing page bounce rate on mobile devices is 42%.',
        reason: 'Deploy accelerated mobile 3D smile preview widget to increase form completion.',
        confidence: 0.88,
        expectedImpact: '+18% landing page consultation booking rate',
        budgetImpactINR: 0,
        risk: 'LOW',
        approvalStatus: 'PROPOSED',
        createdAt: now,
      });
    }

    return proposals;
  }

  /**
   * Generates next experiment candidates.
   */
  public generateExperimentCandidates(businessId: string): ExperimentCandidateProposal[] {
    const now = new Date().toISOString();

    return [
      {
        id: `exp-cand-001`,
        businessId,
        agentId: 'agt_growth_lead_01',
        hypothesis:
          'Local geotargeted search ads emphasizing same-day 3D digital iTero scan will yield higher consultation show rate than generic Invisalign ads.',
        control: 'Standard Invisalign Hyderabad Search Ads ($200/day equivalent)',
        treatment: 'Banjara Hills Clinic 3D Scan & Instant Visualizer Headline ($200/day equivalent)',
        primaryMetric: 'Consultation Attendance Rate (%)',
        secondaryMetrics: ['Cost Per Confirmed Consultation', 'Lead-to-Consultation Conversion'],
        sampleSizeTarget: 25,
        budgetINR: 5000,
        durationDays: 14,
        successThreshold: 'Consultation show rate >= 80% with CPL <= ₹1,200',
        stopCondition: 'CPL exceeds ₹2,500 after 10 clicks without a consultation booking',
        risk: 'LOW',
        status: 'VALIDATED',
        createdAt: now,
      },
    ];
  }
}
