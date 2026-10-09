import fs from 'fs';
import path from 'path';

/**
 * Lint: No unbacked rupee estimates in report generators.
 *
 * Rules:
 * - Report generators must NEVER emit fabricated or estimated rupee figures (e.g. ₹X estimated, projected ₹X).
 * - Rupee amounts must originate from verified ledger queries (revenue_records, commission_records)
 *   or be explicitly stated as 'UNKNOWN' / 0.
 * - Any string matching patterns like "₹[0-9]+ (estimated|projected|potential|approx)" or
 *   "(estimated|projected|potential|approx).*₹[0-9]+" without a ledger source is a lint failure.
 */

export function checkContent(content, filename = 'unknown') {
  const errors = [];
  const lines = content.split('\n');

  // Patterns indicating unbacked rupee estimates
  const unbackedEstimateRegexes = [
    /₹\s*\d+[\d,]*(?:\.\d+)?\s*(?:estimated|projected|potential|approx|hypothetical)/i,
    /(?:estimated|projected|potential|approximate|hypothetical)\s*(?:revenue|commission|value|earnings|impact)?\s*(?:of|:)?\s*₹\s*\d+/i,
    /₹\s*\d+[\d,]*(?:\.\d+)?\s*(?:expected|forecasted)\s*(?:revenue|commission)/i
  ];

  lines.forEach((line, index) => {
    // Skip comments that describe the rule itself
    if (line.includes('unbackedEstimateRegexes') || line.includes('No unbacked rupee estimates') || line.includes('mst_17')) {
      return;
    }

    for (const regex of unbackedEstimateRegexes) {
      if (regex.test(line)) {
        errors.push({
          file: filename,
          line: index + 1,
          text: line.trim(),
          reason: 'Unbacked rupee estimate detected without verified ledger source'
        });
        break;
      }
    }
  });

  return errors;
}

export function checkFiles(fileList) {
  const allErrors = [];
  for (const filePath of fileList) {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    const fileErrors = checkContent(content, filePath);
    allErrors.push(...fileErrors);
  }
  return allErrors;
}

const DEFAULT_REPORT_GENERATORS = [
  'scripts/generate-status.mjs',
  'scripts/audit-full-d1.mjs',
  'packages/backend/src/revenue/reality-report-generator.ts',
  'packages/backend/src/commission/owner-control-center.ts',
  'PROJECT_STATUS.md'
];

export function runLint(files = DEFAULT_REPORT_GENERATORS) {
  const errors = checkFiles(files);
  if (errors.length > 0) {
    console.error('❌ [LINT FAILED] Unbacked rupee estimate(s) found in report generator(s):');
    for (const err of errors) {
      console.error(`  ${err.file}:${err.line} -> "${err.text}" (${err.reason})`);
    }
    return false;
  }
  console.log(`✓ [PASS] All ${files.length} report generator file(s) free of unbacked rupee estimates.`);
  return true;
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/lint-no-unbacked-rupee-estimates.mjs')) {
  const targetFiles = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_REPORT_GENERATORS;
  const passed = runLint(targetFiles);
  if (!passed) {
    process.exit(1);
  }
  process.exit(0);
}
