import type { ServiceProvider, Track } from '../domain/models';

/**
 * A stable numeric id for a track that has no numeric one.
 *
 * The domain Track carries `id: number` because every SoundCloud id is a number and a lot of code
 * compares it directly: `currentTrack?.id === track.id`, the queue lookup, the liked map, React keys.
 * Spotify and YouTube ids are opaque strings, and squeezing one into that field is not an option.
 *
 * Hashing was the obvious answer and it is the wrong one. A hash collides, and a collision is not a
 * cosmetic problem: two different tracks sharing an id means liking one marks the other liked and
 * picking one plays the other. So ids are handed out sequentially instead, which cannot collide.
 *
 * Two properties matter and both are load-bearing:
 *
 *   The same native id always gets the same number. Without that, a track fetched from the library
 *   and the same track fetched from a playlist would compare unequal, and the app would lose track of
 *   what is playing.
 *
 *   The numbers cannot overlap SoundCloud's. Ids start a quadrillion up, well clear of the billions
 *   SoundCloud uses and still inside Number.MAX_SAFE_INTEGER, so `id` keeps meaning what it meant for
 *   every existing screen without any of them changing.
 *
 * The limitation is deliberate and worth stating: these numbers are scoped to the running app. They
 * are not stable across restarts, so nothing may persist them. That is currently safe — the liked map
 * is in-memory — but it is the constraint to remember if that ever changes. Use nativeId for anything
 * that outlives a session.
 */
const FOREIGN_ID_BASE = 1_000_000_000_000_000;

let nextForeignId = FOREIGN_ID_BASE;
const assignedByKey = new Map<string, number>();

export function identityFor(service: ServiceProvider, nativeId: string): number {
  const key = `${service}:${nativeId}`;
  const existing = assignedByKey.get(key);
  if (existing !== undefined) return existing;

  if (nextForeignId >= Number.MAX_SAFE_INTEGER) {
    // Unreachable in practice — a quadrillion tracks — but running past it would silently start
    // handing out ids that are no longer exact integers, which is the collision this exists to
    // prevent. Failing loudly is the better of the two.
    throw new Error('Идентификаторы треков исчерпаны');
  }

  const id = nextForeignId;
  nextForeignId += 1;
  assignedByKey.set(key, id);
  return id;
}

/**
 * Whether two entries name the same thing.
 *
 * `id` alone is not enough. A track that came from one service can share an id with one from another,
 * and the two must never be treated as the same row — that is what sameTrack exists to prevent. For
 * anything carrying a nativeId the service and the native id decide; otherwise id does, which keeps
 * every existing SoundCloud comparison behaving exactly as before.
 */
export function sameTrack(left: Track, right: Track): boolean {
  const leftIsForeign = Boolean(left.nativeId);
  const rightIsForeign = Boolean(right.nativeId);
  if (leftIsForeign !== rightIsForeign) return false;
  if (!leftIsForeign) return left.id === right.id;
  return (left.source ?? 'soundcloud') === (right.source ?? 'soundcloud') && left.nativeId === right.nativeId;
}

/** Exposed for tests: how many ids have been handed out, and what the next one will be. */
export function foreignIdentityCount(): number {
  return assignedByKey.size;
}
