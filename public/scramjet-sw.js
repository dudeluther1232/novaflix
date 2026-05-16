// public/scramjet-sw.js — CLASSIC service worker (not module)
// scramjet.all.js is a plain IIFE, importScripts works fine.

importScripts('/scramjet/scramjet.all.js');
// After running, globalThis.$scramjetLoadWorker is set.

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const sw = new ScramjetServiceWorker();

// ── M3U8 interception ─────────────────────────────────────────────────────
const PREFIX = '/scramjet/service/';
let notified = false;

function decodeTarget(reqUrl) {
  const idx = reqUrl.indexOf(PREFIX);
  if (idx === -1) return null;
  const raw = reqUrl.slice(idx + PREFIX.length).split('?')[0].split('#')[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function broadcastM3U8(url) {
  if (notified) return;
  notified = true;
  console.log('[scramjet-sw] m3u8 found:', url);
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'NOVAFLIX_M3U8', url }));
}

// Wrap sw.fetch so we can peek at every proxied response
const _origFetch = sw.fetch.bind(sw);
sw.fetch = async function (event) {
  const resp = await _origFetch(event);

  if (!notified) {
    try {
      const target = decodeTarget(event.request.url);
      const ct = resp.headers.get('content-type') || '';
      const byUrl = target && (target.includes('.m3u8') || target.includes('mpegurl'));
      const byCt  = ct.includes('mpegurl') || ct.includes('x-mpegURL');

      if (byUrl || byCt) {
        const text = await resp.clone().text();
        if (text.includes('#EXTM3U')) {
          await broadcastM3U8(target ?? event.request.url);
        }
      }
    } catch { /* non-fatal */ }
  }

  return resp;
};

// ── Lifecycle ─────────────────────────────────────────────────────────────
self.addEventListener('install', () => {
  console.log('[scramjet-sw] install');
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[scramjet-sw] activate');
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith(PREFIX)) return;

  e.respondWith((async () => {
    try {
      if (sw.route(e)) return await sw.fetch(e);
    } catch (err) {
      console.warn('[scramjet-sw] route/fetch failed:', err);
    }

    return fetch(e.request);
  })());
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SCRAMJET_RESET') {
    notified = false;
    console.log('[scramjet-sw] reset');
  }
});
