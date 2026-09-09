# Database Schema & Entity Documentation

Relational SQLite / Cloudflare D1 Schema with foreign keys and tenant isolation:

### Core Tables (23 Entities):
1. `organizations` - Multi-tenant accounts.
2. `users` - Organization members and roles.
3. `businesses` - Business profiles, vertical risk tiers, INR constraints.
4. `business_goals` - Measurable targets and KPI benchmarks.
5. `agents` - 80 specialized agent runtime records and telemetry.
6. `strategies` - Versioned marketing strategies (v1, v2...).
7. `campaigns` - Flight timelines, budgets in INR, and channel selections.
8. `content_assets` - Multi-channel and multi-lingual copy drafts.
9. `research_findings` - Evidence cards with source attribution and certainty.
10. `decisions` - Persistent decision journal with expected vs actual outcomes.
11. `experiments` - Statistical A/B test definitions and sample conversions.
12. `learnings` - Formal organizational learnings modifying future strategies.
13. `approval_requests` - Risk-scored human review requests.
14. `workflows` - Durable workflow states (`PENDING`, `RUNNING`, `CHECKPOINTED`...).
15. `workflow_checkpoints` - State snapshots enabling crash-resumption.
16. `tasks` - Atomic worker tasks with idempotency keys.
17. `memory_items` - Multi-scoped memory with TTL and versioning.
18. `analytics_events` - Unified normalized event stream telemetry.
19. `attributions` - Multi-touch credit fractions and confidence.
20. `deduplication_cache` - SHA-256 fingerprint cache for Gemini model responses.
21. `quota_records` - Daily Gemini token and request telemetry.
22. `audit_logs` - Immutable audit log of all critical actions.
23. `integrations` - Channel connection metadata and sandbox modes.