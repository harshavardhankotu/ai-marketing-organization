# OWNER EXPOSURE DECISION: REPOSITORY VISIBILITY & IDENTIFIER AUDIT
========================================================================

> **DOCUMENT PURPOSE:** Owner-Only Risk Assessment & Architecture Options  
> **CURRENT REPOSITORY VISIBILITY:** Public (`https://github.com/harshavardhankotu/ai-marketing-organization`)  
> **POLICY STATUS:** Informational analysis. No automated changes permitted without human owner authorization.

---

## 1. Executive Summary

A security and privacy review of tracked files and commit history revealed that several personal and payment-related identifier types are present in tracked public assets and codebase history.

While public-facing payment handles (such as UPI VPAs or payment links) are not API secrets, public exposure in open-source repositories creates risks of unwanted solicitations, scraping, or unintentional attribution.

This document details:
1. Exact file paths and identifier types exposed.
2. The three concrete architecture options available to the owner.
3. Operational considerations regarding GitHub Actions and Render hosting integrations.

---

## 2. Identified Exposed Paths & Identifier Types

> *Note: In adherence to security protocols, exact values are redacted; only file paths and identifier types are listed.*

| File Path | Identifier Type | Exposure Context |
|---|---|---|
| `packages/backend/public/images/razorpay-upi-qr.jpg` | Payment QR Code Image | Static public asset serving manual checkout QR |
| `packages/frontend/public/images/razorpay-upi-qr.jpg` | Payment QR Code Image | Static public asset serving frontend payment views |
| `packages/backend/src/routes/api.ts` | Payment Page URL & UPI Handle Constants | Default fallback strings in manual payment route handlers |
| Historical Git Commits (Prior to Redaction) | Payment Page Link & UPI VPA Strings | Historical commit diffs in `owner/` drafts and migration notes |

---

## 3. The Three Architecture Options for the Owner

### Option A: Make Repository Private
- **Action:** Change GitHub repository visibility from Public to Private in repository settings (`Settings -> Change repository visibility -> Make private`).
- **Benefits:**
  - Instantly conceals all codebase files, historical commits, issues, and pull requests from public indexing and unauthenticated web scrapers.
  - Safely contains internal strategy memos, sales playbooks, and architectural discussions.
- **Critical Dependencies to Verify:**
  1. **Render.com Integration:** Render must have authorized GitHub OAuth / App permissions to access private repositories. If using a personal free plan, verify that Render's webhook and build access remain active.
  2. **GitHub Actions Quota:** Public repositories have unlimited standard GitHub Actions minutes; private repositories draw from a monthly free tier allocation (typically 2,000 minutes/month for free accounts). Given current test run times (~2 mins per push), normal development will comfortably fit within this threshold.

### Option B: Keep Repository Public & Externalize Identifiers to Environment Configuration
- **Action:**
  1. Remove static payment QR images (`razorpay-upi-qr.jpg`) from git tracking. Serve dynamic QR codes generated in-memory or host the QR asset on a secure private bucket / authenticated route.
  2. Move all payment URLs, UPI handles, and owner names to runtime environment variables (`RENDER` environment secrets) with zero hardcoded code fallbacks.
  3. Keep the repository public for open-source portfolio visibility.
- **Benefits:** Retains public visibility without committing personal payment identifiers to tracked source code.
- **Trade-off:** Historical git commits will still contain previously committed values unless history is rewritten (which requires owner consent and coordination).

### Option C: Keep Current State (Public with Existing Documentation Redactions)
- **Action:** Accept current visibility; rely on recent documentation redactions and strict linters (`lint:owner-prices`, `lint:owner-claims`) preventing future additions.
- **Benefits:** Zero migration overhead; no risk of disrupting Render webhooks or Actions limits.
- **Trade-off:** Legacy commits and static QR image files remain publicly inspectable by anyone on the internet.

---

## 4. Next Owner Action Required

The human owner should select one of the three options above.
Autonomous agents are strictly forbidden from changing repository visibility, rotating credentials, or rewriting git history.
