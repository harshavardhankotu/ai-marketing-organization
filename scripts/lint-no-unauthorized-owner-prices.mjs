import fs from 'fs';
import path from 'path';

/**
 * Lint: No agent-invented rupee prices or suggested pricing brackets in owner/ directory.
 *
 * Rules:
 * 1. An AI agent must NEVER invent pricing, fee ranges, or suggested pilot brackets for the owner.
 * 2. owner/PILOT_DELIVERY_SPEC.md must strictly state "Price: TBD. Owner decides." without suggested rupee ranges.
 * 3. Any specification or playbook under owner/ that includes unconfirmed rupee amounts (₹ or Rs. followed by positive numbers)
 *    other than authorized owner drafts or historical legacy reference files is a lint failure.
 */

export function checkOwnerFile(filePath) {
  const errors = [];
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) return errors;

  const content = fs.readFileSync(fullPath, 'utf8');
  const filename = path.basename(filePath);

  // Files exempted from strict zero-rupee rule:
  // - OWN_OFFER.legacy_agent_written.md: historical artifact explicitly blocked by SHA in owner-apply.mjs
  // - OWN_OFFER.draft.md: draft template that owner edits
  if (filename === 'OWN_OFFER.legacy_agent_written.md' || filename === 'OWN_OFFER.draft.md') {
    return errors;
  }

  const lines = content.split('\n');

  // Forbidden patterns: suggested price brackets, estimated fees, or invented rupee amounts
  const forbiddenPatterns = [
    /suggested\s+(?:pilot\s+)?(?:range|bracket|fee|price)\s*:\s*(?:₹|Rs\.?|INR)/i,
    /(?:₹|Rs\.?|INR)\s*\d{2,}/i, // Explicit rupee amount like ₹300, ₹5,000, Rs. 15000, INR 500
    /(?:bracket|range)\s+of\s+(?:Rs\.?|₹|INR)\s*\d+/i
  ];

  lines.forEach((line, index) => {
    // Skip lint rule descriptions and comments
    if (line.includes('forbiddenPatterns') || line.includes('No agent-invented rupee prices') || line.includes('₹0')) {
      return;
    }

    for (const pattern of forbiddenPatterns) {
      if (pattern.test(line)) {
        errors.push({
          file: filePath,
          line: index + 1,
          text: line.trim(),
          reason: 'Unauthorized agent-invented rupee amount or suggested price bracket in owner specification'
        });
        break;
      }
    }
  });

  return errors;
}

export function lintOwnerDirectory(ownerDir = 'owner') {
  const dirPath = path.resolve(ownerDir);
  if (!fs.existsSync(dirPath)) {
    return { passed: true, errors: [] };
  }

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
  const allErrors = [];

  for (const file of files) {
    const filePath = path.join(ownerDir, file);
    const errors = checkOwnerFile(filePath);
    allErrors.push(...errors);
  }

  return {
    passed: allErrors.length === 0,
    errors: allErrors,
    checkedCount: files.length
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/lint-no-unauthorized-owner-prices.mjs')) {
  const result = lintOwnerDirectory();
  if (!result.passed) {
    console.error('❌ [LINT FAILED] Unauthorized agent-invented rupee amount(s) found in owner/ directory:');
    for (const err of result.errors) {
      console.error(`  ${err.file}:${err.line} -> "${err.text}" (${err.reason})`);
    }
    process.exit(1);
  }
  console.log(`✓ [PASS] All ${result.checkedCount} files in owner/ free of unauthorized agent-invented prices.`);
  process.exit(0);
}
