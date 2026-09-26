export type { Profile, Settings, TrackLyrics } from '../domain/models';
export type Page = 'home' | 'search' | 'library' | 'playlist' | 'likes' | 'settings' | 'track' | 'artist' | 'profile';

/**
 * Lifecycle of the lyrics sidebar. The panel stays mounted for the whole flight in both directions,
 * so the artwork can travel out of the panel before it is removed.
 *
 * - `closed` — nothing rendered.
 * - `opening` — mounted, artwork flying from the track page into the panel.
 * - `open` — settled, the panel owns the artwork.
 * - `measuring` — closing started; the track page is laid out again so the artwork's home
 *   rectangle can be measured without the panel moving on screen.
 * - `closing` — artwork flying back to the track page.
 */
export type LyricsPanelPhase = 'closed' | 'opening' | 'open' | 'measuring' | 'closing';
