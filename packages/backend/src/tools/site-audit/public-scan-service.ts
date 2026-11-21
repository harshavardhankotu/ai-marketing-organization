/**
 * Hardened Public Scan Service for Owner Web Tools (POST /api/v1/public/scan)
 *
 * Enforces:
 * - Strict SSRF protection via @ai-marketing/sitefix-core SecureUrlFetcher
 *   (public IPs only, DNS resolve-then-connect, redirect hop revalidation)
 * - 5s timeout per HTTP fetch, 1 MB max body size cap, clear User-Agent
 * - Bounded in-memory LRU/FIFO cache (max 500 entries) + 24-hour durable_events cache (zero new .sql migrations)
 * - Explicit cacheStatus reporting: 'HIT_D1' | 'HIT_MEMORY' | 'MISS' | 'D1_WRITE_FAILED' | 'D1_READ_FAILED'
 * - Single commercial config gating strictly from SiteAuditService.getCheckoutReadiness() + owner/OWN_OFFER.md
 * - Authorization strictly labeled as 'SELF_DECLARED_AUTHORIZATION' (never 'verified ownership')
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  SiteAuditScanner,
  SiteAuditFixPackGenerator,
  SecureUrlFetcher,
  type SiteAuditResult,
  type SecureFetchOptions
} from '@ai-marketing/sitefix-core';
import { getDb } from '../../db/client.js';
import { isProduction } from '../../config/env.js';
import { D1RevenueRepository } from '../../db/d1-revenue-repository.js';
import { SiteAuditService } from './site-audit-service.js';

export const PUBLIC_SCAN_CACHE_EVENT_TYPE = 'SITEFIX_PUBLIC_SCAN_CACHE';
export const PUBLIC_SCAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_SCAN_TIMEOUT_MS = 5000;
export const PUBLIC_SCAN_MAX_BYTES = SecureUrlFetcher.PUBLIC_SCAN_MAX_SIZE_BYTES; // 1 MB
export const PUBLIC_SCAN_USER_AGENT =
  'SiteFixAI-PublicScanner/1.0 (+https://ai-marketing-organization.onrender.com/tools/site-audit)';
export const PUBLIC_SCAN_AUTHORIZATION_MODE = 'SELF_DECLARED_AUTHORIZATION' as const;
export const DEFAULT_MAX_MEMORY_CACHE_ENTRIES = 500;

export type PublicScanCacheStatus =
  | 'HIT_D1'
  | 'HIT_MEMORY'
  | 'MISS'
  | 'D1_WRITE_FAILED'
  | 'D1_READ_FAILED';

export interface PublicCommercialConfig {
  canonicalSku: string;
  priceINR: number | null;
  ownerOfferAttested: boolean;
  checkoutReady: boolean;
  checkoutLocked: boolean;
  checkoutLockReason: string | null;
  hostedPaymentLinkUrl: string | null;
}

export interface PublicScanFixPackPreview {
  canonicalSku: string;
  priceINR: number | null;
  ownerOfferAttested: boolean;
  checkoutLocked: boolean;
  snippetPreview: string;
  deliverablesIncluded: string[];
  missingFieldsRequiringOwnerInput: string[];
  disclosure: string;
}

export interface HardenedPublicScanOutput {
  cached: boolean;
  cacheStatus: PublicScanCacheStatus;
  cacheTtlHours: number;
  cachedAt: string;
  authorizationMode: typeof PUBLIC_SCAN_AUTHORIZATION_MODE;
  normalizedUrl: string;
  commercialConfig: PublicCommercialConfig;
  result: SiteAuditResult;
  fixPackPreview: PublicScanFixPackPreview;
}

interface CacheRecord {
  normalizedUrl: string;
  result: SiteAuditResult;
  cachedAt: string;
  expiresAt: number;
}

let maxMemoryCacheEntries = DEFAULT_MAX_MEMORY_CACHE_ENTRIES;
const memoryScanCache = new Map<string, CacheRecord>();
const scanner = new SiteAuditScanner();
const fixPackGenerator = new SiteAuditFixPackGenerator();

export function clearPublicScanCacheForTesting(): void {
  memoryScanCache.clear();
  maxMemoryCacheEntries = DEFAULT_MAX_MEMORY_CACHE_ENTRIES;
}

export function setPublicScanMemoryCacheCapForTesting(limit: number): void {
  maxMemoryCacheEntries = Math.max(1, Math.floor(limit));
  while (memoryScanCache.size > maxMemoryCacheEntries) {
    const oldestKey = memoryScanCache.keys().next().value;
    if (oldestKey === undefined) break;
    memoryScanCache.delete(oldestKey);
  }
}

export function getPublicScanMemoryCacheSizeForTesting(): number {
  return memoryScanCache.size;
}

function putBoundedMemoryCache(key: string, record: CacheRecord): void {
  if (memoryScanCache.has(key)) {
    memoryScanCache.delete(key);
  }
  while (memoryScanCache.size >= maxMemoryCacheEntries) {
    const oldestKey = memoryScanCache.keys().next().value;
    if (oldestKey === undefined) break;
    memoryScanCache.delete(oldestKey);
  }
  memoryScanCache.set(key, record);
}

/**
 * Parses authoritative SKU & Price strictly from owner/OWN_OFFER.md (single source of truth).
 * Never falls back to hardcoded rupee prices if owner/OWN_OFFER.md is missing or unparseable.
 */
function readAuthoritativeOwnerOfferSpec(): { sku: string | null; priceINR: number | null } {
  try {
    const candidates = [
      path.resolve(process.cwd(), 'owner', 'OWN_OFFER.md'),
      path.resolve(process.cwd(), '..', 'owner', 'OWN_OFFER.md'),
      path.resolve(process.cwd(), '..', '..', 'owner', 'OWN_OFFER.md')
    ];
    const offerPath = candidates.find(p => fs.existsSync(p));
    if (!offerPath) {
      return { sku: null, priceINR: null };
    }
    const content = fs.readFileSync(offerPath, 'utf8');
    const skuMatch = content.match(/\*\*Product SKU:\*\*\s*`?([A-Z0-9_]+)`?/i);
    const priceMatch = content.match(/\*\*Authorized Price:\*\*\s*₹\s*([0-9,]+(?:\.[0-9]+)?)/i);
    const sku = skuMatch ? skuMatch[1].trim() : null;
    const parsedPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : NaN;
    const priceINR = Number.isFinite(parsedPrice) && parsedPrice > 0 ? Math.round(parsedPrice) : null;
    return { sku, priceINR };
  } catch {
    return { sku: null, priceINR: null };
  }
}

/**
 * Single commercial configuration resolver gated strictly by SiteAuditService.getCheckoutReadiness()
 * and owner/OWN_OFFER.md. Never hardcodes priceINR.
 */
export function resolvePublicCommercialConfig(): PublicCommercialConfig {
  const service = SiteAuditService.getInstance();
  const readiness = service.getCheckoutReadiness();
  const offerSpec = readAuthoritativeOwnerOfferSpec();
  const terms = service.getCommercialTerms();

  const canonicalSku = offerSpec.sku || terms.sku;
  const ownerOfferAttested = Boolean(readiness.paymentReadiness.ownerOfferAttested);
  const checkoutReady = Boolean(readiness.isReady);
  const checkoutLocked = !ownerOfferAttested || !checkoutReady;

  const priceINR = offerSpec.priceINR ?? (ownerOfferAttested ? terms.proposedPriceINR : null);

  const rawHostedUrl = (process.env.RAZORPAY_HOSTED_PAYMENT_LINK_URL || '').trim();
  const hostedPaymentLinkUrl =
    ownerOfferAttested && /^https:\/\//i.test(rawHostedUrl) ? rawHostedUrl : null;

  let checkoutLockReason: string | null = null;
  if (!ownerOfferAttested) {
    checkoutLockReason = 'PENDING_OWNER_ATTESTATION';
  } else if (!checkoutReady) {
    checkoutLockReason =
      readiness.missingConfig.length > 0
        ? `LOCKED_MISSING_CONFIGURATION:${readiness.missingConfig.join(',')}`
        : readiness.status;
  }

  return {
    canonicalSku,
    priceINR,
    ownerOfferAttested,
    checkoutReady,
    checkoutLocked,
    checkoutLockReason,
    hostedPaymentLinkUrl
  };
}

export function normalizeUrlForPublicCache(rawUrl: string): string {
  const trimmed = String(rawUrl || '').trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProto);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname === '') {
    parsed.pathname = '/';
  }
  return parsed.toString();
}

function hashCacheKey(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 24);
}

export function buildPublicFixPackPreview(
  audit: SiteAuditResult,
  commercialConfig: PublicCommercialConfig = resolvePublicCommercialConfig()
): PublicScanFixPackPreview {
  const pack = fixPackGenerator.generateFixPack(audit);
  const deliverablesIncluded = [
    'Copy-paste <head> title, description & canonical tags',
    'Open Graph & WhatsApp link preview meta tags',
    'Twitter / X Card metadata tags',
    'Valid Schema.org JSON-LD template (with explicit placeholders)',
    'robots.txt & sitemap.xml recommendations',
    '1 included post-fix verification recheck'
  ];
  return {
    canonicalSku: commercialConfig.canonicalSku,
    priceINR: commercialConfig.priceINR,
    ownerOfferAttested: commercialConfig.ownerOfferAttested,
    checkoutLocked: commercialConfig.checkoutLocked,
    snippetPreview: audit.preview?.fixPackSnippetPreview || pack.headMetadataSnippet,
    deliverablesIncluded,
    missingFieldsRequiringOwnerInput: pack.missingFieldsRequiringOwnerInput || [],
    disclosure: pack.disclosure
  };
}

async function readDurableCacheEntry(
  normalizedUrl: string
): Promise<{ record: CacheRecord | null; status: 'HIT_MEMORY' | 'HIT_D1' | 'MISS' | 'D1_READ_FAILED' }> {
  const now = Date.now();
  const mem = memoryScanCache.get(normalizedUrl);
  if (mem && mem.expiresAt > now) {
    // Refresh LRU order
    memoryScanCache.delete(normalizedUrl);
    memoryScanCache.set(normalizedUrl, mem);
    return { record: mem, status: 'HIT_MEMORY' };
  }
  if (mem && mem.expiresAt <= now) {
    memoryScanCache.delete(normalizedUrl);
  }

  const cacheHash = hashCacheKey(normalizedUrl);
  const sql = `
    SELECT payload_json, created_at
    FROM durable_events
    WHERE event_type = ?
      AND id LIKE ?
      AND created_at >= datetime('now', '-24 hours')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const likePattern = `sfx_cache_${cacheHash}_%`;

  let row: { payload_json?: string | null; created_at?: string | null } | null = null;
  try {
    const d1Repo = D1RevenueRepository.getInstance();
    if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
      row = await d1Repo.queryOne<{ payload_json?: string | null; created_at?: string | null }>(
        'durable_events',
        sql,
        [PUBLIC_SCAN_CACHE_EVENT_TYPE, likePattern]
      );
    } else {
      row = (getDb().prepare(sql).get(PUBLIC_SCAN_CACHE_EVENT_TYPE, likePattern) as any) || null;
    }
  } catch (err: any) {
    console.error(`[PublicScanService] D1/SQLite cache read failed for ${normalizedUrl}: ${err?.message || err}`);
    return { record: null, status: 'D1_READ_FAILED' };
  }

  if (!row?.payload_json) {
    return { record: null, status: 'MISS' };
  }

  try {
    const parsed = JSON.parse(row.payload_json);
    if (
      parsed &&
      parsed.normalizedUrl === normalizedUrl &&
      parsed.result &&
      typeof parsed.expiresAt === 'number' &&
      parsed.expiresAt > now
    ) {
      const record: CacheRecord = {
        normalizedUrl,
        result: parsed.result,
        cachedAt: parsed.cachedAt || new Date().toISOString(),
        expiresAt: parsed.expiresAt
      };
      putBoundedMemoryCache(normalizedUrl, record);
      return { record, status: 'HIT_D1' };
    }
  } catch (err: any) {
    console.error(`[PublicScanService] Corrupt durable cache payload for ${normalizedUrl}: ${err?.message || err}`);
    return { record: null, status: 'D1_READ_FAILED' };
  }

  return { record: null, status: 'MISS' };
}

async function writeDurableCacheEntry(record: CacheRecord): Promise<'OK' | 'D1_WRITE_FAILED'> {
  putBoundedMemoryCache(record.normalizedUrl, record);

  const cacheHash = hashCacheKey(record.normalizedUrl);
  const id = `sfx_cache_${cacheHash}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const payload = JSON.stringify({
    normalizedUrl: record.normalizedUrl,
    cachedAt: record.cachedAt,
    expiresAt: record.expiresAt,
    authorizationMode: PUBLIC_SCAN_AUTHORIZATION_MODE,
    result: record.result
  });

  const sql = `
    INSERT OR IGNORE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
    VALUES (?, ?, 'org_owner_primary', ?, datetime('now'))
  `;
  const params = [id, PUBLIC_SCAN_CACHE_EVENT_TYPE, payload];

  let writeFailed = false;
  try {
    const d1Repo = D1RevenueRepository.getInstance();
    if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
      await d1Repo.executeWrite('durable_events', sql, params);
    } else {
      getDb().prepare(sql).run(...params);
    }
  } catch (err: any) {
    console.error(`[PublicScanService] D1/SQLite cache write failed for ${record.normalizedUrl}: ${err?.message || err}`);
    writeFailed = true;
  }

  return writeFailed ? 'D1_WRITE_FAILED' : 'OK';
}

export async function executeHardenedPublicScan(params: {
  url: string;
  skipCache?: boolean;
  fetchOptionsOverride?: Partial<SecureFetchOptions>;
}): Promise<HardenedPublicScanOutput> {
  const normalizedUrl = normalizeUrlForPublicCache(params.url);
  const commercialConfig = resolvePublicCommercialConfig();

  let readStatus: 'HIT_MEMORY' | 'HIT_D1' | 'MISS' | 'D1_READ_FAILED' = 'MISS';
  if (!params.skipCache) {
    const cacheLookup = await readDurableCacheEntry(normalizedUrl);
    readStatus = cacheLookup.status;
    if (cacheLookup.record && (readStatus === 'HIT_MEMORY' || readStatus === 'HIT_D1')) {
      return {
        cached: true,
        cacheStatus: readStatus,
        cacheTtlHours: 24,
        cachedAt: cacheLookup.record.cachedAt,
        authorizationMode: PUBLIC_SCAN_AUTHORIZATION_MODE,
        normalizedUrl,
        commercialConfig,
        result: cacheLookup.record.result,
        fixPackPreview: buildPublicFixPackPreview(cacheLookup.record.result, commercialConfig)
      };
    }
  }

  const fetchOptions: SecureFetchOptions = {
    timeoutMs: PUBLIC_SCAN_TIMEOUT_MS,
    maxRedirects: 3,
    maxSizeBytes: PUBLIC_SCAN_MAX_BYTES,
    userAgent: PUBLIC_SCAN_USER_AGENT,
    ...(params.fetchOptionsOverride || {})
  };

  const result = await scanner.scanUrl(
    {
      url: normalizedUrl,
      websiteType: 'DEVELOPER_LAUNCH_QA',
      userConfirmedOwnership: true
    },
    undefined,
    fetchOptions
  );

  const cachedAt = new Date().toISOString();
  const record: CacheRecord = {
    normalizedUrl,
    result,
    cachedAt,
    expiresAt: Date.now() + PUBLIC_SCAN_CACHE_TTL_MS
  };

  const writeOutcome = await writeDurableCacheEntry(record);

  // Also persist audit record so downstream checkout / recheck can reference this auditId
  try {
    const service = SiteAuditService.getInstance();
    await service.persistAuditToD1(result);
  } catch (err: any) {
    console.warn(`[PublicScanService] Non-blocking persistAuditToD1 error: ${err?.message || err}`);
  }

  const cacheStatus: PublicScanCacheStatus =
    writeOutcome === 'D1_WRITE_FAILED'
      ? 'D1_WRITE_FAILED'
      : readStatus === 'D1_READ_FAILED'
        ? 'D1_READ_FAILED'
        : 'MISS';

  return {
    cached: false,
    cacheStatus,
    cacheTtlHours: 24,
    cachedAt,
    authorizationMode: PUBLIC_SCAN_AUTHORIZATION_MODE,
    normalizedUrl,
    commercialConfig,
    result,
    fixPackPreview: buildPublicFixPackPreview(result, commercialConfig)
  };
}
