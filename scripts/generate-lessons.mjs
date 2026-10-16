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

async function queryD1(sql, params = []) {
  if (!cfToken) return [];
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    return data.result?.[0]?.results || [];
  } catch {
    return [];
  }
}

async function queryData(sql, params = []) {
  if (cfToken) {
    const res = await queryD1(sql, params);
    if (res && res.length > 0) return res;
  }
  try {
    const Database = (await import('better-sqlite3')).default;
    const dbPath = path.resolve('packages/backend/marketing.db');
    if (fs.existsSync(dbPath)) {
      const db = new Database(dbPath);
      return db.prepare(sql).all(...params);
    }
  } catch {}
  return [];
}

async function generateLessons() {
  console.log('=== GENERATING LESSONS.MD ===');

  // 1. Fetch Mistakes
  const mistakes = await queryData(`
    SELECT id, severity, recurrence_count, title, rule, what_happened, cause, guard_type, guard_ref, status
    FROM mistakes_board
    ORDER BY CASE severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END, recurrence_count DESC;
  `);

  // 2. Fetch Learning Records
  const learnings = await queryData(`
    SELECT id, what, outcome, cause, rule, source, created_at
    FROM learning_records
    ORDER BY created_at DESC LIMIT 20;
  `);

  // 3. Git commit log
  let gitHistory = '';
  try {
    gitHistory = execSync('git log -n 12 --pretty=format:"* %h - %cd: %s" --date=short').toString().trim();
  } catch {
    gitHistory = '* Local git commit history unavailable';
  }

  const dateStr = new Date().toISOString().split('T')[0];

  let md = `# Engineering & Operational Lessons Learned

> **Generated:** ${dateStr}
> **Repository:** \`harshavardhankotu/ai-marketing-organization\`
> **Core Principle:** Zero synthetic metrics, zero fabricated demand, zero unverified revenue, zero agent default assumptions.

---

## 1. Executive Summary & Foundational Rules

1. **Demand Provenance Gate:** Every demand signal must trace to an external URL. Fixtures or mock signals (\`search.community\`) must never enter production D1, count toward 3-signal gates, or justify offer creation.
2. **Four-State Payment Truth:** Commercial revenue is NEVER recorded from page visits, proposal creations, or self-reported claims. Truth progresses through:
   \`PAYMENT_PAGE_VIEW\` (traffic only) &rarr; \`PAYMENT_CLAIMED\` (customer UTR entered, ₹0 ledgered) &rarr; \`MANUAL_VERIFIED\` (owner confirms bank statement credit) &rarr; \`EXPORT_VERIFIED\` (reconciled against bank/gateway settlement export).
3. **Statutory Owner Boundary:** The system strictly prohibits agents from setting, guessing, or defaulting statutory owner facts (PAN, GST, UPI VPA, Amazon Associates dates). All owner facts require explicit manual entry via \`scripts/owner-apply.mjs\` or owner form.
4. **Hermetic Test Isolation:** Tests must NEVER spend live provider credits (Tavily, Gemini, Firecrawl) or mutate production storage.
5. **Deployment Parity:** Production deployments must strictly match local git HEAD (\`HEAD === render_commit\`), and no code may deploy while CI is red.

---

## 2. Lessons from Mistakes Board (Root Cause & Permanent Guards)

| Mistake ID | Sev | What Failed | Root Cause | Permanent Guard | New Operational Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
`;

  for (const m of mistakes) {
    const guardDesc = `${m.guard_type}${m.guard_ref ? ` (\`${m.guard_ref}\`)` : ''}`;
    md += `| **${m.id}** | \`${m.severity}\` | ${m.what_happened || m.title} | ${m.cause || 'Unchecked assumption'} | ${guardDesc} | ${m.rule} |\n`;
  }

  md += `\n---

## 3. Empirical Learning Records (From Production Engine)

`;

  if (learnings.length === 0) {
    md += `*No empirical learning records found in database.*\\n`;
  } else {
    for (const l of learnings) {
      md += `### ${l.what} (${l.outcome})\n`;
      md += `- **Date:** ${l.created_at || 'Recorded'}\n`;
      md += `- **Root Cause:** ${l.cause}\n`;
      md += `- **Governing Rule:** ${l.rule}\n`;
      if (l.source) md += `- **Source:** \`${l.source}\`\n`;
      md += `\n`;
    }
  }

  md += `---

## 4. Recent Verified Git Commits

\`\`\`text
${gitHistory}
\`\`\`

---

## 5. Verification Checklist for Future Changes

- [ ] Run \`npm run board:preflight\` before starting any task.
- [ ] Run \`npm run board:verify\` after making changes to verify all guards pass.
- [ ] Ensure 0 test fixtures are present in production D1 migrations (\`no-fixture-migrations.test.ts\`).
- [ ] Ensure all 6 statutory owner facts remain unguested (\`owner-facts-and-publish-gate.test.ts\`).
- [ ] Ensure test suite executes 100% hermetically with 0 API credit consumption.
`;

  fs.writeFileSync(path.resolve('LESSONS.md'), md, 'utf8');
  console.log('Successfully written LESSONS.md');
}

generateLessons().catch(err => {
  console.error('Failed to generate lessons:', err);
  process.exit(1);
});
