import type { Track } from '../../domain/models';
import type { Profile, Page } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { FaHeadphones, FaHeart, FaListUl, FaMusic } from '../lib/icons';

type Props = {
  profile: Profile | null;
  page: Page;
  tracks: Track[];
  onNavigate: (page: Page) => void;
  onPlayTrack: (track: Track) => void;
  onOpenTrack?: (track: Track) => void;
  onOpenArtist?: (track: Track) => void;
  onResize: (delta: number) => void;
};

export function Sidebar({ profile, page, tracks, onNavigate, onPlayTrack, onOpenTrack, onOpenArtist, onResize }: Props) {
  const uniqueTracks = Array.from(new Map(tracks.map((track) => [track.id, track])).values());
  // A library row both starts playback and opens the track page, so App gets the whole library as
  // the page context to keep the track page queue in sync with the player queue.
  function openTrackFromSidebar(track: Track) {
    onPlayTrack(track);
    onOpenTrack?.(track);
  }
  return (
    <aside className="sidebar panel">
      <ResizeHandle side="left" label="Изменить ширину левой панели" onResize={onResize} />
      <nav className="primary-nav" aria-label="Главная навигация">
        <button type="button" className={`nav-link ${page === 'home' ? 'active' : ''}`} onClick={() => onNavigate('home')}><FaHeadphones aria-hidden="true" />Главная</button>
      </nav>
      <section className="library-block">
        <div className="library-heading">
          <button type="button" className={`nav-link ${page === 'library' ? 'active' : ''}`} onClick={() => onNavigate('library')}><FaListUl aria-hidden="true" />Моя медиатека</button>
          <button type="button" className={`nav-link ${page === 'likes' ? 'active' : ''}`} onClick={() => onNavigate('likes')} aria-current={page === 'likes' ? 'page' : undefined}><FaHeart aria-hidden="true" />Лайканые</button>
        </div>

        <div className="library-list">
          {uniqueTracks.slice(0, 60).map((track) => (
            <button className="library-item" type="button" key={track.id} onClick={() => openTrackFromSidebar(track)} title={onOpenTrack ? `Открыть страницу трека «${track.title}»` : `Воспроизвести ${track.title}`}>
              {track.artwork ? <img className="mini-art" src={track.artwork} alt="" loading="lazy" /> : <span className="mini-art mini-art-fallback"><FaMusic aria-hidden="true" /></span>}
              <span className="library-copy"><b>{track.title}</b><small onClick={(e) => { e.stopPropagation(); if (onOpenArtist) onOpenArtist(track); }} title="Открыть профиль автора" style={{ cursor: onOpenArtist ? 'pointer' : 'default' }}>{track.artist.name || profile?.username || 'SoundCloud'}</small></span>
            </button>
          ))}
          {tracks.length === 0 && <p className="library-empty">Твои лайки появятся здесь</p>}
        </div>
      </section>

    </aside>
  );
}
