import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { HistoryIngestService } from '../../src/learning/history-ingest.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { DemandDiscoveryEngine } from '../../src/commission/demand-discovery.js';

describe('Step 1: History Ingest and FAILED Rule Action Blocking', () => {
  beforeEach(() => {
    resetDbForTesting();
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
      VALUES ('org_owner_primary', 'Primary Owner Organization', 'owner-primary', datetime('now'))
    `).run();
  });

  it('ingests canonical history items into learning_records with content hash deduplication', async () => {
    const ingestService = HistoryIngestService.getInstance();
    const result1 = await ingestService.ingest();

    expect(result1.totalConsidered).toBeGreaterThanOrEqual(25);
    expect(result1.inserted).toBe(result1.totalConsidered);
    expect(result1.skippedDuplicates).toBe(0);

    // Verify row counts by outcome
    expect(result1.countsByOutcome.WORKED).toBeGreaterThan(0);
    expect(result1.countsByOutcome.FAILED).toBeGreaterThan(0);
    expect(result1.countsByOutcome.UNKNOWN).toBeGreaterThan(0);

    // Run a second time to verify content hash deduplication
    const result2 = await ingestService.ingest();
    expect(result2.inserted).toBe(0);
    expect(result2.skippedDuplicates).toBe(result1.totalConsidered);
  });

  it('rule with outcome FAILED blocks the matching action in NextBestActionEngine', async () => {
    const db = getDb();
    const nbaEngine = NextBestActionEngine.getInstance();

    // 1. Initially without a FAILED rule blocking RECONCILE_COMMISSION
    const check1 = nbaEngine.isActionBlockedByFailedRules({
      actionType: 'RECONCILE_COMMISSION'
    });
    expect(check1.blocked).toBe(false);

    // 2. Insert a learning record with outcome = 'FAILED' that blocks RECONCILE_COMMISSION
    db.prepare(`
      INSERT INTO learning_records (
        id, organization_id, learning_type, decision, hypothesis, action,
        audience, offer, channel, result, what, outcome, cause, rule,
        evidence_ref, source_file, date, content_hash, created_at
      ) VALUES (
        'lrn_test_block_01', 'org_owner_primary', 'REAL_WORLD_LEARNING', 'BLOCK_RECONCILE', 'Manual override', 'BLOCK:RECONCILE_COMMISSION',
        'ALL', 'ALL', 'ALL', 'FAILED', 'RECONCILE_COMMISSION', 'FAILED', 'Reconciliation partner API offline', 'block_reconcile_commission',
        'test_evidence', 'test_file', '2026-10-09', 'hash_test_block_01', datetime('now')
      )
    `).run();

    // 3. NextBestActionEngine must detect the FAILED rule and block the action
    const check2 = nbaEngine.isActionBlockedByFailedRules({
      actionType: 'RECONCILE_COMMISSION'
    });
    expect(check2.blocked).toBe(true);
    expect(check2.matchingRule).toBeDefined();
    expect(check2.matchingRule.outcome).toBe('FAILED');
  });

  it('DemandDiscoveryEngine drops blocked category before issuing search or LLM calls', async () => {
    const db = getDb();
    const discoveryEngine = DemandDiscoveryEngine.getInstance();

    // Insert category BLOCK rule into learning_records
    db.prepare(`
      INSERT INTO learning_records (
        id, organization_id, learning_type, decision, hypothesis, action,
        audience, offer, channel, result, what, outcome, cause, rule,
        evidence_ref, source_file, date, content_hash, created_at
      ) VALUES (
        'lrn_test_cat_block', 'org_owner_primary', 'POLICY', 'CATEGORY_POLICY', 'High liability', 'DROP_CATEGORY',
        'ALL', 'ALL', 'ALL', 'FAILED', 'Category BLOCK policy', 'FAILED', 'Medical and supplement liability', 'Drop categories with outcome BLOCK (health, skin care, supplements, medical)',
        'evidence_cat', 'test_source', '2026-10-09', 'hash_test_cat_block', datetime('now')
      )
    `).run();

    // Attempting to discover demand for a blocked category must return empty array without calling external search
    const results = await discoveryEngine.discoverDemand('org_owner_primary', {
      category: 'supplements',
      location: 'India'
    });

    expect(results).toEqual([]);
  });
});
