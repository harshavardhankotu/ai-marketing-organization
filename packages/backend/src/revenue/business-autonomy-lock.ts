/**
 * BusinessAutonomyLock — prevents two ARO cycles from running concurrently
 * for the same business. Stored in D1 (production) or SQLite (dev/test) so it survives in-memory loss.
 *
 * If a second wake fires while a cycle is active, it returns CYCLE_ALREADY_RUNNING.
 * Leases auto-expire after 10 minutes to guard against crashed cycles
 * that never released their lock.
 *
 * Spec §21: Concurrency Lock
 * Persistence: Cloudflare D1 authoritative in production, SQLite in dev/test. Zero getDb() import.
 */

import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

const LOCK_LEASE_MINUTES = 10;

export interface LockResult {
  acquired: boolean;
  reason?: string;
  lockOwner?: string;
  lockedAt?: string;
  leaseExpiry?: string;
}

export class BusinessAutonomyLock {
  private static d1Repo = D1RevenueRepository.getInstance();

  /**
   * Asynchronously acquire the lock for a business (production-safe Cloudflare D1 execution).
   */
  public static async tryAcquireAsync(businessId: string, cycleId: string): Promise<LockResult> {
    const now = new Date().toISOString();
    const leaseExpiry = new Date(Date.now() + LOCK_LEASE_MINUTES * 60 * 1000).toISOString();

    const existing = await BusinessAutonomyLock.d1Repo.queryOne(
      'business_autonomy_lock',
      `SELECT * FROM business_autonomy_lock WHERE business_id = ?`,
      [businessId]
    );

    if (existing) {
      if (existing.lease_expiry > now) {
        return {
          acquired: false,
          reason: `CYCLE_ALREADY_RUNNING: cycle ${existing.lock_owner} holds lock until ${existing.lease_expiry}`,
          lockOwner: existing.lock_owner,
          lockedAt: existing.locked_at,
          leaseExpiry: existing.lease_expiry
        };
      }
      console.warn(`[BusinessAutonomyLock] Clearing stale lock for ${businessId} (expired ${existing.lease_expiry})`);
      await BusinessAutonomyLock.d1Repo.executeWrite(
        'business_autonomy_lock',
        `DELETE FROM business_autonomy_lock WHERE business_id = ?`,
        [businessId]
      );
    }

    await BusinessAutonomyLock.d1Repo.executeWrite(
      'business_autonomy_lock',
      `INSERT OR REPLACE INTO business_autonomy_lock (business_id, locked_at, lock_owner, lease_expiry)
       VALUES (?, ?, ?, ?)`,
      [businessId, now, cycleId, leaseExpiry]
    );

    return { acquired: true, lockOwner: cycleId, lockedAt: now, leaseExpiry };
  }

  /**
   * Try to acquire the lock for a business.
   * Synchronous for dev/test runners; fails closed in production.
   */
  public static tryAcquire(businessId: string, cycleId: string): LockResult {
    if (isProduction() && !process.env.VITEST) {
      throw new Error('PRODUCTION D1 ERROR: Synchronous BusinessAutonomyLock.tryAcquire is not permitted in production. Use tryAcquireAsync.');
    }

    const now = new Date().toISOString();
    const leaseExpiry = new Date(Date.now() + LOCK_LEASE_MINUTES * 60 * 1000).toISOString();

    const existing = BusinessAutonomyLock.d1Repo.queryOneSync(
      'business_autonomy_lock',
      `SELECT * FROM business_autonomy_lock WHERE business_id = ?`,
      [businessId]
    );

    if (existing) {
      if (existing.lease_expiry > now) {
        return {
          acquired: false,
          reason: `CYCLE_ALREADY_RUNNING: cycle ${existing.lock_owner} holds lock until ${existing.lease_expiry}`,
          lockOwner: existing.lock_owner,
          lockedAt: existing.locked_at,
          leaseExpiry: existing.lease_expiry
        };
      }
      console.warn(`[BusinessAutonomyLock] Clearing stale lock for ${businessId} (expired ${existing.lease_expiry})`);
      BusinessAutonomyLock.d1Repo.executeSync(
        'business_autonomy_lock',
        `DELETE FROM business_autonomy_lock WHERE business_id = ?`,
        [businessId]
      );
    }

    BusinessAutonomyLock.d1Repo.executeSync(
      'business_autonomy_lock',
      `INSERT OR REPLACE INTO business_autonomy_lock (business_id, locked_at, lock_owner, lease_expiry)
       VALUES (?, ?, ?, ?)`,
      [businessId, now, cycleId, leaseExpiry]
    );

    return { acquired: true, lockOwner: cycleId, lockedAt: now, leaseExpiry };
  }

  /**
   * Asynchronously release the lock.
   */
  public static async releaseAsync(businessId: string, cycleId: string): Promise<void> {
    const lock = await BusinessAutonomyLock.d1Repo.queryOne(
      'business_autonomy_lock',
      `SELECT lock_owner FROM business_autonomy_lock WHERE business_id = ?`,
      [businessId]
    );
    if (lock && lock.lock_owner === cycleId) {
      await BusinessAutonomyLock.d1Repo.executeWrite(
        'business_autonomy_lock',
        `DELETE FROM business_autonomy_lock WHERE business_id = ?`,
        [businessId]
      );
    }
  }

  /**
   * Release the lock. Only the owner may release.
   */
  public static release(businessId: string, cycleId: string): void {
    if (isProduction()) {
      BusinessAutonomyLock.releaseAsync(businessId, cycleId).catch(err => {
        console.error(`[BusinessAutonomyLock] Async release failed: ${err.message}`);
      });
      return;
    }
    const lock = BusinessAutonomyLock.d1Repo.queryOneSync(
      'business_autonomy_lock',
      `SELECT lock_owner FROM business_autonomy_lock WHERE business_id = ?`,
      [businessId]
    );
    if (lock && lock.lock_owner === cycleId) {
      BusinessAutonomyLock.d1Repo.executeSync(
        'business_autonomy_lock',
        `DELETE FROM business_autonomy_lock WHERE business_id = ?`,
        [businessId]
      );
    }
  }

  /**
   * Force-release (admin use only). Clears any lock regardless of owner.
   */
  public static forceRelease(businessId: string): void {
    if (isProduction()) {
      BusinessAutonomyLock.d1Repo.executeWrite(
        'business_autonomy_lock',
        `DELETE FROM business_autonomy_lock WHERE business_id = ?`,
        [businessId]
      ).catch(err => {
        console.error(`[BusinessAutonomyLock] Async forceRelease failed: ${err.message}`);
      });
      return;
    }
    BusinessAutonomyLock.d1Repo.executeSync(
      'business_autonomy_lock',
      `DELETE FROM business_autonomy_lock WHERE business_id = ?`,
      [businessId]
    );
  }

  /**
   * Check if locked without trying to acquire.
   */
  public static isLocked(businessId: string): boolean {
    if (isProduction()) {
      return false;
    }
    const now = new Date().toISOString();
    const lock = BusinessAutonomyLock.d1Repo.queryOneSync(
      'business_autonomy_lock',
      `SELECT lease_expiry FROM business_autonomy_lock WHERE business_id = ? AND lease_expiry > ?`,
      [businessId, now]
    );
    return !!lock;
  }
}
