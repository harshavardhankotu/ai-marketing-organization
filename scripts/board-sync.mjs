import fs from 'fs';
import path from 'path';

function getCfToken() {
  if (process.env.CLOUDFLARE_D1_API_TOKEN) return process.env.CLOUDFLARE_D1_API_TOKEN;
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const envPath = path.resolve('.env.deploy_secrets');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/CLOUDFLARE_API_TOKEN=([^\r\n]+)/);
    if (match) return match[1].trim();
  }
  return null;
}

const cfToken = getCfToken();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '9b7511ff69e507dd3a00a7266fec11a3';
const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID || '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function fetchOpenMistakes() {
  const sql = `
    SELECT * FROM mistakes_board
    WHERE status = 'OPEN'
    ORDER BY CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, recurrence_count DESC, id ASC;
  `;

  // Try D1 REST API first if token provided
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
      console.warn('[BOARD:SYNC] D1 query failed, checking local SQLite:', err.message);
    }
  }

  // Fallback to local SQLite if available
  try {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.resolve('packages/backend/marketing.db');
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      return db.prepare(sql).all();
    }
  } catch {}

  return [];
}

async function main() {
  console.log('[BOARD:SYNC] Fetching OPEN mistakes from mistakes_board...');
  const rows = await fetchOpenMistakes();
  console.log(`[BOARD:SYNC] Found ${rows.length} OPEN rows.`);

  const now = new Date().toISOString();
  let markdown = `# Mistakes Board — Active Rules & Guardrails\n\n`;
  markdown += `> Auto-generated from Cloudflare D1 mistakes_board at ${now}\n`;
  markdown += `> Total Open Rules: ${rows.length}\n`;
  markdown += `> Antigravity loads this file at session start. Do not delete.\n\n`;
  markdown += `## Active Guardrails (Sorted by Severity, then Recurrence)\n\n`;

  for (const r of rows) {
    markdown += `### [${r.severity}] ${r.title}\n`;
    markdown += `- **ID:** \`${r.id}\`\n`;
    markdown += `- **Severity:** ${r.severity} | **Recurrence:** ${r.recurrence_count} | **Status:** ${r.status}\n`;
    markdown += `- **Rule:** **${r.rule}**\n`;
    markdown += `- **What Happened:** ${r.what_happened}\n`;
    markdown += `- **Cause:** ${r.cause}\n`;
    markdown += `- **Guard:** ${r.guard_type}${r.guard_ref ? ` (\`${r.guard_ref}\`)` : ''}\n\n`;
  }

  const outDir = path.resolve('.agents/rules');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'mistakes.md');
  fs.writeFileSync(outFile, markdown, 'utf-8');

  console.log(`[BOARD:SYNC] Wrote ${rows.length} open rules to ${outFile}`);
}

main().catch(err => {
  console.error('[BOARD:SYNC ERROR]:', err);
  process.exit(1);
});
