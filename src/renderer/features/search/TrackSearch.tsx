import { useEffect, useRef, useState } from 'react';
import type { Track } from '../../domain/models';
import { appGateway } from '../../application/appGateway';

type Props = { onSelect: (track: Track) => void };

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function TrackSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const uniqueResults = Array.from(new Map(results.map((track) => [track.id, track])).values());

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      console.info('[ui.search] started', { query: trimmed });
      appGateway.searchTracks(trimmed)
        .then((tracks) => {
          if (!active) return;
          setResults(tracks);
          console.info('[ui.search] completed', { query: trimmed, count: tracks.length });
        })
        .catch((reason: unknown) => {
          if (!active) return;
          const message = reason instanceof Error ? reason.message : 'Поиск SoundCloud не выполнен';
          setError(message);
          setResults([]);
          console.error('[ui.search] failed', { query: trimmed, error: message });
        })
        .finally(() => { if (active) setLoading(false); });
    }, 400);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  function choose(track: Track) {
    onSelect(track);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div className="track-search" ref={wrapperRef}>
      <label className="search-box track-search-box">
        <svg className="search-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>
        <input
          type="search"
          id="globalSearch"
          value={query}
          placeholder="Найти трек или исполнителя"
          aria-label="Поиск треков SoundCloud"
          aria-expanded={showDropdown}
          aria-controls="track-search-results"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.currentTarget.value); setOpen(true); }}
          onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
        />
        {loading && <span className="track-search-spinner" aria-label="Идёт поиск" />}
      </label>
      {showDropdown && (
        <div className="track-search-dropdown" id="track-search-results" role="listbox" aria-label="Результаты поиска">
          {loading && results.length === 0 && <div className="track-search-message">Ищу треки…</div>}
          {!loading && !error && results.length === 0 && <div className="track-search-message">Ничего не найдено</div>}
          {error && <div className="track-search-message track-search-error">{error}</div>}
          {uniqueResults.map((track) => (
            <button className="track-search-result" type="button" role="option" aria-selected="false" key={track.id} onClick={() => choose(track)}>
              {track.artwork
                ? <img src={track.artwork} alt="" loading="lazy" />
                : track.artist.name
                  ? <span className="track-search-cover-fallback">{Array.from(track.artist.name)[0]?.toUpperCase() || '♫'}</span>
                  : <span className="track-search-cover-fallback">♫</span>}
              <span className="track-search-result-info"><strong>{track.title}</strong><small>{track.artist.name || 'SoundCloud'}</small></span>
              <span className="track-search-duration">{formatDuration(track.durationMs)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
