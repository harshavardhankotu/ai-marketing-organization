import fs from 'fs';
import path from 'path';

/**
 * Lint: No unsourced commercial claims in owner/ directory.
 *
 * Enforces that numeric claims regarding:
 *  - Response delays / wait hours
 *  - Percentages (conversion, inquiry drop-off, show-up rates, etc.)
 *  - Delivery / result timelines (e.g., time to first rupee, 1-2 weeks, 2-3 months)
 *  - Promised lead / patient quantities or attribution certainty
 *
 * MUST be accompanied by an explicit, valid source marker on the same line or in the same block:
 *  - `SOURCE: https://<valid-domain>/...`
 *  - `OWNER_MEASURED: <description of completed clinic audit/log measurement>`
 *
 * Code blocks, synthetic demonstration fixtures, operational setup time estimates,
 * time-of-day clock ranges (e.g. 8:00 PM – 8:00 AM), negative prohibitions (e.g. "NEVER promise 100%"),
 * and historical archive files are exempt.
 */

// Patterns indicating an active commercial claim that requires evidence
export const CLAIM_PATTERNS = [
  {
    type: 'ATTRIBUTION_CERTAINTY',
    regex: /\b(?:100%|absolute)\s*attribution\s*certainty\b/i,
    description: 'Unfounded 100% attribution certainty claim'
  },
  {
    type: 'DELIVERY_TIMELINE_PROMISE',
    regex: /(?:time to (?:first )?(?:rupee|revenue|cash|payout)|first (?:rupee|revenue|payout) in)\s*:?\s*\d+(?:[–-]\d+)?\s*(?:days?|weeks?|months?)/i,
    description: 'Unverified timeline to revenue promise'
  },
  {
    type: 'RESULT_TIMELINE_PROMISE',
    regex: /(?:results?|revenue|payout|roi)\s+(?:guaranteed|delivered|achieved)\s+in\s+\d+(?:[–-]\d+)?\s*(?:days?|weeks?|months?)/i,
    description: 'Unverified result delivery promise'
  },
  {
    type: 'QUANTITY_GUARANTEE',
    regex: /(?:guarantee(?:s|d)?|promis(?:e|es|ed))\s+\d+\s*(?:leads?|patients?|consultations?|appointments?|customers?)/i,
    description: 'Unfounded lead or customer volume guarantee'
  },
  {
    type: 'RESPONSE_DELAY_HOURS',
    regex: /(?:response|inquiry|after-hours|staff)?\s*(?:delay|wait(?:ing)?|response\s*time)\s*(?:of|is|of\s*about|approx(?:imately)?)?\s*\d+(?:[–-]\d+)?\s*(?:hours?|hrs?|minutes?|mins?)/i,
    description: 'Unverified response delay or wait time claim'
  },
  {
    type: 'REVERSE_DELAY_HOURS',
    regex: /\d+(?:[–-]\d+)?\s*(?:hours?|hrs?)\s*(?:response|inquiry|after-hours)?\s*(?:delay|wait|lag)/i,
    description: 'Unverified hour-based delay claim'
  },
  {
    type: 'COMMERCIAL_PERCENTAGE',
    regex: /(?:over|under|approx(?:imately)?|more than|nearly)?\s*\d+(?:\.\d+)?%\s*(?:of\s+(?:[\w-]+\s+){0,3}(?:inquiries|leads|patients|reach-outs|drop-off|conversion|sales|show-rate|revenue|chair)|conversion|show-up|drop-off|attribution|revenue)/i,
    description: 'Unverified commercial percentage statistic'
  }
];

// Explicit negative boundaries / prohibitions: these document what is NOT promised
export const PROHIBITION_PATTERNS = [
  /(?:never|do not|no|avoid)\s+(?:promise|guarantee|claim|claiming|state)/i,
  /❌\s*\*\*NEVER\b/i,
  /\bNOT\s+promised\b/i,
  /\bnever\s+guarantee\b/i,
  /\bNO\s+[\w\s-]+\s+Guarantee\b/i
];

export function validateSourceMarker(text) {
  // Check for SOURCE: https://...
  const sourceMatch = text.match(/SOURCE:\s*(\S+)/i);
  if (sourceMatch) {
    const urlStr = sourceMatch[1].replace(/[),.;]+$/, '');
    try {
      const parsed = new URL(urlStr);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.includes('.')) {
        return { valid: true, type: 'SOURCE_URL', value: urlStr };
      }
    } catch {
      return { valid: false, reason: `Malformed SOURCE URL: "${urlStr}"` };
    }
  }

  // Check for OWNER_MEASURED: <details>
  const measuredMatch = text.match(/OWNER_MEASURED:\s*([^)\n]+)/i);
  if (measuredMatch) {
    const details = measuredMatch[1].trim();
    // A string like 'OWNER_MEASURED: intake audit' must not convert a planned measurement into completed evidence.
    const invalidPlannedPatterns = /\b(?:intake\s*audit|planned|future|upcoming|pending|estimated|hypothetical|to\s*be\s*measured|tbd)\b/i;
    if (invalidPlannedPatterns.test(details)) {
      return { valid: false, reason: 'OWNER_MEASURED marker cannot describe a planned intake audit or future procedure; must represent completed, documented evidence.' };
    }
    if (details.length >= 8) {
      return { valid: true, type: 'OWNER_MEASURED', value: details };
    }
    return { valid: false, reason: 'OWNER_MEASURED marker must specify what is measured (minimum 8 chars).' };
  }

  // Synthetic Demonstration / Example Exemption:
  // Keep synthetic examples exempt only when clearly marked synthetic (e.g. SYNTHETIC EXAMPLE, SYNTHETIC_ONLY)
  if (/\b(?:SYNTHETIC EXAMPLE|SYNTHETIC_ONLY|SYNTHETIC_NAME|DEMO DATA ONLY)\b/i.test(text)) {
    return { valid: true, type: 'SYNTHETIC_EXEMPTION', value: 'Explicitly marked synthetic demonstration fixture' };
  }

  return { valid: false, reason: 'No source marker found' };
}

export function checkOwnerClaimsContent(content, filename = 'test.md') {
  const errors = [];

  // Exempt historical archive files
  if (filename === 'OWN_OFFER.legacy_agent_written.md') {
    return errors;
  }

  const lines = content.split(/\r?\n/);
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code fences (``` or ~~~)
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) {
      continue;
    }

    // Skip comment lines, table borders, dividers
    if (trimmed.startsWith('<!--') || trimmed.startsWith('|:--') || trimmed.startsWith('---')) {
      continue;
    }

    // Skip lines that are describing the linter rules themselves
    if (trimmed.includes('CLAIM_PATTERNS') || trimmed.includes('Unverified commercial percentage') || trimmed.includes('SOURCE: https://')) {
      if (line.includes('export const') || line.includes('description:')) {
        continue;
      }
    }

    // Check if line is an explicit negative prohibition (e.g. "NEVER promise 100% conversion")
    const isProhibition = PROHIBITION_PATTERNS.some(p => p.test(line));
    if (isProhibition) {
      continue;
    }

    // Check each pattern
    for (const pattern of CLAIM_PATTERNS) {
      if (pattern.regex.test(line)) {
        // A claim pattern matched. Check if the line itself or adjacent lines have a valid marker.
        const contextText = [
          lines[i - 1] || '',
          line,
          lines[i + 1] || ''
        ].join(' ');

        const markerResult = validateSourceMarker(contextText);
        if (!markerResult.valid) {
          const detail = markerResult.reason ? ` (${markerResult.reason})` : '';
          errors.push({
            file: filename,
            line: i + 1,
            text: trimmed,
            claimType: pattern.type,
            reason: `${pattern.description}.${detail} Requires valid 'SOURCE: https://...' or 'OWNER_MEASURED: <details>' marker.`
          });
          break; // Avoid duplicate errors on same line
        }
      }
    }
  }

  return errors;
}

export function checkOwnerClaimsFile(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, 'utf8');
  return checkOwnerClaimsContent(content, path.basename(filePath));
}

export function lintOwnerClaimsDirectory(ownerDir = 'owner') {
  const dirPath = path.resolve(ownerDir);
  if (!fs.existsSync(dirPath)) {
    return { passed: true, errors: [], checkedCount: 0 };
  }

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
  const allErrors = [];

  for (const file of files) {
    const filePath = path.join(ownerDir, file);
    const errors = checkOwnerClaimsFile(filePath);
    allErrors.push(...errors);
  }

  return {
    passed: allErrors.length === 0,
    errors: allErrors,
    checkedCount: files.length
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/lint-owner-claims.mjs')) {
  const result = lintOwnerClaimsDirectory();
  if (!result.passed) {
    console.error('❌ [LINT FAILED] Unsourced commercial claim(s) found in owner/ directory:');
    for (const err of result.errors) {
      console.error(`  ${err.file}:${err.line} [${err.claimType}] -> "${err.text}"\n      Reason: ${err.reason}`);
    }
    process.exit(1);
  }
  console.log(`✓ [PASS] All ${result.checkedCount} files in owner/ verified free of unsourced commercial claims.`);
  process.exit(0);
}
