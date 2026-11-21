import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliDistFile = path.resolve(__dirname, '..', 'dist', 'cli.js');
const actionDistDir = path.resolve(__dirname, '..', '..', '..', 'action-dist');
const actionEntryFile = path.join(actionDistDir, 'cli.mjs');

if (!fs.existsSync(cliDistFile)) {
  throw new Error(`Missing built CLI file at ${cliDistFile}. Run tsc first.`);
}

fs.mkdirSync(actionDistDir, { recursive: true });
fs.copyFileSync(cliDistFile, actionEntryFile);
try {
  fs.chmodSync(actionEntryFile, 0o755);
} catch {
  // Ignore chmod errors on Windows filesystems
}
