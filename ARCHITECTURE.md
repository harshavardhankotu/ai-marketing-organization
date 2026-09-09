# Architecture Guide: AI Marketing Organization

## Monorepo Layout
```
ai-marketing-organization/
├── packages/
│   ├── shared/            # India-first constants, domain entities, Zod schemas, 80-agent contracts
│   │   ├── src/constants/ # Indian languages, cities, SMB verticals, festive seasonality
│   │   ├── src/types/     # TypeScript domain definitions
│   │   ├── src/schemas/   # Zod validation schemas
│   │   └── src/contracts/ # 80 Canonical Agent Contracts & Control Plane protocols
│   ├── backend/           # Modular monolith API & Orchestration Engine (Hono + SQLite/D1)
│   │   ├── src/ai/        # Gemini 3.8 Flash, Quota Manager, Deduplication
│   │   ├── src/agents/    # 80-Agent runtime execution harness
│   │   ├── src/control-plane/ # AI CEO, Kill Switch, Approval Manager, Learning Manager
│   │   ├── src/workflows/ # Durable state machine with checkpoints & Closed Loop Cycle
│   │   ├── src/analytics/ # Event tracking, Multi-touch Attribution, Metrics engine
│   │   ├── src/integrations/ # WhatsApp, Meta Ads, Google Profile, Email Adapters
│   │   └── src/db/        # SQLite / Cloudflare D1 schema (40+ tables) and seed script
│   └── frontend/          # Modern SaaS Dashboard (React 19 + Vite + Tailwind CSS)
└── .github/workflows/     # CI/CD GitHub Actions workflow
```

## Durable Workflow State Machine & Interruption Recovery
Every workflow execution is checkpointed at each stage:
1. `INIT`
2. `CHECKPOINTED(RESEARCH)`
3. `CHECKPOINTED(STRATEGY)`
4. `CHECKPOINTED(CAMPAIGN)`
5. `CHECKPOINTED(CONTENT)`
6. `CHECKPOINTED(PUBLICATION)`
7. `CHECKPOINTED(TELEMETRY)`
8. `CHECKPOINTED(EXPERIMENT)`
9. `COMPLETED(EVOLUTION)`

If execution is interrupted (network timeout, machine restart, model stream close), the workflow engine loads the canonical checkpoint snapshot from the `workflow_checkpoints` table and resumes from the next required action without loss of state.

## Multi-Touch Attribution Mathematics
- **First Touch**: Credit = 1.0 to initial touchpoint.
- **Last Touch**: Credit = 1.0 to final touchpoint.
- **Linear**: Credit = 1 / N for all N touchpoints.
- **Assisted Conversion**: 40% initial discovery, 40% final conversion, 20% divided across intermediate nurturing interactions.