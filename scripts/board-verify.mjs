import fs from 'fs';
import path from 'path';

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
        return data.result[0].results;
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
        return db.prepare(sql).all();
      } catch {}
    }
  }

  return [];
}

async function main() {
  console.log('=== [BOARD:VERIFY] Verifying Guard References for FIXED Mistakes ===\n');
  const rows = await fetchFixedMistakes();

  if (rows.length === 0) {
    console.warn('WARNING: No FIXED rows found in mistakes_board.');
    process.exit(0);
  }

  console.log(`Found ${rows.length} FIXED row(s) to verify:\n`);

  let failures = 0;

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

      console.log(`✓ [PASS] ${id}: Verified TEST guard in ${filePath}`);
    } else if (guardType === 'HOOK') {
      const resolvedPath = path.resolve(guardRef);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ [FAIL] ${id}: Hook file does not exist: ${guardRef}`);
        failures++;
        continue;
      }
      console.log(`✓ [PASS] ${id}: Verified HOOK guard in ${guardRef}`);
    } else if (guardType === 'LINT') {
      const resolvedPath = path.resolve(guardRef);
      if (!fs.existsSync(resolvedPath)) {
        console.error(`❌ [FAIL] ${id}: Lint file does not exist: ${guardRef}`);
        failures++;
        continue;
      }
      console.log(`✓ [PASS] ${id}: Verified LINT guard in ${guardRef}`);
    } else {
      console.error(`❌ [FAIL] ${id}: Unknown guard_type '${guardType}'`);
      failures++;
    }
  }

  console.log('\n------------------------------------------------------------');
  if (failures > 0) {
    console.error(`FAILED: ${failures} guard_ref verification(s) failed.`);
    process.exit(1);
  }

  console.log(`ALL GUARDS RESOLVED: ${rows.length}/${rows.length} FIXED mistakes_board rows have verified resolving guards.`);
  process.exit(0);
}

main().catch(err => {
  console.error('[BOARD:VERIFY FATAL ERROR]:', err);
  process.exit(1);
});
