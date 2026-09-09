# Operations & Troubleshooting Guide

## Health Checking
- Run `curl http://localhost:3001/api/v1/health`
- Run `curl http://localhost:3001/api/v1/quota`

## Troubleshooting Common Scenarios

### 1. Gemini 429 Quota Exhaustion
- The QuotaManager circuit breaker will trip automatically for 30s.
- Non-essential background tasks are queued.
- Critical path workflows continue using the SHA-256 deduplication cache.

### 2. Interrupted Autonomous Workflow
- If a server process terminates during a workflow, inspect `SELECT * FROM workflow_checkpoints WHERE workflow_id = ?`.
- The engine will automatically resume from the last valid checkpoint on restart.