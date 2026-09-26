import type { Track } from '../../domain/models';
import type { Profile, Page } from '../types';
import { ResizeHandle } from './ResizeHandle';

type Props = {
  profile: Profile | null;
  page: Page;
  tracks: Track[];
  onNavigate: (page: Page) => void;
  onPlayTrack: (track: Track) => void;
  onOpenArtist?: (track: Track) => void;
  onResize: (delta: number) => void;
};

export function Sidebar({ profile, page, tracks, onNavigate, onPlayTrack, onOpenArtist, onResize }: Props) {
  const uniqueTracks = Array.from(new Map(tracks.map((track) => [track.id, track])).values());
  return (
    <aside className="sidebar panel">
      <ResizeHandle side="left" label="Изменить ширину левой панели" onResize={onResize} />
      <nav className="primary-nav" aria-label="Главная навигация">
        <button type="button" className={`nav-link ${page === 'home' ? 'active' : ''}`} onClick={() => onNavigate('home')}><span className="nav-glyph">⌂</span>Главная</button>
      </nav>
      <section className="library-block">
        <div className="library-heading">
          <button type="button" className={`library-title ${page === 'library' ? 'active' : ''}`} onClick={() => onNavigate('library')}><span className="nav-glyph">▤</span>Моя медиатека</button>
        </div>
        <button type="button" className={`nav-link liked-nav-link ${page === 'likes' ? 'active' : ''}`} onClick={() => onNavigate('likes')} aria-current={page === 'likes' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.3-8.8 10-8.8 10s-8.8-4.7-8.8-10a4.8 4.8 0 0 1 8.8-2.5 4.8 4.8 0 0 1 8.8 2.5Z" /></svg>
          Лайканые
        </button>

        <div className="library-list">
          {uniqueTracks.slice(0, 60).map((track) => (
            <button className="library-item" type="button" key={track.id} onClick={() => onPlayTrack(track)} title={`Воспроизвести ${track.title}`}>
              {track.artwork ? <img className="mini-art" src={track.artwork} alt="" loading="lazy" /> : <span className="mini-art mini-art-fallback">♫</span>}
              <span className="library-copy"><b>{track.title}</b><small onClick={(e) => { e.stopPropagation(); if (onOpenArtist) onOpenArtist(track); }} title="Открыть профиль автора" style={{ cursor: onOpenArtist ? 'pointer' : 'default' }}>{track.artist.name || profile?.username || 'SoundCloud'}</small></span>
            </button>
          ))}
          {tracks.length === 0 && <p className="library-empty">Твои лайки появятся здесь</p>}
        </div>
      </section>

    </aside>
  );
}
