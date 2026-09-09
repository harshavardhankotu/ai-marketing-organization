import { getDb } from '../db/client.js';
import { TaskPriority, QuotaStatus } from '@ai-marketing/shared';

export interface QueuedTask<T> {
  id: string;
  priority: TaskPriority;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
  createdAt: number;
}

export class QuotaManager {
  private static instance: QuotaManager;

  private activeConcurrent = 0;
  private readonly maxConcurrent = 3; // Free-tier safe concurrency limit
  private readonly priorityWeights: Record<TaskPriority, number> = {
    CRITICAL: 100,
    HIGH: 50,
    NORMAL: 20,
    LOW: 5,
    BACKGROUND: 1
  };

  private queue: QueuedTask<any>[] = [];
  private consecutiveFailures = 0;
  private circuitBreakerTrippedUntil = 0;

  private constructor() {}

  public static getInstance(): QuotaManager {
    if (!QuotaManager.instance) {
      QuotaManager.instance = new QuotaManager();
    }
    return QuotaManager.instance;
  }

  public async schedule<T>(
    taskId: string,
    priority: TaskPriority,
    fn: () => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: taskId,
        priority,
        execute: fn,
        resolve,
        reject,
        createdAt: Date.now()
      });

      // Sort queue by priority weight (descending) then creation time (ascending)
      this.queue.sort((a, b) => {
        const weightDiff = this.priorityWeights[b.priority] - this.priorityWeights[a.priority];
        if (weightDiff !== 0) return weightDiff;
        return a.createdAt - b.createdAt;
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.activeConcurrent >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    if (Date.now() < this.circuitBreakerTrippedUntil) {
      // Circuit breaker is active, delay processing
      setTimeout(() => this.processQueue(), 1000);
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.activeConcurrent++;
    try {
      const result = await this.executeWithRetry(task.execute);
      this.recordSuccess();
      task.resolve(result);
    } catch (error) {
      this.recordFailure(error);
      task.reject(error);
    } finally {
      this.activeConcurrent--;
      this.processQueue();
    }
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let attempts = 0;
    let delay = 1000;

    while (attempts < maxRetries) {
      try {
        return await fn();
      } catch (err: any) {
        attempts++;
        const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
        if (attempts >= maxRetries || (!isRateLimit && err?.status >= 400 && err?.status < 500 && err?.status !== 408)) {
          throw err;
        }
        // Exponential backoff with jitter
        const jitter = Math.random() * 500;
        const waitMs = delay + jitter;
        await new Promise(r => setTimeout(r, waitMs));
        delay *= 2;
      }
    }
    throw new Error('Max retries exceeded in QuotaManager');
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.incrementQuotaRecord(1, 150);
  }

  private recordFailure(error: any): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 5) {
      // Trip circuit breaker for 30 seconds
      this.circuitBreakerTrippedUntil = Date.now() + 30000;
      this.tripCircuitBreakerRecord();
    }
  }

  public getStatus(): QuotaStatus {
    const db = getDb();
    const todayKey = new Date().toISOString().split('T')[0];
    const record = db.prepare('SELECT * FROM quota_records WHERE date_key = ?').get(todayKey) as any;

    const geminiRequestsToday = record?.gemini_requests || 0;
    const geminiTokensToday = record?.gemini_tokens || 0;
    const isTripped = Date.now() < this.circuitBreakerTrippedUntil;

    return {
      freeTierActive: true,
      geminiRequestsToday,
      geminiMaxDailyRequests: 1500, // Safe free-tier daily cap
      geminiTokensToday,
      geminiMaxDailyTokens: 1000000,
      activeConcurrentCalls: this.activeConcurrent,
      maxConcurrentCalls: this.maxConcurrent,
      circuitBreakerTripped: isTripped,
      queueDepth: this.queue.length,
      quotaWarning: geminiRequestsToday > 1200,
      throttledMode: isTripped || this.queue.length > 5
    };
  }

  private incrementQuotaRecord(requests: number, tokens: number): void {
    try {
      const db = getDb();
      const todayKey = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO quota_records (date_key, gemini_requests, gemini_tokens, cloudflare_worker_requests, throttled_events, circuit_breaker_tripped)
        VALUES (?, ?, ?, 1, 0, 0)
        ON CONFLICT(date_key) DO UPDATE SET
          gemini_requests = gemini_requests + ?,
          gemini_tokens = gemini_tokens + ?,
          cloudflare_worker_requests = cloudflare_worker_requests + 1,
          updated_at = datetime('now')
      `).run(todayKey, requests, tokens, requests, tokens);
    } catch {
      // Non-blocking telemetry
    }
  }

  private tripCircuitBreakerRecord(): void {
    try {
      const db = getDb();
      const todayKey = new Date().toISOString().split('T')[0];
      db.prepare(`
        UPDATE quota_records
        SET circuit_breaker_tripped = circuit_breaker_tripped + 1,
            throttled_events = throttled_events + 1,
            updated_at = datetime('now')
        WHERE date_key = ?
      `).run(todayKey);
    } catch {}
  }
}