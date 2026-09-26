/**
 * BusinessAutonomyLock — prevents two ARO cycles from running concurrently
 * for the same business. Stored in SQLite so it survives in-memory loss.
 *
 * If a second wake fires while a cycle is active, it returns CYCLE_ALREADY_RUNNING.
 * Leases auto-expire after 10 minutes to guard against crashed cycles
 * that never released their lock.
 *
 * Spec §21: Concurrency Lock
 */

import { getDb } from '../db/client.js';

const LOCK_LEASE_MINUTES = 10;

export interface LockResult {
  acquired: boolean;
  reason?: string;
  lockOwner?: string;
  lockedAt?: string;
  leaseExpiry?: string;
}

export class BusinessAutonomyLock {
  /**
   * Try to acquire the lock for a business.
   * Returns { acquired: true } if successful, { acquired: false } otherwise.
   */
  public static tryAcquire(businessId: string, cycleId: string): LockResult {
    const db = getDb();
    const now = new Date().toISOString();
    const leaseExpiry = new Date(Date.now() + LOCK_LEASE_MINUTES * 60 * 1000).toISOString();

    // Check for existing live lock
    const existing = db.prepare(`
      SELECT * FROM business_autonomy_lock WHERE business_id = ?
    `).get(businessId) as any;

    if (existing) {
      // Check if lease is expired (crashed cycle)
      if (existing.lease_expiry > now) {
        return {
          acquired: false,
          reason: `CYCLE_ALREADY_RUNNING: cycle ${existing.lock_owner} holds lock until ${existing.lease_expiry}`,
          lockOwner: existing.lock_owner,
          lockedAt: existing.locked_at,
          leaseExpiry: existing.lease_expiry
        };
      }
      // Stale lock — expired lease, clear it
      console.warn(`[BusinessAutonomyLock] Clearing stale lock for ${businessId} (expired ${existing.lease_expiry})`);
      db.prepare(`DELETE FROM business_autonomy_lock WHERE business_id = ?`).run(businessId);
    }

    // Acquire fresh lock
    db.prepare(`
      INSERT OR REPLACE INTO business_autonomy_lock (business_id, locked_at, lock_owner, lease_expiry)
      VALUES (?, ?, ?, ?)
    `).run(businessId, now, cycleId, leaseExpiry);

    return { acquired: true, lockOwner: cycleId, lockedAt: now, leaseExpiry };
  }

  /**
   * Release the lock. Only the owner may release.
   */
  public static release(businessId: string, cycleId: string): void {
    const db = getDb();
    const lock = db.prepare(`SELECT lock_owner FROM business_autonomy_lock WHERE business_id = ?`).get(businessId) as any;
    if (lock && lock.lock_owner === cycleId) {
      db.prepare(`DELETE FROM business_autonomy_lock WHERE business_id = ?`).run(businessId);
    }
  }

  /**
   * Force-release (admin use only). Clears any lock regardless of owner.
   */
  public static forceRelease(businessId: string): void {
    getDb().prepare(`DELETE FROM business_autonomy_lock WHERE business_id = ?`).run(businessId);
  }

  /**
   * Check if locked without trying to acquire.
   */
  public static isLocked(businessId: string): boolean {
    const db = getDb();
    const now = new Date().toISOString();
    const lock = db.prepare(`
      SELECT lease_expiry FROM business_autonomy_lock WHERE business_id = ? AND lease_expiry > ?
    `).get(businessId, now) as any;
    return !!lock;
  }
}
