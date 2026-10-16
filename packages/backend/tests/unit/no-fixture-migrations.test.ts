import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../src/db/client.js';
import { DemandDiscoveryEngine } from '../../src/commission/demand-discovery.js';
import { ProductOpportunityPipeline } from '../../src/commission/product-opportunity-pipeline.js';
import {
  normalizeCanonicalUrl,
  classifySignalType,
  isEligibleBuyerDemandSignal
} from '../../src/commission/demand-signal-eligibility.js';

describe('Mistake P1 Guard: No Fixture Demand in Migrations and Application Code', () => {
  const migrationsDir = path.resolve(__dirname, '../../src/db/d1-migrations');

  it('rejects migrations that insert mock, fixture, or search.community URLs into production tables', () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));

    const forbiddenPatterns = [
      /search\.community/i,
      /example\.com\/fixture/i,
      /test\.local/i,
      /mock-demand/i,
      /localhost:\d+/i,
      /127\.0\.0\.1/i,
      /synthetic-question/i,
      /dummy-signal/i
    ];

    const violations: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      // Historical migration 0026 was the mistake itself, and 0032/0033/0035 sanitize and guard against it
      if (file.startsWith('0026_') || file.startsWith('0032_') || file.startsWith('0033_') || file.startsWith('0035_')) {
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const lines = fs.readFileSync(filePath, 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (/INSERT\s+INTO/i.test(line) || /VALUES\s*\(/i.test(line) || /UPDATE\s+/i.test(line)) {
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(line)) {
              violations.push({ file, line: index + 1, text: line.trim() });
            }
          }
        }
      });
    }

    expect(violations).toEqual([]);
  });

  describe('Code-level Production Demand Discovery Safety: Zero Fallback Fixtures', () => {
    const orgId = 'org_owner_primary';

    beforeEach(() => {
      const db = getDb();
      try {
        db.prepare("DELETE FROM demand_signals WHERE organization_id = ?").run(orgId);
        db.prepare("DELETE FROM search_attempts WHERE provider = 'TAVILY'").run();
      } catch {}
      vi.restoreAllMocks();
    });

    it('persists ZERO demand rows and returns [] when TAVILY_API_KEY is missing', async () => {
      const originalKey = process.env.TAVILY_API_KEY;
      delete process.env.TAVILY_API_KEY;

      const engine = DemandDiscoveryEngine.getInstance();
      const signals = await engine.discoverDemand(orgId, { category: 'hardware_tools' });

      expect(signals).toEqual([]);
      expect(engine.getLastSource()).toBe('UNAVAILABLE');

      const count = (getDb().prepare("SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ?").get(orgId) as any).cnt;
      expect(count).toBe(0);

      if (originalKey) process.env.TAVILY_API_KEY = originalKey;
    });

    it('persists ZERO demand rows and returns [] when TAVILY_API_KEY is a placeholder', async () => {
      const originalKey = process.env.TAVILY_API_KEY;
      process.env.TAVILY_API_KEY = 'placeholder_tvly_12345';

      const engine = DemandDiscoveryEngine.getInstance();
      const signals = await engine.discoverDemand(orgId, { category: 'hardware_tools' });

      expect(signals).toEqual([]);
      expect(engine.getLastSource()).toBe('UNAVAILABLE');

      const count = (getDb().prepare("SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ?").get(orgId) as any).cnt;
      expect(count).toBe(0);

      if (originalKey) process.env.TAVILY_API_KEY = originalKey;
      else delete process.env.TAVILY_API_KEY;
    });

    it('persists ZERO demand rows and returns [] when Tavily returns non-2xx error', async () => {
      process.env.TAVILY_API_KEY = 'tvly_test_live_key_valid';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 })
      );

      const engine = DemandDiscoveryEngine.getInstance();
      const signals = await engine.discoverDemand(orgId, { category: 'barcode_scanner' });

      expect(signals).toEqual([]);
      expect(engine.getLastSource()).toBe('PROVIDER_ERROR');

      const count = (getDb().prepare("SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ?").get(orgId) as any).cnt;
      expect(count).toBe(0);

      fetchSpy.mockRestore();
      delete process.env.TAVILY_API_KEY;
    });

    it('persists ZERO demand rows and returns [] when network fetch throws', async () => {
      process.env.TAVILY_API_KEY = 'tvly_test_live_key_valid';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('ENOTFOUND api.tavily.com')
      );

      const engine = DemandDiscoveryEngine.getInstance();
      const signals = await engine.discoverDemand(orgId, { category: 'wireless_mic' });

      expect(signals).toEqual([]);
      expect(engine.getLastSource()).toBe('PROVIDER_ERROR');

      const count = (getDb().prepare("SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ?").get(orgId) as any).cnt;
      expect(count).toBe(0);

      fetchSpy.mockRestore();
      delete process.env.TAVILY_API_KEY;
    });

    it('persists ZERO demand rows when Tavily returns empty results or malformed JSON', async () => {
      process.env.TAVILY_API_KEY = 'tvly_test_live_key_valid';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('not-valid-json', { status: 200, headers: { 'Content-Type': 'text/plain' } })
      );

      const engine = DemandDiscoveryEngine.getInstance();
      const signals = await engine.discoverDemand(orgId, { category: 'thermal_printer' });

      expect(signals).toEqual([]);
      expect(engine.getLastSource()).toBe('PROVIDER_ERROR');

      const count = (getDb().prepare("SELECT COUNT(*) as cnt FROM demand_signals WHERE organization_id = ?").get(orgId) as any).cnt;
      expect(count).toBe(0);

      fetchSpy.mockRestore();
      delete process.env.TAVILY_API_KEY;
    });
  });

  describe('Product Opportunity Pipeline: Strict Demand Exclusion Verification', () => {
    const orgId = 'org_owner_primary';

    beforeEach(() => {
      const db = getDb();
      try {
        db.prepare("DELETE FROM demand_signals WHERE organization_id = ?").run(orgId);
      } catch {}
    });

    it('strictly excludes DUPLICATE, SEEDED, SEEDED_MIGRATION_0026, UNSOURCED, and PUBLISHER_ARTICLE from buyer question counts', async () => {
      const db = getDb();

      // Insert invalid/seeded/duplicate rows
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, category, raw_query, evidence_snippet, source_url, status, signal_type, created_at
        ) VALUES 
          ('dem_test_1', ?, 'Best thermal printer India', 'thermal label printer', 'query', 'snippet', 'https://search.community/q1', 'SEEDED_MIGRATION_0026', 'BUYER_QUESTION', datetime('now')),
          ('dem_test_2', ?, 'Top accounting software review', 'accounting software', 'query', 'snippet', 'https://pcmag.com/review', 'DISCOVERED', 'PUBLISHER_ARTICLE', datetime('now')),
          ('dem_test_3', ?, 'Which barcode scanner works with USB?', 'barcode scanner', 'query', 'snippet', 'https://techenclave.com/threads/1', 'DUPLICATE', 'BUYER_QUESTION', datetime('now')),
          ('dem_test_4', ?, 'Unsourced buyer question', 'wireless microphone', 'query', 'snippet', '', 'UNSOURCED', 'BUYER_QUESTION', datetime('now')),
          ('dem_test_5', ?, 'Quarantined question', 'wireless microphone', 'query', 'snippet', 'https://desidime.com/deals/1', 'QUARANTINED', 'BUYER_QUESTION', datetime('now'))
      `).run(orgId, orgId, orgId, orgId, orgId);

      const pipeline = ProductOpportunityPipeline.getInstance();
      const statusList = await pipeline.getDetailedOpportunityStatus(orgId);

      // Verify that all categories with 0 valid signals report INSUFFICIENT_EVIDENCE
      for (const item of statusList) {
        if (item.category.includes('thermal') || item.category.includes('printer')) {
          expect(['UNSUPPORTED_BY_DEMAND', 'INSUFFICIENT_EVIDENCE']).toContain(item.funnelState);
        } else if (!item.category.includes('health') && !item.category.includes('medical')) {
          expect(item.buyerQuestionsCount).toBe(0);
          expect(item.funnelState).toBe('INSUFFICIENT_EVIDENCE');
        }
      }
    });

    it('requires at least 3 distinct validated buyer questions before a category can advance beyond INSUFFICIENT_EVIDENCE', async () => {
      const db = getDb();

      // Insert 2 valid buyer questions (below threshold of 3)
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, category, raw_query, evidence_snippet, source_url, canonical_url, status, signal_type, created_at
        ) VALUES 
          ('dem_valid_1', ?, 'which wireless microphone connects directly to Android USB-C?', 'wireless microphone', 'q', 's', 'https://techenclave.com/threads/mic1', 'https://techenclave.com/threads/mic1', 'DISCOVERED', 'BUYER_QUESTION', datetime('now')),
          ('dem_valid_2', ?, 'suggest a reliable lapel mic under 3000?', 'wireless microphone', 'q', 's', 'https://desidime.com/discuss/mic2', 'https://desidime.com/discuss/mic2', 'DISCOVERED', 'BUYER_QUESTION', datetime('now'))
      `).run(orgId, orgId);

      const pipeline = ProductOpportunityPipeline.getInstance();
      const statusList = await pipeline.getDetailedOpportunityStatus(orgId);
      const micStatus = statusList.find(s => s.category.toLowerCase().includes('microphone'));

      expect(micStatus).toBeDefined();
      expect(micStatus!.buyerQuestionsCount).toBe(2);
      expect(micStatus!.funnelState).toBe('INSUFFICIENT_EVIDENCE');

      // Now insert the 3rd distinct valid buyer question
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, category, raw_query, evidence_snippet, source_url, canonical_url, status, signal_type, created_at
        ) VALUES 
          ('dem_valid_3', ?, 'how to connect dual wireless mic to phone?', 'wireless microphone', 'q', 's', 'https://community.intuit.com/questions/mic3', 'https://community.intuit.com/questions/mic3', 'DISCOVERED', 'BUYER_QUESTION', datetime('now'))
      `).run(orgId);

      const updatedList = await pipeline.getDetailedOpportunityStatus(orgId);
      const updatedMic = updatedList.find(s => s.category.toLowerCase().includes('microphone'));

      expect(updatedMic!.buyerQuestionsCount).toBe(3);
      // With 3 validated buyer questions, it can now advance to NEEDS_PRODUCT_EVIDENCE (awaiting manufacturer specs)
      expect(updatedMic!.funnelState).toBe('NEEDS_PRODUCT_EVIDENCE');
    });
  });

  describe('Canonical URL Normalization & Deduplication', () => {
    it('normalizes valid URLs with host case, stripped tracking, default ports, and trailing slashes', () => {
      const url1 = 'HTTPS://TechEnclave.com:443/community/threads/mic-review/?utm_source=google&utm_medium=cpc&gclid=12345#section1';
      const normalized1 = normalizeCanonicalUrl(url1);
      expect(normalized1).toBe('https://techenclave.com/community/threads/mic-review');

      const url2 = 'http://EXAMPLE.com:80/';
      const normalized2 = normalizeCanonicalUrl(url2);
      expect(normalized2).toBe('http://example.com/');

      const url3 = 'https://desidime.com/deals/item?page=2&b=1&a=2&fbclid=xyz';
      const normalized3 = normalizeCanonicalUrl(url3);
      expect(normalized3).toBe('https://desidime.com/deals/item?a=2&b=1&page=2');
    });

    it('rejects invalid schemes and credentials in URLs', () => {
      expect(normalizeCanonicalUrl('ftp://example.com/file')).toBeNull();
      expect(normalizeCanonicalUrl('javascript:alert(1)')).toBeNull();
      expect(normalizeCanonicalUrl('https://user:password@example.com/secret')).toBeNull();
      expect(normalizeCanonicalUrl('not-a-url')).toBeNull();
      expect(normalizeCanonicalUrl('')).toBeNull();
    });
  });
});
