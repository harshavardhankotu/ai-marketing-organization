import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDbForTesting, getDb } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';

describe('Production Startup Seeding Isolation & Security Boundary', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetDbForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('in NODE_ENV=production, creates 0 clinics, 0 public businesses, 0 unapproved offers, and 0 static tokens', () => {
    process.env.NODE_ENV = 'production';
    const db = getDb();
    db.prepare('DELETE FROM businesses').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM customer_offers').run();

    seedDatabase();

    // 1. Zero clinic businesses seeded in production
    const clinicCount = (db.prepare(
      "SELECT count(*) as count FROM businesses WHERE vertical_id = 'HEALTHCARE_CLINIC' OR name LIKE '%dental%'"
    ).get() as any).count;
    expect(clinicCount).toBe(0);

    // 2. Zero public-live businesses seeded in production
    const publicLiveCount = (db.prepare(
      'SELECT count(*) as count FROM businesses WHERE public_live = 1'
    ).get() as any).count;
    expect(publicLiveCount).toBe(0);

    // 3. Zero customer offers seeded in production (no unapproved 15000 setup offers)
    const offerCount = (db.prepare(
      'SELECT count(*) as count FROM customer_offers'
    ).get() as any).count;
    expect(offerCount).toBe(0);

    // 4. Zero static/hardcoded admin tokens in database
    const staticTokenCount = (db.prepare(
      "SELECT count(*) as count FROM users WHERE api_token = 'token_admin_prod_auth_2026'"
    ).get() as any).count;
    expect(staticTokenCount).toBe(0);

    // 5. Verify core infrastructure was properly seeded
    const orgOwner = db.prepare("SELECT * FROM organizations WHERE id = 'org_owner_primary'").get() as any;
    expect(orgOwner).toBeDefined();

    const bizPlatform = db.prepare("SELECT * FROM businesses WHERE id = 'biz_platform_aro'").get() as any;
    expect(bizPlatform).toBeDefined();
    expect(bizPlatform.public_live).toBe(0);

    const agentCount = (db.prepare('SELECT count(*) as count FROM agents').get() as any).count;
    expect(agentCount).toBe(80);

    const quotaCount = (db.prepare('SELECT count(*) as count FROM quota_records').get() as any).count;
    expect(quotaCount).toBeGreaterThanOrEqual(1);
  });

  it('in test mode, initializes test harness fixtures cleanly for local test suites', () => {
    process.env.NODE_ENV = 'test';
    seedDatabase();

    const db = getDb();
    const bizCount = (db.prepare('SELECT count(*) as count FROM businesses').get() as any).count;
    expect(bizCount).toBeGreaterThan(1);

    // Verify token_admin_prod_auth_2026 is NEVER used, even in test fixtures
    const staticProdToken = (db.prepare(
      "SELECT count(*) as count FROM users WHERE api_token = 'token_admin_prod_auth_2026'"
    ).get() as any).count;
    expect(staticProdToken).toBe(0);

    // Verify unapproved 15000 offer is never seeded
    const unapprovedOffer = db.prepare(
      "SELECT * FROM customer_offers WHERE id = 'coff_platform_setup_15000'"
    ).get();
    expect(unapprovedOffer).toBeUndefined();
  });
});
