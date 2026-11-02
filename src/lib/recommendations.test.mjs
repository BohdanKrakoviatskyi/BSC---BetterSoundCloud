import assert from 'node:assert/strict';
import test from 'node:test';
import { rankRecommendations } from './recommendations.ts';

const seed = { id: 'seed', title: 'Blue Moon!', artist: 'The Artists', duration: 180 };
const candidate = (id, title, artist, duration = 180) => ({ id, title, artist, duration });

test('rejects same-title versions and already queued or disliked tracks', () => {
  const ranked = rankRecommendations(seed, [
    candidate('same-title', 'Blue Moon', 'The Artists'),
    candidate('queued', 'Red Sky', 'The Artists'),
    candidate('disliked', 'Green Light', 'The Artists'),
    candidate('good', 'Red Sky', 'The Artists'),
  ], new Set(['queued']), new Set(['disliked']));

  assert.deepEqual(ranked.map((track) => track.id), ['good']);
});

test('requires artist similarity and ranks closer track titles first', () => {
  const ranked = rankRecommendations(seed, [
    candidate('unrelated', 'Blue Horizon', 'Someone Else'),
    candidate('related', 'Blue Horizon', 'The Artists'),
    candidate('less-related', 'Summer Rain', 'The Artists'),
  ]);

  assert.deepEqual(ranked.map((track) => track.id), ['related', 'less-related']);
});

test('uses duration similarity to break otherwise equal recommendation ties', () => {
  const ranked = rankRecommendations(seed, [
    candidate('long', 'New Moon', 'The Artists', 320),
    candidate('close', 'New Moon', 'The Artists', 190),
  ]);

  assert.deepEqual(ranked.map((track) => track.id), ['close', 'long']);
});
