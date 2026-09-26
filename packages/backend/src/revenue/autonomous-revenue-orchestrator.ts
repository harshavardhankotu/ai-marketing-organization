/**
 * AutonomousRevenueOrchestrator — the event-driven "CEO" of the system.
 *
 * Primary question every cycle: "What is the highest-value authorized action
 * I can take right now to increase verified revenue?"
 *
 * 13-step observe/inspect/select/execute/record loop (spec item 2):
 *   1.  Observe (load state, check kill switch)
 *   2.  Discover Opportunities (OpportunityEngine from research + inbound signals)
 *   3.  Inspect Pipeline (sales_pipeline — overdue follow-ups, stalled leads)
 *   4.  Inspect Revenue (verified transactions, payment requests)
 *   5.  Inspect Research (fresh Tavily findings available?)
 *   6.  Generate Next Actions (NextBestActionEngine.rankAll)
 *   7.  Choose Highest-Value Authorized Action (NextBestActionEngine.choose)
 *   8.  Execute (dispatch to appropriate agent/engine)
 *   9.  Observe Result (record outcome)
 *   10. Process Events (DurableEventBus.claimPending → route to handlers)
 *   11. Reconcile Revenue (verify real transactions, update pipeline stages)
 *   12. Learn (if real experiment data → evolve strategy)
 *   13. Schedule next cycle / emit CYCLE_COMPLETED
 *
 * Hard constraints:
 *   - ₹0 autonomous spend — hard-deny any action with estimatedCostINR > 0 unless
 *     explicitly pre-authorized via the approval manager
 *   - No simulation data in real loops
 *   - Every action is audit-logged in autonomous_cycle_log
 */

import { getDb } from '../db/client.js';
import { OpportunityEngine } from './opportunity-engine.js';
import { NextBestActionEngine, NextBestAction } from './next-best-action-engine.js';
import { DurableEventBus, DurableEventType } from './durable-event-bus.js';
import { MarketResearchPipeline } from '../research/market-research-pipeline.js';

export interface OrchestratorCycleResult {
  cycleId: string;
  organizationId: string;
  businessId: string;
  opportunitiesDiscovered: number;
  opportunitiesQualified: number;
  actionsTaken: number;
  revenueRecordedINR: number;
  nextBestAction: NextBestAction;
  nextCycleAt: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  errors: string[];
}

export class AutonomousRevenueOrchestrator {
  private static instance: AutonomousRevenueOrchestrator;
  private oppEngine = OpportunityEngine.getInstance();
  private nbaEngine = NextBestActionEngine.getInstance();

  public static getInstance(): AutonomousRevenueOrchestrator {
    if (!AutonomousRevenueOrchestrator.instance) {
      AutonomousRevenueOrchestrator.instance = new AutonomousRevenueOrchestrator();
    }
    return AutonomousRevenueOrchestrator.instance;
  }

  /**
   * Execute one full autonomous revenue cycle.
   * Safe to call repeatedly — every action is idempotent or guarded.
   */
  public async runCycle(
    organizationId: string,
    businessId: string,
    triggerSource: 'SCHEDULER' | 'EVENT' | 'MANUAL' | 'CLOUDFLARE_CRON' = 'MANUAL'
  ): Promise<OrchestratorCycleResult> {
    const db = getDb();
    const cycleId = `cycle_${Date.now()}`;
    const cycleStart = new Date().toISOString();
    const errors: string[] = [];
    let opportunitiesDiscovered = 0;
    let opportunitiesQualified = 0;
    let actionsTaken = 0;
    let revenueRecordedINR = 0;

    // Log cycle start
    db.prepare(`
      INSERT INTO autonomous_cycle_log (
        id, organization_id, business_id, trigger_source, cycle_start, status
      ) VALUES (?, ?, ?, ?, ?, 'RUNNING')
    `).run(cycleId, organizationId, businessId, triggerSource, cycleStart);

    DurableEventBus.emit({
      eventType: 'CYCLE_STARTED',
      organizationId,
      businessId,
      payload: { cycleId, triggerSource }
    });

    console.log(`\n[ARO] ===== CYCLE ${cycleId} STARTED (trigger: ${triggerSource}) =====`);

    try {
      // ──────────────────────────────────────────────────────────────────
      // STEP 1: OBSERVE — check kill switch, load business state
      // ──────────────────────────────────────────────────────────────────
      const biz = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(businessId) as any;
      if (!biz) throw new Error(`Business not found: ${businessId}`);
      if (biz.kill_switch_active) {
        throw new Error(`Kill switch active for business ${businessId}: ${biz.kill_switch_reason}`);
      }

      console.log(`[ARO] Step 1: Observing ${biz.name} (${biz.vertical_name}, ${biz.city})`);

      // ──────────────────────────────────────────────────────────────────
      // STEP 2: DISCOVER OPPORTUNITIES — from research findings + inbound leads
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 2: Discovering opportunities from research findings...`);
      const freshFindings = db.prepare(`
        SELECT * FROM research_findings
        WHERE business_id = ?
          AND data_classification = 'REAL_EXTERNAL_EVIDENCE'
          AND created_at > datetime('now', '-48 hours')
        ORDER BY created_at DESC
        LIMIT 20
      `).all(businessId) as any[];

      for (const finding of freshFindings) {
        try {
          // Convert real research finding into a qualified opportunity
          const opp = this.oppEngine.discover({
            businessId,
            organizationId,
            source: 'ORGANIC_SEARCH',
            evidence: [{
              type: 'TAVILY_RESULT',
              url: finding.source_reference || finding.source_url,
              title: finding.finding_summary?.substring(0, 100),
              snippet: finding.finding_summary?.substring(0, 300),
              retrievedAt: finding.retrieved_at || finding.created_at
            }],
            estimatedValueINR: this.estimateOpportunityValue(biz.vertical_id),
            probability: 0.15,
            acquisitionCostINR: 0, // ₹0 spend policy
            timeToRevenueDays: 45,
            authorizationRequirements: [],
            riskLevel: 'LOW',
            nextBestAction: `Follow up on research signal: ${finding.finding_summary?.substring(0, 80)}...`
          });
          opportunitiesDiscovered++;
          console.log(`[ARO] Step 2: Discovered opportunity ${opp.id} from research finding`);
        } catch (_dupErr) {
          // Opportunity from this finding already exists — skip
        }
      }

      // Check for recent inbound leads not yet in opportunities
      const recentLeads = db.prepare(`
        SELECT * FROM customer_journeys
        WHERE business_id = ?
          AND classification = 'REAL'
          AND stage IN ('LEAD', 'QUALIFIED_LEAD')
          AND created_at > datetime('now', '-24 hours')
        LIMIT 10
      `).all(businessId) as any[];

      for (const lead of recentLeads) {
        try {
          this.oppEngine.discover({
            businessId,
            organizationId,
            source: 'INBOUND',
            evidence: [{
              type: 'INBOUND_LEAD',
              title: `Inbound lead: ${lead.customer_name || 'Unknown'}`,
              snippet: `Phone: ${lead.customer_phone || 'N/A'} | Stage: ${lead.stage}`,
              retrievedAt: lead.created_at
            }],
            estimatedValueINR: this.estimateOpportunityValue(biz.vertical_id),
            probability: 0.25,
            acquisitionCostINR: 0,
            timeToRevenueDays: 14,
            authorizationRequirements: [],
            riskLevel: 'LOW',
            nextBestAction: `Contact ${lead.customer_name || 'lead'} at ${lead.customer_phone || 'unknown number'}`
          });
          opportunitiesDiscovered++;
        } catch (_dupErr) {}
      }

      // ──────────────────────────────────────────────────────────────────
      // STEP 3: INSPECT PIPELINE — find overdue actions
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 3: Inspecting sales pipeline...`);
      const overdueCount = (db.prepare(`
        SELECT COUNT(*) as cnt FROM sales_pipeline
        WHERE business_id = ? AND stage NOT IN ('PAID','ONBOARDED','RETAINED','LOST')
          AND (next_action_at IS NULL OR next_action_at <= datetime('now'))
      `).get(businessId) as any)?.cnt || 0;
      console.log(`[ARO] Step 3: ${overdueCount} overdue pipeline items`);

      // ──────────────────────────────────────────────────────────────────
      // STEP 4: INSPECT REVENUE — verified real transactions
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 4: Inspecting revenue...`);
      const revenueRow = db.prepare(`
        SELECT SUM(amount_inr) as total FROM transactions
        WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'
      `).get(businessId) as any;
      revenueRecordedINR = revenueRow?.total || 0;
      console.log(`[ARO] Step 4: Verified real revenue = ₹${revenueRecordedINR.toFixed(2)}`);

      // ──────────────────────────────────────────────────────────────────
      // STEP 5: INSPECT RESEARCH — trigger Tavily if no fresh findings
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 5: Checking research freshness...`);
      const researchAge = db.prepare(`
        SELECT MAX(created_at) as last_run FROM research_findings WHERE business_id = ?
      `).get(businessId) as any;
      const lastResearch = researchAge?.last_run ? new Date(researchAge.last_run) : null;
      const hoursOld = lastResearch ? (Date.now() - lastResearch.getTime()) / (1000 * 60 * 60) : Infinity;

      if (hoursOld > 24) {
        console.log(`[ARO] Step 5: Research is ${hoursOld.toFixed(0)}h old — triggering Tavily research...`);
        try {
          const pipeline = new MarketResearchPipeline();
          await pipeline.runPipeline(businessId, organizationId);
          console.log(`[ARO] Step 5: Research pipeline completed`);

          DurableEventBus.emit({
            eventType: 'NEW_RESEARCH',
            organizationId,
            businessId,
            payload: { cycleId, triggeredBy: 'ARO_CYCLE' }
          });
        } catch (resErr: any) {
          const msg = `Research pipeline failed (no API key?): ${resErr.message}`;
          errors.push(msg);
          console.warn(`[ARO] Step 5: ${msg}`);
        }
      } else {
        console.log(`[ARO] Step 5: Research is ${hoursOld.toFixed(1)}h old — still fresh`);
      }

      // ──────────────────────────────────────────────────────────────────
      // STEP 6 + 7: GENERATE AND CHOOSE NEXT BEST ACTION
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 6-7: Computing next best action...`);
      const nextBestAction = this.nbaEngine.choose(businessId, organizationId);
      console.log(`[ARO] Step 7: Next best action = ${nextBestAction.actionType} | score=${nextBestAction.score.toFixed(3)}`);

      // ──────────────────────────────────────────────────────────────────
      // STEP 8: EXECUTE — dispatch authorized zero-cost actions
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 8: Executing ${nextBestAction.actionType}...`);

      if (nextBestAction.estimatedCostINR > 0) {
        // Hard policy: ₹0 spend budget — do not execute any paid action autonomously
        errors.push(`Action ${nextBestAction.actionType} requires ₹${nextBestAction.estimatedCostINR} spend — BLOCKED by ₹0 budget policy`);
        console.warn(`[ARO] Step 8: BLOCKED — action requires spend`);
      } else if (nextBestAction.authorizationRequired) {
        // Requires human approval — emit event and wait
        DurableEventBus.emit({
          eventType: 'OFFER_SENT',
          organizationId,
          businessId,
          payload: {
            cycleId,
            actionType: nextBestAction.actionType,
            targetId: nextBestAction.targetId,
            rationale: nextBestAction.rationale,
            awaitingAuthorization: true
          }
        });
        console.log(`[ARO] Step 8: Action requires authorization — emitted OFFER_SENT for human review`);
      } else {
        // Execute the zero-cost authorized action
        await this.executeAction(nextBestAction, organizationId, businessId, cycleId);
        actionsTaken++;
      }

      // ──────────────────────────────────────────────────────────────────
      // STEP 9 + 10: OBSERVE RESULT + PROCESS EVENTS
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 9-10: Processing pending events...`);
      const pendingEvents = DurableEventBus.claimPending(organizationId, 20);
      for (const event of pendingEvents) {
        try {
          await this.handleEvent(event.eventType, event.payload, organizationId, businessId);
          DurableEventBus.markProcessed(event.id, 'aro-orchestrator');
        } catch (evtErr: any) {
          DurableEventBus.markProcessed(event.id, 'aro-orchestrator', evtErr.message);
          errors.push(`Event ${event.id} (${event.eventType}) failed: ${evtErr.message}`);
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // STEP 11: RECONCILE REVENUE
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 11: Reconciling revenue...`);
      // Update pipeline stages for journeys that became PAID customers
      db.prepare(`
        UPDATE sales_pipeline
        SET stage = 'PAID', updated_at = datetime('now')
        WHERE business_id = ?
          AND journey_id IN (
            SELECT id FROM customer_journeys WHERE business_id = ? AND stage = 'CUSTOMER'
          )
          AND stage = 'PAYMENT_PENDING'
      `).run(businessId, businessId);

      // ──────────────────────────────────────────────────────────────────
      // STEP 12: LEARN — only from real experiment results
      // ──────────────────────────────────────────────────────────────────
      console.log(`[ARO] Step 12: Checking for experiment conclusions...`);
      const concludedExps = db.prepare(`
        SELECT * FROM experiments
        WHERE business_id = ?
          AND status = 'CONCLUDED'
          AND data_classification = 'REAL_WORLD_LEARNING'
        ORDER BY updated_at DESC
        LIMIT 3
      `).all(businessId) as any[];

      for (const exp of concludedExps) {
        DurableEventBus.emit({
          eventType: 'EXPERIMENT_RESULT',
          organizationId,
          businessId,
          payload: {
            experimentId: exp.id,
            result: exp.result || 'INCONCLUSIVE',
            cycleId
          }
        });
        console.log(`[ARO] Step 12: Emitted EXPERIMENT_RESULT for ${exp.id}`);
      }

      // ──────────────────────────────────────────────────────────────────
      // STEP 13: SCHEDULE NEXT CYCLE
      // ──────────────────────────────────────────────────────────────────
      const nextCycleAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4 hours
      const cycleEnd = new Date().toISOString();

      db.prepare(`
        UPDATE autonomous_cycle_log
        SET status = 'COMPLETED', cycle_end = ?, opportunities_discovered = ?,
            opportunities_qualified = ?, actions_taken = ?, revenue_recorded_inr = ?,
            next_best_action = ?, next_cycle_at = ?,
            summary_json = ?
        WHERE id = ?
      `).run(
        cycleEnd,
        opportunitiesDiscovered,
        opportunitiesQualified,
        actionsTaken,
        revenueRecordedINR,
        nextBestAction.actionType,
        nextCycleAt,
        JSON.stringify({
          errors,
          nextBestAction: nextBestAction.actionType,
          rationale: nextBestAction.rationale
        }),
        cycleId
      );

      DurableEventBus.emit({
        eventType: 'CYCLE_COMPLETED',
        organizationId,
        businessId,
        payload: {
          cycleId,
          status: 'COMPLETED',
          actionsTaken,
          revenueRecordedINR,
          nextBestAction: nextBestAction.actionType
        }
      });

      console.log(`[ARO] ===== CYCLE ${cycleId} COMPLETED =====`);
      console.log(`[ARO]   Opportunities discovered: ${opportunitiesDiscovered}`);
      console.log(`[ARO]   Actions taken: ${actionsTaken}`);
      console.log(`[ARO]   Verified revenue: ₹${revenueRecordedINR.toFixed(2)}`);
      console.log(`[ARO]   Next best action: ${nextBestAction.actionType}`);
      console.log(`[ARO]   Next cycle at: ${nextCycleAt}`);

      return {
        cycleId,
        organizationId,
        businessId,
        opportunitiesDiscovered,
        opportunitiesQualified,
        actionsTaken,
        revenueRecordedINR,
        nextBestAction,
        nextCycleAt,
        status: errors.length === 0 ? 'COMPLETED' : 'PARTIAL',
        errors
      };

    } catch (fatalErr: any) {
      const msg = fatalErr.message || String(fatalErr);
      errors.push(msg);
      console.error(`[ARO] CYCLE ${cycleId} FAILED:`, msg);

      db.prepare(`
        UPDATE autonomous_cycle_log
        SET status = 'FAILED', cycle_end = ?, error_message = ?
        WHERE id = ?
      `).run(new Date().toISOString(), msg, cycleId);

      // Return a minimal result with IDLE action
      return {
        cycleId,
        organizationId,
        businessId,
        opportunitiesDiscovered: 0,
        opportunitiesQualified: 0,
        actionsTaken: 0,
        revenueRecordedINR: 0,
        nextBestAction: {
          actionType: 'IDLE',
          targetId: businessId,
          targetType: 'NONE',
          ownerAgent: 'orchestrator',
          rationale: `Cycle failed: ${msg}`,
          expectedRevenueINR: 0,
          probabilityOfSuccess: 0,
          timeToRevenueDays: 0,
          score: 0,
          authorizationRequired: false,
          estimatedCostINR: 0,
          riskLevel: 'LOW'
        },
        nextCycleAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // retry in 1h
        status: 'FAILED',
        errors
      };
    }
  }

  /**
   * Execute a specific zero-cost authorized action.
   */
  private async executeAction(
    action: NextBestAction,
    organizationId: string,
    businessId: string,
    cycleId: string
  ): Promise<void> {
    console.log(`[ARO] Executing: ${action.actionType} → target=${action.targetId}`);

    switch (action.actionType) {
      case 'PURSUE_OPPORTUNITY':
        // Advance opportunity to ENGAGING
        this.oppEngine.advance(action.targetId, 'ENGAGING', 'ARO cycle — pursuing opportunity');
        DurableEventBus.emit({
          eventType: 'OFFER_SENT',
          organizationId,
          businessId,
          payload: { opportunityId: action.targetId, cycleId, rationale: action.rationale }
        });
        break;

      case 'FOLLOW_UP_LEAD':
        // Update pipeline next_action_at to 24h from now (prevents repeated follow-up spam)
        getDb().prepare(`
          UPDATE sales_pipeline
          SET next_action_at = datetime('now', '+24 hours'),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(action.targetId);
        DurableEventBus.emit({
          eventType: 'LEAD_NO_RESPONSE',
          organizationId,
          businessId,
          payload: { pipelineId: action.targetId, cycleId }
        });
        break;

      case 'DISCOVER_PROSPECTS':
        // Trigger a fresh research cycle
        DurableEventBus.emit({
          eventType: 'NEW_RESEARCH',
          organizationId,
          businessId,
          payload: { trigger: 'DISCOVER_PROSPECTS', cycleId }
        });
        break;

      case 'IDLE':
        console.log(`[ARO] IDLE — no authorized actions available`);
        break;

      default:
        console.log(`[ARO] Action ${action.actionType} deferred — requires agent implementation`);
    }
  }

  /**
   * Handle incoming durable events — route to appropriate handlers.
   */
  private async handleEvent(
    eventType: DurableEventType,
    payload: Record<string, unknown>,
    organizationId: string,
    businessId: string
  ): Promise<void> {
    switch (eventType) {
      case 'PAYMENT_RECEIVED':
        // Mark the associated journey as CUSTOMER
        if (payload.journeyId) {
          getDb().prepare(`
            UPDATE customer_journeys SET stage = 'CUSTOMER', updated_at = datetime('now')
            WHERE id = ? AND business_id = ?
          `).run(payload.journeyId, businessId);

          // Mark the opportunity as WON if we have one
          if (payload.opportunityId) {
            this.oppEngine.advance(payload.opportunityId as string, 'WON', 'Payment verified');
          }
        }
        break;

      case 'APPOINTMENT_BOOKED':
        // Advance pipeline to MEETING_BOOKED
        if (payload.pipelineId) {
          getDb().prepare(`
            UPDATE sales_pipeline SET stage = 'MEETING_BOOKED', updated_at = datetime('now')
            WHERE id = ?
          `).run(payload.pipelineId);
        }
        break;

      case 'NEW_LEAD':
        // Create a sales pipeline entry for the new lead
        if (payload.journeyId) {
          const db = getDb();
          const existing = db.prepare(`SELECT id FROM sales_pipeline WHERE journey_id = ?`).get(payload.journeyId);
          if (!existing) {
            const pipeId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            db.prepare(`
              INSERT INTO sales_pipeline (id, business_id, organization_id, journey_id, stage, owner_agent, next_action_at)
              VALUES (?, ?, ?, ?, 'PROSPECT', 'follow-up-agent', datetime('now', '+24 hours'))
            `).run(pipeId, businessId, organizationId, payload.journeyId);
          }
        }
        break;

      default:
        // Other events are logged but not actively handled yet
        break;
    }
  }

  /**
   * Estimate revenue opportunity value by vertical (conservative).
   */
  private estimateOpportunityValue(verticalId: string): number {
    const valueMap: Record<string, number> = {
      'dental': 15000,
      'dental_clinic': 15000,
      'salon': 3000,
      'beauty_salon': 3000,
      'clinic': 8000,
      'medical_clinic': 8000,
      'tuition': 5000,
      'coaching': 5000,
      'fitness': 4000,
      'gym': 4000,
      'legal': 25000,
      'home_services': 5000
    };
    return valueMap[verticalId?.toLowerCase()] || 8000;
  }
}
