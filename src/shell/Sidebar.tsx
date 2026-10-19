import { useAppStore, type Route } from '../app/useAppStore';

const navigation: Array<{ route: Route; label: string; icon: string }> = [
  { route: 'home', label: 'Home', icon: '\u2302' },
  { route: 'search', label: 'Search', icon: '\u2315' },
  { route: 'playlists', label: 'Playlists', icon: '\u25a4' },
  { route: 'songs', label: 'Saved songs', icon: '\u266b' },
];

export function Sidebar() {
  const route = useAppStore((state) => state.route);
  const navigate = useAppStore((state) => state.navigate);
  return (
    <aside className="sidebar">
      <div className="brand-mark" aria-hidden="true">R</div>
      <div className="brand-copy"><strong>Resonance</strong><span>Music, in motion</span></div>
      <div className="sidebar-section-label">LIBRARY</div>
      <nav aria-label="Main navigation">
        {navigation.map((item) => (
          <button key={item.route} className={`nav-item${route === item.route ? ' active' : ''}`} aria-current={route === item.route ? 'page' : undefined} onClick={() => navigate(item.route)}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom"><span className="connection-dot" />Ready when you are</div>
    </aside>
  );
}