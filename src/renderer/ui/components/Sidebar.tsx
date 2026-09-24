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
          <button type="button" className="library-title" onClick={() => onNavigate('likes')}><span className="nav-glyph">▤</span>Моя медиатека</button>
          <button type="button" className="icon-button library-refresh" onClick={() => onNavigate('likes')} aria-label="Открыть лайки">↗</button>
        </div>
        <div className="library-filters"><button type="button" className="chip active" onClick={() => onNavigate('likes')}>Всё</button><button type="button" className="chip" onClick={() => onNavigate('likes')}>Треки</button></div>
        <div className="library-tools"><button className="icon-button" type="button" aria-label="Искать в медиатеке" onClick={onSearch}>⌕</button><button className="sort-button" type="button" onClick={() => onNavigate('likes')}>Недавно добавленные <span>⌄</span></button></div>
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
