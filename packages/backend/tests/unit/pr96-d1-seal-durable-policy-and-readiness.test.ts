/**
 * PR #96 Regression Test Suite:
 * a) Zero-scan cold boot (no syncFromD1Async, harvestAllApprovedMerchantFeeds, GoogleSuggestClient, or autoAuditNextUnauditedDomain)
 * b) /cron/ping 0 queue-recovery queries + /cron/worker/claim-and-run runs recoverStaleAndBlockedJobs strictly inside startBackgroundCycle(2500)
 *    with executeQuery/executeBatch halting on D1_BACKGROUND_BUDGET_EXCEEDED regardless of P0 priority
 * c) DURABLE_REQUIRED_TABLES fail-closed B2B proposal write in production when D1 unavailable + b2b/readiness proposalDraftingAvailable: false
 * d) /api/v1/b2b/readiness fails closed when remoteD1Configured === false and preserves backward-compatible d1Status object + d1Health/quotaStatus strings
 * e) Generic code 7500 SQLITE_ERROR does NOT trip quota breaker while explicit "exceeded D1's free tier daily row read limit" DOES
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiRouter } from '../../src/routes/api.js';
import { D1Client, DURABLE_REQUIRED_TABLES } from '../../src/db/d1-client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { DurableJobQueue } from '../../src/automation/durable-job-queue.js';
import { B2BPilotService } from '../../src/revenue/b2b-pilot-service.js';
import { RazorpayStandardAdapter } from '../../src/payments/razorpay-adapter.js';
import { SiteAuditScanner } from '../../src/tools/site-audit/site-audit-scanner.js';

function createTestApp() {
  const app = new Hono();
  app.route('/api/v1', apiRouter);
  return app;
}

describe('PR #96: Seal D1 Leaks, Durable Storage Policy, Readiness Compatibility & Quota Classification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CRON_PING_SECRET = 'cron_ping_fixture_dev';
    process.env.OWNER_API_KEY = 'test_owner_secret_pr96_valid_key_32chars';
    process.env.SITE_AUDIT_TERMS_ATTESTED = 'true';
    process.env.SITE_AUDIT_SIGNING_SECRET = 'test_signing_secret_32_chars_long_pr96';
    const d1 = D1Client.getInstance();
    d1.resetDailyBackgroundUsage();
    d1.endBackgroundCycle();
    d1.resetQuotaCircuitBreakerForTesting();
    B2BPilotService.resetInstance();
    RazorpayStandardAdapter.resetInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    const d1 = D1Client.getInstance();
    d1.resetDailyBackgroundUsage();
    d1.endBackgroundCycle();
    d1.resetQuotaCircuitBreakerForTesting();
  });

  it('(a) Cold boot seals all background D1 sync, merchant harvest, GoogleSuggest, and autoAudit sweeps', () => {
    const candidates = [
      path.resolve(process.cwd(), 'src/index.ts'),
      path.resolve(process.cwd(), 'packages/backend/src/index.ts')
    ];
    const indexPath = candidates.find(p => fs.existsSync(p));
    expect(indexPath).toBeTruthy();

    const indexSrc = fs.readFileSync(indexPath!, 'utf8');
    const startServerIdx = indexSrc.indexOf('export async function startServer');
    expect(startServerIdx).toBeGreaterThan(-1);
    const bootSection = indexSrc.slice(startServerIdx);

    expect(bootSection).not.toContain('syncFromD1Async(');
    expect(bootSection).not.toContain('hydrateFunnelTelemetryFromDb(');
    expect(bootSection).not.toContain('hydrateFromDb(');
    expect(bootSection).not.toContain('syncBaselineAssetsAsync(');
    expect(bootSection).not.toContain('harvestAllApprovedMerchantFeeds(');
    expect(bootSection).not.toContain('fetchSuggestions(');
    expect(bootSection).not.toContain('autoAuditNextUnauditedDomain(');
  });

  it('(b) /cron/ping performs 0 queue-recovery queries and /claim-and-run wraps recoverStaleAndBlockedJobs inside startBackgroundCycle(2500) + P0 executeQuery halts on D1_BACKGROUND_BUDGET_EXCEEDED', async () => {
    const app = createTestApp();
    const queue = DurableJobQueue.getInstance();
    const d1 = D1Client.getInstance();
    const d1Repo = D1RevenueRepository.getInstance();

    const recoverSpy = vi.spyOn(queue, 'recoverStaleAndBlockedJobs').mockResolvedValue({} as any);
    const recoverLeasesSpy = vi.spyOn(queue, 'recoverStaleLeases').mockResolvedValue(0 as any);
    const getStatsSpy = vi.spyOn(queue, 'getQueueStats');
    const enqueueBatchSpy = vi.spyOn(queue, 'enqueueJobsBatch').mockResolvedValue({ enqueuedCount: 0, existingCount: 0, failedCount: 0, errors: [] });
    const repoQuerySpy = vi.spyOn(d1Repo, 'queryOne');

    const pingRes = await app.request('/api/v1/cron/ping', {
      method: 'POST',
      headers: {
        'X-Cron-Secret': 'cron_ping_fixture_dev',
        'User-Agent': 'ai-marketing-cron-worker/1.0'
      }
    });
    expect(pingRes.status).toBe(200);
    const pingJson = await pingRes.json() as any;
    expect(pingJson.success).toBe(true);
    expect(pingJson.queueStats.mode).toBe('HEARTBEAT_ZERO_READ');
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(recoverLeasesSpy).not.toHaveBeenCalled();
    expect(getStatsSpy).not.toHaveBeenCalled();
    expect(enqueueBatchSpy).not.toHaveBeenCalled();
    expect(repoQuerySpy).not.toHaveBeenCalled();

    // Verify startBackgroundCycle is active BEFORE recoverStaleAndBlockedJobs runs inside /claim-and-run
    let cycleWasActiveDuringRecovery = false;
    recoverSpy.mockImplementation(async () => {
      cycleWasActiveDuringRecovery = d1.isCycleActive();
      return {} as any;
    });
    vi.spyOn(queue, 'claimDueJob').mockResolvedValue(null);
    getStatsSpy.mockResolvedValue({ queued: 0, running: 0, completed: 0, failed: 0, blocked: 0 } as any);

    const claimRes = await app.request('/api/v1/cron/worker/claim-and-run', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev' }
    });
    expect(claimRes.status).toBe(200);
    expect(recoverSpy).toHaveBeenCalledWith({ skipSystemDoctor: true });
    expect(cycleWasActiveDuringRecovery).toBe(true);
    expect(d1.isCycleActive()).toBe(false); // Guaranteed closed in finally

    // Verify executeQuery() and executeBatch() halt even with default P0 priority when cycleActive === true & budget exceeded
    d1.startBackgroundCycle(50);
    d1.recordCycleUsage(60, 0);
    await expect(
      d1.executeQuery('SELECT * FROM public_deals LIMIT 1', [], false, 'P0')
    ).rejects.toThrow(/D1_BACKGROUND_BUDGET_EXCEEDED/);
    await expect(
      d1.executeBatch([{ sql: 'INSERT INTO cron_telemetry (id, status) VALUES (?, ?)', params: ['x', 'y'] }], 'P0')
    ).rejects.toThrow(/D1_BACKGROUND_BUDGET_EXCEEDED/);
    d1.endBackgroundCycle();
  });

  it('(c) Enforces DURABLE_REQUIRED_TABLES fail-closed for B2B proposal writes when D1 is unavailable in production and sets proposalDraftingAvailable: false', async () => {
    expect(DURABLE_REQUIRED_TABLES).toContain('durable_events');
    expect(DURABLE_REQUIRED_TABLES).toContain('customer_journeys');
    expect(DURABLE_REQUIRED_TABLES).toContain('universal_orders');
    expect(DURABLE_REQUIRED_TABLES).toContain('payment_requests');
    expect(DURABLE_REQUIRED_TABLES).toContain('delivery_tasks');

    const prevNodeEnv = process.env.NODE_ENV;
    const prevRender = process.env.RENDER;
    process.env.NODE_ENV = 'production';
    process.env.RENDER = 'true';

    const d1 = D1Client.getInstance();
    vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
    d1.tripReadQuotaCircuitBreaker("Your account has exceeded D1's free tier daily row read limit.");

    const scannerMock = {
      scanUrl: vi.fn().mockResolvedValue({
        url: 'https://example-institute.in',
        rawHtml: '<html><head></head><body><h1>Academy</h1></body></html>',
        metrics: { httpStatus: 200, ttfbMs: 120 },
        findings: []
      })
    } as unknown as SiteAuditScanner;

    try {
      await expect(
        B2BPilotService.getInstance().generateProposal(
          { targetUrl: 'https://example-institute.in', businessName: 'Example Academy' },
          { scanner: scannerMock }
        )
      ).rejects.toThrow(/D1_DURABLE_WRITE_UNAVAILABLE/);

      // /api/v1/b2b/readiness reports proposalDraftingAvailable: false and checkoutOrderCreationReady: false
      vi.spyOn(RazorpayStandardAdapter.getInstance(), 'probeRazorpayAuth').mockResolvedValue({
        providerAcceptedAuth: true,
        httpStatus: 200,
        authDiagnosticCode: 'OK',
        authStatus: 'PROVIDER_AUTHENTICATED',
        keyMode: 'LIVE'
      });
      const app = createTestApp();
      const b2bReadyRes = await app.request('/api/v1/b2b/readiness');
      expect(b2bReadyRes.status).toBe(200);
      const b2bReady = await b2bReadyRes.json() as any;
      expect(b2bReady.proposalDraftingAvailable).toBe(false);
      expect(b2bReady.checkoutOrderCreationReady).toBe(false);
      expect(b2bReady.isReady).toBe(false);
      expect(b2bReady.d1Health).toBe('DEGRADED_QUOTA_EXHAUSTED');
      expect(b2bReady.quotaStatus).toBe('DEGRADED_QUOTA_EXHAUSTED');
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.RENDER = prevRender;
    }
  });

  it('(d) /api/v1/b2b/readiness and /api/v1/tools/site-audit/readiness fail closed when remoteD1Configured === false and preserve d1Status object schema + d1Health string', async () => {
    const app = createTestApp();
    const d1 = D1Client.getInstance();
    vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(false);
    vi.spyOn(RazorpayStandardAdapter.getInstance(), 'probeRazorpayAuth').mockResolvedValue({
      providerAcceptedAuth: true,
      httpStatus: 200,
      authDiagnosticCode: 'OK',
      authStatus: 'PROVIDER_AUTHENTICATED',
      keyMode: 'TEST_SANDBOX'
    });

    const b2bRes = await app.request('/api/v1/b2b/readiness');
    expect(b2bRes.status).toBe(200);
    const b2bJson = await b2bRes.json() as any;
    expect(b2bJson.isReady).toBe(false);
    expect(b2bJson.proposalDraftingAvailable).toBe(false);
    expect(b2bJson.checkoutOrderCreationReady).toBe(false);
    expect(b2bJson.d1Health).toBe('UNCONFIGURED');
    expect(b2bJson.quotaStatus).toBe('UNCONFIGURED');
    expect(typeof b2bJson.d1Status).toBe('object');
    expect(b2bJson.d1Status.status).toBe('UNCONFIGURED');
    expect(b2bJson.d1Status.remoteD1Configured).toBe(false);
    expect(b2bJson.d1Status.circuitBreaker).toBeDefined();

    const saRes = await app.request('/api/v1/tools/site-audit/readiness');
    expect(saRes.status).toBe(200);
    const saJson = await saRes.json() as any;
    expect(saJson.isReady).toBe(false);
    expect(saJson.d1Health).toBe('UNCONFIGURED');
    expect(saJson.quotaStatus).toBe('UNCONFIGURED');
    expect(typeof saJson.d1Status).toBe('object');
    expect(saJson.d1Status.remoteD1Configured).toBe(false);
    expect(saJson.d1Status.circuitBreaker).toBeDefined();
  });

  it('(e) Generic code 7500 SQLITE_ERROR does NOT trip the daily quota breaker, while explicit Cloudflare daily limit message DOES', async () => {
    const d1 = D1Client.getInstance();
    vi.spyOn(d1, 'isRemoteD1Configured').mockReturnValue(true);
    vi.spyOn(d1, 'isRemoteD1ReadAllowed').mockReturnValue(true);

    // 1. Generic 7500 SQLITE_ERROR ("no such table: d1_migrations") must NOT trip daily quota breaker
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: (k: string) => (k.toLowerCase() === 'cf-ray' ? 'ray_test_7500_sqlite' : null) },
      text: async () => JSON.stringify({
        success: false,
        errors: [{ code: 7500, message: 'no such table: d1_migrations: SQLITE_ERROR' }]
      })
    });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      await d1.executeQuery('SELECT COUNT(*) FROM d1_migrations', [], false, 'P1');
    } catch {
      // fallback or error expected outside prod
    } finally {
      globalThis.fetch = prevFetch;
    }
    expect(d1.isRemoteD1ReadQuotaExhausted()).toBe(false);
    expect(d1.isRemoteD1QuotaExhausted()).toBe(false);

    // 2. Explicit Cloudflare free tier daily row read limit message DOES trip read breaker
    const quotaFetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: (k: string) => (k.toLowerCase() === 'cf-ray' ? 'ray_test_daily_quota' : null) },
      text: async () => JSON.stringify({
        success: false,
        errors: [{
          code: 7500,
          message: "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."
        }]
      })
    });
    globalThis.fetch = quotaFetchMock as any;
    try {
      await d1.executeQuery('SELECT * FROM public_deals LIMIT 1', [], false, 'P1');
    } finally {
      globalThis.fetch = prevFetch;
    }
    expect(d1.isRemoteD1ReadQuotaExhausted()).toBe(true);
    expect(d1.isRemoteD1WriteQuotaExhausted()).toBe(false);
  });

  it('(f) /claim-and-run never calls runSelfHealingPass and sets doctorMaintenanceDue accurately', async () => {
    const app = createTestApp();
    const queue = DurableJobQueue.getInstance();
    const { AutonomousSystemDoctor } = await import('../../src/automation/autonomous-system-doctor.js');
    const { AutomationRegistryEngine } = await import('../../src/automation/automation-registry-engine.js');
    const doctor = AutonomousSystemDoctor.getInstance();
    const engine = AutomationRegistryEngine.getInstance();

    vi.spyOn(queue, 'recoverStaleAndBlockedJobs').mockResolvedValue({} as any);
    vi.spyOn(queue, 'enqueueJobsBatch').mockResolvedValue({ enqueuedCount: 0, existingCount: 0, failedCount: 0, errors: [] });
    vi.spyOn(queue, 'getQueueStats').mockResolvedValue({ queued: 0, running: 0, completed: 0, failed: 0, blocked: 0 } as any);
    vi.spyOn(doctor, 'getPublicSystemDoctorSummary').mockResolvedValue({ status: 'HEALTHY' } as any);
    const healSpy = vi.spyOn(doctor, 'runSelfHealingPass').mockResolvedValue({} as any);

    // 1. Busy cycle + stale/missing report -> never calls runSelfHealingPass, doctorMaintenanceDue: false
    vi.spyOn(queue, 'claimDueJob')
      .mockResolvedValueOnce({ id: 'job_safe_1', workflowId: 'quota_health_checks', leaseToken: 'lease_1' } as any)
      .mockResolvedValue(null);
    vi.spyOn(queue, 'completeJob').mockResolvedValue(undefined as any);
    vi.spyOn(queue, 'getJobById').mockResolvedValue({ id: 'job_safe_1', workflowId: 'quota_health_checks', status: 'COMPLETED' } as any);
    vi.spyOn(engine, 'executeWorkflow').mockResolvedValue({ status: 'COMPLETED', resultSummary: 'ok', durationMs: 5 } as any);
    const reportSpy = vi.spyOn(doctor, 'getLastReport').mockReturnValue(null);

    const busyRes = await app.request('/api/v1/cron/worker/claim-and-run', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev' }
    });
    expect(busyRes.status).toBe(200);
    const busyJson = await busyRes.json() as any;
    expect(busyJson.claimed).toBe(true);
    expect(busyJson.doctorMaintenanceDue).toBe(false);
    expect(healSpy).not.toHaveBeenCalled();

    // 2. Idle cycle + fresh report -> doctorMaintenanceDue: false
    const freshIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    reportSpy.mockReturnValue({ startedAt: freshIso, completedAt: freshIso } as any);
    const freshRes = await app.request('/api/v1/cron/worker/claim-and-run', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev' }
    });
    expect(freshRes.status).toBe(200);
    const freshJson = await freshRes.json() as any;
    expect(freshJson.claimed).toBe(false);
    expect(freshJson.doctorMaintenanceDue).toBe(false);
    expect(healSpy).not.toHaveBeenCalled();

    // 3. Idle cycle + expired report -> doctorMaintenanceDue: true, still never calls runSelfHealingPass
    const expiredIso = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    reportSpy.mockReturnValue({ startedAt: expiredIso, completedAt: expiredIso } as any);
    const staleRes = await app.request('/api/v1/cron/worker/claim-and-run', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev' }
    });
    expect(staleRes.status).toBe(200);
    const staleJson = await staleRes.json() as any;
    expect(staleJson.claimed).toBe(false);
    expect(staleJson.doctorMaintenanceDue).toBe(true);
    expect(healSpy).not.toHaveBeenCalled();
  });

  it('(g) /cron/recover enforces freshness cooldown, bounds Doctor inside startBackgroundCycle(2500), and handles budget exhaustion cleanly', async () => {
    const app = createTestApp();
    const d1 = D1Client.getInstance();
    const { AutonomousSystemDoctor } = await import('../../src/automation/autonomous-system-doctor.js');
    const doctor = AutonomousSystemDoctor.getInstance();

    const freshIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const reportSpy = vi.spyOn(doctor, 'getLastReport').mockReturnValue({ startedAt: freshIso, completedAt: freshIso } as any);
    const healSpy = vi.spyOn(doctor, 'runSelfHealingPass').mockResolvedValue({ ok: true } as any);

    // 1. Fresh report skips maintenance
    const skipRes = await app.request('/api/v1/cron/recover', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemDoctorOnly: true })
    });
    expect(skipRes.status).toBe(200);
    const skipJson = await skipRes.json() as any;
    expect(skipJson.skipped).toBe(true);
    expect(skipJson.reason).toBe('FRESH_REPORT');
    expect(healSpy).not.toHaveBeenCalled();

    // 2. Stale report runs bounded inside startBackgroundCycle(2500) and closes cycle in finally
    const expiredIso = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    reportSpy.mockReturnValue({ startedAt: expiredIso, completedAt: expiredIso } as any);
    let cycleActiveDuringHeal = false;
    healSpy.mockImplementationOnce(async () => {
      cycleActiveDuringHeal = d1.isCycleActive();
      return { ok: true } as any;
    });

    const runRes = await app.request('/api/v1/cron/recover', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemDoctorOnly: true })
    });
    expect(runRes.status).toBe(200);
    const runJson = await runRes.json() as any;
    expect(runJson.skipped).toBe(false);
    expect(cycleActiveDuringHeal).toBe(true);
    expect(d1.isCycleActive()).toBe(false);

    // 3. D1_BACKGROUND_BUDGET_EXCEEDED returns HTTP 200 BOUNDED_PARTIAL and still closes cycle
    healSpy.mockRejectedValueOnce(new Error('D1_BACKGROUND_BUDGET_EXCEEDED: cycle cap reached'));
    const budgetRes = await app.request('/api/v1/cron/recover', {
      method: 'POST',
      headers: { 'X-Cron-Secret': 'cron_ping_fixture_dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemDoctorOnly: true })
    });
    expect(budgetRes.status).toBe(200);
    const budgetJson = await budgetRes.json() as any;
    expect(budgetJson.status).toBe('BOUNDED_PARTIAL');
    expect(budgetJson.budgetExceeded).toBe(true);
    expect(d1.isCycleActive()).toBe(false);
  });

  it('(h) Cloudflare Worker calls /cron/recover only when doctorMaintenanceDue === true and isolates maintenance timeout/error', async () => {
    const workerMod = await import('../../../cloudflare-worker/src/worker.js');
    const worker = workerMod.default;
    const origFetch = globalThis.fetch;
    const calls: string[] = [];

    const mockEnv = {
      BACKEND_URL: 'https://ai-marketing-organization.onrender.com',
      CRON_PING_SECRET: 'cron_ping_fixture_dev'
    };

    try {
      // 1. doctorMaintenanceDue: false -> only /ping and /claim-and-run called
      globalThis.fetch = vi.fn(async (input: any) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/cron/ping')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true, claimed: false, doctorMaintenanceDue: false }), { status: 200 });
      }) as any;

      let pending: Promise<unknown> | undefined;
      await worker.scheduled({} as any, mockEnv, { waitUntil: (p: Promise<unknown>) => { pending = p; } } as any);
      await pending;
      expect(calls.some(u => u.includes('/cron/recover'))).toBe(false);

      // 2. doctorMaintenanceDue: true + /cron/recover throws timeout -> non-fatal, scheduled run resolves cleanly
      calls.length = 0;
      globalThis.fetch = vi.fn(async (input: any) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/cron/ping')) {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.includes('/claim-and-run')) {
          return new Response(JSON.stringify({ success: true, claimed: false, doctorMaintenanceDue: true }), { status: 200 });
        }
        throw new Error('AbortError: signal timed out');
      }) as any;

      await worker.scheduled({} as any, mockEnv, { waitUntil: (p: Promise<unknown>) => { pending = p; } } as any);
      await expect(pending).resolves.toBeUndefined();
      expect(calls.some(u => u.includes('/cron/recover'))).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
