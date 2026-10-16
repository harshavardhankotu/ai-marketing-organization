import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../../src/db/client.js';
import { ProductOpportunityPipeline } from '../../src/commission/product-opportunity-pipeline.js';
import { classifySignalType } from '../../src/commission/demand-discovery.js';

describe('Task A.5: Demand Signals Provenance Gate (Seeded & Unsourced Never Count)', () => {
  const db = getDb();
  const testOrgId = 'org_owner_primary';

  beforeEach(() => {
    // Clean up test data
    try {
      db.prepare(`DELETE FROM demand_signals WHERE organization_id = ?`).run(testOrgId);
      db.prepare(`DELETE FROM partner_offers WHERE organization_id = ?`).run(testOrgId);
      db.prepare(`DELETE FROM commission_content_assets WHERE organization_id = ?`).run(testOrgId);
    } catch {}
  });

  it('proves seeded rows with mock search.community URLs are excluded from 3-signal gate', () => {
    const pipeline = ProductOpportunityPipeline.getInstance();

    // Insert 4 seeded rows (like dem_bq_tlp_01..04)
    for (let i = 1; i <= 4; i++) {
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, category, topic, raw_query, evidence_snippet, source_url, status, signal_type, created_at
        ) VALUES (?, ?, 'thermal label printer', 'Sample printer query', 'sample query', 'sample snippet', ?, 'SEEDED', 'BUYER_QUESTION', datetime('now'))
      `).run(`seed_${i}`, testOrgId, `https://search.community/q${i}`);
    }

    // Evaluate single category with seeded signals filtered
    const signals = db.prepare(`
      SELECT * FROM demand_signals
      WHERE organization_id = ?
        AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
        AND source_url LIKE 'http%'
        AND source_url NOT LIKE '%search.community%'
        AND signal_type = 'BUYER_QUESTION'
    `).all(testOrgId) as any[];

    expect(signals.length).toBe(0);

    const ranking = pipeline.evaluateSingleCategory('thermal label printer', signals);
    expect(ranking.status).toBe('NEEDS_MORE_SIGNALS');
    expect(ranking.demandSignalCount).toBe(0);
    expect(ranking.stageReached).toBe(3);
  });

  it('proves unsourced rows missing HTTP URLs are excluded from 3-signal gate and funnel', () => {
    const pipeline = ProductOpportunityPipeline.getInstance();

    // Insert 3 unsourced signals
    db.prepare(`
      INSERT INTO demand_signals (
        id, organization_id, category, topic, raw_query, evidence_snippet, source_url, status, signal_type, created_at
      ) VALUES (?, ?, 'wireless microphone', 'Which lav mic?', 'which lav mic', 'snippet', '', 'UNSOURCED', 'BUYER_QUESTION', datetime('now'))
    `).run('unsourced_1', testOrgId);

    db.prepare(`
      INSERT INTO demand_signals (
        id, organization_id, category, topic, raw_query, evidence_snippet, source_url, status, signal_type, created_at
      ) VALUES (?, ?, 'wireless microphone', 'Which lav mic 2?', 'which lav mic 2', 'snippet', 'UNKNOWN', 'UNSOURCED', 'BUYER_QUESTION', datetime('now'))
    `).run('unsourced_2', testOrgId);

    const validSignals = db.prepare(`
      SELECT * FROM demand_signals
      WHERE organization_id = ?
        AND status NOT IN ('QUARANTINED', 'SEEDED', 'UNSOURCED')
        AND source_url LIKE 'http%'
        AND source_url NOT LIKE '%search.community%'
    `).all(testOrgId) as any[];

    expect(validSignals.length).toBe(0);

    const ranking = pipeline.evaluateSingleCategory('wireless microphone', validSignals);
    expect(ranking.status).toBe('NEEDS_MORE_SIGNALS');
    expect(ranking.demandSignalCount).toBe(0);
  });

  it('proves publisher review articles are classified as PUBLISHER_ARTICLE and never count as BUYER_QUESTION', () => {
    expect(classifySignalType('10 Best Accounting Software in India', 'Review of top accounting tools', 'https://invoicecrowd.com/10-best-accounting-software')).toBe('PUBLISHER_ARTICLE');
    expect(classifySignalType('The Best Small Business Accounting Software Tested for 2026', 'PCMag review', 'https://pcmag.com/picks/best-software')).toBe('PUBLISHER_ARTICLE');
    expect(classifySignalType('Top GST Accounting Software', 'Guide to billing', 'https://aiaccountant.com/blog/best-software')).toBe('PUBLISHER_ARTICLE');

    // Genuine buyer questions are classified as BUYER_QUESTION
    expect(classifySignalType('Which thermal printer prints 4x6 shipping labels without ink?', 'Looking for warehouse label printer', 'https://forum.example.com/topic/123')).toBe('BUYER_QUESTION');
    expect(classifySignalType('Can Phomemo M110 print barcode stickers from phone?', 'Need mobile Bluetooth printing', 'https://discussions.example.com/thread/456')).toBe('BUYER_QUESTION');
    expect(classifySignalType('Suggest direct thermal label maker for small warehouse', 'Need recommendation for dispatch', 'https://community.example.com/ask/789')).toBe('BUYER_QUESTION');
  });

  it('proves opportunity states correctly classify accounting software as QUALIFIED when signals are publisher articles only', async () => {
    const pipeline = ProductOpportunityPipeline.getInstance();

    // Insert 5 publisher article signals
    for (let i = 1; i <= 5; i++) {
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, category, topic, raw_query, evidence_snippet, source_url, status, signal_type, created_at
        ) VALUES (?, ?, 'best accounting software small business India', 'Best Accounting Software Review', 'best accounting software', 'snippet', 'https://reviewsite.com/article', 'DISCOVERED', 'PUBLISHER_ARTICLE', datetime('now'))
      `).run(`pub_${i}`, testOrgId);
    }

    const opportunities = await pipeline.getDetailedOpportunityStatus(testOrgId);
    const accountingOpp = opportunities.find(o => o.category.includes('accounting'));

    expect(accountingOpp).toBeDefined();
    expect(accountingOpp?.demandSignalCount).toBe(5);
    expect(accountingOpp?.buyerQuestionsCount).toBe(0);
    // Because buyerQuestions is 0 (< 3), state is INSUFFICIENT_EVIDENCE
    expect(accountingOpp?.funnelState).toBe('INSUFFICIENT_EVIDENCE');
    expect(accountingOpp?.nextStep).toContain('Gather at least 3 verified BUYER_QUESTION signals');
  });
});
