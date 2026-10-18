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
12. FEATURES_FROZEN = true. System is in stabilization and owner-action phase. No new migrations after 0040. No new feature routes or agent types.

## 2. Last Verified Commit
- Commit Hash: `d9ac281`
- Commit Message: `feat: quarantine test records, owner attestation gate, delivery playbook, and telegram alerts (Steps 0-11)`
- Render Production Deploy: `dep-db9nr6m1egvs73cv9kr0` (Status: live; pending CI deploy of `d9ac281`)

## 3. Open P1 Mistake Items
- Total Open P1 Mistakes: 0
- Total Board Mistakes: 31 (All 31 status=FIXED, all verified with EXECUTABLE test/hook/lint guards via board:verify)
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
- Owner action required: Review `owner/OWN_OFFER.draft.md`, edit into owner terms if selling, and execute `scripts/owner-apply.mjs` with owner facts. Features are frozen (FEATURES_FROZEN = true).
