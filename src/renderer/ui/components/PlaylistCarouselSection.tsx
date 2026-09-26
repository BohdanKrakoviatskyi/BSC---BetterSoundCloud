import { useEffect, useRef, useState } from 'react';
import type { Playlist } from '../../domain/models';
import { ErrorMessage } from './ErrorMessage';

type Props = {
  playlists: Playlist[];
  title?: string;
  loading: boolean;
  error: string;
  onOpenPlaylist: (playlist: Playlist) => void;
};

export function PlaylistCarouselSection({ playlists, title = 'Мои плейлисты', loading, error, onOpenPlaylist }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHasOverflow(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [playlists.length]);

  function scroll(direction: -1 | 1) {
    ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  }

  return (
    <section className="shelf" aria-label={title}>
      <div className="section-heading">
        <div><div className="eyebrow">SOUNDCLOUD</div><h2>{title} <span className="track-count">{playlists.length}</span></h2></div>
        {hasOverflow && <div className="carousel-controls" aria-label="Прокрутка плейлистов"><button type="button" aria-label="Прокрутить влево" onClick={() => scroll(-1)}>‹</button><button type="button" aria-label="Прокрутить вправо" onClick={() => scroll(1)}>›</button></div>}
      </div>
      {error && <ErrorMessage message={error} />}
      {loading && playlists.length === 0
        ? <p className="tracks-empty">Загружаю ваши плейлисты…</p>
        : playlists.length === 0
          ? <p className="tracks-empty">Плейлистов пока нет.</p>
          : <div ref={ref} className={`card-row playlist-carousel ${hasOverflow ? 'has-overflow' : ''}`}>
              {playlists.map((playlist) => (
                <article className="playlist-card" key={playlist.id}>
                  <button className="playlist-art" type="button" onClick={() => onOpenPlaylist(playlist)} aria-label={`Открыть плейлист ${playlist.title}`}>
                    {playlist.artwork ? <img src={playlist.artwork} alt="" loading="lazy" /> : <span aria-hidden="true">♫</span>}
                    <span className="playlist-art-play" aria-hidden="true">▶</span>
                  </button>
                  <button className="playlist-title-button" type="button" title={playlist.title} onClick={() => onOpenPlaylist(playlist)}>{playlist.title}</button>
                  <small>{playlist.trackCount} треков{playlist.artist ? ` · ${playlist.artist}` : ''}</small>
                </article>
              ))}
            </div>}
    </section>
  );
}
