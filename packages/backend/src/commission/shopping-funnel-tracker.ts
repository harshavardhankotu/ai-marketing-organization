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
