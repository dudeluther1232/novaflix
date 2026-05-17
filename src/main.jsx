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
      const { type, url, error } = event.data || {};
      if (type === 'NOVAFLIX_M3U8') {
        teardown();
        setHlsUrl('/api/media-proxy?url=' + encodeURIComponent(url));
        setPhase('ready');
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
        <NovaPlayer hlsUrl={hlsUrl} title={title} poster={poster} />
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

function NovaPlayer({ hlsUrl, title, poster }) {
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
        capLevelToPlayerSize: false
      });
      hlsRef.current = hls;
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        setLevels(data.levels || []);
        setCurrentLevel(hls.currentLevel);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(data.level);
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
      />
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
              <button className="cbtn cbtnIcon" type="button" aria-label="Download">
                <Download size={17} />
              </button>
              <button className="cbtn cbtnIcon" type="button" aria-label="Captions">
                <Captions size={18} />
              </button>
              <div className="qualityWrap">
                <button className="cbtn cbtnIcon" type="button" aria-label="Quality" onClick={() => setQualityOpen((open) => !open)}>
                  <Gauge size={18} />
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
                        <button className={`qualityItem ${currentLevel === index ? 'active' : ''}`} type="button" key={`${level.height || 'level'}-${index}`} onClick={() => setQuality(index)}>
                          <span>{level.height ? `${level.height}p` : `Level ${index + 1}`}</span>
                          {level.bitrate ? <span className="qualityBadge">{Math.round(level.bitrate / 1000)}k</span> : null}
                        </button>
                      ))}
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
