export interface Env {
  BACKEND_URL: string;       // set in [vars] inside wrangler.toml
  CRON_PING_SECRET: string;  // set via `wrangler secret put CRON_PING_SECRET`
}

export default {
  // HTTP handler — for manual health-checks / smoke tests
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', worker: 'ai-marketing-cron-worker' }),
        { headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  },

  // Scheduled handler — fires hourly via `0 * * * *`
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCycle(env));
  }
};

async function runCycle(env: Env): Promise<void> {
  const startMs = Date.now();
  console.log(`[CRON WORKER] Wake triggered at ${new Date().toISOString()}`);

  if (!env.CRON_PING_SECRET) {
    console.error('[CRON WORKER] CRON_PING_SECRET not set — aborting to prevent unauthorized calls');
    return;
  }

  if (!env.BACKEND_URL) {
    console.error('[CRON WORKER] BACKEND_URL not set — aborting');
    return;
  }

  const pingUrl = `${env.BACKEND_URL.replace(/\/$/, '')}/api/v1/cron/ping`;
  const claimUrl = `${env.BACKEND_URL.replace(/\/$/, '')}/api/v1/cron/worker/claim-and-run`;

  // Step 1: Cold-start resilient warmup & heartbeat ping (100s timeout >= 90s + 1 automatic retry after 2s on 502/503/504/timeout)
  let response: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      response = await fetch(pingUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': env.CRON_PING_SECRET,
          'User-Agent': 'ai-marketing-cron-worker/1.0'
        },
        body: JSON.stringify({
          triggerSource: 'CLOUDFLARE_CRON',
          scheduledAt: new Date().toISOString(),
          cronExpression: '0 * * * *',
          attempt
        }),
        signal: AbortSignal.timeout(100000)
      });

      if (response.ok || (response.status !== 502 && response.status !== 503 && response.status !== 504)) {
        break;
      }
      console.warn(`[CRON WORKER] Warmup ping attempt ${attempt} returned ${response.status}; retrying in 2s...`);
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string };
      console.warn(`[CRON WORKER] Warmup ping attempt ${attempt} failed (${error?.name || 'Error'}: ${error?.message || 'unknown'})`);
      if (attempt === 2) {
        console.error(`[CRON WORKER] Backend warmup failed after ${Date.now() - startMs}ms — next scheduled wake will retry.`);
        return;
      }
    }
    if (attempt === 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  const elapsed = Date.now() - startMs;
  if (!response) return;

  if (response.ok) {
    const body = await response.json() as Record<string, unknown>;
    console.log(
      `[CRON WORKER] Fast ping accepted in ${elapsed}ms:`,
      JSON.stringify(body).substring(0, 500)
    );

    // Step 2: Bounded Queue Drain (container is now warm)
    try {
      const drainUrl = `${claimUrl}?budgetMs=15000&maxJobs=5`;
      const claimStart = Date.now();
      const claimRes = await fetch(drainUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cron-Secret': env.CRON_PING_SECRET,
          'User-Agent': 'ai-marketing-cron-worker/1.0'
        },
        signal: AbortSignal.timeout(25000)
      });
      const elapsedClaim = Date.now() - claimStart;
      if (claimRes.ok) {
        const claimBody = await claimRes.json() as Record<string, unknown>;
        const jobsExecuted = typeof claimBody.jobsExecutedCount === 'number'
          ? claimBody.jobsExecutedCount
          : (Array.isArray(claimBody.executedJobs) ? claimBody.executedJobs.length : 0);
        console.log(`[CRON WORKER] Drain completed: status=${claimRes.status}, claimed=${claimBody.claimed}, jobsExecuted=${jobsExecuted}, elapsed=${claimBody.elapsedMs ?? elapsedClaim}ms`);
      } else {
        const errTxt = await claimRes.text();
        console.error(`[CRON WORKER] Drain failed: status=${claimRes.status}, in ${elapsedClaim}ms: ${errTxt.substring(0, 300)}`);
      }
    } catch (claimErr: any) {
      console.warn(`[CRON WORKER] Drain loop exception: ${claimErr?.message}`);
    }
  } else {
    const text = await response.text();
    console.error(
      `[CRON WORKER] Backend returned ${response.status} in ${elapsed}ms:`,
      text.substring(0, 200)
    );
  }
}
