# Public Site QA Workflow (`/run-workflow`)

Run end-to-end automated quality, security, D1-reliability, and commercial integrity checks across the public website (`/`, `/demo`, `/offer`, `/b2b/checkout`) using `/run-workflow`.

## Targets
- Routes: `/`, `/demo`, `/offer`, `/b2b/checkout`
- Mobile viewport: `390x844` (zero horizontal overflow, zero floating-widget occlusion, single-row or compact nav)
- Checks: SEO `<title>` / `<meta name="description">` / `<link rel="canonical">`, zero console/CSP errors, checkout price authority, zero D1 unbounded scans.

## Python Orchestration (`run_workflow`)

```python
# Stage 1: Deterministic Pre-flight (local typecheck + compliance linters + read-only curl checks)
preflight = phase("Pre-flight")
lint_res = call_tool("run_command", {
    "CommandLine": "npm run typecheck; npm run lint:owner-prices; npm run lint:owner-claims; npm run lint:rupee-estimates; npm run board:verify",
    "WaitMsBeforeAsync": 10000,
    "toolSummary": "Run typecheck and compliance linters"
})

# Stage 2: Parallel Read-Only Domain Audits across the 4 specialized subagents
audits = phase("Parallel Audits")
ux_audit, sec_audit, d1_audit, rev_audit = parallel(
    agent(
        type_name="product-ux-auditor",
        prompt="Audit /, /demo, /offer, and /b2b/checkout at 390x844 mobile viewport, SEO tags, console/CSP errors, nav hygiene, and legal footers."
    ),
    agent(
        type_name="security-auditor",
        prompt="Audit HttpOnly cookie auth, CSRF Origin/Referer guards, CSP headers, Instagram OAuth postMessage, /b2b/pilot-proposal rate limits, and protect-and-sanitize.cjs."
    ),
    agent(
        type_name="reliability-d1-auditor",
        prompt="Audit D1 read queries, zero new .sql migrations (baseline 0050), and CommercialSchedulePolicy alignment with wrangler.toml."
    ),
    agent(
        type_name="commercial-revenue-auditor",
        prompt="Audit Founding Pilot ₹1,999 copy, B2B checkout server-side price authority, ₹0 cash truth, and zero fabricated testimonials."
    )
)

# Stage 3: Independent Final Verification Gate
verify = phase("Verify")
final_gate = agent(
    type_name="independent-verifier",
    prompt=f"Synthesize and independently verify findings from Stage 1 and Stage 2. Confirm raw machine evidence for PASS/PARTIAL/FAIL.\nUX: {ux_audit}\nSEC: {sec_audit}\nD1: {d1_audit}\nREV: {rev_audit}"
)
```
