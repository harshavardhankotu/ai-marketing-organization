import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplyDeskService, PublicRequestItem } from '../../src/revenue/reply-desk.js';
import { NextBestActionEngine } from '../../src/revenue/next-best-action-engine.js';
import { OwnerDigestService } from '../../src/revenue/owner-digest.js';
import { D1RevenueRepository } from '../../src/db/d1-revenue-repository.js';
import { getDb, resetDbForTesting } from '../../src/db/client.js';
import { OwnerAuthService } from '../../src/auth/owner-auth.js';

describe('Production Quota Safety & D1 Fail-Closed Architecture (Section C)', () => {
  const replyDesk = ReplyDeskService.getInstance();
  const nba = NextBestActionEngine.getInstance();
  const ownerDigest = OwnerDigestService.getInstance();
  const d1Repo = D1RevenueRepository.getInstance();

  const bizId = OwnerAuthService.PLATFORM_BUSINESS_ID;
  const orgId = OwnerAuthService.OWNER_ORGANIZATION_ID;

  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    vi.restoreAllMocks();
    resetDbForTesting();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('1. D1 quota read success: returns count from D1, ignoring divergent local SQLite count', async () => {
    const db = getDb();
    // Populate local SQLite with 5 rows
    const stmt = db.prepare(`
      INSERT INTO reply_desk_query_runs (id, query, run_date, provider, execution_time_ms, success, result_count)
      VALUES (?, 'test query', date('now'), 'TAVILY', 100, 1, 1)
    `);
    for (let i = 0; i < 5; i++) {
      stmt.run(`local_run_${i}_${Date.now()}`);
    }

    // Mock D1 returning exactly 1 run
    const queryOneSpy = vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ count: 1 });

    const count = await replyDesk.getQueriesRunTodayAsync();
    expect(count).toBe(1); // D1 is the single source of truth, NOT local SQLite (5)
    expect(queryOneSpy).toHaveBeenCalledWith(
      'reply_desk_query_runs',
      expect.stringContaining('SELECT COUNT(*) as count FROM reply_desk_query_runs WHERE run_date = ?'),
      expect.any(Array)
    );
  });

  it('2. D1 quota read failure: throws D1_QUOTA_READ_FAILED and does NOT fall back to local SQLite in production', async () => {
    const db = getDb();
    // Local SQLite is clean (0 rows)
    const localCount = db.prepare(`SELECT COUNT(*) as count FROM reply_desk_query_runs`).get() as any;
    expect(localCount.count).toBe(0);

    // Mock D1 network failure
    vi.spyOn(d1Repo, 'queryOne').mockRejectedValue(new Error('Cloudflare D1 timeout'));

    await expect(replyDesk.getQueriesRunTodayAsync()).rejects.toThrow(/D1_QUOTA_READ_FAILED/);
  });

  it('3. D1 quota read failure blocks external provider search call', async () => {
    vi.spyOn(d1Repo, 'queryOne').mockRejectedValue(new Error('D1 read 503 Service Unavailable'));
    const mockSearchFn = vi.fn().mockResolvedValue([]);

    await expect(replyDesk.discoverAndDraftReplies(undefined, mockSearchFn)).rejects.toThrow(/D1_QUOTA_READ_FAILED/);
    expect(mockSearchFn).not.toHaveBeenCalled();
  });

  it('4. Query cap at 2 enforced: blocks search when D1 reports 2 runs today', async () => {
    vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ count: 2 });
    const mockSearchFn = vi.fn().mockResolvedValue([]);

    const result = await replyDesk.discoverAndDraftReplies(undefined, mockSearchFn);
    expect(result.queriesRun).toBe(0);
    expect(result.message).toContain('Maximum 2 Tavily queries per day reached');
    expect(mockSearchFn).not.toHaveBeenCalled();
  });

  it('5. NextBestActionEngine synchronous rankAll in production fails closed without queriesRunToday option', () => {
    // In production, synchronous rankAll must never read local SQLite and must fail closed (queriesRun = 2)
    const actions = nba.rankAll(bizId, orgId);
    const replyAction = actions.find(a => a.actionType === 'REPLY_DESK_DISCOVER');
    expect(replyAction).toBeUndefined(); // Fail-closed: not ranked
  });

  it('6. NextBestActionEngine chooseAsync in production fetches D1 quota and fails closed on D1 read failure', async () => {
    // When D1 read fails
    vi.spyOn(d1Repo, 'queryOne').mockRejectedValue(new Error('D1 unreachable'));

    const bestAction = await nba.chooseAsync(bizId, orgId);
    // REPLY_DESK_DISCOVER must NOT be chosen on D1 quota error
    expect(bestAction.actionType).not.toBe('REPLY_DESK_DISCOVER');
  });

  it('7. NextBestActionEngine rankAllAsync allows REPLY_DESK_DISCOVER when D1 confirms 0 runs today', async () => {
    vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ count: 0 });

    const actions = await nba.rankAllAsync(bizId, orgId, { ignoreCooldown: true });
    const replyAction = actions.find(a => a.actionType === 'REPLY_DESK_DISCOVER');
    expect(replyAction).toBeDefined();
    expect(replyAction?.priorityTier).toBe('P0');
    expect(replyAction?.score).toBe(950);
  });

  it('8. D1 write failure in production returns failure and halts draft creation', async () => {
    vi.spyOn(d1Repo, 'queryOne').mockResolvedValue({ count: 0 });
    vi.spyOn(d1Repo, 'query').mockResolvedValue([]);
    vi.spyOn(d1Repo, 'executeWrite').mockRejectedValue(new Error('D1 disk quota full'));

    const mockSearchFn = vi.fn().mockResolvedValue([
      {
        title: 'how to handle missed patient calls dental clinic whatsapp India',
        snippet: 'Dentists asking how to capture evening missed patient calls without night receptionist',
        url: 'https://practicemanagers.in/questions/456',
        date: '2026-10-18'
      }
    ] as PublicRequestItem[]);

    await expect(replyDesk.discoverAndDraftReplies(undefined, mockSearchFn)).rejects.toThrow(/D1_PERSISTENCE_FAILED/);
  });

  it('9. OwnerDigestService generateDigestAsync in production queries D1 and reports UNKNOWN on failure without falling back to SQLite', async () => {
    // D1 queries fail
    vi.spyOn(d1Repo, 'query').mockRejectedValue(new Error('D1 connection failed'));
    vi.spyOn(d1Repo, 'queryOne').mockRejectedValue(new Error('D1 connection failed'));

    const digest = await ownerDigest.generateDigestAsync();
    expect(digest).toBeDefined();
    expect(digest.replyDrafts).toBe('UNKNOWN'); // D1 error reported as UNKNOWN, not disguised as local SQLite

    const creditPainPoint = digest.topPainPoints.find(p => p.rank === 5);
    expect(creditPainPoint).toBeDefined();
    expect(creditPainPoint?.metric).toContain('Tavily searches today: UNKNOWN');
  });

  it('10. OwnerDigestService formatTelegramMessage handles UNKNOWN replyDrafts without crashing', () => {
    const fakeDigest = {
      date: '2026-10-19',
      yesterdayDate: '2026-10-18',
      missingOwnerFacts: [],
      replyDrafts: 'UNKNOWN' as const,
      proposalDrafts: [],
      outreachRows: [],
      inquiries: [],
      topPainPoints: [],
      yesterdayMetrics: { visits: 'UNKNOWN' as const, clicks: 'UNKNOWN' as const, leads: 'UNKNOWN' as const, payments: 'UNKNOWN' as const },
      nextAction: 'Review operations.'
    };

    const text = ownerDigest.formatTelegramMessage(fakeDigest);
    expect(text).toContain('Reply Drafts:* UNKNOWN');
    expect(text).not.toContain('undefined');
  });
});
