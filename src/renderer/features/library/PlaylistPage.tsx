import type { Playlist, Track } from '../../domain/models';

type Props = {
  playlist: Playlist;
  tracks: Track[];
  loading: boolean;
  error: string;
  onBack: () => void;
  onPlay: (index: number) => void;
};

export function PlaylistPage({ playlist, tracks, loading, error, onBack, onPlay }: Props) {
  return (
    <section className="page-content playlist-page" aria-labelledby="playlist-page-title">
      <button className="text-action" type="button" onClick={onBack}>‹ Назад к медиатеке</button>
      <div className="playlist-dialog-heading">
        {playlist.artwork ? <img src={playlist.artwork} alt="" /> : <span className="playlist-dialog-art-fallback">♫</span>}
        <div><div className="eyebrow">ПЛЕЙЛИСТ SOUNDCLOUD</div><h1 id="playlist-page-title">{playlist.title}</h1><p>{playlist.artist} · {playlist.trackCount} треков</p></div>
      </div>
      <div className="playlist-dialog-actions"><button className="primary-button" type="button" disabled={!tracks.length || loading} onClick={() => onPlay(0)}>▶ Слушать плейлист</button></div>
      <div className="playlist-dialog-list">
        {loading ? <p className="tracks-empty">Загружаю треки плейлиста…</p>
          : error ? <p className="error-message" role="alert">{error}</p>
          : tracks.length === 0 ? <p className="tracks-empty">В этом плейлисте нет доступных треков.</p>
          : tracks.map((track, index) => <button type="button" className="playlist-dialog-track" key={`${track.id}-${index}`} onClick={() => onPlay(index)}>
            {track.artwork ? <img src={track.artwork} alt="" /> : <span className="playlist-dialog-track-fallback">♫</span>}
            <span><b>{track.title}</b><small>{track.artist.name || 'SoundCloud'}</small></span>
            <span className="playlist-dialog-track-play">▶</span>
          </button>)}
      </div>
    </section>
  );
}
