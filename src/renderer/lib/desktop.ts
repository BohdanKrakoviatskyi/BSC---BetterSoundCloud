import { invoke } from '@tauri-apps/api/core';
import { appConfigDir } from '@tauri-apps/api/path';
import { Command, type Child } from '@tauri-apps/plugin-shell';

export type Settings = { accent: string; compact: boolean; volume: number; clientId: string; backgroundImage: string; backgroundBlur: number };
type AppInfo = { name: string; version: string; backend: string };
export type SoundCloudProfile = {
  id: number;
  username: string;
  fullName?: string;
  permalinkUrl?: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
  followersCount?: number;
  followingsCount?: number;
  trackCount?: number;
  likesCount?: number;
};
export type AuthStatus = { authorized: boolean; profile?: SoundCloudProfile };
export type TrackLikeResult = { liked: boolean; captchaUrl?: string };
export type TrackStreamOption = { url: string; preview: boolean; hls: boolean; quality: string };
export type TrackStream = TrackStreamOption & { alternatives?: TrackStreamOption[] };
export type TrackLyricsDTO = { trackId: number; lines: Array<{ id: string; text: string; startMs: number }>; sourceUrl?: string; isSynced?: boolean; logs?: string[] };
export type SoundCloudTrack = {
  id: number;
  trackUrn: string;
  title: string;
  permalinkUrl?: string;
  artworkUrl?: string;
  duration: number;
  playbackCount?: number;
  likesCount?: number;
  user: { username: string };
};
export type SoundCloudTrackPage = { tracks: SoundCloudTrack[]; nextHref?: string };
export type SoundCloudTrackDetails = SoundCloudTrack & {
  description?: string;
  genre?: string;
  tagList?: string;
  createdAt?: string;
  displayDate?: string;
  repostsCount?: number;
  commentCount?: number;
  waveformUrl?: string;
  user: SoundCloudTrack['user'] & {
    id?: number;
    avatarUrl?: string;
    permalinkUrl?: string;
    followersCount?: number;
  };
};
export type SoundCloudUserProfile = {
  id: number;
  username: string;
  fullName?: string;
  permalinkUrl?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  description?: string;
  city?: string;
  country?: string;
  followersCount?: number;
  followingsCount?: number;
  trackCount?: number;
  likesCount?: number;
  verified?: boolean;
};
export type SoundCloudSocialUser = {
  id: number;
  username: string;
  fullName?: string;
  permalinkUrl?: string;
  avatarUrl?: string;
  followersCount?: number;
  followingsCount?: number;
  trackCount?: number;
};
export type SoundCloudSocialPage = { collection: SoundCloudSocialUser[]; nextHref?: string };
export type SoundCloudSearchTrack = SoundCloudTrack;
export type SoundCloudMixedSelection = { id: string; title: string; description?: string; tracks: SoundCloudSearchTrack[]; playlists?: SoundCloudPlaylist[]; madeForYou?: boolean };
export type SoundCloudPlaylist = { id: string; urn?: string; title: string; permalinkUrl?: string; artworkUrl?: string; trackCount: number; user: { username: string } };

// ---- Spotify
//
// A track carries nativeId and source rather than a numeric id. The domain Track still has one, and
// a great deal of code keys on it, but Spotify's ids are strings and hashing one into that field
// would collide — a collision means liking the wrong track and playing the wrong queue entry. So the
// real id stays here and identity is decided on source plus nativeId.

export type SpotifyAuthProfile = { id: string; displayName?: string; email?: string; product?: string };
export type SpotifyAuthStatus = { authorized: boolean; profile?: SpotifyAuthProfile; expiresAt?: number };
export type SpotifyArtist = { id: string; name: string };
export type SpotifyImage = { url: string; width: number };
export type SpotifyAlbum = { id: string; name: string; images: SpotifyImage[] };
export type SpotifyTrack = {
  nativeId: string;
  source: string;
  urn: string;
  title: string;
  permalink?: string;
  artworkUrl?: string;
  durationMs: number;
  popularity?: number;
  previewUrl?: string;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
};
export type SpotifyTrackPage = { tracks: SpotifyTrack[]; nextHref?: string };
export type SpotifyPlaylist = {
  nativeId: string;
  source: string;
  urn: string;
  title: string;
  permalink?: string;
  artworkUrl?: string;
  trackCount: number;
  artist: string;
};
export type SpotifyPlaylistPage = { playlists: SpotifyPlaylist[]; nextHref?: string };
export type SpotifySaveResult = { id: string; saved: boolean };
export type SpotifyOAuthStatus = { completed: boolean; closed: boolean; code?: string; error?: string };
export type SpotifySearchRequest = { query: string; limit?: number };
export type SpotifyPageRequest = { next?: string; limit?: number };
export type SpotifyRecommendRequest = { seedTrackIds?: string[]; seedArtists?: string[]; limit?: number };
type BackendResponse<T> = { id: number; result?: T; error?: string };
type PendingRequest = {
  method: string;
  startedAt: number;
  timer: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

class LocalBackend {
  private child: Child | null = null;
  private nextId = 1;
  private buffer = '';
  private pending = new Map<number, PendingRequest>();
  private starting: Promise<void> | null = null;

  start(): Promise<void> {
    if (this.child) return Promise.resolve();
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const commandOptions = import.meta.env.DEV
        ? { env: { BSC_DATA_DIR: await appConfigDir() } }
        : undefined;
      const command = Command.sidecar('binaries/local-api', [], commandOptions);
      command.stdout.on('data', (chunk) => this.consume(String(chunk)));
      command.stderr.on('data', (chunk) => console.info('[local-backend]', String(chunk).trim()));
      command.on('error', (error) => {
        console.error('[local-backend] process error', { error });
        this.failAll(new Error(error));
      });
      command.on('close', ({ code }) => {
        console.error('[local-backend] process closed', { exitCode: code });
        this.child = null;
        this.failAll(new Error(`Локальный Go backend завершился (${code ?? 'signal'})`));
      });
      try {
        this.child = await command.spawn();
      } catch (reason) {
        console.error('[local-backend] spawn failed', { error: reason instanceof Error ? reason.message : String(reason) });
        throw reason;
      }
      console.info('[local-backend] sidecar started');
      await this.request<AppInfo>('app.info');
    })().finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    try {
      if (child) await child.kill();
    } finally {
      this.failAll(new Error('Локальный backend остановлен'));
    }
  }

  async getInfo(): Promise<AppInfo> {
    return this.request<AppInfo>('app.info');
  }

  async getSettings(): Promise<Settings> {
    return this.request<Settings>('settings.get');
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.request<Settings>('settings.update', patch);
  }

  async historyList(): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>('history.list');
  }

  async historyRecord(track: SoundCloudTrack): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>('history.record', { track });
  }

  async historyClear(): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>('history.clear');
  }

  async clearAppData(): Promise<Settings> {
    return this.request<Settings>('settings.clear');
  }

  async authStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>('auth.status');
  }

  async authLogin(token: string): Promise<AuthStatus> {
    // Проверка токена ходит в SoundCloud, поэтому таймаут выше обычного.
    return this.request<AuthStatus>('auth.login', { token }, 30_000);
  }

  async authRefresh(): Promise<AuthStatus> {
    return this.request<AuthStatus>('auth.refresh', {}, 30_000);
  }

  async authLogout(): Promise<AuthStatus> {
    return this.request<AuthStatus>('auth.logout');
  }

  async myTracks(): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>('tracks.mine', {}, 30_000);
  }

  async myPlaylists(): Promise<SoundCloudPlaylist[]> {
    return this.request<SoundCloudPlaylist[]>('playlists.mine', {}, 30_000);
  }

  async playlistTracks(playlistUrn: string): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>('playlist.tracks', { playlistUrn }, 30_000);
  }

  async trackDetails(trackId: number): Promise<SoundCloudTrackDetails> {
    return this.request<SoundCloudTrackDetails>('track.details', { trackId }, 30_000);
  }

  async trackLyrics(trackId: number, title: string, artist: string, durationMs: number): Promise<TrackLyricsDTO> {
    return this.request<TrackLyricsDTO>('track.lyrics', { trackId, title, artist, durationMs }, 30_000);
  }

  async trackStream(trackUrn: string): Promise<TrackStream> {
    return this.request<TrackStream>('track.stream', { trackUrn }, 30_000);
  }

  async searchTracks(query: string): Promise<SoundCloudSearchTrack[]> {
    return this.request<SoundCloudSearchTrack[]>('search.tracks', { query }, 15_000);
  }

  async relatedTracks(trackId: number): Promise<SoundCloudSearchTrack[]> {
    return this.request<SoundCloudSearchTrack[]>('track.related', { trackId }, 30_000);
  }

  async mixedSelections(): Promise<SoundCloudMixedSelection[]> {
    return this.request<SoundCloudMixedSelection[]>('mixed.selections', {}, 30_000);
  }

  async userProfile(userId: number): Promise<SoundCloudUserProfile> {
    return this.request<SoundCloudUserProfile>('user.profile', { userId }, 30_000);
  }

  async userTracks(userId: number): Promise<SoundCloudTrack[]> {
    return this.request<SoundCloudTrack[]>('user.tracks', { userId }, 120_000);
  }

  async userLikes(userId: number, next?: string): Promise<SoundCloudTrackPage> {
    return this.request<SoundCloudTrackPage>('user.likes', { userId, next }, 30_000);
  }

  async userFollowers(userId: number, next?: string): Promise<SoundCloudSocialPage> {
    return this.request<SoundCloudSocialPage>('user.followers', { userId, next }, 30_000);
  }

  async userFollowings(userId: number, next?: string): Promise<SoundCloudSocialPage> {
    return this.request<SoundCloudSocialPage>('user.followings', { userId, next }, 30_000);
  }

  async userPlaylists(userId: number): Promise<SoundCloudPlaylist[]> {
    return this.request<SoundCloudPlaylist[]>('user.playlists', { userId }, 30_000);
  }

  async likeTrack(trackId: number, trackUrn: string, userId?: number, clientId?: string, datadomeCookie?: string): Promise<TrackLikeResult> {
    try {
      // statically imported instead
      return await invoke('like_track_webview', { trackId, userId: userId ?? null, clientId: clientId ?? null, liked: true });
    } catch (error) {
      console.warn('[desktop] webview like failed, falling back to sidecar', error);
      return this.request<TrackLikeResult>('track.like', { trackId, trackUrn, datadomeCookie }, 30_000);
    }
  }

  async unlikeTrack(trackId: number, trackUrn: string, userId?: number, clientId?: string, datadomeCookie?: string): Promise<TrackLikeResult> {
    try {
      // statically imported instead
      return await invoke('like_track_webview', { trackId, userId: userId ?? null, clientId: clientId ?? null, liked: false });
    } catch (error) {
      console.warn('[desktop] webview unlike failed, falling back to sidecar', error);
      return this.request<TrackLikeResult>('track.unlike', { trackId, trackUrn, datadomeCookie }, 30_000);
    }
  }

  // ---- Spotify
  //
  // Every one of these needs a bearer token, which lives in the sidecar rather than here, so the
  // client id and secret travel with the request that needs them. Nothing about a session is cached
  // on this side of the bridge: a stale token that is believed to be good produces failures that look
  // like a network problem.

  // ---- Spotify OAuth window. These go to the Rust side, which owns the window and intercepts the
  // redirect; there is no local server listening on the callback port.

  async spotifyAuthStart(clientId: string, redirectUri: string): Promise<void> {
    await invoke('start_spotify_auth', { clientId, redirectUri });
  }

  async spotifyAuthPoll(): Promise<SpotifyOAuthStatus> {
    return invoke<SpotifyOAuthStatus>('poll_spotify_auth');
  }

  async spotifyAuthStatus(): Promise<SpotifyAuthStatus> {
    return this.request<SpotifyAuthStatus>('spotify.auth.status', {}, 10_000);
  }

  async spotifyAuthExchange(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<SpotifyAuthStatus> {
    return this.request<SpotifyAuthStatus>('spotify.auth.exchange', { code, clientId, clientSecret, redirectUri }, 30_000);
  }

  async spotifyAuthRefresh(clientId: string, clientSecret: string): Promise<SpotifyAuthStatus> {
    return this.request<SpotifyAuthStatus>('spotify.auth.refresh', { clientId, clientSecret }, 30_000);
  }

  async spotifyAuthLogout(): Promise<SpotifyAuthStatus> {
    return this.request<SpotifyAuthStatus>('spotify.auth.logout', {}, 10_000);
  }

  async spotifyMyTracks(next?: string, limit?: number): Promise<SpotifyTrackPage> {
    return this.request<SpotifyTrackPage>('spotify.tracks.mine', { next, limit }, 30_000);
  }

  async spotifyMyPlaylists(next?: string, limit?: number): Promise<SpotifyPlaylistPage> {
    return this.request<SpotifyPlaylistPage>('spotify.playlists.mine', { next, limit }, 30_000);
  }

  async spotifyPlaylistTracks(id: string, next?: string, limit?: number): Promise<SpotifyTrackPage> {
    return this.request<SpotifyTrackPage>('spotify.playlist.tracks', { id, next, limit }, 30_000);
  }

  async spotifyTrackDetails(id: string): Promise<SpotifyTrack> {
    return this.request<SpotifyTrack>('spotify.track.details', { id }, 30_000);
  }

  async spotifySearchTracks(query: string, limit?: number): Promise<SpotifyTrackPage> {
    return this.request<SpotifyTrackPage>('spotify.search.tracks', { query, limit }, 20_000);
  }

  async spotifyRecommendations(request: SpotifyRecommendRequest): Promise<SpotifyTrackPage> {
    return this.request<SpotifyTrackPage>('spotify.recommendations', { ...request }, 30_000);
  }

  async spotifyUserProfile(): Promise<SpotifyAuthProfile> {
    return this.request<SpotifyAuthProfile>('spotify.user.profile', {}, 20_000);
  }

  async spotifySaveTrack(id: string): Promise<SpotifySaveResult> {
    return this.request<SpotifySaveResult>('spotify.track.save', { id }, 30_000);
  }

  async spotifyUnsaveTrack(id: string): Promise<SpotifySaveResult> {
    return this.request<SpotifySaveResult>('spotify.track.unsave', { id }, 30_000);
  }

  private async request<T>(method: string, params: object = {}, timeoutMs = 5000): Promise<T> {
    if (!this.child) {
      const error = new Error('Локальный backend не запущен');
      console.error('[local-backend] request rejected', { method, error: error.message });
      throw error;
    }
    const id = this.nextId++;
    const startedAt = Date.now();
    console.debug('[local-backend] request sent', { id, method, timeoutMs });
    const response = new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Локальный backend не ответил вовремя: ${method}`);
        console.error('[local-backend] request timed out', { id, method, elapsedMs: Date.now() - startedAt, timeoutMs });
        reject(error);
      }, timeoutMs);
      this.pending.set(id, {
        method,
        startedAt,
        timer,
        resolve: (value) => { window.clearTimeout(timer); resolve(value as T); },
        reject: (error) => { window.clearTimeout(timer); reject(error); },
      });
    });
    try {
      await this.child.write(`${JSON.stringify({ id, method, params })}\n`);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) window.clearTimeout(pending.timer);
      this.pending.delete(id);
      console.error('[local-backend] request write failed', { id, method, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    return response;
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: BackendResponse<unknown>;
      try { message = JSON.parse(line) as BackendResponse<unknown>; }
      catch {
        console.error('[local-backend] invalid response JSON', { bytes: line.length });
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        console.warn('[local-backend] response has no pending request', { id: message.id });
        continue;
      }
      this.pending.delete(message.id);
      const elapsedMs = Date.now() - pending.startedAt;
      if (message.error) {
        console.error('[local-backend] request failed', { id: message.id, method: pending.method, elapsedMs, backendError: message.error });
        pending.reject(new Error(message.error));
      } else {
        console.debug('[local-backend] request completed', { id: message.id, method: pending.method, elapsedMs });
        pending.resolve(message.result);
      }
    }
  }

  private failAll(error: Error): void {
    if (this.pending.size > 0) console.error('[local-backend] rejecting pending requests', { count: this.pending.size, error: error.message });
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

const backend = new LocalBackend();

export const desktop = {
  start: () => backend.start(),
  stop: () => backend.stop(),
  getInfo: () => backend.getInfo(),
  getSettings: () => backend.getSettings(),
  updateSettings: (patch: Partial<Settings>) => backend.updateSettings(patch),
  historyList: () => backend.historyList(),
  historyRecord: (track: SoundCloudTrack) => backend.historyRecord(track),
  historyClear: () => backend.historyClear(),
  clearAppData: () => backend.clearAppData(),
  authStatus: () => backend.authStatus(),
  authLogin: (token: string) => backend.authLogin(token),
  authRefresh: () => backend.authRefresh(),
  authLogout: () => backend.authLogout(),
  myTracks: () => backend.myTracks(),
  myPlaylists: () => backend.myPlaylists(),
  playlistTracks: (playlistUrn: string) => backend.playlistTracks(playlistUrn),
  trackDetails: (trackId: number) => backend.trackDetails(trackId),
  trackLyrics: (trackId: number, title: string, artist: string, durationMs: number) => backend.trackLyrics(trackId, title, artist, durationMs),
  trackStream: (trackUrn: string) => backend.trackStream(trackUrn),
  searchTracks: (query: string) => backend.searchTracks(query),
  relatedTracks: (trackId: number) => backend.relatedTracks(trackId),
  mixedSelections: () => backend.mixedSelections(),
  userProfile: (userId: number) => backend.userProfile(userId),
  userTracks: (userId: number) => backend.userTracks(userId),
  userLikes: (userId: number, next?: string) => backend.userLikes(userId, next),
  userFollowers: (userId: number, next?: string) => backend.userFollowers(userId, next),
  userFollowings: (userId: number, next?: string) => backend.userFollowings(userId, next),
  userPlaylists: (userId: number) => backend.userPlaylists(userId),
  likeTrack: (trackId: number, trackUrn: string, userId?: number, clientId?: string, datadomeCookie?: string) => backend.likeTrack(trackId, trackUrn, userId, clientId, datadomeCookie),
  unlikeTrack: (trackId: number, trackUrn: string, userId?: number, clientId?: string, datadomeCookie?: string) => backend.unlikeTrack(trackId, trackUrn, userId, clientId, datadomeCookie),
  spotifyAuthStart: (clientId: string, redirectUri: string) => backend.spotifyAuthStart(clientId, redirectUri),
  spotifyAuthPoll: () => backend.spotifyAuthPoll(),
  spotifyAuthStatus: () => backend.spotifyAuthStatus(),
  spotifyAuthExchange: (code: string, clientId: string, clientSecret: string, redirectUri: string) => backend.spotifyAuthExchange(code, clientId, clientSecret, redirectUri),
  spotifyAuthRefresh: (clientId: string, clientSecret: string) => backend.spotifyAuthRefresh(clientId, clientSecret),
  spotifyAuthLogout: () => backend.spotifyAuthLogout(),
  spotifyMyTracks: (next?: string, limit?: number) => backend.spotifyMyTracks(next, limit),
  spotifyMyPlaylists: (next?: string, limit?: number) => backend.spotifyMyPlaylists(next, limit),
  spotifyPlaylistTracks: (id: string, next?: string, limit?: number) => backend.spotifyPlaylistTracks(id, next, limit),
  spotifyTrackDetails: (id: string) => backend.spotifyTrackDetails(id),
  spotifySearchTracks: (query: string, limit?: number) => backend.spotifySearchTracks(query, limit),
  spotifyRecommendations: (request: SpotifyRecommendRequest) => backend.spotifyRecommendations(request),
  spotifyUserProfile: () => backend.spotifyUserProfile(),
  spotifySaveTrack: (id: string) => backend.spotifySaveTrack(id),
  spotifyUnsaveTrack: (id: string) => backend.spotifyUnsaveTrack(id),
};
