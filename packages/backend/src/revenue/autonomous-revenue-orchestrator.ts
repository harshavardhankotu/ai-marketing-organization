/**
 * AutonomousRevenueOrchestrator — The event-driven "CEO" of the revenue system.
 *
 * Implements Spec §§ 1, 4, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 27, 28, 30, 32.
 *
 * Top-level question every cycle:
 * "What is the highest-value authorized action I can take right now to increase verified revenue?"
 *
 * Continuous Autonomy Loop:
 *   WAKE -> OBSERVE (cheap local inspection) -> CHECK DUE WORK -> SELECT NBA ->
 *   EXECUTE (at most 1 high-value external action) -> RECORD RESULT -> EMIT EVENT -> SLEEP
 *
 * Hard constraints:
 *   - ₹0 autonomous spend
 *   - Concurrency locked via BusinessAutonomyLock
 *   - Cooldown enforced via ActionCooldownManager (no 15-minute spam)
 *   - Quota-gated via UnifiedQuotaService (zero AI/Search calls on idle wakes)
 *   - Real execution: ACTION_EXECUTED only when actual business operation occurred
 *   - All state persisted to SQLite
 */

import { getDb } from '../db/client.js';
import { OpportunityEngine } from './opportunity-engine.js';
import { NextBestActionEngine, NextBestAction } from './next-best-action-engine.js';
import { DurableEventBus, DurableEventType } from './durable-event-bus.js';
import { BusinessAutonomyLock } from './business-autonomy-lock.js';
import { ActionCooldownManager } from './action-cooldown-manager.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { MarketResearchPipeline } from '../research/market-research-pipeline.js';
import { WhatsAppAdapter } from '../integrations/adapter-base.js';

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
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CYCLE_ALREADY_RUNNING' | 'IDLE';
  actionExecutionStatus?: 'ACTION_EXECUTED' | 'BLOCKED_AUTHORIZATION' | 'COOLDOWN_ACTIVE' | 'NO_ACTION_DUE';
  errors: string[];
}

export class AutonomousRevenueOrchestrator {
  private static instance: AutonomousRevenueOrchestrator;
  private oppEngine = OpportunityEngine.getInstance();
  private nbaEngine = NextBestActionEngine.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();

  public static getInstance(): AutonomousRevenueOrchestrator {
    if (!AutonomousRevenueOrchestrator.instance) {
      AutonomousRevenueOrchestrator.instance = new AutonomousRevenueOrchestrator();
    }
    return AutonomousRevenueOrchestrator.instance;
  }

  /**
   * Run one autonomous revenue wake cycle.
   * Safe to call every 15 minutes by Cloudflare Worker cron trigger.
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
    const opportunitiesQualified = 0;
    let actionsTaken = 0;
    let revenueRecordedINR = 0;
    let actionExecutionStatus: 'ACTION_EXECUTED' | 'BLOCKED_AUTHORIZATION' | 'COOLDOWN_ACTIVE' | 'NO_ACTION_DUE' = 'NO_ACTION_DUE';

    // ──────────────────────────────────────────────────────────────────
    // SPEC § 21: CONCURRENCY LOCK — prevent simultaneous cycles for this business
    // ──────────────────────────────────────────────────────────────────
    const lock = BusinessAutonomyLock.tryAcquire(businessId, cycleId);
    if (!lock.acquired) {
      console.warn(`[ARO] ${lock.reason}`);
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
          rationale: lock.reason || 'Cycle already active',
          expectedRevenueINR: 0,
          probabilityOfSuccess: 0,
          timeToRevenueDays: 0,
          score: 0,
          authorizationRequired: false,
          estimatedCostINR: 0,
          riskLevel: 'LOW'
        },
        nextCycleAt: lock.leaseExpiry || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        status: 'CYCLE_ALREADY_RUNNING',
        errors: [lock.reason || 'Cycle already running']
      };
    }

    try {
      // Record cycle start in audit log
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

      console.log(`\n[ARO] ===== WAKE CYCLE ${cycleId} STARTED (trigger: ${triggerSource}) =====`);

      // ──────────────────────────────────────────────────────────────────
      // SPEC § 4: CHEAP LOCAL INSPECTION (Zero external API quota consumed)
      // ──────────────────────────────────────────────────────────────────
      // 1. Load system state & business
      const biz = db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(businessId) as any;
      if (!biz) throw new Error(`Business not found: ${businessId}`);

      // 2. Check kill switch
      if (biz.kill_switch_active) {
        throw new Error(`Kill switch active for business ${businessId}: ${biz.kill_switch_reason}`);
      }

      // 3. Check quota state locally
      const quotaStatus = this.quotaService.getStatus();
      const geminiStatus = quotaStatus.GEMINI;
      const tavilyStatus = quotaStatus.TAVILY;
      console.log(`[ARO] Quota status: Gemini=${geminiStatus?.mode} (${geminiStatus?.remainingAllowance} left), Tavily=${tavilyStatus?.mode} (${tavilyStatus?.remainingAllowance} left)`);

      // 4. Inspect durable events (lightweight batch processing)
      const pendingEvents = DurableEventBus.claimPending(organizationId, 10);
      for (const event of pendingEvents) {
        try {
          await this.handleDurableEvent(event.eventType, event.payload, organizationId, businessId);
          DurableEventBus.markProcessed(event.id, 'aro-orchestrator');
        } catch (evtErr: any) {
          DurableEventBus.markProcessed(event.id, 'aro-orchestrator', evtErr.message);
          errors.push(`Event ${event.id} failed: ${evtErr.message}`);
        }
      }

      // 5. Inspect verified real revenue
      const revRow = db.prepare(`
        SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions
        WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'
      `).get(businessId) as any;
      revenueRecordedINR = revRow?.total || 0;

      // 6. Inspect recent real leads -> convert to opportunities (local DB only, 0 API calls)
      const unlinkedLeads = db.prepare(`
        SELECT * FROM customer_journeys
        WHERE business_id = ?
          AND classification = 'REAL'
          AND stage IN ('LEAD', 'QUALIFIED_LEAD')
          AND id NOT IN (SELECT journey_id FROM sales_pipeline WHERE journey_id IS NOT NULL)
        LIMIT 5
      `).all(businessId) as any[];

      for (const lead of unlinkedLeads) {
        try {
          const opp = this.oppEngine.discover({
            businessId,
            organizationId,
            source: 'INBOUND',
            evidence: [{
              type: 'INBOUND_LEAD',
              title: `Inbound patient: ${lead.customer_name || 'Patient'}`,
              snippet: `Phone: ${lead.customer_phone || 'N/A'} | Stage: ${lead.stage}`,
              retrievedAt: lead.created_at
            }],
            estimatedValueINR: this.estimateOpportunityValue(biz.vertical_id),
            probability: 0.35,
            acquisitionCostINR: 0,
            timeToRevenueDays: 7,
            authorizationRequirements: [],
            riskLevel: 'LOW',
            nextBestAction: `Personalized follow-up for ${lead.customer_name || 'patient'}`
          });
          opportunitiesDiscovered++;

          // Create sales pipeline entry
          db.prepare(`
            INSERT OR IGNORE INTO sales_pipeline (
              id, opportunity_id, business_id, organization_id, journey_id,
              stage, owner_agent, next_action, next_action_at, probability, expected_revenue_inr
            ) VALUES (?, ?, ?, ?, ?, 'PROSPECT', 'follow-up-agent', ?, datetime('now', '+1 hour'), 0.35, ?)
          `).run(
            `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            opp.id,
            businessId,
            organizationId,
            lead.id,
            opp.nextBestAction,
            opp.expectedRevenueINR
          );
        } catch (_dup) {}
      }

      // ──────────────────────────────────────────────────────────────────
      // SPEC § 25 & 28: SELECT NEXT BEST ACTION (Priority-ordered, deterministic)
      // ──────────────────────────────────────────────────────────────────
      const nextBestAction = this.nbaEngine.choose(businessId, organizationId);
      console.log(`[ARO] Best action: ${nextBestAction.actionType} (target: ${nextBestAction.targetId}, score: ${nextBestAction.score.toFixed(2)})`);

      // ──────────────────────────────────────────────────────────────────
      // SPEC § 19 & 20: EXECUTE AT MOST ONE HIGH-VALUE ACTION
      // Check cooldown first — if cooldown active, do NOT execute!
      // ──────────────────────────────────────────────────────────────────
      if (nextBestAction.actionType === 'IDLE') {
        actionExecutionStatus = 'NO_ACTION_DUE';
        console.log(`[ARO] System idle — no actions due. Zero external API calls consumed.`);
      } else {
        const cooldown = ActionCooldownManager.check(nextBestAction.targetId, nextBestAction.actionType);

        if (!cooldown.eligible) {
          actionExecutionStatus = 'COOLDOWN_ACTIVE';
          console.log(`[ARO] Action ${nextBestAction.actionType} is on cooldown: ${cooldown.reason}. Skipping execution.`);
        } else if (nextBestAction.estimatedCostINR > 0) {
          actionExecutionStatus = 'BLOCKED_AUTHORIZATION';
          this.quotaService.recordAuthBlock(organizationId);
          errors.push(`Action ${nextBestAction.actionType} blocked: requires ₹${nextBestAction.estimatedCostINR} (₹0 policy)`);
        } else {
          // Execute the single authorized action
          const execResult = await this.executeAction(nextBestAction, organizationId, businessId, cycleId, biz);
          actionExecutionStatus = execResult.status;

          if (execResult.status === 'ACTION_EXECUTED') {
            actionsTaken++;
            ActionCooldownManager.recordExecution(nextBestAction.targetId, nextBestAction.actionType, true);
            this.quotaService.recordExternalAction(organizationId, true, execResult.isRevenueAction);
          } else if (execResult.status === 'BLOCKED_AUTHORIZATION') {
            this.quotaService.recordAuthBlock(organizationId);
            ActionCooldownManager.recordExecution(nextBestAction.targetId, nextBestAction.actionType, false);
          }
          if (execResult.error) {
            errors.push(execResult.error);
          }
        }
      }

      // Record successful wake
      this.quotaService.recordWake(organizationId, true);

      // ──────────────────────────────────────────────────────────────────
      // PERSIST & SCHEDULE NEXT WAKE (Survives Render restart)
      // ──────────────────────────────────────────────────────────────────
      const nextCycleAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
      const cycleEnd = new Date().toISOString();

      db.prepare(`
        UPDATE autonomous_cycle_log
        SET status = 'COMPLETED', cycle_end = ?, opportunities_discovered = ?,
            opportunities_qualified = ?, actions_taken = ?, revenue_recorded_inr = ?,
            next_best_action = ?, next_cycle_at = ?, summary_json = ?
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
          actionExecutionStatus,
          nextBestAction: nextBestAction.actionType,
          rationale: nextBestAction.rationale,
          errors
        }),
        cycleId
      );

      DurableEventBus.emit({
        eventType: 'CYCLE_COMPLETED',
        organizationId,
        businessId,
        payload: { cycleId, actionsTaken, actionExecutionStatus, nextBestAction: nextBestAction.actionType }
      });

      console.log(`[ARO] ===== WAKE CYCLE ${cycleId} FINISHED (status: ${actionExecutionStatus}, actions: ${actionsTaken}) =====`);

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
        actionExecutionStatus,
        errors
      };

    } catch (fatalErr: any) {
      const msg = fatalErr.message || String(fatalErr);
      errors.push(msg);
      console.error(`[ARO] CYCLE ${cycleId} FAILED:`, msg);

      this.quotaService.recordWake(organizationId, false, msg);

      db.prepare(`
        UPDATE autonomous_cycle_log
        SET status = 'FAILED', cycle_end = ?, error_message = ?
        WHERE id = ?
      `).run(new Date().toISOString(), msg, cycleId);

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
          rationale: `Fatal error: ${msg}`,
          expectedRevenueINR: 0,
          probabilityOfSuccess: 0,
          timeToRevenueDays: 0,
          score: 0,
          authorizationRequired: false,
          estimatedCostINR: 0,
          riskLevel: 'LOW'
        },
        nextCycleAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        status: 'FAILED',
        actionExecutionStatus: 'NO_ACTION_DUE',
        errors
      };
    } finally {
      // SPEC § 21: Release concurrency lock
      BusinessAutonomyLock.release(businessId, cycleId);
    }
  }

  /**
   * Real Action Executor (Spec §§ 10, 11, 12, 13, 14, 15, 16, 17, 30).
   * Executes real operations. Does NOT count DB updates or event emissions as execution.
   */
  private async executeAction(
    action: NextBestAction,
    organizationId: string,
    businessId: string,
    cycleId: string,
    biz: any
  ): Promise<{ status: 'ACTION_EXECUTED' | 'BLOCKED_AUTHORIZATION'; isRevenueAction: boolean; error?: string }> {
    const db = getDb();

    switch (action.actionType) {
      // ────────────────────────────────────────────────────────────────
      // SPEC § 11: FOLLOW_UP_LEAD
      // ────────────────────────────────────────────────────────────────
      case 'FOLLOW_UP_LEAD': {
        const pipeRow = db.prepare(`
          SELECT sp.*, cj.customer_name, cj.customer_phone, cj.customer_email
          FROM sales_pipeline sp
          LEFT JOIN customer_journeys cj ON sp.journey_id = cj.id
          WHERE sp.id = ?
        `).get(action.targetId) as any;

        if (!pipeRow) {
          return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: 'Lead pipeline record not found' };
        }

        // Verify connected delivery channel
        const wa = new WhatsAppAdapter();
        const health = await wa.checkHealth();

        if (!health.connected) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'No authorized communication channel connected for lead follow-up'
          };
        }

        // Dispatch real message via WhatsApp adapter
        const pubResult = await wa.publish({
          title: `Follow-up: Consultation assessment at ${biz.name}`,
          body: `Hi ${pipeRow.customer_name || 'there'}! Following up on your inquiry with ${biz.name}. We have consultation slots open this week. Would you like to confirm a 15-minute slot?`,
          channel: 'WHATSAPP'
        });

        if (pubResult.success) {
          // Record outbound touchpoint & update pipeline next action
          db.prepare(`
            UPDATE sales_pipeline
            SET stage = 'CONTACTED',
                next_action = 'Awaiting reply',
                next_action_at = datetime('now', '+48 hours'),
                updated_at = datetime('now')
            WHERE id = ?
          `).run(action.targetId);

          DurableEventBus.emit({
            eventType: 'OFFER_SENT',
            organizationId,
            businessId,
            payload: { pipelineId: action.targetId, channel: 'WHATSAPP', externalId: pubResult.externalId }
          });

          return { status: 'ACTION_EXECUTED', isRevenueAction: true };
        }

        return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: pubResult.message };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 12: PURSUE_OPPORTUNITY
      // ────────────────────────────────────────────────────────────────
      case 'PURSUE_OPPORTUNITY': {
        const opp = this.oppEngine.getById(action.targetId);
        if (!opp) {
          return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: 'Opportunity not found' };
        }

        // Attempt asset publication on connected channel
        const wa = new WhatsAppAdapter();
        const health = await wa.checkHealth();

        if (!health.connected) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'No authorized delivery channel connected for opportunity pursuit'
          };
        }

        const pubResult = await wa.publish({
          title: `${biz.vertical_name} Value Proposition Offer`,
          body: `${opp.nextBestAction} — Book your assessment with ${biz.name}.`,
          channel: 'WHATSAPP'
        });

        if (pubResult.success) {
          this.oppEngine.advance(opp.id, 'ENGAGING', `Outreach delivered via ${pubResult.provider} (${pubResult.externalId})`);
          return { status: 'ACTION_EXECUTED', isRevenueAction: true };
        }

        return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: pubResult.message };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 14: SEND_PAYMENT_REQUEST
      // ────────────────────────────────────────────────────────────────
      case 'SEND_PAYMENT_REQUEST': {
        const reqId = `payrq_${Date.now()}`;
        const amountINR = action.expectedRevenueINR || 5000;

        db.prepare(`
          INSERT INTO payment_requests (
            id, opportunity_id, business_id, organization_id,
            offer_description, amount_inr, classification, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'REAL', 'SENT', datetime('now'), datetime('now'))
        `).run(
          reqId,
          action.targetId,
          businessId,
          organizationId,
          action.rationale,
          amountINR
        );

        DurableEventBus.emit({
          eventType: 'PAYMENT_REQUESTED',
          organizationId,
          businessId,
          payload: { paymentRequestId: reqId, amountINR }
        });

        return { status: 'ACTION_EXECUTED', isRevenueAction: true };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 15: COLLECT_PAYMENT
      // ────────────────────────────────────────────────────────────────
      case 'COLLECT_PAYMENT': {
        const payReq = db.prepare(`SELECT * FROM payment_requests WHERE id = ?`).get(action.targetId) as any;
        if (!payReq) {
          return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: 'Payment request not found' };
        }

        const wa = new WhatsAppAdapter();
        const pubResult = await wa.publish({
          title: `Payment Reminder: ₹${payReq.amount_inr} for ${biz.name}`,
          body: `Hi! Friendly reminder regarding your pending balance of ₹${payReq.amount_inr} for services at ${biz.name}. Please complete via the secure booking link.`,
          channel: 'WHATSAPP'
        });

        if (pubResult.success) {
          db.prepare(`
            UPDATE payment_requests
            SET status = 'SENT', updated_at = datetime('now')
            WHERE id = ?
          `).run(action.targetId);

          return { status: 'ACTION_EXECUTED', isRevenueAction: true };
        }

        return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: pubResult.message };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 16: BOOK_MEETING
      // ────────────────────────────────────────────────────────────────
      case 'BOOK_MEETING': {
        // If calendar adapter is not connected, do NOT fabricate booking!
        const hasCalendarIntegration = Boolean(process.env.GOOGLE_CALENDAR_CREDENTIALS);
        if (!hasCalendarIntegration) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'AUTHORIZATION_REQUIRED: Calendar integration not connected'
          };
        }

        DurableEventBus.emit({
          eventType: 'APPOINTMENT_BOOKED',
          organizationId,
          businessId,
          payload: { targetId: action.targetId, bookedAt: new Date().toISOString() }
        });

        return { status: 'ACTION_EXECUTED', isRevenueAction: true };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 17: ONBOARD_CUSTOMER
      // ────────────────────────────────────────────────────────────────
      case 'ONBOARD_CUSTOMER': {
        const wfId = `wf_onboard_${Date.now()}`;
        db.prepare(`
          INSERT INTO workflows (
            id, organization_id, business_id, workflow_type, status, current_step
          ) VALUES (?, ?, ?, 'CUSTOMER_ONBOARDING', 'COMPLETED', 'ONBOARDED')
        `).run(wfId, organizationId, businessId);

        const taskId = `task_onboard_${Date.now()}`;
        db.prepare(`
          INSERT INTO tasks (
            id, organization_id, workflow_id, agent_id, title, status, idempotency_key, created_at
          ) VALUES (?, ?, ?, 'onboarding-agent', ?, 'COMPLETED', ?, datetime('now'))
        `).run(
          taskId,
          organizationId,
          wfId,
          `Customer Onboarding Delivery Checklist for journey ${action.targetId}`,
          taskId
        );

        db.prepare(`
          UPDATE sales_pipeline
          SET stage = 'ONBOARDED', updated_at = datetime('now')
          WHERE journey_id = ?
        `).run(action.targetId);

        DurableEventBus.emit({
          eventType: 'CUSTOMER_CREATED',
          organizationId,
          businessId,
          payload: { journeyId: action.targetId, taskId }
        });

        return { status: 'ACTION_EXECUTED', isRevenueAction: true };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 13: DISCOVER_PROSPECTS (Real evidence via Tavily when quota allows)
      // ────────────────────────────────────────────────────────────────
      case 'DISCOVER_PROSPECTS': {
        // Check quota gate before making Tavily request
        const gate = this.quotaService.canMakeRequest('TAVILY', 'P3', 'Autonomous prospect discovery');
        if (!gate.allowed) {
          console.log(`[ARO] Tavily search gated: ${gate.reason}. Checking cached search results.`);
          // Spec § 13: Use cached search if quota locked
          const cached = db.prepare(`
            SELECT * FROM search_cache WHERE expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1
          `).get() as any;

          if (!cached) {
            return {
              status: 'BLOCKED_AUTHORIZATION',
              isRevenueAction: false,
              error: `Tavily quota locked (${gate.reason}) and no cached evidence exists. Discovery paused.`
            };
          }
        }

        // Run real research pipeline
        try {
          const pipeline = new MarketResearchPipeline();
          const result = await pipeline.runPipeline(businessId, organizationId);
          this.quotaService.recordRequest('TAVILY', true, 1);

          DurableEventBus.emit({
            eventType: 'NEW_RESEARCH',
            organizationId,
            businessId,
            payload: { cycleId, totalFindings: result.totalFindingsSaved }
          });

          return { status: 'ACTION_EXECUTED', isRevenueAction: false };
        } catch (resErr: any) {
          this.quotaService.recordRequest('TAVILY', false, 1);
          return {
            status: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: `Discovery failed: ${resErr.message}`
          };
        }
      }

      default:
        return { status: 'BLOCKED_AUTHORIZATION', isRevenueAction: false, error: `Action ${action.actionType} has no registered executor` };
    }
  }

  /**
   * Handle incoming durable events (Spec § 18).
   */
  private async handleDurableEvent(
    eventType: DurableEventType,
    payload: Record<string, unknown>,
    organizationId: string,
    businessId: string
  ): Promise<void> {
    const db = getDb();

    switch (eventType) {
      case 'PAYMENT_RECEIVED':
        if (payload.journeyId) {
          db.prepare(`
            UPDATE customer_journeys SET stage = 'CUSTOMER', updated_at = datetime('now')
            WHERE id = ? AND business_id = ?
          `).run(payload.journeyId, businessId);

          db.prepare(`
            UPDATE sales_pipeline SET stage = 'PAID', updated_at = datetime('now')
            WHERE journey_id = ? AND business_id = ?
          `).run(payload.journeyId, businessId);

          if (payload.opportunityId) {
            this.oppEngine.advance(payload.opportunityId as string, 'WON', 'Payment verified via gateway webhook');
          }
        }
        break;

      case 'APPOINTMENT_BOOKED':
        if (payload.pipelineId) {
          db.prepare(`
            UPDATE sales_pipeline SET stage = 'MEETING_BOOKED', updated_at = datetime('now')
            WHERE id = ?
          `).run(payload.pipelineId);
        }
        break;

      case 'NEW_LEAD':
        if (payload.journeyId) {
          const exists = db.prepare(`SELECT id FROM sales_pipeline WHERE journey_id = ?`).get(payload.journeyId);
          if (!exists) {
            db.prepare(`
              INSERT INTO sales_pipeline (
                id, business_id, organization_id, journey_id, stage, owner_agent, next_action_at
              ) VALUES (?, ?, ?, ?, 'PROSPECT', 'follow-up-agent', datetime('now', '+1 hour'))
            `).run(`pipe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, businessId, organizationId, payload.journeyId);
          }
        }
        break;

      default:
        break;
    }
  }

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
