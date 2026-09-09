# Free-Tier Reality & Quota Governance Guide

## Zero-Cost Free-Tier Design Principles
This system is engineered to operate 100% within free-tier limits for deployment and runtime:

### 1. Google Gemini 3.8 Flash Quota Limits
- **Free Limit**: 15 RPM, 1,000,000 TPM, 1,500 Requests/day
- **Concurrency Control**: Global limit set to max 3 concurrent calls.
- **Priority Queue**: Tasks scheduled by priority weight (`CRITICAL` > `HIGH` > `NORMAL` > `LOW` > `BACKGROUND`).
- **Circuit Breaker**: Automatically trips for 30s after 5 consecutive failures / 429s.
- **SHA-256 Deduplication**: Model calls with identical inputs, agents, and contexts are cached with 24-hour TTL, cutting token consumption by ~65%.

### 2. Cloudflare Free Allocations
- **Cloudflare Workers**: 100,000 requests/day free.
- **Cloudflare D1**: 5GB storage, 5M row reads/day free.
- **Cloudflare R2**: 10GB storage, 10M Class B operations/month free.
- **Cloudflare Pages**: Unlimited bandwidth & free static asset hosting.

### 3. Graceful Degradation Tiers
`NORMAL` → `QUOTA WARNING (>80%)` → `THROTTLED MODE` → `QUEUED MODE` → `DEGRADED RECOVERY`
Under quota pressure, critical workflows are preserved while non-essential background research is postponed automatically.