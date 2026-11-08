# 08_ci_audit.md

Audit Timestamp: 2026-11-08T06:46:24.870Z

## File: .github/workflows/autonomous-commercial-cycle.yml


## File: .github/workflows/ci.yml


## File: .github/workflows/deploy-cron-worker.yml

- **Line 91** [|| true]: `run: npm install --ignore-scripts || true`
- **Line 107** [|| true]: `WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -n 1 || true)`
- **Line 135** [|| true]: `cat ping_response.json || true`
- **Line 178** [|| true]: `cat readiness_response.json || true`

## File: .github/workflows/deploy-guides.yml


## Summary of Suppressed Failures / Soft Steps in CI
UTC Timestamp: 2026-11-08T06:46:24.876Z

| File | Line Number | Suppressed Pattern | Exact Code Snippet | Risk Assessment |
| :--- | :--- | :--- | :--- | :--- |
| `.github/workflows/deploy-cron-worker.yml` | 91 | `|| true` | `run: npm install --ignore-scripts || true` | Step failure will not break the build/pipeline |
| `.github/workflows/deploy-cron-worker.yml` | 107 | `|| true` | `WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -n 1 || true)` | Step failure will not break the build/pipeline |
| `.github/workflows/deploy-cron-worker.yml` | 135 | `|| true` | `cat ping_response.json || true` | Step failure will not break the build/pipeline |
| `.github/workflows/deploy-cron-worker.yml` | 178 | `|| true` | `cat readiness_response.json || true` | Step failure will not break the build/pipeline |
