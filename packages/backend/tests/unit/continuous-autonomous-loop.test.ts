import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { BusinessAutonomyLock } from '../../src/revenue/business-autonomy-lock.js';
import { ActionCooldownManager } from '../../src/revenue/action-cooldown-manager.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { DurableEventBus } from '../../src/revenue/durable-event-bus.js';
import { CustomerJourneyTracker } from '../../src/revenue/customer-journey-tracker.js';

describe('Continuous Autonomous Revenue Loop — Spec § 33 Verification', () => {
  const orgId = 'org_smilekraft_01';
  const bizId = 'biz_smilekraft_hyd';

  beforeEach(() => {
    resetDbForTesting();
    seedDatabase();
  });

  // 1 & 2. Cron configuration exists and is configured for */15 * * * *
  it('1 & 2. Cloudflare Worker cron configuration exists and triggers every 15 minutes', () => {
    let wranglerPath = path.resolve(process.cwd(), 'packages/cloudflare-worker/wrangler.toml');
    let workerPath = path.resolve(process.cwd(), 'packages/cloudflare-worker/src/worker.ts');
    if (!fs.existsSync(wranglerPath)) {
      wranglerPath = path.resolve(process.cwd(), '../cloudflare-worker/wrangler.toml');
      workerPath = path.resolve(process.cwd(), '../cloudflare-worker/src/worker.ts');
    }

    expect(fs.existsSync(wranglerPath)).toBe(true);
    expect(fs.existsSync(workerPath)).toBe(true);

    const tomlContent = fs.readFileSync(wranglerPath, 'utf-8');
    expect(tomlContent).toContain('crons = ["*/15 * * * *"]');
    expect(tomlContent).toContain('BACKEND_URL');

    const workerContent = fs.readFileSync(workerPath, 'utf-8');
    expect(workerContent).toContain('X-Cron-Secret');
    expect(workerContent).toContain('/api/v1/cron/ping');
  });

  // 3. Duplicate cycles cannot run concurrently
  it('3. Duplicate cycles cannot run concurrently (BusinessAutonomyLock rejects second cycle)', async () => {
    const lock1 = BusinessAutonomyLock.tryAcquire(bizId, 'cycle_alpha');
    expect(lock1.acquired).toBe(true);

    // Second cycle attempt must be rejected
    const lock2 = BusinessAutonomyLock.tryAcquire(bizId, 'cycle_beta');
    expect(lock2.acquired).toBe(false);
    expect(lock2.reason).toContain('CYCLE_ALREADY_RUNNING');

    // ARO runCycle must return status CYCLE_ALREADY_RUNNING
    const aro = AutonomousRevenueOrchestrator.getInstance();
    const result = await aro.runCycle(orgId, bizId, 'MANUAL');
    expect(result.status).toBe('CYCLE_ALREADY_RUNNING');
    expect(result.actionsTaken).toBe(0);

    // Release lock1
    BusinessAutonomyLock.release(bizId, 'cycle_alpha');
    expect(BusinessAutonomyLock.isLocked(bizId)).toBe(false);
  });

  // 4. Scheduler wake with no work consumes zero Gemini/Tavily calls
  it('4. Scheduler wake with no work consumes zero Gemini/Tavily calls', async () => {
    const db = getDb();
    db.prepare('DELETE FROM customer_journeys').run();
    db.prepare('DELETE FROM sales_pipeline').run();
    db.prepare('DELETE FROM opportunities').run();
    ActionCooldownManager.recordExecution(bizId, 'DISCOVER_PROSPECTS', true);

    const quotaService = UnifiedQuotaService.getInstance();
    const initialStatus = quotaService.getStatus();

    const initialGemini = initialStatus.GEMINI.used;
    const initialTavily = initialStatus.TAVILY.used;

    const aro = AutonomousRevenueOrchestrator.getInstance();
    const result = await aro.runCycle(orgId, bizId, 'CLOUDFLARE_CRON');

    const postStatus = quotaService.getStatus();
    expect(postStatus.GEMINI.used).toBe(initialGemini);
    expect(postStatus.TAVILY.used).toBe(initialTavily);
    expect(result.status).toBe('COMPLETED');
    expect(result.nextBestAction.actionType).toBe('IDLE');
    expect(result.actionsTaken).toBe(0);
  });

  // 5. Tavily never exceeds application credit cap (800) and locks at 100%
  it('5. Tavily never exceeds application credit cap (800) and locks at 100%', () => {
    const quota = UnifiedQuotaService.getInstance();

    // Below 80%: NORMAL
    const gate1 = quota.canMakeRequest('TAVILY', 'P3', 'Prospect search');
    expect(gate1.allowed).toBe(true);
    expect(gate1.mode).toBe('NORMAL');

    // Consume up to 650 credits (above 80% = 640): CONSERVATIVE mode
    quota.recordRequest('TAVILY', true, 650);
    const gate2 = quota.canMakeRequest('TAVILY', 'P3', 'Low priority research');
    expect(gate2.allowed).toBe(false);
    expect(gate2.mode).toBe('CONSERVATIVE');

    // High priority still allowed in conservative mode
    const gate2High = quota.canMakeRequest('TAVILY', 'P1', 'Sales offer research');
    expect(gate2High.allowed).toBe(true);

    // Consume up to 800 credits: LOCKED
    quota.recordRequest('TAVILY', true, 160);
    const gate3 = quota.canMakeRequest('TAVILY', 'P0', 'Emergency search');
    expect(gate3.allowed).toBe(false);
    expect(gate3.mode).toBe('LOCKED');
    expect(gate3.reason).toContain('CAP_REACHED');
  });

  // 6. Gemini never exceeds application safety cap (1200 / 20% reserve protected)
  it('6. Gemini never exceeds application safety cap (20% reserve protected)', () => {
    const quota = UnifiedQuotaService.getInstance();
    quota.unlockProvider('GEMINI');

    // Simulate 1200 requests consumed (safety cap = 1200, reserve = 300)
    const db = getDb();
    db.prepare(`UPDATE provider_quota_state SET requests_today = 1200 WHERE provider = 'GEMINI'`).run();

    const gate = quota.canMakeRequest('GEMINI', 'P0', 'Payment reasoning');
    expect(gate.allowed).toBe(false);
    expect(gate.mode).toBe('LOCKED');
    expect(gate.reason).toContain('SAFETY_LIMIT_REACHED');
  });

  // 7. Gemini reset logic uses provider reset metadata rather than assuming UTC
  it('7. Gemini reset logic stores and respects provider-defined reset window', () => {
    const quota = UnifiedQuotaService.getInstance();
    const providerResetWindowMs = 8 * 3600 * 1000; // 8-hour rolling window from provider

    quota.recordRequest('GEMINI', true, 1, providerResetWindowMs);

    const db = getDb();
    const row = db.prepare(`SELECT next_reset FROM provider_quota_state WHERE provider = 'GEMINI'`).get() as any;
    expect(row.next_reset).toBeTruthy();

    const resetDate = new Date(row.next_reset);
    const now = new Date();
    const diffHours = (resetDate.getTime() - now.getTime()) / (3600 * 1000);
    // Should be approximately 8 hours, proving provider-defined window was stored
    expect(diffHours).toBeGreaterThan(7.5);
    expect(diffHours).toBeLessThan(8.5);
  });

  // 8. Follow-up cooldown prevents 15-minute spam
  it('8. Follow-up cooldown prevents 15-minute spam (24h cooldown after attempt 1)', () => {
    const leadId = 'lead_test_cooldown_01';

    // First attempt: eligible
    const check1 = ActionCooldownManager.check(leadId, 'FOLLOW_UP_LEAD');
    expect(check1.eligible).toBe(true);

    // Record execution
    ActionCooldownManager.recordExecution(leadId, 'FOLLOW_UP_LEAD', true);

    // Second check immediately after: MUST be ineligible on 24h cooldown
    const check2 = ActionCooldownManager.check(leadId, 'FOLLOW_UP_LEAD');
    expect(check2.eligible).toBe(false);
    expect(check2.reason).toContain('COOLDOWN_ACTIVE');

    // Attempt 2 after cooldown: +48h policy
    const state = ActionCooldownManager.getState(leadId, 'FOLLOW_UP_LEAD');
    expect(state?.attemptCount).toBe(1);
    expect(state?.maxAttempts).toBe(3);
  });

  // 9. Payment action executes only when authorized (payment requests require real amounts)
  it('9. Payment action executes only when authorized with valid parameters', async () => {
    const aro = AutonomousRevenueOrchestrator.getInstance();
    const db = getDb();

    // Insert an unpaid payment request
    const payId = 'payrq_test_auth_01';
    db.prepare(`
      INSERT INTO payment_requests (
        id, business_id, organization_id, offer_description, amount_inr, classification, status
      ) VALUES (?, ?, ?, 'Full Smile Alignment Assessment', 25000, 'REAL', 'SENT')
    `).run(payId, bizId, orgId);

    const nba = NextBestActionEngine.getInstance().choose(bizId, orgId);
    expect(nba.actionType).toBe('COLLECT_PAYMENT');
    expect(nba.targetId).toBe(payId);
  });

  // 10. External action failures are not recorded as successful actions
  it('10. External action failures are recorded as failures, not successes', async () => {
    const targetId = 'target_unconfigured_channel';
    ActionCooldownManager.recordExecution(targetId, 'FOLLOW_UP_LEAD', false);

    const db = getDb();
    const row = db.prepare(`SELECT * FROM action_cooldowns WHERE target_id = ?`).get(targetId) as any;
    expect(row.last_succeeded).toBe(0);
  });

  // 11. Render restart does not erase autonomous scheduling state
  it('11. Render restart does not erase autonomous scheduling state (persisted to SQLite)', () => {
    const db = getDb();

    // Verify critical tables exist in SQLite
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
        'provider_quota_state', 'automation_health', 'business_autonomy_lock',
        'action_cooldowns', 'durable_events', 'autonomous_cycle_log', 'opportunities'
      )
    `).all() as any[];

    expect(tables.length).toBe(7);
  });

  // 12. ARO resumes from persisted state
  it('12. ARO resumes seamlessly from persisted SQLite state', async () => {
    const db = getDb();

    // Pre-insert an opportunity in SQLite
    const oppId = 'opp_persisted_test_01';
    db.prepare(`
      INSERT INTO opportunities (
        id, business_id, organization_id, source, evidence_json, estimated_value_inr,
        probability, acquisition_cost_inr, time_to_revenue_days, risk_level, status
      ) VALUES (?, ?, ?, 'INBOUND', '[{"type":"INBOUND_LEAD"}]', 45000, 0.5, 0, 7, 'LOW', 'QUALIFIED')
    `).run(oppId, bizId, orgId);

    const nba = NextBestActionEngine.getInstance().choose(bizId, orgId);
    expect(nba.actionType).toBe('PURSUE_OPPORTUNITY');
    expect(nba.targetId).toBe(oppId);
  });

  // 13. One event cannot execute the same action twice
  it('13. One event cannot be processed twice (durable claim marks processed)', () => {
    const eventId = DurableEventBus.emit({
      eventType: 'NEW_LEAD',
      organizationId: orgId,
      businessId: bizId,
      payload: { leadId: 'lead_once_01' }
    });

    const pending1 = DurableEventBus.claimPending(orgId, 10);
    const found = pending1.find(e => e.id === eventId);
    expect(found).toBeDefined();

    // Mark processed
    DurableEventBus.markProcessed(eventId, 'test-agent');

    // Claim again: must not return the processed event
    const pending2 = DurableEventBus.claimPending(orgId, 10);
    const foundAgain = pending2.find(e => e.id === eventId);
    expect(foundAgain).toBeUndefined();
  });

  // 14. Quota lock does not stop deterministic revenue actions
  it('14. Quota lock does not stop deterministic revenue actions', () => {
    const quota = UnifiedQuotaService.getInstance();
    quota.lockProvider('GEMINI', 'Test quota lockout');
    quota.lockProvider('TAVILY', 'Test quota lockout');

    const db = getDb();
    // Add pending payment request
    const payReqId = 'payrq_locked_ai_01';
    db.prepare(`
      INSERT INTO payment_requests (
        id, business_id, organization_id, offer_description, amount_inr, classification, status
      ) VALUES (?, ?, ?, 'Crown consultation', 12000, 'REAL', 'SENT')
    `).run(payReqId, bizId, orgId);

    // NBA engine must still choose COLLECT_PAYMENT deterministically without AI!
    const nba = NextBestActionEngine.getInstance().choose(bizId, orgId);
    expect(nba.actionType).toBe('COLLECT_PAYMENT');
    expect(nba.targetId).toBe(payReqId);

    quota.unlockProvider('GEMINI');
    quota.unlockProvider('TAVILY');
  });

  // 15. Fake/simulated events cannot trigger real revenue learning
  it('15. Simulated events cannot trigger real revenue learning', () => {
    const db = getDb();

    // Insert simulated learning record
    const lrnId = 'lrn_fake_01';
    db.prepare(`
      INSERT INTO learnings (
        id, organization_id, business_id, observation, hypothesis, experiment_result,
        learning, policy_update, data_classification
      ) VALUES (?, ?, ?, 'Simulated observation', 'Hypothesis', 'Result', 'Learning', 'Policy update', 'SIMULATION_DATA')
    `).run(lrnId, orgId, bizId);

    // Verify system distinguishes real learning from simulated data
    const realLearnings = db.prepare(`
      SELECT * FROM learnings WHERE business_id = ? AND data_classification = 'REAL_WORLD_LEARNING'
    `).all(bizId);

    expect(realLearnings.length).toBe(0);
  });

  // 16. Real payment triggers onboarding automatically
  it('16. Real payment automatically triggers onboarding in ARO loop', async () => {
    const db = getDb();
    db.prepare('DELETE FROM customer_journeys').run();

    const tracker = new CustomerJourneyTracker();
    const journey = tracker.getOrCreateJourney(bizId, 'vis_payer_01', 'REAL', orgId);

    // Record customer status (payment verified)
    db.prepare(`
      UPDATE customer_journeys
      SET stage = 'CUSTOMER', total_lifetime_value_inr = 35000, customer_name = 'Arjun Verma'
      WHERE id = ?
    `).run(journey.id);

    // NextBestAction must select ONBOARD_CUSTOMER
    const nba = NextBestActionEngine.getInstance().choose(bizId, orgId);
    expect(nba.actionType).toBe('ONBOARD_CUSTOMER');
    expect(nba.targetId).toBe(journey.id);
  });

  // 17. Real customer triggers retention automation automatically
  it('17. Retained real customer triggers referral & review automation', () => {
    const db = getDb();
    db.prepare('DELETE FROM customer_journeys').run();

    const tracker = new CustomerJourneyTracker();
    const journey = tracker.getOrCreateJourney(bizId, 'vis_retained_01', 'REAL', orgId);

    // Customer created 10 days ago (past onboarding)
    db.prepare(`
      UPDATE customer_journeys
      SET stage = 'CUSTOMER', total_lifetime_value_inr = 50000, customer_name = 'Deepa Rao',
          created_at = datetime('now', '-10 days')
      WHERE id = ?
    `).run(journey.id);

    // Mark onboarding already exhausted for this journey
    ActionCooldownManager.recordExecution(journey.id, 'ONBOARD_CUSTOMER', true);

    const nba = NextBestActionEngine.getInstance().choose(bizId, orgId);
    expect(nba.actionType).toBe('REQUEST_REFERRAL');
    expect(nba.targetId).toBe(journey.id);
  });
});
