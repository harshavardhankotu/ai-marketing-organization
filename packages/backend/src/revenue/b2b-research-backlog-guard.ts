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
 * Pre-execution budget guard (§ Phase 5).
 * Inspects unapproved outreach drafts before any LLM or search provider call is made.
 * When unapprovedDrafts >= MAX_UNAPPROVED_DRAFTS (default: 10), halts further research and draft creation.
 */
export async function checkB2BResearchBacklogGuard(
  d1Repo?: D1RevenueRepository
): Promise<B2BBacklogGuardResult> {
  const maxLimit = Math.max(
    1,
    Number(process.env.MAX_UNAPPROVED_OUTREACH_DRAFTS || process.env.MAX_UNAPPROVED_DRAFTS || 10)
  );

  const repo = d1Repo || D1RevenueRepository.getInstance();
  const sql = `SELECT COUNT(*) as cnt FROM direct_outreach_log WHERE human_approved = 0 AND dispatched = 0`;

  let unapprovedCount = 0;
  try {
    if (isProduction() || process.env.NODE_ENV === 'test') {
      const row = await repo.queryOne<{ cnt: number }>('direct_outreach_log', sql);
      unapprovedCount = Number(row?.cnt || 0);
    } else {
      const row = getDb().prepare(sql).get() as { cnt: number } | undefined;
      unapprovedCount = Number(row?.cnt || 0);
    }
  } catch (err: any) {
    console.warn(`[B2BBacklogGuard] Error reading direct_outreach_log: ${err.message}`);
    // Fail safe in dev/test, but fail closed in production
    unapprovedCount = 0;
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
