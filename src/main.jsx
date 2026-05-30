import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Hls from 'hls.js';
import {
  Search,
  Play,
  Pause,
  Plus,
  Info,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  X,
  Clapperboard,
  Tv,
  Loader2,
  SkipBack,
  SkipForward,
  Captions,
  Download,
  Gauge
} from 'lucide-react';
import './styles.css';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/';

const rows = [
  { key: 'trending', title: 'Trending Now' },
  { key: 'popularMovies', title: 'Popular Movies' },
  { key: 'nowPlaying', title: 'New Releases' },
  { key: 'topMovies', title: 'Critically Acclaimed' },
  { key: 'popularTv', title: 'Binge-Worthy TV' },
  { key: 'topTv', title: 'Prestige Series' }
];

function image(path, size = 'w780') {
  return path ? `${IMAGE_BASE}${size}${path}` : '';
}

function titleOf(item) {
  return item.title || item.name || item.original_title || item.original_name || 'Untitled';
}

function mediaTypeOf(item) {
  return item.media_type || (item.first_air_date ? 'tv' : 'movie');
}

async function api(route, params = {}) {
  const query = new URLSearchParams({ route, ...params });
  const response = await fetch(`/api/tmdb?${query.toString()}`);
  if (!response.ok) throw new Error(`TMDB ${route} failed`);
  return response.json();
}

function pickTrailer(videos = []) {
  const official = videos.filter((video) => video.site === 'YouTube');
  return (
    official.find((video) => video.type === 'Trailer' && video.official) ||
    official.find((video) => video.type === 'Trailer') ||
    official.find((video) => video.type === 'Teaser') ||
    official[0]
  );
}

function App() {
  const [catalog, setCatalog] = useState({});
  const [hero, setHero] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all(rows.map((row) => api(row.key).then((data) => [row.key, data.results?.filter(Boolean) || []])))
      .then((entries) => {
        if (!alive) return;
        const next = Object.fromEntries(entries);
        setCatalog(next);
        setHero(next.trending?.find((item) => item.backdrop_path) || next.popularMovies?.[0]);
      })
      .catch((err) => setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setLoadingSearch(false);
      return;
    }

    const timer = setTimeout(() => {
      setLoadingSearch(true);
      api('search', { query: trimmed })
        .then((data) => {
          setSearchResults((data.results || []).filter((item) => ['movie', 'tv'].includes(mediaTypeOf(item))));
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoadingSearch(false));
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  const openDetails = async (item) => {
    setSelected({ ...item, loading: true });
    try {
      const details = await api('details', { mediaType: mediaTypeOf(item), id: item.id });
      setSelected({ ...item, ...details, media_type: mediaTypeOf(item), loading: false });
    } catch (err) {
      setError(err.message);
      setSelected({ ...item, loading: false });
    }
  };

  const isSearching = Boolean(query.trim());

  return (
    <main>
      <Header query={query} setQuery={setQuery} />
      {error && <div className="toast">{error}</div>}
      <Hero item={hero} onPlay={openDetails} />
      <section className="catalog" aria-label="Novaflix catalog">
        {isSearching ? (
          <SearchGrid
            title={loadingSearch ? 'Searching…' : `Results for “${query.trim()}”`}
            items={searchResults}
            onSelect={openDetails}
            loading={loadingSearch && searchResults.length === 0}
          />
        ) : (
          rows.map((row) => (
            <Rail key={row.key} title={row.title} items={catalog[row.key] || []} onSelect={openDetails} loading={!catalog[row.key]?.length} />
          ))
        )}
      </section>
      {selected && <Details item={selected} onClose={() => setSelected(null)} onOpen={openDetails} />}
    </main>
  );
}

function Header({ query, setQuery }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Novaflix home">
        Nova<span>flix</span>
      </a>
      <nav>
        <a href="#movies">Movies</a>
        <a href="#tv">TV Shows</a>
        <a href="#latest">Latest</a>
        <a href="#my-list">My List</a>
      </nav>
      <label className="search">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titles, people, genres" />
      </label>
    </header>
  );
}

function Hero({ item, onPlay }) {
  if (!item) {
    return (
      <section className="hero skeleton">
        <Loader2 className="spin" />
      </section>
    );
  }

  return (
    <section className="hero" style={{ '--hero': `url(${image(item.backdrop_path, 'original')})` }}>
      <div className="heroContent">
        <h1 className="heroTitle">{titleOf(item)}</h1>
        <p>{item.overview}</p>
        <div className="actions">
          <button className="primary" onClick={() => onPlay(item)}><Play size={20} fill="currentColor" /> Play</button>
          <button onClick={() => onPlay(item)}><Info size={20} /> More Info</button>
        </div>
      </div>
    </section>
  );
}

function Rail({ title, items, onSelect, loading }) {
  return (
    <section className="rail">
      <h2>{title}</h2>
      <div className="posters">
        {loading && Array.from({ length: 8 }, (_, index) => <div className="poster ghost" key={index} />)}
        {items.map((item) => (
          <button className="poster" key={`${mediaTypeOf(item)}-${item.id}`} onClick={() => onSelect(item)}>
            {image(item.poster_path || item.backdrop_path, 'w342') ? (
              <img src={image(item.poster_path || item.backdrop_path, 'w342')} alt="" loading="lazy" />
            ) : (
              <div className="missingArt">{titleOf(item).slice(0, 1)}</div>
            )}
            <span>{titleOf(item)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SearchGrid({ title, items, onSelect, loading }) {
  return (
    <section className="searchSection">
      <h2 className="searchTitle">{title}</h2>
      <div className="searchGrid">
        {loading && Array.from({ length: 12 }, (_, i) => <div className="searchCard ghost" key={i} />)}
        {items.map((item) => (
          <button className="searchCard" key={`${mediaTypeOf(item)}-${item.id}`} onClick={() => onSelect(item)}>
            {image(item.backdrop_path || item.poster_path, 'w500') ? (
              <img src={image(item.backdrop_path || item.poster_path, 'w500')} alt="" loading="lazy" />
            ) : (
              <div className="missingArt wide">{titleOf(item).slice(0, 1)}</div>
            )}
            <span>{titleOf(item)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Details({ item, onClose, onOpen }) {
  const cast = item.credits?.cast?.slice(0, 6).map((person) => person.name).join(', ');
  const similar = item.similar?.results?.slice(0, 8) || [];
  const release = item.release_date || item.first_air_date || '';
  const runtime = item.runtime ? `${item.runtime}m` : item.number_of_seasons ? `${item.number_of_seasons} season${item.number_of_seasons > 1 ? 's' : ''}` : '';

  return (
    <div className="modalShell" role="dialog" aria-modal="true" aria-label={titleOf(item)}>
      <div className="modal">
        <button className="close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="modalBackdrop" style={{ '--backdrop': `url(${image(item.backdrop_path, 'original')})` }} />
        <div className="modalBody">
          <h2>{titleOf(item)}</h2>
          <div className="meta">
            <span>{release.slice(0, 4)}</span>
            <span>{runtime}</span>
            <span>{mediaTypeOf(item) === 'tv' ? <Tv size={15} /> : <Clapperboard size={15} />} {mediaTypeOf(item).toUpperCase()}</span>
            <span>{Math.round((item.vote_average || 0) * 10)}% match</span>
          </div>
          <p>{item.overview || 'No overview available.'}</p>
          {cast && <p className="cast">Cast: {cast}</p>}
          {item.loading ? <Loader2 className="spin" /> : <VideasyPlayer item={item} />}
          {similar.length > 0 && (
            <section className="similar">
              <h3>More Like This</h3>
              <div className="similarGrid">
                {similar.map((entry) => (
                  <button key={entry.id} onClick={() => onOpen({ ...entry, media_type: mediaTypeOf(item) })}>
                    {image(entry.backdrop_path || entry.poster_path, 'w500') ? (
                      <img src={image(entry.backdrop_path || entry.poster_path, 'w500')} alt="" />
                    ) : (
                      <div className="missingArt wide">{titleOf(entry).slice(0, 1)}</div>
                    )}
                    <span>{titleOf(entry)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VideasyPlayer
// Strategy:
//   1. Fast-path: hit /api/videasy — if Videasy's API returns an hlsUrl
//      directly, great, skip to NovaPlayer immediately.
//   2. Slow-path (Scramjet sniffer): mount a hidden <iframe> pointing to
//      /sniffer.html.  That page registers scramjet-sw.js as a service
//      worker, loads the Videasy player HTML server-side, injects it into
//      a same-origin sub-frame, and lets the SW intercept every network
//      request the player makes.  When the SW spots an .m3u8 URL it
//      postMessages it back here.  We tear down the iframe and hand the
//      URL to NovaPlayer — no visible Videasy embed ever shown.
// ---------------------------------------------------------------------------
function VideasyPlayer({ item }) {
  const mediaType = mediaTypeOf(item);
  const isTV = mediaType === 'tv';
  const [season, setSeason]   = useState(1);
  const [episode, setEpisode] = useState(1);
  const [hlsUrl, setHlsUrl]   = useState(null);
  const [subtitles, setSubtitles] = useState([]); // [{url, lang, label}]
  // 'idle' | 'api' | 'sniffing' | 'ready' | 'error'
  const [phase, setPhase]     = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const extractorFrameRef = useRef(null);
  const timeoutRef  = useRef(null);
  const listenerRef = useRef(null);

  // ── cleanup helper ────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    clearTimeout(timeoutRef.current);
    if (listenerRef.current) {
      window.removeEventListener('message', listenerRef.current);
      listenerRef.current = null;
    }
    if (extractorFrameRef.current) {
      extractorFrameRef.current.remove();
      extractorFrameRef.current = null;
    }
  }, []);

  // ── slow-path: mount sniffer iframe ──────────────────────────────────
  const startSniffer = useCallback((params) => {
    if (extractorFrameRef.current) return;
    setPhase('sniffing');

    const mediaKind = params.get('mediaType');
    const tmdbId = params.get('id');
    const seasonValue = params.get('season') || '1';
    const episodeValue = params.get('episode') || '1';
    const embedUrl = mediaKind === 'movie'
      ? `https://player.videasy.net/movie/${tmdbId}?color=E50914`
      : `https://player.videasy.net/tv/${tmdbId}/${seasonValue}/${episodeValue}?color=E50914&nextEpisode=true&episodeSelector=true&autoplayNextEpisode=true`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;left:-10000px;top:0;width:1280px;height:720px;opacity:0;pointer-events:none;border:none';
    iframe.src = `/api/videasy-page?url=${encodeURIComponent(embedUrl)}`;
    document.body.appendChild(iframe);
    extractorFrameRef.current = iframe;

    const onMessage = (event) => {
      const { type, url, error, lang, label } = event.data || {};
      if (type === 'NOVAFLIX_M3U8') {
        teardown();
        setHlsUrl('/api/media-proxy?url=' + encodeURIComponent(url));
        setPhase('ready');
      } else if (type === 'NOVAFLIX_SUBTITLE') {
        // Collect subtitle tracks as they are discovered (don't stop sniffer)
        const proxiedUrl = '/api/media-proxy?url=' + encodeURIComponent(url);
        setSubtitles(prev => {
          if (prev.some(s => s.url === proxiedUrl)) return prev;
          return [...prev, { url: proxiedUrl, lang: lang || 'en', label: label || `Track ${prev.length + 1}` }];
        });
      } else if (
        type === 'NOVAFLIX_TIMEOUT' ||
        type === 'NOVAFLIX_SW_ERROR' ||
        type === 'NOVAFLIX_PAGE_ERROR'
      ) {
        teardown();
        setErrorMsg(error || 'Could not extract stream. Check that dev-api is running.');
        setPhase('error');
      }
    };
    listenerRef.current = onMessage;
    window.addEventListener('message', onMessage);

    // Hard timeout (25 s)
    timeoutRef.current = setTimeout(() => {
      teardown();
      setErrorMsg('Stream extraction timed out.');
      setPhase('error');
    }, 25_000);
  }, [teardown]);

  // ── main load effect ─────────────────────────────────────────────────
  const load = useCallback(() => {
    teardown();
    setHlsUrl(null);
    setSubtitles([]);
    setErrorMsg('');
    setPhase('api');

    const params = new URLSearchParams({ mediaType, id: item.id });
    if (isTV) { params.set('season', season); params.set('episode', episode); }

    // Fast-path attempt
    fetch(`/api/videasy?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.hlsUrl) {
          setHlsUrl('/api/media-proxy?url=' + encodeURIComponent(data.hlsUrl));
          setPhase('ready');
        } else {
          // API didn't give us an hlsUrl — fall back to Scramjet sniffer
          startSniffer(params);
        }
      })
      .catch(() => startSniffer(params));
  }, [item.id, mediaType, season, episode, isTV, startSniffer, teardown]);

  useEffect(() => {
    load();
    return teardown;
  }, [load, teardown]);

  const title  = titleOf(item);
  const poster = image(item.backdrop_path, 'original');

  return (
    <div className="videasyWrap">
      {isTV && (
        <div className="videasyEpPicker">
          <label>
            Season
            <input
              type="number" min="1" max="50" value={season}
              onChange={(ev) => { setSeason(Number(ev.target.value)); setEpisode(1); }}
            />
          </label>
          <label>
            Episode
            <input
              type="number" min="1" max="200" value={episode}
              onChange={(ev) => setEpisode(Number(ev.target.value))}
            />
          </label>
        </div>
      )}

      {phase === 'ready' && hlsUrl ? (
        <NovaPlayer hlsUrl={hlsUrl} title={title} poster={poster} subtitles={subtitles} />
      ) : phase === 'error' ? (
        <div className="videasyLoading" style={{ flexDirection: 'column', gap: 8 }}>
          <span style={{ color: '#e50914', fontSize: 14 }}>⚠ {errorMsg}</span>
          <button
            style={{
              marginTop: 8, padding: '6px 18px', background: '#e50914',
              color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer'
            }}
            onClick={load}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="videasyLoading">
          <Loader2 className="spin" />
          <span style={{ marginLeft: 10, fontSize: 13, color: '#888' }}>
            {phase === 'sniffing' ? 'Extracting stream…' : 'Loading…'}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NovaPlayer({ hlsUrl, title, poster, subtitles = [] }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverLeft, setHoverLeft] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [captionsOpen, setCaptionsOpen] = useState(false);
  const [activeCaption, setActiveCaption] = useState(null); // url string or null
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null); // null | 'xbox' | 'fetching' | 'done'
  const activeTrackRef = useRef(null);

  const showControls = () => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false);
    }, 3500);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return undefined;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        startLevel: -1,
        capLevelToPlayerSize: false,
        debug: false,
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const lvls = data.levels || [];
        console.log('[NovaPlayer] MANIFEST_PARSED levels:', lvls.length, lvls.map(l => ({ h: l.height, bw: l.bitrate })));
        setCurrentLevel(-1);

        // Always try to fetch the raw master m3u8 to get RESOLUTION= tags,
        // because HLS.js sometimes reports height=0 when it parses proxy URLs.
        const rawM3u8 = new URL(hlsUrl, location.href).searchParams.get('url');
        if (rawM3u8) {
          fetch('/api/media-proxy?url=' + encodeURIComponent(rawM3u8))
            .then(r => r.text())
            .then(text => {
              console.log('[NovaPlayer] master m3u8 snippet:', text.slice(0, 400));
              const parsed = [];
              const lines = text.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                  const resParsed = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
                  const bw  = lines[i].match(/BANDWIDTH=(\d+)/);
                  const uri = lines[i+1]?.trim();
                  if (uri && !uri.startsWith('#')) {
                    parsed.push({
                      height: resParsed ? parseInt(resParsed[2]) : 0,
                      width:  resParsed ? parseInt(resParsed[1]) : 0,
                      bitrate: bw  ? parseInt(bw[1])  : 0,
                    });
                  }
                }
              }
              console.log('[NovaPlayer] parsed levels from m3u8:', parsed);
              if (parsed.length > 0) {
                // Build merged level list using parsed metadata + HLS.js levels by index
                const merged = parsed.map((p, i) => ({
                  ...(lvls[i] || {}),
                  height: p.height || (lvls[i]?.height) || 0,
                  bitrate: p.bitrate || (lvls[i]?.bitrate) || 0,
                }));
                setLevels(merged);
              } else if (lvls.length > 0) {
                // Single-rendition stream — show it as-is
                setLevels(lvls);
              }
            })
            .catch(() => {
              // If fetch fails, still show whatever HLS.js gave us
              setLevels(lvls);
            });
        } else {
          setLevels(lvls);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        console.log('[NovaPlayer] LEVEL_SWITCHED to', data.level);
        setCurrentLevel(data.level);
      });
      hls.on(Hls.Events.LEVEL_LOADED, () => {
        // levels may grow after initial parse
        if (hls.levels?.length) setLevels(prev => prev.length === hls.levels.length ? prev : hls.levels);
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    return undefined;
  }, [hlsUrl]);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  const video = videoRef.current;
  const toggle = () => {
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
    showControls();
  };

  const fmt = (seconds) => {
    if (!seconds || Number.isNaN(seconds)) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return hrs > 0
      ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const setTimeFromPointer = (event) => {
    if (!video || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    video.currentTime = ratio * duration;
    setProgress(video.currentTime);
  };

  const setHover = (event) => {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setHoverTime(ratio * duration);
    setHoverLeft(ratio * 100);
  };

  const updateVolume = (value) => {
    if (!video) return;
    const next = Number(value);
    video.volume = next;
    video.muted = next === 0;
    setVolume(next);
    setMuted(video.muted);
  };

  const setQuality = (level) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = level;
    setCurrentLevel(level);
    setQualityOpen(false);
  };

  // ── Caption toggle ────────────────────────────────────────────────────
  const toggleCaption = (url) => {
    const video = videoRef.current;
    if (!video) return;
    if (activeCaption === url) {
      // Turn off
      setActiveCaption(null);
      Array.from(video.textTracks).forEach(t => { t.mode = 'disabled'; });
    } else {
      setActiveCaption(url);
    }
    setCaptionsOpen(false);
  };

  // Sync the active <track> element when activeCaption changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Disable all tracks first
    Array.from(video.textTracks).forEach(t => { t.mode = 'disabled'; });
    if (!activeCaption) return;
    // Re-enable after a tick to let the browser settle
    const timer = setTimeout(() => {
      const tracks = Array.from(video.textTracks);
      // Match by index: activeCaption is a URL, find which subtitle index it matches
      const idx = subtitles.findIndex(s => s.url === activeCaption);
      const target = idx >= 0 ? tracks[idx] : tracks[0];
      if (target) target.mode = 'showing';
    }, 50);
    return () => clearTimeout(timer);
  }, [activeCaption, subtitles]);

  // ── Download ──────────────────────────────────────────────────────────
  const isXbox = /Xbox/i.test(navigator.userAgent);

  const handleDownload = async () => {
    if (!hlsUrl || downloading) return;
    const encodedM3u8 = hlsUrl; // already a /api/media-proxy?url=... path
    const safeTitle = title.replace(/[^\w\s-]/g, '') || 'video';
    const downloadUrl = `/api/download?url=${encodeURIComponent(encodedM3u8)}&title=${encodeURIComponent(safeTitle)}`;

    if (isXbox) {
      // Xbox browser: fetch blob then use URL.createObjectURL with a forced navigate
      setDownloading(true);
      setDownloadProgress('xbox');
      try {
        // Use TS fallback for Xbox since it doesn't need ffmpeg and is faster to start
        const tsUrl = downloadUrl + '&mode=ts';
        const resp = await fetch(tsUrl);
        if (!resp.ok) throw new Error('Download failed: ' + resp.status);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        // On Xbox Edge, window.open with a blob URL triggers a save dialog
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = safeTitle + '.ts';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(blobUrl); a.remove(); }, 5000);
        setDownloadProgress('done');
      } catch (err) {
        alert('Xbox download failed: ' + err.message + '\n\nTry opening this URL directly:\n' + location.origin + downloadUrl + '&mode=ts');
      } finally {
        setDownloading(false);
        setTimeout(() => setDownloadProgress(null), 3000);
      }
      return;
    }

    // Normal browsers: just open the download URL
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = safeTitle + '.mp4';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div
      className="novaPlayer novaPlayerShell"
      onMouseMove={showControls}
      onMouseEnter={showControls}
      onMouseLeave={() => !video?.paused && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        playsInline
        poster={poster}
        aria-label={`${title} preview`}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onProgress={(event) => {
          const media = event.currentTarget;
          if (media.buffered.length && media.duration) {
            setBuffered((media.buffered.end(media.buffered.length - 1) / media.duration) * 100);
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          setVolume(event.currentTarget.muted ? 0 : event.currentTarget.volume);
        }}
        onClick={toggle}
      >
        {subtitles.map((sub, i) => (
          <track
            key={sub.url}
            kind="subtitles"
            src={sub.url}
            srcLang={sub.lang}
            label={sub.label}
            default={i === 0 && activeCaption === sub.url}
          />
        ))}
      </video>
      <div className={`novaOverlay ${controlsVisible || !playing ? 'show' : ''}`}>
        <div className="centerControls">
          <button className="centerButton" onClick={() => video && (video.currentTime = Math.max(0, video.currentTime - 10))} aria-label="Back 10 seconds">
            <SkipBack size={20} />
          </button>
          <button className="centerButton centerPlay" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </button>
          <button className="centerButton" onClick={() => video && (video.currentTime = Math.min(duration, video.currentTime + 10))} aria-label="Forward 10 seconds">
            <SkipForward size={20} />
          </button>
        </div>
        <div className="controlWrap">
          <div className="nowPlayingRow">
            <div className="nowPlayingMeta">
              <div className="nowPlayingTitle">{title}</div>            </div>
          </div>

          <div
            className="progressTrack"
            onMouseMove={setHover}
            onMouseLeave={() => setHoverTime(null)}
            onClick={setTimeFromPointer}
          >
            <div className="progressBase" />
            <div className="progressBuffered" style={{ width: `${buffered}%` }} />
            <div className="progressFilled" style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} />
            <div className="progressThumb" style={{ left: `${duration ? (progress / duration) * 100 : 0}%` }} />
            {hoverTime !== null && (
              <div className="progressTooltip" style={{ left: `${hoverLeft}%` }}>
                {fmt(hoverTime)}
              </div>
            )}
          </div>

          <div className="controlRow">
            <div className="controlLeft">
              <button className="cbtn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
              </button>
              <div className="volumeWrap">
                <button className="cbtn" onClick={() => { if (video) { video.muted = !video.muted; setMuted(video.muted); } }} aria-label="Mute">
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <div className="volumeTrackWrap">
                  <div className="volumeTrack">
                    <div className="volumeFill" style={{ width: `${volume * 100}%` }} />
                    <input
                      className="volumeRange"
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      onChange={(event) => updateVolume(event.target.value)}
                      aria-label="Volume"
                    />
                  </div>
                </div>
              </div>
              <div className="timeReadout">
                <span>{fmt(progress)}</span>
                <span className="timeSep">/</span>
                <span>{fmt(duration)}</span>
              </div>
              <PlayerMark />
            </div>

            <div className="controlRight">
              <button
                className={`cbtn cbtnIcon${downloading ? ' cbtnActive' : ''}`}
                type="button"
                aria-label={downloading ? 'Downloading…' : 'Download'}
                onClick={handleDownload}
                disabled={downloading}
                title={isXbox ? 'Download (Xbox mode)' : 'Download as MP4'}
              >
                {downloading ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
              </button>
              {/* Captions button + panel */}
              <div className="qualityWrap">
                <button
                  className={`cbtn cbtnIcon${activeCaption ? ' cbtnActive' : ''}`}
                  type="button"
                  aria-label="Captions"
                  onClick={() => setCaptionsOpen(o => !o)}
                  title="Subtitles / Captions"
                >
                  <Captions size={18} />
                </button>
                {captionsOpen && (
                  <div className="qualityPanel">
                    <div className="qualityHead">
                      <span>Captions</span>
                      <button className="qualityClose" type="button" onClick={() => setCaptionsOpen(false)} aria-label="Close">
                        <X size={12} />
                      </button>
                    </div>
                    <div className="qualityList">
                      <button
                        className={`qualityItem ${!activeCaption ? 'active' : ''}`}
                        type="button"
                        onClick={() => { setActiveCaption(null); setCaptionsOpen(false); const v = videoRef.current; if (v) Array.from(v.textTracks).forEach(t => { t.mode = 'disabled'; }); }}
                      >
                        <span>Off</span>
                      </button>
                      {subtitles.length === 0 && (
                        <div className="qualityItem" style={{ color: 'var(--text-dim)', fontSize: '0.78rem', pointerEvents: 'none' }}>
                          <span>No tracks found yet</span>
                        </div>
                      )}
                      {subtitles.map(sub => (
                        <button
                          key={sub.url}
                          className={`qualityItem ${activeCaption === sub.url ? 'active' : ''}`}
                          type="button"
                          onClick={() => toggleCaption(sub.url)}
                        >
                          <span>{sub.label}</span>
                          <span className="qualityBadge">{sub.lang}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="qualityWrap">
                <button className="cbtn cbtnIcon" type="button" aria-label="Quality" onClick={() => setQualityOpen((open) => !open)}>
                  <Gauge size={18} />
                  <span style={{ fontSize: '0.65rem', fontFamily: 'DM Mono, monospace', marginLeft: 2, color: 'rgba(255,255,255,0.6)' }}>
                    {currentLevel === -1
                      ? (levels[hlsRef.current?.currentLevel]?.height ? `${levels[hlsRef.current.currentLevel].height}p` : 'Auto')
                      : (levels[currentLevel]?.height ? `${levels[currentLevel].height}p` : `L${currentLevel+1}`)}
                  </span>
                </button>
                {qualityOpen && (
                  <div className="qualityPanel">
                    <div className="qualityHead">
                      <span>Quality</span>
                      <button className="qualityClose" type="button" onClick={() => setQualityOpen(false)} aria-label="Close quality panel">
                        <X size={12} />
                      </button>
                    </div>
                    <div className="qualityList">
                      <button className={`qualityItem ${currentLevel === -1 ? 'active' : ''}`} type="button" onClick={() => setQuality(-1)}>
                        <span>Auto</span>
                      </button>
                      {levels.map((level, index) => (
                        <button className={`qualityItem ${currentLevel === index ? 'active' : ''}`} type="button" key={`level-${index}`} onClick={() => setQuality(index)}>
                          <span>{level.height ? `${level.height}p` : `Level ${index + 1}`}</span>
                          {level.bitrate ? <span className="qualityBadge">{level.bitrate > 1000000 ? `${(level.bitrate/1000000).toFixed(1)}M` : `${Math.round(level.bitrate/1000)}k`}</span> : null}
                        </button>
                      ))}
                      {levels.length === 0 && (
                        <div className="qualityItem" style={{ color: 'var(--text-dim)', fontSize: '0.78rem', pointerEvents: 'none' }}>
                          <span>Loading…</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                className="cbtn cbtnIcon"
                onClick={() => document.fullscreenElement ? document.exitFullscreen() : video?.parentElement?.requestFullscreen?.()}
                aria-label="Fullscreen"
              >
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerMark() {
  return <div className="playerMark"><span>Nova</span>Player</div>;
}

const rootNode = document.getElementById('root');
window.__novaflixRoot = window.__novaflixRoot || createRoot(rootNode);
window.__novaflixRoot.render(<App />);
