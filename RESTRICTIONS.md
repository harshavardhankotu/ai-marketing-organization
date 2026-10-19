# RESTRICTIONS — AI Marketing Organization

**Purpose:** Single-owner system whose goal is verified cash from real customers in India. This is an operating rulebook, not permission to expand scope.

**Precedence:** Read this file and `STATE.md` before any task. `STATE.md` records current state; this file records non-negotiable rules. If evidence conflicts with an older report, prefer current Git state, raw command output, current deployment records, and read-only production data. Never silently reconcile conflicting evidence.

## 1. Repository visibility and secret exposure

- The current GitHub API response returned `private: false` for `harshavardhankotu/ai-marketing-organization`. Treat the repository as **public** until the owner verifies the GitHub setting. If this is not intentional, the owner should make it private through repository settings; the agent must not assume it has permission to change visibility.
- Before proceeding, inspect tracked files and recent Git history for accidentally committed secrets, owner facts, personal data, private commercial information, or credentials. Report file paths and secret *names/types* only; never print values. If a real credential was exposed, ask the owner to rotate it through the provider. Removing it from the latest commit alone does not remove history exposure.
- Do not make a public issue or public PR containing secret names/values, customer details, or other private business information.

## 2. Feature freeze and scope

- `FEATURES_FROZEN = true` until the owner has logged at least one genuine customer conversation and then explicitly authorizes the next feature phase.
- During stabilization, only fix proven regressions, data-integrity defects, false claims, broken tests, security/privacy issues, and documentation/control gaps already named in the current pain-point register.
- Do not add new product concepts, agent types, public routes, monetization features, campaigns, or unrelated refactors during this run.
- Do not add D1 migrations after `0040` without explicit owner authorization. First determine whether a reported schema problem is a stale local test database, a migration-runner bug, or an actual production D1 mismatch.
- Preserve the existing 80-agent catalogue and architecture. It is a catalogue, not proof that 80 agents ran.
- After this stabilization pass, reinstate and verify the feature freeze.

## 3. Production safety

- Production D1 actions are read-only for this run. No production `POST`, `PUT`, `PATCH`, `DELETE`, SQL mutation, test submission, owner-fact change, payment confirmation, seed, or test-record insertion.
- Production verification may use `GET` endpoints and read-only SQL only.
- Use the repository's D1 REST audit/query script for reads. Apply a 30-second request timeout. Stop any command that runs for 60 seconds; report the exact command and failure instead of waiting indefinitely.
- Avoid repeated `npx`/Wrangler installation or hidden login prompts. Use the existing D1 REST script first; use Wrangler only if REST is unavailable, and always under a 60-second timeout.
- Do not deploy while tests or guardrails fail. Use a feature branch and pull request; do not push untested changes directly to `main`. Merge/deploy only when the required checks are green and owner authorization permits it.
- A healthy endpoint, green deployment, successful cron ping, passing test suite, or created payment link does not prove real buyer activity or revenue.

## 4. Owner-only facts, terms, approvals and conversations

- The owner—not an agent—supplies and confirms owner facts, public identity, business terms, pricing, guarantees, delivery commitments, legal declarations, account approvals, and payment/bank evidence.
- Never guess or auto-fill `PUBLIC_SITE_NAME`, `PUBLIC_AUTHOR_NAME`, `PUBLIC_CONTACT_EMAIL`, `ASSOCIATES_APPLICATION_DATE`, `ASSOCIATES_LISTED_SITE_URL`, `ASSOCIATES_AGREEMENT_READ`, `OWN_OFFER_CONFIRMED`, owner contact details, Telegram credentials, or other owner attestations.
- Never execute `node scripts/owner-apply.mjs` on the owner's behalf. The owner edits their offer terms and runs this script themselves.
- `owner/OWN_OFFER.md` must contain owner-authored/owner-edited terms. Do not attest known agent-written legacy terms. The current repository has `owner/OWN_OFFER.draft.md`; review the actual current file/hash before taking any action.
- Treat `DIRECT_OFFER_TERMS_SHA256` marked `SET_BY_UNKNOWN` as untrusted. Do not publish pricing/guarantees or activate direct checkout until terms are explicitly owner-confirmed.
- Content identity requirements and Amazon Associates eligibility are separate lanes: the three public-site identity facts may unlock non-affiliate content; Amazon's three facts are required only for the affiliate lane. Optional Telegram/WhatsApp alert settings must not silently block unrelated lanes.
- The owner personally handles customer conversations and sends all messages/posts. Prepare drafts only.

## 5. Outreach, platforms and privacy

- No cold email, no cold WhatsApp, no unsolicited mass outreach, no automated posting or messaging, no fake engagement, no scraping private identities, and no private phone/watch/browsing-history access.
- The application prepares helpful drafts for owner review. The owner decides whether and where to send them.
- Use public intent signals and permitted sources only. During this run, Tavily is limited to **2 searches per day**; do not use Firecrawl. Gemini content generation is capped at **5 calls per day**. Respect the strictest limit documented by `STATE.md`; do not follow a conflicting older prompt that says 3 Tavily searches/day.
- Stop any provider at 70% of its allowed allowance. Do not buy credits, upgrade plans, or run ads without explicit owner approval.
- Use only lawful/authorized sources and respect publisher/community terms. No Amazon-domain fetching in this run; Amazon lane stays blocked until owner facts exist.
- Forms collecting personal data must have a clear privacy link and appropriate consent. Do not claim an action has been scheduled if it has not actually been scheduled.
- Honor the 30-day retention statement only if a real, observed purge/redaction job runs. Store deletion codes as hashes, require the raw code to authorize deletion, and keep an audit trail without retaining unnecessary personal data.

## 6. Demand and provenance truth

- A publisher article, listicle, directory, ad, generic trend, search result count, fixture, migration seed, or model-generated statement is not a buyer.
- Only a real, source-backed person asking for help/recommendations may qualify as `BUYER_QUESTION`, with evidence, URL, timestamp, provenance, and a defensible classification.
- Rows originating from `search.community`, fixtures, test/mock sources, synthetic URLs or seeded migrations must be marked `SEEDED`, `FIXTURE`, `TEST_MOCK`, `TEST_QUARANTINED`, or another explicit non-production state—not real buyer demand.
- Normalize URLs and deduplicate. Do not rediscover the same URL indefinitely or count repeated URLs as separate signals. Mark duplicates; do not delete historical records without authorization.
- If a category has fewer than 3 genuine buyer questions, label it `INSUFFICIENT_EVIDENCE`, not `QUALIFIED`.
- Pause offers/guides based on fabricated or unsupported demand using a status change, not deletion. The thermal printer guide is `UNSUPPORTED_BY_DEMAND` until independent evidence supports it; do not polish/publish it during the freeze.
- Never create or infer a lead from a business directory, empty search, generic article, or absence of data.

## 7. Data integrity and database authority

- Cloudflare D1 is the production source of truth. Local SQLite is for tests/local execution and must not silently become production business truth or a fallback that masks D1 failure.
- Production inquiry writes must persist to D1 before the app reports success; if D1 fails, return an error and do not create success telemetry.
- For every dashboard count, show the actual source/query and compare it to the endpoint output. Any mismatch is a stop condition until explained.
- `is_test` and `is_junk` represent different concepts. Never repurpose one flag to mean both. Preserve records and audit trail while quarantining records; do not bulk-delete ambiguous production data.
- Check test database schema from a newly initialized test DB, not only an old persisted file. The canonical `proposals` schema in the current GitHub source includes `is_test`; if a local test says the column is missing, investigate migration initialization and workspace drift before changing schema.
- Migration execution must be transactional per file. Record migration success only after every statement completes. A non-allowlisted error must stop the runner and roll back. Tolerate only the specifically allowed idempotent cases in the current task; do not silently swallow arbitrary errors.
- Migration files and production `_d1_migrations` must match exactly. Report missing/extra IDs and raw output. Do not add a migration beyond `0040` in this run.

## 8. Tests, hooks and truthful reporting

- Every code change receives a regression test. Tests must be hermetic and must not consume live provider credits or mutate production data.
- Report actual test-file and test counts before and after. Preserve failing output verbatim. Never report a failing suite as passing.
- The latest reported CI run `39143282202` succeeded for commit `60c569e208d34abd878ca59becfb8adaa2a312cc`, with 873 tests reported passing. A separate local run reported 6 failures out of 851. This discrepancy is unresolved until the local `HEAD`, `git status`, diffs, environment and exact test command are captured and compared to clean CI.
- Do not fix stale tests by weakening assertions. Correct the code, test expectations, test setup, or environment isolation according to the intended lane-specific contract.
- Test tool hooks via the actual Antigravity workspace/tool path. A script-only check does not prove a hook is active. If the actual tool path cannot be tested, leave the associated guard open and say so.
- Provide raw command output and exact evidence for all PASS claims. Never invent log lines, rows, credits, buyers, visits, deployments, CI IDs, or financial values.
- Use hard timeouts. Do not say “waiting” or launch detached jobs repeatedly without checking their actual completion.

## 9. Financial truth and product claims

- Verified revenue is ₹0 until a genuine captured provider payment or owner-confirmed bank credit proves otherwise.
- An asking price, an active offer, a proposal, a payment link, an outbound click, a payment claim, a test row or a displayed QR is not revenue.
- Keep reported, captured, settled, refunded and net realized amounts separate.
- Do not send a payment link to test/synthetic prospects. The prior `SmileKraft Hyderabad` record contains `Dr. Harsha Test` and an email on a `test` domain; treat it as potentially synthetic until independently verified.
- Do not claim WhatsApp triage, instant Google Business Profile lead capture, automated multi-touch follow-up, calendar booking, or delivery SLAs as `IMPLEMENTED_VERIFIED` unless the integration was actually exercised in a legitimate test environment and the capability registry proves it.
- Do not claim the historic Google Business Profile chat feature is available; verify current official platform functionality before relying on it.
- Check with the bank/accountant before treating a personal/QR UPI VPA as a proper business-collection channel. Never manipulate a fixed-amount Razorpay link. The old ₹100 link `paQqSni` / `Tow5k0qoIXcQ8g` remains banned for larger invoices.

## 10. External deployment and future monetization

- No AdMob, AdSense, YouTube monetization, affiliate lane, static-host migration, new product, or new business line is to be built during this stabilization pass unless it is already in the authorized task and needed to fix a demonstrated defect.
- `PORTFOLIO.md` is research-only; it is not evidence that accounts are approved, products exist, or revenue is available.
- Before any later feature phase, the owner must complete the one-time owner actions and log at least one real customer conversation. The owner must explicitly authorize lifting the feature freeze.

## 11. Definition of complete

Complete means: exact current state is reconciled; critical data/claims are truthful; the current workspace's test results match a clean commit; no fixture is counted as demand; owner-only facts remain owner-only; no unintended production writes happened; CI/deploy evidence is raw and consistent; and the feature freeze is restored.

If permission, credentials, owner input, current production schema, or source evidence is unavailable, label the exact blocker. Do not simulate it.
