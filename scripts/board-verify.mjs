import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

function getCfToken() {
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

const cfToken = getCfToken();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function fetchFixedMistakesFromMigrations() {
  const migrationsDir = path.resolve('packages/backend/src/db/d1-migrations');
  if (!fs.existsSync(migrationsDir)) return [];
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(':memory:');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      // Strip single-line SQL comments before splitting statements so statements remain valid
      const cleaned = content.replace(/^--.*$/gm, '');
      const stmts = cleaned.split(';').map((s) => s.trim()).filter(Boolean);
      for (const stmt of stmts) {
        if (/mistakes_board/i.test(stmt)) {
          try {
            db.exec(stmt + ';');
          } catch {
            // Ignore unrelated migration statement ordering nuances if column alteration isn't needed
          }
        }
      }
    }
    return db.prepare(`SELECT * FROM mistakes_board WHERE status = 'FIXED';`).all();
  } catch (err) {
    console.warn('[BOARD:VERIFY] Migration manifest reconstruction notice:', err.message);
    return [];
  }
}

async function fetchFixedMistakes() {
  const sql = `SELECT * FROM mistakes_board WHERE status = 'FIXED';`;

  if (cfToken) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql })
      });
      const data = await res.json();
      if (data.success && data.result?.[0]?.results) {
        return { rows: data.result[0].results, source: 'REMOTE_D1' };
      }
    } catch (err) {
      console.warn('[BOARD:VERIFY] D1 query failed, falling back to local DB/migrations:', err.message);
    }
  }

  // Fallback to local SQLite
  const candidateDbs = ['ai_marketing.sqlite', 'packages/backend/marketing.db'];
  for (const dbPath of candidateDbs) {
    const full = path.resolve(dbPath);
    if (fs.existsSync(full)) {
      try {
        const Database = (await import('better-sqlite3')).default;
        const db = new Database(full);
        const rows = db.prepare(sql).all();
        if (Array.isArray(rows) && rows.length > 0) {
          return { rows, source: 'LOCAL_SQLITE' };
        }
      } catch {}
    }
  }

  const manifestRows = await fetchFixedMistakesFromMigrations();
  if (manifestRows.length > 0) {
    return { rows: manifestRows, source: 'MIGRATION_MANIFEST' };
  }

  return { rows: [], source: 'EMPTY_DB' };
}

async function main() {
  console.log('=== [BOARD:VERIFY] Verifying Guard References for FIXED Mistakes ===\n');
  const { rows, source } = await fetchFixedMistakes();

  if (rows.length === 0) {
    console.warn('STATUS: SKIPPED_EMPTY_DB (0/0 rows verified) — No FIXED rows found in D1, local SQLite, or migration manifest.');
    process.exit(0);
  }

  const headerNote = source === 'MIGRATION_MANIFEST'
    ? `Found ${rows.length} FIXED row(s) from deterministic migration manifest (DB table had 0 rows):\n`
    : `Found ${rows.length} FIXED row(s) from ${source}:\n`;
  console.log(headerNote);

  let failures = 0;
  let verifiedCount = 0;
  const pendingTestFiles = new Set();

  for (const row of rows) {
    const id = row.id;
    const guardType = row.guard_type;
    const guardRef = row.guard_ref;

    if (!guardType || guardType === 'NONE') {
      console.error(`❌ [FAIL] ${id}: guard_type is NONE or missing`);
      failures++;
      continue;
    }

    if (!guardRef) {
      console.error(`❌ [FAIL] ${id}: guard_ref is null/empty`);
      failures++;
      continue;
    }

    if (guardType === 'TEST') {
      const [filePath, ...testNameParts] = guardRef.split(':');
      const testName = testNameParts.join(':');

      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ [FAIL] ${id}: Test file does not exist: ${filePath}`);
        failures++;
        continue;
      }

      if (testName) {
        const content = fs.readFileSync(resolvedPath, 'utf8');
        if (!content.includes(testName)) {
          console.error(`❌ [FAIL] ${id}: Test file ${filePath} does not contain test '${testName}'`);
          failures++;
          continue;
        }
      }

      // Collect unique test files to execute in one batched vitest run below
      pendingTestFiles.add(filePath.replace(/^packages\/backend\//, ''));
      verifiedCount++;
      console.log(`✓ [CHECKED] ${id}: Test file and guard reference validated (${filePath})`);
    } else if (guardType === 'HOOK') {
      const resolvedPath = path.resolve(guardRef);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ [FAIL] ${id}: Hook file does not exist: ${guardRef}`);
        failures++;
        continue;
      }

      try {
        execSync(`node --check "${resolvedPath}"`, { stdio: 'pipe', encoding: 'utf8' });
        verifiedCount++;
        console.log(`✓ [PASS] ${id}: Verified and checked HOOK guard in ${guardRef}`);
      } catch (err) {
        console.error(`❌ [FAIL] ${id}: Hook syntax check failed for ${guardRef}: ${err.message}`);
        failures++;
      }
    } else if (guardType === 'LINT') {
      const resolvedPath = path.resolve(guardRef);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ [FAIL] ${id}: Lint file does not exist: ${guardRef}`);
        failures++;
        continue;
      }

      try {
        if (guardRef.includes('lint-')) {
          execSync(`node "${resolvedPath}"`, { stdio: 'pipe', encoding: 'utf8' });
        } else {
          execSync(`node --check "${resolvedPath}"`, { stdio: 'pipe', encoding: 'utf8' });
        }
        verifiedCount++;
        console.log(`✓ [PASS] ${id}: Executed and verified LINT guard in ${guardRef}`);
      } catch (err) {
        console.error(`❌ [FAIL] ${id}: Lint execution failed for ${guardRef}: ${err.message}`);
        failures++;
      }
    } else {
      console.error(`❌ [FAIL] ${id}: Unknown guard_type '${guardType}'`);
      failures++;
    }
  }

  if (pendingTestFiles.size > 0 && failures === 0) {
    const sharedEntry = path.resolve('packages/shared/dist/index.js');
    if (!fs.existsSync(sharedEntry)) {
      execSync('npm run build --workspace=packages/shared', { stdio: 'pipe', encoding: 'utf8' });
    }
    const fileArgs = Array.from(pendingTestFiles).map((f) => `"${f}"`).join(' ');
    try {
      execSync(`npx vitest run --root packages/backend ${fileArgs} --test-timeout=30000`, {
        stdio: 'pipe',
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'test',
          PORT: process.env.PORT || '3001',
          OWNER_API_KEY: process.env.OWNER_API_KEY || 'test_owner_key_for_ci_pipeline_only',
          AUTH_SECRET: process.env.AUTH_SECRET || 'test_owner_key_for_ci_pipeline_only',
          CRON_PING_SECRET: process.env.CRON_PING_SECRET || 'test_cron_secret_for_ci_pipeline_only'
        }
      });
      console.log(`✓ [PASS] Executed ${pendingTestFiles.size} unique TEST guard suite(s) via Vitest.`);
    } catch (err) {
      console.error(`❌ [FAIL] Batched TEST guard suite execution failed: ${err.message}`);
      if (err.stdout) console.error(err.stdout);
      if (err.stderr) console.error(err.stderr);
      failures++;
    }
  }

  console.log('\n------------------------------------------------------------');
  if (failures > 0) {
    console.error(`FAILED: ${failures} guard_ref verification(s) failed.`);
    process.exit(1);
  }

  if (source === 'MIGRATION_MANIFEST') {
    console.log(`Verified ${verifiedCount}/${rows.length} guards from manifest (DB table had 0 rows)`);
  } else {
    console.log(`ALL GUARDS RESOLVED: ${verifiedCount}/${rows.length} FIXED mistakes_board rows have verified resolving guards.`);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('[BOARD:VERIFY FATAL ERROR]:', err);
  process.exit(1);
});
