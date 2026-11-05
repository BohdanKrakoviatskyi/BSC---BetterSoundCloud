import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { IconButton, Shape } from './ui';
import { PlaylistCover, Eq } from './Cover';
import { cx, useStore } from '../lib/util';
import { t, tracksLabel } from '../lib/i18n';
import { markResizing } from '../lib/motion';
import { library } from '../state/library';
import { player } from '../state/player';
import { YTMUSIC_LIKED_ID, YTMUSIC_SAVED_ID, ytmusicPlaylistId } from '../lib/ytmusic-library';
import { appearance } from '../state/appearance';
import { go, openDialog, routeKey, ui, type Route } from '../state/ui';

function NavItem({ k, active, expanded, label, sub, icon, art, onClick, playing, className }: {
  k: string; active: boolean; expanded: boolean; label: string; sub?: string; icon?: IconName; art?: ReactNode; onClick: () => void; playing?: boolean; className?: string;
}) {
  return (
    <button
      type="button"
      data-key={k}
      data-ripple
      className={cx('nav-item sl', className)}
      aria-current={active ? 'page' : undefined}
      data-tip={expanded ? undefined : label}
      data-tip-pos="right"
      onClick={onClick}
    >
      <span className="nav-ic">{art ?? (icon && <Icon name={icon} />)}</span>
      <span className="nav-label fade-x">
        {label}
        {sub && <span className="nav-sub">{sub}</span>}
      </span>
      {playing && <Eq on className="fade-x mr-4" />}
    </button>
  );
}

export function Logo() {
  const paletteStyle = useStore(appearance, (state) => state.bgMode === 'dynamic' && state.bgStyle === 'palette');
  return (
    <Shape n={8} amp={0.1} className={cx('spin-slow h-10 w-10', paletteStyle ? 'text-secondary-container' : 'text-primary')}>
      <Icon name="graphic_eq" size={22} className={paletteStyle ? 'text-on-secondary-container' : 'text-on-primary'} />
    </Shape>
  );
}

export function Sidebar({ mode }: { mode: 'inline' | 'drawer' }) {
  const expanded = useStore(ui, (s) => mode === 'drawer' || s.sidebar);
  const route = useStore(ui, (s) => s.route);
  const playlists = useStore(library, (s) => s.playlists);
  const soundcloudPlaylists = useStore(library, (s) => s.soundcloudPlaylists);
  const ytmusicPlaylists = useStore(library, (s) => s.ytmusicPlaylists);
  const ytmusicLiked = useStore(library, (s) => s.ytmusicLiked);
  const ytmusicSaved = useStore(library, (s) => s.ytmusicSaved);
  const ytmusicConnected = useStore(library, (s) => s.ytmusicAuthorized);
  const playing = useStore(player, (s) => s.playing);
  const curId = useStore(player, (s) => s.queue[s.index] ?? null);
  const listRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ y: number; h: number } | null>(null);
  const active = routeKey(route);

  useLayoutEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`);
    setInd(el ? { y: el.offsetTop, h: el.offsetHeight } : null);
  }, [active, playlists.length, soundcloudPlaylists.length, ytmusicPlaylists.length, ytmusicConnected, expanded]);

  const nav = (r: Route) => go(r);
  const toggleExpanded = () => {
    markResizing();
    ui.set({ sidebar: !expanded });
  };

  return (
    <nav className="panel panel-side sidebar" data-expanded={expanded} aria-label="Resonance">
      <div className="side-brand">
        {mode === 'inline' ? (
          <IconButton icon={expanded ? 'menu_open' : 'menu'} label={expanded ? t('collapse') : t('expand')} tip="right" onClick={toggleExpanded} />
        ) : (
          <Logo />
        )}
        <span className="fade-x flex min-w-0 items-center gap-2.5">
          {mode === 'inline' && <Logo />}
          <span className="display text-[24px]">Resonance</span>
        </span>
      </div>
      <div ref={listRef} className="side-scroll">
        <div className="side-indicator" style={{ transform: `translateY(${ind?.y ?? 0}px)`, height: ind?.h ?? 52, opacity: ind ? 1 : 0 }} />
        <NavItem k="home" icon="home" label={t('home')} active={active === 'home'} expanded={expanded} onClick={() => nav({ name: 'home' })} />
        <NavItem k="search" icon="search" label={t('search')} active={active === 'search'} expanded={expanded} onClick={() => nav({ name: 'search', q: '' })} />
        <NavItem k="favorites" icon="favorite" label={t('favorites')} active={active === 'favorites'} expanded={expanded} onClick={() => nav({ name: 'favorites' })} />
        <div className="side-section">
          <span className="label-up fade-x">{t('playlists')}</span>
          <IconButton icon="add" label={t('newPlaylist')} size="sm" variant="tonal" tip="right" onClick={() => openDialog({ kind: 'create' })} />
        </div>
        {soundcloudPlaylists.map((p) => (
          <NavItem
            key={`sc:${p.id}`}
            k={'pl:scpl:' + p.id}
            label={p.name}
            sub={tracksLabel(p.trackCount)}
            active={active === 'pl:scpl:' + p.id}
            expanded={expanded}
            playing={playing && !!curId && (library.get().soundcloudPlaylistTracks[p.urn] ?? []).some((track) => track.id === curId) && active === 'pl:scpl:' + p.id}
            art={<PlaylistCover p={{ id: p.id, name: p.name, ids: [], created: 0, artworkUrl: p.artworkUrl }} className="h-10 w-10 rounded-[12px]" />}
            onClick={() => nav({ name: 'playlist', id: `scpl:${p.id}` })}
          />
        ))}
        {playlists.map((p) => (
          <NavItem
            key={p.id}
            k={'pl:' + p.id}
            label={p.name}
            sub={tracksLabel(p.ids.length)}
            active={active === 'pl:' + p.id}
            expanded={expanded}
            playing={playing && !!curId && p.ids.includes(curId) && active === 'pl:' + p.id}
            art={<PlaylistCover p={p} className="h-10 w-10 rounded-[12px]" />}
            onClick={() => nav({ name: 'playlist', id: p.id })}
          />
        ))}
        {ytmusicConnected && (
          <>
            <NavItem
              k={'pl:' + YTMUSIC_LIKED_ID}
              icon="favorite"
              label={t('ytmusicLiked')}
              sub={tracksLabel(ytmusicLiked.length)}
              active={active === 'pl:' + YTMUSIC_LIKED_ID}
              expanded={expanded}
              playing={playing && !!curId && ytmusicLiked.some((track) => track.id === curId) && active === 'pl:' + YTMUSIC_LIKED_ID}
              onClick={() => nav({ name: 'playlist', id: YTMUSIC_LIKED_ID })}
            />
            <NavItem
              k={'pl:' + YTMUSIC_SAVED_ID}
              icon="music_note"
              label={t('ytmusicSaved')}
              sub={tracksLabel(ytmusicSaved.length)}
              active={active === 'pl:' + YTMUSIC_SAVED_ID}
              expanded={expanded}
              playing={playing && !!curId && ytmusicSaved.some((track) => track.id === curId) && active === 'pl:' + YTMUSIC_SAVED_ID}
              onClick={() => nav({ name: 'playlist', id: YTMUSIC_SAVED_ID })}
            />
            {ytmusicPlaylists.map((p) => (
              <NavItem
                key={`yt:${p.playlistId}`}
                k={'pl:' + ytmusicPlaylistId(p.playlistId)}
                label={p.title}
                sub={tracksLabel(p.trackCount)}
                active={active === 'pl:' + ytmusicPlaylistId(p.playlistId)}
                expanded={expanded}
                playing={playing && !!curId && (library.get().ytmusicPlaylistTracks[p.playlistId] ?? []).some((track) => track.id === curId) && active === 'pl:' + ytmusicPlaylistId(p.playlistId)}
                art={<PlaylistCover p={{ id: p.playlistId, name: p.title, ids: [], created: 0, artworkUrl: p.artworkUrl ?? undefined }} className="h-10 w-10 rounded-[12px]" />}
                onClick={() => nav({ name: 'playlist', id: ytmusicPlaylistId(p.playlistId) })}
              />
            ))}
          </>
        )}
      </div>
      <div className="side-bottom">
        <NavItem k="providers" icon="music_note" label={t('providers')} active={active === 'providers'} expanded={expanded} onClick={() => nav({ name: 'providers' })} />
        <NavItem k="appearance" icon="palette" label={t('appearance')} active={active === 'appearance'} expanded={expanded} onClick={() => nav({ name: 'appearance' })} />
      </div>
    </nav>
  );
}
