# SYSTEM STATE RECORD (STATE.md)

## 1. Context Ledger
1. One owner. Not for other users. The goal is verified cash in India.
2. Free plans only. Tavily: 2 searches per day. Firecrawl: 500 credits. Stop each provider at 70% of its allowance.
3. The owner gives owner facts. The agent never sets or guesses them.
4. Razorpay: manual mode now. Owner QR and UPI link exist. API keys come later, at a threshold the owner sets. The old Rs 100 link is banned.
5. No cold email. No cold WhatsApp. The system never posts or messages anyone for the owner. It prepares drafts. The owner sends them.
6. Revenue counts only with provider or bank proof. A claim, a click, a proposal, an asking price, and a test record are not revenue.
7. Never fetch amazon.* pages. Amazon lane is blocked until owner facts exist.
8. Existing protected modules stay untouched (Razorpay, SendGrid, WhatsApp, Stripe, Ads, GBP, Brevo, agent registry, UCOS). New files are allowed.
9. Raw output only. PASS needs raw proof. Never invent a number.
10. The 80 agents are a catalog. No run has produced output yet.
11. Known failures: fixture data in production, hardcoded product and tag, agent-written owner terms, guards that only check a file path, reports with invented output, tests that spend credits.
12. FEATURES_FROZEN = true. Feature freeze is strictly reinstated following completion of Steps 1-13. No new migrations after 0040. No new feature routes or agent types.

## 2. Last Verified Commit
- Production Commit Hash: `875cb4c40ab0ae60ddccd64a6df6a4708e33e56e` (PR #1 Merged into main)
- Active Branch: `main`
- Render Production Deploy: `dep-dbbob8hsrm7s738gj7gg` (Live with 875cb4c)
- Gate Status: `RELEASE_VERIFIED`
- Branch Local Verification: 108 unique test files, 355 suites, 932 passed tests, 0 failed (100% PASS)
- Acquisition Page Gating: Lead leakage calculator gated via DirectCommercialOfferPage.isDirectOfferAttested(); unconfirmed pricing (₹15,000), 5-day delivery claim, and 2-minute SLA removed in unattested mode.
- Inbound Inquiries Wired: INBOUND_LEAKAGE_CALCULATOR inquiries surfaced in /owner/today and OwnerDigestService.
- Pilot Delivery Specification: owner/PILOT_DELIVERY_SPEC.md and owner/PILOT_SALES_KIT.md updated with owner audit-measured intake fields, D7 marked MANUAL_BY_OWNER, and Section 10 Clinic Inquiry-Data Safety legal review draft appended.
- Claim Guardrails: scripts/lint-owner-claims.mjs and unit test packages/backend/tests/unit/owner-claims-lint.test.ts (19/19 PASS) enforcing source markers on commercial claims.

## 3. Open P1 Mistake Items
- Total Open P1 Mistakes: 0
- Total Board Mistakes: 31 (All 31 status=FIXED, all verified with EXECUTABLE test/hook/lint guards via board:verify)
- Recurrence Updates:
  * `mst_default_identity_reintroduced`: Recurrence count incremented to 2 (transient allowInferableDefaults helper removed from owner-env-intake.ts & content-asset-engine.ts; strict zero-default intake restored; verified by no-default-identity.test.ts and revenue-automation-persistence-and-scheduling.test.ts).
- Newly Registered P1 Mistake Rows (Resolved & Verified):
  1. `mst_p1_agent_wrote_test_data_to_production` (Guard: `packages/backend/tests/unit/production-test-quarantine.test.ts` - EXECUTABLE - PASS)
  2. `mst_p1_agent_set_owner_attestation_variable` (Guard: `packages/backend/tests/unit/owner-attestation-gate.test.ts` - EXECUTABLE - PASS)
  3. `mst_p1_expected_value_shown_for_discovery_action` (Guard: `packages/backend/tests/unit/pipeline-asking-price-truth.test.ts` - EXECUTABLE - PASS)

## 4. Owner-Fact Status (SET or MISSING only)
- `ASSOCIATES_APPLICATION_DATE`: MISSING
- `ASSOCIATES_LISTED_SITE_URL`: MISSING
- `ASSOCIATES_AGREEMENT_READ`: MISSING
- `PUBLIC_SITE_NAME`: MISSING
- `PUBLIC_AUTHOR_NAME`: MISSING
- `PUBLIC_CONTACT_EMAIL`: MISSING
- `OWN_OFFER_CONFIRMED`: MISSING
- `DIRECT_OFFER_TERMS_SHA256`: SET (SET_BY_UNKNOWN without confirmation; gated behind OWN_OFFER_CONFIRMED=true; offer page in safe un-attested inquiry mode)
- `OWNER_WHATSAPP_NUMBER`: MISSING
- `TELEGRAM_BOT_TOKEN`: MISSING
- `TELEGRAM_OWNER_CHAT_ID`: MISSING
- `TELEGRAM_ENABLED`: MISSING

## 5. Funnel Counts (is_test = 0 AND is_junk = 0 only)
### Direct Sales Funnel
- Signals: 0
- Qualified Prospects: 0
- Conversations Logged: 0
- Demos Booked: 0
- Proposals Sent: 0
- Proposals Accepted: 0
- Payments Claimed: 0
- Payments Verified: 0
- Services Delivered: 0
- Verified Real Revenue: ₹0

### Content Funnel
- Drafts: 0
- Approved: 0
- Published: 0
- Measured Visits: 0
- Outbound Clicks: 0

### Affiliate Funnel
- Active Partner Offers: 0
- Live Buying Guides: 0
- Affiliate Outbound Clicks: 0
- Qualifying Orders: 0
- Confirmed Commission: ₹0
- Cash Received / Payout: ₹0

## 6. Single Next Action
- Owner action required: Review `owner/OWN_OFFER.draft.md` and `owner/PILOT_DELIVERY_SPEC.md`, edit into owner terms if selling, attest via `scripts/owner-apply.mjs`, and review PR via compare URL. Features remain frozen (FEATURES_FROZEN = true).
