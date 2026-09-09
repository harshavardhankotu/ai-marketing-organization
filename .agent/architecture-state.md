# Architecture State: AI Marketing Organization

## Core Architecture
- **Monorepo**: npm workspaces (`packages/shared`, `packages/backend`, `packages/frontend`)
- **Backend**: Hono TypeScript API server + Better-SQLite3 (local / testing) and Cloudflare D1-compatible relational schema.
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Lucide Icons.
- **AI Model**: Google Gemini 3.8 Flash (`gemini-3.8-flash`) with thinking levels (`low`, `medium`, `high`).
- **Quota & Safety**: Rate-limiting token bucket, priority queue (CRITICAL, HIGH, NORMAL, LOW, BACKGROUND), circuit breaker, SHA-256 deduplication cache.
- **80-Agent Registry**: 4 divisions x 20 specialized agents with structured input/output contracts.
- **Control Plane**: Supervisory services (AI CEO, Strategy Manager, Task Planner/Dispatcher, Approval Manager, Global Kill Switch, Brand Guardian, Budget Controller, Learning Manager).
- **Durable Execution**: Workflow state machine with steps, checkpoints, idempotency keys, and crash resumption.
- **Multi-Scoped Memory**: Business, Market, Campaign, Agent, System memory.
- **Decision Journal & Closed-Loop Evolution**: Observations -> Hypotheses -> Experiments -> Results -> Learnings -> Strategy v(N+1).
- **Integrations**: Multi-channel adapters (Google, Meta, WhatsApp, Email) with live credential check and explicit Sandbox/Test Mode.