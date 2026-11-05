# YouTube Music Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Google OAuth provider card with cross-platform YouTube Music account/library integration through `ytmusicapi`, while preserving global search and SoundCloud fallback and using existing yt-dlp playback.

**Architecture:** The Tauri login window captures authenticated account-menu request headers and reads the full cookie jar through Tauri/Wry's native WebView cookie API. A packaged Python JSON-lines sidecar owns `ytmusicapi` operations and local credential storage; React uses it for connection state, library sync and playlist tracks. YouTube Music tracks reuse the existing yt-dlp stream path by video ID.

**Tech Stack:** Tauri 2 / Rust, React + TypeScript, Python `ytmusicapi` pinned to an exact release, PyInstaller sidecar, existing Go `local-api`, existing yt-dlp.

**Spec:** `docs/superpowers/specs/2026-11-02-youtube-music-integration-design.md`

## Global Constraints

- Do not modify global search (`searchTracks`, `searchYtDlpTracks`, or Search page result behavior).
- Do not modify SoundCloud-to-YouTube fallback/replacement behavior.
- Use the same in-app Tauri webview login pattern on Linux, macOS and Windows; retrieve secure/HTTP-only cookies with Tauri/Wry rather than `document.cookie`.
- Keep capture Rust-side: the login window opens `https://music.youtube.com/library`, a watcher polls its URL and reads `__Secure-3PAPISID` from the native cookie store, gated by a one-time nonce.
- Never put Cookie or Authorization values in URLs, command-line arguments, logs, error messages or source control.
- Pin `ytmusicapi` to an exact version and package both Go `local-api` and the Python worker for supported Linux/macOS/Windows target triples; users must not need Python installed.
- Treat `ytmusicapi`'s YouTube Music web protocol as unofficial and liable to change.

---

## File Structure

- `api/ytmusic_worker.py`: one JSON-lines worker around `ytmusicapi`; account validation and read-only library/playlist methods.
- `api/requirements-ytmusic.txt`: exact dependency pin used by worker builds.
- `api/ytmusic_worker.spec`: PyInstaller executable packaging configuration.
- `api/test_ytmusic_worker.py`: Python unit tests for protocol, auth persistence, mapping and redaction.
- `api/ytmusic_worker_testdata/`: sanitized fixture responses only if real parser fixtures are necessary; never include account data.
- `src-tauri/src/lib.rs`: start/cancel YouTube Music login window; validate a one-shot request capture, obtain cookies via `cookies_for_url`, emit credentials to the main window, and close the login webview.
- `src-tauri/tauri.conf.json`: package target-specific `local-api` and `ytmusic-worker` sidecars and narrowly permit IPC from `music.youtube.com` only for the capture command.
- `src-tauri/capabilities/default.json`: grant only required command/event permissions if the current capability model requires explicit permissions.
- `src-tauri/binaries/ytmusic-worker-<target-triple>` and `src-tauri/binaries/local-api-<target-triple>`: generated sidecar artifacts for each supported OS/architecture; do not hand-edit binary artifacts.
- `src/lib/ytmusic-sidecar.ts`: start/reuse the Python sidecar, send newline-delimited RPC requests, correlate responses, and surface sanitized errors.
- `src/lib/providers-api.ts`: remove only old YouTube OAuth/Data API types and add the YouTube Music sidecar API types/functions; retain `searchYtDlpTracks` and `ytDlpTrackStream` unchanged.
- `src/lib/ytmusic-library.ts`: normalize `ytmusicapi` playlists/tracks into existing app types and create stable YouTube Music collection IDs.
- `src/lib/ytmusic-library.test.mjs`: normalization and ID stability tests.
- `src/state/library.ts`: YouTube Music provider state, startup sync, refresh, remote playlist loading and disconnect cleanup.
- `src/pages/Providers.tsx`: replace only the YouTube OAuth card body with connect/refresh/disconnect states; leave SoundCloud UI/handlers intact.
- `src/pages/Home.tsx`: show YouTube Music playlists alongside existing playlists.
- `src/components/Sidebar.tsx`: show YouTube Music playlists and liked/saved collection entries without changing local favorites semantics.
- `src/pages/Collection.tsx`: load remote YouTube Music playlist/liked/saved collections while preserving SoundCloud/local playlist handling.
- `src/App.tsx`: kick off YouTube Music status/library load on startup alongside SoundCloud.
- `api/youtube.go`, `api/youtube_tracks.go`, `api/youtube_discover.go`, and their tests: remove only obsolete Google OAuth/Data API functionality after verifying no references; retain yt-dlp files and shared functions still used elsewhere.
- `api/build_sidecars.py`: reproducible builds for Go `local-api` (cross-compilable) and target-native PyInstaller `ytmusic-worker`; document target-native packaging requirements.

## Task 1: Define the Python worker RPC and test mapping/auth boundaries

**Files:**
- Create: `api/test_ytmusic_worker.py`
- Create: `api/ytmusic_worker.py`
- Create: `api/requirements-ytmusic.txt`

**Interfaces:**
- Input line: `{"id": number, "method": string, "params": object}`.
- Output line: `{"id": number, "result": object}` or `{"id": number, "error": string}`.
- Methods: `auth.status`, `auth.save`, `auth.logout`, `library.sync`, `playlist.tracks`.
- `auth.save` params are a structured header object; worker validates it with `YTMusic(auth=headers)` and `get_account_info()` before persisting.
- `library.sync` returns `{profile, playlists, likedSongs, savedSongs}`; `playlist.tracks` returns `{playlistId, title, artworkUrl, tracks}`.

- [ ] Write Python tests for valid required browser headers, missing required cookie, account validation failure, private auth file permissions, and error output that never contains the Cookie/Authorization values.
- [ ] Add mapping tests for playlist metadata and track fields: `videoId`, title, artist list, thumbnail, duration, availability; include items with no video ID and empty artist/thumbnail data.
- [ ] Run `python3 -m unittest api.test_ytmusic_worker -v`; verify the new tests fail because the worker does not exist.
- [ ] Inspect current stable `ytmusicapi` release from its primary release metadata, pin that exact version in `requirements-ytmusic.txt`, and implement the smallest worker methods using its documented `YTMusic`, `get_account_info`, `get_library_playlists`, `get_playlist`, `get_liked_songs`, and `get_library_songs` APIs.
- [ ] Keep auth config in the user data directory with owner-only permissions on Unix; read credentials only from worker RPC stdin, and emit no raw dependency exception text if it can contain headers.
- [ ] Run Python tests; verify all pass without a live Google session.

## Task 2: Package both sidecars for all desktop targets

**Files:**
- Create: `api/ytmusic_worker.spec`
- Create: `api/build_sidecars.py`
- Modify: `src-tauri/tauri.conf.json`
- Create/generated: `src-tauri/binaries/ytmusic-worker-<target-triple>`
- Create/generated: `src-tauri/binaries/local-api-<target-triple>` for non-Linux targets (retain existing Linux binary)

**Interfaces:**
- Build command accepts one supported target triple and produces Tauri-compatible `local-api-<target-triple>` and `ytmusic-worker-<target-triple>` artifacts. The Go binary may be cross-compiled; PyInstaller worker builds must run on the target OS.
- Runtime executable accepts `--data-dir <app-data-dir>` (path only; no credentials as arguments) and serves the JSON-lines protocol until stdin closes.

- [ ] Add a packaging smoke test that launches the built worker, sends `auth.status`, and parses one JSON response; it must not require any credentials.
- [ ] Run the smoke test before adding the PyInstaller spec to confirm it fails because the executable is absent.
- [ ] Add a PyInstaller spec that bundles Python runtime, the pinned `ytmusicapi`, required package data/locales, and the worker entry point as a one-file console executable for the target OS.
- [ ] Add a build script that cross-compiles the Go sidecar for supported triples and verifies that the requested Python worker target matches the build host; write both target-triple-suffixed executables.
- [ ] Configure Tauri `bundle.externalBin` to include both target-suffixed binaries. Do not assume a PyInstaller worker built on one OS can run on another.
- [ ] Run both sidecar smoke tests on the local Linux target; record Windows/macOS target-native builds as a release prerequisite if those hosts are unavailable.

## Task 3: Implement secure cross-platform request capture in Tauri

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json` only if required

**Interfaces:**
- Tauri command `start_ytmusic_login` opens one dedicated window at `https://music.youtube.com/` and emits `ytmusic-login-cancelled` on close/timeout.
- `start_ytmusic_login` opens the login window and spawns a Rust watcher that reads cookies for `https://music.youtube.com/`, builds the header map, emits `ytmusic-auth-captured` to the main window and closes login.
- Request headers map keys: `Accept`, `Authorization`, `Content-Type`, `X-Goog-AuthUser`, `x-origin`, `Cookie`.

- [ ] Add Rust tests for account-menu URL matching (valid endpoint only), state nonce equality, required Authorization/AuthUser, and cookie filtering/serialization; test that values are never embedded in callback URLs.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`; verify new tests fail before implementation.
- [ ] Add an initialization script that wraps Fetch and XHR, observes only the exact YouTube Music account-menu endpoint, and waits for a successful response before invoking the capture command once.
- [ ] Add a one-time random nonce to the login session; validate window label, current HTTPS hostname, URL path, nonce and event state before reading the WebView cookie store.
- [ ] Use Tauri/Wry's `cookies_for_url` API for the login window, assemble the actual cookie header, require `__Secure-3PAPISID` (or the documented equivalent accepted by the pinned ytmusicapi), and emit the structured header map to the main app only after validation.
- [ ] Register remote-domain IPC permissions only for `music.youtube.com` and only the capture operation; do not expose broad shell, filesystem, or arbitrary invoke APIs to the remote page.
- [ ] Run Rust tests and `cargo check --manifest-path src-tauri/Cargo.toml`; manually verify that login cancel/timeout closes the window and that no secret appears in URLs/logs.

## Task 4: Implement the TypeScript worker transport and normalization tests

**Files:**
- Create: `src/lib/ytmusic-sidecar.ts`
- Create: `src/lib/ytmusic-library.ts`
- Create: `src/lib/ytmusic-library.test.mjs`
- Modify: `src/lib/providers-api.ts`

**Interfaces:**
- `ytMusicRpc<T>(method: string, params?: object): Promise<T>` uses one long-lived Tauri sidecar, line-delimited JSON and monotonically increasing request IDs.
- `ytMusicAuthStatus(): Promise<{authorized: boolean; profile?: {name?: string; handle?: string; picture?: string}}>`.
- `ytMusicAuthSave(headers: Record<string, string>): Promise<...>`; `ytMusicLogout(): Promise<...>`; `ytMusicLibrarySync(): Promise<...>`; `ytMusicPlaylistTracks(playlistId: string): Promise<...>`.
- `mapYtMusicTrack(item): Track` produces `id: "yt:<videoId>"`, `source: "youtube"`, `nativeId: videoId`, `playback: "direct"`, duration seconds, canonical artist string and YouTube Music permalink.
- Remote playlist route IDs use `ytpl:<playlistId>`; virtual collection IDs use `ytliked` and `ytsaved`.

- [ ] Write mapping tests for video IDs, artist arrays, thumbnail selection, duration, unavailable/missing video IDs, and duplicate video IDs.
- [ ] Run `node --experimental-strip-types --test src/lib/ytmusic-library.test.mjs`; verify failures identify missing normalization behavior.
- [ ] Implement mapping and the sidecar JSON-lines reader. The reader must handle split chunks, malformed lines without killing other requests, process exit/restart, request rejection, and redacted stderr.
- [ ] Add typed provider functions for the worker methods. Remove only old Google OAuth/Data API frontend types/functions; retain yt-dlp search/stream exports without changing signatures or implementation.
- [ ] Run focused Node tests and `npx tsc --noEmit`.

## Task 5: Integrate account lifecycle and library into app state

**Files:**
- Modify: `src/state/library.ts`
- Modify: `src/App.tsx`
- Create or extend: `src/state/ytmusic-library.test.mjs` if state logic is separable

**Interfaces:**
- Store fields: `ytmusicPlaylists`, `ytmusicLiked`, `ytmusicSaved`, `ytmusicPlaylistTracks`, `ytmusicLibraryLoading`, `ytmusicLibraryError`, `ytmusicProfile`.
- Functions: `loadYtMusicLibrary(force?: boolean): Promise<void>`, `loadYtMusicPlaylistTracks(id: string): Promise<Track[]>`, `clearYtMusicLibrary(): void`.
- Startup checks auth status and syncs only when already authorized; it never opens a login window automatically.

- [ ] Write tests for authorized startup sync, unauthorized empty state, partial sync failure preserving prior successful data, playlist-track cache, duplicate track IDs and logout clearing only YouTube Music data.
- [ ] Run focused state tests and verify they fail before implementation.
- [ ] Implement state and explicit refresh with in-flight request deduplication; register all normalized tracks in the existing library cache.
- [ ] Extend `App.tsx` startup effect to invoke the new library loader while keeping SoundCloud startup behavior unchanged.
- [ ] Run tests, TypeScript check, and verify SoundCloud state and local likes/playlists remain independent.

## Task 6: Replace the provider card and add library collections

**Files:**
- Modify: `src/pages/Providers.tsx`
- Modify: `src/pages/Home.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/pages/Collection.tsx`
- Modify: `src/App.tsx` only if route types require it

**Interfaces:**
- Provider card actions: connect via `start_ytmusic_login`, refresh via `loadYtMusicLibrary(true)`, disconnect via worker logout plus `clearYtMusicLibrary`.
- `ytpl:<id>` displays a provider playlist; `ytliked` displays the YouTube Music liked playlist; `ytsaved` displays saved songs.
- User playlist/liked collections are read-only; standard play/shuffle actions use the existing queue/player.

- [ ] Add a pure collection-ID parser test for local playlists, SoundCloud playlists, YouTube Music playlists, liked and saved routes; ensure IDs cannot be confused across providers.
- [ ] Run the route/collection test and confirm the new YT Music identifiers are rejected or unresolved by current code.
- [ ] Replace only the YouTube card's OAuth form with Connect/Refresh/Disconnect/status/error states. Listen for `ytmusic-auth-captured`, send the headers to `ytMusicAuthSave`, refresh library and remove listeners on timeout/unmount.
- [ ] Add YouTube Music playlists and virtual liked/saved entries to Home/Sidebar; preserve existing local/SoundCloud order and behavior.
- [ ] Extend `Collection.tsx` to load each remote collection lazily, show loading/error/retry states, and reuse the existing `TrackList`/play/shuffle controls.
- [ ] Add user-facing errors for unavailable items without video IDs; do not invoke global search or SoundCloud fallback to repair them.
- [ ] Run frontend tests, `npx tsc --noEmit`, and `npm run build`.

## Task 7: Remove obsolete OAuth/Data API code and verify unchanged paths

**Files:**
- Modify/delete only after call-site search: `api/youtube.go`, `api/youtube_tracks.go`, `api/youtube_discover.go`, corresponding test files, `src/lib/providers-api.ts`, and `src/pages/Providers.tsx`.
- Preserve: `api/youtube_dlp.go`, yt-dlp stream/search calls, `src/lib/api.ts` search/fallback functions, `src/state/player.ts` fallback logic.

- [ ] Search all source files for `youtube.auth`, `youtube.search.tracks`, `youtube.discover`, `youtubeAuthExchange`, and `searchYouTubeTracks`; document remaining callers before deletion.
- [ ] Add/retain a regression test asserting search and fallback public function exports/inputs remain stable.
- [ ] Delete only unused Google OAuth/Data API RPC/types/tests and their associated token/settings files; retain shared helpers still called by SoundCloud/yt-dlp.
- [ ] Run `go test ./...`, `node --experimental-strip-types --test src/lib/*.test.mjs`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Inspect `git diff` to verify no edits in `src/lib/api.ts` search/fallback logic, `api/youtube_dlp.go`, or their existing behavior.

## Task 8: Cross-platform verification and setup docs

**Files:**
- Modify: `README.md` or add `docs/ytmusic-sidecar.md`
- Add/modify CI workflow only if the repository already has a CI convention.

- [ ] Document required target-native PyInstaller commands, dependency pin/update process, webview login flow, read-only library features, and the unofficial API caveat.
- [ ] Run Linux full checks: `python3 -m unittest api.test_ytmusic_worker -v`, `cargo test --manifest-path src-tauri/Cargo.toml`, `go test ./...`, all Node tests, `npx tsc --noEmit`, and `npm run build`.
- [ ] Run Windows and macOS target-native worker builds plus Go cross-build and Tauri compile checks in their respective environments; do not claim release-ready cross-platform support until these pass.
- [ ] Verify no credentials appear in test output, process arguments, logs, URLs, or generated fixtures; remove any generated credential/config artifacts.
