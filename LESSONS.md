# Engineering & Operational Lessons Learned

> **Generated:** 2026-10-18  
> **Repository:** `harshavardhankotu/ai-marketing-organization`  
> **Core Principle:** Zero synthetic metrics, zero fabricated demand, zero unverified revenue, zero agent default assumptions.

---

## Five Core Operational Lessons

### 1. Seeded demand counted as real
- **What happened:** Migration 0026 seeded fixture URLs (`search.community/q1` to `q14`) into production D1, which were counted as real buyer questions, leading to partner offers and commercial guides created on fake demand.
- **Root cause:** Test fixtures were persisted directly into production database tables without provenance validation, conflating mock test artifacts with measured consumer intent.
- **Permanent rule:** Never seed fixture, mock, or test URLs into production databases. Every production signal must trace to a verified external HTTP URL. Fixture fallback is eliminated from production entirely.

---

### 2. Guards that only check a file exists
- **What happened:** Integrity and compliance guards previously checked only whether files like `owner/OWN_OFFER.md` or `owner/affiliate-candidates.md` existed on the filesystem, rather than validating their semantic contents, schema invariants, or factual attestation.
- **Root cause:** Shallow file-presence assertions created a false sense of security while permitting empty, malformed, or unverified draft content to pass into production workflows.
- **Permanent rule:** Content, revenue, and security guards must verify semantic invariants, cryptographic digests, and live proofs—never merely filesystem file presence.

---

### 3. Env-boolean attestation
- **What happened:** Commercial offer terms were gated by boolean environment flags (`DIRECT_OFFER_TERMS_ATTESTED=true`), which allowed modified or stale terms to be served without re-verification whenever offer text was edited.
- **Root cause:** Boolean flags decouple authorization from content state: once set, they remain true regardless of subsequent modifications to the underlying terms.
- **Permanent rule:** Offer attestation must use a cryptographic SHA-256 digest of `owner/OWN_OFFER.md` (`DIRECT_OFFER_TERMS_SHA256`). Any file edit immediately changes the computed hash and closes the `/offer` page until the owner explicitly attests to the updated content.

---

### 4. Agent commits authored as the owner
- **What happened:** Autonomous agent runs executed git commits using the human owner's name and email, creating a misleading audit trail that obscured machine-generated changes.
- **Root cause:** Git author configuration defaulted to the machine's local user credentials without distinguishing between automated assistant commits and human owner actions.
- **Permanent rule:** All agent commits must explicitly specify an agent identity (`ai-marketing-agent <agent@ai-marketing-organization.internal>`). Never author machine-generated commits under the human owner's identity.

---

### 5. A demand gate that cannot open
- **What happened:** Generic search engine queries returned commercial publisher articles and listicles by design rather than genuine buyer questions, causing the strict 3-buyer-question gate to remain at zero and deadlocking guide publication indefinitely.
- **Root cause:** High-volume search queries surface affiliate publisher listicles instead of community buyer inquiries, leaving search-based demand discovery unable to prove organic demand.
- **Permanent rule:** Break the deadlock through owner-decision experiment mode (`EXPERIMENT_MODE=true`, off by default). When enabled, guides publish with verified manufacturer specifications, explicit owner click, and demand recorded as `UNKNOWN`. Each live guide (capped at 5) is bound to a 56-day review window, automatically archiving and recording an `OUTCOME` record if zero impressions result. The strict 3-question gate remains mandatory for any report claiming validated demand.
