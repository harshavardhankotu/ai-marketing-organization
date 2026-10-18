import { queryD1 } from './d1-read.mjs';

async function main() {
  const rows = await queryD1(`
    SELECT id, source_url, topic, category, status, signal_type, created_at 
    FROM demand_signals 
    WHERE status NOT IN ('QUARANTINED', 'SEEDED', 'SEEDED_MIGRATION_0026', 'UNSOURCED', 'DUPLICATE', 'UNSUPPORTED', 'UNSUPPORTED_BY_DEMAND', 'PAUSED_SEEDED_DEMAND') 
      AND source_url LIKE 'http%' 
      AND source_url NOT LIKE '%search.community%' 
      AND source_url NOT LIKE '%localhost%' 
      AND source_url NOT LIKE '%example.com%' 
      AND source_url NOT LIKE '%test.local%'
  `);
  console.log(`Found ${rows.length} rows:`);
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error);
