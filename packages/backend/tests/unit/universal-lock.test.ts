import { describe, it, expect, beforeEach } from 'vitest';
import { UniversalLockManager, UniversalQuotaLockError } from '../../src/quota/universal-lock-manager.js';
import { resetDbForTesting } from '../../src/db/client.js';

describe('Universal Free-Tier Quota Lock & Circuit Breaker', () => {
  let lockManager: UniversalLockManager;

  beforeEach(() => {
    resetDbForTesting();
    lockManager = UniversalLockManager.getInstance();
  });

  it('allows calls when below daily free tier limit', () => {
    expect(() => {
      lockManager.checkCanExecute('GOOGLE_CUSTOM_SEARCH');
    }).not.toThrow();

    expect(() => {
      lockManager.checkCanExecute('GEMINI_API');
    }).not.toThrow();

    const status = lockManager.getStatus();
    expect(status.freeTierEnforced).toBe(true);
    expect(status.services.GOOGLE_CUSTOM_SEARCH.maxFreeDailyRequests).toBe(100);
    expect(status.services.GEMINI_API.maxFreeDailyRequests).toBe(1500);
    expect(status.services.GOOGLE_CUSTOM_SEARCH.isLocked).toBe(false);
  });

  it('strictly engages lock when Google Custom Search reaches 100 free queries', () => {
    // Record 99 calls
    lockManager.recordOutboundCall('GOOGLE_CUSTOM_SEARCH', 99);
    expect(lockManager.getStatus().services.GOOGLE_CUSTOM_SEARCH.remainingFreeRequests).toBe(1);
    expect(lockManager.getStatus().services.GOOGLE_CUSTOM_SEARCH.isLocked).toBe(false);

    // Record 100th call
    lockManager.recordOutboundCall('GOOGLE_CUSTOM_SEARCH', 1);
    expect(lockManager.getStatus().services.GOOGLE_CUSTOM_SEARCH.isLocked).toBe(true);
    expect(lockManager.getStatus().services.GOOGLE_CUSTOM_SEARCH.remainingFreeRequests).toBe(0);

    // 101st attempt must be hard-blocked
    expect(() => {
      lockManager.checkCanExecute('GOOGLE_CUSTOM_SEARCH');
    }).toThrow(UniversalQuotaLockError);
  });

  it('trips lock immediately upon upstream 429 quota exhaustion', () => {
    lockManager.engageLock('GOOGLE_CUSTOM_SEARCH', 'HTTP 429 quotaExceeded from Google API');

    const status = lockManager.getStatus();
    expect(status.services.GOOGLE_CUSTOM_SEARCH.isLocked).toBe(true);
    expect(status.services.GOOGLE_CUSTOM_SEARCH.lockReason).toContain('429');

    expect(() => {
      lockManager.checkCanExecute('GOOGLE_CUSTOM_SEARCH');
    }).toThrow(UniversalQuotaLockError);
  });

  it('enforces independent locks per service (Gemini unaffected by Google Search lock)', () => {
    lockManager.engageLock('GOOGLE_CUSTOM_SEARCH', 'Google Search 100/100 limit reached');

    expect(() => {
      lockManager.checkCanExecute('GOOGLE_CUSTOM_SEARCH');
    }).toThrow(UniversalQuotaLockError);

    // Gemini API remains unlocked and usable
    expect(() => {
      lockManager.checkCanExecute('GEMINI_API');
    }).not.toThrow();

    expect(lockManager.getStatus().services.GEMINI_API.isLocked).toBe(false);
  });
});
