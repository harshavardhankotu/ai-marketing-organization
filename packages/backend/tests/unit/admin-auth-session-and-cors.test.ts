import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/index.js';
import { resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { fetchApi, onUnauthorized, ApiError } from '../../../frontend/src/services/api.js';

describe('Admin Authentication, Session Cookies & CORS Security', () => {
  const originalEnv = { ...process.env };
  const TEST_KEY = 'test_owner_secret_key_prod_2026';

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OWNER_API_KEY = TEST_KEY;
    resetDbForTesting();
    seedDatabase();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. Backend Production Authentication Fail-Closed Boundary', () => {
    it('rejects protected admin request when no credentials are provided (401)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/business');
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/In production, an authenticated principal is required/i);
    });

    it('rejects identity headers alone as an authentication mechanism in production (401)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/business', {
        headers: {
          'x-user-id': 'usr_owner_01',
          'x-organization-id': 'org_owner_primary'
        }
      });
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.error).toMatch(/Client identity headers alone are rejected/i);
    });

    it('rejects invalid credentials in production (401)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/business', {
        headers: {
          'Authorization': 'Bearer forged_or_invalid_secret_token'
        }
      });
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.error).toMatch(/Invalid authentication credentials/i);
    });

    it('authenticates valid OWNER_API_KEY via Authorization Bearer in production (200)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/business', {
        headers: {
          'Authorization': `Bearer ${TEST_KEY}`
        }
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
    });

    it('authenticates valid OWNER_API_KEY via x-api-key header in production (200)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/business', {
        headers: {
          'x-api-key': TEST_KEY
        }
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.success).toBe(true);
    });

    it('allows public endpoints without authentication in production', async () => {
      process.env.NODE_ENV = 'production';

      // 1. Health check
      const healthRes = await app.request('/api/v1/health');
      expect(healthRes.status).toBe(200);

      // 2. Public lead capture
      const leadRes = await app.request('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_platform_aro',
          customerName: 'Public Customer',
          customerPhone: '+919848011223',
          customerEmail: 'customer@example.com',
          channel: 'WHATSAPP'
        })
      });
      expect(leadRes.status).toBe(201);
    });
  });

  describe('2. Owner Session Lifecycle (Login, Session Verification, Logout)', () => {
    it('creates an authenticated session and sets HttpOnly cookie on POST /auth/owner/login', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: TEST_KEY })
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('owner_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Path=/');
      expect(setCookie).toContain('Max-Age=86400');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');

      const json = await res.json() as any;
      expect(json.success).toBe(true);
      expect(json.data.principal_type).toBe('OWNER');
      // Token is intentionally omitted from JSON response in production (stored in cookie only)
      expect(json.data.token).toBeUndefined();
    });

    it('rejects POST /auth/owner/login with invalid credentials (401)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'wrong_secret' })
      });

      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Invalid owner credentials/i);
    });

    it('allows access to protected routes using the owner_session cookie', async () => {
      process.env.NODE_ENV = 'production';

      // 1. Log in to obtain session token
      const loginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: TEST_KEY })
      });
      const cookieHeader = loginRes.headers.get('set-cookie') || '';
      const cookieMatch = cookieHeader.match(/owner_session=([^;]+)/);
      expect(cookieMatch).toBeTruthy();
      const token = cookieMatch![1];

      // 2. Access protected endpoint with cookie
      const bizRes = await app.request('/api/v1/business', {
        headers: {
          'Cookie': `owner_session=${token}`
        }
      });
      expect(bizRes.status).toBe(200);
      const bizJson = await bizRes.json() as any;
      expect(bizJson.success).toBe(true);

      // 3. Verify session endpoint
      const sessionRes = await app.request('/api/v1/auth/owner/session', {
        headers: {
          'Cookie': `owner_session=${token}`
        }
      });
      expect(sessionRes.status).toBe(200);
      const sessionJson = await sessionRes.json() as any;
      expect(sessionJson.data.principal_type).toBe('OWNER');
    });

    it('revokes the session and clears the cookie on POST /auth/owner/logout', async () => {
      process.env.NODE_ENV = 'production';

      // 1. Login
      const loginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: TEST_KEY })
      });
      const token = (loginRes.headers.get('set-cookie') || '').match(/owner_session=([^;]+)/)![1];

      // 2. Logout with cookie
      const logoutRes = await app.request('/api/v1/auth/owner/logout', {
        method: 'POST',
        headers: {
          'Cookie': `owner_session=${token}`
        }
      });
      expect(logoutRes.status).toBe(200);
      const clearCookie = logoutRes.headers.get('set-cookie') || '';
      expect(clearCookie).toContain('owner_session=');
      expect(clearCookie).toContain('Max-Age=0');

      // 3. Verify the revoked token can no longer access protected endpoints
      const checkRes = await app.request('/api/v1/business', {
        headers: {
          'Cookie': `owner_session=${token}`
        }
      });
      expect(checkRes.status).toBe(401);
    });
  });

  describe('3. CORS Credential & Origin Security (Requirement 7 & 15)', () => {
    it('sets Access-Control-Allow-Origin matching production Render host and credentials true (never wildcard)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://ai-marketing-organization.onrender.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(res.headers.get('access-control-allow-origin')).toBe('https://ai-marketing-organization.onrender.com');
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('supports explicitly configured FRONTEND_ORIGIN with credentials: true', async () => {
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_ORIGIN = 'https://my-marketing-admin.vercel.app';

      const res = await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://my-marketing-admin.vercel.app',
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(res.headers.get('access-control-allow-origin')).toBe('https://my-marketing-admin.vercel.app');
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('does not allow arbitrary unauthorized cross-origin requests', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FRONTEND_ORIGIN;

      const res = await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://malicious-site.example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      // Must not grant allow-origin to untrusted origins
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('4. Frontend API Client Contract (Requirement 1, 2, 5 & 14)', () => {
    it('includes credentials: "include" and does not inject x-organization-id or x-user-id', async () => {
      let capturedOptions: RequestInit | undefined;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
        capturedOptions = opts;
        return new Response(JSON.stringify({ success: true, data: { status: 'healthy' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      try {
        await fetchApi('/business');

        expect(capturedOptions).toBeDefined();
        // 1. Credentials must be 'include'
        expect(capturedOptions?.credentials).toBe('include');

        // 2. Identity headers must NOT be sent as authentication
        const headers = capturedOptions?.headers as Record<string, string>;
        expect(headers['x-organization-id']).toBeUndefined();
        expect(headers['x-user-id']).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('triggers unauthorized handler on 401 for protected endpoints', async () => {
      const originalFetch = globalThis.fetch;
      let unauthorizedTriggered = false;

      onUnauthorized(() => {
        unauthorizedTriggered = true;
      });

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ error: 'Unauthorized: In production...' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      try {
        await expect(fetchApi('/business')).rejects.toThrow(ApiError);
        expect(unauthorizedTriggered).toBe(true);
      } finally {
        onUnauthorized(null);
        globalThis.fetch = originalFetch;
      }
    });

    it('does not trigger unauthorized handler on 401 for public or auth-check endpoints', async () => {
      const originalFetch = globalThis.fetch;
      let unauthorizedTriggered = false;

      onUnauthorized(() => {
        unauthorizedTriggered = true;
      });

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ error: 'No active owner session found.' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      try {
        await expect(fetchApi('/auth/owner/session')).rejects.toThrow(ApiError);
        // Checking session should NOT trigger the unauthorized callback cascade
        expect(unauthorizedTriggered).toBe(false);
      } finally {
        onUnauthorized(null);
        globalThis.fetch = originalFetch;
      }
    });
  });
});
