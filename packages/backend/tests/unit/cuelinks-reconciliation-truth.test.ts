import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CuelinksSyncManager } from '../../src/commission/cuelinks-sync-manager.js';
import { CuelinksV3Client } from '../../src/commission/cuelinks-v3-client.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';

describe('Stage 7 — Cuelinks Transaction Reconciliation Truth Tests', () => {
  let client: CuelinksV3Client;
  let syncMgr: CuelinksSyncManager;
  let d1Repo: D1RevenueRepository;

  beforeEach(() => {
    process.env.CUELINKS_API_KEY = 'test_reconciliation_truth';
    CuelinksV3Client.resetInstance();
    CuelinksSyncManager.resetInstance();
    client = CuelinksV3Client.getInstance();
    syncMgr = CuelinksSyncManager.getInstance(client);
    d1Repo = D1RevenueRepository.getInstance();
  });

  it('routes transactions without explicit INR currency to currencyUnclassifiedCount and does NOT add them to INR totals', async () => {
    vi.spyOn(client, 'getTransactions').mockResolvedValue({
      transactions: [
        {
          id: 'tx_usd_1',
          currency: 'USD',
          user_commission: 50,
          status: 'validated',
          sub_id: 'clk_test_1'
        },
        {
          id: 'tx_nocurr_2',
          currency: undefined, // Missing currency
          user_commission: 100,
          status: 'validated',
          sub_id: 'clk_test_2'
        },
        {
          id: 'tx_inr_3',
          currency: 'INR',
          user_commission: 200,
          status: 'validated',
          sub_id: 'clk_test_3'
        }
      ],
      total_pages: 1
    });

    const res = await syncMgr.reconcileTransactionsIncremental();
    expect(res.currencyUnclassifiedCount).toBe(2);
    expect(res.validatedCommissionINR).toBe(200); // Only the explicit INR transaction!
  });

  it('marks unmatchable sub_id transactions as UNMATCHED without discarding them', async () => {
    vi.spyOn(client, 'getTransactions').mockResolvedValue({
      transactions: [
        {
          id: 'tx_unmatched_100',
          currency: 'INR',
          user_commission: 150,
          status: 'pending',
          sub_id: 'unknown_sub_id_404'
        }
      ],
      total_pages: 1
    });

    const executeWriteSpy = vi.spyOn(d1Repo, 'executeWrite').mockResolvedValue({ rowsAffected: 1, source: 'PERSISTENT_SQLITE' });

    const res = await syncMgr.reconcileTransactionsIncremental();
    expect(res.unmatchedTransactionsCount).toBe(1);

    // Verify params passed to DB has 'UNMATCHED' status
    expect(executeWriteSpy).toHaveBeenCalled();
    const lastCallParams = executeWriteSpy.mock.calls.find(c => c[0] === 'commission_records')?.[2];
    expect(lastCallParams).toBeDefined();
    expect(lastCallParams).toContain('UNMATCHED');
  });

  it('does NOT advance reconciliation cursor if transaction persistence fails', async () => {
    vi.spyOn(client, 'getTransactions').mockResolvedValue({
      transactions: [
        {
          id: 'tx_fail_1',
          currency: 'INR',
          user_commission: 50,
          status: 'pending',
          sub_id: 'clk_test_fail'
        }
      ],
      total_pages: 1
    });

    vi.spyOn(d1Repo, 'executeWrite').mockImplementation(async (table: string) => {
      if (table === 'commission_records') {
        throw new Error('Disk full write failure');
      }
      return { rowsAffected: 1, source: 'PERSISTENT_SQLITE' };
    });

    const priorCursor = (syncMgr as any).lastReconciledSince;
    await syncMgr.reconcileTransactionsIncremental();
    const postCursor = (syncMgr as any).lastReconciledSince;

    expect(postCursor).toBe(priorCursor);
  });
});
