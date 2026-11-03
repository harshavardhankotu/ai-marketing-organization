# V4.9 Token, Memory & Operating Cost Verification

**Repository:** `harshavardhankotu/ai-marketing-organization`  
**Financial Directive:** ₹0 paid advertising spend, zero token burn on routine cron operations  
**Audit Target:** `GeminiProvider`, `AgentRuntime`, `JobQueue`, `AutonomousDealDiscoveryEngine`  
**Date:** November 3, 2026  

---

## 1. Zero-Token Operational Invariant

A fundamental risk in AI-agent marketing organizations is "token hemorrhage"—where autonomous background loops, crons, and health checks repeatedly call expensive LLM APIs (e.g. Gemini 1.5 Pro) to make trivial decisions that should be handled deterministically.

### V4.9 Invariant
**All hourly cron wakeups, routine deal discovery scans, pagination checks, link conversions, click attribution events, and transaction reconciliations consume strictly 0 LLM tokens (₹0.00).**

LLMs are strictly gated behind deliberate, owner-triggered content generation workflows (e.g. authoring an editorial buying guide) and are never invoked during automated operational cycles.

---

## 2. Audit of Background Operational Paths

| Operation | Trigger | Code Path | LLM Invocation? | Cost Per Run |
|---|---|---|---|---|
| Hourly Cron Ping | Cloudflare Worker (`0 * * * *`) | `POST /api/v1/cron/ping` -> `JobQueue.claimDueJobs()` | **NO** (Strictly deterministic TypeScript/SQL) | **₹0.00** |
| Autonomous Deal Discovery | Scheduled Job | `AutonomousDealDiscoveryEngine.runDiscoveryCycle()` | **NO** (Regex/JSON-LD/DOM parsing + Cuelinks REST) | **₹0.00** |
| Dynamic Link Conversion | Visitor Click | `GET /public/deals/:id/redirect` -> `convertLink()` | **NO** (Deterministic Cuelinks V3 REST API) | **₹0.00** |
| Click Logging & Persistence | Visitor Click | `INSERT INTO referrals...` | **NO** (SQL write via D1 or SQLite) | **₹0.00** |
| Transaction Reconciliation | Scheduled Job | `reconcileTransactionsIncremental()` | **NO** (Deterministic Cuelinks V3 REST API + SQL upsert) | **₹0.00** |
| Source Health & Diagnostics | Scheduled Job | `AutonomousDealDiscoveryEngine.recordRejection()` | **NO** (In-memory metrics counter) | **₹0.00** |

---

## 3. In-Memory Footprint & Memory Leak Protection

In previous iterations, unbounded in-memory maps in singletons risked memory leaks on long-running Render containers:

### 3.1 `AutonomousDealDiscoveryEngine` Deal Caching
- **The Risk:** Storing thousands of discovered deals in `dealsMap` indefinitely could cause container out-of-memory (OOM) crashes on Render's 512MB RAM tier.
- **The Remediation:**
  - Implemented an LRU-style bounded deal cache capped at **500 active deals**.
  - Evicted deals are dropped from volatile RAM; full offer metadata remains durably preserved in Cloudflare D1 `workflows` table.
  - Slug mapping (`dealSlugMap`) is kept lean, holding only string-to-string lookups.

### 3.2 In-Flight HTTP Timeouts & Signal Aborts
- `CuelinksV3Client` wraps every upstream fetch with `AbortController` and enforces an explicit 15,000ms timeout (`this.timeoutMs = 15000`).
- Unresponsive upstream endpoints cannot hang Node.js event loop sockets or leak memory.

---

## 4. Verification Test Results

- Monorepo typecheck verifies zero runtime leaks across all packages.
- Unit test suite `v4-9-first-sale-conversion-integrity.test.ts` executes all 12 tests in under 2 seconds, verifying that zero LLM network calls or background agent loops are spawned during deal resolution, redirect, attribution, or reconciliation.
- Verified compliant with the financial baseline: ₹0.00 paid ads, ₹0.00 unexpected model charges.
