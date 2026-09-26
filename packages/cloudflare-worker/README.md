# ai-marketing-cron-worker

A **Cloudflare Worker** that wakes the Render backend every 15 minutes and triggers an autonomous revenue cycle (ARO cycle).

## Overview

| Property | Value |
|---|---|
| Worker name | `ai-marketing-cron-worker` |
| Cron schedule | `*/15 * * * *` (every 15 minutes, UTC) |
| Target | `POST https://ai-marketing-organization.onrender.com/api/v1/cron/ping` |
| Auth header | `X-Cron-Secret: <CRON_PING_SECRET>` |

### What it does

1. Fires every 15 minutes via Cloudflare's built-in cron trigger.
2. POSTs to the Render backend's `/api/v1/cron/ping` endpoint with a signed secret.
3. The backend wakes from Render's free-tier sleep and kicks off the autonomous revenue cycle.
4. Logs the response (or a friendly cold-start warning on timeout) to Cloudflare's Workers logs.

> [!NOTE]
> Render's free tier spins down after ~15 minutes of inactivity. The first ping after a cold-start may time out (25 s limit). The Worker logs a warning and the **next** ping 15 minutes later will succeed once Render is warm.

---

## Deploy Instructions

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is fine)
- Node.js ≥ 18
- `wrangler` CLI

### Step 1 — Install Wrangler

```bash
npm install -g wrangler
# or use npx without installing globally
```

### Step 2 — Authenticate

```bash
wrangler login
```

### Step 3 — Set the cron secret

Set the **same** secret value you configured in Render's `CRON_PING_SECRET` environment variable:

```bash
wrangler secret put CRON_PING_SECRET
# Paste the secret value when prompted — it will never appear in wrangler.toml
```

> [!CAUTION]
> Never commit `CRON_PING_SECRET` to source control. Always use `wrangler secret put`.

### Step 4 — Deploy

Run from the **`packages/cloudflare-worker/`** directory:

```bash
cd packages/cloudflare-worker
wrangler deploy
```

### Step 5 — Verify the cron trigger

1. Go to **Cloudflare Dashboard → Workers & Pages → `ai-marketing-cron-worker`**
2. Click the **Triggers** tab
3. Confirm `*/15 * * * *` is listed under *Cron Triggers*

---

## Local Testing

Use `wrangler dev` with the `--test-scheduled` flag to manually fire the scheduled handler:

```bash
wrangler dev --test-scheduled
# In another terminal:
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"
```

The health endpoint is also available for smoke tests:

```bash
curl http://localhost:8787/health
# → {"status":"ok","worker":"ai-marketing-cron-worker"}
```

---

## Configuration

| Setting | Location | Description |
|---|---|---|
| `BACKEND_URL` | `wrangler.toml → [vars]` | Render backend base URL — update if the URL changes |
| `CRON_PING_SECRET` | Cloudflare secret binding | Auth token — set via `wrangler secret put` |

> [!TIP]
> If you move the backend off Render, just update `BACKEND_URL` in `wrangler.toml` and redeploy — no secret rotation needed unless the secret also changes.

---

## Free Tier Usage

| Metric | Cloudflare Free Limit | This Worker |
|---|---|---|
| Requests / day | 100,000 | **96** (`*/15` = 4/hr × 24 hr) |
| CPU time / invocation | 10 ms (free) | < 1 ms overhead; network I/O is free |

Well within free tier limits. No billing surprises.

---

## Architecture

```
Cloudflare Cron (*/15 * * * *)
        │
        ▼
  worker.ts: scheduled()
        │  POST /api/v1/cron/ping
        │  X-Cron-Secret: ***
        ▼
  Render Backend (Node.js)
        │
        ▼
  Autonomous Revenue Cycle (ARO)
```
