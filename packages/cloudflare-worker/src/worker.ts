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

  // Scheduled handler — fires every 15 minutes via `*/15 * * * *`
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

  const targetUrl = `${env.BACKEND_URL.replace(/\/$/, '')}/api/v1/cron/ping`;

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': env.CRON_PING_SECRET,
        'User-Agent': 'ai-marketing-cron-worker/1.0'
      },
      body: JSON.stringify({
        triggerSource: 'CLOUDFLARE_CRON',
        scheduledAt: new Date().toISOString(),
        cronExpression: '*/15 * * * *'
      }),
      signal: AbortSignal.timeout(25000) // 25 s — Cloudflare hard-limits Workers at 30 s CPU
    });

    const elapsed = Date.now() - startMs;

    if (response.ok) {
      const body = await response.json() as Record<string, unknown>;
      console.log(
        `[CRON WORKER] Backend responded OK in ${elapsed}ms:`,
        JSON.stringify(body).substring(0, 500)
      );
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

    // Render free tier may be sleeping — timeout on cold start is expected.
    // The next cron invocation (15 min later) will retry automatically.
    if (error?.name === 'TimeoutError' || error?.message?.includes('timeout')) {
      console.warn(
        `[CRON WORKER] Backend timeout after ${elapsed}ms — Render may be cold-starting. Next wake in 15 min.`
      );
    } else {
      console.error(`[CRON WORKER] Unexpected error after ${elapsed}ms:`, error?.message);
    }
  }
}
