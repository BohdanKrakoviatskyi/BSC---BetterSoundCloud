import type { LyricLine, Track } from '../types';
import type { IconName } from '../components/Icon';
import { withGaps } from '../lib/api';

interface Song { v1: string[]; c: string[]; v2: string[]; b: string[] }

const px = (id: number, s: number) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${s}&h=${s}&fit=crop`;
const sh = (n: number) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`;

/** Spreads an original song structure across the real track length → synced LRC-like lines. */
function build(s: Song, dur: number): LyricLine[] {
  const parts = [s.v1, s.c, s.v2, s.c, s.b, s.c, s.c];
  const n = parts.reduce((a, p) => a + p.length, 0);
  const ld = Math.min(6.4, Math.max(4.6, dur / 62));
  const gap = Math.max(4, (dur * 0.93 - n * ld) / (parts.length + 0.6));
  let t = gap * 0.6;
  const out: LyricLine[] = [];
  for (const p of parts) {
    for (const text of p) {
      out.push({ t: Math.round(t * 100) / 100, text });
      t += ld;
    }
    t += gap;
  }
  return withGaps(out);
}

const RAW: [string, string, string, number, number, number, Song][] = [
  ['Neon Skyline', 'Midnight Arcade', 'Afterglow', 4515793, 1, 372.7, {
    v1: ['Streetlights hum a midnight tune', 'Chrome reflections, silver moon', 'Every window tells a story', 'Painted in electric glory'],
    c: ['We\'re running on a neon skyline', 'Racing every red light, feeling alive', 'Hold on tight, the city\'s on fire', 'We\'re higher, higher, higher'],
    v2: ['Billboards flicker, hearts in sync', 'We don\'t stop, we never blink', 'Static whispers on the radio', 'Take me anywhere you wanna go'],
    b: ['And when the morning comes to find us', 'We\'ll leave the night behind us'],
  }],
  ['Pink Concrete', 'Sasha Lune', 'Soft Brutalism', 32193382, 3, 344.1, {
    v1: ['Pink light spills on concrete walls', 'Echoes drifting down the halls', 'Ninth floor window, open wide', 'The whole sky blushing outside'],
    c: ['Stay with me in the golden hour', 'Soft as rain and sweet as sugar', 'Every block is turning rose', 'Hold the moment, don\'t let it go'],
    v2: ['Laundry dancing on the line', 'Your hand is warm inside of mine', 'Kids are laughing, buses hum', 'Tomorrow doesn\'t have to come'],
    b: ['The sun is melting into gray', 'But you and I, we\'ll always stay'],
  }],
  ['Primary Colors', 'Paper Planets', 'Color Theory', 1579243, 4, 302.5, {
    v1: ['Red like the heart on my sleeve', 'Blue like the sky that you leave', 'Yellow like a Sunday sun', 'Mix them up and we\'re the one'],
    c: ['We\'re primary colors, bright and bold', 'A brand new story to be told', 'Splash it on the canvas, let it run', 'Paint the world till we\'re done'],
    v2: ['Fingerprints on every wall', 'Masterpieces, big and small', 'Never staying in the lines', 'We were made for brighter times'],
    b: ['When the gray tries to take us down', 'We\'ll color every street in town'],
  }],
  ['Coral Drift', 'Tidewater', 'Low Tide', 1561020, 6, 279.6, {
    v1: ['Salt on my lips and sand in my hair', 'Floating away without a care', 'Coral and teal in the afternoon', 'Waves are humming a lazy tune'],
    c: ['Let it drift, let it drift', 'Like the tide, a gentle shift', 'Nothing here we have to fix', 'Just you and me, adrift'],
    v2: ['Seashells keeping all our secrets', 'Footprints washing, we don\'t keep them', 'Sunset bleeding into blue', 'Every color looks like you'],
    b: ['Close your eyes and count the waves', 'This is how forever stays'],
  }],
  ['Emerald Hours', 'Lumen Forest', 'Canopy', 39922673, 8, 325.3, {
    v1: ['Morning mist between the pines', 'Golden threads through tangled vines', 'Footsteps soft on mossy ground', 'The quiet is the only sound'],
    c: ['In the emerald hours we breathe again', 'Light is falling like a gentle rain', 'Every branch is reaching for the sun', 'Here our hearts become one'],
    v2: ['Ancient roots and whispered names', 'Nothing ever stays the same', 'Leaves are turning, seasons flow', 'Teaching us to let things go'],
    b: ['Lay your worries on the forest floor', 'You won\'t need them anymore'],
  }],
  ['Northern Lights', 'Nordlys', 'Polar Night', 5228777, 5, 354.0, {
    v1: ['Frozen lake beneath the stars', 'Breath like clouds, the night is ours', 'Silence wraps the world in white', 'Waiting for the sky to light'],
    c: ['Dancing in the northern lights', 'Green and violet, burning bright', 'Ribbons falling from above', 'This is what they call love'],
    v2: ['Polar winds are singing low', 'Footprints fading in the snow', 'Hand in hand, we lose the cold', 'A story older than the old'],
    b: ['If the darkness lasts forever', 'We will shine through it together'],
  }],
  ['Golden Dunes', 'Mirage FM', 'Mirage', 9778633, 9, 389.4, {
    v1: ['Heat waves rising off the sand', 'A lonely road and an open hand', 'Sunset painting all the dunes', 'Copper skies and silver moons'],
    c: ['Walking on the golden dunes', 'Chasing echoes, chasing tunes', 'Is it real or a mirage?', 'Every step a new collage'],
    v2: ['Camel bells in the distant haze', 'Lost in time for days and days', 'Stars come out like scattered gold', 'The desert has a tale untold'],
    b: ['When the wind erases every trace', 'I\'ll still remember your face'],
  }],
  ['Crimson Static', 'Velvet Riot', 'Static Bloom', 5112006, 2, 426.0, {
    v1: ['Red lights flashing in my head', 'Every word you never said', 'Turn it up and let it bleed', 'Static is the air I breathe'],
    c: ['Crimson static, burning loud', 'Screaming louder than the crowd', 'Can you feel the voltage rise?', 'Electric fire in our eyes'],
    v2: ['Broken strings and midnight shows', 'Nobody knows where this road goes', 'Amplifiers, shaking walls', 'We were born to break the falls'],
    b: ['Pull the plug, we\'re still alive', 'Feedback is how we survive'],
  }],
];

export const DEMO: Track[] = RAW.map(([title, artist, album, pid, n, dur, song], i) => ({
  id: 'd' + (i + 1),
  title,
  artist,
  album,
  cover: px(pid, 720),
  thumb: px(pid, 200),
  src: sh(n),
  duration: dur,
  source: 'demo',
  lyrics: build(song, dur),
}));
export const DEMO_IDS = DEMO.map((d) => d.id);

export const MOODS: { q: string; icon: IconName; ru: string; en: string; hue: number }[] = [
  { q: 'lofi beats', icon: 'coffee', ru: 'Кофе и фокус', en: 'Coffee & focus', hue: 40 },
  { q: 'synthwave', icon: 'rocket_launch', ru: 'Синтвейв', en: 'Synthwave', hue: 310 },
  { q: 'ambient chill', icon: 'self_improvement', ru: 'Спокойствие', en: 'Calm', hue: 180 },
  { q: 'workout edm', icon: 'bolt', ru: 'Энергия', en: 'Energy', hue: 70 },
  { q: 'dance hits', icon: 'nightlife', ru: 'Вечеринка', en: 'Party', hue: 340 },
  { q: 'love songs', icon: 'favorite', ru: 'Романтика', en: 'Romance', hue: 10 },
  { q: 'classical piano', icon: 'piano', ru: 'Классика', en: 'Classical', hue: 260 },
  { q: 'indie folk', icon: 'park', ru: 'Инди', en: 'Indie', hue: 130 },
  { q: 'sleep ambient', icon: 'bedtime', ru: 'Для сна', en: 'Sleep', hue: 230 },
  { q: 'top hits', icon: 'local_fire_department', ru: 'Хиты', en: 'Hits', hue: 20 },
];
