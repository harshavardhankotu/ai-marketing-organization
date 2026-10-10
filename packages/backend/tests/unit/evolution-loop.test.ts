import { describe, it, expect, beforeEach } from 'vitest';
import { EvolutionLoopService } from '../../src/learning/evolution-loop.js';
import { getDb } from '../../src/db/client.js';

describe('Step 7: Evolution Loop & Outcome Learning', () => {
  const service = EvolutionLoopService.getInstance();

  beforeEach(() => {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS commission_content_assets (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        asset_type TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PUBLISHED',
        view_count INTEGER NOT NULL DEFAULT 0,
        referral_click_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS commission_records (
        id TEXT PRIMARY KEY,
        asset_id TEXT,
        placement_slug TEXT,
        amount_inr REAL
      );
      CREATE TABLE IF NOT EXISTS learning_records (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        learning_type TEXT NOT NULL,
        decision TEXT,
        action TEXT,
        channel TEXT,
        result TEXT,
        confidence REAL,
        evidence_json TEXT,
        source TEXT NOT NULL DEFAULT 'UNKNOWN',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare(`DELETE FROM commission_content_assets`).run();
    db.prepare(`DELETE FROM commission_records`).run();
    db.prepare(`DELETE FROM learning_records WHERE source = 'OUTCOME'`).run();
  });

  it('does NOT change a recommendation weight when sample size n is below the minimum (Step 7b, 7e)', () => {
    const db = getDb();
    // Insert guide with only 12 views and 2 clicks (below 30 views and below 5 clicks)
    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category,
        intent_target, content_markdown, status, view_count, referral_click_count
      ) VALUES (
        'ast_small_sample', 'org_owner_primary', 'guide-small-sample', 'GUIDE',
        'Small Sample Guide', 'thermal label printer', 'BUYER_RESEARCH', 'Content...', 'PUBLISHED',
        12, 2
      )
    `).run();

    const outcomes = service.runWeeklyOutcomeAudit();
    expect(outcomes.length).toBe(1);

    const outcome = outcomes[0];
    expect(outcome.views).toBe(12);
    expect(outcome.clicks).toBe(2);
    expect(outcome.sampleSize).toBe(14);
    expect(outcome.weightChanged).toBe(false);
    expect(outcome.newWeight).toBeUndefined();
    expect(outcome.reason).toContain('INSUFFICIENT_SAMPLE_SIZE');

    // Verify written learning record has source = 'OUTCOME'
    const record = db.prepare(`SELECT * FROM learning_records WHERE id = ?`).get(outcome.id) as any;
    expect(record).toBeDefined();
    expect(record.source).toBe('OUTCOME');
    expect(record.result).toContain('Weight unchanged');
  });

  it('updates recommendation weight when sample size meets or exceeds 30 views or 5 clicks (Step 7b)', () => {
    const db = getDb();
    // Insert guide with 45 views and 8 clicks (exceeds threshold)
    db.prepare(`
      INSERT INTO commission_content_assets (
        id, organization_id, slug, asset_type, title, category,
        intent_target, content_markdown, status, view_count, referral_click_count
      ) VALUES (
        'ast_valid_sample', 'org_owner_primary', 'guide-valid-sample', 'GUIDE',
        'Significant Sample Guide', 'thermal label printer', 'BUYER_RESEARCH', 'Content...', 'PUBLISHED',
        45, 8
      )
    `).run();

    // Insert 2 conversions
    db.prepare(`
      INSERT INTO commission_records (id, partner_id, organization_id, verification_source, offer_id, expected_commission_inr)
      VALUES ('comm_1', 'part_test', 'org_owner_primary', 'MANUAL_VERIFICATION', 'ast_valid_sample', 250),
             ('comm_2', 'part_test', 'org_owner_primary', 'MANUAL_VERIFICATION', 'ast_valid_sample', 300)
    `).run();

    const outcomes = service.runWeeklyOutcomeAudit();
    expect(outcomes.length).toBe(1);

    const outcome = outcomes[0];
    expect(outcome.views).toBe(45);
    expect(outcome.clicks).toBe(8);
    expect(outcome.conversions).toBe(2);
    expect(outcome.weightChanged).toBe(true);
    expect(outcome.newWeight).toBeDefined();
    expect(outcome.newWeight).toBeGreaterThan(0.5);
    expect(outcome.reason).toContain('STATISTICALLY_SIGNIFICANT_OUTCOME');

    // Verify written learning record has source = 'OUTCOME' and confidence 0.9
    const record = db.prepare(`SELECT * FROM learning_records WHERE id = ?`).get(outcome.id) as any;
    expect(record).toBeDefined();
    expect(record.source).toBe('OUTCOME');
    expect(record.confidence).toBe(0.9);
  });
});
