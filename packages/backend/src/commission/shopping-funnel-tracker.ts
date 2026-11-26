import { randomUUID } from 'crypto';
import { classifyTraffic } from './referral-tracking.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { getDb } from '../db/client.js';
import { isProduction } from '../config/env.js';
import { OwnerAuthService } from '../auth/owner-auth.js';

export type ShoppingFunnelEventName =
  | 'shopping_page_view'
  | 'preference_submitted'
  | 'recommendation_shown'
  | 'recommendation_click'
  | 'affiliate_redirect';

export interface ShoppingFunnelEventInput {
  event: ShoppingFunnelEventName;
  path?: string;
  query?: string;
  dealId?: string;
  slot?: string;
  metadata?: Record<string, unknown>;
  userAgent?: string;
  clientIp?: string;
  headers?: Record<string, string | undefined>;
}

/**
 * Records clean non-test shopper funnel events into existing `durable_events` table
 * (zero new tables or migrations). Skips internal diagnostic, test, and bot traffic.
 */
export async function recordShoppingFunnelEvent(input: ShoppingFunnelEventInput): Promise<{ recorded: boolean; reason?: string }> {
  const trafficClass = classifyTraffic(input.userAgent || '', input.clientIp || '', {
    'x-diagnostic': input.headers?.['x-diagnostic'] || '',
    'x-diagnostic-probe': input.headers?.['x-diagnostic-probe'] || '',
    'x-test-traffic': input.headers?.['x-test-traffic'] || '',
    'x-owner-preview': input.headers?.['x-owner-preview'] || ''
  });

  if (trafficClass !== 'human' && trafficClass !== 'browser_candidate') {
    return { recorded: false, reason: `SKIPPED_${trafficClass}` };
  }

  const id = `sf_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;
  const payload = JSON.stringify({
    event: input.event,
    path: input.path || null,
    query: input.query ? input.query.slice(0, 200) : null,
    dealId: input.dealId || null,
    slot: input.slot || null,
    trafficClass,
    ...(input.metadata || {})
  });

  const sql = `
    INSERT INTO durable_events (
      id, event_type, business_id, organization_id, payload_json, processed, processed_at, created_at
    ) VALUES (?, ?, 'biz_platform_aro', ?, ?, 1, datetime('now'), datetime('now'))
  `;

  try {
    const d1Repo = D1RevenueRepository.getInstance();
    if (d1Repo.isRemoteD1Configured() || (isProduction() && !process.env.VITEST)) {
      await d1Repo.executeWrite('durable_events', sql, [id, input.event, orgId, payload]);
    } else {
      getDb().prepare(sql).run(id, input.event, orgId, payload);
    }
    return { recorded: true };
  } catch (err: any) {
    return { recorded: false, reason: err?.message || 'DB_UNAVAILABLE' };
  }
}

export interface ShoppingFunnelCounts {
  shopping_page_view: number;
  preference_submitted: number;
  recommendation_shown: number;
  recommendation_click: number;
  affiliate_redirect: number;
}

export interface ShoppingFunnelSummary {
  window24h: ShoppingFunnelCounts;
  window7d: ShoppingFunnelCounts;
}

const EMPTY_COUNTS = (): ShoppingFunnelCounts => ({
  shopping_page_view: 0,
  preference_submitted: 0,
  recommendation_shown: 0,
  recommendation_click: 0,
  affiliate_redirect: 0
});

/**
 * Aggregates clean human/browser shopping funnel counts (24h and 7d) from existing `durable_events`
 * (zero new tables/migrations), excluding bot/test/diagnostic traffic.
 */
export async function getShoppingFunnelSummaryAsync(): Promise<ShoppingFunnelSummary> {
  const window24h = EMPTY_COUNTS();
  const window7d = EMPTY_COUNTS();
  const events: ShoppingFunnelEventName[] = [
    'shopping_page_view',
    'preference_submitted',
    'recommendation_shown',
    'recommendation_click',
    'affiliate_redirect'
  ];
  const placeholders = events.map(() => '?').join(', ');
  const sql = `
    SELECT
      event_type,
      SUM(CASE WHEN created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS cnt_24h,
      COUNT(*) AS cnt_7d
    FROM durable_events
    WHERE event_type IN (${placeholders})
      AND created_at >= datetime('now', '-7 days')
      AND COALESCE(payload_json, '') NOT LIKE '%"trafficClass":"test"%'
      AND COALESCE(payload_json, '') NOT LIKE '%"trafficClass":"diagnostic"%'
      AND COALESCE(payload_json, '') NOT LIKE '%"trafficClass":"internal"%'
      AND COALESCE(payload_json, '') NOT LIKE '%"trafficClass":"known_bot"%'
      AND COALESCE(payload_json, '') NOT LIKE '%"trafficClass":"suspected_bot"%'
    GROUP BY event_type
  `;
  try {
    const d1Repo = D1RevenueRepository.getInstance();
    const rows = d1Repo.isRemoteD1Configured() || (isProduction() && !process.env.VITEST)
      ? await d1Repo.query<any>('durable_events', sql, events)
      : (getDb().prepare(sql).all(...events) as any[]);
    for (const row of rows || []) {
      const ev = String(row?.event_type || '') as ShoppingFunnelEventName;
      if (ev in window24h) {
        window24h[ev] = Number(row?.cnt_24h || 0);
        window7d[ev] = Number(row?.cnt_7d || 0);
      }
    }
  } catch {}
  return { window24h, window7d };
}
