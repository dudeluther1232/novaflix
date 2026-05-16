// scripts/setup-scramjet.mjs
// Run once after npm install to set up scramjet static files.
// Usage: node scripts/setup-scramjet.mjs

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const out = resolve(root, 'public/scramjet');
mkdirSync(out, { recursive: true });

console.log('Setting up scramjet static files...\n');

// ── 1. Scramjet core (from local copy in scramjet/package/dist/) ──────────
const scramjetDist = resolve(root, 'scramjet/package/dist');
const coreFiles = ['scramjet.all.js', 'scramjet.bundle.js', 'scramjet.sync.js', 'scramjet.wasm.wasm'];
for (const f of coreFiles) {
  const src = resolve(scramjetDist, f);
  if (!existsSync(src)) {
    console.error(`  ✗ Missing: scramjet/package/dist/${f}`);
    process.exit(1);
  }
  copyFileSync(src, resolve(out, f));
  console.log(`  ✓ ${f}`);
}

const req = createRequire(import.meta.url);
const nm = resolve(root, 'node_modules');

// ── 2. bare-as-module3 → bare.js (the Bare v3 transport, ES module) ──────
// This is the transport that bare-mux's SharedWorker dynamically imports
// to speak the Bare v3 protocol with @nebula-services/bare-server-node.
const bareSrc = (() => {
  const candidates = [
    resolve(nm, '@mercuryworkshop/bare-as-module3/dist/index.mjs'),
    resolve(nm, '@mercuryworkshop/bare-as-module3/dist/index.js'),
    resolve(nm, '@mercuryworkshop/bare-as-module3/dist/client.mjs'),
  ];
  for (const p of candidates) if (existsSync(p)) return p;

  // fallback: scan dist/
  try {
    const dist = resolve(nm, '@mercuryworkshop/bare-as-module3/dist');
    const files = readdirSync(dist).filter(f => f.endsWith('.mjs') || f.endsWith('.js'));
    // prefer mjs for proper ESM default export
    const mjs = files.filter(f => f.endsWith('.mjs'));
    if (mjs.length) return resolve(dist, mjs[0]);
    if (files.length) return resolve(dist, files[0]);
  } catch {}
  return null;
})();

if (!bareSrc) {
  console.error('  ✗ Cannot find bare-as-module3 dist. Run npm install first.');
  process.exit(1);
}
copyFileSync(bareSrc, resolve(out, 'bare.js'));
console.log(`  ✓ bare.js  (from ${bareSrc})`);

// ── 3. bare-mux → baremux-worker.js + baremux.js ─────────────────────────
// bare-mux provides:
//   - a SharedWorker script that routes requests through a transport
//   - a client class (BareMuxConnection) for pages to use
// The page imports BareMuxConnection, the SW communicates with the SharedWorker.
const baremuxNm = resolve(nm, '@mercuryworkshop/bare-mux');
if (!existsSync(baremuxNm)) {
  console.error('  ✗ @mercuryworkshop/bare-mux not installed. Run npm install first.');
  process.exit(1);
}

// Scan for the worker and client files
function findInDir(dir, maxDepth = 2, depth = 0) {
  if (depth > maxDepth || !existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = resolve(dir, e.name);
    return e.isDirectory() ? findInDir(p, maxDepth, depth + 1) : [p];
  });
}

const baremuxFiles = findInDir(baremuxNm);
const workerCandidates = baremuxFiles.filter(p =>
  p.endsWith('.js') && (p.includes('worker') || p.includes('Worker'))
);
const clientCandidates = baremuxFiles.filter(p =>
  p.endsWith('.js') || p.endsWith('.mjs')
).filter(p => !workerCandidates.includes(p) && !p.includes('test') && !p.includes('spec'));

// Pick best worker file
const workerSrc = workerCandidates.find(p => p.endsWith('.js')) || null;
// Pick best client file — prefer mjs or dist/index
const clientSrc =
  clientCandidates.find(p => p.endsWith('.mjs') && p.includes('dist')) ||
  clientCandidates.find(p => p.includes('dist') && p.includes('index')) ||
  clientCandidates.find(p => p.endsWith('.mjs')) ||
  clientCandidates[0] || null;

if (!workerSrc) {
  console.warn('  ⚠  Could not find bare-mux worker file. Listing package:');
  baremuxFiles.slice(0, 20).forEach(p => console.warn('     ', p));
  console.warn('\n  Bare transport will not work until baremux-worker.js is found.');
} else {
  copyFileSync(workerSrc, resolve(out, 'baremux-worker.js'));
  console.log(`  ✓ baremux-worker.js  (from ${workerSrc})`);
}

if (!clientSrc) {
  console.warn('  ⚠  Could not find bare-mux client file.');
} else {
  copyFileSync(clientSrc, resolve(out, 'baremux.js'));
  console.log(`  ✓ baremux.js  (from ${clientSrc})`);
}

console.log('\nScramjet static files ready in public/scramjet/');
console.log('Run "npm run dev" to start the dev server.');
