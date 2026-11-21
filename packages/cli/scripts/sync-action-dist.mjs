import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPkgDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliPkgDir, '..', '..');
const coreDistDir = path.join(repoRoot, 'packages', 'sitefix-core', 'dist');
const cliDistFile = path.join(cliPkgDir, 'dist', 'cli.js');
const actionDistDir = path.join(repoRoot, 'action-dist');
const actionEntryFile = path.join(actionDistDir, 'cli.mjs');

const coreModuleOrder = [
  'secure-url-fetcher.js',
  'scanner.js',
  'fixpack-generator.js'
];

for (const file of coreModuleOrder) {
  const full = path.join(coreDistDir, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing built @ai-marketing/sitefix-core artifact at ${full}. Build packages/sitefix-core first.`);
  }
}
if (!fs.existsSync(cliDistFile)) {
  throw new Error(`Missing built CLI file at ${cliDistFile}. Run tsc first.`);
}

/**
 * Strips shebangs and ES module import statements, collecting all `node:*` imports
 * to hoist once cleanly at the top of the standalone ESM bundle.
 */
function stripImportsAndCollectNodeBuiltins(sourceCode, nodeImportMap) {
  const cleaned = sourceCode.replace(/^#![^\r\n]*\r?\n/, '');
  // Match single-line or multi-line ESM import statements
  const importRegex = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\r?\n?/gm;
  const body = cleaned.replace(importRegex, (_full, clause, specifier) => {
    if (specifier.startsWith('node:')) {
      if (!nodeImportMap.has(specifier)) {
        nodeImportMap.set(specifier, { defaultName: null, named: new Set() });
      }
      const entry = nodeImportMap.get(specifier);
      const trimmed = clause.trim();
      if (trimmed.startsWith('{')) {
        const inner = trimmed.replace(/^\{|\}$/g, '');
        for (const item of inner.split(',')) {
          const cleanItem = item.trim();
          if (cleanItem) entry.named.add(cleanItem);
        }
      } else if (trimmed.includes('{')) {
        const [defPart, namedPart] = trimmed.split('{');
        const defName = defPart.replace(/,/g, '').trim();
        if (defName) entry.defaultName = defName;
        const inner = namedPart.replace(/\}$/, '');
        for (const item of inner.split(',')) {
          const cleanItem = item.trim();
          if (cleanItem) entry.named.add(cleanItem);
        }
      } else {
        entry.defaultName = trimmed;
      }
      return '';
    }
    if (specifier === '@ai-marketing/sitefix-core' || specifier.startsWith('./') || specifier.startsWith('../')) {
      return '';
    }
    throw new Error(`Unexpected external import '${specifier}' in zero-dependency CLI bundle.`);
  });
  return body.trim();
}

const nodeImportMap = new Map();
const bundledSections = [];

for (const file of coreModuleOrder) {
  const src = fs.readFileSync(path.join(coreDistDir, file), 'utf8');
  const stripped = stripImportsAndCollectNodeBuiltins(src, nodeImportMap);
  bundledSections.push(`// --- @ai-marketing/sitefix-core/${file} ---\n${stripped}`);
}

const cliSrc = fs.readFileSync(cliDistFile, 'utf8');
const cliStripped = stripImportsAndCollectNodeBuiltins(cliSrc, nodeImportMap);
bundledSections.push(`// --- sitefix-check/cli.js ---\n${cliStripped}`);

const hoistedImports = [];
for (const [specifier, info] of nodeImportMap.entries()) {
  const parts = [];
  if (info.defaultName) parts.push(info.defaultName);
  if (info.named.size > 0) parts.push(`{ ${Array.from(info.named).sort().join(', ')} }`);
  hoistedImports.push(`import ${parts.join(', ')} from '${specifier}';`);
}

const standaloneBundle = [
  '#!/usr/bin/env node',
  '// Self-contained zero-dependency SiteFix Launch Gate CLI + @ai-marketing/sitefix-core bundle',
  ...hoistedImports,
  '',
  ...bundledSections,
  ''
].join('\n');

// Write identical self-contained bundle to BOTH packages/cli/dist/cli.js and action-dist/cli.mjs
fs.mkdirSync(path.dirname(cliDistFile), { recursive: true });
fs.mkdirSync(actionDistDir, { recursive: true });
fs.writeFileSync(cliDistFile, standaloneBundle, 'utf8');
fs.writeFileSync(actionEntryFile, standaloneBundle, 'utf8');

try {
  fs.chmodSync(cliDistFile, 0o755);
  fs.chmodSync(actionEntryFile, 0o755);
} catch {
  // Ignore chmod errors on Windows filesystems
}

// Verify syntax & zero external imports
execFileSync(process.execPath, ['--check', actionEntryFile], { stdio: 'inherit' });
const nonNodeImports = [...standaloneBundle.matchAll(/from\s+['"]([^'"]+)['"]/g)]
  .map(m => m[1])
  .filter(spec => !spec.startsWith('node:'));
if (nonNodeImports.length > 0) {
  throw new Error(`Bundle contains non-builtin imports: ${nonNodeImports.join(', ')}`);
}
console.log(`✓ Synced self-contained zero-dependency CLI bundle to packages/cli/dist/cli.js & action-dist/cli.mjs (${Buffer.byteLength(standaloneBundle, 'utf8')} bytes)`);
