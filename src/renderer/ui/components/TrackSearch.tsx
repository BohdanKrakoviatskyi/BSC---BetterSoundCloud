import { useEffect, useRef, useState } from 'react';
import type { Track } from '../../domain/models';
import { appGateway } from '../../lib/appGateway';
import { FaMagnifyingGlass, FaMusic } from '../lib/icons';
import { formatDuration, initials, describeError } from '../lib/format';

type Props = { onSelect: (track: Track) => void };

export function TrackSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const uniqueResults = Array.from(new Map(results.map((track) => [track.id, track])).values());

  // A new result set always starts with nothing highlighted, so Enter can never pick a stale row.
  useEffect(() => setActiveIndex(-1), [results]);

  function choose(track: Track) {
    onSelect(track);
    setOpen(false);
    setActiveIndex(-1);
  }

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
          const message = describeError(reason, 'Поиск SoundCloud не выполнен');
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

  const showDropdown = open && query.trim().length >= 2;

  function moveActive(delta: number) {
    if (!showDropdown || !uniqueResults.length) return;
    setOpen(true);
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return uniqueResults.length - 1;
      if (next >= uniqueResults.length) return 0;
      return next;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); return; }
    if (event.key === 'Enter' && showDropdown && activeIndex >= 0) {
      event.preventDefault();
      const track = uniqueResults[activeIndex];
      if (track) choose(track);
    }
  }

  return (
    <div className="track-search" ref={wrapperRef}>
      <label className="search-box track-search-box">
        <FaMagnifyingGlass className="search-glyph" aria-hidden="true" />
        <input
          type="search"
          id="globalSearch"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="track-search-results"
          aria-autocomplete="list"
          aria-activedescendant={showDropdown && activeIndex >= 0 ? `track-search-option-${activeIndex}` : undefined}
          value={query}
          placeholder="Найти трек или исполнителя"
          aria-label="Поиск треков SoundCloud"
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.currentTarget.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
        />
        {loading && <span className="track-search-spinner" aria-label="Идёт поиск" />}
      </label>
      <span className="visually-hidden" role="status" aria-live="polite">
        {showDropdown && !loading ? `Найдено треков: ${uniqueResults.length}` : ''}
      </span>
      {showDropdown && (
        <div className="track-search-dropdown" id="track-search-results" role="listbox" aria-label="Результаты поиска">
          {loading && results.length === 0 && <div className="track-search-message">Ищу треки…</div>}
          {!loading && !error && results.length === 0 && <div className="track-search-message">Ничего не найдено</div>}
          {error && <div className="track-search-message track-search-error">{error}</div>}
          {uniqueResults.map((track, index) => (
            <button
              className={`track-search-result${index === activeIndex ? ' is-active' : ''}`}
              type="button"
              role="option"
              id={`track-search-option-${index}`}
              aria-selected={index === activeIndex}
              // Focus stays on the input; the combobox points at the active row instead.
              tabIndex={-1}
              key={track.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(track)}
            >
              {track.artwork
                ? <img src={track.artwork} alt="" loading="lazy" />
                : <span className="track-search-cover-fallback">{initials(track.artist.name) || <FaMusic aria-hidden="true" />}</span>}
              <span className="track-search-result-info"><strong>{track.title}</strong><small>{track.artist.name || 'SoundCloud'}</small></span>
              <span className="track-search-duration">{formatDuration(track.durationMs)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
