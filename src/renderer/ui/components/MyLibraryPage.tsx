
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
  onOpenPlaylist: (playlist: Playlist) => void;
};

export function MyLibraryPage({ tracks, playlists, tracksLoading, playlistsLoading, tracksError, playlistsError, artistFallback, currentTrackId, isPlaying, playbackLoading, onRefresh, onPlayTrack, onOpenTrack, onOpenPlaylist }: Props) {

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
      <PlaylistCarouselSection playlists={playlists} loading={playlistsLoading} error={playlistsError} onOpenPlaylist={onOpenPlaylist} />
    </div>
  );
}
