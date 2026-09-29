import assert from 'node:assert/strict';
import test from 'node:test';
import { describeError, formatCount, formatDuration, initials, normalizeToken } from '../src/renderer/ui/lib/format.ts';

// Every value here arrives from SoundCloud or from a paste, so the hostile cases are the point.
test('formatDuration survives a missing or corrupt duration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(-5000), '0:00');
  assert.equal(formatDuration(Number.NaN), '0:00');
  assert.equal(formatDuration(undefined), '0:00');
  assert.equal(formatDuration(215_000), '3:35');
});

test('formatCount groups in Russian and never renders NaN', () => {
  assert.equal(formatCount(undefined), '0');
  assert.equal(formatCount(null), '0');
  assert.equal(formatCount(Number.NaN), '0');
  assert.equal(formatCount(1_234_567), '1\u00a0234\u00a0567');
});

test('initials does not cut an astral character in half', () => {
  assert.equal(initials('  बो गायक '), 'बो');
  assert.equal(initials('Soundcloud'), 'SO');
  assert.equal(initials(''), '');
  assert.equal(initials('   '), '');
});

test('normalizeToken accepts a paste taken from an Authorization header', () => {
  assert.equal(normalizeToken('  "OAuth 1-234-abc"  '), '1-234-abc');
  assert.equal(normalizeToken('Bearer\tabc.def'), 'abc.def');
  assert.equal(normalizeToken('plain-token'), 'plain-token');
  assert.equal(normalizeToken('   '), '');
});

test('describeError hides transport noise but keeps actionable Russian copy', () => {
  assert.equal(describeError(new Error('SoundCloud отклонил токен'), 'Фолбэк'), 'SoundCloud отклонил токен');
  assert.equal(describeError(new Error('accent must be a six-digit hex color'), 'Фолбэк'), 'Фолбэк');
  assert.equal(describeError(new Error('dial tcp 1.2.3.4:443: connect: no such host'), 'Фолбэк'), 'Фолбэк');
  assert.equal(describeError('просто строка', 'Фолбэк'), 'Фолбэк');
});
