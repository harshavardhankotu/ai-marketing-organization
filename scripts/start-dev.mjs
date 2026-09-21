import { spawn } from 'child_process';
import path from 'path';

console.log('================================================================');
console.log('🚀 Launching SmileKraft Dental AI Marketing Organization (DEV)');
console.log('📡 Backend: http://localhost:3001');
console.log('🌐 Frontend: http://localhost:3000');
console.log('================================================================\n');

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

// Start backend
const backend = spawn(npmCmd, ['run', 'dev:backend'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: '3001' }
});

// Start frontend
const frontend = spawn(npmCmd, ['run', 'dev:frontend'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env }
});

function cleanup() {
  console.log('\n🛑 Shutting down development services...');
  if (backend) backend.kill('SIGTERM');
  if (frontend) frontend.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
