# Decision Log

### DEC-001: Monorepo Structure & Cloudflare-compatible Hono
- **Date**: 2026-09-10
- **Context**: Need a free-first, high performance, edge-deployable backend that runs seamlessly locally and on Cloudflare Workers/D1.
- **Decision**: Used npm workspaces with Hono HTTP engine, Better-SQLite3 for local dev/testing, and D1/R2 compatible design.
- **Alternatives Considered**: Fastify/Express (not edge/Cloudflare compatible), Next.js (heavyweight).
- **Outcome**: Fast startup, zero-overhead edge portability.

### DEC-002: Exact Model & Quota Protection
- **Date**: 2026-09-10
- **Context**: Free-tier Gemini limits can hit 429 if 80 agents run concurrently.
- **Decision**: Primary model `gemini-3.8-flash`. Agents are logical units, not concurrent background threads. Priority task queue with max 3 concurrent calls, exponential backoff, SHA-256 deduplication cache.

### DEC-003: Revenue Integrity & Tri-State Data Isolation
- **Date**: 2026-09-10
- **Context**: Marketing without verified business revenue is vanity, but mixing synthetic demo data with real business revenue is dishonest.
- **Decision**: Implemented strict tri-state data classification (`REAL`, `TEST`, `SIMULATED`) across all transactions, customer journeys, and attributions. Only audited gateway/clinic transactions are counted towards real revenue.
- **Outcome**: Completely trustworthy financial metrics with zero synthetic pollution.

### DEC-004: Workspace Governance via .agents/rules/
- **Date**: 2026-09-10
- **Context**: Require persistent, non-ephemeral development guidelines that survive model restarts.
- **Decision**: Created 5 modular workspace rules in `.agents/rules/`: repository-first, verification-before-claims, revenue-integrity, safe-git, and india-first-domain.
- **Outcome**: Standardized agent behavior, robust error prevention, and continuous compliance.

### DEC-005: Idempotent Payment Webhooks & Public Patient Capture
- **Date**: 2026-09-11
- **Context**: Real revenue experiments require receiving leads from patients and webhooks from gateways (Razorpay, Cashfree, UPI) without duplicate billing or webhook retry storms.
- **Decision**: Built public lead intake (`POST /api/v1/public/lead`) with Indian mobile formatting and auto-attribution to active campaigns. Built idempotent webhook ingestion returning HTTP 200 with `{ duplicate: true }` upon detecting repeated transaction references or invoice numbers.
- **Outcome**: Resilient real-time lead capture and double-entry payment reconciliation.

### DEC-006: Tenant Isolation & Multi-Cloud Deployment Readiness
- **Date**: 2026-09-11
- **Context**: High-risk healthcare businesses require strict tenant data isolation, audit trails on manual revenue entry, and multi-cloud deployment specs (Cloudflare Workers/Pages and Docker).
- **Decision**: Implemented tenant isolation checks preventing cross-organization data access, verified manual revenue entry requiring audit references and user attribution, Cloudflare `wrangler.jsonc` configs, and multi-stage Dockerfile.
- **Outcome**: Verified tenant security (tested), schema portability (`schema.sql`), and 1-command deployment readiness.

### DEC-007: Production Placeholder Rejection & Secrets Enforcement
- **Date**: 2026-09-11
- **Context**: Production environments must never allow placeholder credentials, demo keys, or synthetic numbers to bleed into real financial accounting.
- **Decision**: Implemented `validateProductionSecrets()` halting production startups on placeholders or `demo_key`. Enforced that `docker-compose.yml` requires `${GEMINI_API_KEY}` without fallback. Prohibited recording `REAL` revenue using `SIMULATED` gateways. Isolated production ROAS calculation strictly to verified real revenue (`realRevenueINR / totalAdSpend`).
- **Outcome**: Fail-safe production security and complete isolation of real financial performance from test scenarios.