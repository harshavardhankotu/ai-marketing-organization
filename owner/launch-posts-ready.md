# Ready-to-Publish Launch Posts — SiteFix AI

This document contains 3 community-aligned, factual launch posts for SiteFix AI's free diagnostic tool suite and copy-paste optimization packages.

All posts strictly follow `docs/STANDING_ORDERS.md`:
- Zero cold outreach, zero unsolicited DMs, zero synthetic traffic, zero aggressive sales claims.
- Focus exclusively on technical utility: free instant inspection of live HTML `<head>` tags, Open Graph, Twitter Cards, Schema.org JSON-LD syntax, and search accessibility directives.

---

## 1. Hacker News — Show HN

**Title:** Show HN: SiteFix AI – Free single-URL website diagnostic and copy-paste tag generator

**URL / Link:** `https://ai-marketing-organization.onrender.com/tools/site-audit`

**Post Body:**

```text
Hi HN,

I built SiteFix AI because I was frustrated by bloated SEO audit tools that force you into a monthly subscription or demand your email just to tell you that your Open Graph image is missing width/height attributes.

SiteFix AI provides 5 deterministic, free diagnostic tools that run instantly against any public HTTPS URL:
1. Full Website Technical Audit: Inspects title, meta description, viewport, canonical URL, and search crawler tags.
2. WhatsApp Link Preview Checker: Inspects og:title, og:description, and validates whether your og:image is a direct HTTPS URL with declared dimensions.
3. Open Graph & Twitter Card Checker: Validates LinkedIn/Facebook social cards and Twitter/X summary_large_image declarations.
4. Schema.org JSON-LD Tester: Checks for JSON syntax errors and extracts Organization/WebSite/Product schema entities.
5. Robots & Sitemap Validator: Verifies crawler accessibility and sitemap declarations.

Key principles behind the system:
- Zero login or signup: You paste a URL and get real findings in seconds.
- Zero invented metrics: We don't synthesize fake health scores or predict ranking numbers. If a tag is missing, we quote the exact line and explain what spec requires it.
- Fail-closed deterministic generation: For owners who want ready-to-paste snippets, our backend generates clean, validated <head> tags, robots.txt directives, and Schema.org JSON-LD tailored to the scanned page.

You can try the free audit here:
https://ai-marketing-organization.onrender.com/tools/site-audit

WhatsApp preview checker:
https://ai-marketing-organization.onrender.com/tools/whatsapp-link-preview-checker

Open Graph validator:
https://ai-marketing-organization.onrender.com/tools/open-graph-checker

Would love your feedback on the parser accuracy and what edge cases you've encountered with messaging app link unfurls.
```

---

## 2. Dev.to / Hashnode / Indie Hackers

**Title:** Why WhatsApp Link Previews Break and How to Test Open Graph Tags Deterministically

**Cover Image / Tags:** `#webdev`, `#javascript`, `#seo`, `#html`

**Post Body:**

```markdown
Every developer has experienced this: your website looks great in your browser, but when you share the link in a WhatsApp chat or on LinkedIn, it unfurls as an empty gray rectangle or pulls an unrelated icon from your footer.

Here is why messaging app previews fail and what crawlers actually expect:

### 1. Messaging Crawlers Do Not Run Client-Side JavaScript
WhatsApp (via `WhatsApp/2.x.x`), Facebook (`facebookexternalhit`), and Twitter (`Twitterbot`) fetch only the initial raw HTML response. If your meta tags are injected client-side via React or Vue without Server-Side Rendering (SSR) or pre-rendering, crawlers see an empty document.

### 2. The HTTPS and Dimension Requirement
WhatsApp is strict about images:
- The `og:image` URL must start with `https://`. Relative paths like `/banner.png` or plain `http://` links are ignored.
- Declaring `og:image:width` and `og:image:height` (recommended: 1200x630) allows WhatsApp and LinkedIn to render the card immediately on the first share without having to download and measure the image asset first.

### 3. Missing Fallbacks
If `twitter:title` or `twitter:description` is not defined, Twitter falls back to `og:title` and `og:description`. But if neither exists, it falls back to the `<title>` tag—often producing an awkward truncated headline.

### Inspecting Your Site in 5 Seconds
To make testing these tags painless without signing up for paid SaaS platforms, I built a set of free diagnostic pages:

- **WhatsApp Preview Inspector:** https://ai-marketing-organization.onrender.com/tools/whatsapp-link-preview-checker
- **Open Graph & Twitter Card Validator:** https://ai-marketing-organization.onrender.com/tools/open-graph-checker
- **Schema.org JSON-LD Syntax Tester:** https://ai-marketing-organization.onrender.com/tools/json-ld-tester
- **Full Site Technical Audit:** https://ai-marketing-organization.onrender.com/tools/site-audit

Each tool is fast, requires no account, and shows both the observed HTML tags and plain-English recommendations.
```

---

## 3. Reddit (r/SideProject / r/webdev)

**Title:** I built a free, no-signup tool to test WhatsApp previews, Open Graph tags, and Schema.org markup

**Post Body:**

```text
Hey everyone,

I got tired of the friction in existing SEO and social preview testing tools—most of them either require an account, spam you with upsells, or take 30 seconds to run.

I put together a set of lightweight, free diagnostic tools focused on the technical fundamentals:

- WhatsApp Link Preview Checker: Simulates what recipients see when your URL is shared in chat and checks your og:title, og:description, and https og:image tags.
- Open Graph & Twitter Validator: Checks LinkedIn, Facebook, and Twitter/X Card formatting.
- Schema.org JSON-LD Validator: Parses embedded JSON-LD scripts to catch syntax errors and missing schema fields.
- Robots.txt & Sitemap Checker: Checks search engine crawler access and sitemap declarations.

Link: https://ai-marketing-organization.onrender.com/tools/site-audit

No signup, no tracking cookies, no paywalls on the diagnostic reports. If you test your site and spot any parser quirks, let me know!
```
