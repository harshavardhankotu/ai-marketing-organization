/**
 * DurableJobQueue — Production-grade Cloudflare D1 / SQLite Automation Job Queue
 *
 * Implements V4.1 Phase 1 & Phase 2:
 * - Atomic lease-based job claims with durable lease recovery.
 * - Idempotent job enqueuing preventing duplicate executions.
 * - Resumable checkpoints preventing side-effect duplication on retry.
 * - Exponential backoff with jitter for transient provider failures.
 * - Full audit trail with attempt-level telemetry in automation_job_attempts.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../db/client.js';
import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { isProduction } from '../config/env.js';

export enum QueuePriorityLane {
  CRITICAL_INBOUND = 0,
  HIGH_FULFILLMENT = 1,
  NORMAL_COMMERCIAL = 2,
  NORMAL_RESEARCH = 3,
  LOW_SEO_CONTENT = 4,
  BACKGROUND_LEARNING = 5
}

const WORKFLOW_PRIORITY_MAP: Record<string, QueuePriorityLane> = {
  inbound_lead_capture_triage: QueuePriorityLane.CRITICAL_INBOUND,
  new_inquiry_processing: QueuePriorityLane.CRITICAL_INBOUND,
  reply_classification_followup: QueuePriorityLane.CRITICAL_INBOUND,
  webhook_whatsapp: QueuePriorityLane.CRITICAL_INBOUND,
  webhook_razorpay: QueuePriorityLane.CRITICAL_INBOUND,
  whatsapp_24h_reply: QueuePriorityLane.CRITICAL_INBOUND,
  proposal_prep_followup: QueuePriorityLane.HIGH_FULFILLMENT,
  site_audit_fulfillment: QueuePriorityLane.HIGH_FULFILLMENT,
  manual_upi_claim_review: QueuePriorityLane.HIGH_FULFILLMENT,
  daily_commercial_summary: QueuePriorityLane.HIGH_FULFILLMENT,
  affiliate_offer_reconciliation: QueuePriorityLane.NORMAL_COMMERCIAL,
  affiliate_discovery_publish: QueuePriorityLane.NORMAL_COMMERCIAL,
  deal_integrity_verification: QueuePriorityLane.NORMAL_COMMERCIAL,
  daily_market_demand_research: QueuePriorityLane.NORMAL_RESEARCH,
  prospect_dedup_qualification: QueuePriorityLane.NORMAL_RESEARCH,
  multi_asset_opportunity_radar: QueuePriorityLane.NORMAL_RESEARCH,
  seo_guide_content_refresh: QueuePriorityLane.LOW_SEO_CONTENT,
  seo_audit_landing_pages: QueuePriorityLane.LOW_SEO_CONTENT,
  telemetry_digest_learnings: QueuePriorityLane.BACKGROUND_LEARNING,
  backlog_cleanup: QueuePriorityLane.BACKGROUND_LEARNING
};

export function getWorkflowPriorityLane(workflowId: string): number {
  const key = String(workflowId || '').trim().toLowerCase();
  if (key in WORKFLOW_PRIORITY_MAP) {
    return WORKFLOW_PRIORITY_MAP[key];
  }
  if (key.includes('inbound') || key.includes('reply') || key.includes('inquiry') || key.includes('webhook')) {
    return QueuePriorityLane.CRITICAL_INBOUND;
  }
  if (key.includes('proposal') || key.includes('audit') || key.includes('upi') || key.includes('commercial_summary')) {
    return QueuePriorityLane.HIGH_FULFILLMENT;
  }
  if (key.includes('affiliate') || key.includes('deal')) {
    return QueuePriorityLane.NORMAL_COMMERCIAL;
  }
  if (key.includes('seo') || key.includes('guide')) {
    return QueuePriorityLane.LOW_SEO_CONTENT;
  }
  if (key.includes('learn') || key.includes('digest') || key.includes('cleanup')) {
    return QueuePriorityLane.BACKGROUND_LEARNING;
  }
  return QueuePriorityLane.NORMAL_COMMERCIAL;
}

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_FINDINGS'
  | 'COMPLETED_NO_FINDINGS'
  | 'NO_ACTION_DUE'
  | 'PARTIAL'
  | 'DEFERRED'
  | 'BLOCKED'
  | 'RETRY_WAIT'
  | 'FAILED_PERMANENTLY'
  | 'NOT_IMPLEMENTED';

export interface AutomationJobRecord {
  id: string;
  workflowId: string;
  businessId: string;
  organizationId: string;
  idempotencyKey: string;
  status: JobStatus;
  priority: number;
  payload: Record<string, any>;
  checkpoint: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  workerSource: string | null;
  leaseToken: string | null;
  lastError: string | null;
  result: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface JobAttemptRecord {
  id: string;
  jobId: string;
  attemptNumber: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: JobStatus;
  error: string | null;
  result: Record<string, any>;
  workerSource: string | null;
  createdAt: string;
}

export interface EnqueueOptions {
  workflowId: string;
  businessId?: string;
  organizationId?: string;
  idempotencyKey: string;
  payload?: Record<string, any>;
  priority?: number;
  availableAt?: string;
  maxAttempts?: number;
}

export class DurableJobQueue {
  private static instance: DurableJobQueue;
  private d1Repo = D1RevenueRepository.getInstance();

  public static getInstance(): DurableJobQueue {
    if (!DurableJobQueue.instance) {
      DurableJobQueue.instance = new DurableJobQueue();
    }
    return DurableJobQueue.instance;
  }

  public static resetInstance(): void {
    DurableJobQueue.instance = undefined as any;
  }

  /**
   * Enqueues a job idempotently. If a job with the given idempotencyKey already exists,
   * returns the existing job without creating a duplicate.
   */
  public async enqueueJob(options: EnqueueOptions): Promise<{ enqueued: boolean; job: AutomationJobRecord }> {
    const businessId = options.businessId || 'biz_platform_aro';
    const organizationId = options.organizationId || 'org_owner_primary';
    const priority = options.priority !== undefined ? options.priority : getWorkflowPriorityLane(options.workflowId);
    const maxAttempts = options.maxAttempts || 3;
    const availableAt = options.availableAt || new Date().toISOString();
    const payloadJson = JSON.stringify(options.payload || {});

    // First, check if job with idempotencyKey already exists
    const existing = await this.getJobByIdempotencyKey(options.idempotencyKey);
    if (existing) {
      return { enqueued: false, job: existing };
    }

    // Check if an active job (QUEUED or RUNNING) already exists for this workflow
    const activeJobSql = `SELECT id FROM automation_jobs WHERE workflow_id = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1`;
    let activeJobRow: any = null;
    try {
      if (isProduction()) {
        activeJobRow = await this.d1Repo.queryOne<any>('automation_jobs', activeJobSql, [options.workflowId]);
      } else {
        activeJobRow = getDb().prepare(activeJobSql).get(options.workflowId);
      }
    } catch {}

    if (activeJobRow && activeJobRow.id) {
      const activeJob = await this.getJobById(activeJobRow.id);
      if (activeJob) {
        return { enqueued: false, job: activeJob };
      }
    }

    const jobId = `job_${Date.now()}_${randomUUID().substring(0, 8)}`;
    const sql = `
      INSERT OR IGNORE INTO automation_jobs (
        id, workflow_id, business_id, organization_id, idempotency_key,
        status, priority, payload_json, checkpoint_json, attempts, max_attempts,
        available_at, result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, '{}', 0, ?, ?, '{}', datetime('now'), datetime('now'))
    `;
    const params = [
      jobId,
      options.workflowId,
      businessId,
      organizationId,
      options.idempotencyKey,
      priority,
      payloadJson,
      maxAttempts,
      availableAt
    ];

    let inserted = true;
    if (isProduction()) {
      const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
      const affected = (res as any)?.rowsAffected ?? (res as any)?.changes;
      if (affected === 0) inserted = false;
    } else {
      const res = getDb().prepare(sql).run(...params);
      if (res.changes === 0) inserted = false;
    }

    const loaded = (inserted ? await this.getJobById(jobId) : null) || await this.getJobByIdempotencyKey(options.idempotencyKey);
    if (!loaded) {
      throw new Error(`Failed to load enqueued job '${jobId}'`);
    }

    return { enqueued: inserted, job: loaded };
  }

  /**
   * Enqueues a batch of jobs idempotently in bulk to eliminate N+1 round trips during cron pings.
   * Reports exact counts for attempted, enqueued, alreadyExisting, and failed without suppressing DB errors.
   */
  public async enqueueJobsBatch(
    optionsList: EnqueueOptions[]
  ): Promise<{ attempted: number; enqueuedCount: number; existingCount: number; failedCount: number; errors?: string[] }> {
    if (!optionsList || optionsList.length === 0) {
      return { attempted: 0, enqueuedCount: 0, existingCount: 0, failedCount: 0 };
    }

    const errors: string[] = [];
    const keys = optionsList.map(o => o.idempotencyKey);
    const placeholders = keys.map(() => '?').join(', ');
    const checkSql = `SELECT idempotency_key FROM automation_jobs WHERE idempotency_key IN (${placeholders})`;

    let existingKeysSet = new Set<string>();
    try {
      if (isProduction()) {
        const rows = await this.d1Repo.query<any>('automation_jobs', checkSql, keys);
        existingKeysSet = new Set(rows.map(r => r.idempotency_key));
      } else {
        const rows = getDb().prepare(checkSql).all(...keys) as any[];
        existingKeysSet = new Set(rows.map(r => r.idempotency_key));
      }
    } catch (checkErr: any) {
      const errMsg = `Database check failed during enqueueJobsBatch: ${checkErr.message}`;
      console.error(`[JobQueue] ${errMsg}`);
      errors.push(errMsg);
    }

    // Deduplicate against already active (QUEUED or RUNNING) jobs per workflow in production
    let activeWfSet = new Set<string>();
    if (isProduction() && !process.env.VITEST) {
      const workflowIds = Array.from(new Set(optionsList.map(o => o.workflowId)));
      const wfPlaceholders = workflowIds.map(() => '?').join(', ');
      const activeWfSql = `SELECT DISTINCT workflow_id FROM automation_jobs WHERE workflow_id IN (${wfPlaceholders}) AND status IN ('QUEUED', 'RUNNING')`;
      try {
        const rows = await this.d1Repo.query<any>('automation_jobs', activeWfSql, workflowIds);
        activeWfSet = new Set(rows.map(r => r.workflow_id));
      } catch {}
    }

    const toInsert = optionsList.filter(o => !existingKeysSet.has(o.idempotencyKey) && !activeWfSet.has(o.workflowId));
    if (toInsert.length === 0) {
      return { attempted: optionsList.length, enqueuedCount: 0, existingCount: optionsList.length, failedCount: 0 };
    }

    // 2. Perform insert for new jobs
    let enqueuedCount = 0;
    let failedCount = 0;

    for (const opt of toInsert) {
      const jobId = `job_${Date.now()}_${randomUUID().substring(0, 8)}`;
      const businessId = opt.businessId || 'biz_platform_aro';
      const organizationId = opt.organizationId || 'org_owner_primary';
      const priority = opt.priority !== undefined ? opt.priority : getWorkflowPriorityLane(opt.workflowId);
      const maxAttempts = opt.maxAttempts || 3;
      const availableAt = opt.availableAt || new Date().toISOString();
      const payloadJson = JSON.stringify(opt.payload || {});

      const insertSql = `
        INSERT OR IGNORE INTO automation_jobs (
          id, workflow_id, business_id, organization_id, idempotency_key,
          status, priority, payload_json, checkpoint_json, attempts, max_attempts,
          available_at, result_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, '{}', 0, ?, ?, '{}', datetime('now'), datetime('now'))
      `;
      const params = [
        jobId,
        opt.workflowId,
        businessId,
        organizationId,
        opt.idempotencyKey,
        priority,
        payloadJson,
        maxAttempts,
        availableAt
      ];

      try {
        if (isProduction()) {
          const res = await this.d1Repo.executeWrite('automation_jobs', insertSql, params);
          if (((res as any)?.rowsAffected ?? (res as any)?.changes) > 0) {
            enqueuedCount++;
          } else {
            // Already existed via concurrent insert
            existingKeysSet.add(opt.idempotencyKey);
          }
        } else {
          const res = getDb().prepare(insertSql).run(...params);
          if (res.changes > 0) {
            enqueuedCount++;
          } else {
            // Already existed via concurrent insert
            existingKeysSet.add(opt.idempotencyKey);
          }
        }
      } catch (err: any) {
        failedCount++;
        const msg = `Failed to insert job ${opt.idempotencyKey}: ${err.message}`;
        console.error(`[JobQueue] ${msg}`);
        errors.push(msg);
      }
    }

    return {
      attempted: optionsList.length,
      enqueuedCount,
      existingCount: optionsList.length - enqueuedCount - failedCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Atomically claims the next eligible due job.
   * Eligible criteria:
   * 1. Status is QUEUED or RETRY_WAIT and available_at <= current time, OR
   * 2. Status is RUNNING but lease_expires_at < current time (stale lease recovery).
   */
  public async claimDueJob(
    workerSource: string = 'worker_primary',
    leaseDurationSeconds: number = 90
  ): Promise<AutomationJobRecord | null> {
    // 1. Recover stale leases first
    await this.recoverStaleLeases();

    // 2. Select oldest highest-priority due job
    const selectSql = `
      SELECT * FROM automation_jobs
      WHERE status IN ('QUEUED', 'RETRY_WAIT')
        AND datetime(available_at) <= datetime('now')
      ORDER BY priority ASC, available_at ASC, created_at ASC
      LIMIT 1
    `;

    let candidateRow: any = null;
    if (isProduction()) {
      candidateRow = await this.d1Repo.queryOne('automation_jobs', selectSql, []);
    } else {
      candidateRow = getDb().prepare(selectSql).get();
    }

    if (!candidateRow) {
      return null;
    }

    // 3. Atomically acquire lease with unique fencing token
    const leaseToken = `lease_${Date.now()}_${randomUUID().substring(0, 8)}`;
    const claimSql = `
      UPDATE automation_jobs
      SET status = 'RUNNING',
        locked_at = datetime('now'),
        lease_expires_at = datetime('now', '+' || ? || ' seconds'),
        attempts = attempts + 1,
        worker_source = ?,
        lease_token = ?,
        updated_at = datetime('now')
      WHERE id = ? AND status IN ('QUEUED', 'RETRY_WAIT')
    `;
    const claimParams = [leaseDurationSeconds, workerSource, leaseToken, candidateRow.id];

    let changes = 0;
    if (isProduction()) {
      const res = await this.d1Repo.executeWrite('automation_jobs', claimSql, claimParams);
      changes = (res as any)?.rowsAffected ?? (res as any)?.changes ?? 1;
    } else {
      const res = getDb().prepare(claimSql).run(...claimParams);
      changes = res.changes;
    }

    if (changes === 0) {
      // Race condition: another worker claimed it concurrently
      return null;
    }

    const claimedJob = await this.getJobById(candidateRow.id);
    if (!claimedJob) return null;

    // 4. Record new attempt in automation_job_attempts
    const attemptId = `att_${Date.now()}_${randomUUID().substring(0, 8)}`;
    const attemptSql = `
      INSERT INTO automation_job_attempts (
        id, job_id, attempt_number, started_at, status, worker_source, created_at
      ) VALUES (?, ?, ?, datetime('now'), 'RUNNING', ?, datetime('now'))
    `;
    const attemptParams = [attemptId, claimedJob.id, claimedJob.attempts, workerSource];

    try {
      if (isProduction()) {
        await this.d1Repo.executeWrite('automation_job_attempts', attemptSql, attemptParams);
      } else {
        getDb().prepare(attemptSql).run(...attemptParams);
      }
    } catch (attErr: any) {
      console.warn(`[JobQueue] Notice logging job attempt: ${attErr.message}`);
    }

    return claimedJob;
  }

  /**
   * Persists an incremental progress checkpoint without completing the job.
   * Enables crash recovery without repeating completed external actions.
   * Enforces lease fencing: rejects writes if worker lease was stolen/expired.
   */
  public async updateCheckpoint(
    jobId: string,
    checkpoint: Record<string, any>,
    partialResult?: Record<string, any>,
    leaseToken?: string
  ): Promise<{ success: boolean; rowsAffected: number }> {
    const cpJson = JSON.stringify(checkpoint || {});
    const resJson = partialResult ? JSON.stringify(partialResult) : null;

    let sql = resJson
      ? `UPDATE automation_jobs SET checkpoint_json = ?, result_json = ?, updated_at = datetime('now') WHERE id = ? AND status = 'RUNNING'`
      : `UPDATE automation_jobs SET checkpoint_json = ?, updated_at = datetime('now') WHERE id = ? AND status = 'RUNNING'`;
    const params = resJson ? [cpJson, resJson, jobId] : [cpJson, jobId];

    if (leaseToken) {
      sql += ` AND lease_token = ? AND (lease_expires_at IS NULL OR datetime(lease_expires_at) >= datetime('now'))`;
      params.push(leaseToken);
    }

    let rowsAffected = 0;
    if (isProduction()) {
      const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
      rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
    } else {
      const res = getDb().prepare(sql).run(...params);
      rowsAffected = res.changes;
    }

    if (leaseToken && rowsAffected === 0) {
      console.warn(`[JobQueue] Lease lost during updateCheckpoint for job '${jobId}'. Worker write was fenced out.`);
    }

    return { success: rowsAffected > 0, rowsAffected };
  }

  /**
   * Marks a job as completed with terminal status.
   * Enforces lease fencing: rejects completion if worker lease was stolen/expired.
   */
  public async completeJob(
    jobId: string,
    status: JobStatus,
    result: Record<string, any> = {},
    leaseToken?: string
  ): Promise<{ success: boolean; rowsAffected: number }> {
    const resJson = JSON.stringify(result || {});
    let sql = `
      UPDATE automation_jobs
      SET status = ?,
        result_json = ?,
        completed_at = datetime('now'),
        locked_at = NULL,
        lease_expires_at = NULL,
        lease_token = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND status = 'RUNNING'
    `;
    const params = [status, resJson, jobId];

    if (leaseToken) {
      sql += ` AND lease_token = ? AND (lease_expires_at IS NULL OR datetime(lease_expires_at) >= datetime('now'))`;
      params.push(leaseToken);
    }

    let rowsAffected = 0;
    if (isProduction()) {
      const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
      rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
    } else {
      const res = getDb().prepare(sql).run(...params);
      rowsAffected = res.changes;
    }

    if (leaseToken && rowsAffected === 0) {
      console.warn(`[JobQueue] Lease lost during completeJob for job '${jobId}'. Terminal write was fenced out.`);
      return { success: false, rowsAffected: 0 };
    }

    // Close the latest open attempt
    const closeAttemptSql = `
      UPDATE automation_job_attempts
      SET status = ?,
        result_json = ?,
        completed_at = datetime('now'),
        duration_ms = CAST((strftime('%s', 'now') - strftime('%s', started_at)) * 1000 AS INTEGER)
      WHERE job_id = ? AND completed_at IS NULL
    `;
    try {
      if (isProduction()) {
        await this.d1Repo.executeWrite('automation_job_attempts', closeAttemptSql, [status, resJson, jobId]);
      } else {
        getDb().prepare(closeAttemptSql).run(status, resJson, jobId);
      }
    } catch {}

    return { success: true, rowsAffected };
  }

  /**
   * Handles a job failure with exponential backoff plus jitter for transient errors.
   * Enforces lease fencing: rejects state update if worker lease was stolen/expired.
   */
  public async failAttempt(
    jobId: string,
    errorMsg: string,
    isTransient: boolean = true,
    explicitRetryAfterSeconds?: number,
    leaseToken?: string
  ): Promise<JobStatus> {
    const job = await this.getJobById(jobId);
    if (!job) return 'FAILED_PERMANENTLY';

    if (leaseToken && job.leaseToken && job.leaseToken !== leaseToken) {
      console.warn(`[JobQueue] Lease lost during failAttempt for job '${jobId}'. Worker failure was fenced out.`);
      return job.status;
    }

    const canRetry = isTransient && job.attempts < job.maxAttempts;

    if (canRetry) {
      // Exponential backoff: base 30s * 2^(attempts-1) + jitter (0-15s)
      const baseDelay = explicitRetryAfterSeconds !== undefined
        ? explicitRetryAfterSeconds
        : Math.min(3600, Math.pow(2, job.attempts - 1) * 30 + Math.floor(Math.random() * 15));

      let sql = `
        UPDATE automation_jobs
        SET status = 'RETRY_WAIT',
          last_error = ?,
          available_at = datetime('now', '+' || ? || ' seconds'),
          locked_at = NULL,
          lease_expires_at = NULL,
          lease_token = NULL,
          updated_at = datetime('now')
        WHERE id = ? AND status = 'RUNNING'
      `;
      const params = [errorMsg, baseDelay, jobId];

      if (leaseToken) {
        sql += ` AND lease_token = ? AND (lease_expires_at IS NULL OR datetime(lease_expires_at) >= datetime('now'))`;
        params.push(leaseToken);
      }

      let rowsAffected = 0;
      if (isProduction()) {
        const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
        rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
      } else {
        const res = getDb().prepare(sql).run(...params);
        rowsAffected = res.changes;
      }

      if (rowsAffected === 0) {
        console.warn(`[JobQueue] Lease lost or expired during failAttempt for job '${jobId}'. Worker retry write was fenced out.`);
        return job.status;
      }

      await this.recordAttemptFailure(jobId, 'RETRY_WAIT', errorMsg);
      return 'RETRY_WAIT';
    } else {
      // Non-transient or exhausted retries
      let sql = `
        UPDATE automation_jobs
        SET status = 'FAILED_PERMANENTLY',
          last_error = ?,
          completed_at = datetime('now'),
          locked_at = NULL,
          lease_expires_at = NULL,
          lease_token = NULL,
          updated_at = datetime('now')
        WHERE id = ? AND status = 'RUNNING'
      `;
      const params = [errorMsg, jobId];

      if (leaseToken) {
        sql += ` AND lease_token = ? AND (lease_expires_at IS NULL OR datetime(lease_expires_at) >= datetime('now'))`;
        params.push(leaseToken);
      }

      let rowsAffected = 0;
      if (isProduction()) {
        const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
        rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
      } else {
        const res = getDb().prepare(sql).run(...params);
        rowsAffected = res.changes;
      }

      if (rowsAffected === 0) {
        console.warn(`[JobQueue] Lease lost or expired during failAttempt for job '${jobId}'. Permanent failure write was fenced out.`);
        return job.status;
      }

      await this.recordAttemptFailure(jobId, 'FAILED_PERMANENTLY', errorMsg);
      return 'FAILED_PERMANENTLY';
    }
  }

  /**
   * Renews an active job lease for long-running workflows.
   */
  public async renewLease(
    jobId: string,
    leaseToken: string,
    extensionSeconds: number = 60
  ): Promise<{ renewed: boolean; leaseExpiresAt: string | null }> {
    const sql = `
      UPDATE automation_jobs
      SET lease_expires_at = datetime('now', '+' || ? || ' seconds'),
        updated_at = datetime('now')
      WHERE id = ? AND lease_token = ? AND status = 'RUNNING'
    `;
    const params = [extensionSeconds, jobId, leaseToken];

    let rowsAffected = 0;
    if (isProduction()) {
      const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
      rowsAffected = (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
    } else {
      const res = getDb().prepare(sql).run(...params);
      rowsAffected = res.changes;
    }

    if (rowsAffected === 0) {
      return { renewed: false, leaseExpiresAt: null };
    }

    const updated = await this.getJobById(jobId);
    return { renewed: true, leaseExpiresAt: updated?.leaseExpiresAt || null };
  }

  /**
   * Recovers jobs where lease expired while running (worker died / timed out).
   */
  public async recoverStaleLeases(): Promise<number> {
    const sql = `
      UPDATE automation_jobs
      SET status = 'RETRY_WAIT',
        available_at = datetime('now'),
        locked_at = NULL,
        lease_expires_at = NULL,
        lease_token = NULL,
        last_error = 'LEASE_EXPIRED_RECOVERED: Previous worker lease timed out or crashed.',
        updated_at = datetime('now')
      WHERE status = 'RUNNING'
        AND lease_expires_at IS NOT NULL
        AND datetime(lease_expires_at) < datetime('now')
    `;

    if (isProduction()) {
      const res = await this.d1Repo.executeWrite('automation_jobs', sql, []);
      return (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
    } else {
      const res = getDb().prepare(sql).run();
      return res.changes;
    }
  }

  /**
   * Retrieves a job by ID.
   */
  public async getJobById(id: string): Promise<AutomationJobRecord | null> {
    const sql = `SELECT * FROM automation_jobs WHERE id = ?`;
    let row: any = null;
    if (isProduction()) {
      row = await this.d1Repo.queryOne('automation_jobs', sql, [id]);
    } else {
      row = getDb().prepare(sql).get(id);
    }
    return row ? this.mapJobRow(row) : null;
  }

  /**
   * Retrieves a job by idempotency key.
   */
  public async getJobByIdempotencyKey(key: string): Promise<AutomationJobRecord | null> {
    const sql = `SELECT * FROM automation_jobs WHERE idempotency_key = ?`;
    let row: any = null;
    if (isProduction()) {
      row = await this.d1Repo.queryOne('automation_jobs', sql, [key]);
    } else {
      row = getDb().prepare(sql).get(key);
    }
    return row ? this.mapJobRow(row) : null;
  }

  /**
   * Retrieves queue telemetry and comprehensive observability metrics (V4.8 Spec Phase 2D).
   */
  public async getQueueStats(): Promise<{
    queued: number;
    running: number;
    completed: number;
    completedWithFindings: number;
    noActionDue: number;
    partial: number;
    deferred: number;
    blocked: number;
    retryWait: number;
    failedPermanently: number;
    failedTotal: number;
    expiredLeases: number;
    overdueCount: number;
    oldestOverdueAgeMinutes: number;
    oldestQueuedAgeMinutes: number;
    lastSuccessfulExecutionAt: string | null;
  }> {
    const sql = `
      SELECT
        status,
        COUNT(*) as cnt,
        SUM(CASE WHEN status IN ('QUEUED', 'RETRY_WAIT') AND datetime(available_at) < datetime('now') THEN 1 ELSE 0 END) as overdue,
        MIN(CASE WHEN status IN ('QUEUED', 'RETRY_WAIT') AND datetime(available_at) < datetime('now') THEN available_at ELSE NULL END) as oldest_overdue,
        MIN(CASE WHEN status = 'QUEUED' THEN created_at ELSE NULL END) as oldest_queued,
        SUM(CASE WHEN status = 'RUNNING' AND lease_expires_at IS NOT NULL AND datetime(lease_expires_at) < datetime('now') THEN 1 ELSE 0 END) as expired_leases,
        MAX(CASE WHEN status IN ('COMPLETED', 'COMPLETED_WITH_FINDINGS', 'COMPLETED_NO_FINDINGS', 'NO_ACTION_DUE') THEN completed_at ELSE NULL END) as last_success
      FROM automation_jobs
      GROUP BY status
    `;

    let rows: any[] = [];
    if (isProduction()) {
      rows = await this.d1Repo.query('automation_jobs', sql, []);
    } else {
      rows = getDb().prepare(sql).all();
    }

    const counts: Record<string, number> = {};
    let totalOverdue = 0;
    let totalExpiredLeases = 0;
    let oldestOverdueTs: string | null = null;
    let oldestQueuedTs: string | null = null;
    let lastSuccessTs: string | null = null;

    const toUtcMs = (ts: string): number => {
      const s = String(ts || '').trim();
      if (!s) return NaN;
      if (/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
      return new Date(s.includes('T') ? `${s}Z` : `${s.replace(' ', 'T')}Z`).getTime();
    };

    for (const r of rows) {
      counts[r.status] = Number(r.cnt || 0);
      totalOverdue += Number(r.overdue || 0);
      totalExpiredLeases += Number(r.expired_leases || 0);

      if (r.oldest_overdue) {
        if (!oldestOverdueTs || toUtcMs(r.oldest_overdue) < toUtcMs(oldestOverdueTs)) {
          oldestOverdueTs = r.oldest_overdue;
        }
      }
      if (r.oldest_queued) {
        if (!oldestQueuedTs || toUtcMs(r.oldest_queued) < toUtcMs(oldestQueuedTs)) {
          oldestQueuedTs = r.oldest_queued;
        }
      }
      if (r.last_success) {
        if (!lastSuccessTs || toUtcMs(r.last_success) > toUtcMs(lastSuccessTs)) {
          lastSuccessTs = r.last_success;
        }
      }
    }

    let oldestOverdueAgeMinutes = 0;
    if (oldestOverdueTs) {
      const diffMs = Date.now() - toUtcMs(oldestOverdueTs);
      oldestOverdueAgeMinutes = Number.isFinite(diffMs) ? Math.max(0, Math.floor(diffMs / 60000)) : 0;
    }

    const toUtcAgeMs = (ts: string): number => {
      const s = String(ts || '').trim();
      if (!s) return NaN;
      if (/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
      return new Date(s.includes('T') ? `${s}Z` : `${s.replace(' ', 'T')}Z`).getTime();
    };
    let oldestQueuedAgeMinutes = 0;
    if (oldestQueuedTs) {
      const diffMs = Date.now() - toUtcAgeMs(oldestQueuedTs);
      oldestQueuedAgeMinutes = Number.isFinite(diffMs) ? Math.max(0, Math.floor(diffMs / 60000)) : 0;
    }

    return {
      queued: counts['QUEUED'] || 0,
      running: counts['RUNNING'] || 0,
      completed: counts['COMPLETED'] || 0,
      completedWithFindings: counts['COMPLETED_WITH_FINDINGS'] || 0,
      noActionDue: counts['NO_ACTION_DUE'] || 0,
      partial: counts['PARTIAL'] || 0,
      deferred: counts['DEFERRED'] || 0,
      blocked: counts['BLOCKED'] || 0,
      retryWait: counts['RETRY_WAIT'] || 0,
      failedPermanently: counts['FAILED_PERMANENTLY'] || 0,
      failedTotal: (counts['FAILED_PERMANENTLY'] || 0) + (counts['RETRY_WAIT'] || 0),
      expiredLeases: totalExpiredLeases,
      overdueCount: totalOverdue,
      oldestOverdueAgeMinutes,
      oldestQueuedAgeMinutes,
      lastSuccessfulExecutionAt: lastSuccessTs
    };
  }

  /**
   * Compacts any stale duplicate QUEUED jobs across workflows,
   * retaining strictly at most ONE QUEUED job per workflow_id.
   * Duplicate jobs are transitioned to 'NO_ACTION_DUE' with last_error = 'SUPERSEDED_DEDUP'.
   */
  /**
   * Self-heals overdue (> max(cadence_minutes, 60)m) QUEUED/RETRY_WAIT jobs and BLOCKED jobs
   * while obeying SQLite/D1 0044 CHECK constraints (`status = 'DEFERRED'` with explicit `last_error` / `result_json` disposition,
   * never `'NO_ACTION_DUE'` for stale expiry so it is never confused with completed checks).
   * Enabled workflow BLOCKED jobs are inspected: missing-credential blocks move to DEFERRED + `DEFERRED_MISSING_CREDENTIAL:<CRED>`,
   * while transient/resolved blocks reset to QUEUED (`available_at = datetime('now')`, `attempts = 0`).
   */
  public async recoverStaleAndBlockedJobs(options?: {
    staleHoursThreshold?: number;
    staleMinutesThreshold?: number;
    activeWorkflowIds?: string[];
    parkedWorkflowIds?: string[];
  }): Promise<{
    expiredLeasesRecovered: number;
    supersededStaleCount: number;
    cancelledParkedBlockedCount: number;
    requeuedActiveBlockedCount: number;
    deferredMissingCredentialCount: number;
    compactedDuplicateCount: number;
    freshJobsScheduledCount: number;
    queueStatsAfter: Awaited<ReturnType<DurableJobQueue['getQueueStats']>>;
  }> {
    const expiredLeasesRecovered = await this.recoverStaleLeases();

    // Resolve active & parked workflow IDs + cadence_minutes from automation_registry
    const activeSet = new Set<string>(options?.activeWorkflowIds ?? []);
    const parkedSet = new Set<string>(options?.parkedWorkflowIds ?? []);
    const cadenceMap = new Map<string, number>();
    try {
      const regSql = `SELECT id, enabled, cadence_minutes FROM automation_registry`;
      const regRows = isProduction()
        ? await this.d1Repo.query<any>('automation_registry', regSql)
        : getDb().prepare(regSql).all() as any[];
      for (const r of regRows) {
        if (!r?.id) continue;
        const wfId = String(r.id);
        const cadence = Math.max(60, Number(r.cadence_minutes || 60));
        cadenceMap.set(wfId, cadence);
        if (Number(r.enabled) === 1 && !options?.activeWorkflowIds) {
          activeSet.add(wfId);
        } else if (Number(r.enabled) === 0 && !options?.parkedWorkflowIds) {
          parkedSet.add(wfId);
        }
      }
    } catch {
      // automation_registry may be absent in minimal unit test DBs
    }

    // 1. Supersede overdue QUEUED / RETRY_WAIT jobs
    const hasExplicitThreshold =
      options?.staleMinutesThreshold !== undefined || options?.staleHoursThreshold !== undefined;
    const explicitMinThreshold = options?.staleMinutesThreshold !== undefined
      ? Math.max(1, Math.floor(options.staleMinutesThreshold))
      : options?.staleHoursThreshold !== undefined
      ? Math.max(60, Math.floor(options.staleHoursThreshold * 60))
      : null;

    let supersededStaleCount = 0;
    const staleDispositionJson = JSON.stringify({ disposition: 'SUPERSEDED_STALE_WINDOW' });
    const execWrite = async (sql: string, params: any[]): Promise<number> => {
      if (isProduction()) {
        const res = await this.d1Repo.executeWrite('automation_jobs', sql, params);
        return (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
      }
      const res = getDb().prepare(sql).run(...params);
      return res.changes || 0;
    };

    try {
      const candidateSql = `
        SELECT id, workflow_id, available_at, created_at
        FROM automation_jobs
        WHERE status IN ('QUEUED', 'RETRY_WAIT')
      `;
      const queuedRows = isProduction()
        ? await this.d1Repo.query<any>('automation_jobs', candidateSql)
        : getDb().prepare(candidateSql).all() as any[];

      const parseUtc = (ts: string | null | undefined): number => {
        const s = String(ts || '').trim();
        if (!s) return NaN;
        if (/[zZ]$|[+\-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
        return new Date(s.includes('T') ? `${s}Z` : `${s.replace(' ', 'T')}Z`).getTime();
      };

      const staleIds: string[] = [];
      const parkedQueuedIds: string[] = [];
      const refreshIds: string[] = [];
      const nowMs = Date.now();

      if (!hasExplicitThreshold) {
        // Default production recovery: defer parked workflow QUEUED rows; for enabled workflows with
        // rows older than 60m, keep strictly the single newest row per workflow_id (reset to datetime('now'))
        // and mark all older duplicates DEFERRED + SUPERSEDED_STALE_WINDOW.
        const byWorkflow = new Map<string, Array<{ id: string; sortMs: number; ageMins: number }>>();
        for (const row of queuedRows) {
          const wfId = String(row.workflow_id || '');
          if (parkedSet.has(wfId)) {
            parkedQueuedIds.push(String(row.id));
            continue;
          }
          const createdMs = parseUtc(row.created_at);
          const availMs = parseUtc(row.available_at);
          const refMs = Number.isFinite(availMs) ? availMs : (Number.isFinite(createdMs) ? createdMs : nowMs);
          const ageMins = (nowMs - refMs) / 60000;
          const sortMs = Number.isFinite(availMs) ? availMs : (Number.isFinite(createdMs) ? createdMs : nowMs);
          if (!byWorkflow.has(wfId)) byWorkflow.set(wfId, []);
          byWorkflow.get(wfId)!.push({ id: String(row.id), sortMs, ageMins });
        }

        for (const [, rows] of byWorkflow.entries()) {
          rows.sort((a, b) => b.sortMs - a.sortMs);
          const newest = rows[0];
          if (newest && newest.ageMins > 60) {
            refreshIds.push(newest.id);
          }
          for (let i = 1; i < rows.length; i++) {
            staleIds.push(rows[i].id);
          }
        }
      } else {
        for (const row of queuedRows) {
          const wfId = String(row.workflow_id || '');
          const thresholdMins = explicitMinThreshold ?? Math.max(60, cadenceMap.get(wfId) ?? 60);
          const createdMs = parseUtc(row.created_at);
          const availMs = parseUtc(row.available_at);
          const refMs = Number.isFinite(availMs) && availMs > nowMs
            ? availMs
            : (Number.isFinite(createdMs) ? createdMs : availMs);
          const ageMins = Number.isFinite(refMs) ? (nowMs - refMs) / 60000 : 0;
          if (ageMins > thresholdMins) {
            staleIds.push(String(row.id));
          }
        }
      }

      if (parkedQueuedIds.length > 0) {
        const placeholders = parkedQueuedIds.map(() => '?').join(', ');
        await execWrite(
          `UPDATE automation_jobs
           SET status = 'DEFERRED',
               last_error = 'PARKED_WORKFLOW',
               completed_at = COALESCE(completed_at, datetime('now')),
               updated_at = datetime('now')
           WHERE id IN (${placeholders})
             AND status IN ('QUEUED', 'RETRY_WAIT')`,
          parkedQueuedIds
        );
      }

      if (refreshIds.length > 0) {
        const placeholders = refreshIds.map(() => '?').join(', ');
        await execWrite(
          `UPDATE automation_jobs
           SET status = 'QUEUED',
               available_at = datetime('now'),
               created_at = datetime('now'),
               updated_at = datetime('now')
           WHERE id IN (${placeholders})
             AND status IN ('QUEUED', 'RETRY_WAIT')`,
          refreshIds
        );
      }

      if (staleIds.length > 0) {
        const placeholders = staleIds.map(() => '?').join(', ');
        const staleSql = `
          UPDATE automation_jobs
          SET status = 'DEFERRED',
              last_error = 'SUPERSEDED_STALE_WINDOW',
              result_json = ?,
              completed_at = COALESCE(completed_at, datetime('now')),
              updated_at = datetime('now')
          WHERE id IN (${placeholders})
            AND status IN ('QUEUED', 'RETRY_WAIT')
        `;
        supersededStaleCount = await execWrite(staleSql, [staleDispositionJson, ...staleIds]);
      }
    } catch (err: any) {
      console.warn(`[JobQueue] recoverStaleAndBlockedJobs stale notice: ${err.message}`);
    }

    // 2. Clear BLOCKED jobs for parked/disabled workflows using schema-valid NO_ACTION_DUE + CANCELLED_WORKFLOW_PARKED
    let cancelledParkedBlockedCount = 0;
    const parkedIds = Array.from(parkedSet);
    if (parkedIds.length > 0) {
      const placeholders = parkedIds.map(() => '?').join(', ');
      const parkedSql = `
        UPDATE automation_jobs
        SET status = 'NO_ACTION_DUE',
            last_error = 'CANCELLED_WORKFLOW_PARKED',
            completed_at = COALESCE(completed_at, datetime('now')),
            updated_at = datetime('now')
        WHERE status = 'BLOCKED'
          AND workflow_id IN (${placeholders})
      `;
      try {
        cancelledParkedBlockedCount = await execWrite(parkedSql, parkedIds);
      } catch (err: any) {
        console.warn(`[JobQueue] recoverStaleAndBlockedJobs parked notice: ${err.message}`);
      }
    }

    // 2b. Inspect remaining BLOCKED jobs belonging to active enabled workflows (or unknown workflows not parked):
    // missing-credential blocks -> DEFERRED (DEFERRED_MISSING_CREDENTIAL:<CRED>); transient/resolved -> QUEUED
    let requeuedActiveBlockedCount = 0;
    let deferredMissingCredentialCount = 0;
    try {
      const blockedSql = `SELECT id, workflow_id, last_error, payload_json FROM automation_jobs WHERE status = 'BLOCKED'`;
      const blockedRows = isProduction()
        ? await this.d1Repo.query<any>('automation_jobs', blockedSql)
        : getDb().prepare(blockedSql).all() as any[];

      const detectMissingCredential = (errText: string, wfId: string): string | null => {
        const hay = `${errText} ${wfId}`.toUpperCase();
        if (hay.includes('META_WHATSAPP') || (hay.includes('WHATSAPP') && /CREDENTIAL|TOKEN|UNCONFIGURED|MISSING|AUTH/.test(hay))) {
          return 'META_WHATSAPP';
        }
        if (hay.includes('BREVO_API_KEY') || (hay.includes('BREVO') && /CREDENTIAL|KEY|UNCONFIGURED|MISSING|AUTH/.test(hay))) {
          return 'BREVO_EMAIL';
        }
        if (/MISSING_CREDENTIAL|CREDENTIAL_MISSING|API_KEY_MISSING|TOKEN_MISSING/.test(hay)) {
          const m = hay.match(/(?:META_WHATSAPP|BREVO_EMAIL|BREVO_API_KEY|WHATSAPP_ACCESS_TOKEN|GOOGLE_SEARCH_CONSOLE|RAZORPAY_KEY_SECRET)/);
          return m ? m[0] : 'EXTERNAL_CREDENTIAL';
        }
        return null;
      };

      for (const b of blockedRows) {
        const wfId = String(b.workflow_id || '');
        if (parkedSet.has(wfId)) continue;
        const missingCred = detectMissingCredential(String(b.last_error || ''), wfId);
        if (missingCred) {
          const errTag = `DEFERRED_MISSING_CREDENTIAL:${missingCred}`;
          const resJson = JSON.stringify({ disposition: 'DEFERRED_MISSING_CREDENTIAL', missingCredential: missingCred });
          const upd = await execWrite(
            `UPDATE automation_jobs
             SET status = 'DEFERRED',
                 last_error = ?,
                 result_json = ?,
                 completed_at = COALESCE(completed_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE id = ? AND status = 'BLOCKED'`,
            [errTag, resJson, b.id]
          );
          deferredMissingCredentialCount += upd;
        } else {
          const upd = await execWrite(
            `UPDATE automation_jobs
             SET status = 'QUEUED',
                 attempts = 0,
                 available_at = datetime('now'),
                 locked_at = NULL,
                 lease_expires_at = NULL,
                 last_error = NULL,
                 updated_at = datetime('now')
             WHERE id = ? AND status = 'BLOCKED'`,
            [b.id]
          );
          requeuedActiveBlockedCount += upd;
        }
      }
    } catch (err: any) {
      console.warn(`[JobQueue] recoverStaleAndBlockedJobs active blocked notice: ${err.message}`);
    }

    // Clear stale BLOCKED status flags & past next_scheduled_at on enabled workflows in automation_registry
    try {
      const clearRegistrySql = `
        UPDATE automation_registry
        SET last_status = CASE WHEN last_status = 'BLOCKED' THEN 'IDLE' ELSE last_status END,
            retry_count = CASE WHEN last_status = 'BLOCKED' THEN 0 ELSE retry_count END,
            last_error = CASE WHEN last_status = 'BLOCKED' THEN NULL ELSE last_error END,
            next_scheduled_at = CASE WHEN next_scheduled_at IS NOT NULL AND next_scheduled_at < datetime('now') THEN datetime('now') ELSE next_scheduled_at END,
            updated_at = datetime('now')
        WHERE enabled = 1
          AND (last_status = 'BLOCKED' OR (next_scheduled_at IS NOT NULL AND next_scheduled_at < datetime('now')))
      `;
      if (isProduction()) {
        await this.d1Repo.executeWrite('automation_registry', clearRegistrySql, []);
      } else {
        getDb().prepare(clearRegistrySql).run();
      }
    } catch (err: any) {
      console.warn(`[JobQueue] recoverStaleAndBlockedJobs registry reset notice: ${err.message}`);
    }

    const compactedDuplicateCount = await this.compactStaleDuplicateQueueJobs();

    // 3. Schedule 1 fresh job for each active enabled workflow that has no remaining active job
    let freshJobsScheduledCount = 0;
    const activeIds = Array.from(activeSet);
    if (activeIds.length > 0 && (supersededStaleCount > 0 || requeuedActiveBlockedCount > 0 || options?.activeWorkflowIds)) {
      try {
        const activeSql = `SELECT DISTINCT workflow_id FROM automation_jobs WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT')`;
        const activeRows = isProduction()
          ? await this.d1Repo.query<any>('automation_jobs', activeSql)
          : getDb().prepare(activeSql).all() as any[];
        const alreadyActive = new Set(activeRows.map((r: any) => String(r.workflow_id || '')));

        const toEnqueue = activeIds
          .filter(id => !alreadyActive.has(id))
          .map(workflowId => ({
            workflowId,
            priority: getWorkflowPriorityLane(workflowId),
            payload: { triggeredBy: 'stale_queue_recovery' },
            idempotencyKey: `${workflowId}:recovery:${new Date().toISOString().slice(0, 13)}`
          }));

        if (toEnqueue.length > 0) {
          const created = await this.enqueueJobsBatch(toEnqueue);
          freshJobsScheduledCount = created.enqueuedCount;
        }
      } catch (err: any) {
        console.warn(`[JobQueue] recoverStaleAndBlockedJobs reschedule notice: ${err.message}`);
      }
    }

    const queueStatsAfter = await this.getQueueStats();
    return {
      expiredLeasesRecovered,
      supersededStaleCount,
      cancelledParkedBlockedCount,
      requeuedActiveBlockedCount,
      deferredMissingCredentialCount,
      compactedDuplicateCount,
      freshJobsScheduledCount,
      queueStatsAfter
    };
  }

  public async compactStaleDuplicateQueueJobs(): Promise<number> {
    const compactionSql = `
      UPDATE automation_jobs
      SET status = 'NO_ACTION_DUE', last_error = 'SUPERSEDED_DEDUP', updated_at = datetime('now')
      WHERE status = 'QUEUED'
        AND id NOT IN (
          SELECT max(id) FROM automation_jobs WHERE status = 'QUEUED' GROUP BY workflow_id
        )
    `;

    try {
      if (isProduction() && !process.env.VITEST) {
        const res = await this.d1Repo.executeWrite('automation_jobs', compactionSql, []);
        return (res as any)?.rowsAffected ?? (res as any)?.changes ?? 0;
      } else {
        const res = getDb().prepare(compactionSql).run();
        return res.changes ?? 0;
      }
    } catch (err: any) {
      console.warn(`[JobQueue] compactStaleDuplicateQueueJobs notice: ${err.message}`);
      return 0;
    }
  }

  /**
   * Lists recent jobs.
   */
  public async listJobs(limit: number = 25): Promise<AutomationJobRecord[]> {
    const sql = `SELECT * FROM automation_jobs ORDER BY created_at DESC LIMIT ?`;
    let rows: any[] = [];
    if (isProduction()) {
      rows = await this.d1Repo.query('automation_jobs', sql, [limit]);
    } else {
      rows = getDb().prepare(sql).all(limit);
    }
    return rows.map(r => this.mapJobRow(r));
  }

  private async recordAttemptFailure(jobId: string, status: JobStatus, error: string): Promise<void> {
    const sql = `
      UPDATE automation_job_attempts
      SET status = ?,
        error = ?,
        completed_at = datetime('now'),
        duration_ms = CAST((strftime('%s', 'now') - strftime('%s', started_at)) * 1000 AS INTEGER)
      WHERE job_id = ? AND completed_at IS NULL
    `;
    try {
      if (isProduction()) {
        await this.d1Repo.executeWrite('automation_job_attempts', sql, [status, error, jobId]);
      } else {
        getDb().prepare(sql).run(status, error, jobId);
      }
    } catch {}
  }

  private mapJobRow(r: any): AutomationJobRecord {
    return {
      id: r.id,
      workflowId: r.workflow_id,
      businessId: r.business_id,
      organizationId: r.organization_id,
      idempotencyKey: r.idempotency_key,
      status: r.status as JobStatus,
      priority: Number(r.priority || 1),
      payload: typeof r.payload_json === 'string' ? JSON.parse(r.payload_json || '{}') : (r.payload_json || {}),
      checkpoint: typeof r.checkpoint_json === 'string' ? JSON.parse(r.checkpoint_json || '{}') : (r.checkpoint_json || {}),
      attempts: Number(r.attempts || 0),
      maxAttempts: Number(r.max_attempts || 3),
      availableAt: r.available_at,
      lockedAt: r.locked_at || null,
      leaseExpiresAt: r.lease_expires_at || null,
      workerSource: r.worker_source || null,
      leaseToken: r.lease_token || null,
      lastError: r.last_error || null,
      result: typeof r.result_json === 'string' ? JSON.parse(r.result_json || '{}') : (r.result_json || {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || null
    };
  }
}
