# API Contract Specification

All endpoints are mounted under `/api/v1` and return typed JSON responses:

### Core Endpoints
- `GET /health` - System health, timestamp, and version.
- `GET /quota` - Gemini token usage, free-tier limits, and circuit breaker status.
- `GET /agents` - Full catalog of 80 agents with live status and metrics.
- `GET /agents/:id` - Inspector details for a single agent.
- `GET /business` - Profile of active business (offerings, budget, brand voice).
- `POST /business` - Register new business profile.
- `GET /goals` - Business goals and KPIs.
- `POST /goals` - Create new measurable goal.
- `POST /workflows/trigger-cycle` - Trigger complete closed-loop autonomous cycle.
- `GET /campaigns` - Active and historical marketing campaigns.
- `GET /content` - Multi-channel drafted and approved content assets.
- `GET /research` - Evidence-first market research findings.
- `GET /analytics/dashboard` - Unified KPIs, recent events, and attributions.
- `GET /experiments` - Hypothesis testing results and scale decisions.
- `GET /evolution` - Strategy versions (v1, v2...), learnings, and decision journal.
- `GET /approvals` - Human-in-the-loop pending approval requests.
- `POST /approvals/resolve` - Approve, reject, or request changes with notes.
- `POST /kill-switch` - Global emergency stop toggle.
- `GET /integrations` - Channel adapters health and sandbox status.
- `GET /activity` - Audit logs and event trail.