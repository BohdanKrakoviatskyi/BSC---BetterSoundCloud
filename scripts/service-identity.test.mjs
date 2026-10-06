import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as esbuild from 'esbuild';

// The multi-service id scheme, tested.
//
// serviceIdentity.ts hands out the numeric ids that tracks from Spotify and YouTube Music carry in
// the `id` field the domain requires. That field is compared directly all over the app, so the whole
// point of the module is that two different things never come out with the same number. These tests
// exist because the alternative — hashing a string id into the field — also produces a number, and
// only fails in the cases below.
//
// There is no TypeScript test runner in this project, so the module is compiled with the esbuild
// that vite already pulls in and run in a vm, which is the same approach auth-init.test.mjs takes.

const source = readFileSync(fileURLToPath(new URL('../src/renderer/lib/serviceIdentity.ts', import.meta.url)), 'utf8');

async function loadModule() {
  const compiled = await esbuild.transform(source, { loader: 'ts', format: 'cjs' });
  const exports = {};
  // No require: the only import in the module is a type-only one, which esbuild drops, so the
  // compiled output has no dependencies to resolve.
  const sandbox = { exports, module: { exports }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(compiled.code, sandbox);
  return sandbox.module.exports;
}

const module_ = await loadModule();
const { identityFor, sameTrack, foreignIdentityCount } = module_;

function track(fields) {
  return { urn: '', title: '', durationMs: 0, artist: { name: '' }, ...fields };
}

test('the same native id always gets the same number', () => {
  // Without this, a track fetched from the library and the same track fetched from a playlist would
  // compare unequal, and the app would lose track of what is playing.
  const first = identityFor('spotify', '4cOdK2wGLETKBW3PvgPWqT');
  const second = identityFor('spotify', '4cOdK2wGLETKBW3PvgPWqT');
  assert.equal(first, second);
  assert.equal(foreignIdentityCount(), 1, 'a repeated lookup must not allocate a second id');
});

test('different native ids get different numbers', () => {
  // The property a hash does not have. Ten thousand ids, because a collision that shows up one time
  // in a million still means liking the wrong track.
  const ids = Array.from({ length: 10_000 }, (_, index) => `track-${index}`);
  const assigned = ids.map((id) => identityFor('spotify', id));
  assert.equal(new Set(assigned).size, ids.length, 'two native ids were given the same number');
});

test('the same native id in two services gets two different numbers', () => {
  // The case a per-service lookup gets wrong. Spotify and YouTube Music both use short string ids,
  // and two tracks that share one are two different songs.
  const spotifyId = identityFor('spotify', 'shared-id');
  const youtubeId = identityFor('youtube-music', 'shared-id');
  assert.notEqual(spotifyId, youtubeId);
});

test('every id is an exact integer inside the safe range', () => {
  const id = identityFor('spotify', 'exactness-check');
  assert.ok(Number.isSafeInteger(id), `${id} is not a safe integer`);
  assert.equal(Math.floor(id), id);
});

test('the ids cannot overlap the ones SoundCloud uses', () => {
  // SoundCloud ids are plain integers from its own sequence, and every existing screen compares
  // against them. A hand-rolled id that landed on one of those would make a Spotify track compare
  // equal to a SoundCloud track.
  const foreign = identityFor('spotify', 'no-overlap-check');
  for (const soundcloudId of [1, 42, 12_345_678, 999_999_999, 4_999_999_999]) {
    assert.notEqual(foreign, soundcloudId, `collided with SoundCloud id ${soundcloudId}`);
  }
  // And it has to stay clear of them for the whole run, not just for this id.
  assert.ok(foreign > 1_000_000_000_000_000, `${foreign} is low enough to reach SoundCloud's range`);
});

test('sameTrack compares foreign tracks on the service and the native id', () => {
  const a = track({ id: 111, source: 'spotify', nativeId: 'abc' });
  const b = track({ id: 222, source: 'spotify', nativeId: 'abc' });
  assert.equal(sameTrack(a, b), true, 'two views of the same track must be equal despite different ids');
});

test('sameTrack keeps two services apart', () => {
  const spotifyTrack = track({ id: 111, source: 'spotify', nativeId: 'abc' });
  const youtubeTrack = track({ id: 111, source: 'youtube-music', nativeId: 'abc' });
  assert.equal(sameTrack(spotifyTrack, youtubeTrack), false);
});

test('sameTrack does not match a foreign track to a SoundCloud one', () => {
  const foreign = track({ id: 111, source: 'spotify', nativeId: 'abc' });
  const soundcloud = track({ id: 111 });
  assert.equal(sameTrack(foreign, soundcloud), false, 'a shared number must not make them the same row');
});

test('sameTrack keeps the existing SoundCloud behaviour', () => {
  // No source and no nativeId means SoundCloud, and those still compare on id exactly as before.
  assert.equal(sameTrack(track({ id: 7 }), track({ id: 7 })), true);
  assert.equal(sameTrack(track({ id: 7 }), track({ id: 8 })), false);
});
