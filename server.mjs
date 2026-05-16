import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tmdb from './api/tmdb.js';
import mediaProxy from './api/media-proxy.js';
import videasy from './api/videasy.js';
import videasyPage from './api/videasy-page.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(__dirname, 'dist');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.m3u8': 'application/vnd.apple.mpegurl',
};

let bareServer = null;
try {
  const { createBareServer } = await import('@nebula-services/bare-server-node');
  bareServer = createBareServer('/bare/');
  console.log('Bare server ready');
} catch (e) { console.warn('Bare server unavailable:', e.message); }

const apiRoutes = new Map([
  ['/api/tmdb', tmdb],
  ['/api/media-proxy', mediaProxy],
  ['/api/videasy', videasy],
  ['/api/videasy-page', videasyPage],
]);

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range,Accept');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(''); return; }
  if (bareServer?.shouldRoute(req)) { bareServer.routeRequest(req, res); return; }

  const url = new URL(req.url, 'http://localhost');
  const handler = apiRoutes.get(url.pathname);
  if (handler) return handler(req, res);

  let filePath = join(DIST, url.pathname);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch { filePath = join(DIST, 'index.html'); }

  try {
    const data = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    res.statusCode = 200;
    res.end(data);
  } catch { res.statusCode = 404; res.end('Not found'); }
});

server.on('upgrade', (req, socket, head) => {
  if (bareServer?.shouldRoute(req)) { bareServer.upgradeRequest(req, socket, head); return; }
  socket.end();
});

server.listen(PORT, () => console.log(`Novaflix on port ${PORT}`));