---
name: amazon-associates-compliance
description: On-demand compliance rules for optional Amazon Associates India integration (6 statutory env vars, no scraping amazon.in, manual product_checked, disclosure).
---

# Amazon Associates Compliance Skill (On-Demand)

## Purpose
Load this skill only when working on Amazon Associates India links, disclosures, or statutory owner-fact configuration.

## Statutory Rules
1. **6 Required Owner-Fact Environment Variables**:
   - `ASSOCIATES_APPLICATION_DATE`
   - `ASSOCIATES_LISTED_SITE_URL`
   - `ASSOCIATES_AGREEMENT_READ`
   - `PUBLIC_SITE_NAME`
   - `PUBLIC_AUTHOR_NAME`
   - `PUBLIC_CONTACT_EMAIL`
   Never guess, default, or fabricate owner facts; only the human owner supplies them.
2. **Zero Scraping**: Never fetch or scrape `amazon.in` or `amazon.*` product pages directly (violates `robots.txt` and Operating Agreement).
3. **Human Verification**: Never mark Amazon partner approval or `product_checked` on behalf of the owner. The owner manually supplies clean Amazon product URLs and confirms consumer/SMB purchase eligibility.
4. **Secret & Tag Hygiene**: Never print raw Amazon affiliate tracking tags in logs, responses, or committed files.
5. **Disclosure**: Any page containing Amazon referral links must display the statutory `"As an Amazon Associate I earn from qualifying purchases."` / `#Ad` disclosure.
