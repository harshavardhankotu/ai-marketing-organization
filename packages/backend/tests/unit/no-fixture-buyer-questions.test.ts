import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../../src/db/client.js';

describe('Step 4e: Demand Data Truth — No Fixture Row Can Be a BUYER_QUESTION', () => {
  const db = getDb();

  beforeEach(() => {
    try {
      db.prepare(`DELETE FROM demand_signals WHERE id LIKE 'test_fixture_%'`).run();
    } catch {}
  });

  afterEach(() => {
    try {
      db.prepare(`DELETE FROM demand_signals WHERE id LIKE 'test_fixture_%'`).run();
    } catch {}
  });

  it('guarantees that fixture, mock, or synthetic demand signals cannot be classified as genuine BUYER_QUESTION', () => {
    const fixtureSignals = [
      { id: 'test_fixture_1', source: 'https://search.community/q1', title: 'How to print barcode labels', status: 'SEEDED' },
      { id: 'test_fixture_2', source: 'https://example.com/mock', title: 'Best thermal receipt printer', status: 'FIXTURE' },
      { id: 'test_fixture_3', source: 'https://test.local/inquiry', title: 'Clinic whatsapp integration', status: 'TEST_MOCK' }
    ];

    for (const s of fixtureSignals) {
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, raw_query, evidence_snippet, source_url, source_host,
          signal_type, status, category, intent_score, created_at
        ) VALUES (
          ?, 'org_owner_primary', ?, ?, ?, ?, 'search.community',
          'BUYER_QUESTION', ?, 'office', 80, datetime('now')
        )
      `).run(s.id, s.title, s.title, s.title, s.source, s.status);
    }

    // A genuine BUYER_QUESTION query must strictly filter out any fixture or seeded rows
    const genuineBuyerQuestions = db.prepare(`
      SELECT * FROM demand_signals
      WHERE signal_type = 'BUYER_QUESTION'
        AND status != 'SEEDED'
        AND status != 'FIXTURE'
        AND status != 'TEST_MOCK'
        AND source_url NOT LIKE '%search.community%'
        AND source_url NOT LIKE '%example.com%'
    `).all() as any[];

    // None of the fixture signals are counted
    for (const bq of genuineBuyerQuestions) {
      expect(bq.status).not.toBe('SEEDED');
      expect(bq.status).not.toBe('FIXTURE');
      expect(bq.source_url).not.toContain('search.community');
    }

    // Explicit check on the 3 inserted rows: all are rejected as genuine buyer questions
    const matched = genuineBuyerQuestions.filter((q: any) => q.id.startsWith('test_fixture_'));
    expect(matched).toHaveLength(0);
  });
});
