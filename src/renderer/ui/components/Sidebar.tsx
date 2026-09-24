import type { Track } from '../../domain/models';
import type { Profile, Page } from '../types';

type Props = {
  profile: Profile | null;
  page: Page;
  tracks: Track[];
  backendReady: boolean;
  onNavigate: (page: Page) => void;
  onSearch: () => void;
  onPlayTrack: (track: Track) => void;
  onLogout: () => void;
};

function initials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase() || 'SC';
}

export function Sidebar({ profile, page, tracks, backendReady, onNavigate, onSearch, onPlayTrack, onLogout }: Props) {
  return (
    <aside className="sidebar panel">
      <nav className="primary-nav" aria-label="Главная навигация">
        <button type="button" className={`nav-link ${page === 'home' ? 'active' : ''}`} onClick={() => onNavigate('home')}><span className="nav-glyph">⌂</span>Главная</button>
        <button type="button" className={`nav-link ${page === 'search' ? 'active' : ''}`} onClick={onSearch}><span className="nav-glyph">⌕</span>Поиск</button>
      </nav>
      <section className="library-block">
        <div className="library-heading">
          <button type="button" className={`library-title ${page === 'library' ? 'active' : ''}`} onClick={() => onNavigate('library')}><span className="nav-glyph">▤</span>Моя медиатека</button>
        </div>
        <button type="button" className={`nav-link liked-nav-link ${page === 'likes' ? 'active' : ''}`} onClick={() => onNavigate('likes')} aria-current={page === 'likes' ? 'page' : undefined}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.3-8.8 10-8.8 10s-8.8-4.7-8.8-10a4.8 4.8 0 0 1 8.8-2.5 4.8 4.8 0 0 1 8.8 2.5Z" /></svg>
  Лайканые
</button>
<div className="library-filters"><button type="button" className="chip active" onClick={() => onNavigate('likes')}>Всё</button><button type="button" className="chip" onClick={() => onNavigate('likes')}>Треки</button></div>
        <div className="library-list">
          {tracks.slice(0, 60).map((track) => (
            <button className="library-item" type="button" key={track.id} onClick={() => onPlayTrack(track)} title={`Воспроизвести ${track.title}`}>
              {track.artwork ? <img className="mini-art" src={track.artwork} alt="" loading="lazy" /> : <span className="mini-art mini-art-fallback">♫</span>}
              <span className="library-copy"><b>{track.title}</b><small>{track.artist.name || profile?.username || 'SoundCloud'}</small></span>
            </button>
          ))}
          {tracks.length === 0 && <p className="library-empty">Твои лайки появятся здесь</p>}
        </div>
      </section>
      <div className="sidebar-account">
        {profile?.avatarUrl ? <img className="profile-avatar" src={profile.avatarUrl} alt="" /> : <span className="profile-avatar profile-fallback">{initials(profile?.username || 'SC')}</span>}
        <span className="account-copy"><b>{profile?.fullName || profile?.username || 'SoundCloud'}</b><small>{backendReady ? 'Аккаунт подключён' : 'Подключение…'}</small></span>
        <button type="button" className="icon-button" onClick={() => onNavigate('settings')} title="Настройки" aria-label="Настройки">⚙</button>
        <button type="button" className="icon-button logout-mini" onClick={onLogout} title="Выйти" aria-label="Выйти">⏻</button>
      </div>
    </aside>
  );
}
