# sitefix-check

Zero-install CLI for **SiteFix Launch Gate** — deterministic pre-deployment website QA for HTML metadata, Open Graph, Schema.org JSON-LD, `robots.txt`, and `sitemap.xml`.

## Usage

```bash
npx sitefix-check https://your-site.com --confirm-authorized
npx sitefix-check https://your-site.com --confirm-authorized --fail-on-critical
npx sitefix-check https://your-site.com --confirm-authorized --json
```

## Required Authorization

- `--confirm-authorized`: Required flag confirming you own or are explicitly authorized to audit the target URL (or set `SITEFIX_CONFIRM_AUTHORIZED=true`). Omitting this flag fails closed with exit code `2` before any network request is made.

## Options

- `--fail-on-critical`: Exit with status code `1` if any `CRITICAL` defect is found (CI/CD launch gate).
- `--api-url <url>`: Override the SiteFix API base URL (default: `https://ai-marketing-organization.onrender.com`).
- `--json`: Output machine-readable JSON findings with distinct `checkId` values.
- `--summary-file <path>`: Append a Markdown pass/fail evidence report (ideal for `$GITHUB_STEP_SUMMARY`).
