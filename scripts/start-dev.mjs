import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('================================================================');
console.log('🚀 Launching SmileKraft Dental AI Marketing Organization (DEV)');
console.log('📡 Backend: http://localhost:3001');
console.log('🌐 Frontend: http://localhost:3000');
console.log('================================================================\n');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

// Ensure workspace packages @ai-marketing/shared and @ai-marketing/sitefix-core are compiled before dev:backend / dev:frontend boot
const sharedEntry = path.resolve(process.cwd(), 'packages/shared/dist/index.js');
if (!fs.existsSync(sharedEntry)) {
  console.log('🔧 Building @ai-marketing/shared before starting dev servers...');
  const sharedBuild = spawnSync(npmCmd, ['run', 'build', '--workspace=packages/shared'], {
    stdio: 'inherit',
    shell: true
  });
  if (sharedBuild.status !== 0) {
    console.error('❌ Failed to build @ai-marketing/shared');
    process.exit(sharedBuild.status || 1);
  }
}

const sitefixCoreEntry = path.resolve(process.cwd(), 'packages/sitefix-core/dist/index.js');
if (!fs.existsSync(sitefixCoreEntry)) {
  console.log('🔧 Building @ai-marketing/sitefix-core before starting dev servers...');
  const sitefixCoreBuild = spawnSync(npmCmd, ['run', 'build', '--workspace=packages/sitefix-core'], {
    stdio: 'inherit',
    shell: true
  });
  if (sitefixCoreBuild.status !== 0) {
    console.error('❌ Failed to build @ai-marketing/sitefix-core');
    process.exit(sitefixCoreBuild.status || 1);
  }
}

// Start backend first
const backend = spawn(npmCmd, ['run', 'dev:backend'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: '3001' }
});

let frontend = null;

async function waitForBackendReady(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://127.0.0.1:3001/api/v1/health', {
        signal: AbortSignal.timeout(1000)
      });
      if (res.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

let isCleaningUp = false;
function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  console.log('\n🛑 Shutting down development services...');
  if (backend) backend.kill('SIGTERM');
  if (frontend) frontend.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

waitForBackendReady().then((ready) => {
  if (!ready) {
    console.warn('⚠️ Backend health check timed out after 15s; starting frontend dev server anyway.');
  }
  frontend = spawn(npmCmd, ['run', 'dev:frontend'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env }
  });
});
