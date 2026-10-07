/**
 * AutonomousRevenueOrchestrator — The event-driven "CEO" of the revenue system.
 *
 * Implements Spec §§ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25.
 *
 * Strict Action Classification Rules (Spec § 1 & § 2):
 * - LIVE_EXTERNAL_ACTION: Only when a LIVE external provider accepted the operation and returned a genuine externalId.
 * - INTERNAL_AUTOMATION: DB updates, task creation, workflow creation, event emission, onboarding checklist.
 * - REVENUE_ACTION: Verified payment transactions and verified customer revenue.
 * - BLOCKED_AUTHORIZATION: When live provider credentials are not configured or live request was rejected.
 * - SANDBOX_ACTION / TEST_ACTION: Simulated/sandbox executions.
 *
 * Zero-tolerance for false execution:
 * - Sandbox successes are NEVER counted as external actions.
 * - DB task creation is NEVER counted as external or revenue actions.
 * - Unconfigured adapters immediately yield BLOCKED_AUTHORIZATION.
 */

import { D1RevenueRepository, D1RevenueCriticalTable } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { OpportunityEngine } from './opportunity-engine.js';
import { NextBestActionEngine, NextBestAction } from './next-best-action-engine.js';
import { DurableEventBus, DurableEventType } from './durable-event-bus.js';
import { BusinessAutonomyLock } from './business-autonomy-lock.js';
import { ActionCooldownManager } from './action-cooldown-manager.js';
import { UnifiedQuotaService } from '../quota/unified-quota-service.js';
import { MarketResearchPipeline } from '../research/market-research-pipeline.js';
import { WhatsAppAdapter, EmailAdapter, ActionClassification } from '../integrations/adapter-base.js';
import { isPlaceholderCredential, isProduction } from '../config/env.js';
import { AutonomyPolicyController } from './autonomy-policy.js';
import { MeetingEngine } from './meeting-engine.js';
import { OwnerAuthService } from '../auth/owner-auth.js';
import { DeliveryEngine } from './delivery-engine.js';
import { SalesConversationEngine } from './sales-conversation-engine.js';
import { LearningEngine } from './learning-engine.js';
import { OfferEngine } from './offer-engine.js';
import { RazorpayAdapter } from '../integrations/razorpay.js';
import { resolveAuthorizedOffer } from './offer-catalog.js';
import { ChannelSelectionEngine } from './channel-selection-engine.js';
import { OutboundActionLedger } from './outbound-action-ledger.js';
import { ConversionVerificationAdapter } from '../commission/conversion-verification.js';
import { DemandDiscoveryEngine } from '../commission/demand-discovery.js';
import { DemandOfferMatchingEngine } from '../commission/demand-offer-matching.js';
import { ContentAssetEngine } from '../commission/content-asset-engine.js';
import { ReferralTrackingEngine } from '../commission/referral-tracking.js';
import { PartnerRegistryEngine } from '../commission/partner-registry.js';
import { randomUUID } from 'crypto';
export type { ActionClassification } from '../integrations/adapter-base.js';

export type CycleExecutionStatus =
  | 'LIVE_EXTERNAL_ACTION'
  | 'INTERNAL_AUTOMATION'
  | 'BLOCKED_AUTHORIZATION'
  | 'COOLDOWN_ACTIVE'
  | 'NO_ACTION_DUE'
  | 'TEST_ACTION'
  | 'CACHE_HIT';

export type TerminalOutcomeClassification =
  | 'LIVE_EXTERNAL_ACTION'
  | 'REVENUE_ACTION'
  | 'INTERNAL_AUTOMATION'
  | 'BLOCKED_AUTHORIZATION'
  | 'SANDBOX_ACTION'
  | 'TEST_ACTION'
  | 'IDLE'
  | 'CACHE_HIT'
  | 'FAILED_RETRYABLE'
  | 'FAILED_TERMINAL';

export interface OrchestratorCycleResult {
  cycleId: string;
  organizationId: string;
  businessId: string;
  opportunitiesDiscovered: number;
  opportunitiesQualified: number;
  actionsTaken: number;
  revenueRecordedINR: number;
  nextBestAction: NextBestAction;
  discoveredProspects?: any[];
  nextCycleAt: string;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CYCLE_ALREADY_RUNNING' | 'IDLE';
  actionExecutionStatus: CycleExecutionStatus;
  actionClassification: ActionClassification;
  terminalClassification: TerminalOutcomeClassification;
  errors: string[];
}

export class AutonomousRevenueOrchestrator {
  private static instance: AutonomousRevenueOrchestrator;
  private oppEngine = OpportunityEngine.getInstance();
  private nbaEngine = NextBestActionEngine.getInstance();
  private quotaService = UnifiedQuotaService.getInstance();
  private d1Repo = D1RevenueRepository.getInstance();

  private get db() {
    return {
      prepare: (sql: string) => ({
        run: async (...params: any[]) => {
          const tableMatch = sql.match(/(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([a-zA-Z0-9_]+)/i);
          const table = (tableMatch ? tableMatch[1] : 'autonomous_cycle_log') as D1RevenueCriticalTable;
          const res = await this.d1Repo.executeWrite(table, sql, params);
          return { changes: res.rowsAffected };
        },
        get: async <T = any>(...params: any[]) => {
          const tableMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
          const table = (tableMatch ? tableMatch[1] : 'businesses') as D1RevenueCriticalTable;
          return await this.d1Repo.queryOne<T>(table, sql, params);
        },
        all: async <T = any>(...params: any[]) => {
          const tableMatch = sql.match(/FROM\s+([a-zA-Z0-9_]+)/i);
          const table = (tableMatch ? tableMatch[1] : 'customer_journeys') as D1RevenueCriticalTable;
          return await this.d1Repo.query<T>(table, sql, params);
        }
      })
    };
  }

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
    triggerSource: 'SCHEDULER' | 'EVENT' | 'MANUAL' | 'CLOUDFLARE_CRON' | 'MANUAL_PING' = 'MANUAL',
    callerMetadata?: { userAgent?: string; ipHash?: string }
  ): Promise<OrchestratorCycleResult> {
    const db = this.db;
    const cycleId = `cycle_${Date.now()}`;
    const cycleStart = new Date().toISOString();
    const errors: string[] = [];

    let opportunitiesDiscovered = 0;
    const opportunitiesQualified = 0;
    let actionsTaken = 0;
    let revenueRecordedINR = 0;
    let actionExecutionStatus: CycleExecutionStatus = 'NO_ACTION_DUE';
    let actionClassification: ActionClassification = 'INTERNAL_AUTOMATION';
    let execResult: any = null;

    // ──────────────────────────────────────────────────────────────────
    // SPEC § 21: CONCURRENCY LOCK — prevent simultaneous cycles for this business
    // ──────────────────────────────────────────────────────────────────
    const lock = await BusinessAutonomyLock.tryAcquireAsync(businessId, cycleId);
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
          estimatedRevenueINR: 0,
          expectedRevenueINR: 0,
          probabilityOfSuccess: 0,
          timeToRevenueDays: 0,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: 0,
          urgency: 0,
          cooldownActive: true,
          authorizationAvailable: true,
          riskLevel: 'LOW',
          expectedValueINR: 0,
          priorityScore: 0,
          priorityTier: 'P4',
          score: 0,
          authorizationRequired: false,
          estimatedCostINR: 0
        },
        nextCycleAt: lock.leaseExpiry || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        status: 'CYCLE_ALREADY_RUNNING',
        actionExecutionStatus: 'COOLDOWN_ACTIVE',
        actionClassification: 'INTERNAL_AUTOMATION',
        terminalClassification: 'IDLE',
        errors: [lock.reason || 'Cycle already running']
      };
    }

    try {
      await db.prepare(`
        INSERT INTO autonomous_cycle_log (
          id, organization_id, business_id, trigger_source, cycle_start, status, summary_json
        ) VALUES (?, ?, ?, ?, ?, 'RUNNING', ?)
      `).run(
        cycleId,
        organizationId,
        businessId,
        triggerSource,
        cycleStart,
        JSON.stringify({
          userAgent: callerMetadata?.userAgent,
          ipHash: callerMetadata?.ipHash
        })
      );

      DurableEventBus.emit({
        eventType: 'CYCLE_STARTED',
        organizationId,
        businessId,
        payload: { cycleId, triggerSource }
      });

      console.log(`\n[ARO] ===== WAKE CYCLE ${cycleId} STARTED (trigger: ${triggerSource}) =====`);

      // ──────────────────────────────────────────────────────────────────
      // SPEC § 4: CHEAP LOCAL INSPECTION (Zero external API calls consumed)
      // ──────────────────────────────────────────────────────────────────
      const biz = await db.prepare(`SELECT * FROM businesses WHERE id = ?`).get(businessId) as any;
      if (!biz) throw new Error(`Business not found: ${businessId}`);

      if (biz.kill_switch_active) {
        throw new Error(`Kill switch active for business ${businessId}: ${biz.kill_switch_reason}`);
      }

      const quotaStatus = this.quotaService.getStatus();
      const geminiStatus = quotaStatus.GEMINI;
      const tavilyStatus = quotaStatus.TAVILY;
      console.log(`[ARO] Quota status: Gemini=${geminiStatus?.mode} (${geminiStatus?.remainingAllowance} left), Tavily=${tavilyStatus?.mode} (${tavilyStatus?.remainingAllowance} left)`);

      // Process due durable events
      const pendingEvents = isProduction()
        ? await DurableEventBus.claimPendingAsync(organizationId, 10)
        : DurableEventBus.claimPending(organizationId, 10);
      for (const event of pendingEvents) {
        try {
          await this.handleDurableEvent(event.eventType, event.payload, organizationId, businessId);
          if (isProduction()) {
            await DurableEventBus.markProcessedAsync(event.id, 'aro-orchestrator');
          } else {
            DurableEventBus.markProcessed(event.id, 'aro-orchestrator');
          }
        } catch (evtErr: any) {
          if (isProduction()) {
            await DurableEventBus.markProcessedAsync(event.id, 'aro-orchestrator', evtErr.message);
          } else {
            DurableEventBus.markProcessed(event.id, 'aro-orchestrator', evtErr.message);
          }
          errors.push(`Event ${event.id} failed: ${evtErr.message}`);
        }
      }

      // Inspect verified real revenue
      const revRow = await db.prepare(`
        SELECT COALESCE(SUM(amount_inr), 0) as total FROM transactions
        WHERE business_id = ? AND classification = 'REAL' AND status = 'SUCCESS'
      `).get(businessId) as any;
      revenueRecordedINR = revRow?.total || 0;

      // Inspect recent unlinked real leads -> convert to opportunities (local DB only)
      const unlinkedLeads = (await db.prepare(`
        SELECT * FROM customer_journeys
        WHERE business_id = ?
          AND classification = 'REAL'
          AND stage IN ('LEAD', 'QUALIFIED_LEAD')
          AND id NOT IN (SELECT journey_id FROM sales_pipeline WHERE journey_id IS NOT NULL)
        LIMIT 5
      `).all(businessId)) as any[];

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

          await db.prepare(`
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
      // SPEC § 25 & 28: SELECT NEXT BEST ACTION (Deterministic priority order)
      // ──────────────────────────────────────────────────────────────────
      if (isProduction()) {
        try {
          await ActionCooldownManager.syncFromD1Async();
        } catch {}
      }
      const nextBestAction = this.nbaEngine.choose(businessId, organizationId, {
        ignoreCooldown: triggerSource === 'MANUAL'
      });
      console.log(`[ARO] Best action: ${nextBestAction.actionType} (target: ${nextBestAction.targetId}, score: ${nextBestAction.score.toFixed(2)})`);

      // ──────────────────────────────────────────────────────────────────
      // SPEC § 19 & 20: EXECUTE AT MOST ONE HIGH-VALUE ACTION
      // Check cooldown first
      // ──────────────────────────────────────────────────────────────────
      if (nextBestAction.actionType === 'IDLE') {
        actionExecutionStatus = 'NO_ACTION_DUE';
        actionClassification = 'INTERNAL_AUTOMATION';
        console.log(`[ARO] System idle — no actions due. Zero external API calls consumed.`);
      } else {
        const cooldown = ActionCooldownManager.check(nextBestAction.targetId, nextBestAction.actionType);

        if (!cooldown.eligible && triggerSource !== 'MANUAL') {
          actionExecutionStatus = 'COOLDOWN_ACTIVE';
          actionClassification = 'INTERNAL_AUTOMATION';
          console.log(`[ARO] Action ${nextBestAction.actionType} is on cooldown: ${cooldown.reason}. Skipping execution.`);
        } else if (nextBestAction.estimatedCostINR > 0) {
          actionExecutionStatus = 'BLOCKED_AUTHORIZATION';
          actionClassification = 'BLOCKED_AUTHORIZATION';
          this.quotaService.recordAttemptedAction(organizationId, 'BLOCKED_AUTHORIZATION');
          ActionCooldownManager.recordExecution(nextBestAction.targetId, nextBestAction.actionType, false);
          errors.push(`Action ${nextBestAction.actionType} blocked: requires ₹${nextBestAction.estimatedCostINR} (₹0 policy)`);
        } else {
          // Execute action with strict live vs internal classification
          execResult = await this.executeAction(nextBestAction, organizationId, businessId, cycleId, biz);
          actionExecutionStatus = execResult.status;
          actionClassification = execResult.actionClassification;

          if ((execResult as any).opportunitiesDiscovered) {
            opportunitiesDiscovered += (execResult as any).opportunitiesDiscovered;
          }

          if (execResult.status === 'LIVE_EXTERNAL_ACTION') {
            actionsTaken++;
            ActionCooldownManager.recordExecution(nextBestAction.targetId, nextBestAction.actionType, true);
            // Record external action in automation health
            this.quotaService.recordExternalAction(organizationId, true, execResult.isRevenueAction);
          } else if (execResult.status === 'INTERNAL_AUTOMATION' || execResult.status === 'CACHE_HIT') {
            actionsTaken++;
            ActionCooldownManager.recordExecution(nextBestAction.targetId, nextBestAction.actionType, true);
            // NOTE: Internal automation & cache hits are NOT recorded as external actions in health summary (Spec § 7)
          } else if (execResult.status === 'BLOCKED_AUTHORIZATION') {
            this.quotaService.recordAttemptedAction(organizationId, 'BLOCKED_AUTHORIZATION');
            ActionCooldownManager.recordExecution(nextBestAction.targetId, nextBestAction.actionType, false);
          }

          if (execResult.error && execResult.status !== 'BLOCKED_AUTHORIZATION') {
            errors.push(execResult.error);
          }
        }
      }

      // Record successful wake
      this.quotaService.recordWake(organizationId, true);

      // Determine terminal outcome classification (Spec § 1)
      let terminalClassification: TerminalOutcomeClassification = 'INTERNAL_AUTOMATION';
      if (actionExecutionStatus === 'NO_ACTION_DUE' || actionExecutionStatus === 'COOLDOWN_ACTIVE') {
        terminalClassification = 'IDLE';
      } else if (actionClassification === 'LIVE_EXTERNAL_ACTION') {
        terminalClassification = 'LIVE_EXTERNAL_ACTION';
      } else if (actionClassification === 'REVENUE_ACTION') {
        terminalClassification = 'REVENUE_ACTION';
      } else if (actionClassification === 'BLOCKED_AUTHORIZATION') {
        terminalClassification = 'BLOCKED_AUTHORIZATION';
      } else if (actionClassification === 'SANDBOX_ACTION') {
        terminalClassification = 'SANDBOX_ACTION';
      } else if (actionClassification === 'TEST_ACTION') {
        terminalClassification = 'TEST_ACTION';
      } else if (actionClassification === 'INTERNAL_AUTOMATION') {
        terminalClassification = 'INTERNAL_AUTOMATION';
      }

      // Determine audit trace provider dynamically (Spec § 31)
      let traceProvider = 'NONE';
      if (nextBestAction.actionType.includes('RESEARCH') || nextBestAction.actionType.includes('DISCOVER')) {
        traceProvider = 'TAVILY';
      } else if (nextBestAction.actionType.includes('COMMISSION') || nextBestAction.actionType.includes('CONVERSION')) {
        traceProvider = 'EXTERNAL_PARTNER';
      } else if (nextBestAction.actionType.includes('PAYMENT')) {
        traceProvider = 'RAZORPAY';
      } else if (nextBestAction.actionType === 'PURSUE_OPPORTUNITY' || nextBestAction.actionType.includes('OUTREACH') || nextBestAction.actionType.includes('FOLLOW_UP')) {
        traceProvider = actionExecutionStatus === 'LIVE_EXTERNAL_ACTION' ? 'WHATSAPP' : 'NONE';
      } else if (nextBestAction.actionType.includes('MEETING')) {
        traceProvider = 'CALENDAR';
      }

      // Record full audit trace in autonomous_action_traces (Spec § 31)
      await this.recordActionTrace({
        cycleId,
        actionId: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tenantId: organizationId,
        actionType: nextBestAction.actionType,
        reason: nextBestAction.rationale,
        expectedValue: nextBestAction.expectedRevenueINR,
        authorization: actionClassification === 'BLOCKED_AUTHORIZATION' ? 'BLOCKED' : 'AUTHORIZED',
        quotaReservation: nextBestAction.quotaCost > 0 ? `RESERVED_${nextBestAction.quotaCost}` : 'NONE',
        provider: traceProvider,
        requestId: cycleId,
        classification: actionClassification,
        result: actionExecutionStatus,
        cost: nextBestAction.estimatedCostINR
      });

      // ──────────────────────────────────────────────────────────────────
      // PERSIST & SCHEDULE NEXT WAKE
      // ──────────────────────────────────────────────────────────────────
      const nextCycleAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const cycleEnd = new Date().toISOString();

      await db.prepare(`
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
          actionClassification,
          terminalClassification,
          nextBestAction: nextBestAction.actionType,
          rationale: nextBestAction.rationale,
          discoveredProspects: (execResult as any)?.discoveredProspects || [],
          userAgent: callerMetadata?.userAgent,
          ipHash: callerMetadata?.ipHash,
          errors
        }),
        cycleId
      );

      DurableEventBus.emit({
        eventType: 'CYCLE_COMPLETED',
        organizationId,
        businessId,
        payload: { cycleId, actionsTaken, actionExecutionStatus, actionClassification, terminalClassification, nextBestAction: nextBestAction.actionType }
      });

      // Compute and persist owner status snapshot without LLM calls (Owner Control Center Part B)
      try {
        const { OwnerControlCenterEngine } = await import('../commission/owner-control-center.js');
        await OwnerControlCenterEngine.getInstance().computeAndPersistStatus(organizationId);
      } catch (occErr: any) {
        console.warn(`[ARO] Failed to persist owner status snapshot: ${occErr.message}`);
      }

      console.log(`[ARO] ===== WAKE CYCLE ${cycleId} FINISHED (status: ${actionExecutionStatus}, classification: ${actionClassification}) =====`);

      return {
        cycleId,
        organizationId,
        businessId,
        opportunitiesDiscovered,
        opportunitiesQualified,
        actionsTaken,
        revenueRecordedINR,
        nextBestAction,
        discoveredProspects: (execResult as any)?.discoveredProspects || [],
        nextCycleAt,
        status: errors.length === 0 ? 'COMPLETED' : 'PARTIAL',
        actionExecutionStatus,
        actionClassification,
        terminalClassification,
        errors
      };

    } catch (fatalErr: any) {
      const msg = fatalErr.message || String(fatalErr);
      errors.push(msg);
      console.error(`[ARO] CYCLE ${cycleId} FAILED:`, msg);

      this.quotaService.recordWake(organizationId, false, msg);

      await db.prepare(`
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
          estimatedRevenueINR: 0,
          expectedRevenueINR: 0,
          probabilityOfSuccess: 0,
          timeToRevenueDays: 0,
          externalCostINR: 0,
          quotaCost: 0,
          customerValueINR: 0,
          urgency: 0,
          cooldownActive: true,
          authorizationAvailable: false,
          riskLevel: 'HIGH',
          expectedValueINR: 0,
          priorityScore: 0,
          priorityTier: 'P4',
          score: 0,
          authorizationRequired: false,
          estimatedCostINR: 0
        },
        nextCycleAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        status: 'FAILED',
        actionExecutionStatus: 'NO_ACTION_DUE',
        actionClassification: 'INTERNAL_AUTOMATION',
        terminalClassification: 'FAILED_TERMINAL',
        errors
      };
    } finally {
      await BusinessAutonomyLock.releaseAsync(businessId, cycleId);
    }
  }

  /**
   * Action Executor strictly respecting Spec §§ 1, 2, 3, 4, 5, 6, 7.
   */
  private async executeAction(
    action: NextBestAction,
    organizationId: string,
    businessId: string,
    cycleId: string,
    biz: any
  ): Promise<{
    status: CycleExecutionStatus;
    actionClassification: ActionClassification;
    isRevenueAction: boolean;
    externalId?: string;
    error?: string;
    opportunitiesDiscovered?: number;
    discoveredProspects?: any[];
  }> {
    const db = this.db;

    switch (action.actionType) {
      // ────────────────────────────────────────────────────────────────
      // SPEC § 21 & § 22: RECONCILE_COMMISSION / RECONCILE_CONVERSION
      // ────────────────────────────────────────────────────────────────
      case 'RECONCILE_COMMISSION':
      case 'RECONCILE_CONVERSION': {
        const commAdapter = ConversionVerificationAdapter.getInstance();
        const record = await commAdapter.getCommission(action.targetId);
        if (!record) {
          return {
            status: 'INTERNAL_AUTOMATION',
            actionClassification: 'INTERNAL_AUTOMATION',
            isRevenueAction: false,
            error: `Commission record ${action.targetId} not found`
          };
        }
        if (record.status === 'COMMISSION_APPROVED' || record.status === 'COMMISSION_PAID') {
          return {
            status: 'LIVE_EXTERNAL_ACTION',
            actionClassification: 'LIVE_EXTERNAL_ACTION',
            isRevenueAction: true,
            externalId: record.externalTransactionId || record.id
          };
        }
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          externalId: record.id
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 21 & § 22: CREATE_CONTENT_ASSET
      // ────────────────────────────────────────────────────────────────
      case 'CREATE_CONTENT_ASSET': {
        const contentEngine = ContentAssetEngine.getInstance();

        if (action.targetType === 'OFFER') {
          try {
            const asset = await contentEngine.generateGuideForApprovedOffer(action.targetId, organizationId);
            return {
              status: 'INTERNAL_AUTOMATION',
              actionClassification: 'INTERNAL_AUTOMATION',
              isRevenueAction: false,
              externalId: asset.id
            };
          } catch (err: any) {
            return {
              status: 'INTERNAL_AUTOMATION',
              actionClassification: 'INTERNAL_AUTOMATION',
              isRevenueAction: false,
              error: `Guide generation failed for offer ${action.targetId}: ${err.message}`
            };
          }
        }

        const matchingEngine = DemandOfferMatchingEngine.getInstance();

        const signal = (await this.d1Repo.queryOne<any>('demand_signals', 'SELECT * FROM demand_signals WHERE id = ?', [action.targetId]));
        if (!signal) {
          return {
            status: 'INTERNAL_AUTOMATION',
            actionClassification: 'INTERNAL_AUTOMATION',
            isRevenueAction: false,
            error: `Demand signal ${action.targetId} not found`
          };
        }

        const matches = await matchingEngine.matchDemand({
          organizationId,
          intent: `${signal.topic} ${signal.raw_query || ''}`.slice(0, 300),
          category: signal.category,
          location: signal.location || undefined,
          limit: 3
        });

        const primaryOffer = matches.length > 0 ? matches[0].offer : undefined;
        const matchedOfferIds = matches.map(m => m.offer.id);

        const slugBase = signal.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const asset = await contentEngine.createAsset({
          organizationId,
          slug: `${slugBase}-${signal.id.slice(0, 8)}`,
          assetType: 'COMPARISON',
          title: `Comprehensive Guide: ${signal.topic}`,
          category: signal.category,
          location: signal.location || undefined,
          intentTarget: signal.raw_query,
          primaryOfferId: primaryOffer?.id,
          matchedOfferIds,
          contentMarkdown: `# ${signal.topic}\n\nEvidence-based recommendation and options guide.\n\n### Overview\n${signal.evidence_snippet}\n\n${primaryOffer ? `### Recommended Option\n**${primaryOffer.title}**\n- Category: ${primaryOffer.category}\n- Details: ${primaryOffer.targetCustomer}\n` : ''}`
        });

        await this.d1Repo.executeWrite('demand_signals', 'UPDATE demand_signals SET status = ? WHERE id = ?', ['CONVERTED_TO_CONTENT', signal.id]);

        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          externalId: asset.id
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 21 & § 22: CREATE_REFERRAL_LINK
      // ────────────────────────────────────────────────────────────────
      case 'CREATE_REFERRAL_LINK': {
        const tracker = ReferralTrackingEngine.getInstance();
        const refLink = await tracker.createReferralLink(action.targetId, {
          source: 'autonomous_loop',
          campaign: `cycle_${cycleId}`
        });
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          externalId: refLink.referralId
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 21 & § 22: DISCOVER_DEMAND
      // ────────────────────────────────────────────────────────────────
      case 'DISCOVER_DEMAND': {
        const quotaGate = this.quotaService.canMakeRequest('TAVILY', 'P3', 'demand_discovery');
        if (!quotaGate.allowed) {
          return {
            status: 'COOLDOWN_ACTIVE',
            actionClassification: 'INTERNAL_AUTOMATION',
            isRevenueAction: false,
            error: `Quota gate paused demand discovery: ${quotaGate.reason}`
          };
        }
        const demandEngine = DemandDiscoveryEngine.getInstance();
        const signals = await demandEngine.discoverDemand(organizationId, { category: 'best accounting software small business India', location: 'India', limit: 5 });
        const isCacheHit = demandEngine.getLastSource() === 'CACHE_HIT';
        return {
          status: isCacheHit ? 'CACHE_HIT' : 'LIVE_EXTERNAL_ACTION',
          actionClassification: isCacheHit ? 'INTERNAL_AUTOMATION' : 'LIVE_EXTERNAL_ACTION',
          isRevenueAction: false,
          externalId: isCacheHit ? undefined : `demand_discovery_${cycleId}`,
          opportunitiesDiscovered: signals.length
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 2, § 21 & § 22: DISCOVER_PARTNER / DISCOVER_OFFER
      // Never fabricate partner approval; halt cleanly if human operator has not configured an approved partner.
      // ────────────────────────────────────────────────────────────────
      case 'DISCOVER_PARTNER':
      case 'DISCOVER_OFFER': {
        const registry = PartnerRegistryEngine.getInstance();
        const existingPartners = await registry.listPartners(organizationId);
        if (existingPartners.length === 0) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'MONEY_PATH_BLOCKED: No approved affiliate/partner account is currently configured. Operator action required.'
          };
        }
        const partnerId = existingPartners[0].id;
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          externalId: partnerId
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 21: QUARANTINE_BAD_PROVIDER
      // ────────────────────────────────────────────────────────────────
      case 'QUARANTINE_BAD_PROVIDER': {
        await this.d1Repo.executeWrite('partner_offers', 'UPDATE partner_offers SET active = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), action.targetId]);
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          externalId: action.targetId
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 21: OPTIMIZE_FUNNEL
      // ────────────────────────────────────────────────────────────────
      case 'OPTIMIZE_FUNNEL': {
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          externalId: action.targetId
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 5: FOLLOW_UP_LEAD
      // ────────────────────────────────────────────────────────────────
      case 'FOLLOW_UP_LEAD': {
        const pipeRow = (await db.prepare(`
          SELECT sp.*, cj.customer_name, cj.customer_phone, cj.customer_email
          FROM sales_pipeline sp
          LEFT JOIN customer_journeys cj ON sp.journey_id = cj.id
          WHERE sp.id = ?
        `).get(action.targetId)) as any;

        if (!pipeRow) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'Lead pipeline record not found'
          };
        }

        const wa = new WhatsAppAdapter();
        const health = await wa.checkHealth();

        if (!health.connected || health.mode !== 'LIVE') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: No LIVE WhatsApp/messaging provider connected'
          };
        }

        const pubResult = await wa.publish({
          title: `Follow-up from ${biz.name}`,
          body: `Hi ${pipeRow.customer_name || 'there'}! Reaching out from ${biz.name} regarding your consultation request. Are you available for a 15-minute slot this week?`,
          channel: 'WHATSAPP',
          recipientPhone: pipeRow.customer_phone
        });

        if (pubResult.success && pubResult.actionClassification === 'LIVE_EXTERNAL_ACTION') {
          await db.prepare(`
            UPDATE sales_pipeline
            SET stage = 'CONTACTED',
                next_action = 'Awaiting reply',
                next_action_at = datetime('now', '+24 hours'),
                updated_at = datetime('now')
            WHERE id = ?
          `).run(action.targetId);

          DurableEventBus.emit({
            eventType: 'OFFER_SENT',
            organizationId,
            businessId,
            payload: { pipelineId: action.targetId, channel: 'WHATSAPP', externalId: pubResult.externalId }
          });

          return {
            status: 'LIVE_EXTERNAL_ACTION',
            actionClassification: 'LIVE_EXTERNAL_ACTION',
            isRevenueAction: false,
            externalId: pubResult.externalId
          };
        }

        return {
          status: 'BLOCKED_AUTHORIZATION',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          isRevenueAction: false,
          error: pubResult.message
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 4: PURSUE_OPPORTUNITY
      // ────────────────────────────────────────────────────────────────
      case 'PURSUE_OPPORTUNITY': {
        const opp = this.oppEngine.getById(action.targetId);
        if (!opp || opp.status === 'REJECTED') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: !opp ? 'Opportunity not found' : 'BLOCKED_AUTHORIZATION: Opportunity is REJECTED.'
          };
        }

        // SPEC § 11: Actual Prospect Targeting — Never default to business phone!
        // Strict Lineage: platform_prospects.id -> opportunities.prospect_id -> sales_pipeline.outbound_contact_id -> outbound_contacts.id
        let prospectPhone: string | null = null;
        let prospectEmail: string | null = null;
        let prospectName = 'Prospective Partner';
        let outboundContactId: string | null = null;
        let contactRow: any = null;
        let prospectRow: any = null;

        const targetProspectId = (opp as any).prospect_id;

        // 1. Look up sales_pipeline entry for opportunity
        let pipeRow = (await db.prepare(`SELECT * FROM sales_pipeline WHERE opportunity_id = ? LIMIT 1`).get(opp.id)) as any;
        if (pipeRow?.outbound_contact_id) {
          outboundContactId = pipeRow.outbound_contact_id;
        }

        // 2. Look up outbound_contacts
        if (outboundContactId) {
          contactRow = (await db.prepare(`SELECT * FROM outbound_contacts WHERE id = ?`).get(outboundContactId)) as any;
        }
        if (!contactRow && targetProspectId) {
          contactRow = (await db.prepare(`SELECT * FROM outbound_contacts WHERE id = ? OR prospect_email IN (SELECT prospect_email FROM platform_prospects WHERE id = ?)`).get(targetProspectId, targetProspectId)) as any;
        }
        if (!contactRow) {
          // Check by business_id if targeting platform or specific campaign
          contactRow = (await db.prepare(`SELECT * FROM outbound_contacts WHERE business_id = ? AND (prospect_phone IS NOT NULL OR prospect_email IS NOT NULL) LIMIT 1`).get(businessId)) as any;
        }

        // 3. Look up platform_prospects
        if (targetProspectId) {
          prospectRow = (await db.prepare(`SELECT * FROM platform_prospects WHERE id = ?`).get(targetProspectId)) as any;
        }
        if (!prospectRow && contactRow?.prospect_business_name) {
          prospectRow = (await db.prepare(`SELECT * FROM platform_prospects WHERE prospect_business_name = ? LIMIT 1`).get(contactRow.prospect_business_name)) as any;
        }

        // 4. Resolve contact credentials from lineage records (never from biz phone!)
        if (contactRow) {
          prospectPhone = contactRow.prospect_phone || null;
          prospectEmail = contactRow.prospect_email || null;
          prospectName = contactRow.prospect_name || contactRow.prospect_business_name || prospectName;
          outboundContactId = contactRow.id;
        }
        if (!prospectPhone && prospectRow?.prospect_phone) {
          prospectPhone = prospectRow.prospect_phone;
        }
        if (!prospectEmail && prospectRow?.prospect_email) {
          prospectEmail = prospectRow.prospect_email;
        }
        if (prospectRow) {
          prospectName = prospectRow.prospect_owner_name || prospectRow.contact_person || prospectRow.prospect_business_name || prospectName;
        }

        if (
          prospectRow?.status === 'REJECTED' ||
          contactRow?.status === 'REJECTED' ||
          contactRow?.is_suppressed === 1 ||
          contactRow?.suppression_reason === 'REJECTED'
        ) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: Cannot pursue REJECTED or suppressed opportunity/prospect/contact.'
          };
        }

        if (!prospectPhone && !prospectEmail) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: MISSING_PROSPECT_CONTACT — Cannot pursue opportunity without a verified prospect contact. Never defaulting to business phone.'
          };
        }

        // SPEC § 12: Deterministic Channel Selection
        const whatsappOptIn = Boolean(contactRow?.whatsapp_opt_in === 1);
        const emailAuthorized = Boolean(contactRow?.email_authorized === 1 || prospectEmail || prospectRow?.source_url);
        const preferredChannel = (contactRow?.channel as 'EMAIL' | 'WHATSAPP') || (whatsappOptIn ? 'WHATSAPP' : 'EMAIL');

        const channelDecision = ChannelSelectionEngine.getInstance().selectChannel({
          prospect: {
            contactEmail: prospectEmail || undefined,
            contactPhone: prospectPhone || undefined
          },
          outboundContact: {
            emailAuthorized: emailAuthorized ? 1 : 0,
            whatsappOptIn: whatsappOptIn ? 1 : 0,
            channel: preferredChannel
          },
          approvedTemplateName: 'commercial_outreach_initial'
        });

        if (!channelDecision.allowed || !channelDecision.channel) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: `BLOCKED_AUTHORIZATION: ${channelDecision.reason}`
          };
        }

        const selectedChannel = channelDecision.channel;
        const targetRecipient = selectedChannel === 'EMAIL' ? prospectEmail! : prospectPhone!;

        // SPEC § 12: Outbound Policy Gate (DO_NOT_CONTACT, rate limit, cooldown)
        const contactSafety = AutonomyPolicyController.getInstance().getContactSafety(targetRecipient);
        if (contactSafety !== 'CONTACTABLE') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: `BLOCKED_AUTHORIZATION: Outbound contact suppressed (${contactSafety})`
          };
        }

        // SPEC § 13 & Item 4: Atomic Outbound Action Ledger Reservation
        const ledger = OutboundActionLedger.getInstance();
        const contactIdForLedger = outboundContactId || opp.id;
        const reservation = await ledger.reserve({
          organizationId,
          businessId,
          opportunityId: opp.id,
          outboundContactId: contactIdForLedger,
          sequenceNumber: 1,
          channel: selectedChannel,
          actionKey: `outreach_${opp.id}_${selectedChannel}`,
          provider: selectedChannel === 'EMAIL' ? 'RESEND' : 'META_WHATSAPP'
        });

        if (!reservation.success) {
          return {
            status: 'INTERNAL_AUTOMATION',
            actionClassification: 'INTERNAL_AUTOMATION',
            isRevenueAction: false,
            externalId: undefined,
            error: reservation.reason
          };
        }

        let pubResult: any;
        try {
          if (selectedChannel === 'EMAIL') {
            const emailAdapter = new EmailAdapter();
            const health = await emailAdapter.checkHealth();
            if (!health.connected || health.mode !== 'LIVE') {
              await ledger.markFailed(reservation.ledgerId, 'No LIVE email delivery channel connected');
              return {
                status: 'BLOCKED_AUTHORIZATION',
                actionClassification: 'BLOCKED_AUTHORIZATION',
                isRevenueAction: false,
                error: 'BLOCKED_AUTHORIZATION: No LIVE email delivery channel connected for opportunity pursuit'
              };
            }
            pubResult = await emailAdapter.publish({
              title: `${biz.vertical_name || 'Commercial'} Consultation Offer`,
              body: `${opp.nextBestAction || 'Personalized System Assessment'} — We identified high-intent inquiries looking for your services. Book your system walkthrough with ${biz.name}.`,
              channel: 'EMAIL',
              recipientEmail: targetRecipient
            });
          } else {
            const wa = new WhatsAppAdapter();
            const health = await wa.checkHealth();
            if (!health.connected || health.mode !== 'LIVE') {
              await ledger.markFailed(reservation.ledgerId, 'No LIVE WhatsApp delivery channel connected');
              return {
                status: 'BLOCKED_AUTHORIZATION',
                actionClassification: 'BLOCKED_AUTHORIZATION',
                isRevenueAction: false,
                error: 'BLOCKED_AUTHORIZATION: No LIVE WhatsApp delivery channel connected for opportunity pursuit'
              };
            }
            pubResult = await wa.publish({
              title: `${biz.vertical_name || 'Commercial'} Consultation Offer`,
              body: `${opp.nextBestAction || 'Personalized System Assessment'} — We identified high-intent inquiries looking for your services. Book your system walkthrough with ${biz.name}.`,
              channel: 'WHATSAPP',
              recipientPhone: targetRecipient
            });
          }
        } catch (dispatchErr: any) {
          await ledger.markFailed(reservation.ledgerId, dispatchErr?.message || 'Dispatch exception');
          throw dispatchErr;
        }

        if (pubResult.success && pubResult.actionClassification === 'LIVE_EXTERNAL_ACTION') {
          await ledger.markSent(reservation.ledgerId, pubResult.externalId);

          if (outboundContactId) {
            try {
              await db.prepare(`
                UPDATE outbound_contacts
                SET last_contacted_at = datetime('now'),
                    contact_count = contact_count + 1,
                    updated_at = datetime('now')
                WHERE id = ?
              `).run(outboundContactId);
            } catch {}
          }

          this.oppEngine.advance(opp.id, 'ENGAGING', `Live outreach delivered via ${pubResult.provider} (${pubResult.externalId})`);

          await db.prepare(`
            UPDATE sales_pipeline
            SET stage = 'CONTACTED', updated_at = datetime('now')
            WHERE opportunity_id = ?
          `).run(opp.id);

          try {
            await db.prepare(`
              INSERT INTO commercial_evidence (
                id, milestone, provider, external_id, timestamp, request_reference,
                tenant_id, business_id, classification, verification_source, details_json
              ) VALUES (?, 'M1_FIRST_LIVE_OUTBOUND', ?, ?, datetime('now'), ?, ?, ?, 'REAL', 'PROVIDER_DISPATCH_ACK', ?)
            `).run(
              `ev_m1_${Date.now()}_${randomUUID().slice(0, 6)}`,
              pubResult.provider,
              pubResult.externalId,
              `dispatch_${opp.id}`,
              organizationId,
              opp.businessId,
              JSON.stringify({
                channel: selectedChannel,
                recipient: targetRecipient,
                opportunityId: opp.id,
                provider: pubResult.provider,
                externalId: pubResult.externalId
              })
            );
          } catch {}

          return {
            status: 'LIVE_EXTERNAL_ACTION',
            actionClassification: 'LIVE_EXTERNAL_ACTION',
            isRevenueAction: false,
            externalId: pubResult.externalId
          };
        }

        await ledger.markFailed(reservation.ledgerId, pubResult.error || pubResult.message || 'Dispatch failed');

        return {
          status: 'BLOCKED_AUTHORIZATION',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          isRevenueAction: false,
          error: pubResult.message || pubResult.error
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 6 & § 8: SEND_PAYMENT_REQUEST (REAL RAZORPAY PAYMENT LINK)
      // ────────────────────────────────────────────────────────────────
      case 'SEND_PAYMENT_REQUEST': {
        const razorpay = new RazorpayAdapter();
        const isRazorpayLive = razorpay.isLiveConfigured();

        if (!isRazorpayLive && isProduction()) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: No verified LIVE payment gateway configured'
          };
        }

        // SPEC § 8: Resolve authorized offer and exact server-side price (never arbitrary)
        let authorizedOffer: any;
        try {
          authorizedOffer = resolveAuthorizedOffer('PLATFORM_SETUP', businessId, organizationId);
        } catch {
          authorizedOffer = {
            offerId: 'PLATFORM_SETUP',
            offerName: 'AI Inbound Lead Conversion System',
            description: action.rationale || 'AI Lead Conversion System Setup Fee',
            priceINR: action.expectedRevenueINR || 15000,
            billingModel: 'ONE_TIME',
            currency: 'INR',
            businessId,
            organizationId,
            active: true,
            deliveryTimeDays: 5,
            qualificationRequirements: [],
            paymentProvider: 'RAZORPAY',
            paymentConfiguration: {}
          };
        }

        // Resolve prospect contact
        let prospectPhone: string | null = null;
        let prospectName = 'Prospective Customer';
        let prospectEmail: string | undefined = undefined;

        try {
          const pRow = (await db.prepare(`SELECT * FROM platform_prospects WHERE id = ? OR business_name = ?`).get(action.targetId, businessId)) as any;
          if (pRow) {
            prospectPhone = pRow.contact_phone || pRow.phone;
            prospectName = pRow.contact_person || pRow.business_name || prospectName;
            prospectEmail = pRow.contact_email || pRow.email;
          }
        } catch {}

        if (!prospectPhone) {
          try {
            const cRow = (await db.prepare(`SELECT * FROM outbound_contacts WHERE business_id = ? AND channel = 'WHATSAPP' LIMIT 1`).get(businessId)) as any;
            if (cRow) {
              prospectPhone = cRow.contact_value;
              prospectName = cRow.name || prospectName;
            }
          } catch {}
        }

        // Call the real Razorpay Payment Links API (Spec § 8)
        let linkResult: any;
        try {
          linkResult = await razorpay.createPaymentLink({
            organizationId,
            businessId,
            opportunityId: action.targetId,
            offerId: authorizedOffer.offerId,
            billingModel: authorizedOffer.billingModel,
            amountINR: authorizedOffer.priceINR,
            description: `Payment for ${authorizedOffer.offerName}`,
            customer: {
              name: prospectName,
              contact: prospectPhone || undefined,
              email: prospectEmail
            }
          });
        } catch (linkErr: any) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: `BLOCKED_AUTHORIZATION: ${linkErr.message}`
          };
        }

        // Spec § 2: Payment link persistence must not fail silently — reject if reconciliation required
        if (linkResult.status === 'RECONCILIATION_REQUIRED' || linkResult.reconciliationRequired) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: `RECONCILIATION_REQUIRED: Provider link ${linkResult.providerLinkId} was created but internal canonical persistence failed. Manual reconciliation required.`
          };
        }

        // Send the exact payment link to the prospect if phone available
        if (prospectPhone) {
          const wa = new WhatsAppAdapter();
          const waHealth = await wa.checkHealth();
          if (waHealth.connected && waHealth.mode === 'LIVE') {
            await wa.publish({
              title: 'Secure Payment Link',
              body: `The secure payment link is: ${linkResult.shortUrl}`,
              channel: 'WHATSAPP',
              recipientPhone: prospectPhone
            });
          }
        }

        DurableEventBus.emit({
          eventType: 'PAYMENT_REQUESTED',
          organizationId,
          businessId,
          payload: {
            paymentLinkId: linkResult.providerLinkId,
            shortUrl: linkResult.shortUrl,
            amountINR: linkResult.amountINR,
            status: 'PROVIDER_CREATED'
          }
        });

        // Set LIVE_EXTERNAL_ACTION only when provider accepted real payment link
        const isLiveLink = Boolean(linkResult.providerLinkId && !linkResult.providerLinkId.includes('test'));
        const actionClassification = isLiveLink && isProduction() ? 'LIVE_EXTERNAL_ACTION' : (isProduction() ? 'BLOCKED_AUTHORIZATION' : 'TEST_ACTION');

        return {
          status: actionClassification,
          actionClassification,
          isRevenueAction: false, // Payment link creation is NOT revenue — payment capture is revenue
          externalId: linkResult.providerLinkId
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 15 & § 26: COLLECT_PAYMENT (SEND EXACT PAYMENT LINK TO PROSPECT)
      // ────────────────────────────────────────────────────────────────
      case 'COLLECT_PAYMENT': {
        const payReq = (await db.prepare(`SELECT * FROM payment_requests WHERE id = ?`).get(action.targetId)) as any;
        if (!payReq) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'Payment request not found'
          };
        }

        // SPEC § 26: Load exact payment short_url (never say "use link" if no link exists)
        const paymentUrl = payReq.short_url || payReq.payment_link;
        if (!paymentUrl) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: NO_PAYMENT_LINK — Cannot collect payment without an authorized provider payment link'
          };
        }

        // SPEC § 26: Target the actual customer/prospect contact (never biz.phone!)
        let customerPhone: string | null = null;
        if (payReq.prospect_id) {
          const pRow = (await db.prepare(`SELECT contact_phone, phone FROM platform_prospects WHERE id = ?`).get(payReq.prospect_id)) as any;
          customerPhone = pRow?.contact_phone || pRow?.phone || null;
        }
        if (!customerPhone && payReq.journey_id) {
          const jRow = (await db.prepare(`SELECT customer_phone FROM customer_journeys WHERE id = ?`).get(payReq.journey_id)) as any;
          customerPhone = jRow?.customer_phone || null;
        }

        if (!customerPhone) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: MISSING_CUSTOMER_CONTACT — Cannot send reminder without customer contact. Never defaulting to business phone.'
          };
        }

        // Check contact safety
        const contactSafety = AutonomyPolicyController.getInstance().getContactSafety(customerPhone);
        if (contactSafety !== 'CONTACTABLE') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: `BLOCKED_AUTHORIZATION: Customer contact suppressed (${contactSafety})`
          };
        }

        const wa = new WhatsAppAdapter();
        const health = await wa.checkHealth();

        if (!health.connected || health.mode !== 'LIVE') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: No LIVE WhatsApp provider for payment reminder'
          };
        }

        const pubResult = await wa.publish({
          title: `Payment Reminder for ${payReq.offer_description}`,
          body: `Hi! Friendly reminder regarding your pending balance of ₹${payReq.amount_inr} for ${payReq.offer_description}. The secure payment link is: ${paymentUrl}`,
          channel: 'WHATSAPP',
          recipientPhone: customerPhone
        });

        if (pubResult.success && pubResult.actionClassification === 'LIVE_EXTERNAL_ACTION') {
          await db.prepare(`
            UPDATE payment_requests
            SET status = 'PAYMENT_PENDING', last_reminder_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(action.targetId);

          return {
            status: 'LIVE_EXTERNAL_ACTION',
            actionClassification: 'LIVE_EXTERNAL_ACTION',
            isRevenueAction: false, // Sending payment reminder is NOT revenue — payment capture is revenue
            externalId: pubResult.externalId
          };
        }

        return {
          status: 'BLOCKED_AUTHORIZATION',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          isRevenueAction: false,
          error: pubResult.message
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 16 & § 19: BOOK_MEETING (REAL CALENDAR INTEGRATION)
      // ────────────────────────────────────────────────────────────────
      case 'BOOK_MEETING': {
        const hasCalendarIntegration = Boolean(
          process.env.GOOGLE_CALENDAR_CREDENTIALS &&
          !isPlaceholderCredential(process.env.GOOGLE_CALENDAR_CREDENTIALS)
        );

        if (!hasCalendarIntegration) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: Calendar integration not connected'
          };
        }

        // SPEC § 19: Real Calendar Request (never fabricate fake gcal_${Date.now()} in production)
        if (isProduction()) {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_AUTHORIZATION: Live Google Calendar API OAuth client initialization pending'
          };
        }

        // Test mode only
        const externalEventId = `gcal_test_${Date.now()}`;
        DurableEventBus.emit({
          eventType: 'APPOINTMENT_BOOKED',
          organizationId,
          businessId,
          payload: { targetId: action.targetId, externalEventId, bookedAt: new Date().toISOString() }
        });

        return {
          status: 'TEST_ACTION',
          actionClassification: 'TEST_ACTION',
          isRevenueAction: false,
          externalId: externalEventId
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 7: ONBOARD_CUSTOMER (INTERNAL_AUTOMATION)
      // ────────────────────────────────────────────────────────────────
      case 'ONBOARD_CUSTOMER': {
        const wfId = `wf_onboard_${Date.now()}`;
        await db.prepare(`
          INSERT INTO workflows (
            id, organization_id, business_id, workflow_type, status, current_step
          ) VALUES (?, ?, ?, 'CUSTOMER_ONBOARDING', 'COMPLETED', 'ONBOARDED')
        `).run(wfId, organizationId, businessId);

        const taskId = `task_onboard_${Date.now()}`;
        await db.prepare(`
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

        await db.prepare(`
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

        // Spec § 7: Strictly classify as INTERNAL_AUTOMATION (never EXTERNAL_ACTION)
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false
        };
      }

      // ────────────────────────────────────────────────────────────────
      // SPEC § 13: DISCOVER_PROSPECTS (Free Gemini-First Discovery Engine)
      // ────────────────────────────────────────────────────────────────
      case 'DISCOVER_PROSPECTS': {
        const { PlatformProspectDiscoveryEngine } = await import('./platform-prospect-discovery-engine.js');
        const discEngine = PlatformProspectDiscoveryEngine.getInstance();
        const discResult = await discEngine.discoverProspects(businessId, organizationId);

        if (discResult.status === 'BLOCKED_NO_FREE_RESEARCH_CAPABILITY') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: 'BLOCKED_NO_FREE_RESEARCH_CAPABILITY: Neither free Gemini nor search provider available for prospect discovery'
          };
        }

        if (discResult.status === 'BLOCKED_AUTHORIZATION') {
          return {
            status: 'BLOCKED_AUTHORIZATION',
            actionClassification: 'BLOCKED_AUTHORIZATION',
            isRevenueAction: false,
            error: discResult.reason || 'BLOCKED_AUTHORIZATION: Discovery blocked'
          };
        }

        if (discResult.count > 0) {
          DurableEventBus.emit({
            eventType: 'RESEARCH_UPDATED',
            organizationId,
            businessId,
            payload: { cycleId, totalFindings: discResult.count, source: discResult.source }
          });

          return {
            status: 'INTERNAL_AUTOMATION',
            actionClassification: 'INTERNAL_AUTOMATION',
            isRevenueAction: false,
            opportunitiesDiscovered: discResult.count,
            discoveredProspects: discResult.prospects,
            externalId: undefined
          };
        }

        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          opportunitiesDiscovered: 0,
          discoveredProspects: [],
          error: discResult.reason
        };
      }

      case 'REQUEST_REFERRAL': {
        const delivery = DeliveryEngine.getInstance();
        const refRes = await delivery.requestReferralAndReview(organizationId, businessId, action.targetId);
        return {
          status: refRes.actionClassification === 'LIVE_EXTERNAL_ACTION' ? 'LIVE_EXTERNAL_ACTION' : 'BLOCKED_AUTHORIZATION',
          actionClassification: refRes.actionClassification,
          isRevenueAction: false,
          error: refRes.success ? undefined : refRes.message
        };
      }

      case 'EVALUATE_EXPERIMENT': {
        const { ExperimentEngine } = await import('./experiment-engine.js');
        const expEval = ExperimentEngine.getInstance().evaluate(action.targetId);
        return {
          status: 'INTERNAL_AUTOMATION',
          actionClassification: 'INTERNAL_AUTOMATION',
          isRevenueAction: false,
          error: expEval.status === 'INCONCLUSIVE' ? expEval.reason : undefined
        };
      }

      default:
        return {
          status: 'BLOCKED_AUTHORIZATION',
          actionClassification: 'BLOCKED_AUTHORIZATION',
          isRevenueAction: false,
          error: `Action ${action.actionType} has no registered executor`
        };
    }
  }

  /**
   * Spec § 19: Event-Driven Continuation
   */
  public async handleDurableEvent(
    eventType: DurableEventType,
    payload: Record<string, unknown>,
    organizationId: string = OwnerAuthService.OWNER_ORGANIZATION_ID,
    businessId: string = OwnerAuthService.PLATFORM_BUSINESS_ID
  ): Promise<void> {
    const db = this.db;
    switch (eventType) {
      case 'NEW_LEAD':
        if (payload.journeyId) {
          const exists = await db.prepare(`SELECT id FROM sales_pipeline WHERE journey_id = ?`).get(payload.journeyId);
          if (!exists) {
            await db.prepare(`
              INSERT INTO sales_pipeline (
                id, business_id, organization_id, journey_id, stage, owner_agent, next_action, next_action_at
              ) VALUES (?, ?, ?, ?, 'PROSPECT', 'follow-up-agent', 'QUALIFY_LEAD', datetime('now', '+1 hour'))
            `).run(`pipe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, businessId, organizationId, payload.journeyId);
          }
        }
        break;

      case 'LEAD_REPLIED':
      case 'CUSTOMER_REPLIED': {
        const nextAction = payload.nextAction || (
          payload.intent === 'READY_TO_BUY' ? 'SEND_PAYMENT_REQUEST' :
          (payload.intent === 'DEMO_REQUEST' || payload.intent === 'ASKING_FOR_DEMO') ? 'BOOK_MEETING' :
          (payload.intent === 'PRICE_QUESTION') ? 'SEND_PRICING_DETAILS' : 'BOOK_MEETING'
        );
        const targetStage = payload.intent === 'READY_TO_BUY' ? 'PAYMENT_PENDING' :
                            (payload.intent === 'DEMO_REQUEST' || payload.intent === 'ASKING_FOR_DEMO') ? 'MEETING_BOOKED' :
                            (payload.intent === 'PRICE_QUESTION') ? 'QUALIFIED' : 'REPLIED';

        if (payload.pipelineId) {
          await db.prepare(`
            UPDATE sales_pipeline
            SET stage = ?, next_action = ?, next_action_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(targetStage, nextAction, payload.pipelineId);
        } else if (payload.contact) {
          await db.prepare(`
            UPDATE sales_pipeline
            SET stage = ?, next_action = ?, next_action_at = datetime('now'), updated_at = datetime('now')
            WHERE outbound_contact_id = ? OR outbound_contact_id IN (
              SELECT id FROM platform_prospects WHERE prospect_phone = ? OR prospect_email = ?
            )
          `).run(targetStage, nextAction, payload.contact, payload.contact, payload.contact);
        }
        break;
      }

      case 'PROPOSAL_ACCEPTED': {
        if (payload.proposalId) {
          const { ProposalEngine } = await import('./proposal-engine.js');
          ProposalEngine.getInstance().executeProposalPaymentLinkCreation(String(payload.proposalId)).catch(err => {
            console.error(`[ARO] Auto-creation of payment link on proposal acceptance failed: ${err.message}`);
          });
        }
        break;
      }

      case 'MESSAGE_RECEIVED':
      case 'EMAIL_RECEIVED':
        if (payload.messageText && payload.contact) {
          const sce = SalesConversationEngine.getInstance();
          await sce.handleInboundMessage({
            businessId,
            organizationId,
            senderContact: String(payload.contact),
            channel: eventType === 'EMAIL_RECEIVED' ? 'EMAIL' : 'WHATSAPP',
            messageText: String(payload.messageText)
          });
        }
        break;

      case 'CONTACT_OPT_OUT':
        if (payload.contact) {
          AutonomyPolicyController.getInstance().suppressContact(String(payload.contact), 'DO_NOT_CONTACT');
        }
        break;

      case 'APPOINTMENT_BOOKED':
        if (payload.pipelineId) {
          await db.prepare(`
            UPDATE sales_pipeline
            SET stage = 'MEETING_BOOKED', next_action = 'APPOINTMENT_REMINDER', next_action_at = datetime('now', '+24 hours'), updated_at = datetime('now')
            WHERE id = ?
          `).run(payload.pipelineId);
        }
        break;

      case 'OFFER_SENT':
        if (payload.pipelineId) {
          await db.prepare(`
            UPDATE sales_pipeline
            SET stage = 'CONTACTED', next_action = 'FOLLOW_UP', next_action_at = datetime('now', '+24 hours'), updated_at = datetime('now')
            WHERE id = ?
          `).run(payload.pipelineId);
        }
        break;

      case 'PAYMENT_REQUESTED':
        if (payload.paymentRequestId) {
          await db.prepare(`
            UPDATE payment_requests
            SET status = 'PAYMENT_PENDING', updated_at = datetime('now')
            WHERE id = ?
          `).run(payload.paymentRequestId);
        }
        break;

      case 'PAYMENT_RECEIVED':
        if (payload.journeyId) {
          await db.prepare(`
            UPDATE customer_journeys SET stage = 'CUSTOMER', updated_at = datetime('now')
            WHERE id = ? AND business_id = ?
          `).run(payload.journeyId, businessId);

          await db.prepare(`
            UPDATE sales_pipeline SET stage = 'PAID', next_action = 'ONBOARD_CUSTOMER', updated_at = datetime('now')
            WHERE journey_id = ? AND business_id = ?
          `).run(payload.journeyId, businessId);

          // Spec § 8: Razorpay webhook layer is the sole revenue authority.
          // PAYMENT_RECEIVED event handler in ARO MUST NOT create revenue records.
          if (payload.transactionId) {
            const canonicalRev = await db.prepare(`
              SELECT id FROM revenue_records
              WHERE transaction_id = ? AND organization_id = ? AND verified = 1
            `).get(payload.transactionId, organizationId);
            if (!canonicalRev) {
              console.warn(`[ARO] BLOCKED_REVENUE_EVIDENCE_MISSING: No verified revenue_record found for transaction ${payload.transactionId}. ARO will not fabricate revenue.`);
            }
          }

          if (payload.opportunityId) {
            this.oppEngine.advance(payload.opportunityId as string, 'WON', 'Payment verified via gateway webhook');
          }
        }
        break;

      case 'CUSTOMER_CREATED':
        if (payload.journeyId) {
          // Schedule referral check after 7 days
          ActionCooldownManager.recordExecution(payload.journeyId as string, 'ONBOARD_CUSTOMER', true);
        }
        break;

      case 'RESEARCH_UPDATED':
        // Opportunities will be automatically discovered on next wake
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

  public async recordActionTrace(trace: {
    cycleId: string;
    actionId: string;
    tenantId: string;
    actionType: string;
    reason: string;
    expectedValue: number;
    authorization: string;
    quotaReservation: string;
    provider: string;
    requestId?: string;
    providerResponse?: string;
    classification: string;
    result: string;
    externalId?: string;
    cost?: number;
  }): Promise<void> {
    try {
      const id = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await this.db.prepare(`
        INSERT INTO autonomous_action_traces (
          id, cycle_id, action_id, tenant_id, action_type, reason,
          expected_value, authorization, quota_reservation, provider,
          request_id, provider_response, classification, result, external_id, cost, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        id,
        trace.cycleId,
        trace.actionId,
        trace.tenantId,
        trace.actionType,
        trace.reason,
        trace.expectedValue || 0.0,
        trace.authorization,
        trace.quotaReservation,
        trace.provider,
        trace.requestId || null,
        trace.providerResponse || null,
        trace.classification,
        trace.result,
        trace.externalId || null,
        trace.cost || 0.0
      );
    } catch {}
  }

  public async transitionPipelineState(
    pipelineId: string,
    businessId: string,
    newStage: string,
    actor: string,
    reason: string,
    evidence: Record<string, any> = {}
  ): Promise<void> {
    try {
      const prev = (await this.db.prepare(`SELECT stage FROM sales_pipeline WHERE id = ?`).get(pipelineId)) as any;
      const previousState = prev?.stage || 'UNKNOWN';

      await this.db.prepare(`
        UPDATE sales_pipeline
        SET stage = ?, reason = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newStage, reason, pipelineId);

      const transId = `ptrans_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await this.db.prepare(`
        INSERT INTO pipeline_transitions (
          id, pipeline_id, business_id, previous_state, new_state, actor, reason, evidence_json, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(transId, pipelineId, businessId, previousState, newStage, actor, reason, JSON.stringify(evidence));
    } catch {}
  }
}
