const TMDB_API_KEY = process.env.TMDB_API_KEY || 'a63b70ca6288b339b0b556535449d1b9';
const TMDB_BASE = 'https://api.themoviedb.org/3';

const endpoints = {
  trending: '/trending/all/week',
  popularMovies: '/movie/popular',
  topMovies: '/movie/top_rated',
  nowPlaying: '/movie/now_playing',
  popularTv: '/tv/popular',
  topTv: '/tv/top_rated'
};

function addDefaults(params) {
  params.set('api_key', TMDB_API_KEY);
  params.set('language', params.get('language') || 'en-US');
  params.set('include_adult', 'false');
  params.set('region', params.get('region') || 'US');
  return params;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=900, stale-while-revalidate=3600' : 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const route = requestUrl.searchParams.get('route') || 'trending';
    const page = requestUrl.searchParams.get('page') || '1';
    let path = endpoints[route];
    const params = addDefaults(new URLSearchParams({ page }));

    if (route === 'search') {
      const query = requestUrl.searchParams.get('query')?.trim();
      if (!query) return sendJson(res, 200, { page: 1, results: [], total_pages: 0, total_results: 0 });
      path = '/search/multi';
      params.set('query', query);
    }

    if (route === 'details') {
      const mediaType = requestUrl.searchParams.get('mediaType');
      const id = requestUrl.searchParams.get('id');
      if (!['movie', 'tv'].includes(mediaType) || !id) {
        return sendJson(res, 400, { error: 'details requires mediaType=movie|tv and id' });
      }
      path = `/${mediaType}/${id}`;
      params.set('append_to_response', 'videos,credits,similar,watch/providers');
    }

    if (!path) return sendJson(res, 400, { error: `Unknown route: ${route}` });

    const tmdbUrl = `${TMDB_BASE}${path}?${params.toString()}`;
    const response = await fetch(tmdbUrl, {
      headers: { Accept: 'application/json' }
    });
    const data = await response.json();
    if (Array.isArray(data.results)) {
      data.results = data.results.filter((item) => item && item.adult !== true);
    }
    sendJson(res, response.status, data);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'TMDB request failed' });
  }
}
