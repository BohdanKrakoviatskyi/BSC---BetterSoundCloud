import type { Track } from '../../domain/models';
import { TrackCard } from './TrackCard';
import './ArtistTrackListPage.css';

type Props = {
  title: string;
  artistName: string;
  tracks: Track[];
  currentTrackId: number | null;
  isPlaying: boolean;
  playbackLoading: boolean;
  onBack: () => void;
  onPlay: (track: Track) => void;
  onOpen: (track: Track, context: Track[]) => void;
  onOpenArtist: (track: Track) => void;
};

export function ArtistTrackListPage({ title, artistName, tracks, currentTrackId, isPlaying, playbackLoading, onBack, onPlay, onOpen, onOpenArtist }: Props) {
  return <article className="page-content artist-track-list-page">
    <button className="track-detail-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Профиль автора</button>
    <header className="artist-track-list-header"><h1>{title}</h1><p>{artistName} · {tracks.length} треков</p></header>
    {tracks.length === 0
      ? <p className="tracks-empty">Треки не найдены.</p>
      : <div className="artist-track-card-grid">{tracks.map((track, index) => <TrackCard
          key={`${track.id}-${index}`}
          track={track}
          artistFallback={artistName}
          liked={false}
          busy={false}
          onToggleLike={() => undefined}
          isCurrent={currentTrackId === track.id}
          isPlaying={currentTrackId === track.id && isPlaying}
          isLoading={currentTrackId === track.id && playbackLoading}
          onPlay={() => onPlay(track)}
          onOpenDetails={() => onOpen(track, tracks)}
          onOpenArtist={() => onOpenArtist(track)}
        />)}</div>}
  </article>;
}
