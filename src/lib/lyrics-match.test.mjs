import assert from 'node:assert/strict';
import test from 'node:test';
import { findLyricsCandidate, lyricsSearchQueries } from './lyrics-match.ts';

test('uses the song title and artist from an official video title', () => {
  const queries = lyricsSearchQueries({
    title: 'Ravyn Lenae - Love Me Not (Official Music Video)',
    artist: 'Ravyn Lenae',
    source: 'youtube',
  });

  assert.deepEqual(queries[0], { title: 'Love Me Not', artist: 'Ravyn Lenae' });
});

test('uses artist credit from a lyric upload instead of its channel name', () => {
  const queries = lyricsSearchQueries({
    title: 'Ravyn Lenae - Love Me Not (Lyrics)',
    artist: 'R&BHype',
    source: 'youtube',
  });

  assert.deepEqual(queries[0], { title: 'Love Me Not', artist: 'Ravyn Lenae' });
});

test('matches YouTube lyrics when the music video differs in duration slightly', () => {
  const candidate = findLyricsCandidate([{
    trackName: 'Love Me Not', artistName: 'Ravyn Lenae', duration: 215, syncedLyrics: '[00:00.00] lyric',
  }], { title: 'Love Me Not', artist: 'Ravyn Lenae' }, 219, 30);

  assert.equal(candidate?.trackName, 'Love Me Not');
});
