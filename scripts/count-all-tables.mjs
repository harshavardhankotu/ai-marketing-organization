import fs from 'fs';
import { execSync } from 'child_process';

const envText = fs.readFileSync('.env.local', 'utf8');
const accountId = envText.match(/CLOUDFLARE_ACCOUNT_ID=(.*)/)[1].trim();
const apiToken = envText.match(/CLOUDFLARE_API_TOKEN=(.*)/)[1].trim();
const dbId = '0563bb85-f6d2-483f-8b0f-0784e3d604c7';

async function main() {
  const tableRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_KV' ORDER BY name;"
    })
  });
  const tableData = await tableRes.json();
  const tables = tableData.result[0].results.map(r => r.name);

  console.log(`Found ${tables.length} tables. Querying counts...`);
  const rows = [];
  // Cloudflare D1 query endpoint allows an array of statements or single query.
  // We can query each table or batch in chunks of 5.
  for (let i = 0; i < tables.length; i += 5) {
    const chunk = tables.slice(i, i + 5);
    const promises = chunk.map(async (t) => {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql: `SELECT count(*) as row_count FROM "${t}"` })
      });
      const data = await res.json();
      const cnt = data.success ? data.result[0].results[0].row_count : -1;
      return { table_name: t, row_count: cnt };
    });
    const chunkResults = await Promise.all(promises);
    rows.push(...chunkResults);
  }

  console.log('| Table Name | Row Count |');
  console.log('| :--- | :--- |');
  for (const r of rows) {
    console.log(`| ${r.table_name} | ${r.row_count} |`);
  }

  const nonEmpty = rows.filter(r => r.row_count > 0);
  console.log(`\nNon-empty tables (${nonEmpty.length} total):`);
  for (const r of nonEmpty) {
    console.log(`  ${r.table_name}: ${r.row_count}`);
  }
}

main().catch(console.error);
