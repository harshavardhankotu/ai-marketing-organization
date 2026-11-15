import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import app from '../../src/index.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { seedDatabase } from '../../src/db/seed.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';
import { loadLocalEnvFile, resolveAuthSecretFromEnv, resolveOwnerKeyFromEnv } from '../../src/config/env.js';
import {
  api,
  clearStoredOwnerSessionToken,
  getStoredOwnerSessionToken,
  fetchApi,
  onUnauthorized,
  ApiError
} from '../../../frontend/src/services/api.js';

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
          businessId: 'biz_test_live',
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

  describe('3. CORS Credential & Origin Security (Task 1 Requirements)', () => {
    it('accepts explicitly configured FRONTEND_ORIGIN with credentials: true', async () => {
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

    it('accepts exact known production Render frontend origin with credentials: true', async () => {
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

    it('rejects malicious origin containing legitimate hostname as substring (suffix attack)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://ai-marketing-organization.onrender.com.evil-attacker.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects malicious origin containing legitimate hostname as substring (prefix attack)', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://attacker-ai-marketing-organization.onrender.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects unknown origins in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.FRONTEND_ORIGIN;

      const res = await app.request('/api/v1/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://malicious-site.example.com',
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('preserves credentialed CORS on actual requests for legitimate frontend origin', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/health', {
        method: 'GET',
        headers: {
          'Origin': 'https://ai-marketing-organization.onrender.com'
        }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://ai-marketing-organization.onrender.com');
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
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

  describe('5. .env.admin_secret Auto-Loading, Derived AUTH_SECRET & Resilient Login', () => {
    it('loads .env.admin_secret automatically and resolves quoted OWNER_API_KEY/ADMIN_SECRET/OWNER_SECRET/ADMIN_API_KEY', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aro-admin-secret-'));
      const originalCwd = process.cwd();
      try {
        fs.writeFileSync(
          path.join(tmpDir, '.env.admin_secret'),
          'ADMIN_SECRET="  test_admin_secret_from_file_2026  "\n',
          'utf-8'
        );
        delete process.env.OWNER_API_KEY;
        delete process.env.ADMIN_SECRET;
        delete process.env.OWNER_SECRET;
        delete process.env.ADMIN_API_KEY;
        delete process.env.AUTH_SECRET;
        process.chdir(tmpDir);

        loadLocalEnvFile({ force: true });
        expect(process.env.ADMIN_SECRET).toBe('test_admin_secret_from_file_2026');
        expect(resolveOwnerKeyFromEnv(process.env)).toBe('test_admin_secret_from_file_2026');
        expect(OwnerAuthService.getInstance().verifyKey('test_admin_secret_from_file_2026')).toBe(true);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('deterministically derives AUTH_SECRET when AUTH_SECRET and OWNER_SESSION_SECRET are unset', () => {
      delete process.env.AUTH_SECRET;
      delete process.env.OWNER_SESSION_SECRET;
      process.env.OWNER_API_KEY = '  "owner_secret_quoted_2026"  ';

      const resolvedOwner = resolveOwnerKeyFromEnv(process.env);
      expect(resolvedOwner).toBe('owner_secret_quoted_2026');

      const expectedDerived = crypto
        .createHash('sha256')
        .update('aro_cookie_salt_' + 'owner_secret_quoted_2026')
        .digest('hex');

      expect(resolveAuthSecretFromEnv(process.env, resolvedOwner)).toBe(expectedDerived);
      expect(OwnerAuthService.getInstance().getCookieSigningSecret()).toBe(expectedDerived);
    });

    it('accepts key/secret/ownerApiKey/password/x-owner-api-key', async () => {
      delete process.env.OWNER_API_KEY;
      process.env.OWNER_SECRET = 'owner_secret_multi_field_2026';

      for (const payload of [
        { key: 'owner_secret_multi_field_2026' },
        { secret: 'owner_secret_multi_field_2026' },
        { ownerApiKey: 'owner_secret_multi_field_2026' },
        { password: 'owner_secret_multi_field_2026' }
      ]) {
        const res = await app.request('/api/v1/auth/owner/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        expect(res.status).toBe(200);
        const json = (await res.json()) as any;
        expect(json.success).toBe(true);
        expect(res.headers.get('set-cookie')).toContain('owner_session=');
      }

      const hdrRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-owner-api-key': 'owner_secret_multi_field_2026'
        },
        body: JSON.stringify({})
      });
      expect(hdrRes.status).toBe(200);
    });

    it('compares mismatched key lengths safely via SHA-256 timingSafeEqual without throwing RangeError', async () => {
      delete process.env.OWNER_API_KEY;
      process.env.OWNER_SECRET = 'owner_secret_multi_field_2026';

      const shortWrongRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'x' })
      });
      expect(shortWrongRes.status).toBe(401);

      const longWrongRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'x'.repeat(256) })
      });
      expect(longWrongRes.status).toBe(401);
    });

    it('still issues signed HttpOnly cookie and returns 200 even if owner_sessions DB write fails', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.OWNER_API_KEY;
      delete process.env.AUTH_SECRET;
      process.env.ADMIN_API_KEY = 'admin_api_key_resilient_2026';

      // Drop owner_sessions table to simulate DB persistence fault
      const db = getDb();
      db.exec('DROP TABLE IF EXISTS owner_sessions');

      const loginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerApiKey: 'admin_api_key_resilient_2026' })
      });

      expect(loginRes.status).toBe(200);
      const json = (await loginRes.json()) as any;
      expect(json.success).toBe(true);

      const cookieHeader = loginRes.headers.get('set-cookie') || '';
      expect(cookieHeader).toContain('owner_session=');
      expect(cookieHeader).toContain('HttpOnly');

      const token = cookieHeader.match(/owner_session=([^;]+)/)![1];
      const sessionRes = await app.request('/api/v1/auth/owner/session', {
        headers: { Cookie: `owner_session=${token}` }
      });
      expect(sessionRes.status).toBe(200);
    });
  });

  describe('6. AI Studio Preview Iframe Token Auth, Partitioned Cookies & 1-Click Auto-Session', () => {
    afterEach(() => {
      clearStoredOwnerSessionToken();
    });

    it('returns top-level sessionToken and sets SameSite=None; Secure; Partitioned on HTTPS iframe requests', async () => {
      process.env.NODE_ENV = 'production';

      const res = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-proto': 'https',
          'Origin': 'https://ais-dev-preview.asia-southeast1.run.app',
          'Sec-Fetch-Dest': 'iframe'
        },
        body: JSON.stringify({ apiKey: TEST_KEY })
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie') || '';
      expect(setCookie).toContain('SameSite=None');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('Partitioned');

      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.authenticated).toBe(true);
      expect(json.sessionToken).toMatch(/^sess_own_/);
      expect(json.token).toBe(json.sessionToken);
      expect(typeof json.expiresAt).toBe('string');
      // Still keeps json.data.token omitted in production
      expect(json.data.token).toBeUndefined();
    });

    it('authenticates /auth/owner/session and protected routes via x-owner-session or Bearer sessionToken when cookies are blocked', async () => {
      process.env.NODE_ENV = 'production';

      const loginRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://ais-dev-preview.asia-southeast1.run.app'
        },
        body: JSON.stringify({ apiKey: TEST_KEY })
      });
      const loginJson = (await loginRes.json()) as any;
      const sessionToken = loginJson.sessionToken;
      expect(sessionToken).toMatch(/^sess_own_/);

      // Simulate iframe dropping Cookie header: use x-owner-session header
      const sessionByHeaderRes = await app.request('/api/v1/auth/owner/session', {
        headers: { 'x-owner-session': sessionToken }
      });
      expect(sessionByHeaderRes.status).toBe(200);
      const sessionJson = (await sessionByHeaderRes.json()) as any;
      expect(sessionJson.authenticated).toBe(true);
      expect(sessionJson.data.principal_type).toBe('OWNER');

      // Protected route via x-owner-session header
      const bizByHeaderRes = await app.request('/api/v1/business', {
        headers: { 'x-owner-session': sessionToken }
      });
      expect(bizByHeaderRes.status).toBe(200);

      // Protected route via Authorization: Bearer <sessionToken>
      const bizByBearerRes = await app.request('/api/v1/business', {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      expect(bizByBearerRes.status).toBe(200);
    });

    it('rejects autoEnvLogin, empty key on POST /auth/owner/login, and GET /auth/owner/auto-session with 401 across all environments', async () => {
      // 1. Local dev empty/autoEnvLogin payload -> MUST fail closed with 401
      process.env.NODE_ENV = 'development';
      const devAutoRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoEnvLogin: true })
      });
      expect(devAutoRes.status).toBe(401);

      const emptyKeyRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: '' })
      });
      expect(emptyKeyRes.status).toBe(401);

      // 2. GET /auth/owner/auto-session even in AI Studio preview host -> MUST fail closed with 401
      const autoSessionRes = await app.request('/api/v1/auth/owner/auto-session', {
        headers: {
          'Origin': 'https://ais-dev-test.asia-southeast1.run.app'
        }
      });
      expect(autoSessionRes.status).toBe(401);

      // 3. Explicit wrong key STILL returns 401 even in development
      const wrongRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'explicit_wrong_key' })
      });
      expect(wrongRes.status).toBe(401);

      // 4. External production host without preview origin also rejects empty autoEnvLogin
      process.env.NODE_ENV = 'production';
      const extProdRes = await app.request('/api/v1/auth/owner/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Host': 'ai-marketing-organization.onrender.com',
          'Origin': 'https://ai-marketing-organization.onrender.com'
        },
        body: JSON.stringify({ autoEnvLogin: true })
      });
      expect(extProdRes.status).toBe(401);
    });

    it('stores sessionToken in frontend client on loginOwner and attaches Bearer + x-owner-session headers on subsequent API calls', async () => {
      const originalFetch = globalThis.fetch;
      const capturedCalls: Array<{ url: string; headers: Record<string, string> }> = [];

      globalThis.fetch = vi.fn().mockImplementation(async (url: any, opts: any) => {
        capturedCalls.push({
          url: String(url),
          headers: (opts?.headers || {}) as Record<string, string>
        });
        if (String(url).includes('/auth/owner/login')) {
          return new Response(JSON.stringify({
            success: true,
            authenticated: true,
            sessionToken: 'sess_own_mock_iframe_token_123',
            token: 'sess_own_mock_iframe_token_123',
            expiresAt: new Date(Date.now() + 86400000).toISOString()
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

      try {
        clearStoredOwnerSessionToken();
        expect(getStoredOwnerSessionToken()).toBeNull();

        await api.loginOwner(TEST_KEY);
        expect(getStoredOwnerSessionToken()).toBe('sess_own_mock_iframe_token_123');

        await api.getBusiness();
        const bizCall = capturedCalls.find(c => c.url.endsWith('/business'));
        expect(bizCall).toBeDefined();
        expect(bizCall!.headers['Authorization']).toBe('Bearer sess_own_mock_iframe_token_123');
        expect(bizCall!.headers['x-owner-session']).toBe('sess_own_mock_iframe_token_123');

        await api.logoutOwner();
        expect(getStoredOwnerSessionToken()).toBeNull();
      } finally {
        clearStoredOwnerSessionToken();
        globalThis.fetch = originalFetch;
      }
    });
  });
});
