# Universal Demand-Capture Funnel Architecture & Specification

## Executive Summary
This document specifies the architectural transition of the public demand-capture layer in `ai-marketing-organization` from hardcoded, vertical-specific routes (`/aligners-hyderabad`) to a tenant-aware, industry-neutral, universal demand engine.

---

## 1. Core Principles

1. **Industry-Agnostic Demand Funnel:**
   The public funnel makes zero assumptions about the client's industry (dental, roofing, legal, SaaS, home services, etc.). It dynamically renders the business profile, offerings, brand voice, and value propositions based on the tenant's public configuration.
2. **Strict Multi-Tenant Isolation:**
   Public lead capture endpoints (`POST /api/v1/public/lead`) strictly require an explicit tenant identifier (`businessId` or `businessSlug`). The legacy behavior of falling back to the oldest business in the database has been permanently eliminated.
3. **Public Route Auth Isolation:**
   When a prospective customer visits a public funnel route (`/f/...` or `/book/...`), the frontend application skips authenticated owner data loading (`loadAllData()`). Public API calls (`/public/*`) never transmit owner identity headers (`x-user-id`, `x-organization-id`, `x-business-id`).
4. **Intent & Ad Context Preservation:**
   Search/ad intent (`intent`, `q`, `keyword`, `utm_term`), UTM attribution parameters, and visitor location are captured and recorded directly into the customer journey touchpoints for downstream lead scoring and autonomous follow-up.
5. **Universal Contact Validation:**
   Phone number validation is country-neutral, allowing valid international numbers (8 to 15 digits) while rejecting malformed inputs.
6. **Preserved Revenue & Payment Boundary:**
   The existing INR/Razorpay payment infrastructure remains completely unmodified and authentic. No synthetic currencies or simulated transactions are created.

---

## 2. Public Route Topology

| Route Pattern | Purpose | Example |
| :--- | :--- | :--- |
| `/f/:businessSlug/:funnelSlug` | Canonical public demand funnel | `https://ai-marketing-organization.onrender.com/f/apex-roof-care/emergency-leak` |
| `/book/:businessSlug/:funnelSlug` | Short-link public booking funnel | `https://ai-marketing-organization.onrender.com/book/smilekraft-dental-clinic/smile-makeover` |
| `/book?businessId=:id` | Query-param backward compatibility | `https://ai-marketing-organization.onrender.com/book?businessId=biz_smilekraft_hyd` |

---

## 3. Backend Endpoints

### 3.1 `GET /api/v1/public/business/:slug`
* **Route Policy:** Registered in `EXACT_ROUTE_POLICY.PUBLIC` (unauthenticated).
* **Identifier:** Accepts either `public_slug` (e.g. `smilekraft-dental-clinic`) or business `id` (e.g. `biz_smilekraft_hyd`).
* **Storage:** Routes through Cloudflare D1 in production, SQLite in test/development via `D1RevenueRepository.getInstance().queryOne(...)`.
* **Sanitization:** Returns only public presentation fields:
  * `id`, `public_slug`, `name`, `vertical_id`, `vertical_name`, `country`, `currency`, `timezone`, `city`, `neighborhood`, `website_url`, `phone`, `primary_language`, `secondary_languages`, `value_propositions`, `offerings`.
  * Sensitive operational controls (`kill_switch_active`, `brand_voice`, `constraints_json`, budgets, credentials) are strictly omitted.

### 3.2 `POST /api/v1/public/lead`
* **Tenant Requirement:** `businessId` or `businessSlug` is mandatory (HTTP 400 `PUBLIC_BUSINESS_REQUIRED` if omitted).
* **Validation:** 
  * Phone length: 8–15 digits.
  * Honeypot: Silent drop for bot submissions via `website_url_hp` / `bot_trap`.
  * IP rate limiting: 10 requests / 10 minutes per IP.
* **Journey Attribution:**
  * Stores intent, funnel slug, landing page, and location into customer journey touchpoints.
  * Captures DPDP statutory consent if applicable.

---

## 4. Database Schema Changes

1. **Businesses Table (`packages/backend/src/db/schema.ts`):**
   * Added column `public_slug TEXT`.
   * Added unique partial index:
     ```sql
     CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_public_slug
       ON businesses(public_slug)
       WHERE public_slug IS NOT NULL AND public_slug != '';
     ```
2. **Migration & Backfill (`packages/backend/src/db/client.ts`):**
   * Added safe `ALTER TABLE businesses ADD COLUMN public_slug TEXT` migration for existing SQLite databases.
   * Added deterministic slug backfill logic for existing records without collision.

---

## 5. Test Coverage
* Automated tests in `packages/backend/tests/unit/universal-demand-funnel.test.ts`:
  1. `GET /public/business/:slug` returns sanitized profile by slug or id.
  2. `GET /public/business/:slug` returns 404 for unknown business.
  3. `POST /public/lead` fails 400 when missing `businessId` and `businessSlug`.
  4. `POST /public/lead` resolves tenant via `businessSlug` and records intent in journey touchpoints.
  5. `POST /public/lead` accepts international phone numbers (8–15 digits) and rejects short/excessive numbers.
  6. `POST /business` automatically computes `public_slug` and resolves slug collisions.
* Full test suite status: 41 test files passed, 386 tests passed, 0 failures.
