import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const statePath = path.resolve('STATE.md');
if (!fs.existsSync(statePath)) {
  console.error('[CHECK-STATE-FRESHNESS] FAIL: STATE.md does not exist.');
  process.exit(1);
}

const stateStat = fs.statSync(statePath);
const stateMtimeMs = stateStat.mtimeMs;

try {
  const commitTimestampSec = parseInt(execSync('git log -1 --format=%ct', { encoding: 'utf8' }).trim(), 10);
  const commitTimestampMs = commitTimestampSec * 1000;

  // Allow up to 10 seconds tolerance when STATE.md was part of the commit
  if (stateMtimeMs < commitTimestampMs - 10000) {
    console.error(`[CHECK-STATE-FRESHNESS] FAIL: STATE.md (${new Date(stateMtimeMs).toISOString()}) is older than last commit (${new Date(commitTimestampMs).toISOString()}).`);
    process.exit(1);
  }

  console.log(`[CHECK-STATE-FRESHNESS] PASS: STATE.md (${new Date(stateMtimeMs).toISOString()}) is fresh (last commit: ${new Date(commitTimestampMs).toISOString()}).`);
  process.exit(0);
} catch (err) {
  console.error('[CHECK-STATE-FRESHNESS] ERROR:', err.message);
  process.exit(1);
}
