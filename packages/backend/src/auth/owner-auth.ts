import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/client.js';
import {
  isProduction,
  isPlaceholderCredential,
  loadLocalEnvFile,
  normalizeSecretValue,
  resolveAuthSecretFromEnv,
  resolveOwnerKeyFromEnv
} from '../config/env.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface OwnerSessionInfo {
  token: string;
  principalType: 'OWNER';
  organizationId: string;
  userId: string;
  expiresAt: string;
}

export interface OwnerConfiguration {
  id: string;
  owner_name: string | null;
  organization_id: string;
  platform_business_id: string;
  platform_upi_vpa: string | null;
  platform_currency: string;
  platform_timezone: string;
  marketing_budget: number;
  autonomy_enabled: number;
  created_at: string;
  updated_at: string;
}

export class OwnerAuthService {
  private static instance: OwnerAuthService;
  private revokedTokens = new Set<string>();

  public static readonly OWNER_ORGANIZATION_ID = 'org_owner_primary';
  public static readonly OWNER_USER_ID = 'usr_owner_primary';
  public static readonly PLATFORM_BUSINESS_ID = 'biz_platform_aro';
  public static readonly PLATFORM_RAZORPAY_PAYMENT_PAGE_URL = 'https://razorpay.me/@venkatasaiharshavardhankotu';
  public static get PLATFORM_UPI_VPA(): string | null {
    const raw = normalizeSecretValue(process.env.DIRECT_UPI_VPA || process.env.PLATFORM_UPI_VPA);
    if (!raw || raw.toUpperCase() === 'UNSET') return null;
    return raw;
  }
  public static readonly PLATFORM_MERCHANT_NAME = 'SiteFix AI';
  public static get PLATFORM_QR_ASSET_PATH(): string {
    return process.env.DIRECT_UPI_QR_URL || '/images/razorpay-upi-qr.jpg';
  }

  /**
   * Identifies disallowed fixed-amount test payment links (e.g. legacy ₹100 paQqSni link).
   * Prevents using fixed ₹100 links for higher-value commercial invoices.
   */
  public static isDisallowedFixedPaymentLink(url?: string): boolean {
    if (!url) return false;
    const normalized = url.toLowerCase().trim();
    return (
      normalized.includes('paqqsni') ||
      normalized.includes('tow5k0qoixcq8g')
    );
  }

  private constructor() {
    loadLocalEnvFile();
    this.ensureInitialized();
  }

  public static getInstance(): OwnerAuthService {
    if (!OwnerAuthService.instance) {
      OwnerAuthService.instance = new OwnerAuthService();
    }
    return OwnerAuthService.instance;
  }

  private ensureInitialized(): void {
    try {
      const db = getDb();
      const existing = db.prepare('SELECT id, owner_name FROM owner_configuration WHERE id = ?').get('owner_primary') as any;
      if (existing && existing.owner_name === 'Harsha Vardhan Kotu') {
        db.prepare('UPDATE owner_configuration SET owner_name = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run(process.env.PUBLIC_AUTHOR_NAME || null, 'owner_primary');
      } else if (!existing) {
        db.prepare(`
          INSERT INTO owner_configuration (
            id, owner_name, organization_id, platform_business_id,
            platform_upi_vpa, platform_currency, platform_timezone,
            marketing_budget, autonomy_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(
          'owner_primary',
          process.env.PUBLIC_AUTHOR_NAME || null,
          OwnerAuthService.OWNER_ORGANIZATION_ID,
          OwnerAuthService.PLATFORM_BUSINESS_ID,
          process.env.PLATFORM_UPI_VPA || null,
          'INR',
          'Asia/Kolkata',
          0.0,
          1
        );
      }
    } catch {}
  }

  public getExpectedSecret(): string {
    loadLocalEnvFile();
    const secret = resolveOwnerKeyFromEnv(process.env);
    if (secret && !isPlaceholderCredential(secret)) {
      return secret;
    }
    if (!isProduction()) {
      return 'dev_owner_key_secret';
    }
    return '';
  }

  public getCookieSigningSecret(): string {
    return resolveAuthSecretFromEnv(process.env, this.getExpectedSecret());
  }

  public isSecretConfigured(): boolean {
    const s = this.getExpectedSecret();
    return Boolean(s && !isPlaceholderCredential(s));
  }

  public static isLocalOrAiStudioPreviewHost(value?: string): boolean {
    if (!value) return false;
    const raw = value.trim().toLowerCase();
    if (!raw) return false;
    let host = raw;
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        host = new URL(raw).hostname.toLowerCase();
      } else {
        host = raw.split('/')[0].split(':')[0];
      }
    } catch {}
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app');
  }

  public static isAiStudioOrLocalPreviewRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
    return !Boolean(env.VITEST) && env.NODE_ENV !== 'test' && env.RENDER !== 'true';
  }

  public canAutoLoginFromServerEnv(_reqMeta?: {
    origin?: string;
    referer?: string;
    host?: string;
    forwardedHost?: string;
  }): boolean {
    return OwnerAuthService.isAiStudioOrLocalPreviewRuntime();
  }

  public static extractTokenFromHeaders(
    getHeader: (name: string) => string | undefined
  ): string | undefined {
    const authHeader = getHeader('authorization') || getHeader('Authorization');
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (bearer) return bearer;
    }

    const ownerSessionHeader = getHeader('x-owner-session')?.trim();
    if (ownerSessionHeader) return ownerSessionHeader;

    const ownerApiKeyHeader = getHeader('x-owner-api-key')?.trim();
    if (ownerApiKeyHeader) return ownerApiKeyHeader;

    const apiKeyHeader = getHeader('x-api-key')?.trim();
    if (apiKeyHeader) return apiKeyHeader;

    const cookieHeader = getHeader('cookie') || '';
    const sessionCookie = cookieHeader
      .split(';')
      .map(s => s.trim())
      .find(s => s.startsWith('owner_session='));
    if (sessionCookie) {
      const rawVal = sessionCookie.slice('owner_session='.length).trim();
      if (rawVal) {
        try {
          return decodeURIComponent(rawVal);
        } catch {
          return rawVal;
        }
      }
    }

    return undefined;
  }

  public verifyKey(candidateKey?: string): boolean {
    const normalizedCandidate = normalizeSecretValue(candidateKey);
    if (!normalizedCandidate) return false;
    const expected = this.getExpectedSecret();
    if (!expected) return false;

    const candDigest = createHash('sha256').update(normalizedCandidate, 'utf8').digest();
    const expDigest = createHash('sha256').update(expected, 'utf8').digest();
    try {
      return timingSafeEqual(candDigest, expDigest);
    } catch {
      return false;
    }
  }

  private generateSignedSessionToken(expiresAtMs: number): string {
    const rawId = `sess_own_${randomUUID().replace(/-/g, '')}`;
    const payload = `${rawId}.${expiresAtMs}`;
    const sig = createHmac('sha256', this.getCookieSigningSecret()).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  private verifySignedSessionToken(token: string): OwnerSessionInfo | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [rawId, expStr, sig] = parts;
    if (!rawId.startsWith('sess_own_') || !expStr || !sig) return null;
    const expMs = Number(expStr);
    if (!Number.isFinite(expMs) || expMs <= Date.now()) return null;

    const payload = `${rawId}.${expStr}`;
    const expectedSig = createHmac('sha256', this.getCookieSigningSecret()).update(payload).digest('hex');
    const candDigest = createHash('sha256').update(sig, 'utf8').digest();
    const expDigest = createHash('sha256').update(expectedSig, 'utf8').digest();
    try {
      if (!timingSafeEqual(candDigest, expDigest)) return null;
    } catch {
      return null;
    }

    return {
      token,
      principalType: 'OWNER',
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      userId: OwnerAuthService.OWNER_USER_ID,
      expiresAt: new Date(expMs).toISOString()
    };
  }

  public createSession(ip?: string, userAgent?: string): OwnerSessionInfo {
    const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000;
    const token = this.generateSignedSessionToken(expiresAtMs);
    const expiresAt = new Date(expiresAtMs).toISOString();

    if (!isProduction() || process.env.VITEST) {
      try {
        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO owner_sessions (
            id, principal_type, organization_id, user_id, ip_address, user_agent, expires_at, created_at
          ) VALUES (?, 'OWNER', ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          token,
          OwnerAuthService.OWNER_ORGANIZATION_ID,
          OwnerAuthService.OWNER_USER_ID,
          ip || null,
          userAgent || null,
          expiresAt
        );
      } catch (err: any) {
        console.warn(`[OwnerAuth] SQLite session persistence skipped: ${err?.message || err}`);
      }
    }

    return {
      token,
      principalType: 'OWNER',
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      userId: OwnerAuthService.OWNER_USER_ID,
      expiresAt
    };
  }

  public async createSessionAsync(ip?: string, userAgent?: string): Promise<OwnerSessionInfo> {
    const expiresAtMs = Date.now() + 24 * 60 * 60 * 1000;
    const token = this.generateSignedSessionToken(expiresAtMs);
    const expiresAt = new Date(expiresAtMs).toISOString();
    const session: OwnerSessionInfo = {
      token,
      principalType: 'OWNER',
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      userId: OwnerAuthService.OWNER_USER_ID,
      expiresAt
    };

    if (isProduction() && !process.env.VITEST) {
      const repo = D1RevenueRepository.getInstance();
      try {
        await repo.executeWrite(
          'owner_sessions',
          `INSERT OR REPLACE INTO owner_sessions (id, principal_type, organization_id, user_id, ip_address, user_agent, expires_at, created_at) VALUES (?, 'OWNER', ?, ?, ?, ?, ?, datetime('now'))`,
          [session.token, session.organizationId, session.userId, ip || null, userAgent || null, session.expiresAt]
        );
      } catch (err: any) {
        if (repo.isRemoteD1WriteAllowed()) {
          throw new Error(`PERSISTENCE_FAULT: Failed to write session to D1: ${err?.message || err}`);
        }
        console.warn(`[OwnerAuth] Local session persistence fallback (signed cookie active): ${err?.message || err}`);
      }
      return session;
    }

    // Local / test mode uses SQLite (gracefully ignore DB faults since token is cryptographically signed)
    try {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO owner_sessions (
          id, principal_type, organization_id, user_id, ip_address, user_agent, expires_at, created_at
        ) VALUES (?, 'OWNER', ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        session.token,
        session.organizationId,
        session.userId,
        ip || null,
        userAgent || null,
        session.expiresAt
      );
    } catch (err: any) {
      console.warn(`[OwnerAuth] SQLite session persistence failed cleanly (issuing signed cookie session): ${err?.message || err}`);
    }

    return session;
  }

  public validateToken(token?: string): OwnerSessionInfo | null {
    if (!token) return null;
    const trimmed = token.trim();
    if (this.revokedTokens.has(trimmed)) return null;

    // 1. Direct API Key authentication
    if (this.verifyKey(trimmed)) {
      return {
        token: trimmed,
        principalType: 'OWNER',
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        userId: OwnerAuthService.OWNER_USER_ID,
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      };
    }

    // 2. Synchronous local/test session lookup
    if (!isProduction() || process.env.VITEST) {
      try {
        const db = getDb();
        const row = db.prepare(`
          SELECT * FROM owner_sessions
          WHERE id = ? AND expires_at > datetime('now')
        `).get(trimmed) as any;

        if (row) {
          return {
            token: row.id,
            principalType: 'OWNER',
            organizationId: row.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID,
            userId: row.user_id || OwnerAuthService.OWNER_USER_ID,
            expiresAt: row.expires_at
          };
        }
      } catch {}
    }

    // 3. Cryptographically signed stateless session cookie fallback
    return this.verifySignedSessionToken(trimmed);
  }

  public async validateTokenAsync(token?: string): Promise<OwnerSessionInfo | null> {
    if (!token) return null;
    const trimmed = token.trim();
    if (this.revokedTokens.has(trimmed)) return null;

    // 1. Direct API Key authentication (in-memory secret verification)
    if (this.verifyKey(trimmed)) {
      return {
        token: trimmed,
        principalType: 'OWNER',
        organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
        userId: OwnerAuthService.OWNER_USER_ID,
        expiresAt: new Date(Date.now() + 86400000).toISOString()
      };
    }

    // 2. In production, check D1 owner_sessions when configured, falling back to signed session token
    if (isProduction()) {
      try {
        const repo = D1RevenueRepository.getInstance();
        const row = await repo.queryOne(
          'owner_sessions',
          `SELECT * FROM owner_sessions WHERE id = ? AND expires_at > datetime('now')`,
          [trimmed]
        );
        if (row) {
          return {
            token: row.id,
            principalType: 'OWNER',
            organizationId: row.organization_id || OwnerAuthService.OWNER_ORGANIZATION_ID,
            userId: row.user_id || OwnerAuthService.OWNER_USER_ID,
            expiresAt: row.expires_at
          };
        }
      } catch (err: any) {
        console.warn(`[OwnerAuth] D1 session lookup failed cleanly (verifying signed cookie): ${err?.message || err}`);
      }
      return this.verifySignedSessionToken(trimmed);
    }

    // 3. Local/test runner uses SQLite + signed cookie verification
    return this.validateToken(token);
  }

  public revokeSession(token: string): void {
    const trimmed = token.trim();
    if (trimmed) {
      this.revokedTokens.add(trimmed);
    }
    if (!isProduction() || process.env.VITEST) {
      try {
        const db = getDb();
        db.prepare('DELETE FROM owner_sessions WHERE id = ?').run(trimmed);
      } catch {}
    }
  }

  public async revokeSessionAsync(token: string): Promise<void> {
    const trimmed = token.trim();
    if (trimmed) {
      this.revokedTokens.add(trimmed);
    }
    if (isProduction() && !process.env.VITEST) {
      try {
        await D1RevenueRepository.getInstance().executeWrite(
          'owner_sessions',
          `DELETE FROM owner_sessions WHERE id = ?`,
          [trimmed]
        );
      } catch (err: any) {
        console.warn(`[OwnerAuth] D1 revoke failed cleanly: ${err?.message || err}`);
      }
      return;
    }
    this.revokeSession(token);
  }

  public getOwnerConfiguration(): OwnerConfiguration {
    this.ensureInitialized();
    const db = getDb();
    const row = db.prepare('SELECT * FROM owner_configuration WHERE id = ?').get('owner_primary') as any;
    if (row) {
      if (row.owner_name === 'Harsha Vardhan Kotu') {
        row.owner_name = process.env.PUBLIC_AUTHOR_NAME || null;
      }
      return row;
    }

    return {
      id: 'owner_primary',
      owner_name: process.env.PUBLIC_AUTHOR_NAME || null,
      organization_id: OwnerAuthService.OWNER_ORGANIZATION_ID,
      platform_business_id: OwnerAuthService.PLATFORM_BUSINESS_ID,
      platform_upi_vpa: null,
      platform_currency: 'INR',
      platform_timezone: 'Asia/Kolkata',
      marketing_budget: 0.0,
      autonomy_enabled: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  public updateOwnerConfiguration(updates: Partial<OwnerConfiguration>): OwnerConfiguration {
    this.ensureInitialized();
    const db = getDb();
    const current = this.getOwnerConfiguration();

    const newName = updates.owner_name ?? current.owner_name;
    const newVpa = updates.platform_upi_vpa ?? current.platform_upi_vpa;
    const newBudget = updates.marketing_budget ?? current.marketing_budget;
    const newAutonomy = updates.autonomy_enabled ?? current.autonomy_enabled;

    db.prepare(`
      UPDATE owner_configuration
      SET owner_name = ?, platform_upi_vpa = ?, marketing_budget = ?, autonomy_enabled = ?, updated_at = datetime('now')
      WHERE id = 'owner_primary'
    `).run(newName, newVpa, newBudget, newAutonomy);

    return this.getOwnerConfiguration();
  }
}
