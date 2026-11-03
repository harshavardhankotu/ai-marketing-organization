import { isProduction } from '../config/env.js';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';

export interface B2BBacklogGuardResult {
  allowed: boolean;
  unapprovedCount: number;
  maxLimit: number;
  reason?: string;
  message?: string;
}

/**
 * Parses and validates the unapproved drafts threshold from environment variables.
 * Safely rejects NaN, Infinity, <= 0, and non-integer values by falling back to 10.
 */
export function getValidatedBacklogLimit(): number {
  const rawEnv = process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS || process.env.MAX_UNAPPROVED_DRAFTS;
  if (rawEnv === undefined || rawEnv === null || String(rawEnv).trim() === '') {
    return 10;
  }
  const parsed = Number(rawEnv);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return 10;
  }
  return parsed;
}

/**
 * Pre-execution budget guard (§ Phase 1 / Phase 2).
 * Inspects unapproved outreach drafts before any LLM or search provider call is made.
 * Strictly fails closed: on any database read error, null, or malformed result,
 * returns allowed: false with reason 'BACKLOG_COUNT_UNAVAILABLE'.
 * When unapprovedDrafts >= maxLimit, halts further research and draft creation.
 */
export async function checkB2BResearchBacklogGuard(
  d1Repo?: D1RevenueRepository
): Promise<B2BBacklogGuardResult> {
  const maxLimit = getValidatedBacklogLimit();
  const repo = d1Repo || D1RevenueRepository.getInstance();
  const sql = `SELECT COUNT(*) as cnt FROM direct_outreach_log WHERE human_approved = 0 AND dispatched = 0`;

  let unapprovedCount: number | null = null;
  try {
    if (isProduction() || process.env.NODE_ENV === 'test') {
      const row = await repo.queryOne<{ cnt: number }>('direct_outreach_log', sql);
      if (row !== null && row !== undefined && typeof row.cnt === 'number' && !isNaN(row.cnt)) {
        unapprovedCount = row.cnt;
      } else if (row !== null && row !== undefined && row.cnt !== null && row.cnt !== undefined) {
        const parsed = Number(row.cnt);
        if (Number.isFinite(parsed)) {
          unapprovedCount = parsed;
        }
      }
    } else {
      const row = getDb().prepare(sql).get() as { cnt: number } | undefined;
      if (row !== null && row !== undefined && typeof row.cnt === 'number' && !isNaN(row.cnt)) {
        unapprovedCount = row.cnt;
      } else if (row !== null && row !== undefined && row.cnt !== null && row.cnt !== undefined) {
        const parsed = Number(row.cnt);
        if (Number.isFinite(parsed)) {
          unapprovedCount = parsed;
        }
      }
    }
  } catch (err: any) {
    const rawMsg = err?.message || 'Database read error';
    const sanitizedMsg = rawMsg.replace(/([?&](?:key|token|auth|secret)=)[^&]+/gi, '$1[REDACTED]');
    console.warn(`[B2BBacklogGuard] Error reading direct_outreach_log: ${sanitizedMsg}`);
    unapprovedCount = null;
  }

  // Strict Fail-Closed Guarantee: Never interpret a failed, null, or malformed DB read as 0 drafts
  if (unapprovedCount === null) {
    return {
      allowed: false,
      unapprovedCount: -1,
      maxLimit,
      reason: 'BACKLOG_COUNT_UNAVAILABLE',
      message: 'Failed to verify unapproved outreach draft count; failing closed to protect search/LLM budget.'
    };
  }

  if (unapprovedCount >= maxLimit) {
    return {
      allowed: false,
      unapprovedCount,
      maxLimit,
      reason: 'UNAPPROVED_DRAFTS_BACKLOG_EXCEEDED',
      message: `Halting prospect research and draft generation: ${unapprovedCount} unapproved draft(s) pending owner review (limit: ${maxLimit}). Review at /owner/today.`
    };
  }

  return {
    allowed: true,
    unapprovedCount,
    maxLimit
  };
}
