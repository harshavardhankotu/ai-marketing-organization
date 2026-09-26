/**
 * ActionCooldownManager — prevents rapid repeated execution of the same action.
 *
 * Spec §19: Action Cooldowns.
 * Each action type has a cooldown policy. A 15-minute cron MUST NOT
 * trigger a follow-up every 15 minutes.
 *
 * Cooldown escalation for FOLLOW_UP:
 *   attempt 1 → +24h
 *   attempt 2 → +48h
 *   attempt 3 → +72h
 *   then STOP / escalate
 *
 * Stored in SQLite table `action_cooldowns` (created below) so it survives restarts.
 */

import { getDb } from '../db/client.js';
import type { ActionType } from './next-best-action-engine.js';

export interface CooldownPolicy {
  maxAttempts: number;
  /** Hours between attempts at each attempt index (escalating) */
  cooldownHoursPerAttempt: number[];
  escalateAfterMax: 'STOP' | 'ESCALATE';
}

export interface CooldownState {
  targetId: string;
  actionType: string;
  attemptCount: number;
  lastExecutedAt: string;
  nextEligibleAt: string;
  maxAttempts: number;
  exhausted: boolean;
  escalated: boolean;
}

export interface CooldownCheckResult {
  eligible: boolean;
  reason: string;
  attemptCount: number;
  nextEligibleAt?: string;
  exhausted: boolean;
}

const COOLDOWN_POLICIES: Record<ActionType, CooldownPolicy> = {
  FOLLOW_UP_LEAD: {
    maxAttempts: 3,
    cooldownHoursPerAttempt: [24, 48, 72],
    escalateAfterMax: 'STOP'
  },
  COLLECT_PAYMENT: {
    maxAttempts: 4,
    cooldownHoursPerAttempt: [24, 48, 72, 96],
    escalateAfterMax: 'ESCALATE'
  },
  PURSUE_OPPORTUNITY: {
    maxAttempts: 5,
    cooldownHoursPerAttempt: [24, 48, 72, 96, 120],
    escalateAfterMax: 'STOP'
  },
  SEND_PAYMENT_REQUEST: {
    maxAttempts: 3,
    cooldownHoursPerAttempt: [48, 72, 96],
    escalateAfterMax: 'STOP'
  },
  BOOK_MEETING: {
    maxAttempts: 3,
    cooldownHoursPerAttempt: [24, 48, 72],
    escalateAfterMax: 'STOP'
  },
  ONBOARD_CUSTOMER: {
    maxAttempts: 1,
    cooldownHoursPerAttempt: [0],
    escalateAfterMax: 'STOP'
  },
  REQUEST_REFERRAL: {
    maxAttempts: 2,
    cooldownHoursPerAttempt: [168, 336], // 1 week, 2 weeks
    escalateAfterMax: 'STOP'
  },
  DISCOVER_PROSPECTS: {
    maxAttempts: 999,
    cooldownHoursPerAttempt: [6],  // min 6h between discovery runs
    escalateAfterMax: 'STOP'
  },
  RUN_RESEARCH: {
    maxAttempts: 999,
    cooldownHoursPerAttempt: [24], // min 24h between research runs per business
    escalateAfterMax: 'STOP'
  },
  EVALUATE_EXPERIMENT: {
    maxAttempts: 999,
    cooldownHoursPerAttempt: [1],
    escalateAfterMax: 'STOP'
  },
  IDLE: {
    maxAttempts: 999,
    cooldownHoursPerAttempt: [0],
    escalateAfterMax: 'STOP'
  }
};

export class ActionCooldownManager {
  /**
   * Check if an action is eligible to run.
   * Does NOT increment attempt count — call recordExecution() after the action runs.
   */
  public static check(targetId: string, actionType: ActionType): CooldownCheckResult {
    const db = getDb();
    const now = new Date().toISOString();
    const policy = COOLDOWN_POLICIES[actionType];

    const row = db.prepare(`
      SELECT * FROM action_cooldowns WHERE target_id = ? AND action_type = ?
    `).get(targetId, actionType) as any;

    if (!row) {
      // No record — first attempt, eligible
      return { eligible: true, reason: 'FIRST_ATTEMPT', attemptCount: 0, exhausted: false };
    }

    const state = row as CooldownState;

    if (state.exhausted) {
      return {
        eligible: false,
        reason: `MAX_ATTEMPTS_REACHED: ${state.attemptCount}/${policy.maxAttempts} attempts exhausted`,
        attemptCount: state.attemptCount,
        nextEligibleAt: undefined,
        exhausted: true
      };
    }

    if (row.next_eligible_at > now) {
      return {
        eligible: false,
        reason: `COOLDOWN_ACTIVE: next eligible at ${row.next_eligible_at}`,
        attemptCount: row.attempt_count,
        nextEligibleAt: row.next_eligible_at,
        exhausted: false
      };
    }

    return {
      eligible: true,
      reason: 'COOLDOWN_ELAPSED',
      attemptCount: row.attempt_count,
      exhausted: false
    };
  }

  /**
   * Record that an action was executed (successfully or not).
   * Increments attempt count and sets the next eligible time.
   */
  public static recordExecution(targetId: string, actionType: ActionType, succeeded: boolean): void {
    const db = getDb();
    const policy = COOLDOWN_POLICIES[actionType];
    const now = new Date().toISOString();

    const row = db.prepare(`
      SELECT * FROM action_cooldowns WHERE target_id = ? AND action_type = ?
    `).get(targetId, actionType) as any;

    const currentAttempt = (row?.attempt_count || 0) + 1;
    const attemptIndex = Math.min(currentAttempt - 1, policy.cooldownHoursPerAttempt.length - 1);
    const cooldownHours = policy.cooldownHoursPerAttempt[attemptIndex];
    const nextEligibleAt = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString();
    const exhausted = currentAttempt >= policy.maxAttempts && policy.escalateAfterMax === 'STOP' ? 1 : 0;
    const escalated = currentAttempt >= policy.maxAttempts && policy.escalateAfterMax === 'ESCALATE' ? 1 : 0;

    db.prepare(`
      INSERT INTO action_cooldowns (
        target_id, action_type, attempt_count, last_executed_at, next_eligible_at,
        max_attempts, exhausted, escalated, last_succeeded, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_id, action_type) DO UPDATE SET
        attempt_count = ?,
        last_executed_at = ?,
        next_eligible_at = ?,
        exhausted = ?,
        escalated = ?,
        last_succeeded = ?,
        updated_at = ?
    `).run(
      targetId, actionType, currentAttempt, now, nextEligibleAt,
      policy.maxAttempts, exhausted, escalated, succeeded ? 1 : 0, now,
      // ON CONFLICT SET
      currentAttempt, now, nextEligibleAt, exhausted, escalated, succeeded ? 1 : 0, now
    );
  }

  /**
   * Reset cooldown for a target (e.g., after a successful payment resets follow-up count).
   */
  public static reset(targetId: string, actionType: ActionType): void {
    getDb().prepare(`
      DELETE FROM action_cooldowns WHERE target_id = ? AND action_type = ?
    `).run(targetId, actionType);
  }

  /**
   * Get full cooldown state for a target+action.
   */
  public static getState(targetId: string, actionType: ActionType): CooldownState | null {
    const row = getDb().prepare(`
      SELECT * FROM action_cooldowns WHERE target_id = ? AND action_type = ?
    `).get(targetId, actionType) as any;
    if (!row) return null;
    return {
      targetId: row.target_id,
      actionType: row.action_type,
      attemptCount: row.attempt_count,
      lastExecutedAt: row.last_executed_at,
      nextEligibleAt: row.next_eligible_at,
      maxAttempts: row.max_attempts,
      exhausted: row.exhausted === 1,
      escalated: row.escalated === 1
    };
  }
}
