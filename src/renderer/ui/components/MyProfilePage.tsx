import { useState } from 'react';
import type { ArtistProfile, Playlist, Profile, Track } from '../../domain/models';
import { ErrorMessage } from './ErrorMessage';
import './MyProfilePage.css';

type Props = {
  account: Profile;
  details: ArtistProfile | null;
  tracks: Track[];
  history: Track[];
  historyLoading: boolean;
  playlists: Playlist[];
  loading: boolean;
  error: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track, context: Track[]) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
};

type ProfileTab = 'all' | 'playlists';

export function MyProfilePage({ account, details, tracks, history, historyLoading, playlists, loading, error, currentTrackId, isPlaying, playbackLoading, onPlayTrack, onOpenTrack, onOpenPlaylist }: Props) {
  const [tab, setTab] = useState<ProfileTab>('all');
  const avatar = details?.avatar || account.avatarUrl;
  const displayName = details?.fullName || account.fullName || account.username;
  const followers = details?.followersCount ?? account.followersCount;
  const trackCount = details?.trackCount ?? account.trackCount;

  function renderTrack(track: Track, context: Track[]) {
    const isCurrent = track.id === currentTrackId;
    return <article className="my-profile-track" key={track.id}>
      <button className="my-profile-track-art" type="button" onClick={() => onOpenTrack(track, context)} aria-label={`Открыть ${track.title}`}>
        {track.artwork ? <img src={track.artwork} alt="" loading="lazy" /> : <span aria-hidden="true">♫</span>}
      </button>
      <div className="my-profile-track-copy">
        <button className="my-profile-track-title" type="button" onClick={() => onOpenTrack(track, context)}>{track.title}</button>
        <span>{track.artist.name || account.username}</span>
        <small>▶ {Number(track.playCount ?? 0).toLocaleString('ru-RU')}　♥ {Number(track.likeCount ?? 0).toLocaleString('ru-RU')}</small>
      </div>
      <button className={`my-profile-play${isCurrent && isPlaying ? ' is-playing' : ''}`} type="button" onClick={() => onPlayTrack(track)} disabled={isCurrent && playbackLoading} aria-label={isCurrent && isPlaying ? `Пауза: ${track.title}` : `Воспроизвести: ${track.title}`}>
        {isCurrent && playbackLoading ? '…' : isCurrent && isPlaying ? 'Ⅱ' : '▶'}
      </button>
    </article>;
  }

  return (
    <section className="my-profile-page" aria-labelledby="my-profile-name">
      <header className="my-profile-hero">
        {details?.banner && <img className="my-profile-banner" src={details.banner} alt="" />}
        <div className="my-profile-hero-shade" />
        <div className="my-profile-identity">
          {avatar
            ? <img className="my-profile-avatar" src={avatar} alt="" />
            : <span className="my-profile-avatar my-profile-avatar-fallback" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>}
          <div className="my-profile-name-block">
            <h1 id="my-profile-name">{displayName}</h1>
            <p>@{details?.username || account.username}</p>
          </div>
        </div>
        <div className="my-profile-stats" aria-label="Статистика профиля">
          {followers !== undefined && <div><b>{followers.toLocaleString('ru-RU')}</b><span>подписчиков</span></div>}
          {details?.followingsCount !== undefined && <div><b>{details.followingsCount.toLocaleString('ru-RU')}</b><span>подписок</span></div>}
          {trackCount !== undefined && <div><b>{trackCount.toLocaleString('ru-RU')}</b><span>треков</span></div>}
        </div>
      </header>

      <nav className="my-profile-tabs" aria-label="Содержимое профиля">
        <button type="button" className={tab === 'all' ? 'is-active' : ''} aria-current={tab === 'all' ? 'page' : undefined} onClick={() => setTab('all')}>All</button>
        <button type="button" className={tab === 'playlists' ? 'is-active' : ''} aria-current={tab === 'playlists' ? 'page' : undefined} onClick={() => setTab('playlists')}>Playlists</button>
      </nav>

      <div className="my-profile-content">
        {error && <ErrorMessage message={error} />}
        {loading && tracks.length === 0 && playlists.length === 0 && history.length === 0
          ? <p className="my-profile-state">Загружаю профиль…</p>
          : tab === 'all'
            ? <>
              <section className="my-profile-section" aria-labelledby="profile-tracks-heading">
                <div className="my-profile-section-heading"><h2 id="profile-tracks-heading">Треки</h2><span>{tracks.length}</span></div>
                {tracks.length === 0
                  ? <p className="my-profile-state">Опубликованные треки пока не найдены.</p>
                  : <div className="my-profile-track-list">{tracks.map((track) => renderTrack(track, tracks))}</div>}
              </section>
              <section className="my-profile-section my-profile-history" aria-labelledby="profile-history-heading">
                <div className="my-profile-section-heading"><h2 id="profile-history-heading">История прослушивания</h2><span>{history.length}</span></div>
                {historyLoading && history.length === 0
                  ? <p className="my-profile-state">Загружаю историю…</p>
                  : history.length === 0
                    ? <p className="my-profile-state">История прослушивания пока пуста.</p>
                    : <div className="my-profile-track-list">{history.map((track) => renderTrack(track, history))}</div>}
              </section>
            </>
            : <section className="my-profile-section" aria-labelledby="profile-playlists-heading">
                <div className="my-profile-section-heading"><h2 id="profile-playlists-heading">Playlists</h2><span>{playlists.length}</span></div>
                {playlists.length === 0
                  ? <p className="my-profile-state">Плейлисты пока не найдены.</p>
                  : <div className="my-profile-playlist-grid">
                      {playlists.map((playlist) => <button className="my-profile-playlist" type="button" key={playlist.id} onClick={() => onOpenPlaylist(playlist)}>
                        {playlist.artwork ? <img src={playlist.artwork} alt="" loading="lazy" /> : <span className="my-profile-playlist-fallback" aria-hidden="true">♫</span>}
                        <b>{playlist.title}</b>
                        <small>{playlist.trackCount} треков</small>
                      </button>)}
                    </div>}
              </section>}
      </div>
    </section>
  );
}
