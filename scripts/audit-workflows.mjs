import fs from 'fs';
import path from 'path';

const candidatePaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env.deploy_secrets'),
  path.resolve(process.cwd(), '.env.render.production'),
];

for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    try {
      const text = fs.readFileSync(p, 'utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.substring(0, eqIdx).trim();
          let val = trimmed.substring(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }
}

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;

async function query(sql) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params: [] }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errText}`);
  }
  const json = await response.json();
  return json?.result?.[0]?.results || [];
}

async function main() {
  const q1 = await query("SELECT count(*) as count_7d FROM automation_execution_log WHERE datetime(started_at) >= datetime('now', '-7 days')");
  console.log("=== Last 7 Days Total Executions ===");
  console.log(JSON.stringify(q1, null, 2));

  const q2 = await query("SELECT workflow_id, count(*) as runs, sum(case when status='COMPLETED' then 1 else 0 end) as completed, max(started_at) as last_run FROM automation_execution_log WHERE datetime(started_at) >= datetime('now', '-7 days') GROUP BY workflow_id ORDER BY runs DESC");
  console.log("=== Last 7 Days By Workflow ===");
  console.log(JSON.stringify(q2, null, 2));

  const q3 = await query("SELECT id, name, category, enabled, last_status, last_completed_at FROM automation_registry ORDER BY id ASC");
  console.log("=== Registered Workflows Current State ===");
  console.log(JSON.stringify(q3, null, 2));
}

main().catch(console.error);
