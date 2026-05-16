// scripts/dev.mjs
// Starts the API server (port 3001) and Vite dev server (port 3000) together.
// Usage: node scripts/dev.mjs

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function run(label, cmd, args) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });

  const prefix = `[${label}] `;
  child.stdout.on('data', d =>
    d.toString().split('\n').filter(Boolean).forEach(l => console.log(prefix + l))
  );
  child.stderr.on('data', d =>
    d.toString().split('\n').filter(Boolean).forEach(l => console.error(prefix + l))
  );
  child.on('exit', code => {
    console.log(`${prefix}exited with code ${code}`);
    process.exit(code ?? 0);
  });
  return child;
}

console.log('Starting Novaflix dev environment...\n');

// Kill whatever is on 3001 first (Windows + Unix)
try {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3001 ^| findstr LISTENING\') do taskkill /PID %a /F'], { shell: true, stdio: 'inherit' });
  }
} catch {}

// Small delay to let port free up, then start both
await new Promise(r => setTimeout(r, 500));

run('api ', 'node', ['scripts/dev-api.mjs']);
run('vite', 'npx', ['vite', '--host', '127.0.0.1']);
