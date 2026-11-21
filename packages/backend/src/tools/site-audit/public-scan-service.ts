/**
 * Hardened Public Scan Service for Owner Web Tools (POST /api/v1/public/scan)
 *
 * Enforces:
 * - Strict SSRF protection via @ai-marketing/sitefix-core SecureUrlFetcher
 *   (public IPs only, DNS resolve-then-connect, redirect hop revalidation)
 * - 5s timeout per HTTP fetch, 1 MB max body size cap, clear User-Agent
 * - 24-hour URL result cache using in-memory Map + existing durable_events table (zero new .sql migrations)
 * - Non-PII Fix-Pack preview generation via SiteAuditFixPackGenerator
 */

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

export interface PublicScanFixPackPreview {
  canonicalSku: 'SITEFIX_AI_PACK_V1';
  priceINR: number;
  snippetPreview: string;
  deliverablesIncluded: string[];
  missingFieldsRequiringOwnerInput: string[];
  disclosure: string;
}

export interface HardenedPublicScanOutput {
  cached: boolean;
  cacheTtlHours: number;
  cachedAt: string;
  normalizedUrl: string;
  result: SiteAuditResult;
  fixPackPreview: PublicScanFixPackPreview;
}

interface CacheRecord {
  normalizedUrl: string;
  result: SiteAuditResult;
  fixPackPreview: PublicScanFixPackPreview;
  cachedAt: string;
  expiresAt: number;
}

const memoryScanCache = new Map<string, CacheRecord>();
const scanner = new SiteAuditScanner();
const fixPackGenerator = new SiteAuditFixPackGenerator();

export function clearPublicScanCacheForTesting(): void {
  memoryScanCache.clear();
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

export function buildPublicFixPackPreview(audit: SiteAuditResult): PublicScanFixPackPreview {
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
    canonicalSku: 'SITEFIX_AI_PACK_V1',
    priceINR: 499,
    snippetPreview: audit.preview?.fixPackSnippetPreview || pack.headMetadataSnippet,
    deliverablesIncluded,
    missingFieldsRequiringOwnerInput: pack.missingFieldsRequiringOwnerInput || [],
    disclosure: pack.disclosure
  };
}

async function readDurableCacheEntry(normalizedUrl: string): Promise<CacheRecord | null> {
  const now = Date.now();
  const mem = memoryScanCache.get(normalizedUrl);
  if (mem && mem.expiresAt > now) {
    return mem;
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
  } catch {
    row = null;
  }

  if (!row?.payload_json) {
    return null;
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
        fixPackPreview: parsed.fixPackPreview || buildPublicFixPackPreview(parsed.result),
        cachedAt: parsed.cachedAt || new Date().toISOString(),
        expiresAt: parsed.expiresAt
      };
      memoryScanCache.set(normalizedUrl, record);
      return record;
    }
  } catch {}

  return null;
}

async function writeDurableCacheEntry(record: CacheRecord): Promise<void> {
  memoryScanCache.set(record.normalizedUrl, record);

  const cacheHash = hashCacheKey(record.normalizedUrl);
  const id = `sfx_cache_${cacheHash}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const payload = JSON.stringify({
    normalizedUrl: record.normalizedUrl,
    cachedAt: record.cachedAt,
    expiresAt: record.expiresAt,
    result: record.result,
    fixPackPreview: record.fixPackPreview
  });

  const sql = `
    INSERT OR IGNORE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
    VALUES (?, ?, 'org_owner_primary', ?, datetime('now'))
  `;
  const params = [id, PUBLIC_SCAN_CACHE_EVENT_TYPE, payload];

  try {
    getDb().prepare(sql).run(...params);
  } catch {}

  try {
    const d1Repo = D1RevenueRepository.getInstance();
    if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
      await d1Repo.executeWrite('durable_events', sql, params);
    }
  } catch {}
}

export async function executeHardenedPublicScan(params: {
  url: string;
  skipCache?: boolean;
  fetchOptionsOverride?: Partial<SecureFetchOptions>;
}): Promise<HardenedPublicScanOutput> {
  const normalizedUrl = normalizeUrlForPublicCache(params.url);

  if (!params.skipCache) {
    const cached = await readDurableCacheEntry(normalizedUrl);
    if (cached) {
      return {
        cached: true,
        cacheTtlHours: 24,
        cachedAt: cached.cachedAt,
        normalizedUrl,
        result: cached.result,
        fixPackPreview: cached.fixPackPreview
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

  const fixPackPreview = buildPublicFixPackPreview(result);
  const cachedAt = new Date().toISOString();
  const record: CacheRecord = {
    normalizedUrl,
    result,
    fixPackPreview,
    cachedAt,
    expiresAt: Date.now() + PUBLIC_SCAN_CACHE_TTL_MS
  };

  await writeDurableCacheEntry(record);

  // Also seed SiteAuditService cache so clicking through to /tools/site-audit can reference this auditId
  try {
    const service = SiteAuditService.getInstance();
    await service.persistAuditToD1(result);
  } catch {}

  return {
    cached: false,
    cacheTtlHours: 24,
    cachedAt,
    normalizedUrl,
    result,
    fixPackPreview
  };
}
