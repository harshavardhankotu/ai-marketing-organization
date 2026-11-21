# sitefix-check

Zero-install, **100% local** CLI for **SiteFix Launch Gate** — deterministic pre-deployment website QA for HTML metadata, Open Graph, Schema.org JSON-LD, `robots.txt`, and `sitemap.xml`.

All diagnostic scans run **locally** in your terminal or CI runner using `@ai-marketing/sitefix-core` with zero remote cold-start latency.

## Usage

```bash
# Run a local deterministic pre-deployment scan (zero remote scan calls)
npx sitefix-check https://your-site.com --confirm-authorized

# Fail CI builds when any CRITICAL defect (e.g., missing <title>, noindex, broken JSON-LD) is found
npx sitefix-check https://your-site.com --confirm-authorized --fail-on-critical

# Machine-readable JSON output with Fix-Pack preview & checkout URL
npx sitefix-check https://your-site.com --confirm-authorized --json

# Download your paid ₹499 Fix-Pack (SKU: SITEFIX_AI_PACK_V1) after verified payment
npx sitefix-check --unlock <orderToken> --out ./sitefix-pack
```

## Required Authorization

- `--confirm-authorized`: Required flag confirming you own or are explicitly authorized to audit the target URL (or set `SITEFIX_CONFIRM_AUTHORIZED=true`). Omitting this flag fails closed with exit code `2` before any network request is made.

## Options

- `--source <src>`: Attribution source for the Fix-Pack checkout link (`cli`, `action`, `web`, `mcp`; default: `cli`).
- `--fail-on-critical`: Exit with status code `1` if any `CRITICAL` defect is found (CI/CD launch gate).
- `--html-file <path>`: Audit a local pre-deploy HTML file against the target canonical URL.
- `--unlock <orderToken>`: Calls the SiteFix backend API **only** to download a paid Fix-Pack after verified payment.
- `--out <dir>`: Write unlocked Fix-Pack HTML snippets, `robots.txt`, `sitemap.xml`, and `checklist.md` to `<dir>`.
- `--api-url <url>`: Override the SiteFix base URL for checkout links and `--unlock` (default: `https://ai-marketing-organization.onrender.com`).
- `--json`: Output machine-readable JSON findings with distinct `checkId` values and Fix-Pack preview.
- `--summary-file <path>`: Append a Markdown pass/fail evidence report (ideal for `$GITHUB_STEP_SUMMARY`).

## Free Browser Diagnostic Tools for Website Owners

Prefer a fast browser check for non-technical website owners? Use our free single-purpose web tools:

- [WhatsApp Link Preview Checker](https://ai-marketing-organization.onrender.com/tools/whatsapp-link-preview-checker) — Verify Open Graph metadata readiness (`og:title`, `og:description`, `og:image`, HTTPS image URL & dimensions)
- [Open Graph & Social Card Checker](https://ai-marketing-organization.onrender.com/tools/open-graph-checker) — Validate Open Graph & Twitter/X Card social share previews
- [Robots.txt & Sitemap.xml Validator](https://ai-marketing-organization.onrender.com/tools/robots-and-sitemap-validator) — Catch accidental `noindex` / `Disallow: /` blocks and verify `sitemap.xml` reachability
- [JSON-LD Schema Tester](https://ai-marketing-organization.onrender.com/tools/json-ld-tester) — Validate `application/ld+json` syntax and required `Organization`, `WebSite`, and `Product` fields
- [Full SiteFix Launch Gate Audit & ₹499 Fix-Pack](https://ai-marketing-organization.onrender.com/tools/site-audit)
