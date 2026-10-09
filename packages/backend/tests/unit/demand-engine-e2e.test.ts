import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { DemandEngine, MANDATORY_STATUTORY_DISCLOSURE } from '../../src/commission/demand-engine.js';

describe('Demand Engine End-to-End Fixture Test (Step 6d)', () => {
  let engine: DemandEngine;

  beforeEach(() => {
    resetDbForTesting();
    engine = DemandEngine.getInstance();
    const db = getDb();

    // 1. Seed primary organization
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
      VALUES ('org_owner_primary', 'Primary Owner Organization', 'owner-primary', datetime('now'))
    `).run();

    // 2. Seed approved source host
    db.prepare(`
      INSERT OR IGNORE INTO source_rules (
        host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes, terms_checked_at
      ) VALUES (
        'reddit.com', 1, 0, 1, 0, 1, 'Approved community forum for manual owner replies only', datetime('now')
      )
    `).run();

    // 3. Seed approved partner & active offer
    db.prepare(`
      INSERT OR IGNORE INTO partners (id, organization_id, name, industry, website, partner_type, approval_status, country)
      VALUES ('part_amazon_in_01', 'org_owner_primary', 'Amazon Associates India', 'E-commerce', 'https://associates.amazon.in', 'AFFILIATE', 'APPROVED', 'India')
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO partner_offers (
        id, partner_id, organization_id, title, offer_slug, category,
        target_customer, price_inr, commission_amount_inr, destination_url,
        authorized_tracking_url, active, status
      ) VALUES (
        'off_phomemo_pm241', 'part_amazon_in_01', 'org_owner_primary',
        'Phomemo PM-241BT Shipping Label Printer', 'phomemo-pm241bt-printer', 'office_electronics',
        'E-commerce sellers', 14999, 750, 'https://www.amazon.in/dp/B08X4B6F77',
        'https://www.amazon.in/dp/B08X4B6F77?tag=testtag-21', 1, 'ACTIVE'
      )
    `).run();
  });

  it('runs full demand engine: fixture input > discover > qualify > match > draft (0 ledger rows, 0 messages sent)', async () => {
    const db = getDb();

    // Initial state check
    const initialCommissionRows = (db.prepare('SELECT count(*) as c FROM commission_records').get() as any).c;
    const initialRevenueRows = (db.prepare('SELECT count(*) as c FROM revenue_records').get() as any).c;
    const initialOutboundMessages = (db.prepare('SELECT count(*) as c FROM outbound_contacts').get() as any).c;
    expect(initialCommissionRows).toBe(0);
    expect(initialRevenueRows).toBe(0);
    expect(initialOutboundMessages).toBe(0);

    // Step A: Input candidate signal (discovery fixture from owner-approved host)
    const rawSignal = {
      sourceHost: 'reddit.com',
      url: 'https://reddit.com/r/indiabusiness/comments/label_printer_recommendations',
      rawText: 'Looking for a reliable thermal label printer under ₹15,000 in Mumbai for e-commerce shipping. Which one should I buy?',
      rawAuthor: 'ProspectiveBuyer42',
      foundAt: new Date(Date.now() - 3 * 86400 * 1000).toISOString(), // 3 days ago
      category: 'office_electronics',
      city: 'Mumbai',
      budgetHint: 'under ₹15,000'
    };

    const ingestResult = await engine.ingestSignal(rawSignal);
    expect(ingestResult.signalId).toBeDefined();
    expect(ingestResult.status).toBe('SIGNAL');

    // Step B: Qualify
    const qualResult = await engine.processQualification(ingestResult.signalId);
    expect(qualResult.qualified).toBe(true);
    expect(qualResult.intentScore).toBeGreaterThanOrEqual(50);
    expect(qualResult.urgency).toBeDefined();

    const qualSignalRow = db.prepare('SELECT status, author_hash, excerpt FROM demand_signals WHERE id = ?').get(ingestResult.signalId) as any;
    expect(qualSignalRow.status).toBe('QUALIFIED');
    expect(qualSignalRow.author_hash).not.toContain('ProspectiveBuyer42'); // Hashed PII
    expect(qualSignalRow.excerpt.length).toBeLessThanOrEqual(300);

    // Step C: Match
    const matchResult = await engine.matchSignal(ingestResult.signalId);
    expect(matchResult.matched).toBe(true);
    expect(matchResult.offerId).toBe('off_phomemo_pm241');
    expect(matchResult.expectedValue).toBeGreaterThan(0);
    expect(matchResult.evBasis).toBe('ESTIMATED');

    const matchSignalRow = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get(ingestResult.signalId) as any;
    expect(matchSignalRow.status).toBe('MATCHED');

    // Step D: Draft outreach
    const draftResult = await engine.createOutreachDraft(ingestResult.signalId);
    expect(draftResult.status).toBe('DRAFTED');
    expect(draftResult.draftText).toBeDefined();
    expect(draftResult.landingUrl).toContain('/guides/phomemo-pm241bt-printer?ref=');
    expect(draftResult.disclosureText).toBe(MANDATORY_STATUTORY_DISCLOSURE);

    // CRITICAL REVENUE TRUTH ASSERTIONS:
    // 1. Zero rows added to commission ledger
    const finalCommissionRows = (db.prepare('SELECT count(*) as c FROM commission_records').get() as any).c;
    expect(finalCommissionRows).toBe(0);

    // 2. Zero rows added to general revenue ledger
    const finalRevenueRows = (db.prepare('SELECT count(*) as c FROM revenue_records').get() as any).c;
    expect(finalRevenueRows).toBe(0);

    // 3. Zero external messages sent (automation_allowed is false, draft requires owner action)
    const finalOutboundMessages = (db.prepare('SELECT count(*) as c FROM outbound_contacts').get() as any).c;
    expect(finalOutboundMessages).toBe(0);

    // 4. Draft record exists with status DRAFTED, awaiting owner human review
    const draftRecord = db.prepare('SELECT status, expires_at FROM outreach_drafts WHERE id = ?').get(draftResult.draftId) as any;
    expect(draftRecord.status).toBe('DRAFTED');
    expect(new Date(draftRecord.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
