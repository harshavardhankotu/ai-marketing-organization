import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/client.js';
import { isProduction } from '../../config/env.js';
import { D1RevenueRepository } from '../../db/d1-revenue-repository.js';

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
  | 'scan'
  | 'preview_open'
  | 'checkout_start'
  | 'capture'
  | 'delivery';

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

const REPO_CI_AND_PROBE_UA_REGEX =
  /github-actions|ai-marketing-organization-ci|sitefix-ci-probe|sitefix-diagnostic|diagnostic-probe|curl\/|wget\/|httpie\/|vitest|node-fetch|undici/i;

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
    if (typeof reqLike === 'object') {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(reqLike)) {
        if (k.toLowerCase() === lower && v != null) {
          return String(v).trim();
        }
      }
    }
  } catch {}
  return '';
}

/**
 * Classifies whether a request is an internal diagnostic probe or repository CI run
 * that must be excluded from external funnel metrics on /api/v1/owner/today.
 */
export function classifySiteFixProbe(reqLike: any): {
  isProbe: boolean;
  probeReason: string | null;
  userAgent: string;
} {
  const probeHeader = readHeader(reqLike, 'x-diagnostic-probe');
  const userAgent = readHeader(reqLike, 'user-agent');

  if (
    probeHeader &&
    probeHeader.toLowerCase() !== 'false' &&
    probeHeader !== '0'
  ) {
    return {
      isProbe: true,
      probeReason: `X-Diagnostic-Probe:${probeHeader.slice(0, 64)}`,
      userAgent
    };
  }

  if (userAgent && REPO_CI_AND_PROBE_UA_REGEX.test(userAgent)) {
    return {
      isProbe: true,
      probeReason: `CI_OR_PROBE_UA:${userAgent.slice(0, 80)}`,
      userAgent
    };
  }

  return {
    isProbe: false,
    probeReason: null,
    userAgent
  };
}

export interface SiteFixFunnelStageCounts {
  scan: number;
  preview_open: number;
  checkout_start: number;
  capture: number;
  delivery: number;
}

export interface SiteFixFunnelAttributionSummary {
  totals: SiteFixFunnelStageCounts;
  bySource: Record<SiteFixLaunchSource, SiteFixFunnelStageCounts>;
  excludedProbesCount: number;
  excludedBySource: Record<SiteFixLaunchSource, number>;
}

function emptyStageCounts(): SiteFixFunnelStageCounts {
  return {
    scan: 0,
    preview_open: 0,
    checkout_start: 0,
    capture: 0,
    delivery: 0
  };
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
}): Promise<void> {
  const id = `sfx_evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const payload = {
    stage: params.stage,
    source: normalizeSiteFixSource(params.source, 'web'),
    isProbe: Boolean(params.isProbe),
    probeReason: params.probeReason || null,
    auditId: params.auditId || null,
    orderId: params.orderId || null,
    paymentId: params.paymentId || null,
    url: params.url || null,
    userAgent: params.userAgent ? String(params.userAgent).slice(0, 120) : null,
    recordedAt: new Date().toISOString()
  };

  const sql = `
    INSERT OR IGNORE INTO durable_events (id, event_type, organization_id, payload_json, created_at)
    VALUES (?, ?, 'org_owner_primary', ?, datetime('now'))
  `;
  const sqlParams = [id, SITEFIX_FUNNEL_EVENT_TYPE, JSON.stringify(payload)];

  try {
    getDb().prepare(sql).run(...sqlParams);
  } catch {}

  try {
    const d1Repo = D1RevenueRepository.getInstance();
    if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
      await d1Repo.executeWrite('durable_events', sql, sqlParams);
    }
  } catch {}
}

function aggregateFunnelRows(rows: Array<{ payload_json?: string | null }>): SiteFixFunnelAttributionSummary {
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

      if (stage in totals) {
        totals[stage]++;
        bySource[source][stage]++;
      }
    } catch {}
  }

  return {
    totals,
    bySource,
    excludedProbesCount,
    excludedBySource
  };
}

export function getSiteFixFunnelAttributionSummarySync(): SiteFixFunnelAttributionSummary {
  try {
    const rows = getDb()
      .prepare(
        `SELECT payload_json FROM durable_events WHERE event_type = ? ORDER BY created_at DESC LIMIT 5000`
      )
      .all(SITEFIX_FUNNEL_EVENT_TYPE) as Array<{ payload_json?: string | null }>;
    return aggregateFunnelRows(rows);
  } catch {
    return aggregateFunnelRows([]);
  }
}

export async function getSiteFixFunnelAttributionSummaryAsync(
  d1Repo: D1RevenueRepository = D1RevenueRepository.getInstance()
): Promise<SiteFixFunnelAttributionSummary> {
  if (d1Repo.isRemoteD1Configured() && isProduction() && !process.env.VITEST) {
    try {
      const rows = await d1Repo.query<{ payload_json?: string | null }>(
        'durable_events',
        `SELECT payload_json FROM durable_events WHERE event_type = ? ORDER BY created_at DESC LIMIT 5000`,
        [SITEFIX_FUNNEL_EVENT_TYPE]
      );
      return aggregateFunnelRows(rows);
    } catch {}
  }
  return getSiteFixFunnelAttributionSummarySync();
}
