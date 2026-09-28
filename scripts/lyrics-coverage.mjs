#!/usr/bin/env node
/**
 * lyrics-coverage.mjs — benchmark for lyrics provider strategies.
 *
 * This is a measurement tool, not the app implementation. It answers one question:
 * for a real SoundCloud library, how many tracks does each candidate strategy
 * actually find lyrics for, and how much does every extra layer add?
 *
 * It reports recall (how much was found) and a precision audit (whose lyrics were
 * actually returned), because recall alone cannot tell a good hit from a wrong song.
 *
 * Usage:
 *   node scripts/lyrics-coverage.mjs                          # uses scripts/lyrics-sample.txt
 *   node scripts/lyrics-coverage.mjs path/to/my-library.txt
 *   node scripts/lyrics-coverage.mjs --json out.json
 *   node scripts/lyrics-coverage.mjs --delay 800
 *
 * Input format is the "copy from the app" shape: a title line prefixed with ▶,
 * the SoundCloud artist on the next line, then optional ▶ plays / ♥ likes lines.
 * An optional `~M:SS` suffix on the artist line supplies the duration, which
 * sharpens candidate scoring; without it scoring falls back to title+artist.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const LRCLIB = 'https://lrclib.net/api';
const USER_AGENT = 'BetterSoundCloud-coverage-bench/0.1 (local dev script)';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const positional = args.filter((value, index) => {
  if (value.startsWith('--')) return false;
  const previous = args[index - 1];
  return !(previous && previous.startsWith('--'));
});

const inputPath = path.resolve(positional[0] ?? 'scripts/lyrics-sample.txt');
const jsonOut = flag('json', null);
const delayMs = Number(flag('delay', '350'));
const concurrency = Math.max(1, Number(flag('concurrency', '3')));

/* ------------------------------------------------------------------ parsing */

/** Splits the pasted library dump into `{ title, artist, plays, likes, durationSec }`. */
function parseLibrary(text) {
  const tracks = [];

  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const titleIndex = lines.findIndex((line) => line.startsWith('▶'));
    if (titleIndex < 0 || !lines[titleIndex + 1]) continue;

    const durationMatch = lines[titleIndex + 1].match(/[~(]\s*(\d{1,2}):([0-5]\d)\s*\)?\s*$/);
    const artist = lines[titleIndex + 1]
      .replace(/[~(]\s*\d{1,2}:[0-5]\d\s*\)?\s*$/, '')
      .trim();

    tracks.push({
      title: lines[titleIndex].replace(/^▶\s*/, '').trim(),
      artist,
      plays: Number((lines.find((line) => /^▶\s*[\d\s]+$/.test(line)) ?? '').replace(/\D/g, '')) || 0,
      likes: Number((lines.find((line) => /^♥\s*[\d\s]+$/.test(line)) ?? '').replace(/\D/g, '')) || 0,
      durationSec: durationMatch ? Number(durationMatch[1]) * 60 + Number(durationMatch[2]) : 0,
    });
  }

  return tracks;
}

/* ------------------------------------------------------- title normalisation */

const VERSION_WORDS = [
  'slowed', 'sped up', 'speed up', 'reverb', 'bass boosted', 'remix', 'edit', 'flip',
  'mashup', 'slow version', 'rework', 're-work', 'bootleg', 'vip', 'prod.', 'nightcore', '8d',
  'reversed', 'capella', 'spedup', 'slowedit',
];
const TIMING_RISK_WORDS = VERSION_WORDS.filter((word) => word !== 'prod.');

/** Removes bracketed noise, `prod. X`, hashtags and feature lists from a title. */
function stripNoise(value) {
  return String(value ?? '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\bprod\.?\s+[\p{L}\p{N}_]+/giu, ' ')
    .replace(/\b(?:ft|feat|featuring|with)\.?\s+[\p{L}\p{N}&,'’. -]+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\-_–—]+$/g, '')
    .trim();
}

/** True when the string still carries a version marker such as `(Super Slowed)`. */
function hasVersionMarker(value) {
  const normalized = ` ${String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  return VERSION_WORDS.some((word) => {
    const marker = word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return marker && normalized.includes(` ${marker} `);
  });
}

function hasTimingRiskMarker(value) {
  const normalized = ` ${String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  return TIMING_RISK_WORDS.some((word) => {
    const marker = word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return marker && normalized.includes(` ${marker} `);
  });
}

/**
 * Builds the title/artist variant matrix for one SoundCloud track.
 * `PIXELATED KISSES - JOJI [SLIGHTLY 0.5x SLOWED]` yields the plain title and
 * "JOJI" as a candidate artist, which is what makes the original findable.
 */
function buildVariants(track) {
  const dashParts = track.title
    .split(/\s+[-–—]\s+/)
    .map((part) => stripNoise(part))
    .filter(Boolean);

  const titles = [...new Set([stripNoise(track.title), ...dashParts].filter(Boolean))];
  const artists = [...new Set([track.artist, ...dashParts].filter(Boolean))];

  return { titles: titles.slice(0, 4), artists: artists.slice(0, 4) };
}

/* ------------------------------------------------------------- LRCLib client */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// lrclib answers 503 ServerOverloaded generously and the limit is shared per IP. A run made
// while already throttled silently reports every track as "not found", so throttled responses
// are counted separately and the run is declared unreliable instead of printing a false number.
const stats = { ok: 0, throttled: 0, notFound: 0, error: 0, errorDetails: [] };
const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 10_000;

async function lrclib(pathAndQuery, attempt = 0) {
  const url = `${LRCLIB}${pathAndQuery}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 503) {
      stats.throttled += 1;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * (attempt + 1));
        return lrclib(pathAndQuery, attempt + 1);
      }
      return { error: 'throttled' };
    }
    if (response.status === 404) {
      stats.notFound += 1;
      return null;
    }
    if (!response.ok) {
      stats.error += 1;
      return { error: `HTTP ${response.status}` };
    }

    stats.ok += 1;
    return response.json();
  } catch (error) {
    if (attempt < 2) {
      await sleep(600 * (attempt + 1));
      return lrclib(pathAndQuery, attempt + 1);
    }
    stats.error += 1;
    if (stats.errorDetails.length < 5) stats.errorDetails.push(String(error.cause?.code ?? error.message ?? error));
    return { error: String(error) };
  }
}

/* ------------------------------------------------------------- Deezer client */

const DEEZER = 'https://api.deezer.com';

// Deezer needs neither a token nor an API key, which is what makes it usable from a desktop
// build. Spotify could serve the same purpose, but only behind OAuth client credentials that
// would have to be baked into a distributable binary, and their terms separately forbid using
// the API to build a lyrics service.
const deezerStats = { ok: 0, empty: 0, error: 0, errorDetails: [] };

async function deezerSearch(query, limit = 8, attempt = 0) {
  try {
    const response = await fetch(`${DEEZER}/search?limit=${limit}&q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status >= 500 && attempt < 1) {
        await sleep(500 * (attempt + 1));
        return deezerSearch(query, limit, attempt + 1);
      }
      deezerStats.error += 1;
      if (deezerStats.errorDetails.length < 5) deezerStats.errorDetails.push(`HTTP ${response.status}`);
      return null;
    }

    const payload = await response.json();
    if (payload?.error) {
      deezerStats.error += 1;
      if (deezerStats.errorDetails.length < 5) deezerStats.errorDetails.push(String(payload.error.message ?? 'Deezer API error'));
      return null;
    }
    const data = Array.isArray(payload?.data) ? payload.data : [];
    if (data.length) deezerStats.ok += 1;
    else deezerStats.empty += 1;
    return data;
  } catch (error) {
    if (attempt < 1) {
      await sleep(500 * (attempt + 1));
      return deezerSearch(query, limit, attempt + 1);
    }
    deezerStats.error += 1;
    if (deezerStats.errorDetails.length < 5) deezerStats.errorDetails.push(String(error.cause?.code ?? error.message ?? error));
    return null;
  }
}

/* ------------------------------------------------------------------ scoring */

const normalize = (value) => stripNoise(value)
  .toLowerCase()
  .replace(/[’'`]/g, '')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tokenSet = (value) => new Set(normalize(value).split(' ').filter(Boolean));

const TITLE_FILLER_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for', 'from',
  'i', 'if', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'up', 'we',
  'what', 'when', 'where', 'who', 'you', 'your',
]);
const VERSION_TOKENS = new Set(VERSION_WORDS.flatMap((word) => tokenSet(word)));
const minimumTitleTokens = 3;

function titleSpecificity(value) {
  return [...tokenSet(value)].filter((token) => !TITLE_FILLER_WORDS.has(token) && !VERSION_TOKENS.has(token)).length;
}

/**
 * Token overlap between the wanted name and the candidate name.
 *
 * A candidate whose name is a strict superset ("Люби меня люби" for "Люби Меня") used to
 * score a perfect 1.0, because the reverse overlap was also complete. Substring matches
 * are real, but a candidate carrying many extra words is a different, longer song and has
 * to lose to the exact-length candidate, so the surplus words are penalised.
 */
function tokenOverlap(want, have) {
  const a = tokenSet(want);
  const b = tokenSet(have);
  if (a.size === 0 || b.size === 0) return 0;

  let forward = 0;
  for (const token of a) if (b.has(token)) forward += 1;

  let reverse = 0;
  for (const token of b) if (a.has(token)) reverse += 1;

  const base = (forward / a.size) * 0.7 + (reverse / b.size) * 0.3;
  const surplus = Math.max(0, b.size - a.size) / Math.max(b.size, 1);
  return base * (1 - Math.min(0.45, surplus * 0.45));
}

function durationScore(wantSec, haveSec) {
  if (!wantSec || !haveSec) return null;
  const delta = Math.abs(wantSec - haveSec);
  if (delta <= 2) return 1;
  if (delta <= 5) return 0.8;
  if (delta <= 12) return 0.5;
  return delta / (wantSec + haveSec) > 0.35 ? 0 : 0.2;
}

const lineCount = (value) => (value ? value.split('\n').filter((line) => line.trim()).length : 0);

/** Parses LRC timestamps while preserving the untouched source string in the report. */
function parseSyncedLines(value) {
  const lines = [];

  for (const row of String(value ?? '').replace(/\r/g, '').split('\n')) {
    let cursor = 0;
    const timestamps = [];
    const timestampPattern = /^\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/;

    while (cursor < row.length) {
      const match = row.slice(cursor).match(timestampPattern);
      if (!match) break;
      const fraction = Number(`0.${match[3] ?? '0'}`);
      timestamps.push((Number(match[1]) * 60 + Number(match[2]) + fraction) * 1000);
      cursor += match[0].length;
    }

    if (!timestamps.length) continue;
    const text = row.slice(cursor).trim();
    if (!text) continue;
    for (const startMs of timestamps) {
      lines.push({ id: `lrclib-${lines.length}`, text, startMs: Math.round(startMs) });
    }
  }

  return lines;
}

function lyricPayload(record) {
  return {
    record,
    syncedLyrics: record.syncedLyrics ?? null,
    syncedLines: parseSyncedLines(record.syncedLyrics),
    plainLyrics: record.plainLyrics ?? null,
  };
}

/**
 * Verifies that a provider candidate is really the requested track.
 * The current implementation takes `hits[0]` blindly, which returns lyrics for
 * the wrong song more often than it returns nothing — this is the guard that stops.
 */
function scoreCandidate(candidate, wantTitle, wantArtist, wantSec, { requireDuration = false } = {}) {
  const titleScore = tokenOverlap(wantTitle, candidate.trackName);
  if (titleScore < 0.62) return null;

  const artistScore = tokenOverlap(wantArtist, candidate.artistName);
  const durScore = durationScore(wantSec, candidate.duration);
  if (requireDuration && durScore !== null && durScore < 0.5) return null;
  const shortTitle = titleSpecificity(wantTitle) < minimumTitleTokens;
  // Generic/short titles have many unrelated catalog matches. Require independent artist
  // evidence; duration can only corroborate, never replace artist/title identity.
  if (shortTitle && artistScore < 0.5) return null;
  if (durScore !== null && durScore < 0.2) return null;

  const total = titleScore * 0.62 + artistScore * 0.33 + (durScore ?? 0.6) * 0.05;
  // A candidate that carries timings is strictly more useful than the same candidate without
  // them, so it wins near-ties. Without this bonus a plain record with a marginally better name
  // score shadows the synced record for the same song and the synced count is underreported.
  const rank = total + (parseSyncedLines(candidate.syncedLyrics).length > 0 ? 0.08 : 0);

  return { total: Number(total.toFixed(3)), rank: Number(rank.toFixed(3)), titleScore, artistScore, durScore };
}

function pickBest(candidates, wantTitle, wantArtist, wantSec, options) {
  let best = null;

  for (const candidate of candidates ?? []) {
    if (!candidate || candidate.instrumental) continue;
    const score = scoreCandidate(candidate, wantTitle, wantArtist, wantSec, options);
    if (score && (!best || score.rank > best.score.rank)) best = { candidate, score };
  }

  return best;
}

function passesCanonicalIdentity(track, item, titles, artists) {
  const bestTitle = titles
    .map((title) => ({ title, score: tokenOverlap(title, item.title) }))
    .sort((left, right) => right.score - left.score)[0];
  const titleScore = bestTitle?.score ?? 0;
  if (titleScore < 0.62) return null;
  const artistScore = Math.max(0, ...artists.map((artist) => tokenOverlap(artist, item.artist?.name ?? '')));
  const duration = durationScore(track.durationSec, item.duration);
  const shortTitle = titleSpecificity(bestTitle?.title ?? track.title) < minimumTitleTokens;
  // When Deezer matched only a generic title component (e.g. "Fever" in "BUCKSHOT - FEVER"),
  // the catalog artist must agree with the uploader or an artist hint embedded in the title.
  if (shortTitle && artistScore < 0.5) return null;
  if (duration !== null && duration < 0.2) return null;
  return { titleScore, artistScore, duration };
}

/** Shapes a verified candidate into a strategy result. */
function result(best, synced, plain) {
  return {
    synced: synced > 0,
    lines: synced || plain,
    matched: `${best.candidate.artistName} — ${best.candidate.trackName}`,
    matchedArtist: best.candidate.artistName,
    matchedTrack: best.candidate.trackName,
    score: best.score.rank,
    lyrics: lyricPayload(best.candidate),
  };
}

/* --------------------------------------------------------------- strategies */

/** E: D, but over the normalised variant matrix. The strategy the plan targets. */
async function strategyNormalized(track) {
  const { titles, artists } = buildVariants(track);
  let best = null;

  for (const title of titles) {
    for (const artist of artists) {
      const candidates = await lrclib(`/search?${new URLSearchParams({ track_name: title, artist_name: artist })}`);
      if (!Array.isArray(candidates)) continue;

      const found = pickBest(candidates, title, artist, track.durationSec, { requireDuration: true });
      if (!found) continue;

      const synced = parseSyncedLines(found.candidate.syncedLyrics).length;
      const plain = lineCount(found.candidate.plainLyrics);
      if (!synced && !plain) continue;

      const record = { via: `/api/search "${title}" / "${artist}"`, ...result(found, synced, plain) };
      if (!best || record.score > best.score) best = record;

    }
  }

  return best;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes bare version markers that stripNoise leaves in place.
 * stripNoise only understands bracketed noise, so "Mr. Rager sped up" survives it intact, and
 * Deezer then answers with nothing but other sped-up rips instead of the original.
 */
function stripVersionMarkers(value) {
  let result = String(value ?? '');

  for (const word of VERSION_WORDS) {
    const safe = escapeRegExp(word).replace(/[^\w\s]+$/, '');
    if (safe.length < 2) continue;
    result = result.replace(new RegExp(`\\b${safe}\\b`, 'giu'), ' ');
  }

  return result.replace(/\s+/g, ' ').replace(/[.\-_–—]+$/g, '').trim();
}

/**
 * Resolves a SoundCloud upload to the real track.
 *
 * SoundCloud's artist field is whoever re-uploaded the file, not who made the song: Pure_Editz
 * uploaded Joji, brx4y uploaded Kid Cudi, lovesage#1fan uploaded BOY FANTASY. Deezer answers with
 * the canonical title, artist, album, duration and ISRC, and those are what make lyrics findable
 * at all — feeding LRCLib the raw uploader name is why whole tracks come back empty.
 *
 * The title is cleaned first, because Deezer's search does not tolerate the mess: a raw
 * "PIXELATED KISSES - JOJI [ SLIGHTLY 0.5x SLOWED + BASS BOOSTED]" returns nothing, while the
 * stripped "PIXELATED KISSES" resolves to Joji in one call.
 */
const canonicalLog = [];

function canonicalCandidateScore(track, item, titles, artists) {
  const identity = passesCanonicalIdentity(track, item, titles, artists);
  if (!identity) return null;
  const { titleScore, artistScore, duration } = identity;

  const versionPenalty = hasVersionMarker(track.title) && hasVersionMarker(item.title) ? 0.25 : 0;
  const rank = titleScore * 0.65 + artistScore * 0.3 + (duration ?? 0.5) * 0.05 - versionPenalty;
  return { rank, titleScore, artistScore, duration };
}

async function canonicalize(track) {
  // Query the catalog with the original title, not the upload's title: a version marker is
  // exactly the noise that hides the original from search.
  const cleanedTitle = stripNoise(track.title);
  const base = stripVersionMarkers(cleanedTitle) || cleanedTitle;
  const dashParts = base.split(/\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  const titles = [...new Set([base, ...dashParts].filter((title) => title.length >= 3))];
  const { artists: variantsArtists } = buildVariants(track);
  const artistHints = [...new Set([track.artist, ...dashParts, ...variantsArtists].map((value) => stripNoise(value)).filter(Boolean))];

  const searchQueries = [...titles];
  const contextualQueries = [];
  for (const title of titles) {
    for (const hint of artistHints) {
      if (tokenOverlap(title, hint) >= 0.75) continue;
      const query = `${title} ${hint}`.trim();
      if (!searchQueries.includes(query) && !contextualQueries.includes(query)) contextualQueries.push(query);
    }
  }

  let best = null;
  const seen = new Set();
  let queryErrors = 0;

  // Search the cleaned title and title parts first. Only widen to artist-qualified queries when
  // those results do not identify a confident candidate; this keeps API traffic bounded.
  const collectCandidates = async (queries) => {
    for (const query of queries) {
      const results = await deezerSearch(query);
      if (results === null) {
        queryErrors += 1;
        continue;
      }
      for (const item of results) {
        if (seen.size < 4) seen.add(`${item.artist?.name} — ${item.title}`);
        const score = canonicalCandidateScore(track, item, titles, artistHints);
        if (score && (!best || score.rank > best.rank)) best = { ...score, title: query, item };
      }
    }
  };

  await collectCandidates(searchQueries);
  if (!best || best.rank < 0.9 || best.artistScore < 0.45) {
    await collectCandidates(contextualQueries.slice(0, 8));
  }

  if (!best) {
    canonicalLog.push({ title: track.title, artist: track.artist, resolved: null, seen: [...seen], queryErrors });
    return null;
  }

  const { item } = best;
  canonicalLog.push({
    title: track.title,
    artist: track.artist,
    resolved: `${item.artist?.name} — ${item.title}`,
    durationSec: item.duration ?? 0,
    catalog: item,
    queryErrors,
  });

  return {
    title: item.title,
    artist: item.artist?.name ?? '',
    album: item.album?.title ?? '',
    durationSec: item.duration ?? 0,
    isrc: item.isrc ?? '',
    catalog: item,
    rank: Number(best.rank.toFixed(3)),
    via: `deezer «${best.title}» → ${item.artist?.name ?? '?'} — ${item.title}`,
  };
}

/**
 * G: canonicalise the upload with Deezer, then look the canonical track up in LRCLib.
 *
 * Exact /api/get goes first because canonical metadata is trustworthy enough for it — that is the
 * whole point of the step. The fuzzy search is the fallback for when LRCLib spells the artist
 * differently. Duration is deliberately not required: the canonical duration is the original's,
 * so a sped-up upload will never match it, which is exactly the case this step exists to rescue.
 */
async function strategyDeezer(track) {
  const canonical = await canonicalize(track);
  if (!canonical) return null;

  const names = new URLSearchParams({ track_name: canonical.title, artist_name: canonical.artist });
  const withDuration = new URLSearchParams({ ...Object.fromEntries(names), duration: String(canonical.durationSec || '') });

  const exact = await lrclib(`/get?${withDuration}`);
  if (exact && !exact.error) {
    const synced = parseSyncedLines(exact.syncedLyrics).length;
    const plain = lineCount(exact.plainLyrics);
    // /get is exact only relative to the query, not necessarily to the SoundCloud upload.
    // Verify the returned LRCLIB metadata against the selected Deezer catalog record before
    // showing lyrics; otherwise a bad catalog resolution can silently return another song.
    const exactScore = scoreCandidate(exact, canonical.title, canonical.artist, canonical.durationSec);
    if ((synced || plain) && exactScore) {
      return {
        via: `${canonical.via} → /api/get`,
        synced: synced > 0,
        lines: synced || plain,
        matched: `${exact.artistName} — ${exact.trackName}`,
        matchedArtist: exact.artistName,
        matchedTrack: exact.trackName,
        score: exactScore.rank,
        isrc: canonical.isrc,
        canonical: { title: canonical.title, artist: canonical.artist, album: canonical.album, durationSec: canonical.durationSec, isrc: canonical.isrc },
        catalog: canonical.catalog,
        lyrics: lyricPayload(exact),
      };
    }
  }

  const candidates = await lrclib(`/search?${names}`);
  if (Array.isArray(candidates)) {
    const found = pickBest(candidates, canonical.title, canonical.artist, canonical.durationSec);
    const synced = parseSyncedLines(found?.candidate.syncedLyrics).length;
    const plain = lineCount(found?.candidate.plainLyrics);
    if (found && (synced || plain)) {
      return {
        via: `${canonical.via} → /api/search`,
        ...result(found, synced, plain),
        isrc: canonical.isrc,
        canonical: { title: canonical.title, artist: canonical.artist, album: canonical.album, durationSec: canonical.durationSec, isrc: canonical.isrc },
        catalog: canonical.catalog,
      };
    }
  }

  return null;
}

function auditMismatch(track, outcome) {
  if (!outcome?.matchedArtist || !outcome?.matchedTrack) return false;

  // For Deezer-canonicalized rows, compare provider metadata with the canonical artist/title,
  // not the SoundCloud uploader (which is commonly a fan/re-uploader).
  const expectedArtist = outcome.canonical?.artist ?? track.artist;
  const expectedTitle = outcome.canonical?.title ?? track.title;
  const artistScore = tokenOverlap(expectedArtist, outcome.matchedArtist);
  const titleScore = tokenOverlap(expectedTitle, outcome.matchedTrack);
  return artistScore < 0.45 || titleScore < 0.6;
}

/** H: canonical metadata first, variant-matrix search as the fallback. */
async function strategyCombined(track) {
  const canonical = await strategyDeezer(track);
  if (canonical) return { ...canonical, via: `${canonical.via}` };

  const fallback = await strategyNormalized(track);
  return fallback ? { ...fallback, via: `${fallback.via} (канонизация не помогла)` } : null;
}

const STRATEGIES = [
  { key: 'H_combined', label: 'H · Deezer-канонизация → LRCLib, откат на нормализованный поиск', run: strategyCombined },
];

const AUDIT_KEYS = ['H_combined'];

function runSelfTests() {
  const title = ['crush'];
  const artists = ['2hollis'];
  const track = { title: 'crush', artist: '2hollis', durationSec: 0 };
  assert.ok(passesCanonicalIdentity(track, { title: 'Crush', artist: { name: '2hollis' } }, title, artists));
  assert.equal(passesCanonicalIdentity(track, { title: 'Crush', artist: { name: 'Ben Mazué' } }, title, artists), null);
  assert.equal(scoreCandidate({
    trackName: 'Crush', artistName: 'Ben Mazué', duration: 0, syncedLyrics: '[00:01.00]line',
  }, 'Crush', '2hollis', 0), null);

  const feverTrack = { title: 'BUCKSHOT & FAKEMINK - FEVER', artist: 'BUCKSHOT', durationSec: 0 };
  assert.equal(passesCanonicalIdentity(
    feverTrack,
    { title: 'Fever', artist: { name: 'Dua Lipa' } },
    ['BUCKSHOT & FAKEMINK - FEVER', 'BUCKSHOT & FAKEMINK', 'FEVER'],
    ['BUCKSHOT', 'BUCKSHOT & FAKEMINK', 'FEVER'],
  ), null);
  assert.ok(passesCanonicalIdentity(
    feverTrack,
    { title: 'Fever', artist: { name: 'Buckshot' } },
    ['BUCKSHOT & FAKEMINK - FEVER', 'BUCKSHOT & FAKEMINK', 'FEVER'],
    ['BUCKSHOT', 'BUCKSHOT & FAKEMINK', 'FEVER'],
  ));

  const lines = parseSyncedLines('[00:01.1]one\n[00:02.01][00:03.001]two\n[00:04.00]');
  assert.deepEqual(lines.map(({ text, startMs }) => [text, startMs]), [
    ['one', 1100], ['two', 2010], ['two', 3001],
  ]);
  assert.equal(lines.some(({ text }) => !text), false);
  assert.equal(hasTimingRiskMarker('Mr. Rager sped up'), true);
  assert.equal(hasTimingRiskMarker('Test & Recognise (Flume Re-work)'), true);
  assert.equal(hasTimingRiskMarker('cachalot [prod. onda andar]'), false);
  console.log('lyrics-coverage self-test: OK');
}

/* --------------------------------------------------------------------- run */

async function mapWithLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function pump() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

const pad = (value, width) => String(value).padEnd(width);
const lpad = (value, width) => String(value).padStart(width);

async function main() {
  if (args.includes('--self-test')) {
    runSelfTests();
    return;
  }
  if (!fs.existsSync(inputPath)) {
    console.error(`Файл не найден: ${inputPath}`);
    process.exit(1);
  }

  const tracks = parseLibrary(fs.readFileSync(inputPath, 'utf8'));
  if (tracks.length === 0) {
    console.error('Не удалось разобрать ни одного трека. Ожидается формат "▶ Название\\nИсполнитель".');
    process.exit(1);
  }

  console.log(`\nБиблиотека: ${inputPath}`);
  console.log(`Треков: ${tracks.length}   Стратегия: ${STRATEGIES[0].key}   Пауза: ${delayMs}ms\n`);

  let completedTracks = 0;
  const rows = await mapWithLimit(tracks, concurrency, async (track) => {
    const outcomes = {};
    const ctx = { track, outcomes };
    for (const strategy of STRATEGIES) {
      outcomes[strategy.key] = await strategy.run(track, ctx);
      if (delayMs) await sleep(delayMs);
    }
    const done = ++completedTracks;
    if (done % 5 === 0 || done === tracks.length) {
      console.log(`Проверено треков: ${done}/${tracks.length}`);
    }
    return { track, outcomes };
  });

  const header = pad('трек', 44) + pad('артист', 19)
    + STRATEGIES.map((s) => lpad(s.key.slice(0, 7), 8)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  const totals = Object.fromEntries(STRATEGIES.map((s) => [s.key, { hit: 0, synced: 0, timingRisk: 0 }]));

  for (const row of rows) {
    const cells = STRATEGIES.map((strategy) => {
      const outcome = row.outcomes[strategy.key];
      if (!outcome) return lpad('—', 8);

      totals[strategy.key].hit += 1;
      const timingRisk = outcome.synced && hasTimingRiskMarker(row.track.title);
      if (outcome.synced) totals[strategy.key].synced += 1;
      if (timingRisk) totals[strategy.key].timingRisk += 1;
      return lpad(outcome.synced ? (timingRisk ? 'sync*' : 'sync') : 'plain', 8);
    });

    console.log(pad(`${row.track.title}`.slice(0, 43), 44) + pad(row.track.artist.slice(0, 18), 19) + cells.join(''));
  }

  console.log('\nИтог по стратегиям:\n');
  for (const strategy of STRATEGIES) {
    const { hit, synced } = totals[strategy.key];
    const timingRisk = totals[strategy.key].timingRisk;
    console.log(`  ${pad(strategy.label, 50)} найдено ${lpad(hit, 3)} (${lpad(((hit / tracks.length) * 100).toFixed(0), 3)}%)   LRC-строк ${lpad(synced, 3)} (${lpad(((synced / tracks.length) * 100).toFixed(0), 3)}%), возможный сдвиг версии ${timingRisk}`);
  }
  console.log('  sync* = у названия есть маркер slowed/remix/edit и т.п.; LRC найден, но совпадение таймингов с изменённым аудио не гарантируется. Синк построчный, не пословный.');

  const lrclibRequests = stats.ok + stats.throttled + stats.notFound + stats.error;
  const deezerRequests = deezerStats.ok + deezerStats.empty + deezerStats.error;
  const throttledShare = stats.throttled / Math.max(1, lrclibRequests);
  const lrclibErrorShare = stats.error / Math.max(1, lrclibRequests);
  const deezerErrorShare = deezerStats.error / Math.max(1, deezerRequests);
  const reliable = throttledShare <= 0.15 && lrclibErrorShare <= 0.1 && deezerErrorShare <= 0.05;
  if (throttledShare > 0.15) {
    console.log(`\n⚠️  ЗАМЕР НЕНАДЁЖЕН: ${stats.throttled} ответов 503 ServerOverloaded (${Math.round(throttledShare * 100)}% запросов).`);
    console.log('   lrclib ограничивает запросы по IP. Цифры выше занижены — это троттлинг, а не отсутствие лирики.');
    console.log('   Перезапусти позже или с --delay 800.');
  }
  if (lrclibErrorShare > 0.1 || deezerErrorShare > 0.05) {
    console.log(`\n⚠️  ЗАМЕР НЕНАДЁЖЕН: ошибки LRCLIB ${Math.round(lrclibErrorShare * 100)}%, Deezer ${Math.round(deezerErrorShare * 100)}%.`);
    console.log('   Ошибки поиска Deezer могут скрыть кандидатов; нулевой результат нельзя считать отсутствием текста. Повтори замер позже.');
  }
  console.log(`\nЗапросы: успешных ${stats.ok}, 404 — ${stats.notFound}, 503 — ${stats.throttled}, ошибок — ${stats.error}.`);
  console.log(`Deezer:   ответов с данными ${deezerStats.ok}, пустых ${deezerStats.empty}, ошибок — ${deezerStats.error}.`);

  // Precision audit: recall alone cannot separate a good hit from a wrong song, and the artist
  // field is deliberately weak in the scoring, so hits whose provider artist differs from
  // the SoundCloud artist are listed for manual review.
  const flaggedCounts = {};

  for (const key of AUDIT_KEYS) {
    const auditTotal = totals[key];
    if (!auditTotal) continue;

    const flagged = rows.filter(({ track, outcomes }) => auditMismatch(track, outcomes[key]));
    flaggedCounts[key] = flagged.length;

    console.log(`\nСверка LRCLIB ↔ Deezer (${auditTotal.hit} совпадений, расхождений ${flagged.length}):`);
    if (!flagged.length) {
      console.log('  Во всех проверенных ответах LRCLIB совпали название и исполнитель выбранной записи Deezer.');
      continue;
    }

    for (const { track, outcomes } of flagged) {
      const outcome = outcomes[key];
      console.log(`  · ${track.title}`);
      console.log(`      SoundCloud: ${track.artist}`);
      console.log(`      В базе:      ${outcome.matched}`);
      if (outcome.isrc) console.log(`      ISRC:        ${outcome.isrc}`);
      if (outcome.via) console.log(`      Путь:        ${outcome.via}`);
    }
  }

  const unsolved = rows.filter(({ outcomes }) => !outcomes.H_combined);
  if (unsolved.length) {
    console.log(`\nНе найдено итоговой стратегией (${unsolved.length}):`);
    for (const { track } of unsolved) console.log(`  · ${track.title} — ${track.artist}`);
  }

  // Where the chain breaks matters: "Deezer has never heard of this track" and "Deezer resolved it
  // but LRCLib has no lyrics" call for opposite responses, and a bare hit count hides the split.
  const unresolved = canonicalLog.filter((entry) => !entry.resolved);
  const withDeezerLyrics = rows.filter(({ outcomes }) => outcomes.H_combined?.via.startsWith('deezer'));
  console.log(`\nЦепочка Deezer → LRCLib: канонизировано ${canonicalLog.length - unresolved.length} из ${canonicalLog.length}, итоговых попаданий через Deezer ${withDeezerLyrics.length}.`);
  const canonicalQueryErrors = canonicalLog.reduce((total, entry) => total + (entry.queryErrors ?? 0), 0);
  const canonicalRowsWithErrors = canonicalLog.filter((entry) => (entry.queryErrors ?? 0) > 0).length;
  if (canonicalRowsWithErrors) {
    console.log(`  ⚠️ Ошибки Deezer затронули ${canonicalRowsWithErrors} трек(а), сбойных поисковых запросов: ${canonicalQueryErrors}. Эти треки нельзя уверенно считать ненайденными.`);
  }
  if (deezerStats.errorDetails.length || stats.errorDetails.length) {
    console.log(`  Причины ошибок API (примеры): Deezer [${deezerStats.errorDetails.join(', ') || 'нет'}], LRCLIB [${stats.errorDetails.join(', ') || 'нет'}].`);
  }
  if (unresolved.length) {
    console.log(`  Deezer не знает эти треки (${unresolved.length}):`);
    for (const entry of unresolved) {
      console.log(`  · ${entry.title}`);
      if (entry.seen.length) console.log(`      ближайшее в каталоге: ${entry.seen.slice(0, 2).join(' | ')}`);
    }
  }
  if (jsonOut) {
    fs.writeFileSync(jsonOut, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      input: inputPath,
      trackCount: tracks.length,
      reliable,
      reliability: {
        lrclibRequests,
        deezerRequests,
        throttledShare,
        lrclibErrorShare,
        deezerErrorShare,
        canonicalQueryErrors,
        canonicalRowsWithErrors,
      },
      requests: stats,
      deezerRequests: deezerStats,
      totals: Object.fromEntries(STRATEGIES.map((s) => [s.key, totals[s.key]])),
      flaggedCount: flaggedCounts,
      rows: rows.map(({ track, outcomes }) => ({
        title: track.title,
        artist: track.artist,
        plays: track.plays,
        likes: track.likes,
        durationSec: track.durationSec,
        canonicalization: canonicalLog.find((entry) => entry.title === track.title && entry.artist === track.artist) ?? null,
        outcomes,
      })),
    }, null, 2)}\n`);
    console.log(`\nJSON отчёт: ${jsonOut}`);
  }

  console.log('');
}

main().catch((error) => {
  console.error('coverage bench failed:', error);
  process.exit(1);
});
