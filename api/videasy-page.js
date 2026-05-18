// api/videasy-page.js
// Fetches Videasy's player HTML server-side, rewrites ALL resource URLs to go
// through /api/media-proxy (so the browser never makes a direct cross-origin
// request), then injects a fetch/XHR interceptor for dynamic requests made by
// the player's JS.  When an .m3u8 URL is spotted it postMessages it to the parent.

const VIDEASY_ORIGIN = 'https://player.videasy.net';

// ── URL rewriter helpers ─────────────────────────────────────────────────────

function proxyUrl(url, base) {
  try {
    const abs = new URL(url, base).href;
    // Don't proxy data: or blob: URLs
    if (abs.startsWith('data:') || abs.startsWith('blob:')) return url;
    // Don't double-proxy
    if (abs.includes('/api/media-proxy')) return url;
    return '/api/media-proxy?url=' + encodeURIComponent(abs);
  } catch {
    return url;
  }
}

// Rewrite src/href/action/data-src attributes in raw HTML
function rewriteHtml(html, base) {
  // Rewrite src="..." and href="..." and action="..."
  html = html.replace(
    /(\b(?:src|href|action|data-src|data-href|poster)\s*=\s*)(["'])((?:(?!\2)[^])*?)\2/gi,
    (match, attr, quote, url) => {
      const trimmed = url.trim();
      if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return match;
      }
      return attr + quote + proxyUrl(trimmed, base) + quote;
    }
  );

  // Rewrite url(...) inside <style> blocks and inline styles
  html = html.replace(
    /url\(\s*(["']?)((?:(?!\1\))[^])*?)\1\s*\)/gi,
    (match, quote, url) => {
      const trimmed = url.trim();
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return match;
      return 'url(' + quote + proxyUrl(trimmed, base) + quote + ')';
    }
  );

  // Rewrite srcset="..."
  html = html.replace(
    /(\bsrcset\s*=\s*)(["'])((?:(?!\2)[^])*?)\2/gi,
    (match, attr, quote, srcset) => {
      const rewritten = srcset.replace(/([^\s,][^\s,]*)([\s,]|$)/g, (m, url, sep) => {
        // srcset entries: "url width" or just "url"
        if (/^\d+(\.\d+)?[wx]$/.test(url)) return m; // skip descriptor tokens
        return proxyUrl(url, base) + sep;
      });
      return attr + quote + rewritten + quote;
    }
  );

  // Rewrite content="url" in <meta> tags (e.g. og:image)
  html = html.replace(
    /(<meta\b[^>]*\bcontent\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi,
    (match, attr, quote, url) => attr + quote + proxyUrl(url, base) + quote
  );

  return html;
}

// ── Injected script: intercepts dynamic fetch/XHR + spots m3u8 ──────────────
const INTERCEPTOR = `
<script>
(function () {
  'use strict';
  var _proxy = function (u) { return location.origin + '/api/media-proxy?url=' + encodeURIComponent(u); };
  var _notified = false;

  function notify(url) {
    if (_notified) return;
    _notified = true;
    try { window.parent.postMessage({ type: 'NOVAFLIX_M3U8', url: url }, '*'); } catch (_) {}
  }

  function notifyError(message) {
    try { window.parent.postMessage({ type: 'NOVAFLIX_PAGE_ERROR', error: message || 'Videasy player failed' }, '*'); } catch (_) {}
  }

  function isM3u8(url, ct) {
    var s = String(url || '');
    return s.indexOf('.m3u8') !== -1 || (ct && (ct.indexOf('mpegurl') !== -1 || ct.indexOf('x-mpegURL') !== -1));
  }

  function isCrossOrigin(url) {
    try { return new URL(url).origin !== location.origin; } catch { return false; }
  }

  function maybeProxy(url) {
    if (!url) return url;
    var s = String(url);
    if (s.startsWith('data:') || s.startsWith('blob:') || s.startsWith('/')) return s;
    if (!isCrossOrigin(s)) return s;
    return _proxy(s);
  }

  // ── patch fetch ────────────────────────────────────────────────────────
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var rawUrl = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input);
    if (isM3u8(rawUrl)) notify(rawUrl);
    var proxied = maybeProxy(rawUrl);
    return _fetch(proxied === rawUrl ? input : proxied, init).then(function (resp) {
      if (!_notified) {
        var ct = resp.headers.get('content-type') || '';
        if (isM3u8(rawUrl, ct)) notify(rawUrl);
      }
      return resp;
    });
  };

  // ── patch XHR ──────────────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var rawUrl = String(url);
    if (isM3u8(rawUrl)) notify(rawUrl);
    arguments[1] = maybeProxy(rawUrl);
    return _open.apply(this, arguments);
  };

  // ── patch HTMLMediaElement.src ─────────────────────────────────────────
  var mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (mediaProto) {
    var srcDesc = Object.getOwnPropertyDescriptor(mediaProto, 'src');
    if (srcDesc && srcDesc.set) {
      Object.defineProperty(mediaProto, 'src', {
        configurable: true,
        enumerable: srcDesc.enumerable,
        get: srcDesc.get,
        set: function (value) {
          var s = String(value);
          if (isM3u8(s)) notify(s);
          return srcDesc.set.call(this, maybeProxy(s));
        }
      });
    }
  }

  // ── patch history so Videasy URL changes don't break things ───────────
  ['pushState', 'replaceState'].forEach(function (method) {
    var orig = history[method].bind(history);
    history[method] = function (state, unused, url) {
      if (url) {
        try {
          var abs = new URL(String(url), location.href);
          if (abs.origin !== location.origin) url = abs.pathname + abs.search + abs.hash;
        } catch (_) {}
      }
      try { return orig(state, unused, url); } catch (_) { return orig(state, unused); }
    };
  });

  // ── error reporting ────────────────────────────────────────────────────
  window.addEventListener('error', function (e) {
    notifyError((e && e.message) || 'Page error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    notifyError(r && r.message ? r.message : String(r || 'Unhandled rejection'));
  });

  // ── auto-click play button ─────────────────────────────────────────────
  var attempts = 0;
  var timer = setInterval(function () {
    if (_notified || attempts > 40) { clearInterval(timer); return; }
    attempts++;
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var best = null, bestDist = Infinity;
    document.querySelectorAll('button, [role="button"]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width < 30 || r.height < 30) return;
      var d = Math.abs((r.left + r.width / 2) - cx) + Math.abs((r.top + r.height / 2) - cy);
      if (d < bestDist) { bestDist = d; best = el; }
    });
    if (best) best.click();
  }, 500);
})();
<\/script>`;

function sendError(res, status, msg) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify({ error: msg }));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.statusCode = 204;
    res.end('');
    return;
  }

  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const rawUrl = requestUrl.searchParams.get('url');
  if (!rawUrl) return sendError(res, 400, 'Missing url param');

  let target;
  try { target = new URL(rawUrl); } catch { return sendError(res, 400, 'Invalid url'); }

  if (!target.hostname.endsWith('.videasy.net')) {
    return sendError(res, 403, 'Only videasy.net pages allowed');
  }

  let html;
  try {
    const resp = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: VIDEASY_ORIGIN + '/',
        Origin: VIDEASY_ORIGIN,
      },
    });
    if (!resp.ok) return sendError(res, resp.status, `Videasy returned ${resp.status}`);
    html = await resp.text();
  } catch (err) {
    return sendError(res, 502, `Fetch failed: ${err.message}`);
  }

  // Remove existing <base> tags
  html = html.replace(/<base\b[^>]*>/gi, '');

  // Rewrite all static resource URLs in the HTML before the browser sees them
  const base = VIDEASY_ORIGIN + '/';
  html = rewriteHtml(html, base);

  // Inject interceptor right after <head> for any dynamic requests the JS makes
  html = html.replace(
    /(<head\b[^>]*>)/i,
    `$1${INTERCEPTOR}`
  );

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}
