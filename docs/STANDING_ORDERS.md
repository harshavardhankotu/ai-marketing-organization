# Standing Orders & Constitutional Invariants

**System Owner:** Single-owner private revenue engine (`Harshavardhan Venkata Sai Kotu`).  
**Effective Immediately — Read First, Never Violate.**

---

## The 8 Standing Orders

1. **Private Single-Owner System**  
   No public accounts, multi-tenant dashboards, or community signups. Visitors are strictly buyers (affiliate offer clickers / checkout buyers) and SMB prospects viewing their tokenized audit.

2. **Sell Only What People Already Buy**  
   Monetization is restricted exclusively to verified affiliate offers (Cuelinks V3 + Dual-Rail Amazon affiliate tag) and the ₹499 SiteFix SEO/Meta Fix-Pack. No speculative products, paid ad budgets, or new capital investments (`₹0.00` paid-acquisition budget).

3. **Goal: First Paying Customer, Then Repeat**  
   Every autonomous action, ranking, and engineering change must directly advance the first verified paying customer and repeat conversions. Reject work, dashboards, or abstractions that do not serve conversion.

4. **Self-Sourced Discovery Only**  
   The application discovers, audits, scores, and qualifies prospects and high-converting affiliate buyers autonomously. Never ask the owner for prospect lists, domains, or manual data entry.

5. **`AutonomousSystemDoctor` Scope Lock**  
   `AutonomousSystemDoctor` exists ONLY to detect and deterministically auto-fix mistakes made by LLMs, scrapers, or API syncs inside code or stored data (e.g., title/price swaps, static Amazon scraped prices, fake defaulted `CPS` payout models, invalid outreach channels, or constitutional violations). It is **not** a marketing strategist.

6. **Automate Everything Bounded by Law, Platform Rules, and Money Verification**  
   Automate harvesting, auditing, email verification, drafting, IG syndication, and fulfillment packaging. Human gating applies only where law, platform compliance, anti-spam gates, or financial statement credit verification require it.

7. **Durable State Lives in D1/SQLite and GitHub**  
   No local-only ephemeral state for revenue, suppression, audits, or tokens. Persist operational state cleanly across the database layer and repository.

8. **Hard Constitutional Invariants (Fail-Closed)**  
   - **No passwordless owner login in test/production:** `autoEnvLogin` and empty-key auto-login MUST return `401` under `VITEST`, `NODE_ENV=test`, and `RENDER=true`.
   - **No unapproved remote production D1 writes:** Remote production D1 writes are strictly gated to `RENDER === 'true' || ALLOW_REMOTE_D1_WRITES === 'true'`.
   - **No direct push to `main`:** Repository discipline protects production branches.
   - **No static scraped Amazon prices:** Standalone `AMAZON_IN` rows must never display scraped ₹ prices; Amazon monetization uses the compliant Dual-Rail `/api/v1/public/amazon-redirect` link.
   - **ZERO health, medical, or dental outreach:** Regulated healthcare/dental/clinic/hospital/medical/pharma domains, business names, and segments are strictly disqualified (`prospectTriggerScore = -100`, `isRegulatedHealthcare = true`, `SUPPRESSED_HEALTHCARE_POLICY`).
   - **Strict Brevo HTTPS Outreach Compliance:** Every outreach send requires a verified reachable email (non-placeholder, non-noreply), identifies the sender, includes a one-click opt-out/unsubscribe mechanism, honors `outreach_suppression_list`, enforces a `<= 10/UTC_DAY` cap, limits to 1 initial email + max 1 follow-up (`>= 96h` later), and auto-pauses on bounce rate `> 5%` or any spam/unsubscribe complaint.
   - **Verified Payment Gate:** Bank cash received is strictly `₹0.00` unless backed by verified `CAPTURED` Razorpay or `HUMAN_VERIFIED_PAYMENT` manual UPI UTR confirmation. Fix-Pack delivery remains strictly gated on verified payment.

---

## Code Enforcement Points

- `packages/backend/src/automation/autonomous-system-doctor.ts`: `AutonomousSystemDoctor.runSelfHealingPass()` & `verifyConstitutionInvariants()`
- `packages/backend/src/tools/site-audit/site-audit-scanner.ts`: `isRegulatedHealthcareTarget()`, `isValidReachableEmail()`, `detectProspectSignals()`
- `packages/backend/src/tools/site-audit/site-audit-fixpack-generator.ts`: Evidence-only `<head>`, `Schema.org`, `robots.txt`, and `sitemap.xml` Fix-Pack generation
- `packages/backend/src/auth/owner-auth.ts` & `packages/backend/src/routes/api.ts`: Environment-aware owner authentication & `401` enforcement under `VITEST` / `RENDER=true`
- `packages/backend/src/automation/automation-registry-engine.ts` & `packages/backend/src/integrations/brevo-mcp-client.ts`: Bounded Brevo HTTPS Autopilot (`First-5` human gate, `<= 10/day`, 96h follow-up rule, bounce/complaint circuit breaker)
