import { randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/client.js';
import { isProduction, isPlaceholderCredential } from '../config/env.js';

export interface OwnerSessionInfo {
  token: string;
  principalType: 'OWNER';
  organizationId: string;
  userId: string;
  expiresAt: string;
}

export interface OwnerConfiguration {
  id: string;
  owner_name: string;
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

  public static readonly OWNER_ORGANIZATION_ID = 'org_owner_primary';
  public static readonly OWNER_USER_ID = 'usr_owner_primary';
  public static readonly PLATFORM_BUSINESS_ID = 'biz_platform_aro';
  public static readonly PLATFORM_RAZORPAY_PAYMENT_PAGE_URL = 'https://razorpay.me/@venkatasaiharshavardhankotu';

  private constructor() {
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
      const existing = db.prepare('SELECT id FROM owner_configuration WHERE id = ?').get('owner_primary');
      if (!existing) {
        db.prepare(`
          INSERT INTO owner_configuration (
            id, owner_name, organization_id, platform_business_id,
            platform_upi_vpa, platform_currency, platform_timezone,
            marketing_budget, autonomy_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(
          'owner_primary',
          'Harsha Vardhan Kotu',
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
    const secret = process.env.OWNER_API_KEY || process.env.AUTH_SECRET;
    if (secret && !isPlaceholderCredential(secret)) {
      return secret.trim();
    }
    if (!isProduction()) {
      return 'dev_owner_key_secret';
    }
    return '';
  }

  public isSecretConfigured(): boolean {
    const s = this.getExpectedSecret();
    return Boolean(s && !isPlaceholderCredential(s));
  }

  public verifyKey(candidateKey?: string): boolean {
    if (!candidateKey) return false;
    const expected = this.getExpectedSecret();
    if (!expected) return false;

    const candBuf = Buffer.from(candidateKey.trim());
    const expBuf = Buffer.from(expected.trim());

    if (candBuf.length !== expBuf.length) return false;
    try {
      return timingSafeEqual(candBuf, expBuf);
    } catch {
      return false;
    }
  }

  public createSession(ip?: string, userAgent?: string): OwnerSessionInfo {
    const db = getDb();
    const token = `sess_own_${randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO owner_sessions (
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

    return {
      token,
      principalType: 'OWNER',
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID,
      userId: OwnerAuthService.OWNER_USER_ID,
      expiresAt
    };
  }

  public validateToken(token?: string): OwnerSessionInfo | null {
    if (!token) return null;
    const trimmed = token.trim();

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

    // 2. Stateful session lookup
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

    return null;
  }

  public revokeSession(token: string): void {
    try {
      const db = getDb();
      db.prepare('DELETE FROM owner_sessions WHERE id = ?').run(token.trim());
    } catch {}
  }

  public getOwnerConfiguration(): OwnerConfiguration {
    this.ensureInitialized();
    const db = getDb();
    const row = db.prepare('SELECT * FROM owner_configuration WHERE id = ?').get('owner_primary') as any;
    if (row) return row;

    return {
      id: 'owner_primary',
      owner_name: 'Harsha Vardhan Kotu',
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
