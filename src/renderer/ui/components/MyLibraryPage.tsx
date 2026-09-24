import { useState } from 'react';
import type { Playlist, Track } from '../../domain/models';
import { PlaylistCarouselSection } from './PlaylistCarouselSection';
import { TrackCarouselSection } from './TrackCarouselSection';

type Props = {
  tracks: Track[];
  playlists: Playlist[];
  tracksLoading: boolean;
  playlistsLoading: boolean;
  tracksError: string;
  playlistsError: string;
  artistFallback?: string;
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onRefresh: () => void;
  onPlayTrack: (track: Track) => void;
  onOpenTrack: (track: Track) => void;
  onLoadPlaylist: (playlist: Playlist) => Promise<Track[]>;
  onPlayPlaylist: (tracks: Track[], index: number) => void;
};

export function MyLibraryPage({ tracks, playlists, tracksLoading, playlistsLoading, tracksError, playlistsError, artistFallback, currentTrackId, isPlaying, playbackLoading, onRefresh, onPlayTrack, onOpenTrack, onLoadPlaylist, onPlayPlaylist }: Props) {
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [playlistTracksLoading, setPlaylistTracksLoading] = useState(false);
  const [playlistTracksError, setPlaylistTracksError] = useState('');

  async function openPlaylist(playlist: Playlist) {
    setSelectedPlaylist(playlist);
    setPlaylistTracks([]);
    setPlaylistTracksError('');
    setPlaylistTracksLoading(true);
    try {
      setPlaylistTracks(await onLoadPlaylist(playlist));
    } catch (reason) {
      setPlaylistTracksError(reason instanceof Error ? reason.message : 'Не удалось загрузить треки плейлиста');
    } finally {
      setPlaylistTracksLoading(false);
    }
  }

  function startPlaylist(index: number) {
    onPlayPlaylist(playlistTracks, index);
    setSelectedPlaylist(null);
  }

  return (
    <div className="page-content my-library-page">
      <div className="page-heading">
        <div className="heading-line">
          <div><div className="eyebrow">ТВОЯ МУЗЫКА</div><h1>Моя медиатека</h1></div>
          <button className="text-action" type="button" onClick={onRefresh} disabled={tracksLoading || playlistsLoading}>Обновить ↻</button>
        </div>
        <p>Твои любимые треки и плейлисты SoundCloud.</p>
      </div>
      <TrackCarouselSection
        title="Лайканые треки"
        kicker="ИЗ ТВОИХ ЛАЙКОВ"
        tracks={tracks}
        artistFallback={artistFallback}
        loading={tracksLoading}
        error={tracksError}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        playbackLoading={playbackLoading}
        onPlayTrack={onPlayTrack}
        onOpenTrack={onOpenTrack}
      />
      <PlaylistCarouselSection playlists={playlists} loading={playlistsLoading} error={playlistsError} onOpenPlaylist={openPlaylist} />
      {selectedPlaylist && <div className="playlist-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlaylist(null); }}>
        <section className="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-dialog-title">
          <button className="playlist-dialog-close" type="button" onClick={() => setSelectedPlaylist(null)} aria-label="Закрыть">×</button>
          <div className="playlist-dialog-heading">
            {selectedPlaylist.artwork ? <img src={selectedPlaylist.artwork} alt="" /> : <span className="playlist-dialog-art-fallback">♫</span>}
            <div><div className="eyebrow">ПЛЕЙЛИСТ SOUNDCLOUD</div><h2 id="playlist-dialog-title">{selectedPlaylist.title}</h2><p>{selectedPlaylist.artist} · {selectedPlaylist.trackCount} треков</p></div>
          </div>
          <div className="playlist-dialog-actions"><button className="primary-button" type="button" disabled={!playlistTracks.length || playlistTracksLoading} onClick={() => startPlaylist(0)}>▶ Слушать плейлист</button></div>
          <div className="playlist-dialog-list">
            {playlistTracksLoading ? <p className="tracks-empty">Загружаю треки плейлиста…</p>
              : playlistTracksError ? <p className="error-message" role="alert">{playlistTracksError}</p>
              : playlistTracks.length === 0 ? <p className="tracks-empty">В этом плейлисте нет доступных треков.</p>
              : playlistTracks.map((track, index) => <button type="button" className="playlist-dialog-track" key={`${track.id}-${index}`} onClick={() => startPlaylist(index)}>
                {track.artwork ? <img src={track.artwork} alt="" /> : <span className="playlist-dialog-track-fallback">♫</span>}
                <span><b>{track.title}</b><small>{track.artist.name || 'SoundCloud'}</small></span>
                <span className="playlist-dialog-track-play">▶</span>
              </button>)}
          </div>
        </section>
      </div>}
    </div>
  );
}
