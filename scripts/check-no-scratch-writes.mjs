import fs from 'fs';
import path from 'path';

const MUTATION_REGEX = /\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|drop\s+table)\b/i;
const D1_ENDPOINT_REGEX = /api\.cloudflare\.com\/client\/v4\/accounts\/[^\s/]+\/d1\/database\/[^\s/]+\/query|d1\/database\/[^\s/]+\/query/i;

function scanDir(dir) {
  const violations = [];
  if (!fs.existsSync(dir)) return violations;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue; // skip hidden/archived
      violations.push(...scanDir(fullPath));
    } else if (/\.(m?js|cjs|ts|ps1|sh)$/i.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (D1_ENDPOINT_REGEX.test(content) && MUTATION_REGEX.test(content)) {
        violations.push({ file: fullPath, reason: 'Contains direct D1 REST API mutation query' });
      }
    }
  }
  return violations;
}

function main() {
  console.log('Checking for unauthorized production D1 writes from scripts/ and scratch/...');
  const dirs = ['scripts', 'scratch'];
  let totalViolations = [];

  for (const dir of dirs) {
    const v = scanDir(dir);
    totalViolations.push(...v);
  }

  if (totalViolations.length > 0) {
    console.error(`\nFAILED: Found ${totalViolations.length} unauthorized D1 REST mutation script(s):`);
    for (const item of totalViolations) {
      console.error(`  - ${item.file}: ${item.reason}`);
    }
    console.error('\nProduction D1 mutations must only be executed via authoritative migration runners or backend engines.');
    process.exit(1);
  }

  console.log('PASS: Zero unauthorized production D1 REST mutations found in scripts/ or scratch/.');
}

main();
