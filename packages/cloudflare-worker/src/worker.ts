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

  try {
    const response = await fetch(pingUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': env.CRON_PING_SECRET,
        'User-Agent': 'ai-marketing-cron-worker/1.0'
      },
      body: JSON.stringify({
        triggerSource: 'CLOUDFLARE_CRON',
        scheduledAt: new Date().toISOString(),
        cronExpression: '0 * * * *'
      }),
      signal: AbortSignal.timeout(100000) // 100-second ceiling to tolerate Render cold starts
    });

    const elapsed = Date.now() - startMs;

    if (response.ok) {
      const body = await response.json() as Record<string, unknown>;
      console.log(
        `[CRON WORKER] Fast ping accepted in ${elapsed}ms:`,
        JSON.stringify(body).substring(0, 500)
      );

      // Claim & execute due job from durable queue
      try {
        const claimRes = await fetch(claimUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cron-Secret': env.CRON_PING_SECRET,
            'User-Agent': 'ai-marketing-cron-worker/1.0'
          },
          signal: AbortSignal.timeout(25000)
        });
        if (claimRes.ok) {
          const claimBody = await claimRes.json() as Record<string, unknown>;
          console.log(`[CRON WORKER] Claim step: claimed=${claimBody.claimed}, message=${claimBody.message || 'SUCCESS'}`);
        }
      } catch (claimErr: any) {
        console.warn(`[CRON WORKER] Claim step notice: ${claimErr?.message}`);
      }
    } else {
      const text = await response.text();
      console.error(
        `[CRON WORKER] Backend returned ${response.status} in ${elapsed}ms:`,
        text.substring(0, 200)
      );
    }
  } catch (err: unknown) {
    const elapsed = Date.now() - startMs;
    const error = err as { name?: string; message?: string };

    if (error?.name === 'TimeoutError' || error?.message?.includes('timeout')) {
      console.warn(
        `[CRON WORKER] Backend timeout after ${elapsed}ms — next scheduled wake will retry.`
      );
    } else {
      console.error(`[CRON WORKER] Unexpected error after ${elapsed}ms:`, error?.message);
    }
  }
}
