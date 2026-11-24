import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../../db/client.js';
import { isProduction } from '../../config/env.js';
import { D1RevenueRepository } from '../../db/d1-revenue-repository.js';
import { getTrustedClientIp, isPrivateOrCloudflareIp } from '../../security/client-ip.js';

export type SiteFixLaunchSource =
  | 'cli'
  | 'action'
  | 'web'
  | 'mcp'
  | 'web_whatsapp_preview'
  | 'web_open_graph'
  | 'web_robots_sitemap'
  | 'web_json_ld';

export type SiteFixFunnelStage =
  | 'page_view'
  | 'scan_started'
  | 'scan_completed'
  | 'preview_displayed'
  | 'order_created'
  | 'checkout_modal_opened'
  | 'payment_captured'
  | 'deliverable_ready'
  | 'email_delivered'
  | 'scan_attempt'
  | 'scan'
  | 'preview_open'
  | 'checkout_start'
  | 'capture'
  | 'delivery';

export type SiteFixFunnelStorageStatus =
  | 'PERSISTED_D1'
  | 'PERSISTED_LOCAL'
  | 'FALLBACK_LOCAL_ONLY'
  | 'WRITE_FAILED';

export interface SiteFixFunnelRecordResult {
  persisted: boolean;
  storageStatus: SiteFixFunnelStorageStatus;
  recorded?: boolean;
  d1Persisted?: boolean;
  error?: string;
}

export const ALLOWED_SITEFIX_SOURCES: readonly SiteFixLaunchSource[] = [
  'cli',
  'action',
  'web',
  'mcp',
  'web_whatsapp_preview',
  'web_open_graph',
  'web_robots_sitemap',
  'web_json_ld'
] as const;

export const SITEFIX_FUNNEL_EVENT_TYPE = 'SITEFIX_FUNNEL_EVENT';
export const SITEFIX_FUNNEL_WINDOW_LIMIT = 5000;
export const SITEFIX_FUNNEL_REPORTING_WINDOW = 'LATEST_5000_EVENTS' as const;

const REPO_CI_AND_PROBE_UA_REGEX =
  /github-actions|ai-marketing-organization-ci|sitefix-ci-probe|sitefix-diagnostic|diagnostic-probe|curl\/|wget\/|httpie\/|vitest|node-fetch|undici/i;

// In-process write-failure observability counters surfaced on /api/v1/owner/today
let funnelWriteFailureCount = 0;
let lastFunnelWriteFailureError: string | null = null;
let lastFunnelWriteFailureAt: string | null = null;

export function resetSiteFixFunnelWriteMetricsForTesting(): void {
  funnelWriteFailureCount = 0;
  lastFunnelWriteFailureError = null;
  lastFunnelWriteFailureAt = null;
}

export function getSiteFixFunnelWriteMetrics(): {
  funnelWriteFailureCount: number;
  lastError: string | null;
  lastFailureAt: string | null;
} {
  return {
    funnelWriteFailureCount,
    lastError: lastFunnelWriteFailureError,
    lastFailureAt: lastFunnelWriteFailureAt
  };
}

function recordFunnelWriteFailure(target: 'D1' | 'LOCAL_SQLITE', stage: string, source: string, errorMessage: string): void {
  funnelWriteFailureCount += 1;
  lastFunnelWriteFailureError = errorMessage;
  lastFunnelWriteFailureAt = new Date().toISOString();
  console.warn(
    '[SiteFixFunnelAttribution] WRITE_FAILED',
    JSON.stringify({
      target,
      stage,
      source,
      funnelWriteFailureCount,
      error: errorMessage,
      timestamp: lastFunnelWriteFailureAt
    })
  );
}

export function normalizeSiteFixSource(
  raw: unknown,
  fallback: SiteFixLaunchSource = 'web'
): SiteFixLaunchSource {
  const clean = String(raw ?? '').trim().toLowerCase();
  if ((ALLOWED_SITEFIX_SOURCES as readonly string[]).includes(clean)) {
    return clean as SiteFixLaunchSource;
  }
  return fallback;
}

/**
 * Returns a daily rotating secret salt (secret + UTC YYYY-MM-DD) so visitor
 * fingerprints are never unsalted IP+UA hashes and rotate cleanly every UTC day.
 */
export function getFunnelDailySalt(dateKey?: string): string {
  const utcDay =
    dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
      ? dateKey
      : new Date().toISOString().slice(0, 10);
  const secret = (
    process.env.AUTH_SECRET ||
    process.env.SITE_AUDIT_SIGNING_SECRET ||
    process.env.IP_HASH_SALT ||
    'sitefix_funnel_daily_fallback_salt'
  ).trim();
  return `${secret}:${utcDay}`;
}

export function hashFunnelVisitorKey(
  rawVisitorKey: string | null | undefined,
  dateKey?: string
): string | null {
  const clean = String(rawVisitorKey || '').trim();
  if (!clean) return null;
  const dailySalt = getFunnelDailySalt(dateKey);
  return createHash('sha256')
    .update(`${dailySalt}:${clean}`)
    .digest('hex')
    .slice(0, 16);
}

function readHeader(reqLike: any, name: string): string {
  if (!reqLike) return '';
  try {
    if (typeof reqLike.req?.header === 'function') {
      return String(reqLike.req.header(name) || '').trim();
    }
    if (typeof reqLike.header === 'function') {
      return String(reqLike.header(name) || '').trim();
    }
    if (typeof reqLike.get === 'function') {
      return String(reqLike.get(name) || '').trim();
    }
    if (typeof reqLike.headers === 'object' && reqLike.headers !== null) {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(reqLike.headers)) {
        if (k.toLowerCase() === lower && v != null) {
          return String(v).trim();
        }
      }
    }
    if (typeof reqLike === 'object') {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(reqLike)) {
        if (k.toLowerCase() === lower && v != null && typeof v !== 'object') {
          return String(v).trim();
        }
      }
    }
  } catch {}
  return '';
}

function normalizeRemoteAddr(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let trimmed = raw.trim();
  if (trimmed.startsWith('::ffff:')) {
    trimmed = trimmed.slice(7);
  }
  return trimmed;
}

/**
 * Extracts a trusted client IP without trusting raw spoofable leftmost X-Forwarded-For headers.
 * Priority:
 * 1. Express-style trusted `req.ip` (set by framework trust-proxy configuration).
 * 2. Direct Node socket `remoteAddress` when it is a public non-proxy IP.
 * 3. Hono `getTrustedClientIp(c)` trailing-proxy-stripping resolution (drops Cloudflare/private
 *    proxy hops from the right and takes the rightmost remaining entry; ignores `cf-connecting-ip`
 *    unless `TRUST_CF_HEADER === 'true'`).
 * 4. Same rightmost non-proxy extraction for plain header maps in unit tests.
 */
export function extractTrustedVisitorIp(reqLike: any): string {
  if (!reqLike || typeof reqLike !== 'object') return 'unknown';

  // 1. Prefer framework-trusted req.ip (e.g. Express req.ip) over raw X-Forwarded-For headers
  const expressIp = normalizeRemoteAddr(reqLike.ip ?? reqLike.req?.ip);
  if (expressIp) {
    return expressIp;
  }

  // 2. Direct public socket peer address (not behind a private/Cloudflare reverse proxy)
  const socketIp = normalizeRemoteAddr(
    reqLike.env?.incoming?.socket?.remoteAddress ??
      reqLike.socket?.remoteAddress ??
      reqLike.req?.raw?.socket?.remoteAddress
  );
  if (socketIp && !isPrivateOrCloudflareIp(socketIp)) {
    return socketIp;
  }

  // 3. Hono Context behind Render/Cloudflare proxy: use trailing-proxy-dropping trusted IP resolver
  if (typeof reqLike.req?.header === 'function') {
    const trusted = getTrustedClientIp(reqLike);
    if (trusted.ip && trusted.ip !== 'unknown') {
      return trusted.ip;
    }
  }

  // 4. Generic header-map fallback using identical trailing-proxy-dropping semantics
  const trustCf = process.env.TRUST_CF_HEADER === 'true';
  const cfIp = readHeader(reqLike, 'cf-connecting-ip');
  if (trustCf && cfIp && !isPrivateOrCloudflareIp(cfIp)) {
    return cfIp;
  }

  const xff = readHeader(reqLike, 'x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    while (parts.length > 0 && isPrivateOrCloudflareIp(parts[parts.length - 1])) {
      parts.pop();
    }
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  return socketIp || 'unknown';
}

/**
 * Classifies whether a request is an internal diagnostic probe or repository CI run
 * that must be excluded from external funnel metrics on /api/v1/owner/today.
 */
export function classifySiteFixProbe(
  reqLike: any,
  dateKey?: string
): {
  isProbe: boolean;
  probeReason: string | null;
  userAgent: string;
  visitorHash: string | null;
} {
  const probeHeader = readHeader(reqLike, 'x-diagnostic-probe');
  const userAgent = readHeader(reqLike, 'user-agent');
  const trustedIp = extractTrustedVisitorIp(reqLike);
  const visitorHash = hashFunnelVisitorKey(`${trustedIp}|${userAgent || 'ua'}`, dateKey);

  if (
    probeHeader &&
    probeHeader.toLowerCase() !== 'false' &&
    probeHeader !== '0'
  ) {
    return {
      isProbe: true,
      probeReason: `X-Diagnostic-Probe:${probeHeader.slice(0, 64)}`,
      userAgent,
      visitorHash
    };
  }

  if (userAgent && REPO_CI_AND_PROBE_UA_REGEX.test(userAgent)) {
    return {
      isProbe: true,
      probeReason: `CI_OR_PROBE_UA:${userAgent.slice(0, 80)}`,
      userAgent,
      visitorHash
    };
  }

  return {
    isProbe: false,
    probeReason: null,
    userAgent,
    visitorHash
  };
}

export interface SiteFixFunnelStageCounts {
  /** Distinct daily-salted SHA-256 IP+UA fingerprints observed in the reporting window (not verified unique people). */
  distinctVisitorFingerprints: number;
  distinctSessionFingerprints: number;
  externalPageViews: number;

  // 9 Clean Funnel Stages (Stage U.1)
  page_view: number;
  scan_started: number;
  scan_completed: number;
  preview_displayed: number;
  order_created: number;
  checkout_modal_opened: number;
  payment_captured: number;
  deliverable_ready: number;
  email_delivered: number;

  // Backward-compatibility counters
  scanAttempts: number;
  completedScans: number;
  scan: number;
  preview_open: number;
  checkout_start: number;
  capture: number;
  delivery: number;
  delivered: number;
}

export interface SiteFixFunnelAttributionSummary {
  reportingWindow: typeof SITEFIX_FUNNEL_REPORTING_WINDOW;
  eventLimitReached: boolean;
  eventsSampled: number;
  funnelWriteFailureCount: number;
  persistenceWarning: string | null;
  totals: SiteFixFunnelStageCounts;
  bySource: Record<SiteFixLaunchSource, SiteFixFunnelStageCounts>;
  excludedProbesCount: number;
  excludedBySource: Record<SiteFixLaunchSource, number>;
}

function emptyStageCounts(): SiteFixFunnelStageCounts {
  return {
    distinctVisitorFingerprints: 0,
    distinctSessionFingerprints: 0,
    externalPageViews: 0,
    page_view: 0,
    scan_started: 0,
    scan_completed: 0,
    preview_displayed: 0,
    order_created: 0,
    checkout_modal_opened: 0,
    payment_captured: 0,
    deliverable_ready: 0,
    email_delivered: 0,
    scanAttempts: 0,
    completedScans: 0,
    scan: 0,
    preview_open: 0,
    checkout_start: 0,
    capture: 0,
    delivery: 0,
    delivered: 0
  };
}

/**
 * Resolves the originating attribution source stored on payment_orders.notes_json
 * so capture and delivery stages preserve the exact source from scan -> preview_open -> checkout_start.
 */
export async function resolveStoredOrderSource(
  orderId?: string | null,
  auditId?: string | null
): Promise<SiteFixLaunchSource | null> {
  const cleanOrderId = String(orderId || '').trim();
  const cleanAuditId = String(auditId || '').trim();
  if (!cleanOrderId && !cleanAuditId) return null;

  try {
    const d1Repo = D1RevenueRepository.getInstance();
    let row: { notes_json?: string | null } | null = null;
    if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
      row = cleanOrderId
        ? await d1Repo.queryOne<{ notes_json?: string | null }>(
            'payment_orders',
            `SELECT notes_json FROM payment_orders WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
            [cleanOrderId]
          )
        : await d1Repo.queryOne<{ notes_json?: string | null }>(
            'payment_orders',
            `SELECT notes_json FROM payment_orders WHERE receipt = ? ORDER BY created_at DESC LIMIT 1`,
            [cleanAuditId]
          );
    } else {
      const db = getDb();
      row = (cleanOrderId
        ? db
            .prepare(`SELECT notes_json FROM payment_orders WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`)
            .get(cleanOrderId)
        : db
            .prepare(`SELECT notes_json FROM payment_orders WHERE receipt = ? ORDER BY created_at DESC LIMIT 1`)
            .get(cleanAuditId)) as { notes_json?: string | null } | undefined || null;
    }

    if (row?.notes_json) {
      const parsed = JSON.parse(row.notes_json);
      if (parsed?.source) {
        const clean = String(parsed.source).trim().toLowerCase();
        if ((ALLOWED_SITEFIX_SOURCES as readonly string[]).includes(clean)) {
          return clean as SiteFixLaunchSource;
        }
      }
    }
  } catch (err: any) {
    console.warn('[SiteFixFunnelAttribution] Failed to resolve stored order source:', err?.message || err);
  }

  return null;
}

export async function recordSiteFixFunnelEvent(params: {
  stage: SiteFixFunnelStage;
  source: SiteFixLaunchSource;
  isProbe: boolean;
  probeReason?: string | null;
  auditId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  url?: string | null;
  userAgent?: string | null;
  visitorHash?: string | null;
  authorizationMode?: 'SELF_DECLARED_AUTHORIZATION' | null;
}): Promise<SiteFixFunnelRecordResult> {
  const id = `sfx_evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const normalizedSource = normalizeSiteFixSource(params.source, 'web');
  const payload = {
    stage: params.stage,
    source: normalizedSource,
    isProbe: Boolean(params.isProbe),
    probeReason: params.probeReason || null,
    auditId: params.auditId || null,
    orderId: params.orderId || null,
    paymentId: params.paymentId || null,
    url: params.url || null,
    userAgent: params.userAgent ? String(params.userAgent).slice(0, 120) : null,
    visitorHash: params.visitorHash || hashFunnelVisitorKey(params.userAgent || params.orderId || params.auditId || id),
    authorizationMode: params.authorizationMode || null,
    recordedAt: new Date().toISOString()
  };

  const sql = `
    INSERT OR IGNORE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
    VALUES (?, ?, 'org_owner_primary', ?, datetime('now'))
  `;
  const sqlParams = [id, SITEFIX_FUNNEL_EVENT_TYPE, JSON.stringify(payload)];

  const d1Repo = D1RevenueRepository.getInstance();
  const useRemoteD1 = d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST;

  if (useRemoteD1) {
    try {
      await d1Repo.executeWrite('durable_events', sql, sqlParams);
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      recordFunnelWriteFailure('D1', params.stage, normalizedSource, errorMessage);
      return {
        persisted: false,
        storageStatus: 'WRITE_FAILED',
        error: errorMessage
      };
    }

    // Best-effort local SQLite cache mirror when D1 succeeded
    try {
      getDb().prepare(sql).run(...sqlParams);
    } catch (localErr: any) {
      console.warn(
        '[SiteFixFunnelAttribution] Local SQLite mirror write warning after D1 success:',
        localErr?.message || String(localErr)
      );
    }

    invalidateFunnelAttributionCache();
    return {
      persisted: true,
      storageStatus: 'PERSISTED_D1'
    };
  }

  try {
    getDb().prepare(sql).run(...sqlParams);
    invalidateFunnelAttributionCache();
    return {
      persisted: true,
      storageStatus: 'PERSISTED_LOCAL'
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    recordFunnelWriteFailure('LOCAL_SQLITE', params.stage, normalizedSource, errorMessage);
    return {
      persisted: false,
      storageStatus: 'WRITE_FAILED',
      error: errorMessage
    };
  }
}

export async function recordToolVisitSession(params: {
  source: SiteFixLaunchSource;
  landingPage: string;
  referrer?: string | null;
  userAgent?: string | null;
  clientIp?: string | null;
  isProbe: boolean;
  probeReason?: string | null;
  visitorHash?: string | null;
  sessionId?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
}): Promise<{
  recorded: boolean;
  isExternal: boolean;
  sessionId: string;
  d1Persisted: boolean;
  storageStatus: 'PERSISTED_D1' | 'FALLBACK_LOCAL_ONLY' | 'WRITE_FAILED';
}> {
  const isExternal = !params.isProbe;
  const trafficEvidenceStatus = isExternal ? 'VERIFIED_EXTERNAL' : 'TEST';
  const verificationReason = isExternal ? 'GENUINE_BROWSER_VISIT' : (params.probeReason || 'DIAGNOSTIC_OR_BOT_TRAFFIC');

  const id = `sess_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const sessionId = params.sessionId || id;
  const visitorId = params.visitorHash || hashFunnelVisitorKey(params.clientIp || params.userAgent || id);
  const normalizedSource = normalizeSiteFixSource(params.source, 'web');

  const sql = `
    INSERT INTO traffic_sessions (
      id, business_id, visitor_id, session_id, source, referrer, landing_page,
      timestamp, utm_source, utm_medium, utm_campaign, utm_content,
      traffic_evidence_status, ip_address, user_agent, is_external,
      verification_reason, created_at
    ) VALUES (?, 'biz_platform_aro', ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `;
  const sqlParams = [
    id,
    visitorId,
    sessionId,
    normalizedSource,
    params.referrer || '',
    params.landingPage,
    params.utmSource || null,
    params.utmMedium || null,
    params.utmCampaign || null,
    params.utmContent || null,
    trafficEvidenceStatus,
    params.clientIp || null,
    params.userAgent ? String(params.userAgent).slice(0, 255) : null,
    isExternal ? 1 : 0,
    verificationReason
  ];

  const d1Repo = D1RevenueRepository.getInstance();
  const useRemoteD1 = d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST;

  let d1Persisted = false;
  let storageStatus: 'PERSISTED_D1' | 'FALLBACK_LOCAL_ONLY' | 'WRITE_FAILED' = 'FALLBACK_LOCAL_ONLY';
  let recorded = false;

  if (useRemoteD1) {
    try {
      await d1Repo.executeWrite('traffic_sessions', sql, sqlParams);
      d1Persisted = true;
      storageStatus = 'PERSISTED_D1';
      recorded = true;
    } catch (err: any) {
      console.warn('[SiteFixFunnelAttribution] D1 traffic_sessions write error:', err.message);
      storageStatus = 'WRITE_FAILED';
    }
    try {
      getDb().prepare(sql).run(...sqlParams);
      if (!d1Persisted) {
        storageStatus = 'FALLBACK_LOCAL_ONLY';
        recorded = true;
      }
    } catch {}
  } else {
    try {
      getDb().prepare(sql).run(...sqlParams);
      storageStatus = 'FALLBACK_LOCAL_ONLY';
      recorded = true;
    } catch (err: any) {
      console.warn('[SiteFixFunnelAttribution] Local traffic_sessions write error:', err.message);
      storageStatus = 'WRITE_FAILED';
    }
  }

  // Record ONLY page_view event in durable_events (Stage U.1: stop logging preview_open on page load)
  await recordSiteFixFunnelEvent({
    stage: 'page_view',
    source: normalizedSource,
    isProbe: params.isProbe,
    probeReason: params.probeReason,
    url: params.landingPage,
    userAgent: params.userAgent,
    visitorHash: visitorId
  });

  invalidateFunnelAttributionCache();

  return {
    recorded,
    isExternal,
    sessionId,
    d1Persisted,
    storageStatus
  };
}

function buildPersistenceWarning(readError: string | null = null): string | null {
  const parts: string[] = [];
  if (funnelWriteFailureCount > 0) {
    parts.push(
      `${funnelWriteFailureCount} funnel event write failure(s) detected in current runtime` +
        (lastFunnelWriteFailureError ? ` (latest: ${lastFunnelWriteFailureError})` : '')
    );
  }
  if (readError) {
    parts.push(`Funnel attribution read failed: ${readError}`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

function aggregateFunnelRows(
  rows: Array<{ payload_json?: string | null }>,
  eventLimitReached: boolean,
  readError: string | null = null
): SiteFixFunnelAttributionSummary {
  const totals = emptyStageCounts();
  const bySource: Record<SiteFixLaunchSource, SiteFixFunnelStageCounts> = {
    cli: emptyStageCounts(),
    action: emptyStageCounts(),
    web: emptyStageCounts(),
    mcp: emptyStageCounts(),
    web_whatsapp_preview: emptyStageCounts(),
    web_open_graph: emptyStageCounts(),
    web_robots_sitemap: emptyStageCounts(),
    web_json_ld: emptyStageCounts()
  };
  const excludedBySource: Record<SiteFixLaunchSource, number> = {
    cli: 0,
    action: 0,
    web: 0,
    mcp: 0,
    web_whatsapp_preview: 0,
    web_open_graph: 0,
    web_robots_sitemap: 0,
    web_json_ld: 0
  };
  const totalFingerprints = new Set<string>();
  const fingerprintsBySource: Record<SiteFixLaunchSource, Set<string>> = {
    cli: new Set<string>(),
    action: new Set<string>(),
    web: new Set<string>(),
    mcp: new Set<string>(),
    web_whatsapp_preview: new Set<string>(),
    web_open_graph: new Set<string>(),
    web_robots_sitemap: new Set<string>(),
    web_json_ld: new Set<string>()
  };
  let excludedProbesCount = 0;

  for (const row of rows || []) {
    if (!row?.payload_json) continue;
    try {
      const parsed = JSON.parse(row.payload_json);
      const source = normalizeSiteFixSource(parsed?.source, 'web');
      const stage = parsed?.stage as SiteFixFunnelStage;
      const isProbe = Boolean(parsed?.isProbe);

      if (isProbe) {
        excludedProbesCount++;
        excludedBySource[source]++;
        continue;
      }

      const vHash =
        typeof parsed?.visitorHash === 'string' && parsed.visitorHash.trim()
          ? parsed.visitorHash.trim()
          : null;
      if (vHash) {
        totalFingerprints.add(vHash);
        fingerprintsBySource[source].add(vHash);
      }

      if (stage === 'page_view') {
        totals.page_view++;
        totals.externalPageViews++;
        bySource[source].page_view++;
        bySource[source].externalPageViews++;
      } else if (stage === 'scan_started' || stage === 'scan_attempt') {
        totals.scan_started++;
        totals.scanAttempts++;
        bySource[source].scan_started++;
        bySource[source].scanAttempts++;
      } else if (stage === 'scan_completed' || stage === 'scan') {
        totals.scan_completed++;
        totals.completedScans++;
        totals.scan++;
        bySource[source].scan_completed++;
        bySource[source].completedScans++;
        bySource[source].scan++;
      } else if (stage === 'preview_displayed' || stage === 'preview_open') {
        totals.preview_displayed++;
        totals.preview_open++;
        bySource[source].preview_displayed++;
        bySource[source].preview_open++;
      } else if (stage === 'order_created' || stage === 'checkout_start') {
        totals.order_created++;
        totals.checkout_start++;
        bySource[source].order_created++;
        bySource[source].checkout_start++;
      } else if (stage === 'checkout_modal_opened') {
        totals.checkout_modal_opened++;
        totals.checkout_start = Math.max(totals.checkout_start, totals.checkout_modal_opened);
        bySource[source].checkout_modal_opened++;
        bySource[source].checkout_start = Math.max(bySource[source].checkout_start, bySource[source].checkout_modal_opened);
      } else if (stage === 'payment_captured' || stage === 'capture') {
        totals.payment_captured++;
        totals.capture++;
        bySource[source].payment_captured++;
        bySource[source].capture++;
      } else if (stage === 'deliverable_ready' || stage === 'delivery') {
        totals.deliverable_ready++;
        totals.delivery++;
        totals.delivered++;
        bySource[source].deliverable_ready++;
        bySource[source].delivery++;
        bySource[source].delivered++;
      } else if (stage === 'email_delivered') {
        totals.email_delivered++;
        bySource[source].email_delivered++;
      }
    } catch {}
  }

  totals.distinctVisitorFingerprints = totalFingerprints.size;
  totals.distinctSessionFingerprints = totalFingerprints.size;
  for (const src of ALLOWED_SITEFIX_SOURCES) {
    bySource[src].distinctVisitorFingerprints = fingerprintsBySource[src].size;
    bySource[src].distinctSessionFingerprints = fingerprintsBySource[src].size;
    // If historical scan rows exist without separate scan_started events, ensure scanAttempts >= completedScans
    if (bySource[src].scanAttempts < bySource[src].completedScans) {
      bySource[src].scanAttempts = bySource[src].completedScans;
      bySource[src].scan_started = bySource[src].completedScans;
    }
  }
  if (totals.scanAttempts < totals.completedScans) {
    totals.scanAttempts = totals.completedScans;
    totals.scan_started = totals.completedScans;
  }

  return {
    reportingWindow: SITEFIX_FUNNEL_REPORTING_WINDOW,
    eventLimitReached,
    eventsSampled: (rows || []).length,
    funnelWriteFailureCount,
    persistenceWarning: buildPersistenceWarning(readError),
    totals,
    bySource,
    excludedProbesCount,
    excludedBySource
  };
}

let funnelAttributionGeneration = 0;
let funnelAttributionCache: { data: SiteFixFunnelAttributionSummary; expiresAt: number } | null = null;
let inFlightSummaryPromise: Promise<SiteFixFunnelAttributionSummary> | null = null;

export function invalidateFunnelAttributionCache(): void {
  funnelAttributionCache = null;
  inFlightSummaryPromise = null;
  funnelAttributionGeneration++;
}

export function resetSiteFixFunnelAttributionCacheForTesting(): void {
  funnelAttributionCache = null;
  inFlightSummaryPromise = null;
  funnelAttributionGeneration++;
}

export function getSiteFixFunnelAttributionSummarySync(): SiteFixFunnelAttributionSummary {
  try {
    const rawRows = getDb()
      .prepare(
        `SELECT payload_json FROM durable_events WHERE event_type = ? AND created_at >= datetime('now', '-90 days') ORDER BY created_at DESC LIMIT ${SITEFIX_FUNNEL_WINDOW_LIMIT + 1}`
      )
      .all(SITEFIX_FUNNEL_EVENT_TYPE) as Array<{ payload_json?: string | null }>;
    const eventLimitReached = rawRows.length > SITEFIX_FUNNEL_WINDOW_LIMIT;
    const rows = eventLimitReached ? rawRows.slice(0, SITEFIX_FUNNEL_WINDOW_LIMIT) : rawRows;
    return aggregateFunnelRows(rows, eventLimitReached);
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    console.warn('[SiteFixFunnelAttribution] Sync summary read failed:', errorMessage);
    return aggregateFunnelRows([], false, errorMessage);
  }
}

export async function getSiteFixFunnelAttributionSummaryAsync(
  d1Repo: D1RevenueRepository = D1RevenueRepository.getInstance()
): Promise<SiteFixFunnelAttributionSummary> {
  const shouldCache = !process.env.VITEST || process.env.ALLOW_D1_CACHE_IN_TEST === 'true';
  if (shouldCache && funnelAttributionCache && Date.now() < funnelAttributionCache.expiresAt) {
    return funnelAttributionCache.data;
  }

  if (inFlightSummaryPromise) {
    return inFlightSummaryPromise;
  }

  const generationAtStart = funnelAttributionGeneration;
  const executeSummary = async (): Promise<SiteFixFunnelAttributionSummary> => {
    if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
      try {
        const rawRows = await d1Repo.query<{ payload_json?: string | null }>(
          'durable_events',
          `SELECT payload_json FROM durable_events WHERE event_type = ? AND created_at >= datetime('now', '-90 days') ORDER BY created_at DESC LIMIT ${SITEFIX_FUNNEL_WINDOW_LIMIT + 1}`,
          [SITEFIX_FUNNEL_EVENT_TYPE]
        );
        const eventLimitReached = rawRows.length > SITEFIX_FUNNEL_WINDOW_LIMIT;
        const rows = eventLimitReached ? rawRows.slice(0, SITEFIX_FUNNEL_WINDOW_LIMIT) : rawRows;
        const result = aggregateFunnelRows(rows, eventLimitReached);
        if (shouldCache && generationAtStart === funnelAttributionGeneration) {
          funnelAttributionCache = {
            data: result,
            expiresAt: Date.now() + 10 * 60 * 1000 // 10-minute cache
          };
        }
        return result;
      } catch (err: any) {
        const errorMessage = err?.message || String(err);
        console.warn('[SiteFixFunnelAttribution] Remote D1 summary read failed, falling back to local SQLite:', errorMessage);
        const fallback = getSiteFixFunnelAttributionSummarySync();
        return {
          ...fallback,
          persistenceWarning: buildPersistenceWarning(`D1 read failed (${errorMessage}); showing local fallback`)
        };
      }
    }
    const syncResult = getSiteFixFunnelAttributionSummarySync();
    if (shouldCache && !syncResult.persistenceWarning && generationAtStart === funnelAttributionGeneration) {
      funnelAttributionCache = {
        data: syncResult,
        expiresAt: Date.now() + 10 * 60 * 1000 // 10-minute cache
      };
    }
    return syncResult;
  };

  const currentPromise = executeSummary();
  inFlightSummaryPromise = currentPromise;
  try {
    return await currentPromise;
  } finally {
    if (inFlightSummaryPromise === currentPromise) {
      inFlightSummaryPromise = null;
    }
  }
}
