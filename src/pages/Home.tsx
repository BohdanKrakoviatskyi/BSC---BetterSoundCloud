import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Button, Chip, HRow, Section, type Vars } from '../components/ui';
import { Cover, Eq, PlaylistCover } from '../components/Cover';
import { MediaCard } from '../components/TrackList';
import { useStore } from '../lib/util';
import { pick, t, tracksLabel } from '../lib/i18n';
import { audiusTrending } from '../lib/api';
import { DEMO, DEMO_IDS, MOODS } from '../data/demo';
import { getTrack, library, registerTracks } from '../state/library';
import { player, playQueue, toggle } from '../state/player';
import { go, openDialog } from '../state/ui';
import type { Track } from '../types';

let trendCache: Track[] | null = null;

function QuickTile({ track, i }: { track: Track; i: number }) {
  const isCur = useStore(player, (s) => s.queue[s.index] === track.id);
  const playing = useStore(player, (s) => s.playing);
  return (
    <button
      type="button"
      data-ripple
      className="quick sl anim-in"
      data-current={isCur}
      style={{ '--i': i + 2 } as Vars}
      onClick={() => (isCur ? toggle() : playQueue(DEMO_IDS, i))}
    >
      <Cover src={track.thumb} className="quick-cover" />
      <span className="min-w-0 flex-1">
        <span className={'block truncate font-semibold ' + (isCur ? 'text-primary' : '')}>{track.title}</span>
        <span className="block truncate text-sm text-on-surface-variant">{track.artist}</span>
      </span>
      <span className="quick-play">{isCur ? <Eq on={playing} /> : <Icon name="play_arrow" fill />}</span>
    </button>
  );
}

export default function Home() {
  const recent = useStore(library, (s) => s.recent);
  const playlists = useStore(library, (s) => s.playlists);
  const [trend, setTrend] = useState<Track[] | null>(trendCache);
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (trendCache) return;
    const ac = new AbortController();
    setErr(false);
    audiusTrending(ac.signal)
      .then((r) => {
        registerTracks(r);
        trendCache = r;
        setTrend(r);
      })
      .catch((e: Error) => e.name !== 'AbortError' && setErr(true));
    return () => ac.abort();
  }, [retry]);

  const h = new Date().getHours();
  const greet = h < 5 ? 'goodNight' : h < 12 ? 'goodMorning' : h < 18 ? 'goodAfternoon' : 'goodEvening';
  const recentTracks = recent.map((id) => getTrack(id)).filter((x): x is Track => !!x);
  const recentIds = recentTracks.map((x) => x.id);
  const trendIds = trend?.map((x) => x.id) ?? [];
  const arrows: [string, string] = [t('previous'), t('next')];

  return (
    <div className="page">
      <header className="anim-in mb-6 mt-2">
        <h1 className="display text-[clamp(34px,6cqw,60px)]">{t(greet)}</h1>
        <p className="mt-2 text-lg text-on-surface-variant">{t('homeSubtitle')}</p>
      </header>

      <Section title={t('quickPicks')} subtitle={t('quickPicksSub')} i={1}>
        <div className="quick-grid">
          {DEMO.map((tr, i) => (
            <QuickTile key={tr.id} track={tr} i={i} />
          ))}
        </div>
      </Section>

      <Section
        title={t('trending')}
        subtitle={t('trendingSub')}
        i={3}
        action={<Icon name="trending_up" className="text-primary" size={28} />}
      >
        {err ? (
          <div className="card flex items-center gap-4">
            <Icon name="wifi_off" className="text-error" />
            <span className="flex-1 text-on-surface-variant">{t('loadError')}</span>
            <Button variant="tonal" icon="refresh" onClick={() => setRetry((r) => r + 1)}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <HRow labels={arrows}>
            {trend
              ? trend.map((tr, i) => <MediaCard key={tr.id} track={tr} list={trendIds} index={i} />)
              : Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="p-2.5">
                    <div className="skel aspect-square w-full rounded-[18px]" />
                    <div className="skel mt-3 h-3.5 w-3/4 rounded-full" />
                    <div className="skel mt-2 h-3 w-1/2 rounded-full" />
                  </div>
                ))}
          </HRow>
        )}
      </Section>

      <Section title={t('yourPlaylists')} i={4}>
        <HRow labels={arrows} cw={180}>
          {playlists.map((p, i) => (
            <button
              key={p.id}
              type="button"
              data-ripple
              className="mcard sl anim-in"
              style={{ '--i': i } as Vars}
              onClick={() => go({ name: 'playlist', id: p.id })}
            >
              <PlaylistCover p={p} className="mcard-cover" />
              <span className="mcard-title">{p.name}</span>
              <span className="mcard-sub">{tracksLabel(p.ids.length)}</span>
            </button>
          ))}
          <button type="button" data-ripple className="mcard sl anim-in" onClick={() => openDialog({ kind: 'create' })}>
            <span className="mcard-cover grid place-items-center !shadow-none outline-2 -outline-offset-2 outline-dashed outline-outline-variant">
              <Icon name="add" size={40} className="text-primary" />
            </span>
            <span className="mcard-title">{t('newPlaylist')}</span>
          </button>
        </HRow>
      </Section>

      <Section title={t('moods')} i={5}>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((m) => (
            <Chip key={m.q} icon={m.icon} label={pick(m.ru, m.en)} onClick={() => go({ name: 'search', q: m.q })} />
          ))}
        </div>
      </Section>

      {recentTracks.length > 0 && (
        <Section title={t('recent')} i={6} action={<Icon name="history" className="text-on-surface-variant" size={26} />}>
          <HRow labels={arrows}>
            {recentTracks.map((tr, i) => (
              <MediaCard key={tr.id} track={tr} list={recentIds} index={i} />
            ))}
          </HRow>
        </Section>
      )}
    </div>
  );
}
