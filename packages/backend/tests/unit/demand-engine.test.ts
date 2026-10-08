import { describe, it, expect, beforeEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { DemandEngine, MANDATORY_STATUTORY_DISCLOSURE } from '../../src/commission/demand-engine.js';

describe('Step 2: Demand Engine State Machine & Safeguards (Fixtures Only)', () => {
  let engine: DemandEngine;

  beforeEach(() => {
    resetDbForTesting();
    engine = DemandEngine.getInstance();
    const db = getDb();

    // Seed default organization
    db.prepare(`
      INSERT OR IGNORE INTO organizations (id, name, slug, created_at)
      VALUES ('org_owner_primary', 'Primary Owner Organization', 'owner-primary', datetime('now'))
    `).run();

    // Seed approved source host
    db.prepare(`
      INSERT OR IGNORE INTO source_rules (
        host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes
      ) VALUES (
        'reddit.com', 1, 0, 1, 0, 1, 'Approved community forum for hand-posted buyer replies'
      )
    `).run();

    // Seed unapproved host
    db.prepare(`
      INSERT OR IGNORE INTO source_rules (
        host, allows_links, allows_affiliate, needs_disclosure, automation_allowed, owner_approved, notes
      ) VALUES (
        'unapproved-community.com', 1, 0, 1, 0, 0, 'Unapproved candidate host'
      )
    `).run();

    // Seed an approved partner and active offer
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

  it('2a-2d: A good fixture post becomes a draft with clean landing URL and statutory disclosure', async () => {
    // 1. Ingest good fixture post from approved host
    const ingestRes = await engine.ingestSignal({
      sourceHost: 'reddit.com',
      url: 'https://reddit.com/r/indiabusiness/comments/good_printer_recommendation',
      rawText: 'Looking for a reliable thermal label printer under ₹15,000 in Bangalore for shipping packages. Can someone suggest a good one?',
      rawAuthor: 'UserBangalore123',
      foundAt: new Date(Date.now() - 2 * 86400 * 1000).toISOString(),
      category: 'office_electronics',
      city: 'Bangalore',
      budgetHint: 'under ₹15,000'
    });

    expect(ingestRes.signalId).toBeDefined();
    expect(ingestRes.status).toBe('SIGNAL');

    // Verify raw author PII is never stored in DB (only SHA-256 hash)
    const db = getDb();
    const signalRow = db.prepare('SELECT author_hash, excerpt FROM demand_signals WHERE id = ?').get(ingestRes.signalId) as any;
    expect(signalRow.author_hash).not.toContain('UserBangalore123');
    expect(signalRow.author_hash.length).toBe(64); // SHA-256 hex string
    expect(signalRow.excerpt.length).toBeLessThanOrEqual(300);

    // 2. Qualify with deterministic rules
    const qualRes = await engine.processQualification(ingestRes.signalId);
    expect(qualRes.qualified).toBe(true);
    expect(qualRes.intentScore).toBeGreaterThanOrEqual(40);
    expect(qualRes.urgency).toBeDefined();

    const qualSignal = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get(ingestRes.signalId) as any;
    expect(qualSignal.status).toBe('QUALIFIED');

    // 3. Match against active partner offers
    const matchRes = await engine.matchSignal(ingestRes.signalId);
    expect(matchRes.matched).toBe(true);
    expect(matchRes.offerId).toBe('off_phomemo_pm241');
    expect(matchRes.expectedValue).toBeGreaterThan(0);
    expect(matchRes.evBasis).toBe('ESTIMATED');

    const matchedSignal = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get(ingestRes.signalId) as any;
    expect(matchedSignal.status).toBe('MATCHED');

    // 4. Create outreach draft
    const draftRes = await engine.createOutreachDraft(ingestRes.signalId);
    expect(draftRes.status).toBe('DRAFTED');
    expect(draftRes.disclosureText).toBe(MANDATORY_STATUTORY_DISCLOSURE);

    // Clean buyer guide URL only — strictly zero tagged affiliate parameters in draft text
    expect(draftRes.landingUrl).toContain('/guides/phomemo-pm241bt-printer?ref=');
    expect(draftRes.draftText).not.toContain('tag=');
    expect(draftRes.draftText).not.toContain('amazon.in/dp');

    // 3-day expiry
    const expiryDate = new Date(draftRes.expiresAt).getTime();
    const now = Date.now();
    const diffHours = (expiryDate - now) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(70);
    expect(diffHours).toBeLessThanOrEqual(73);

    const draftedSignal = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get(ingestRes.signalId) as any;
    expect(draftedSignal.status).toBe('DRAFTED');
  });

  it('2b: Solved thread, seller post, and health/medical post are dropped', async () => {
    // 1. Solved thread
    const solvedRes = engine.qualifySignal({
      sourceHost: 'reddit.com',
      rawText: 'Looking for a label printer under ₹15000 in Mumbai. [solved] Already bought the TVS printer, works great!',
      foundAt: new Date().toISOString(),
      category: 'office_electronics',
      city: 'Mumbai'
    });
    expect(solvedRes.qualified).toBe(false);
    expect(solvedRes.reason).toBe('SOLVED');

    // 2. Seller post / commercial advertising
    const sellerRes = engine.qualifySignal({
      sourceHost: 'reddit.com',
      rawText: 'We are selling direct thermal label printers in Delhi with 1 year warranty. DM for price and wholesale catalog!',
      foundAt: new Date().toISOString(),
      category: 'office_electronics',
      city: 'Delhi'
    });
    expect(sellerRes.qualified).toBe(false);
    expect(sellerRes.reason).toBe('SELLER_POST');

    // 3. Health / medical category post
    const healthRes = engine.qualifySignal({
      sourceHost: 'reddit.com',
      rawText: 'Can anyone suggest good skin care supplements for acne under ₹2000 in Bangalore? Need urgent recommendation.',
      foundAt: new Date().toISOString(),
      category: 'skin care supplements',
      city: 'Bangalore'
    });
    expect(healthRes.qualified).toBe(false);
    expect(healthRes.reason).toBe('BLOCKED_CATEGORY');

    // 4. Non-India relevant post
    const globalRes = engine.qualifySignal({
      sourceHost: 'reddit.com',
      rawText: 'Suggest a good printer under $200 in Seattle.',
      foundAt: new Date().toISOString(),
      category: 'office_electronics'
    });
    expect(globalRes.qualified).toBe(false);
    expect(globalRes.reason).toBe('NOT_INDIA_RELEVANT');
  });

  it('2a: A host not approved by owner is never read', async () => {
    await expect(
      engine.ingestSignal({
        sourceHost: 'unapproved-community.com',
        url: 'https://unapproved-community.com/thread/123',
        rawText: 'Looking for projector under ₹30,000 in Hyderabad. Recommend one please.',
        foundAt: new Date().toISOString(),
        category: 'home_theater',
        city: 'Hyderabad'
      })
    ).rejects.toThrow(/HOST_NOT_APPROVED/);
  });

  it('2d: Draft with no disclosure fails validation', async () => {
    // Statutory disclosure constant is enforced
    expect(MANDATORY_STATUTORY_DISCLOSURE.length).toBeGreaterThan(20);
    expect(MANDATORY_STATUTORY_DISCLOSURE).toContain('affiliate commission');
  });

  it('2e: The engine never calls a posting function — owner hand-posts with two buttons', async () => {
    // 1. Verify source rules hardcode automation_allowed to 0
    const db = getDb();
    const rules = db.prepare('SELECT host, automation_allowed FROM source_rules').all() as any[];
    for (const r of rules) {
      expect(r.automation_allowed).toBe(0);
    }

    // 2. Ingest, qualify, match, and draft a signal
    const ingestRes = await engine.ingestSignal({
      sourceHost: 'reddit.com',
      url: 'https://reddit.com/r/indianstartups/comments/printer_help',
      rawText: 'Need urgently: suggest thermal printer for e-commerce invoices under ₹15000 in Pune.',
      foundAt: new Date().toISOString(),
      category: 'office_electronics',
      city: 'Pune'
    });

    await engine.processQualification(ingestRes.signalId);
    await engine.matchSignal(ingestRes.signalId);
    const draftRes = await engine.createOutreachDraft(ingestRes.signalId);

    // 3. Top drafts for TODAY page returns the draft with two-button metadata
    const topDrafts = engine.getTopDraftsForToday(5);
    expect(topDrafts.length).toBe(1);
    expect(topDrafts[0].draftId).toBe(draftRes.draftId);
    expect(topDrafts[0].sourceUrl).toContain('indianstartups');

    // 4. Signal status is DRAFTED (never POSTED automatically)
    let sigRow = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get(ingestRes.signalId) as any;
    expect(sigRow.status).toBe('DRAFTED');

    // 5. Owner explicitly clicks "Mark posted"
    const postRes = engine.markPostedByOwner(draftRes.draftId);
    expect(postRes.success).toBe(true);
    expect(postRes.postedAt).toBeDefined();

    // Signal and draft statuses transition to POSTED_BY_OWNER
    sigRow = db.prepare('SELECT status FROM demand_signals WHERE id = ?').get(ingestRes.signalId) as any;
    expect(sigRow.status).toBe('POSTED_BY_OWNER');

    const draftRow = db.prepare('SELECT status FROM outreach_drafts WHERE id = ?').get(draftRes.draftId) as any;
    expect(draftRow.status).toBe('POSTED_BY_OWNER');
  });

  it('2f: Source is auto-disabled after 30 drafts and 0 clicks, recording to learning_records', async () => {
    const db = getDb();

    // Seed 30 drafts from a host with 0 clicks
    for (let i = 0; i < 30; i++) {
      const sigId = `dsig_fake_${i}`;
      const draftId = `drft_fake_${i}`;
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, category, raw_query, evidence_snippet,
          source_url, source_host, url, excerpt, author_hash, status, dedupe_hash, created_at
        ) VALUES (
          ?, 'org_owner_primary', 'electronics', 'office_electronics', 'query', 'snippet',
          'url', 'reddit.com', 'url', 'excerpt', 'hash', 'POSTED_BY_OWNER', ?, datetime('now')
        )
      `).run(sigId, `dedupe_${i}`);

      db.prepare(`
        INSERT INTO outreach_drafts (
          id, signal_id, channel, draft_text, landing_url, disclosure_text, status, expires_at, created_at
        ) VALUES (
          ?, ?, 'COMMUNITY_FORUM', 'text', 'https://example.com/guide', 'disclosure', 'POSTED_BY_OWNER', datetime('now', '+3 days'), datetime('now')
        )
      `).run(draftId, sigId);
    }

    // Evaluate health
    const health = engine.evaluateSourceHealth('reddit.com');
    expect(health.active).toBe(false);
    expect(health.draftsCount).toBe(30);
    expect(health.clicksCount).toBe(0);

    // Host must be disabled in source_rules
    const hostRule = db.prepare('SELECT owner_approved FROM source_rules WHERE host = ?').get('reddit.com') as any;
    expect(hostRule.owner_approved).toBe(0);

    // Outcome recorded in learning_records as FAILED
    const lrnRow = db.prepare("SELECT outcome, rule FROM learning_records WHERE learning_type = 'SOURCE_HEALTH'").get() as any;
    expect(lrnRow).toBeDefined();
    expect(lrnRow.outcome).toBe('FAILED');
    expect(lrnRow.rule).toBe('Disable a source after 30 drafts and 0 clicks');
  });

  it('2d: Enforces daily draft limit of 10', async () => {
    const db = getDb();

    // Seed 10 drafts created today
    for (let i = 0; i < 10; i++) {
      const sigId = `sig_limit_${i}`;
      db.prepare(`
        INSERT INTO demand_signals (
          id, organization_id, topic, category, raw_query, evidence_snippet,
          source_url, source_host, url, excerpt, author_hash, status, dedupe_hash, created_at
        ) VALUES (
          ?, 'org_owner_primary', 'electronics', 'office_electronics', 'query', 'snippet',
          'url', 'reddit.com', 'url', 'excerpt', 'hash', 'MATCHED', ?, datetime('now')
        )
      `).run(sigId, `dedupe_limit_${i}`);

      db.prepare(`
        INSERT INTO demand_matches (id, signal_id, offer_id, expected_value, ev_basis, created_at)
        VALUES (?, ?, 'off_phomemo_pm241', 1.12, 'ESTIMATED', datetime('now'))
      `).run(`match_limit_${i}`, sigId);

      db.prepare(`
        INSERT INTO outreach_drafts (
          id, signal_id, channel, draft_text, landing_url, disclosure_text, status, expires_at, created_at
        ) VALUES (
          ?, ?, 'COMMUNITY_FORUM', 'text', 'https://example.com/guide', 'disclosure', 'DRAFTED', datetime('now', '+3 days'), datetime('now')
        )
      `).run(`draft_limit_${i}`, sigId);
    }

    // 11th signal attempt
    const extraSig = 'sig_limit_extra';
    db.prepare(`
      INSERT INTO demand_signals (
        id, organization_id, topic, category, raw_query, evidence_snippet,
        source_url, source_host, url, excerpt, author_hash, status, dedupe_hash, created_at
      ) VALUES (
        ?, 'org_owner_primary', 'electronics', 'office_electronics', 'query', 'snippet',
        'url', 'reddit.com', 'url', 'excerpt', 'hash', 'MATCHED', ?, datetime('now')
      )
    `).run(extraSig, 'dedupe_extra');

    db.prepare(`
      INSERT INTO demand_matches (id, signal_id, offer_id, expected_value, ev_basis, created_at)
      VALUES ('match_extra', ?, 'off_phomemo_pm241', 1.12, 'ESTIMATED', datetime('now'))
    `).run(extraSig);

    await expect(engine.createOutreachDraft(extraSig)).rejects.toThrow(/DAILY_DRAFT_LIMIT_REACHED/);
  });
});
