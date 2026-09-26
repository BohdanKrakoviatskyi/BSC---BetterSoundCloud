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
  trackCount?: number;
  likesCount?: number;
};
export type AuthStatus = { authorized: boolean; profile?: SoundCloudProfile };
export type TrackLikeResult = { liked: boolean; captchaUrl?: string };
export type TrackStreamOption = { url: string; preview: boolean; hls: boolean; quality: string };
export type TrackStream = TrackStreamOption & { alternatives?: TrackStreamOption[] };
export type TrackLyricsDTO = { trackId: number; lines: Array<{ id: string; text: string; startMs: number }>; sourceUrl?: string; isSynced?: boolean };
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
  verified?: boolean;
};
export type SoundCloudSearchTrack = SoundCloudTrack;
export type SoundCloudMixedSelection = { id: string; title: string; description?: string; tracks: SoundCloudSearchTrack[]; playlists?: SoundCloudPlaylist[]; madeForYou?: boolean };
export type SoundCloudPlaylist = { id: string; urn?: string; title: string; permalinkUrl?: string; artworkUrl?: string; trackCount: number; user: { username: string } };
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
    return this.request<SoundCloudTrack[]>('user.tracks', { userId }, 30_000);
  }

  async userPlaylists(userId: number): Promise<SoundCloudPlaylist[]> {
    return this.request<SoundCloudPlaylist[]>('user.playlists', { userId }, 30_000);
  }

  async likeTrack(trackId: number, trackUrn: string, datadomeCookie?: string): Promise<TrackLikeResult> {
    return this.request<TrackLikeResult>('track.like', { trackId, trackUrn, datadomeCookie }, 30_000);
  }

  async unlikeTrack(trackId: number, trackUrn: string, datadomeCookie?: string): Promise<TrackLikeResult> {
    return this.request<TrackLikeResult>('track.unlike', { trackId, trackUrn, datadomeCookie }, 30_000);
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
  userPlaylists: (userId: number) => backend.userPlaylists(userId),
  likeTrack: (trackId: number, trackUrn: string, datadomeCookie?: string) => backend.likeTrack(trackId, trackUrn, datadomeCookie),
  unlikeTrack: (trackId: number, trackUrn: string, datadomeCookie?: string) => backend.unlikeTrack(trackId, trackUrn, datadomeCookie),
};
