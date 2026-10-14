import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../src/db/client.js';
import { AutonomousRevenueOrchestrator } from '../../src/revenue/autonomous-revenue-orchestrator.js';
import { AutomaticOfferLane } from '../../src/commission/automatic-offer-lane.js';
import { ActionCooldownManager } from '../../src/revenue/action-cooldown-manager.js';
import { UnifiedQuotaService } from '../../src/quota/unified-quota-service.js';
import { PartnerRegistryEngine } from '../../src/commission/partner-registry.js';

describe('Step 2: Dynamic Offer Discovery Suite', () => {
  const db = getDb();
  const orgId = 'org_owner_primary';
  const bizId = 'biz_platform_aro';

  beforeEach(() => {
    // Ensure signal_type column exists on demand_signals
    try { db.exec("ALTER TABLE demand_signals ADD COLUMN signal_type TEXT DEFAULT 'BUYER_QUESTION'"); } catch {}
    // Ensure domain_policy table exists and is seeded
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS domain_policy (
          id TEXT PRIMARY KEY,
          domain TEXT NOT NULL UNIQUE,
          policy TEXT NOT NULL DEFAULT 'REJECT',
          reject_class TEXT,
          reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO domain_policy (id, domain, policy, reject_class, reason) VALUES
          ('dp_amazon', 'amazon.in', 'REJECT', 'MARKETPLACE', 'Amazon pages must never be scraped or fetched'),
          ('dp_amazon_com', 'amazon.com', 'REJECT', 'MARKETPLACE', 'Amazon pages must never be scraped or fetched'),
          ('dp_flipkart', 'flipkart.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
          ('dp_snapdeal', 'snapdeal.com', 'REJECT', 'MARKETPLACE', 'Marketplace domain rejected as brand source'),
          ('dp_pcmag', 'pcmag.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
          ('dp_techradar', 'techradar.com', 'REJECT', 'REVIEW_SITE', 'Third-party review publisher rejected as brand source'),
          ('dp_reddit', 'reddit.com', 'REJECT', 'SOCIAL_NETWORK', 'Community forum rejected as brand source'),
          ('dp_youtube', 'youtube.com', 'REJECT', 'VIDEO_SITE', 'Video platform rejected as brand source'),
          ('dp_pdf', '*.pdf', 'REJECT', 'FILE_TYPE', 'Binary PDF documents rejected as web spec source');
        CREATE TABLE IF NOT EXISTS brand_spec_lines (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          brand TEXT NOT NULL,
          model TEXT NOT NULL,
          spec_line TEXT NOT NULL,
          source_url TEXT NOT NULL,
          retrieved_at TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    } catch {}
    // Reset partner offers and demand signals for hermetic tests
    db.prepare("DELETE FROM partner_offers WHERE organization_id = ?").run(orgId);
    db.prepare("DELETE FROM action_cooldowns WHERE action_type = 'DISCOVER_OFFER'").run();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Grep test: zero hardcoded brands in discovery source
  it('no hardcoded brand exists in the discovery source (grep test)', () => {
    const candidates = [
      path.resolve('src/revenue/autonomous-revenue-orchestrator.ts'),
      path.resolve('packages/backend/src/revenue/autonomous-revenue-orchestrator.ts')
    ];
    const orchestratorPath = candidates.find(p => fs.existsSync(p))!;
    const sourceCode = fs.readFileSync(orchestratorPath, 'utf8');

    // Extract the DISCOVER_OFFER case block
    const discoverOfferMatch = sourceCode.match(/case 'DISCOVER_OFFER':([\s\S]*?)case 'QUARANTINE_BAD_PROVIDER':/);
    expect(discoverOfferMatch).toBeTruthy();
    const discoverBlock = discoverOfferMatch![1];

    // Verify zero hardcoded brand or product strings in DISCOVER_OFFER block
    const forbiddenHardcodedStrings = [
      'Phomemo',
      'PM-241BT',
      'B08P13WGLX',
      'Direct Thermal 203 DPI Resolution Printing',
      'Maximum print speed of 150 mm per second',
      'amazon-b08p13wglx'
    ];

    for (const forbidden of forbiddenHardcodedStrings) {
      expect(discoverBlock).not.toContain(forbidden);
    }
  });

  // 2. A need with 2 signals does not create an offer
  it('a need with 2 signals does not create an offer', async () => {
    // Provide a valid owner_intake row so gate 4b passes and tests signal count
    db.prepare(`
      INSERT OR REPLACE INTO owner_intake (
        id, organization_id, application_date, listed_site_urls_json,
        agreement_read_confirmed, agreement_read_confirmed_at,
        site_name, author_name, contact_email, tavily_key_rotated,
        completed_at, updated_at, written_by, status, created_at
      ) VALUES (
        'intake_test_valid', ?, '2026-01-01', '["https://example.com"]',
        1, datetime('now'),
        'Test Site', 'Test Author', 'test@example.com', 1,
        datetime('now'), datetime('now'), 'OWNER_FORM', 'VALID', datetime('now')
      )
    `).run(orgId);

    // Clear demand signals and insert only 2 signals for a unique category
    db.prepare("DELETE FROM demand_signals WHERE category = 'dual_signal_gadget'").run();
    db.prepare(`
      INSERT INTO demand_signals (
        id, organization_id, topic, category, location, intent_type, raw_query,
        evidence_snippet, source_url, urgency, estimated_monthly_volume, status, signal_type, created_at
      ) VALUES
      ('dem_test_low_01', ?, 'How to use portable label printer?', 'dual_signal_gadget', 'India', 'SEARCH_QUERY', 'portable label printer', 'snippet 1', 'https://forum.in/q1', 0.5, 100, 'DISCOVERED', 'BUYER_QUESTION', datetime('now')),
      ('dem_test_low_02', ?, 'Where to buy labels for mini printer?', 'dual_signal_gadget', 'India', 'SEARCH_QUERY', 'mini printer labels', 'snippet 2', 'https://forum.in/q2', 0.5, 100, 'DISCOVERED', 'BUYER_QUESTION', datetime('now'))
    `).run(orgId, orgId);

    // Also delete any other buyer questions so dual_signal_gadget is top
    const existingOther = db.prepare("SELECT DISTINCT category FROM demand_signals WHERE signal_type = 'BUYER_QUESTION' AND category != 'dual_signal_gadget'").all() as any[];
    db.prepare("UPDATE demand_signals SET signal_type = 'RESEARCH' WHERE category != 'dual_signal_gadget'").run();

    try {
      const orchestrator = AutonomousRevenueOrchestrator.getInstance();
      const result = await (orchestrator as any).executeAction(
        { actionType: 'DISCOVER_OFFER', targetId: bizId },
        orgId,
        bizId,
        'cycle_test_low_signals',
        { id: bizId, vertical_id: 'hardware' }
      );

      expect(result.status).toBe('NEEDS_MORE_SIGNALS');
      const offers = await PartnerRegistryEngine.getInstance().listOffers(orgId);
      const lowSignalOffer = offers.find(o => o.category === 'dual_signal_gadget');
      expect(lowSignalOffer).toBeUndefined();
    } finally {
      db.prepare("DELETE FROM owner_intake WHERE id = 'intake_test_valid'").run();
      // Restore signals
      for (const row of existingOther) {
        db.prepare("UPDATE demand_signals SET signal_type = 'BUYER_QUESTION' WHERE category = ?").run(row.category);
      }
    }
  });

  // 3. A marketplace domain is rejected as a source
  it('a marketplace domain is rejected as a source', () => {
    const lane = AutomaticOfferLane.getInstance();
    const rejectedUrls = [
      'https://www.amazon.in/dp/B08P13WGLX',
      'https://amazon.com/product/123',
      'https://www.flipkart.com/item/456',
      'https://snapdeal.com/product/789',
      'https://pcmag.com/review/printer',
      'https://techradar.com/review/scanner',
      'https://reddit.com/r/printers',
      'https://youtube.com/watch?v=12345',
      'https://example.com/spec_sheet.pdf'
    ];

    for (const url of rejectedUrls) {
      const check = lane.checkDomainPolicy(url);
      expect(check.allowed).toBe(false);
      expect(check.rejectClass).toBeDefined();
    }

    // Official brand domain is allowed
    const validCheck = lane.checkDomainPolicy('https://manufacturer.com/specs');
    expect(validCheck.allowed).toBe(true);
  });

  // 4. The action respects the cooldown and the budget
  it('the action respects the cooldown and the budget', async () => {
    // 4a. Cooldown test
    ActionCooldownManager.recordExecution(bizId, 'DISCOVER_OFFER', true);
    const cooldownCheck = ActionCooldownManager.check(bizId, 'DISCOVER_OFFER');
    expect(cooldownCheck.eligible).toBe(false);

    const orchestrator = AutonomousRevenueOrchestrator.getInstance();
    const cooldownResult = await (orchestrator as any).executeAction(
      { actionType: 'DISCOVER_OFFER', targetId: bizId },
      orgId,
      bizId,
      'cycle_test_cooldown',
      { id: bizId, vertical_id: 'hardware' }
    );
    expect(cooldownResult.status).toBe('COOLDOWN_ACTIVE');

    // 4b. Daily budget test
    // Reset cooldown to test budget lock
    db.prepare("DELETE FROM action_cooldowns WHERE action_type = 'DISCOVER_OFFER'").run();
    const quota = UnifiedQuotaService.getInstance();
    quota.lockProvider('TAVILY', 'Monthly cap exhausted');

    try {
      const budgetResult = await (orchestrator as any).executeAction(
        { actionType: 'DISCOVER_OFFER', targetId: bizId },
        orgId,
        bizId,
        'cycle_test_budget',
        { id: bizId, vertical_id: 'hardware' }
      );
      expect(budgetResult.status).toBe('BLOCKED_AUTHORIZATION');
      expect(budgetResult.error).toContain('DISCOVER_OFFER_BUDGET_EXCEEDED');
    } finally {
      quota.unlockProvider('TAVILY');
    }
  });

  // 5. The code never calls fetch on an amazon.* host
  it('the code never calls fetch on an amazon.* host', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const lane = AutomaticOfferLane.getInstance();

    // Verify domain policy explicitly rejects amazon
    expect(lane.checkDomainPolicy('https://www.amazon.in/s?k=printer').allowed).toBe(false);
    expect(lane.checkDomainPolicy('https://www.amazon.com/dp/123').allowed).toBe(false);

    // Verify building search link does NOT trigger any network call
    const searchUrl = lane.buildAmazonSearchUrl('Epson', 'EcoTank L3210');
    expect(searchUrl).toContain('https://www.amazon.in/s?k=Epson%20EcoTank%20L3210');
    expect(searchUrl).toContain('tag=');

    // Attempting to fetch brand specs with amazon URL must throw without fetching
    await expect(lane.fetchAndStoreBrandSpecs('prod_test', 'AmazonBrand', 'ModelX', 'https://www.amazon.in/dp/B08X'))
      .rejects.toThrow(/DOMAIN_REJECTED|AMAZON_FETCH_FORBIDDEN/);

    // Ensure fetch was never called with any amazon.* URL
    for (const call of fetchSpy.mock.calls) {
      const urlArg = String(call[0]);
      expect(urlArg).not.toMatch(/https?:\/\/[^/]*amazon\./i);
    }
  });

  // 6. DISCOVER_OFFER returns BLOCKED_ON_OWNER_FACTS when owner facts are not set
  it('DISCOVER_OFFER returns BLOCKED_ON_OWNER_FACTS with missing names when owner_intake is not valid', async () => {
    // Ensure no valid owner_intake row exists
    db.prepare("DELETE FROM owner_intake WHERE status = 'VALID'").run();

    // Ensure all 6 owner env vars are cleared
    const savedEnv = { ...process.env };
    delete process.env.ASSOCIATES_APPLICATION_DATE;
    delete process.env.ASSOCIATES_LISTED_SITE_URL;
    delete process.env.ASSOCIATES_AGREEMENT_READ;
    delete process.env.PUBLIC_SITE_NAME;
    delete process.env.PUBLIC_AUTHOR_NAME;
    delete process.env.PUBLIC_CONTACT_EMAIL;

    try {
      const orchestrator = AutonomousRevenueOrchestrator.getInstance();
      const result = await (orchestrator as any).executeAction(
        { actionType: 'DISCOVER_OFFER', targetId: bizId },
        orgId,
        bizId,
        'cycle_test_missing_owner_facts',
        { id: bizId, vertical_id: 'hardware' }
      );

      expect(result.status).toBe('BLOCKED_ON_OWNER_FACTS');
      expect(result.details).toContain('Offer activation blocked: owner_intake is not VALID');
      expect(result.details).toContain('ASSOCIATES_APPLICATION_DATE');
      expect(result.details).toContain('ASSOCIATES_LISTED_SITE_URL');
      expect(result.details).toContain('ASSOCIATES_AGREEMENT_READ');
      expect(result.details).toContain('PUBLIC_SITE_NAME');
      expect(result.details).toContain('PUBLIC_AUTHOR_NAME');
      expect(result.details).toContain('PUBLIC_CONTACT_EMAIL');
    } finally {
      process.env = savedEnv;
    }
  });
});

