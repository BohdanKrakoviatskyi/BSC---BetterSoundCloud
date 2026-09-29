/** Shared formatting for values that come from SoundCloud and can be anything. */

/** m:ss. Non-finite or negative input (a track with no duration) must never reach the screen as "NaN:NaN". */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs / 1000) : 0;
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/** ru-RU thousands. Missing, null and non-numeric counts all read as 0 instead of "не число". */
export function formatCount(value: number | undefined | null): string {
  const count = Number(value);
  return (Number.isFinite(count) ? count : 0).toLocaleString('ru-RU');
}

/** Up to two letters for an avatar fallback. Array.from, not slice: an emoji or astral letter would be cut in half. */
export function initials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('').toUpperCase();
}

/**
 * The onboarding docs tell users to copy the token out of an `Authorization: OAuth …` request
 * header, so the scheme, the quotes and a trailing newline all arrive with the paste. Take the
 * last space-separated run and drop the wrapping quotes.
 */
export function normalizeToken(raw: string): string {
  const parts = raw.trim().replace(/^["']|["']$/g, '').trim().split(/\s+/);
  return parts.at(-1) ?? '';
}

/**
 * A rejected request can surface a Go transport error verbatim — a full URL, a dial string, or an
 * English validation message. The product is Russian-only, so anything without Cyrillic is noise
 * the user cannot act on; the caller supplies copy that names the recovery.
 */
export function describeError(reason: unknown, fallback: string): string {
  if (!(reason instanceof Error)) return fallback;
  const message = reason.message.trim();
  return /[\u0400-\u04FF]/.test(message) ? message : fallback;
}
