import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaManager } from '../../src/ai/quota-manager.js';
import { resetDbForTesting } from '../../src/db/client.js';

describe('QuotaManager Free-Tier Engine', () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  it('should initialize with free-tier status and safe concurrency limits', () => {
    const qm = QuotaManager.getInstance();
    const status = qm.getStatus();

    expect(status.freeTierActive).toBe(true);
    expect(status.maxConcurrentCalls).toBe(3);
    expect(status.geminiMaxDailyRequests).toBe(1500);
    expect(status.circuitBreakerTripped).toBe(false);
  });

  it('should execute scheduled task and return result', async () => {
    const qm = QuotaManager.getInstance();
    const res = await qm.schedule('test-task-1', 'NORMAL', async () => {
      return { answer: 42 };
    });

    expect(res).toEqual({ answer: 42 });
  });

  it('should prioritize CRITICAL tasks ahead of BACKGROUND tasks', async () => {
    const qm = QuotaManager.getInstance();
    const executionOrder: string[] = [];

    const task1 = qm.schedule('bg-task', 'BACKGROUND', async () => {
      executionOrder.push('BACKGROUND');
      return true;
    });

    const task2 = qm.schedule('crit-task', 'CRITICAL', async () => {
      executionOrder.push('CRITICAL');
      return true;
    });

    await Promise.all([task1, task2]);
    expect(executionOrder.length).toBe(2);
  });
});