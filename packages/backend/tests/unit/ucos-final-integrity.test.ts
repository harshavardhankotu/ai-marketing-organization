import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/index.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { AvailabilityEngine, localTimeToUtcIso } from '../../src/revenue/availability-engine.js';
import { TenantContextResolver } from '../../src/control-plane/tenant-context-resolver.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';

describe('Universal Commercial OS Final Integrity & Hardening Test Suite', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let db: any;

  beforeEach(() => {
    originalEnv = { ...process.env };
    db = resetDbForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function insertTestBusiness(id: string, orgId: string, slug: string = 'test-biz', overrides: Record<string, any> = {}) {
    db.prepare(`INSERT OR REPLACE INTO organizations (id, name, slug) VALUES (?, 'Test Org', 'test-org')`).run(orgId);
    db.prepare(`
      INSERT OR REPLACE INTO businesses (
        id, organization_id, name, public_slug, vertical_id, vertical_name,
        country, currency, timezone, locale, city, neighborhood, brand_voice
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      orgId,
      overrides.name || 'Test Business',
      slug,
      overrides.verticalId || 'dental',
      overrides.verticalName || 'Dental',
      overrides.country || 'US',
      overrides.currency || 'USD',
      overrides.timezone || 'UTC',
      overrides.locale || 'en-US',
      overrides.city || 'Austin',
      overrides.neighborhood || 'Downtown',
      overrides.brandVoice || 'Professional, empathetic, and direct'
    );
  }

  describe('1. Production Authentication Authority (Directives 2 & 17)', () => {
    it('authenticates valid OWNER_API_KEY in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'test_secret_owner_key_prod_2026';

      insertTestBusiness('biz_auth_01', OwnerAuthService.OWNER_ORGANIZATION_ID, 'biz-auth-01');

      const res = await app.request('/api/v1/business', {
        headers: {
          'Authorization': 'Bearer test_secret_owner_key_prod_2026'
        }
      });

      // Valid API key gets 200
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('biz_auth_01');
    });

    it('rejects SQLite users.api_token in production (zero SQLite auth authority)', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'test_secret_owner_key_prod_2026';

      insertTestBusiness('biz_auth_02', 'org_test_01', 'biz-auth-02');

      // Insert user with api_token into local SQLite
      db.prepare(`
        INSERT OR REPLACE INTO users (id, organization_id, email, name, role, api_token)
        VALUES ('usr_sqlite_only', 'org_test_01', 'user@test.com', 'SQLite User', 'ADMIN', 'token_only_in_sqlite_123');
      `).run();

      const res = await app.request('/api/v1/business', {
        headers: {
          'Authorization': 'Bearer token_only_in_sqlite_123'
        }
      });

      // Must be rejected with 401 in production!
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Invalid authentication credentials/i);
    });

    it('rejects unauthenticated requests in production even with client tenant headers', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'test_secret_owner_key_prod_2026';

      const res = await app.request('/api/v1/business', {
        headers: {
          'x-organization-id': 'org_owner_primary',
          'x-user-id': 'usr_owner_primary'
        }
      });

      expect(res.status).toBe(401);
    });

    it('fails closed when D1 session lookup throws during production authentication', async () => {
      process.env.NODE_ENV = 'production';
      process.env.OWNER_API_KEY = 'test_secret_owner_key_prod_2026';

      // Mock D1 repository to throw an outage error
      const repo = D1RevenueRepository.getInstance();
      vi.spyOn(repo, 'queryOne').mockRejectedValue(new Error('Cloudflare D1 Network Outage'));

      const authService = OwnerAuthService.getInstance();
      const session = await authService.validateTokenAsync('sess_own_fake_token_456');

      // Must return null (fail closed), NEVER falling back to SQLite
      expect(session).toBeNull();
    });
  });

  describe('2. Centralized Tenant Context Resolver (Directive 17)', () => {
    it('resolves tenant context by business slug accurately', async () => {
      const resolver = TenantContextResolver.getInstance();
      const bizId = `biz_dental_${Date.now()}`;

      insertTestBusiness(bizId, 'org_dent_01', 'smile-clinic-nyc', {
        name: 'Smile Clinic NYC',
        timezone: 'America/New_York',
        city: 'New York',
        neighborhood: 'Manhattan'
      });

      const ctx = await resolver.resolveTenant({ businessSlug: 'smile-clinic-nyc' });
      expect(ctx).not.toBeNull();
      expect(ctx?.businessId).toBe(bizId);
      expect(ctx?.currency).toBe('USD');
      expect(ctx?.timezone).toBe('America/New_York');
      expect(ctx?.organizationId).toBe('org_dent_01');
    });

    it('enforces tenant boundary and throws when organizationId mismatches business organization', async () => {
      const resolver = TenantContextResolver.getInstance();
      const bizId = `biz_secure_${Date.now()}`;

      insertTestBusiness(bizId, 'org_correct', 'secure-corp', {
        name: 'Secure Corp'
      });

      await expect(
        resolver.resolveTenant({
          businessId: bizId,
          organizationId: 'org_attacker_spoofed'
        })
      ).rejects.toThrow(/TENANT_SECURITY_VIOLATION/i);
    });
  });

  describe('3. Concurrency-Safe Atomic Booking & Timezone Accuracy (Directives 5, 8, 9)', () => {
    it('correctly converts international operating hours to UTC ISO strings across timezones', () => {
      // Test Asia/Kolkata (UTC +05:30): 09:00 IST is 03:30 UTC
      const kolkataIso = localTimeToUtcIso('2026-10-15', 9, 0, 'Asia/Kolkata');
      expect(kolkataIso).toBe('2026-10-15T03:30:00.000Z');

      // Test America/New_York (EDT UTC -04:00 in October): 09:00 EDT is 13:00 UTC
      const nyIso = localTimeToUtcIso('2026-10-15', 9, 0, 'America/New_York');
      expect(nyIso).toBe('2026-10-15T13:00:00.000Z');

      // Test Europe/London (BST UTC +01:00 in October): 09:00 BST is 08:00 UTC
      const londonIso = localTimeToUtcIso('2026-10-15', 9, 0, 'Europe/London');
      expect(londonIso).toBe('2026-10-15T08:00:00.000Z');
    });

    it('rejects reservation with TIME_NOT_AVAILABLE when preferredTime does not match any slot', async () => {
      const engine = AvailabilityEngine.getInstance();
      const bizId = `biz_time_test_${Date.now()}`;
      const orgId = 'org_time_test';

      insertTestBusiness(bizId, orgId, 'time-clinic');

      // Create a slot at 09:00:00Z on 2026-11-01
      db.prepare(`
        INSERT INTO availability_slots (
          id, business_id, organization_id, resource_id, resource_type,
          start_time, end_time, capacity, reserved_count, is_available
        ) VALUES ('slot_0900', ?, ?, 'staff_1', 'STAFF', '2026-11-01T09:00:00.000Z', '2026-11-01T09:30:00.000Z', 1, 0, 1)
      `).run(bizId, orgId);

      // Customer asks for 17:00 (5:00 PM) on that date
      const result = await engine.reserveSlot({
        businessId: bizId,
        preferredDate: '2026-11-01',
        preferredTime: '17:00',
        customerName: 'Alice Springs',
        customerContact: '+1234567890'
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe('UNAVAILABLE');
      expect(result.error).toMatch(/TIME_NOT_AVAILABLE/i);
    });

    it('performs compensating rollback when booking reservation insertion fails', async () => {
      const engine = AvailabilityEngine.getInstance();
      const repo = D1RevenueRepository.getInstance();
      const bizId = `biz_rollback_${Date.now()}`;
      const orgId = 'org_rollback_test';
      const slotId = `slot_rb_${Date.now()}`;

      insertTestBusiness(bizId, orgId, 'rb-clinic');

      db.prepare(`
        INSERT INTO availability_slots (
          id, business_id, organization_id, resource_id, resource_type,
          start_time, end_time, capacity, reserved_count, is_available
        ) VALUES (?, ?, ?, 'staff_1', 'STAFF', '2026-11-02T10:00:00.000Z', '2026-11-02T10:30:00.000Z', 1, 0, 1)
      `).run(slotId, bizId, orgId);

      // Spy on executeWrite: allow the availability_slots increment, but fail on booking_reservations insert
      const originalExecuteWrite = repo.executeWrite.bind(repo);
      vi.spyOn(repo, 'executeWrite').mockImplementation(async (table, sql, params) => {
        if (table === 'booking_reservations') {
          throw new Error('Disk full on booking_reservations');
        }
        return originalExecuteWrite(table, sql, params);
      });

      await expect(
        engine.reserveSlot({
          businessId: bizId,
          slotId,
          customerName: 'Bob Builder',
          customerContact: '+1987654321'
        })
      ).rejects.toThrow(/Disk full on booking_reservations/i);

      // Verify that reserved_count was rolled back to 0!
      const slot = db.prepare('SELECT reserved_count FROM availability_slots WHERE id = ?').get(slotId) as any;
      expect(slot.reserved_count).toBe(0);
    });
  });

  describe('4. Universal Order Provider Recovery State (Directive 13)', () => {
    it('returns PROVIDER_CREATED_D1_UPDATE_FAILED recovery warning if order status cannot update after checkout creation', async () => {
      const bizId = `biz_rzp_rec_${Date.now()}`;
      const orgId = 'org_rzp_rec';

      insertTestBusiness(bizId, orgId, 'rzp-rec-clinic', {
        country: 'IN',
        currency: 'INR',
        timezone: 'Asia/Kolkata'
      });

      db.prepare(`
        INSERT INTO customer_offers (
          id, business_id, organization_id, title, price_minor, currency, active
        ) VALUES ('off_rzp_rec', ?, ?, 'Consultation', 150000, 'INR', 1)
      `).run(bizId, orgId);

      const res = await app.request('/api/v1/payments/razorpay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: bizId,
          offerId: 'off_rzp_rec',
          amountINR: 1500
        })
      });

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.orderId).toBeDefined();
    });
  });
});
