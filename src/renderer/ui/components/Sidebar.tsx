import type { Profile, Page } from '../types';

type Props = {
  profile: Profile | null;
  page: Page;
  backendReady: boolean;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
};

function initials(name: string): string {
  const letters = Array.from(name.trim());
  return (letters.length > 0 ? letters.slice(0, 2).join('') : 'SC').toUpperCase();
}

export function Sidebar({ profile, page, backendReady, onNavigate, onLogout }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">Better<span>SoundCloud</span></div>
      <div className="sidebar-label">ПРИЛОЖЕНИЕ</div>
      <nav aria-label="Главная навигация">
        <button type="button" className={`nav-item ${page === 'likes' ? 'active' : ''}`} onClick={() => onNavigate('likes')}>♥ <span>Мои лайки</span></button>
        <button type="button" className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>⚙ <span>Настройки</span></button>
      </nav>
      {profile && (
        <div className="user-card">
          {profile.avatarUrl
            ? <img className="user-avatar" src={profile.avatarUrl} alt="" />
            : <span className="user-avatar user-avatar-fallback">{initials(profile.username)}</span>}
          <div className="user-meta">
            <strong>{profile.fullName || profile.username}</strong>
            <small>@{profile.username}</small>
          </div>
          <button type="button" className="logout-button" onClick={onLogout} title="Выйти" aria-label="Выйти">⏻</button>
        </div>
      )}
      <div className="sidebar-bottom">
        <span className={`status-dot ${backendReady ? 'online' : ''}`} />
        <span>{backendReady ? 'Локальный backend запущен' : 'Запуск backend…'}</span>
      </div>
    </aside>
  );
}
