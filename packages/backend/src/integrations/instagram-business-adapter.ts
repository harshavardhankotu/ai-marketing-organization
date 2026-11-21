/**
 * Instagram Business API Adapter for @bestdeals0162
 *
 * Implements Meta's "Instagram API with Instagram Login" (post-2025 scopes):
 *   - instagram_business_basic
 *   - instagram_business_manage_messages
 *   - instagram_business_manage_comments
 *   - instagram_business_content_publish
 *
 * Features:
 *   1. OAuth 3-Step Token Exchange (Authorize -> Short Token -> 60-Day Long-Lived Token)
 *   2. 60-Day Auto-Refresher (>25 days old -> refresh_access_token)
 *   3. Deal Publisher (/media -> /media_publish) with #Ad + social_media_publishers_allowed guard
 *   4. Webhook + Polling Comment-to-DM & Inbound DM Dual-Rail Closer
 */

import crypto from 'crypto';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

export const INSTAGRAM_REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
  'instagram_business_content_publish'
] as const;

export const getInstagramGraphApiVersion = (): string =>
  (process.env.INSTAGRAM_GRAPH_API_VERSION || 'v22.0').trim();

export function isDirectImageUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false;
  try {
    const u = new URL(trimmed);
    if (u.pathname === '/deals' || u.pathname === '/deals/' || u.pathname.endsWith('/deals')) {
      return false;
    }
    if (/\.(jpe?g|png|webp|gif|avif)($|\?)/i.test(u.pathname)) return true;
    if (
      u.hostname.includes('cdn') ||
      u.hostname.includes('images') ||
      u.hostname.includes('cloudinary') ||
      u.hostname.includes('img') ||
      u.hostname.includes('media')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export const INSTAGRAM_TRIGGER_KEYWORDS_REGEX = /\b(DEAL|LINK|PRICE|BUY|AUDIT)\b/i;

export interface InstagramTokenState {
  accessToken: string;
  igUserId: string;
  handle: string;
  obtainedAt: string;
  refreshedAt: string;
  expiresAt: string;
  expiresInSeconds: number;
  scopes: string[];
  tokenSource: 'OAUTH_CALLBACK' | 'ENV' | 'REFRESH';
}

export interface InstagramStatusSummary {
  configured: boolean;
  status: 'READY_LIVE_TOKEN' | 'READY_OAUTH_CONNECT_URL' | 'NOT_CONFIGURED';
  handle: string;
  igUserIdPresent: boolean;
  appConfigured: boolean;
  hasLiveToken: boolean;
  scopes: string[];
  authorizeEndpoint: string;
  callbackUrl: string;
  webhookUrl: string;
  tokenObtainedAt: string | null;
  tokenRefreshedAt: string | null;
  tokenExpiresAt: string | null;
  tokenAgeDays: number | null;
  lastPublishedMediaId: string | null;
  lastPublishedAt: string | null;
  lastPollAt: string | null;
  repliesSentCount: number;
  missingEnv: string[];
}

export interface InstagramPublishDealInput {
  id: string;
  title: string;
  merchant?: string;
  currentPriceINR?: number | null;
  referencePriceINR?: number | null;
  verifiedDiscountPercent?: number | null;
  imageUrl?: string | null;
  canonicalSlug?: string | null;
  productVerified?: boolean;
  socialMediaPublishersAllowed?: boolean;
  evidence?: Record<string, any> | null;
}

export interface InstagramAdapterOptions {
  fetchFn?: typeof fetch;
}

const WORKFLOW_STATE_ID = 'wf_instagram_token_state';

export class InstagramBusinessAdapter {
  private static instance: InstagramBusinessAdapter | null = null;
  private fetchFn: typeof fetch;
  private tokenState: InstagramTokenState | null = null;
  private stateLoadedFromDb = false;
  private repliedItemIds = new Set<string>();
  private stateRedirectUriMap = new Map<string, string>();
  private lastPublishedMediaId: string | null = null;
  private lastPublishedAt: string | null = null;
  private lastPollAt: string | null = null;
  private repliesSentCount = 0;

  constructor(options?: InstagramAdapterOptions) {
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  public static getInstance(options?: InstagramAdapterOptions): InstagramBusinessAdapter {
    if (!InstagramBusinessAdapter.instance || options?.fetchFn) {
      InstagramBusinessAdapter.instance = new InstagramBusinessAdapter(options);
    }
    return InstagramBusinessAdapter.instance;
  }

  public static resetInstance(): void {
    InstagramBusinessAdapter.instance = null;
  }

  public static resolveOAuthSecret(explicitSecret?: string): string {
    const isProd = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
    const candidate = (
      explicitSecret ||
      process.env.INSTAGRAM_APP_SECRET ||
      process.env.AUTH_SECRET ||
      process.env.OWNER_API_KEY ||
      ''
    ).trim();

    if (isProd) {
      if (!candidate || candidate.length < 16 || candidate === 'ig_oauth_secret') {
        throw new Error('INSTAGRAM_OAUTH_NOT_CONFIGURED: INSTAGRAM_APP_SECRET or AUTH_SECRET (minimum 16 characters) is required in production.');
      }
      return candidate;
    }

    return candidate || 'ig_oauth_secret';
  }

  public static generateSignedState(authSecret?: string): string {
    const secret = InstagramBusinessAdapter.resolveOAuthSecret(authSecret);
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(8).toString('hex');
    const hmac = crypto.createHmac('sha256', secret).update(`${timestamp}.${nonce}`).digest('hex');
    return `${timestamp}.${nonce}.${hmac}`;
  }

  public static verifySignedState(state?: string, authSecret?: string): { valid: boolean; error?: string } {
    if (!state || typeof state !== 'string') {
      return { valid: false, error: 'MISSING_STATE' };
    }
    const parts = state.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'MALFORMED_STATE' };
    }
    const [timestampStr, nonce, receivedHmac] = parts;
    const timestamp = Number(timestampStr);
    if (!timestamp || isNaN(timestamp)) {
      return { valid: false, error: 'INVALID_STATE_TIMESTAMP' };
    }
    // Expire if older than 15 minutes or from the future
    if (Date.now() - timestamp > 15 * 60 * 1000 || timestamp > Date.now() + 60000) {
      return { valid: false, error: 'EXPIRED_STATE' };
    }

    let secret: string;
    try {
      secret = InstagramBusinessAdapter.resolveOAuthSecret(authSecret);
    } catch {
      return { valid: false, error: 'INSTAGRAM_OAUTH_NOT_CONFIGURED' };
    }

    const expectedHmac = crypto.createHmac('sha256', secret).update(`${timestampStr}.${nonce}`).digest('hex');
    const bufReceived = Buffer.from(receivedHmac, 'hex');
    const bufExpected = Buffer.from(expectedHmac, 'hex');
    if (bufReceived.length !== bufExpected.length || !crypto.timingSafeEqual(bufReceived, bufExpected)) {
      return { valid: false, error: 'TAMPERED_STATE' };
    }
    return { valid: true };
  }

  public generateSignedState(authSecret?: string): string {
    return InstagramBusinessAdapter.generateSignedState(authSecret);
  }

  public verifySignedState(state?: string, authSecret?: string): { valid: boolean; error?: string } {
    return InstagramBusinessAdapter.verifySignedState(state, authSecret);
  }

  /**
   * Atomically claims an Instagram comment or DM reply before dispatching to Meta.
   * Uses deterministic primary key `ig_reply_claim_${sha256Hex(itemType:itemId).slice(0, 40)}` in durable_events.
   * Returns true if claim was successfully acquired.
   * Returns false if item was already claimed or replied.
   * Fails closed (throws) if D1 storage fails to prevent duplicate dispatches.
   */
  public async claimInstagramReplyAtomically(itemType: 'comment' | 'dm', itemId: string): Promise<boolean> {
    const itemKey = `${itemType}:${itemId}`;
    if (this.repliedItemIds.has(itemKey)) return false;

    const deterministicId = `ig_reply_claim_${crypto.createHash('sha256').update(itemKey).digest('hex').slice(0, 40)}`;
    const { D1RevenueRepository } = await import('../db/d1-revenue-repository.js');
    const { OwnerAuthService } = await import('../auth/owner-auth.js');

    const sql = `INSERT INTO durable_events (id, event_type, organization_id, business_id, payload_json, created_at) VALUES (?, 'IG_REPLY_CLAIMED', ?, ?, ?, datetime('now'))`;
    const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID || 'org_owner_primary';
    const payloadJson = JSON.stringify({
      claimedAt: new Date().toISOString(),
      itemType,
      itemId
    });

    try {
      await D1RevenueRepository.getInstance().executeWrite('durable_events', sql, [
        deterministicId,
        orgId,
        itemKey,
        payloadJson
      ]);
      this.repliedItemIds.add(itemKey);
      return true;
    } catch (err: any) {
      const errLower = (err?.message || '').toLowerCase();
      const isDuplicate =
        errLower.includes('unique') ||
        errLower.includes('constraint') ||
        errLower.includes('primary key') ||
        errLower.includes('already exists');

      if (isDuplicate) {
        this.repliedItemIds.add(itemKey);
        return false;
      }

      console.warn(`[InstagramAdapter] claimInstagramReplyAtomically failed for ${itemKey} (${err.message}). Failing closed.`);
      throw new Error(`IG_REPLY_CLAIM_FAILED: Cannot claim reply lock for '${itemKey}': ${err.message}`);
    }
  }

  /**
   * Releases an atomic reply claim when outbound Graph API delivery fails
   * so transient network/API errors can be retried cleanly.
   */
  public async releaseInstagramReplyClaim(itemType: 'comment' | 'dm', itemId: string): Promise<void> {
    const itemKey = `${itemType}:${itemId}`;
    this.repliedItemIds.delete(itemKey);
    const deterministicId = `ig_reply_claim_${crypto.createHash('sha256').update(itemKey).digest('hex').slice(0, 40)}`;
    const sql = `DELETE FROM durable_events WHERE id = ? AND event_type = 'IG_REPLY_CLAIMED'`;
    try {
      if (isProduction() && !process.env.VITEST) {
        const { D1RevenueRepository } = await import('../db/d1-revenue-repository.js');
        await D1RevenueRepository.getInstance().executeWrite('durable_events', sql, [deterministicId]);
      } else {
        const { getDb } = await import('../db/client.js');
        getDb().prepare(sql).run(deterministicId);
      }
    } catch {}
  }

  public async isItemReplied(itemKey: string): Promise<boolean> {
    if (this.repliedItemIds.has(itemKey)) return true;
    try {
      const row = await D1RevenueRepository.getInstance().queryOne<{ id: string }>(
        'durable_events',
        `SELECT id FROM durable_events WHERE event_type IN ('IG_REPLY_SENT', 'IG_REPLY_CLAIMED') AND business_id = ? LIMIT 1`,
        [itemKey]
      );
      if (row?.id) {
        this.repliedItemIds.add(itemKey);
        return true;
      }
      return false;
    } catch (err: any) {
      console.warn(`[InstagramAdapter] isItemReplied failed for ${itemKey} (${err.message}). Failing closed to prevent duplicate dispatch.`);
      throw new Error(`IG_REPLY_CHECK_FAILED: Cannot verify reply status for '${itemKey}': ${err.message}`);
    }
  }

  public async markItemReplied(itemKey: string): Promise<void> {
    this.repliedItemIds.add(itemKey);
    const { DurableEventBus } = await import('../revenue/durable-event-bus.js');
    const { OwnerAuthService } = await import('../auth/owner-auth.js');
    await DurableEventBus.emitAsync({
      eventType: 'IG_REPLY_SENT',
      organizationId: OwnerAuthService.OWNER_ORGANIZATION_ID || 'org_owner_primary',
      businessId: itemKey,
      payload: {
        ig_item_id: itemKey,
        repliedAt: new Date().toISOString()
      }
    });
  }

  public getHandle(): string {
    const raw = (process.env.INSTAGRAM_HANDLE || 'bestdeals0162').trim().replace(/^@+/, '');
    return raw || 'bestdeals0162';
  }

  public getSiteUrl(): string {
    return (
      process.env.PUBLIC_SITE_URL ||
      process.env.APP_URL ||
      'https://ai-marketing-organization.onrender.com'
    )
      .trim()
      .replace(/\/$/, '');
  }

  public resolveCallbackUrl(candidateRedirectUri?: string): string {
    const fallback = `${this.getSiteUrl()}/api/v1/integrations/instagram/oauth/callback`;
    const raw = String(candidateRedirectUri || '').trim();
    if (!raw) return fallback;
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      const siteHost = new URL(this.getSiteUrl()).hostname.toLowerCase();
      const isAllowedHost =
        host === siteHost ||
        host.endsWith('.run.app') ||
        host.endsWith('.onrender.com') ||
        host === 'localhost' ||
        host === '127.0.0.1';
      if (
        isAllowedHost &&
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        (parsed.pathname === '/api/v1/integrations/instagram/oauth/callback' ||
          parsed.pathname === '/api/v1/integrations/instagram/oauth/callback/')
      ) {
        return `${parsed.origin}/api/v1/integrations/instagram/oauth/callback`;
      }
    } catch {
      // Ignore malformed candidate redirect URI and fall back cleanly
    }
    return fallback;
  }

  public getCallbackUrl(): string {
    return this.resolveCallbackUrl();
  }

  public getWebhookUrl(): string {
    return `${this.getSiteUrl()}/api/v1/webhooks/instagram`;
  }

  private getAppId(): string {
    return (process.env.INSTAGRAM_APP_ID || '').trim();
  }

  private getAppSecret(): string {
    return (process.env.INSTAGRAM_APP_SECRET || '').trim();
  }

  private getEnvAccessToken(): string {
    return (process.env.INSTAGRAM_ACCESS_TOKEN || '').trim();
  }

  private getEnvUserId(): string {
    return (process.env.INSTAGRAM_USER_ID || '').trim();
  }

  private getWebhookVerifyToken(): string {
    return (process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.WEBHOOK_VERIFY_TOKEN || '').trim();
  }

  private redactSecret(text: string): string {
    if (!text) return '';
    let safe = text;
    const secrets = [
      this.getAppSecret(),
      this.getEnvAccessToken(),
      this.tokenState?.accessToken || '',
      this.getWebhookVerifyToken()
    ].filter(s => s && s.length > 4);
    for (const s of secrets) {
      safe = safe.split(s).join('[REDACTED]');
    }
    return safe
      .replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]')
      .replace(/client_secret=[^&\s"']+/gi, 'client_secret=[REDACTED]')
      .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
  }

  private async ensureStateLoaded(): Promise<void> {
    if (this.stateLoadedFromDb && this.tokenState) return;
    this.stateLoadedFromDb = true;

    try {
      const repo = D1RevenueRepository.getInstance();
      let row: any = null;
      const sql = `SELECT outputs_json, updated_at FROM workflows WHERE id = ? LIMIT 1`;
      if (isProduction() && !process.env.VITEST) {
        row = await repo.queryOne<any>('workflows', sql, [WORKFLOW_STATE_ID]);
      } else {
        const { getDb } = await import('../db/client.js');
        row = getDb().prepare(sql).get(WORKFLOW_STATE_ID) as any;
      }
      if (row?.outputs_json) {
        const parsed = JSON.parse(row.outputs_json);
        if (parsed?.accessToken) {
          this.tokenState = {
            accessToken: String(parsed.accessToken),
            igUserId: String(parsed.igUserId || this.getEnvUserId() || ''),
            handle: String(parsed.handle || this.getHandle()),
            obtainedAt: String(parsed.obtainedAt || row.updated_at || new Date().toISOString()),
            refreshedAt: String(parsed.refreshedAt || parsed.obtainedAt || row.updated_at || new Date().toISOString()),
            expiresAt: String(parsed.expiresAt || new Date(Date.now() + 60 * 86400000).toISOString()),
            expiresInSeconds: Number(parsed.expiresInSeconds || 5184000),
            scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [...INSTAGRAM_REQUIRED_SCOPES],
            tokenSource: parsed.tokenSource || 'OAUTH_CALLBACK'
          };
          if (parsed.lastPublishedMediaId) this.lastPublishedMediaId = String(parsed.lastPublishedMediaId);
          if (parsed.lastPublishedAt) this.lastPublishedAt = String(parsed.lastPublishedAt);
          if (parsed.lastPollAt) this.lastPollAt = String(parsed.lastPollAt);
          if (typeof parsed.repliesSentCount === 'number') this.repliesSentCount = parsed.repliesSentCount;
        }
      }
    } catch {
      // Non-fatal in test/boot environments before DB schema hydration
    }

    // Fallback to environment token if DB has none yet (persist in non-test runtime so 25-day age survives restarts)
    if (!this.tokenState && this.getEnvAccessToken()) {
      const nowIso = new Date().toISOString();
      this.tokenState = {
        accessToken: this.getEnvAccessToken(),
        igUserId: this.getEnvUserId(),
        handle: this.getHandle(),
        obtainedAt: nowIso,
        refreshedAt: nowIso,
        expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(),
        expiresInSeconds: 5184000,
        scopes: [...INSTAGRAM_REQUIRED_SCOPES],
        tokenSource: 'ENV'
      };
      if (!process.env.VITEST) {
        await this.persistState();
      }
    }
  }

  private async persistState(): Promise<void> {
    if (!this.tokenState) return;
    try {
      const repo = D1RevenueRepository.getInstance();
      const payload = {
        ...this.tokenState,
        lastPublishedMediaId: this.lastPublishedMediaId,
        lastPublishedAt: this.lastPublishedAt,
        lastPollAt: this.lastPollAt,
        repliesSentCount: this.repliesSentCount
      };
      const sql = `
        INSERT INTO workflows (
          id, organization_id, business_id, campaign_id, workflow_type,
          status, current_step, inputs_json, outputs_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          outputs_json = excluded.outputs_json,
          updated_at = datetime('now')
      `;
      const params = [
        WORKFLOW_STATE_ID,
        'org_owner_primary',
        'biz_platform_aro',
        `ig_${this.getHandle()}`,
        'INSTAGRAM_OAUTH_TOKEN',
        'COMPLETED',
        'TOKEN_ACTIVE',
        JSON.stringify({ handle: this.getHandle(), callbackUrl: this.getCallbackUrl() }),
        JSON.stringify(payload)
      ];
      if (isProduction() && !process.env.VITEST) {
        await repo.executeWrite('workflows', sql, params);
      } else {
        const { getDb } = await import('../db/client.js');
        getDb().prepare(sql).run(...params);
      }
    } catch {
      // Safe fallback when workflows table is absent in isolated unit tests
    }
  }

  private resolveActiveCredentials(): { accessToken: string; igUserId: string; tokenState: InstagramTokenState | null } {
    const envToken = this.getEnvAccessToken();
    const envUserId = this.getEnvUserId();
    const accessToken = this.tokenState?.accessToken || envToken;
    const igUserId = this.tokenState?.igUserId || envUserId;
    return { accessToken, igUserId, tokenState: this.tokenState };
  }

  public async getStatusSummary(): Promise<InstagramStatusSummary> {
    await this.ensureStateLoaded();
    const appId = this.getAppId();
    const appSecret = this.getAppSecret();
    const appConfigured = Boolean(appId && appSecret);
    const { accessToken, igUserId, tokenState } = this.resolveActiveCredentials();
    const hasLiveToken = Boolean(accessToken);

    let status: InstagramStatusSummary['status'] = 'NOT_CONFIGURED';
    if (hasLiveToken) {
      status = 'READY_LIVE_TOKEN';
    } else if (appConfigured) {
      status = 'READY_OAUTH_CONNECT_URL';
    }

    const missingEnv: string[] = [];
    if (!appId) missingEnv.push('INSTAGRAM_APP_ID');
    if (!appSecret) missingEnv.push('INSTAGRAM_APP_SECRET');
    if (!hasLiveToken) missingEnv.push('INSTAGRAM_ACCESS_TOKEN');
    if (!igUserId) missingEnv.push('INSTAGRAM_USER_ID');

    let tokenAgeDays: number | null = null;
    if (tokenState?.refreshedAt) {
      const ms = Date.parse(tokenState.refreshedAt);
      if (Number.isFinite(ms)) {
        tokenAgeDays = Math.max(0, Number(((Date.now() - ms) / 86400000).toFixed(1)));
      }
    }

    return {
      configured: hasLiveToken || appConfigured,
      status,
      handle: `@${this.getHandle()}`,
      igUserIdPresent: Boolean(igUserId),
      appConfigured,
      hasLiveToken,
      scopes: [...INSTAGRAM_REQUIRED_SCOPES],
      authorizeEndpoint: '/api/v1/integrations/instagram/oauth/authorize',
      callbackUrl: this.getCallbackUrl(),
      webhookUrl: this.getWebhookUrl(),
      tokenObtainedAt: tokenState?.obtainedAt || null,
      tokenRefreshedAt: tokenState?.refreshedAt || null,
      tokenExpiresAt: tokenState?.expiresAt || null,
      tokenAgeDays,
      lastPublishedMediaId: this.lastPublishedMediaId,
      lastPublishedAt: this.lastPublishedAt,
      lastPollAt: this.lastPollAt,
      repliesSentCount: this.repliesSentCount,
      missingEnv
    };
  }

  /**
   * Builds the Meta Instagram Login authorize URL using the 4 required post-2025 scopes.
   */
  public getAuthorizeUrl(
    state?: string,
    redirectUriOverride?: string
  ): {
    configured: boolean;
    authorizeUrl: string | null;
    callbackUrl: string;
    scopes: string[];
    missingEnv: string[];
  } {
    const appId = this.getAppId();
    const callbackUrl = this.resolveCallbackUrl(redirectUriOverride);
    const missingEnv: string[] = [];
    if (!appId) missingEnv.push('INSTAGRAM_APP_ID');
    if (!appId) {
      return {
        configured: false,
        authorizeUrl: null,
        callbackUrl,
        scopes: [...INSTAGRAM_REQUIRED_SCOPES],
        missingEnv
      };
    }

    const url = new URL('https://www.instagram.com/oauth/authorize');
    url.searchParams.set('enable_fb_login', '0');
    url.searchParams.set('force_authentication', '1');
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', INSTAGRAM_REQUIRED_SCOPES.join(','));
    const effectiveState = state || this.generateSignedState();
    url.searchParams.set('state', effectiveState);
    if (this.stateRedirectUriMap.size >= 100) {
      const oldestKey = this.stateRedirectUriMap.keys().next().value;
      if (oldestKey) this.stateRedirectUriMap.delete(oldestKey);
    }
    this.stateRedirectUriMap.set(effectiveState, callbackUrl);

    return {
      configured: true,
      authorizeUrl: url.toString(),
      callbackUrl,
      scopes: [...INSTAGRAM_REQUIRED_SCOPES],
      missingEnv: []
    };
  }

  /**
   * Handles Meta OAuth redirect callback:
   *  - Handles ?error=access_denied safely
   *  - Strips trailing #_ from `code`
   *  - Step 1: POST https://api.instagram.com/oauth/access_token
   *  - Step 2: GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token (60-day token)
   */
  public async handleOAuthCallback(
    query: {
      code?: string;
      error?: string;
      error_reason?: string;
      error_description?: string;
      state?: string;
    },
    fetchOverride?: typeof fetch,
    redirectUriOverride?: string
  ): Promise<{
    ok: boolean;
    handle: string;
    igUserId?: string;
    expiresAt?: string;
    error?: string;
    errorDescription?: string;
  }> {
    if (query.error || query.error_reason) {
      return {
        ok: false,
        handle: `@${this.getHandle()}`,
        error: String(query.error || query.error_reason || 'access_denied'),
        errorDescription: String(query.error_description || 'Instagram authorization was declined or cancelled.')
      };
    }

    const rawCode = String(query.code || '').trim().replace(/#_$/, '').trim();
    if (!rawCode) {
      return {
        ok: false,
        handle: `@${this.getHandle()}`,
        error: 'MISSING_AUTH_CODE',
        errorDescription: 'Missing authorization code parameter from Instagram OAuth callback.'
      };
    }

    const appId = this.getAppId();
    const appSecret = this.getAppSecret();
    if (!appId || !appSecret) {
      return {
        ok: false,
        handle: `@${this.getHandle()}`,
        error: 'INSTAGRAM_APP_UNCONFIGURED',
        errorDescription: 'INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET must be configured before token exchange.'
      };
    }

    const stateKey = String(query.state || '').trim();
    const rememberedRedirectUri = stateKey ? this.stateRedirectUriMap.get(stateKey) : undefined;
    if (stateKey) this.stateRedirectUriMap.delete(stateKey);
    const effectiveRedirectUri = this.resolveCallbackUrl(redirectUriOverride || rememberedRedirectUri);

    const fn = fetchOverride ?? this.fetchFn;

    try {
      // Step 1: Exchange code -> short-lived token
      const formBody = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: effectiveRedirectUri,
        code: rawCode
      });

      const shortRes = await fn('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
        body: formBody.toString()
      });

      const shortJson: any = await shortRes.json().catch(() => ({}));
      if (!shortRes.ok || !shortJson?.access_token) {
        const msg = this.redactSecret(shortJson?.error_message || shortJson?.error?.message || `HTTP ${shortRes.status}`);
        return {
          ok: false,
          handle: `@${this.getHandle()}`,
          error: 'SHORT_TOKEN_EXCHANGE_FAILED',
          errorDescription: msg
        };
      }

      const shortToken = String(shortJson.access_token);
      let igUserId = String(shortJson.user_id || this.getEnvUserId() || '').trim();

      // Step 2: Upgrade short-lived token -> 60-day long-lived token
      const upgradeUrl = new URL('https://graph.instagram.com/access_token');
      upgradeUrl.searchParams.set('grant_type', 'ig_exchange_token');
      upgradeUrl.searchParams.set('client_secret', appSecret);
      upgradeUrl.searchParams.set('access_token', shortToken);

      const longRes = await fn(upgradeUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      const longJson: any = await longRes.json().catch(() => ({}));
      if (!longRes.ok || !longJson?.access_token) {
        const msg = this.redactSecret(longJson?.error?.message || `HTTP ${longRes.status}`);
        return {
          ok: false,
          handle: `@${this.getHandle()}`,
          error: 'LONG_LIVED_TOKEN_EXCHANGE_FAILED',
          errorDescription: msg
        };
      }

      const longToken = String(longJson.access_token);
      const expiresIn = Math.max(3600, Number(longJson.expires_in || 5184000));

      // Step 3: Optionally resolve handle / user_id from /me if missing
      let resolvedHandle = this.getHandle();
      try {
        const meUrl = `https://graph.instagram.com/${getInstagramGraphApiVersion()}/me?fields=id,username&access_token=${encodeURIComponent(longToken)}`;
        const meRes = await fn(meUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (meRes.ok) {
          const meJson: any = await meRes.json().catch(() => ({}));
          if (!igUserId && meJson?.id) igUserId = String(meJson.id);
          if (meJson?.username) resolvedHandle = String(meJson.username).replace(/^@+/, '');
        }
      } catch {
        // Optional profile lookup
      }

      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
      this.tokenState = {
        accessToken: longToken,
        igUserId,
        handle: resolvedHandle,
        obtainedAt: nowIso,
        refreshedAt: nowIso,
        expiresAt,
        expiresInSeconds: expiresIn,
        scopes: [...INSTAGRAM_REQUIRED_SCOPES],
        tokenSource: 'OAUTH_CALLBACK'
      };
      this.stateLoadedFromDb = true;
      await this.persistState();

      return {
        ok: true,
        handle: `@${resolvedHandle}`,
        igUserId,
        expiresAt
      };
    } catch (err: any) {
      return {
        ok: false,
        handle: `@${this.getHandle()}`,
        error: 'OAUTH_CALLBACK_EXCEPTION',
        errorDescription: this.redactSecret(err?.message || 'Unexpected error during Instagram OAuth callback')
      };
    }
  }

  /**
   * Auto-refreshes a 60-day Instagram long-lived token if it is older than 25 days.
   * Called automatically inside AutonomousSystemDoctor.runSelfHealingPass().
   */
  public async refreshLongLivedTokenIfNeeded(
    fetchOverride?: typeof fetch,
    forceIfAgeDaysGt: number = 25
  ): Promise<{
    refreshed: boolean;
    reason: string;
    ageDays?: number;
    expiresAt?: string;
  }> {
    await this.ensureStateLoaded();
    const { accessToken, igUserId, tokenState } = this.resolveActiveCredentials();
    if (!accessToken) {
      return { refreshed: false, reason: 'NO_TOKEN' };
    }

    const baseDateMs = Date.parse(tokenState?.refreshedAt || tokenState?.obtainedAt || new Date().toISOString());
    const ageDays = Number.isFinite(baseDateMs) ? (Date.now() - baseDateMs) / 86400000 : 0;

    if (ageDays <= forceIfAgeDaysGt) {
      return {
        refreshed: false,
        reason: 'TOKEN_FRESH',
        ageDays: Number(ageDays.toFixed(1)),
        expiresAt: tokenState?.expiresAt
      };
    }

    const fn = fetchOverride ?? this.fetchFn;
    try {
      const url = new URL('https://graph.instagram.com/refresh_access_token');
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', accessToken);

      const res = await fn(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data?.access_token) {
        return {
          refreshed: false,
          reason: `REFRESH_FAILED: ${this.redactSecret(data?.error?.message || `HTTP_${res.status}`)}`,
          ageDays: Number(ageDays.toFixed(1))
        };
      }

      const expiresIn = Math.max(3600, Number(data.expires_in || 5184000));
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      this.tokenState = {
        accessToken: String(data.access_token),
        igUserId: igUserId || tokenState?.igUserId || '',
        handle: tokenState?.handle || this.getHandle(),
        obtainedAt: tokenState?.obtainedAt || nowIso,
        refreshedAt: nowIso,
        expiresAt,
        expiresInSeconds: expiresIn,
        scopes: tokenState?.scopes || [...INSTAGRAM_REQUIRED_SCOPES],
        tokenSource: 'REFRESH'
      };
      await this.persistState();

      return {
        refreshed: true,
        reason: 'REFRESHED_LONG_LIVED_TOKEN',
        ageDays: 0,
        expiresAt
      };
    } catch (err: any) {
      return {
        refreshed: false,
        reason: `REFRESH_ERROR: ${this.redactSecret(err?.message || 'unknown')}`,
        ageDays: Number(ageDays.toFixed(1))
      };
    }
  }

  /**
   * Formats a compliant Instagram caption with #Ad, verified INR price, and Comment "DEAL" hook.
   */
  public buildDealCaption(deal: InstagramPublishDealInput): string {
    const price = Math.round(Number(deal.currentPriceINR || 0));
    const mrp = Math.round(Number(deal.referencePriceINR || 0));
    const merchant = String(deal.merchant || 'Verified Store').trim();
    const handle = this.getHandle();
    const discountStr =
      mrp > price && price > 0
        ? ` (${Math.round(((mrp - price) / mrp) * 100)}% off MRP ₹${mrp.toLocaleString('en-IN')})`
        : deal.verifiedDiscountPercent && Number(deal.verifiedDiscountPercent) > 0
          ? ` (${Math.round(Number(deal.verifiedDiscountPercent))}% off)`
          : '';

    return [
      `#Ad Verified Fair-Price Drop: ${deal.title}`,
      `Live Observed Price: ₹${price.toLocaleString('en-IN')}${discountStr} on ${merchant}`,
      `Comment "DEAL" below or DM us "DEAL" for the instant direct Store + Amazon.in check link.`,
      `Follow @${handle} • Bio link: ${this.getSiteUrl()}/ig`,
      `#IndiaDeals #FairPriceCheck #PriceDrop #BestDealsIndia`
    ].join('\n\n');
  }

  /**
   * Publishes an eligible verified deal to @bestdeals0162 using Instagram Graph API v21.0
   * (/media creation -> /media_publish).
   * Strictly rejects deals with social_media_publishers_allowed === false or unverified price.
   */
  public async publishDealToInstagram(
    deal: InstagramPublishDealInput,
    options?: { imageUrl?: string; captionOverride?: string; fetchFn?: typeof fetch }
  ): Promise<{
    ok: boolean;
    blocked?: boolean;
    reason?: string;
    creationId?: string;
    mediaId?: string;
    caption?: string;
    handle: string;
  }> {
    const handle = `@${this.getHandle()}`;
    const socialAllowedFlag =
      deal.socialMediaPublishersAllowed !== false &&
      deal.evidence?.socialMediaPublishersAllowed !== false &&
      deal.evidence?.social_media_publishers_allowed !== false;

    if (!socialAllowedFlag) {
      return {
        ok: false,
        blocked: true,
        reason: 'SOCIAL_MEDIA_PUBLISHER_NOT_ALLOWED',
        handle
      };
    }

    const price = Number(deal.currentPriceINR || 0);
    if (!Number.isFinite(price) || price <= 0 || deal.productVerified !== true) {
      return {
        ok: false,
        blocked: true,
        reason: 'UNVERIFIED_PRICE_OR_PRODUCT',
        handle
      };
    }

    const caption = (options?.captionOverride || this.buildDealCaption(deal)).trim();
    const imageUrl = (options?.imageUrl || deal.imageUrl || '').trim();
    if (!imageUrl || !isDirectImageUrl(imageUrl)) {
      return {
        ok: false,
        blocked: true,
        reason: 'INVALID_OR_NON_DIRECT_IMAGE_URL',
        handle
      };
    }

    await this.ensureStateLoaded();
    const { accessToken, igUserId } = this.resolveActiveCredentials();
    if (!accessToken || !igUserId) {
      return {
        ok: false,
        reason: 'MISSING_INSTAGRAM_TOKEN_OR_USER_ID',
        handle
      };
    }

    const fn = options?.fetchFn ?? this.fetchFn;

    try {
      // Step 1: Create media container
      const createRes = await fn(`https://graph.instagram.com/${getInstagramGraphApiVersion()}/${encodeURIComponent(igUserId)}/media`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          image_url: imageUrl,
          caption
        })
      });
      const createJson: any = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createJson?.id) {
        return {
          ok: false,
          reason: `MEDIA_CONTAINER_FAILED: ${this.redactSecret(createJson?.error?.message || `HTTP_${createRes.status}`)}`,
          caption,
          handle
        };
      }

      const creationId = String(createJson.id);

      // Step 2: Publish media container
      const pubRes = await fn(`https://graph.instagram.com/${getInstagramGraphApiVersion()}/${encodeURIComponent(igUserId)}/media_publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          creation_id: creationId
        })
      });
      const pubJson: any = await pubRes.json().catch(() => ({}));
      if (!pubRes.ok || !pubJson?.id) {
        return {
          ok: false,
          reason: `MEDIA_PUBLISH_FAILED: ${this.redactSecret(pubJson?.error?.message || `HTTP_${pubRes.status}`)}`,
          creationId,
          caption,
          handle
        };
      }

      this.lastPublishedMediaId = String(pubJson.id);
      this.lastPublishedAt = new Date().toISOString();
      await this.persistState();

      return {
        ok: true,
        creationId,
        mediaId: String(pubJson.id),
        caption,
        handle
      };
    } catch (err: any) {
      return {
        ok: false,
        reason: `PUBLISH_EXCEPTION: ${this.redactSecret(err?.message || 'unknown')}`,
        caption,
        handle
      };
    }
  }

  /**
   * Builds Dual-Rail reply text for Comment-to-DM & DM triggers ("DEAL", "LINK", "PRICE", "BUY", "AUDIT").
   */
  public async buildCommentOrDmReply(incomingText: string): Promise<{
    triggered: boolean;
    keyword: string | null;
    replyText: string | null;
  }> {
    const clean = String(incomingText || '').trim();
    const match = clean.match(INSTAGRAM_TRIGGER_KEYWORDS_REGEX);
    if (!match) {
      return { triggered: false, keyword: null, replyText: null };
    }

    const keyword = match[1].toUpperCase();
    const siteUrl = this.getSiteUrl();

    if (keyword === 'AUDIT') {
      const replyText = [
        `Run your free instant Technical SEO & Conversion Leak Audit here: ${siteUrl}/tools/site-audit?utm_source=ig_dm`,
        `Optional self-serve Core Fix-Pack available if defects are detected.`
      ].join('\n');
      return { triggered: true, keyword, replyText };
    }

    let topDeal: any = null;
    try {
      const { AutonomousDealDiscoveryEngine } = await import('../commission/autonomous-deal-discovery-engine.js');
      const eligible = await AutonomousDealDiscoveryEngine.getInstance().getEligiblePublicDeals({ limit: 5 });
      topDeal = (eligible.deals || []).find(
        (d: any) =>
          d.socialMediaPublishersAllowed !== false &&
          d.evidence?.socialMediaPublishersAllowed !== false &&
          Number(d.currentPriceINR || 0) > 0
      ) || eligible.deals?.[0] || null;
    } catch {}

    const dealTitle = topDeal?.title || 'Verified Fair-Price Deals India';
    const priceLabel = topDeal?.currentPriceINR
      ? ` (₹${Math.round(Number(topDeal.currentPriceINR)).toLocaleString('en-IN')})`
      : '';
    const brandStoreUrl = topDeal?.id
      ? `${siteUrl}/api/v1/public/deals/${encodeURIComponent(topDeal.id)}/redirect?utm_source=ig_dm`
      : `${siteUrl}/ig?utm_source=ig_dm`;
    const amazonUrl = `${siteUrl}/api/v1/public/amazon-redirect?q=${encodeURIComponent(dealTitle)}&utm_source=ig_dm`;

    const replyText = [
      `#Ad Here is your verified fair-price link for ${dealTitle}${priceLabel}:`,
      `1. Official Store Offer: ${brandStoreUrl}`,
      `2. Compare Live on Amazon.in: ${amazonUrl}`,
      `All live drops: ${siteUrl}/ig?utm_source=ig_dm`
    ].join('\n');

    return { triggered: true, keyword, replyText };
  }

  /**
   * Verifies Meta Webhook GET hub.challenge subscription handshake.
   */
  public verifyWebhookChallenge(
    mode?: string,
    verifyToken?: string,
    challenge?: string
  ): { verified: boolean; challenge?: string; error?: string } {
    const expected = this.getWebhookVerifyToken();
    if (mode !== 'subscribe') {
      return { verified: false, error: 'INVALID_HUB_MODE' };
    }
    if (!expected) {
      return { verified: false, error: 'WEBHOOK_VERIFY_TOKEN_UNCONFIGURED' };
    }
    const provided = String(verifyToken || '');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');
    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      return { verified: false, error: 'VERIFY_TOKEN_MISMATCH' };
    }
    return { verified: true, challenge: String(challenge || '') };
  }

  /**
   * Dispatches a private reply to either a comment_id or a DM sender user id via Graph v21.0 /messages.
   */
  private async sendInstagramMessage(
    recipient: { comment_id?: string; id?: string },
    text: string,
    fetchOverride?: typeof fetch
  ): Promise<boolean> {
    await this.ensureStateLoaded();
    const { accessToken, igUserId } = this.resolveActiveCredentials();
    if (!accessToken || !igUserId) return false;

    const fn = fetchOverride ?? this.fetchFn;
    try {
      const res = await fn(`https://graph.instagram.com/${getInstagramGraphApiVersion()}/${encodeURIComponent(igUserId)}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          recipient,
          message: { text }
        })
      });
      if (res.ok) {
        this.repliesSentCount++;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Processes Meta Instagram webhook POST payloads for comments & inbound DMs.
   */
  public async handleWebhookPayload(
    payload: any,
    fetchOverride?: typeof fetch
  ): Promise<{ processed: number; repliesSent: number }> {
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];
    let processed = 0;
    let repliesSent = 0;

    for (const entry of entries) {
      // Comment events under entry.changes[]
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const ch of changes) {
        if (ch?.field !== 'comments' && ch?.field !== 'live_comments') continue;
        const val = ch?.value || {};
        const commentId = String(val.id || '').trim();
        const text = String(val.text || '').trim();
        const itemKey = `comment:${commentId}`;
        if (!commentId || !text || (await this.isItemReplied(itemKey))) continue;
        processed++;
        const reply = await this.buildCommentOrDmReply(text);
        if (reply.triggered && reply.replyText) {
          const claimed = await this.claimInstagramReplyAtomically('comment', commentId);
          if (!claimed) continue;
          const ok = await this.sendInstagramMessage({ comment_id: commentId }, reply.replyText, fetchOverride);
          if (ok) {
            await this.markItemReplied(itemKey);
            repliesSent++;
          } else {
            await this.releaseInstagramReplyClaim('comment', commentId);
          }
        }
      }

      // Direct Messages under entry.messaging[]
      const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
      for (const msgEvent of messaging) {
        if (msgEvent?.message?.is_echo) continue;
        const senderId = String(msgEvent?.sender?.id || '').trim();
        const mid = String(msgEvent?.message?.mid || `${senderId}_${msgEvent?.timestamp || Date.now()}`);
        const text = String(msgEvent?.message?.text || '').trim();
        const itemKey = `dm:${mid}`;
        if (!senderId || !text || (await this.isItemReplied(itemKey))) continue;
        processed++;
        const reply = await this.buildCommentOrDmReply(text);
        if (reply.triggered && reply.replyText) {
          const claimed = await this.claimInstagramReplyAtomically('dm', mid);
          if (!claimed) continue;
          const ok = await this.sendInstagramMessage({ id: senderId }, reply.replyText, fetchOverride);
          if (ok) {
            await this.markItemReplied(itemKey);
            repliesSent++;
          } else {
            await this.releaseInstagramReplyClaim('dm', mid);
          }
        }
      }
    }

    if (repliesSent > 0) {
      await this.persistState();
    }
    return { processed, repliesSent };
  }

  /**
   * Polling fallback for hourly cron: reads recent media comments & DM conversations and replies
   * to any trigger keywords (`DEAL`, `LINK`, `PRICE`, `BUY`, `AUDIT`).
   */
  public async pollAndReplyInstagramCommentsAndDms(
    fetchOverride?: typeof fetch
  ): Promise<{
    executed: boolean;
    reason?: string;
    commentsChecked: number;
    dmsChecked: number;
    repliesSent: number;
    commentFetchError?: string | null;
    dmFetchError?: string | null;
  }> {
    if (process.env.VITEST && !fetchOverride) {
      return { executed: false, reason: 'SKIPPED_IN_VITEST', commentsChecked: 0, dmsChecked: 0, repliesSent: 0 };
    }

    await this.ensureStateLoaded();
    const { accessToken, igUserId } = this.resolveActiveCredentials();
    if (!accessToken || !igUserId) {
      return { executed: false, reason: 'NO_LIVE_TOKEN_OR_USER_ID', commentsChecked: 0, dmsChecked: 0, repliesSent: 0 };
    }

    const fn = fetchOverride ?? this.fetchFn;
    let commentsChecked = 0;
    let dmsChecked = 0;
    let repliesSent = 0;
    let commentFetchError: string | null = null;
    let dmFetchError: string | null = null;

    try {
      const mediaUrl = `https://graph.instagram.com/${getInstagramGraphApiVersion()}/${encodeURIComponent(igUserId)}/media?fields=id,comments{id,text,username}&limit=5&access_token=${encodeURIComponent(accessToken)}`;
      const mediaRes = await fn(mediaUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!mediaRes.ok) {
        const errText = await mediaRes.text().catch(() => '');
        commentFetchError = `HTTP_${mediaRes.status}: ${errText.slice(0, 200)}`;
      } else {
        const mediaJson: any = await mediaRes.json().catch(() => ({}));
        const posts = Array.isArray(mediaJson?.data) ? mediaJson.data : [];
        for (const post of posts) {
          const comments = Array.isArray(post?.comments?.data) ? post.comments.data : [];
          for (const c of comments) {
            const cId = String(c?.id || '').trim();
            const cText = String(c?.text || '').trim();
            const itemKey = `comment:${cId}`;
            if (!cId || !cText || (await this.isItemReplied(itemKey))) continue;
            commentsChecked++;
            const reply = await this.buildCommentOrDmReply(cText);
            if (reply.triggered && reply.replyText) {
              const claimed = await this.claimInstagramReplyAtomically('comment', cId);
              if (!claimed) continue;
              const ok = await this.sendInstagramMessage({ comment_id: cId }, reply.replyText, fn);
              if (ok) {
                await this.markItemReplied(itemKey);
                repliesSent++;
              } else {
                await this.releaseInstagramReplyClaim('comment', cId);
              }
            }
          }
        }
      }
    } catch (err: any) {
      commentFetchError = err?.message || String(err);
    }

    try {
      const convUrl = `https://graph.instagram.com/${getInstagramGraphApiVersion()}/${encodeURIComponent(igUserId)}/conversations?fields=messages{id,message,from}&limit=10&access_token=${encodeURIComponent(accessToken)}`;
      const convRes = await fn(convUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
      if (!convRes.ok) {
        const errText = await convRes.text().catch(() => '');
        dmFetchError = `HTTP_${convRes.status}: ${errText.slice(0, 200)}`;
      } else {
        const convJson: any = await convRes.json().catch(() => ({}));
        const convs = Array.isArray(convJson?.data) ? convJson.data : [];
        for (const conv of convs) {
          const msgs = Array.isArray(conv?.messages?.data) ? conv.messages.data : [];
          const latest = msgs[0];
          const mid = String(latest?.id || '').trim();
          const senderId = String(latest?.from?.id || '').trim();
          const mText = String(latest?.message || '').trim();
          const itemKey = `dm:${mid}`;
          if (!mid || !senderId || senderId === igUserId || !mText || (await this.isItemReplied(itemKey))) continue;
          dmsChecked++;
          const reply = await this.buildCommentOrDmReply(mText);
          if (reply.triggered && reply.replyText) {
            const claimed = await this.claimInstagramReplyAtomically('dm', mid);
            if (!claimed) continue;
            const ok = await this.sendInstagramMessage({ id: senderId }, reply.replyText, fn);
            if (ok) {
              await this.markItemReplied(itemKey);
              repliesSent++;
            } else {
              await this.releaseInstagramReplyClaim('dm', mid);
            }
          }
        }
      }
    } catch (err: any) {
      dmFetchError = err?.message || String(err);
    }

    this.lastPollAt = new Date().toISOString();
    await this.persistState();

    const executed = !commentFetchError && !dmFetchError;

    return {
      executed,
      reason: !executed ? `POLL_ERRORS: comment=${commentFetchError || 'none'}; dm=${dmFetchError || 'none'}` : undefined,
      commentsChecked,
      dmsChecked,
      repliesSent,
      commentFetchError,
      dmFetchError
    };
  }
}
