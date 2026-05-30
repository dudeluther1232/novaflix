// api/download.js
// Downloads an HLS stream as MP4 by:
//   1. Fetching the m3u8 server-side through our own media-proxy (correct CDN headers)
//   2. Resolving variant -> segment URLs from the rewritten playlist
//   3. Downloading each segment via our media-proxy (avoids CDN auth issues)
//   4. Concatenating all TS segments into one buffer
//   5. Remuxing that buffer through ffmpeg stdin->stdout as MP4
//
// Falls back to raw .ts if ffmpeg is not available.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sendError(res, status, msg) {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({ error: msg }));
  }
}

async function ffmpegAvailable() {
  try { await execFileAsync('ffmpeg', ['-version']); return true; }
  catch { return false; }
}

// Unwrap /api/media-proxy?url=<encoded> -> real CDN URL
function resolveProxiedUrl(rawUrl, host) {
  try {
    const u = new URL(rawUrl, `http://${host}`);
    if (u.pathname === '/api/media-proxy') {
      const inner = u.searchParams.get('url');
      if (inner) return { cdnUrl: inner, proxyBase: `http://${host}` };
    }
    if (u.hostname !== host.split(':')[0]) return { cdnUrl: u.href, proxyBase: `http://${host}` };
    return { cdnUrl: rawUrl, proxyBase: `http://${host}` };
  } catch {
    return { cdnUrl: rawUrl, proxyBase: `http://${host}` };
  }
}

// Fetch text through our own media-proxy (so CDN sees correct headers)
async function proxyFetch(proxyBase, cdnUrl) {
  const proxied = `${proxyBase}/api/media-proxy?url=${encodeURIComponent(cdnUrl)}`;
  const r = await fetch(proxied);
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${cdnUrl.slice(0, 80)}`);
  return { text: await r.text(), contentType: r.headers.get('content-type') || '' };
}

// Fetch binary segment through our own media-proxy
async function proxyFetchBuf(proxyBase, cdnUrl) {
  const proxied = `${proxyBase}/api/media-proxy?url=${encodeURIComponent(cdnUrl)}`;
  const r = await fetch(proxied);
  if (!r.ok) throw new Error(`HTTP ${r.status} for segment`);
  const ct = r.headers.get('content-type') || '';
  // Validate we got actual video data, not an HTML error page
  if (ct.includes('text/html') || ct.includes('application/json')) {
    const preview = await r.text();
    throw new Error(`Segment returned ${ct}: ${preview.slice(0, 100)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

// Parse m3u8 text and return segment CDN URLs.
// Handles master -> variant (picks highest bandwidth).
async function resolveSegments(proxyBase, m3u8CdnUrl) {
  const { text } = await proxyFetch(proxyBase, m3u8CdnUrl);
  const lines = text.split('\n').map(l => l.trim());

  // Master playlist -> pick highest BANDWIDTH variant
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
    let bestUrl = null;
    let bestBw = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
        const bw = bwMatch ? parseInt(bwMatch[1]) : 0;
        // The variant line from the proxy is already a /api/media-proxy?url=... path
        const uriLine = lines[i + 1];
        if (uriLine && !uriLine.startsWith('#') && bw > bestBw) {
          bestBw = bw;
          // Extract the real CDN variant URL from the proxied path
          try {
            const variantProxied = new URL(uriLine, `${proxyBase}/`);
            const variantCdn = variantProxied.searchParams.get('url') || uriLine;
            bestUrl = variantCdn;
          } catch {
            bestUrl = uriLine;
          }
        }
      }
    }
    if (!bestUrl) throw new Error('No variant found in master playlist');
    console.log('[download] selected variant:', bestUrl.slice(0, 100));
    return resolveSegments(proxyBase, bestUrl); // recurse into variant
  }

  // Media playlist -> collect segment CDN URLs
  const segments = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    // Lines from the proxy are already /api/media-proxy?url=... paths
    try {
      const segProxied = new URL(line, `${proxyBase}/`);
      const segCdn = segProxied.searchParams.get('url');
      if (segCdn) {
        segments.push(segCdn);
      } else if (line.startsWith('http')) {
        segments.push(line);
      }
    } catch { /* skip */ }
  }

  const isEncrypted = lines.some(l => l.startsWith('#EXT-X-KEY'));
  console.log(`[download] ${segments.length} segments, encrypted=${isEncrypted}`);
  if (segments.length === 0) {
    console.log('[download] WARNING: no segments found. First 10 lines:', lines.slice(0, 10));
  }
  return { segments, isEncrypted };
}

// Download all segments and return one big Buffer
async function fetchAllSegments(proxyBase, segments) {
  const bufs = [];
  let done = 0;
  for (const url of segments) {
    try {
      const buf = await proxyFetchBuf(proxyBase, url);
      bufs.push(buf);
    } catch (err) {
      console.error(`[download] segment ${done + 1}/${segments.length} failed:`, err.message);
      // Skip bad segments rather than aborting entirely
    }
    done++;
    if (done % 20 === 0) console.log(`[download] ${done}/${segments.length} segments`);
  }
  return Buffer.concat(bufs);
}

// Remux a raw TS buffer to MP4 via ffmpeg stdin->stdout (no network needed)
function remuxToMp4(tsBuffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-i', 'pipe:0',          // read TS from stdin
      '-c', 'copy',            // no re-encode
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      '-f', 'mp4',
      'pipe:1',                // write MP4 to stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    const chunks = [];
    ff.stdout.on('data', d => chunks.push(d));
    ff.stderr.on('data', d => console.error('[ffmpeg]', d.toString().trimEnd()));
    ff.on('error', reject);
    ff.on('close', code => {
      if (code === 0 || chunks.length > 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited ${code}`));
    });

    ff.stdin.write(tsBuffer, err => {
      if (err) console.error('[ffmpeg stdin write error]', err.message);
      ff.stdin.end();
    });
  });
}

// ── main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.statusCode = 204;
    res.end('');
    return;
  }

  if (req.method !== 'GET') return sendError(res, 405, 'GET only');

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rawUrl = reqUrl.searchParams.get('url');
  const title  = reqUrl.searchParams.get('title') || 'video';
  const safeTitle = title.replace(/[^\w\s\-]/g, '').trim().slice(0, 80) || 'video';

  if (!rawUrl) return sendError(res, 400, 'Missing url param');

  const host = req.headers.host || 'localhost:3000';
  const { cdnUrl, proxyBase } = resolveProxiedUrl(rawUrl, host);
  console.log('[download] cdnUrl:', cdnUrl.slice(0, 120));

  if (!cdnUrl.startsWith('http')) {
    return sendError(res, 400, `Could not resolve CDN URL from: ${rawUrl.slice(0, 80)}`);
  }

  try {
    // 1. Resolve all segment CDN URLs via proxy
    const { segments } = await resolveSegments(proxyBase, cdnUrl);
    if (!segments.length) return sendError(res, 502, 'No segments found — stream may have expired. Try playing it again first.');

    // 2. Download all segments through proxy
    console.log(`[download] fetching ${segments.length} segments via proxy...`);
    const tsBuffer = await fetchAllSegments(proxyBase, segments);
    console.log(`[download] total TS: ${(tsBuffer.length / 1024 / 1024).toFixed(1)} MB from ${segments.length} segments`);

    if (tsBuffer.length < 1024) {
      return sendError(res, 502, `Download produced only ${tsBuffer.length} bytes — segments may have expired. Reload the movie and try again immediately.`);
    }

    // 3. Remux to MP4 via ffmpeg, fall back to raw TS
    const hasFfmpeg = await ffmpegAvailable();
    if (hasFfmpeg) {
      try {
        console.log('[download] remuxing to MP4...');
        const mp4Buffer = await remuxToMp4(tsBuffer);
        console.log(`[download] MP4: ${(mp4Buffer.length / 1024 / 1024).toFixed(1)} MB`);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
        res.setHeader('Content-Length', mp4Buffer.length);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(mp4Buffer);
        return;
      } catch (err) {
        console.error('[download] ffmpeg remux failed, falling back to TS:', err.message);
      }
    }

    // TS fallback
    res.statusCode = 200;
    res.setHeader('Content-Type', 'video/MP2T');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.ts"`);
    res.setHeader('Content-Length', tsBuffer.length);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(tsBuffer);

  } catch (err) {
    console.error('[download] error:', err.message);
    sendError(res, 500, err.message || 'Download failed');
  }
}
