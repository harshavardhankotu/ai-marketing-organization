# OWNER DECISION SHEET & COMMERCIAL PROPOSAL: SITEFIX AI (V6.0)

**Product Name:** SiteFix AI — Website Audit & Optimization Pack  
**Product SKU:** `SITE_AUDIT_FIXPACK`  
**Status:** PROPOSED — PENDING OWNER DECISION & ATTESTATION  
**Target Audience:** Local service businesses, Indian dental/medical practices, freelancers, Shopify store owners  
**Revenue Model:** Digital Self-Serve Micro-SaaS Download (Automated Delivery)  

---

## 1. Executive Summary & Problem Validation

Generic cold outreach campaigns (unsolicited WhatsApp and email drafts) fail to convert and create severe reputational, DPDP compliance, and carrier blocking risks. 
By contrast, inbound searchers who run a free technical diagnostic tool have **active commercial intent**: they want to know why their website isn't ranking, why their Open Graph social previews look broken on WhatsApp, or why their Schema.org structured data fails Google's Rich Results test.

**SiteFix AI** satisfies this demand by providing:
1. An instant, free, factual on-page technical scan (OWASP SSRF-protected).
2. A deterministic technical audit score (0-100) with categorized findings.
3. A downloadable **Optimization Pack (Fix-Pack)** containing copy-paste `<head>` tags, Open Graph cards, valid Schema.org JSON-LD templates with honest placeholders, and CMS installation guides (WordPress, Shopify, HTML).

---

## 2. Proposed Commercial Terms for Owner Confirmation

| Commercial Parameter | Proposed Value | Owner Decision |
|---|---|---|
| **Product SKU** | `SITE_AUDIT_FIXPACK` | [ ] Approved [ ] Modify |
| **Proposed Price** | ₹499 one-time (digital download) | [ ] Approved (₹499) [ ] Alternative: ₹_______ |
| **Currency** | INR (Indian Rupee) | [ ] Approved |
| **Delivery Mechanism** | Instant automated digital delivery via cryptographically signed HMAC token (72-hour expiry) | [ ] Approved |
| **Refund Policy** | 100% full refund within 7 days if deliverable generation fails or contains persistent technical errors | [ ] Approved [ ] Modify |
| **Customer Support Scope** | Asynchronous email support within 24 hours for download or generation issues | [ ] Approved |
| **Tax / Invoice Treatment** | Digital software deliverable; GST invoice generated on demand | [ ] Approved |

---

## 3. Scope of Digital Deliverable (Fix-Pack)

The paid deliverable generated for verified purchasers contains:
1. **Recommended HTML `<head>` Block:** Concise, keyword-optimized title tag (30-65 chars), descriptive meta description (50-160 chars), self-referential canonical URL, responsive viewport meta, and UTF-8 charset.
2. **Social Graph Metadata:** Full Open Graph (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`) and Twitter/X card (`summary_large_image`) snippets.
3. **Valid Schema.org JSON-LD Template:** Tailored structured data with explicit placeholders (`[INSERT_YOUR_BUSINESS_PHONE]`, `[INSERT_STREET_ADDRESS]`). **Zero hallucination:** never invents fake phone numbers, reviews, or ratings.
4. **Step-by-Step Installation Guides:** Detailed, non-technical instructions for:
   - WordPress (via WPCode, Rank Math, or Yoast)
   - Shopify (`theme.liquid`)
   - Custom HTML / Next.js / Static Site Generators
5. **Machine-Readable JSON Report:** Complete raw audit findings with severities, locations, and recommendations.
6. **Mandatory Legal Notice:**
   > *"Generated optimization files are suggestions for the customer to review and install. This tool does not modify the customer's website or guarantee rankings, traffic, or sales."*

---

## 4. Production Deployment & Attestation Steps (Owner Action Required)

The checkout path is currently gated in production (`PENDING_OWNER_ATTESTATION`). 
To activate live commercial transactions once approved:

1. **Calculate Terms SHA256:**
   Compute the SHA-256 hash of this approved decision sheet.
2. **Set Production Environment Variables on Render:**
   - `SITE_AUDIT_TERMS_ATTESTED=true`
   - `SITE_AUDIT_TERMS_SHA256=<calculated_hash>`
   - `SITE_AUDIT_SIGNING_SECRET=<unguessable_random_secret_at_least_32_chars>`
   - `RAZORPAY_KEY_ID=<live_razorpay_key_id>`
   - `RAZORPAY_KEY_SECRET=<live_razorpay_key_secret>`
   - `RAZORPAY_WEBHOOK_SECRET=<live_razorpay_webhook_secret>`
3. **Verify Public Endpoints:**
   - Public Tool UI: `https://ai-marketing-organization.onrender.com/tools/site-audit`
   - Scanner API: `POST https://ai-marketing-organization.onrender.com/api/v1/tools/site-audit/scan`
   - Checkout API: `POST https://ai-marketing-organization.onrender.com/api/v1/tools/site-audit/checkout`
   - Deliverable Download API: `GET https://ai-marketing-organization.onrender.com/api/v1/tools/site-audit/:auditId/deliverable?token=...`
