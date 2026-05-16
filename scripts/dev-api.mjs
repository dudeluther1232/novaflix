// scripts/dev-api.mjs
// API server on port 3001.
// Handles: Bare protocol (/bare/*), TMDB proxy, Videasy proxy, media proxy.

import { createServer } from 'node:http';
import { createRequire } from 'node:module';

import tmdb from '../api/tmdb.js';
import mediaProxy from '../api/media-proxy.js';
import videasy from '../api/videasy.js';
import videasyPage from '../api/videasy-page.js';

// ── Bare server setup ──────────────────────────────────────────────────────
const req = createRequire(import.meta.url);
let bareServer = null;
try {
  const { createBareServer } = await import('@nebula-services/bare-server-node');
  bareServer = createBareServer('/bare/');
  console.log('Bare server ready at /bare/');
} catch (e) {
  console.warn('bare-server-node not available:', e.message);
  console.warn('Run "npm install" then "npm run setup" to enable scramjet.');
}

// ── API routes ─────────────────────────────────────────────────────────────
const routes = new Map([
  ['/api/tmdb', tmdb],
  ['/api/media-proxy', mediaProxy],
  ['/api/videasy', videasy],
  ['/api/videasy-page', videasyPage],
]);

// ── HTTP server ────────────────────────────────────────────────────────────
createServer((req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range,Accept');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end('');
    return;
  }

  // Bare protocol
  if (bareServer?.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
    return;
  }

  const url = new URL(req.url, 'http://127.0.0.1:3001');
  const handler = routes.get(url.pathname);

  if (!handler) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  handler(req, res);
}).on('upgrade', (req, socket, head) => {
  // Bare WebSocket upgrade (needed for epoxy/wisp transports if used later)
  if (bareServer?.shouldRoute(req)) {
    bareServer.upgradeRequest(req, socket, head);
    return;
  }
  socket.end();
}).listen(3001, '127.0.0.1', () => {
  console.log('Novaflix API  → http://127.0.0.1:3001');
  console.log('Bare server   → http://127.0.0.1:3001/bare/');
});
