-- Migration 0033: Pause seeded offers/guides, add P1 mistake, and dedupe demand signals (Task Addendum A)

-- 1. Pause offer poff_6fd7d0d3-7 built from seeded demand / hardcoded product
UPDATE partner_offers
SET status = 'PAUSED_SEEDED_DEMAND',
    active = 0,
    updated_at = datetime('now')
WHERE id = 'poff_6fd7d0d3-7';

-- 2. Set guide cnt_d5cdad0f-9 status to UNSUPPORTED_BY_DEMAND
UPDATE commission_content_assets
SET status = 'UNSUPPORTED_BY_DEMAND',
    updated_at = datetime('now')
WHERE id = 'cnt_d5cdad0f-9';

-- 3. Add mistake P1: Fixture demand seeded into production by migration
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_p1_fixture_demand_seeded_by_migration',
  datetime('now'),
  datetime('now'),
  'Fixture demand seeded into production by migration',
  'Migration 0026 seeded 14 fake hardware buyer questions with search.community/q* URLs directly into production D1 demand_signals table.',
  'Test fixture data was bundled into an unquarantined D1 SQL migration.',
  'Never insert test fixtures, mock URLs (search.community, localhost, example.com), or synthetic buyer demand into production migrations.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/no-fixture-migrations.test.ts:rejects migrations that insert mock, fixture, or search.community URLs into production tables',
  'PART_A_AUDIT'
) ON CONFLICT(id) DO UPDATE SET
  status = 'FIXED',
  guard_type = 'TEST',
  guard_ref = 'packages/backend/tests/unit/no-fixture-migrations.test.ts:rejects migrations that insert mock, fixture, or search.community URLs into production tables',
  last_seen = datetime('now');

-- 4. Dedupe demand_signals: Keep the earliest canonical row per unique normalized source_url, mark repeat rows DUPLICATE
UPDATE demand_signals
SET status = 'DUPLICATE'
WHERE id NOT IN (
  SELECT MIN(id)
  FROM demand_signals
  GROUP BY LOWER(TRIM(source_url))
);
