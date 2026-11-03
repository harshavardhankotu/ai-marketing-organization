# V4.9 Production Release Verification & Migration-First Deployment Runbook

**Repository:** `harshavardhankotu/ai-marketing-organization`  
**Target Environment:** Render Production Backend & Cloudflare Edge Infrastructure  
**Render Service ID:** `srv-darecoc9v7es73ea8t2g`  
**Production URL:** `https://ai-marketing-organization.onrender.com`  
**Production Branch:** `main`  
**Staged Feature Branch:** `feat/v4-2-multi-sector-commerce-recovery` (PR #34)  
**Open Base PR:** #33 (`feat/v4-1-durable-daily-revenue-operations`)  
**Date:** November 3, 2026  

---

## 1. Release Baseline & Lineage Reconciliation

A rigorous Git commit tree audit was performed across branches:
- **`origin/main`:** Commit `f3e0c92`
- **`origin/feat/v4-1-durable-daily-revenue-operations` (PR #33):** Commit `bc214b3`
- **`origin/feat/v4-2-multi-sector-commerce-recovery` (PR #34):** Commit `0f294bf`

### Lineage Trace
$$\text{f3e0c92 (main)} \rightarrow \text{82ae018} \rightarrow \text{bc214b3 (PR \#33)} \rightarrow \text{d676380} \rightarrow \text{45d9a2c} \rightarrow \text{0f294bf (PR \#34)}$$

The Git lineage is strictly linear with 0 branch divergence. Every commit in PR #33 is an ancestor of PR #34.

### Release Pre-Condition Gate
To ensure continuous operation and zero database drift:
1. PR #33 must be approved and merged into `main` first, triggering Render deployment.
2. Cloudflare D1 migrations must be verified applied.
3. PR #34 is rebased onto `main` and merged after PR #33 completes health verification.

---

## 2. Cloudflare Infrastructure Verification

### 2.1 Cron Worker Schedule Truth
In previous documentation, discrepancies claimed the Cloudflare worker ran every 10 minutes or every 5 minutes. An inspection of `packages/cloudflare-worker/wrangler.toml` confirms the official production schedule:
```toml
name = "ai-marketing-cron-worker"
main = "src/index.ts"
compatibility_date = "2024-04-01"

[triggers]
crons = ["0 * * * *"] # Executes once per hour at minute 0
```
- **Execution Frequency:** Exactly 1 cron execution per hour (24 executions/day).
- **Endpoint Called:** `POST https://ai-marketing-organization.onrender.com/api/v1/cron/ping`
- **Payload:** `{"trigger": "scheduled_cron", "timestamp": "..."}`
- **Security Header:** `x-cron-secret: ${CRON_SECRET}`

### 2.2 Cloudflare D1 Database Configuration
- **Database Name:** `ai-marketing-d1`
- **Primary Migration Table:** `d1_migrations`
- **Required Tables for V4.9:**
  - `referrals` (public click tracking; foreign keys decoupled from admin approval)
  - `referral_click_events` (immutable click event log with Sub-IDs)
  - `commission_records` (ledger of provider-reported conversions)
  - `workflows` (persistent backup for deal discovery state and cold starts)

---

## 3. Render Production Service Runbook (`srv-darecoc9v7es73ea8t2g`)

### 3.1 Environment Variable Checklist
| Variable | Expected Value / Format | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Enables production security and D1 persistence mode. |
| `CUELINKS_API_KEY` | Hex string (provided in owner secrets) | Authorizes Cuelinks V3 API requests. |
| `CUELINKS_PUBLISHER_ID` | `281897` | Identifies Cuelinks publisher account. |
| `CUELINKS_CHANNEL_ID` | `331585` | Default approved channel for Indian consumer deals. |
| `CLOUDFLARE_D1_DATABASE_ID` | Cloudflare D1 UUID | Target for production SQL execution. |
| `CLOUDFLARE_API_TOKEN` | Bearer token | Authorizes REST SQL execution on D1. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account Hex | Scopes D1 REST API requests. |
| `CRON_SECRET` | Secret string | Validates Cloudflare Cron Worker pings. |
| `PORT` | `10000` (Render default) | HTTP listening port for backend server. |

### 3.2 Deployment Smoke Test Procedure
Immediately following Render build completion:
1. **Heartbeat Check:**
   ```bash
   curl -s -f https://ai-marketing-organization.onrender.com/health
   # Expected: HTTP 200 {"status": "ok", ...}
   ```
2. **Cuelinks Status Check (Authenticated):**
   ```bash
   curl -s -H "x-owner-token: $OWNER_TOKEN" https://ai-marketing-organization.onrender.com/api/v1/owner/cuelinks/status
   # Expected: HTTP 200 {"configured": true, "connected": true, "channel": {"id": 331585, "status": "approved"}}
   ```
3. **Public Deal Listing:**
   ```bash
   curl -s -f https://ai-marketing-organization.onrender.com/public/deals
   # Expected: HTTP 200 with list of verified deals including boAt Airdopes 141 ANC
   ```
4. **Single Deal Detail by Slug:**
   ```bash
   curl -s -f https://ai-marketing-organization.onrender.com/public/deals/boat-airdopes-141-anc
   # Expected: HTTP 200 with deal specifications and pricing (INR 1,399)
   ```
5. **Simulated Redirect Attributed Check:**
   ```bash
   curl -s -I -H "User-Agent: Mozilla/5.0" "https://ai-marketing-organization.onrender.com/public/deals/boat-airdopes-141-anc/redirect?placement=smoke_test"
   # Expected: HTTP 302 Found
   # Location: https://linksredirect.com/?cid=4232&subid=clk_...
   ```
6. **Zero-Token Cron Verification:**
   Verify Render application logs show `/api/v1/cron/ping` responded in < 500ms with 0 Gemini API token spend.
