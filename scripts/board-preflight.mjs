/**
 * Board Preflight Audit Script (Strict Read-Only & Remote D1 Truth)
 *
 * Implements Stage 1 Preflight Truth Rules:
 * 1. Strictly read-only: Does NOT mutate LESSONS.md or invoke generate-lessons.mjs.
 * 2. Never converts unreachable or unauthenticated remote D1 into "0 mistakes".
 * 3. Local SQLite fallback is permitted ONLY with explicit `--local-test` or `PREFLIGHT_MODE=local_test`.
 * 4. Outputs explicit preflight states:
 *    - REMOTE_VERIFIED_EMPTY (exit code 0)
 *    - REMOTE_VERIFIED_OPEN_ISSUES (exit code 1 if P0/P1 open, otherwise 0 or 1 depending on policy)
 *    - LOCAL_TEST_ONLY (explicit local test mode)
 *    - REMOTE_UNAVAILABLE (exit code 1)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function getCfToken() {
  if (process.env.CLOUDFLARE_D1_API_TOKEN) return process.env.CLOUDFLARE_D1_API_TOKEN;
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  for (const envFile of ['.env.local', '.env.deploy_secrets']) {
    const envPath = path.resolve(envFile);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/CLOUDFLARE_API_TOKEN=([^\r\n]+)/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

export const SQL_OPEN_MISTAKES = `
  SELECT id, severity, recurrence_count, title, rule, guard_type, guard_ref
  FROM mistakes_board
  WHERE status = 'OPEN'
  ORDER BY CASE severity WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, recurrence_count DESC, id ASC;
`;

export async function runPreflight(options = {}) {
  const localTest = Boolean(
    options.localTest ||
    process.argv.includes('--local-test') ||
    process.env.PREFLIGHT_MODE === 'local_test'
  );

  const fetchFn = options.fetchFn || fetch;
  const cfToken = options.cfToken !== undefined ? options.cfToken : getCfToken();
  const accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
  const dbId = options.dbId || process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

  // 1. If explicit local-test mode is requested
  if (localTest) {
    let rows = [];
    try {
      const Database = (await import('better-sqlite3')).default;
      const candidatePaths = [
        options.dbPath,
        path.resolve('packages/backend/marketing.db'),
        path.resolve('marketing.db'),
        path.resolve('ai_marketing.sqlite')
      ].filter(Boolean);

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const db = new Database(p);
          rows = db.prepare(SQL_OPEN_MISTAKES).all();
          break;
        }
      }
    } catch (dbErr) {
      // Local db error in local-test mode
      return {
        state: 'LOCAL_TEST_ONLY',
        openMistakes: [],
        p0Count: 0,
        p1Count: 0,
        message: `[LOCAL_TEST_ONLY] Local SQLite read error: ${dbErr.message}`,
        exitCode: 1
      };
    }

    const p0Count = rows.filter(r => r.severity === 'P0').length;
    const p1Count = rows.filter(r => r.severity === 'P1').length;
    const exitCode = (p0Count > 0 || p1Count > 0) ? 1 : 0;

    return {
      state: 'LOCAL_TEST_ONLY',
      openMistakes: rows,
      p0Count,
      p1Count,
      message: `[LOCAL_TEST_ONLY] Audited local SQLite. Found ${rows.length} open mistakes (${p0Count} P0, ${p1Count} P1).`,
      exitCode
    };
  }

  // 2. Remote D1 verification mode (Default & Required for Production/CI)
  if (!cfToken) {
    return {
      state: 'REMOTE_UNAVAILABLE',
      openMistakes: [],
      p0Count: 0,
      p1Count: 0,
      message: '[REMOTE_UNAVAILABLE] Cloudflare D1 credentials missing (CLOUDFLARE_API_TOKEN / CLOUDFLARE_D1_API_TOKEN). Pass --local-test for offline testing.',
      exitCode: 1
    };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql: SQL_OPEN_MISTAKES })
    });

    if (!res.ok) {
      const errText = typeof res.text === 'function' ? await res.text() : `HTTP ${res.status}`;
      return {
        state: 'REMOTE_UNAVAILABLE',
        openMistakes: [],
        p0Count: 0,
        p1Count: 0,
        message: `[REMOTE_UNAVAILABLE] Remote D1 query failed (HTTP ${res.status}: ${errText}). Halting preflight truth.`,
        exitCode: 1
      };
    }

    const data = await res.json();
    if (!data.success || !Array.isArray(data.result?.[0]?.results)) {
      return {
        state: 'REMOTE_UNAVAILABLE',
        openMistakes: [],
        p0Count: 0,
        p1Count: 0,
        message: `[REMOTE_UNAVAILABLE] Malformed or unsuccessful response from Cloudflare D1.`,
        exitCode: 1
      };
    }

    const rows = data.result[0].results;
    const p0Count = rows.filter(r => r.severity === 'P0').length;
    const p1Count = rows.filter(r => r.severity === 'P1').length;

    if (rows.length === 0) {
      return {
        state: 'REMOTE_VERIFIED_EMPTY',
        openMistakes: [],
        p0Count: 0,
        p1Count: 0,
        message: '[REMOTE_VERIFIED_EMPTY] Verified remote Cloudflare D1: Zero OPEN mistakes on the board.',
        exitCode: 0
      };
    }

    const exitCode = (p0Count > 0 || p1Count > 0) ? 1 : 0;
    return {
      state: 'REMOTE_VERIFIED_OPEN_ISSUES',
      openMistakes: rows,
      p0Count,
      p1Count,
      message: `[REMOTE_VERIFIED_OPEN_ISSUES] Remote D1 verified ${rows.length} active open mistakes (${p0Count} P0, ${p1Count} P1).`,
      exitCode
    };
  } catch (netErr) {
    return {
      state: 'REMOTE_UNAVAILABLE',
      openMistakes: [],
      p0Count: 0,
      p1Count: 0,
      message: `[REMOTE_UNAVAILABLE] Remote D1 unavailable: network or connection fault: ${netErr.message}. Halting to prevent false-success fallback.`,
      exitCode: 1
    };
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('             MISTAKES BOARD PREFLIGHT AUDIT           ');
  console.log('======================================================\n');

  const result = await runPreflight();
  console.log(`Preflight State: ${result.state}`);
  console.log(result.message);
  console.log('');

  if (result.openMistakes.length > 0) {
    console.log(`⚠️  ${result.openMistakes.length} OPEN MISTAKES ACTIVE. REVIEW BEFORE PROCEEDING:\n`);
    for (let i = 0; i < result.openMistakes.length; i++) {
      const r = result.openMistakes[i];
      console.log(`[${i + 1}] [${r.severity}] ${r.title} (Recurrence: ${r.recurrence_count})`);
      console.log(`    Rule: ${r.rule}`);
      console.log(`    Guard: ${r.guard_type}${r.guard_ref ? ` (${r.guard_ref})` : ''}`);
      console.log('');
    }
  }

  console.log('======================================================\n');
  process.exit(result.exitCode);
}

// Only execute main if invoked directly as CLI entrypoint
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === currentFile) {
  main().catch(err => {
    console.error('[BOARD:PREFLIGHT ERROR]:', err);
    process.exit(1);
  });
}
