-- Migration 0030: Add mst_default_identity_reintroduced mistake and guard
INSERT INTO mistakes_board (
  id, first_seen, last_seen, title, what_happened, cause, rule,
  severity, status, recurrence_count, guard_type, guard_ref, source_report
) VALUES (
  'mst_default_identity_reintroduced',
  datetime('now'),
  datetime('now'),
  'Default identity reintroduced',
  'Owner full name and site details were reintroduced as code defaults in owner-auth and schema.',
  'Fallback defaults created to avoid missing environment errors.',
  'Never use default or fallback owner names or site identities in code or configuration.',
  'P1',
  'FIXED',
  1,
  'TEST',
  'packages/backend/tests/unit/no-default-identity.test.ts:enforces all six owner facts and prevents default identity reintroduction',
  'STEP_3_AUDIT'
) ON CONFLICT(id) DO UPDATE SET
  status = 'FIXED',
  guard_type = 'TEST',
  guard_ref = 'packages/backend/tests/unit/no-default-identity.test.ts:enforces all six owner facts and prevents default identity reintroduction',
  last_seen = datetime('now');
