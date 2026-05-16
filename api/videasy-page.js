// api/videasy-page.js
// Fetches Videasy's player HTML server-side, injects a fetch/XHR interceptor
// that (a) routes every cross-origin request through /api/media-proxy so CORS
// never blocks the player JS, and (b) postMessages any .m3u8 URL it finds
// back to the parent window so the main app can hand it to NovaPlayer.

const VIDEASY_ORIGIN = 'https://player.videasy.net';

// Injected at the very top of <head> so it runs before any Videasy JS.
const INTERCEPTOR = `
<script>
(function () {
  'use strict';
  var _selfOrigin = location.origin;
  var _baseHref = document.baseURI || '${VIDEASY_ORIGIN}/';
  var _proxy = function (u) { return _selfOrigin + '/api/media-proxy?url=' + encodeURIComponent(u); };
  var _notified = false;
  var _errored = false;

  function notify(url) {
    if (_notified) return;
    _notified = true;
    try { window.parent.postMessage({ type: 'NOVAFLIX_M3U8', url: url }, '*'); } catch (_) {}
  }

  function notifyError(message) {
    if (_errored || _notified) return;
    _errored = true;
    try { window.parent.postMessage({ type: 'NOVAFLIX_PAGE_ERROR', error: message || 'Videasy player failed to load' }, '*'); } catch (_) {}
  }

  function maybeM3u8(url, ct) {
    if (!url) return false;
    var s = String(url);
    return s.indexOf('.m3u8') !== -1 || (ct && (ct.indexOf('mpegurl') !== -1 || ct.indexOf('x-mpegURL') !== -1));
  }

  function normalizeHistoryUrl(url) {
    if (!url) return url;
    try {
      var nextUrl = new URL(String(url), _baseHref);
      if (nextUrl.origin !== _selfOrigin) {
        return nextUrl.pathname + nextUrl.search + nextUrl.hash;
      }
    } catch (_) {}
    return url;
  }

  // ── patch fetch ─────────────────────────────────────────────────────────
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var rawUrl = (typeof input === 'string') ? input
               : (input && typeof input.url === 'string') ? input.url
               : String(input);
    var absolute;
    try { absolute = new URL(rawUrl, _baseHref).href; } catch (_) { return _fetch(input, init); }

    if (new URL(absolute).origin === _selfOrigin) return _fetch(input, init);

    // Cross-origin → proxy + sniff
    if (maybeM3u8(absolute)) notify(absolute);

    return _fetch(_proxy(absolute), init).then(function (resp) {
      if (!_notified) {
        var ct = resp.headers.get('content-type') || '';
        if (maybeM3u8(absolute, ct)) notify(absolute);
      }
      return resp;
    });
  };

  // ── patch XHR ────────────────────────────────────────────────────────────
  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var rawUrl = String(url);
    try {
      var absolute = new URL(rawUrl, _baseHref).href;
      if (new URL(absolute).origin !== _selfOrigin) {
        if (maybeM3u8(absolute)) notify(absolute);
        arguments[1] = _proxy(absolute);
      }
    } catch (_) {}
    return _open.apply(this, arguments);
  };

  var _replaceState = history.replaceState.bind(history);
  history.replaceState = function (state, unused, url) {
    try {
      return _replaceState(state, unused, normalizeHistoryUrl(url));
    } catch (_) {
      return _replaceState(state, unused);
    }
  };

  var _pushState = history.pushState.bind(history);
  history.pushState = function (state, unused, url) {
    try {
      return _pushState(state, unused, normalizeHistoryUrl(url));
    } catch (_) {
      return _pushState(state, unused);
    }
  };

  var mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (mediaProto) {
    var mediaSrc = Object.getOwnPropertyDescriptor(mediaProto, 'src');
    if (mediaSrc && mediaSrc.set) {
      Object.defineProperty(mediaProto, 'src', {
        configurable: true,
        enumerable: mediaSrc.enumerable,
        get: mediaSrc.get,
        set: function (value) {
          try {
            var absolute = new URL(String(value), _baseHref).href;
            if (maybeM3u8(absolute)) notify(absolute);
          } catch (_) {}
          return mediaSrc.set.call(this, value);
        }
      });
    }
  }

  window.addEventListener('error', function (event) {
    notifyError((event && event.message) || 'Videasy page error');
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    notifyError(reason && reason.message ? reason.message : String(reason || 'Unhandled promise rejection'));
  });

  function clickCenteredPlayButton() {
    var centerX = window.innerWidth / 2;
    var centerY = window.innerHeight / 2;
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var candidates = buttons
      .map(function (button) {
        var rect = button.getBoundingClientRect();
        var distance = Math.abs((rect.left + rect.width / 2) - centerX) + Math.abs((rect.top + rect.height / 2) - centerY);
        return { button: button, rect: rect, distance: distance };
      })
      .filter(function (entry) {
        return entry.rect.width >= 30 && entry.rect.height >= 30;
      })
      .sort(function (a, b) {
        return a.distance - b.distance;
      });

    if (!candidates.length) return false;
    candidates[0].button.click();
    return true;
  }

  var autoplayAttempts = 0;
  var autoplayTimer = setInterval(function () {
    if (_notified || autoplayAttempts > 40) {
      clearInterval(autoplayTimer);
      return;
    }
    autoplayAttempts += 1;
    clickCenteredPlayButton();
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
        Referer: VIDEASY_ORIGIN,
        Origin: VIDEASY_ORIGIN,
      },
    });
    if (!resp.ok) return sendError(res, resp.status, `Videasy returned ${resp.status}`);
    html = await resp.text();
  } catch (err) {
    return sendError(res, 502, `Fetch failed: ${err.message}`);
  }

  // Remove existing <base> tag so ours wins
  html = html.replace(/<base\b[^>]*>/gi, '');

  // Inject base href + interceptor right after <head>
  html = html.replace(
    /(<head\b[^>]*>)/i,
    `$1<base href="${VIDEASY_ORIGIN}/" />${INTERCEPTOR}`
  );

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}
