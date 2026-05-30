import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tmdb from './api/tmdb.js';
import mediaProxy from './api/media-proxy.js';
import videasy from './api/videasy.js';
import videasyPage from './api/videasy-page.js';
import download from './api/download.js';

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
  ['/api/download', download],
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

  // Proxy Videasy Next.js chunks — player.videasy.net dynamically injects
  // <script src="/_next/..."> and bare chunk filenames like "6501.xxx.js".
  // Our server can't find them in dist/, so proxy them straight from the source.
  const isNextChunk = url.pathname.startsWith('/_next/')
    || url.pathname.startsWith('/_vercel/')
    || /^\/[0-9a-f]{4,}\.[0-9a-f]{16,}\.js$/.test(url.pathname);
  if (isNextChunk) {
    try {
      const upstream = await fetch(
        `https://player.videasy.net${url.pathname}${url.search}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Referer: 'https://player.videasy.net/',
            Origin: 'https://player.videasy.net',
          },
        }
      );
      const ct = upstream.headers.get('content-type') || 'application/javascript';
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', ct);
      res.setHeader('Access-Control-Allow-Origin', '*');
      const buf = await upstream.arrayBuffer();
      res.end(Buffer.from(buf));
    } catch (err) {
      res.statusCode = 502;
      res.end('Chunk proxy error: ' + err.message);
    }
    return;
  }

  let filePath = join(DIST, url.pathname);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // If a JS/JSON/CSS/WASM asset is missing from dist, it belongs to the
    // Videasy player — proxy it from player.videasy.net instead of
    // returning index.html (which causes "Unexpected token '<'" errors).
    const ext = extname(url.pathname).toLowerCase();
    if (['.js', '.json', '.css', '.wasm', '.map'].includes(ext)) {
      try {
        const upstream = await fetch(
          `https://player.videasy.net${url.pathname}${url.search}`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Referer: 'https://player.videasy.net/',
              Origin: 'https://player.videasy.net',
            },
          }
        );
        const ct = upstream.headers.get('content-type') || MIME[ext] || 'application/octet-stream';
        res.statusCode = upstream.status;
        res.setHeader('Content-Type', ct);
        res.setHeader('Access-Control-Allow-Origin', '*');
        const buf = await upstream.arrayBuffer();
        res.end(Buffer.from(buf));
      } catch (err) {
        res.statusCode = 502;
        res.end('Asset proxy error: ' + err.message);
      }
      return;
    }
    filePath = join(DIST, 'index.html');
  }

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