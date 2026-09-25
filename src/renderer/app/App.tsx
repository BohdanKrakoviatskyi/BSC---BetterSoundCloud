import { useAppController } from './useAppController';
import { AuthScreen } from '../features/auth/AuthScreen';
import { HomePage } from '../features/home/HomePage';
import { LikedTracksSection } from '../features/library/LikedTracksSection';
import { MyLibraryPage } from '../features/library/MyLibraryPage';
import { PlaylistPage } from '../features/library/PlaylistPage';
import { PlayerBar } from '../features/player/PlayerBar';
import { TrackSearch } from '../features/search/TrackSearch';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { TrackDetailsPage } from '../features/tracks/TrackDetailsPage';
import { Sidebar } from './Sidebar';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';

export function App() {
  const {
    settings, ready, error, saved, auth, profile, loginBusy, loginError,
    tracks, likedTracks, likeBusy, tracksLoading, tracksError,
    playlists, playlistsLoading, playlistsError, activePlaylist, activePlaylistTracks,
    activePlaylistLoading, activePlaylistError, history, historyLoading, historyError,
    currentTrack, playerVisible, detailsTrack, detailsLoading, detailsError,
    currentTrackIndex, queueTracks, playbackLoading, shouldPlay, playbackError, page,
    logoutDialogOpen, setLogoutDialogOpen, logoutBusy, selections, selectionsLoading,
    selectionsError, relatedTracks, relatedLoading, relatedError,
    setError, setPage, setShouldPlay, setPlaybackLoading, setPlaybackError,
    loadMixedSelections, clearHistory, refreshLibrary, selectTrack, openTrackDetails,
    openPlaylist, playPlaylist, toggleTrackLike, saveAccessToken, clearAppData,
    updateSettings, playDetailsTrack, togglePlayback, savePlayerVolume, loadTrackAt,
    handlePlaybackStateChange, focusGlobalSearch, confirmLogout, login, silentLogin,
  } = useAppController();

  if (!ready) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand auth-brand">Better<span>SoundCloud</span></div>
          <div className="eyebrow">ЛОКАЛЬНЫЙ BACKEND</div>
          {error
            ? <><div className="error-message auth-error" role="alert">{error}</div><button type="button" className="auth-button" onClick={() => window.location.reload()}>Попробовать снова</button></>
            : <p className="auth-note">Запускаем Go sidecar…</p>}
        </div>
      </div>
    );
  }

  if (auth === 'guest') return <AuthScreen error={loginError} busy={loginBusy} clientId={settings.clientId} onLogin={(token, clientId) => void login(token, clientId)} onSilentLogin={silentLogin} />;

  return (
    <div className={`app-shell ${playerVisible ? 'player-visible' : ''}`}>
      <header className="topbar">
        <div className="window-tools"><button className="icon-button" type="button" onClick={() => setPage('likes')} aria-label="Назад">‹</button></div>
        <div className="global-search"><TrackSearch onSelect={selectTrack} /></div>
        <div className="top-actions">
          <button className="icon-button header-settings" type="button" onClick={() => setPage('settings')} aria-label="Настройки" title="Настройки">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33h-.08a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51h-.08a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82v-.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1v-.08a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.08a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
          <div className="header-account" title={profile?.fullName || profile?.username || 'SoundCloud'}>
            {profile?.avatarUrl
              ? <img className="header-avatar" src={profile.avatarUrl} alt="" />
              : <span className="header-avatar header-avatar-fallback" aria-hidden="true">{(profile?.username || 'SC').slice(0, 2).toUpperCase()}</span>}
            <span className="header-account-copy"><b>{profile?.fullName || profile?.username || 'SoundCloud'}</b><small>@{profile?.username || 'аккаунт'}</small></span>
          </div>
          <button className="icon-button header-logout" type="button" onClick={() => { setError(''); setLogoutDialogOpen(true); }} title="Выйти из SoundCloud" aria-label="Выйти из SoundCloud">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.75H6.5A1.75 1.75 0 0 0 4.75 6.5v11A1.75 1.75 0 0 0 6.5 19.25H10" /><path d="M13.5 8.25 17.25 12l-3.75 3.75M17 12H9" /></svg>
          </button>
        </div>
      </header>
      <div className="workspace">
        <Sidebar profile={profile} page={page} tracks={tracks} onNavigate={setPage} onPlayTrack={selectTrack} />
        <main className="main-view panel" id="mainView"><div className="main-scroll">
        {page === 'home'
          ? <HomePage
              selections={selections}
              loading={selectionsLoading}
              error={selectionsError}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
              artistFallback={profile?.username}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={shouldPlay}
              playbackLoading={playbackLoading}
              onPlayTrack={selectTrack}
              onOpenTrack={(track) => void openTrackDetails(track)}
              onClearHistory={() => void clearHistory()}
              onRetry={() => void loadMixedSelections()}
            />
          : page === 'search'
            ? <section className="page-content search-landing"><span className="eyebrow">ПОИСК SOUNDCLOUD</span><h1>Найди свой следующий трек</h1><p>Введи название песни или имя исполнителя в строку поиска.</p><button type="button" className="primary-button" onClick={focusGlobalSearch}>Начать поиск <span>⌕</span></button></section>
          : page === 'library'
            ? <MyLibraryPage
                tracks={tracks}
                playlists={playlists}
                tracksLoading={tracksLoading}
                playlistsLoading={playlistsLoading}
                tracksError={tracksError}
                playlistsError={playlistsError}
                artistFallback={profile?.username}
                currentTrackId={currentTrack?.id ?? null}
                isPlaying={shouldPlay}
                playbackLoading={playbackLoading}
                onRefresh={refreshLibrary}
                onPlayTrack={selectTrack}
                onOpenTrack={(track) => void openTrackDetails(track)}
                onOpenPlaylist={(playlist) => void openPlaylist(playlist)}
              />
          : page === 'playlist' && activePlaylist
            ? <PlaylistPage playlist={activePlaylist} tracks={activePlaylistTracks} loading={activePlaylistLoading} error={activePlaylistError} onBack={() => setPage('library')} onPlay={playPlaylist} />
          : page === 'likes'
          ? <LikedTracksSection
              tracks={tracks}
              likedTracks={likedTracks}
              likeBusy={likeBusy}
              loading={tracksLoading}
              error={tracksError}
              artistFallback={profile?.username}
              onToggleLike={(track) => void toggleTrackLike(track)}
              onPlayTrack={selectTrack}
              onOpenTrack={(track) => void openTrackDetails(track)}
              currentTrackId={currentTrack?.id ?? null}
              isPlaying={shouldPlay}
              playbackLoading={playbackLoading}
            />
          : page === 'settings'
            ? <SettingsPanel settings={settings} saved={saved} error={error} profile={profile} tokenError={loginError} tokenBusy={loginBusy} onSaveToken={saveAccessToken} onClearData={clearAppData} onUpdate={(patch) => void updateSettings(patch)} />
          : <TrackDetailsPage
                track={detailsTrack}
                loading={detailsLoading}
                error={detailsError}
                isCurrent={currentTrack?.id === detailsTrack?.id}
                isPlaying={shouldPlay}
                playbackLoading={currentTrack?.id === detailsTrack?.id && playbackLoading}
                relatedTracks={relatedTracks}
                relatedLoading={relatedLoading}
                relatedError={relatedError}
                currentTrackId={currentTrack?.id ?? null}
                isPlayingNow={shouldPlay}
                onPlayRelated={selectTrack}
                onOpenRelated={(track) => void openTrackDetails(track)}
                onBack={() => setPage('likes')}
                onPlay={playDetailsTrack}
              />}
        {tracksError && page !== 'likes' && <div className="error-message app-track-error" role="alert">{tracksError}</div>}
        </div></main>
      </div>
      {logoutDialogOpen && <ConfirmDialog
        eyebrow="АККАУНТ SOUNDCLOUD"
        title="Выйти из аккаунта?"
        description="Аккаунт будет отключён только в BetterSoundCloud. Доступ к нему в браузере и других приложениях не изменится."
        confirmLabel="Выйти"
        busyLabel="Выходим…"
        busy={logoutBusy}
        variant="danger"
        onClose={() => setLogoutDialogOpen(false)}
        onConfirm={() => void confirmLogout()}
      >
        {error && <div className="error-message" role="alert">{error}</div>}
      </ConfirmDialog>}
      <PlayerBar
        track={currentTrack}
        loading={playbackLoading}
        shouldPlay={shouldPlay}
        volume={settings.volume}
        error={playbackError}
        liked={currentTrack ? (likedTracks[currentTrack.id] ?? false) : false}
        onLike={() => { if (currentTrack) void toggleTrackLike(currentTrack); }}
        onOpenTrack={() => { if (currentTrack) void openTrackDetails(currentTrack); }}
        onTogglePlayback={togglePlayback}
        onVolumeCommit={(volume) => void savePlayerVolume(volume)}
        onPrevious={() => void loadTrackAt(Math.max(currentTrackIndex - 1, 0))}
        onNext={() => void loadTrackAt(currentTrackIndex + 1)}
        hasNext={currentTrackIndex >= 0 && currentTrackIndex + 1 < queueTracks.length}
        onEnded={() => {
          if (currentTrackIndex + 1 < queueTracks.length) void loadTrackAt(currentTrackIndex + 1);
          else setShouldPlay(false);
        }}
        onReady={() => setPlaybackLoading(false)}
        onError={(message) => { setPlaybackError(message); setPlaybackLoading(false); setShouldPlay(false); }}
        onPlaybackStateChange={handlePlaybackStateChange}
      />
    </div>
  );
}
