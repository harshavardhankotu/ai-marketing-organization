import fs from 'fs';
import path from 'path';

/**
 * Lint Guard (Step 4a): Fails when any report script outputs unmasked partner evidence_json.
 */
const filesToCheck = [
  'scripts/generate-status.mjs',
  'scripts/prepare-deploy.mjs',
  'packages/backend/src/commission/owner-control-center.ts'
];

let violations = 0;

for (const relPath of filesToCheck) {
  const fullPath = path.resolve(relPath);
  if (!fs.existsSync(fullPath)) continue;

  const content = fs.readFileSync(fullPath, 'utf8');

  // Check 1: Raw unmasked tag literal in source (marketing98-21)
  if (content.includes('marketing98-21') && !relPath.includes('vitest.config.ts')) {
    // If it's a test file or config it's allowed, but in reporting code it's forbidden
    if (!relPath.includes('test')) {
      console.error(`❌ [FAIL] ${relPath}: Unmasked affiliate tag literal found in source.`);
      violations++;
    }
  }

  // Check 2: Direct unmasked dump of evidence_json
  const unmaskedEvidenceDump = /console\.log\([^)]*evidence_json[^)]*\)/.test(content) &&
    !content.includes('maskAffiliateTag') &&
    !content.includes('replace(');

  if (unmaskedEvidenceDump) {
    console.error(`❌ [FAIL] ${relPath}: Direct unmasked print of evidence_json detected. Must use maskAffiliateTag.`);
    violations++;
  }
}

if (violations > 0) {
  console.error(`\n❌ [LINT FAILED]: ${violations} violation(s) of unmasked affiliate tag/evidence policy.`);
  process.exit(1);
} else {
  console.log('✓ [PASS] All checked scripts enforce masked affiliate tag and evidence hygiene.');
  process.exit(0);
}
