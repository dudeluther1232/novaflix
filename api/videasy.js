// api/videasy.js
// Resolves a Videasy stream URL for a given TMDB item and returns the HLS m3u8
// so it can be fetched via /api/media-proxy and played in NovaPlayer.
//
// Query params:
//   mediaType  "movie" | "tv"
//   id         TMDB ID
//   season     season number   (tv only, default 1)
//   episode    episode number  (tv only, default 1)

const VIDEASY_PLAYER = 'https://player.videasy.net';
const VIDEASY_API    = 'https://api.videasy.net';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=300, stale-while-revalidate=600' : 'no-store');
  res.end(JSON.stringify(payload));
}

function buildEmbedUrl(mediaType, id, season, episode) {
  const color = 'E50914';
  if (mediaType === 'movie') {
    return `${VIDEASY_PLAYER}/movie/${id}?color=${color}`;
  }
  return `${VIDEASY_PLAYER}/tv/${id}/${season}/${episode}?color=${color}&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true`;
}

// Try to pull an m3u8 URL from the Videasy API.
// Videasy serves stream sources at /stream/{type}/{id}[/{season}/{episode}]
// Adjust this path if the endpoint changes.
async function fetchHlsUrl(mediaType, id, season, episode) {
  let apiPath;
  if (mediaType === 'movie') {
    apiPath = `/stream/movie/${id}`;
  } else {
    apiPath = `/stream/tv/${id}/${season}/${episode}`;
  }

  const url = `${VIDEASY_API}${apiPath}`;
  const resp = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Novaflix/1.0',
      Referer: 'https://player.videasy.net',
      Origin: 'https://player.videasy.net',
    },
  });

  if (!resp.ok) throw new Error(`Videasy API ${resp.status}`);

  const data = await resp.json();

  // Support common response shapes:
  //   { url }
  //   { stream }
  //   { hls }
  //   { sources: [{ url, type }] }
  //   { data: { url } }
  const direct = data?.url || data?.stream || data?.hls;
  if (direct) return direct;

  const nested = data?.data?.url || data?.data?.stream || data?.data?.hls;
  if (nested) return nested;

  const sources = data?.sources || data?.data?.sources;
  if (Array.isArray(sources) && sources.length) {
    // Prefer HLS, fall back to first
    const hls = sources.find((s) => s.type === 'hls' || (s.url || s.file || '').includes('.m3u8'));
    return (hls || sources[0]).url || (hls || sources[0]).file;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.statusCode = 204;
    res.end('');
    return;
  }

  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const mediaType = requestUrl.searchParams.get('mediaType');
    const id        = requestUrl.searchParams.get('id');
    const season    = requestUrl.searchParams.get('season')  || '1';
    const episode   = requestUrl.searchParams.get('episode') || '1';

    if (!id || !['movie', 'tv'].includes(mediaType)) {
      return sendJson(res, 400, { error: 'mediaType (movie|tv) and id are required' });
    }

    const embedUrl = buildEmbedUrl(mediaType, id, season, episode);
    let hlsUrl = null;

    try {
      hlsUrl = await fetchHlsUrl(mediaType, id, season, episode);
    } catch (err) {
      // API call failed — caller falls back to iframe embed
      console.warn('Videasy API error:', err.message);
    }

    return sendJson(res, 200, { embedUrl, hlsUrl });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Videasy lookup failed' });
  }
}
