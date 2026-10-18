import fs from 'fs';
import path from 'path';
import { D1Client } from './packages/backend/src/db/d1-client.js';

// Load env
for (const envFile of ['.env.local', '.env.deploy_secrets', '.env']) {
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  }
}

const dir = path.resolve('packages/backend/src/db/d1-migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

console.log('=== LOCAL MIGRATION FILES (' + files.length + ') ===');
files.forEach((f, idx) => {
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const firstLine = lines[0] || '(empty)';
  console.log(`${idx + 1}. [${f}] -> ${firstLine}`);
});

console.log('\n=== PRODUCTION D1 _d1_migrations ===');
async function run() {
  const d1 = D1Client.getInstance();
  const res = await d1.executeQuery('SELECT id, migration_name, applied_at FROM _d1_migrations ORDER BY id ASC;', [], false, 'P0');
  console.log('D1 Applied Migrations Count:', res.results?.length || 0);
  (res.results || []).forEach(r => {
    console.log(`  ID ${r.id}: ${r.migration_name} (applied_at: ${r.applied_at})`);
  });

  const d1Names = new Set((res.results || []).map(r => r.migration_name));
  const fileNames = new Set(files);

  const inD1NotInFiles = [...d1Names].filter(x => !fileNames.has(x));
  const inFilesNotInD1 = [...fileNames].filter(x => !d1Names.has(x));

  console.log('\n=== PARITY COMPARISON ===');
  console.log('Exists in D1 but NOT in files:', inD1NotInFiles.length > 0 ? inD1NotInFiles : 'NONE');
  console.log('Exists in files but NOT in D1:', inFilesNotInD1.length > 0 ? inFilesNotInD1 : 'NONE');
}

run().catch(console.error);
