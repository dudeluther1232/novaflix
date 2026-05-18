// api/media-proxy.js
// Reverse-proxy for external URLs. Used by:
//   • The injected fetch/XHR interceptor in sniffer iframes
//   • HLS.js for m3u8 playlists and TS segments

function send(res, status, body, type) {
  res.statusCode = status;
  res.setHeader('Content-Type', type || 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range,Content-Type,Accept');
  if (typeof body === 'string') {
    res.end(body);
  } else {
    res.end(JSON.stringify(body));
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');

  // Allow POST (tracking/analytics calls from the videasy player)
  if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method)) {
    return send(res, 405, { error: 'Method not allowed' });
  }

  try {
    const base = `http://${req.headers.host || 'localhost'}`;
    const requestUrl = new URL(req.url, base);
    const rawUrl = requestUrl.searchParams.get('url');

    if (!rawUrl) return send(res, 400, { error: 'Missing url parameter' });

    let target;
    try { target = new URL(rawUrl); } catch { return send(res, 400, { error: 'Invalid url' }); }

    if (!['https:', 'http:'].includes(target.protocol)) {
      return send(res, 403, { error: 'Only HTTP(S) allowed' });
    }

    // Replace hotlink-check params with the Videasy player origin.
    // CDNs like speedsterwave.app embed ?f=<referrer> in stream URLs and REQUIRE
    // it to be present and set to an allowed domain — deleting it causes 403.
    // Replace instead of delete so the CDN sees player.videasy.net as the source.
    const VIDEASY_ORIGIN_PARAM = 'https://player.videasy.net';
    for (const param of ['f', 'ref', 'referer', 'referrer', 'origin']) {
      if (target.searchParams.has(param)) {
        target.searchParams.set(param, VIDEASY_ORIGIN_PARAM);
      }
    }

    // Always spoof as if the request comes from the Videasy player.
    // CDN hosts like easy.speedsterwave.app check Referer/Origin to validate
    // they're serving the Videasy player — not our Railway domain.
    const upstreamHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://player.videasy.net/',
      Origin: 'https://player.videasy.net',
      Accept: req.headers['accept'] || '*/*',
    };
    if (req.headers['range']) {
      upstreamHeaders['Range'] = req.headers['range'];
    }

    const fetchOptions = {
      method: req.method,
      headers: upstreamHeaders,
    };

    // Forward POST body if present
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      fetchOptions.body = Buffer.concat(chunks);
      if (req.headers['content-type']) {
        upstreamHeaders['Content-Type'] = req.headers['content-type'];
      }
    }

    const upstream = await fetch(target.href, fetchOptions);

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const isM3u8 = contentType.includes('mpegurl') ||
                   contentType.includes('x-mpegURL') ||
                   target.pathname.endsWith('.m3u8');

    if (isM3u8) {
      // Rewrite every URL inside the playlist so HLS.js fetches
      // segments through this same proxy (avoids CORS on segment requests).
      const text = await upstream.text();
      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          // Rewrite URI= inside EXT-X-KEY and EXT-X-MAP tags
          if (/^#EXT-X-(KEY|MAP)/.test(trimmed) && trimmed.includes('URI="')) {
            return line.replace(/URI="([^"]+)"/g, (_, uri) => {
              try {
                return `URI="/api/media-proxy?url=${encodeURIComponent(new URL(uri, target.href).href)}"`;
              } catch { return _; }
            });
          }
          return line;
        }
        // Segment or variant playlist line
        try {
          const absolute = new URL(trimmed, target.href).href;
          return `/api/media-proxy?url=${encodeURIComponent(absolute)}`;
        } catch { return line; }
      }).join('\n');

      return send(res, upstream.status, rewritten, 'application/vnd.apple.mpegurl; charset=utf-8');
    }

    // Binary passthrough (TS segments, keys, etc.)
    res.statusCode = upstream.status;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    const passthroughHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    for (const h of passthroughHeaders) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    const buf = await upstream.arrayBuffer();
    res.end(Buffer.from(buf));

  } catch (err) {
    send(res, 500, { error: err.message || 'Proxy error' });
  }
}
