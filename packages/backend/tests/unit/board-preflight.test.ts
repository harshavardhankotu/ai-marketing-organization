import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const repoRoot = fs.existsSync(path.resolve(process.cwd(), 'scripts/board-preflight.mjs'))
  ? process.cwd()
  : path.resolve(process.cwd(), '../..');
const preflightScriptPath = path.resolve(repoRoot, 'scripts/board-preflight.mjs');
const preflightScriptUrl = pathToFileURL(preflightScriptPath).href;

describe('Stage 1 — Board Preflight Audit Truth Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails with REMOTE_UNAVAILABLE and non-zero exit code when remote D1 is unreachable and no --local-test flag is passed', async () => {
    const { runPreflight } = await import(preflightScriptUrl);

    // Simulate missing or failing remote D1
    const mockFetch = vi.fn().mockRejectedValue(new Error('Cloudflare D1 Network Timeout'));

    const result = await runPreflight({
      localTest: false,
      cfToken: 'invalid_token_test',
      fetchFn: mockFetch
    });

    expect(result.state).toBe('REMOTE_UNAVAILABLE');
    expect(result.exitCode).not.toBe(0);
    expect(result.message).toContain('Remote D1 unavailable');
  });

  it('allows local SQLite inspection ONLY when explicit localTest option or PREFLIGHT_MODE=local_test is set', async () => {
    const { runPreflight } = await import(preflightScriptUrl);

    const result = await runPreflight({
      localTest: true,
      dbPath: path.resolve('marketing.db')
    });

    expect(result.state).toBe('LOCAL_TEST_ONLY');
  });

  it('returns REMOTE_VERIFIED_OPEN_ISSUES when remote D1 responds with open mistakes', async () => {
    const { runPreflight } = await import(preflightScriptUrl);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{
          results: [
            { id: 'MST-001', severity: 'P1', recurrence_count: 2, title: 'Unattributed Click', rule: 'Attribution required', guard_type: 'TEST', guard_ref: 'test.ts' }
          ]
        }]
      })
    });

    const result = await runPreflight({
      localTest: false,
      cfToken: 'test_token',
      fetchFn: mockFetch
    });

    expect(result.state).toBe('REMOTE_VERIFIED_OPEN_ISSUES');
    expect(result.openMistakes.length).toBe(1);
    expect(result.p1Count).toBe(1);
    expect(result.exitCode).toBe(1); // Open P1 issues must fail preflight
  });

  it('returns REMOTE_VERIFIED_EMPTY when remote D1 responds with 0 open mistakes', async () => {
    const { runPreflight } = await import(preflightScriptUrl);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{
          results: []
        }]
      })
    });

    const result = await runPreflight({
      localTest: false,
      cfToken: 'test_token',
      fetchFn: mockFetch
    });

    expect(result.state).toBe('REMOTE_VERIFIED_EMPTY');
    expect(result.openMistakes.length).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  it('fails with REMOTE_UNAVAILABLE when remote D1 returns malformed response', async () => {
    const { runPreflight } = await import(preflightScriptUrl);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'Bad Gateway'
    });

    const result = await runPreflight({
      localTest: false,
      cfToken: 'test_token',
      fetchFn: mockFetch
    });

    expect(result.state).toBe('REMOTE_UNAVAILABLE');
    expect(result.exitCode).toBe(1);
  });

  it('does NOT execute generate-lessons.mjs or mutate LESSONS.md during preflight', async () => {
    const lessonsPath = path.resolve(repoRoot, 'LESSONS.md');
    const initialContent = fs.existsSync(lessonsPath) ? fs.readFileSync(lessonsPath, 'utf8') : '';
    const initialMtime = fs.existsSync(lessonsPath) ? fs.statSync(lessonsPath).mtimeMs : 0;

    const { runPreflight } = await import(preflightScriptUrl);

    await runPreflight({
      localTest: true
    });

    if (fs.existsSync(lessonsPath)) {
      const currentContent = fs.readFileSync(lessonsPath, 'utf8');
      const currentMtime = fs.statSync(lessonsPath).mtimeMs;
      expect(currentContent).toBe(initialContent);
      expect(currentMtime).toBe(initialMtime);
    }
  });
});
