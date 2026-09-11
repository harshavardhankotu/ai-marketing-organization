# Production Security: Secret Management & Data Isolation

This document outlines the strict production security directives enforced across the **AI Marketing Organization**.

---

## 1. Zero Placeholder Policy in Production

In accordance with strict production requirements, the application will **refuse to start** or **reject requests** if placeholder credentials or demo keys are detected when running in production (`NODE_ENV=production`).

### Blocked Values
The following values are strictly prohibited in production:
* `demo_key`
* `placeholder`
* `your_key_here`
* `your_gemini_api_key`
* `test_key`
* `test`
* `dummy`
* `change_me`
* Bracketed templates such as `<YOUR_KEY>` or `${KEY}`
* Truncated example strings such as `AIzaSy...your_real_key_here`
* Empty or whitespace-only keys
* Keys with fewer than 10 characters

If any of these values are present in `GEMINI_API_KEY` under `NODE_ENV=production`, [`validateProductionSecrets()`](file:///packages/backend/src/config/env.ts) throws a `ProductionSecretViolationError` and the server halts immediately with exit code 1.

---

## 2. Production Secrets Must Come From Deployment Secrets

Production secrets must **never** be committed to Git or hardcoded in configuration files. They must be injected securely from your target platform's secrets manager.

### A. Cloudflare Workers / Pages
Use Wrangler CLI or Cloudflare Dashboard to bind secrets securely to the runtime environment:
```bash
# Add Gemini API Key as an encrypted secret
npx wrangler secret put GEMINI_API_KEY

# Add payment gateway secrets (if processing live transactions)
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put CASHFREE_SECRET_KEY
```
*Note*: Plaintext variables in `wrangler.jsonc` `vars` must only contain non-sensitive configuration (e.g. `NODE_ENV`, `PORT`).

### B. Docker Compose / Containers
In [`docker-compose.yml`](file:///docker-compose.yml), secrets are configured without default fallback:
```yaml
environment:
  - NODE_ENV=production
  - PORT=3001
  - GEMINI_API_KEY=${GEMINI_API_KEY:?Error: GEMINI_API_KEY deployment secret must be provided for production}
```
If `GEMINI_API_KEY` is omitted, Docker Compose will refuse to start the container. Provide the secret at runtime via environment or `.env.production` (which is excluded from Git):
```bash
GEMINI_API_KEY="AIzaSy..." docker compose up -d
```

### C. GitHub Actions CI/CD
In `.github/workflows/ci.yml`, test suites run in `NODE_ENV=test` using the built-in domain synthesis engine. For production CD pipelines, map the GitHub Repository Secret:
```yaml
env:
  NODE_ENV: production
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

---

## 3. Strict Distinction Between TEST and REAL Data

To guarantee revenue integrity and prevent synthetic numbers from contaminating financial statements, the system enforces strict tri-state isolation:

| Classification | Meaning | Restrictions |
|---|---|---|
| **`REAL`** | Actual patient leads and bank/gateway-verified revenue | Cannot use `SIMULATED` gateway. Must have verified audit trails or webhook references. |
| **`TEST`** | Staging and pre-launch validation transactions | Isolated from financial accounting. Reported separately under `testRevenueINR`. |
| **`SIMULATED`**| Agent sandbox executions and theoretical scenarios | Never counted in transactional ledgers or conversion metrics. |

### Verification Guarantees
1. **Gateway Enforcement**: Attempting to record a `REAL` transaction using a `SIMULATED` payment gateway throws an error:
   ```
   Cannot record REAL revenue using a SIMULATED payment gateway. REAL revenue must come from verified sources or production gateways.
   ```
2. **Production ROAS Isolation**:
   In `NODE_ENV=production`, `getRevenueSummary` computes `roas` **strictly** using `realRevenueINR / totalAdSpend`. Test revenue never supplements or masks real financial performance. Both `realRoas` and `testRoas` are exposed as distinct fields.
