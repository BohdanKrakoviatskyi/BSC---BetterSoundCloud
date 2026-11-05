# YouTube Music integration redesign

## Goal

Replace Resonance's existing Google OAuth / YouTube Data API provider integration with a dedicated YouTube Music integration built on `ytmusicapi` for authenticated account/library data and the already bundled `yt-dlp` playback path. The login experience must match SoundCloud: an in-app Tauri webview opens `https://music.youtube.com/`, the user signs into Google, and the integration captures the authenticated YouTube Music request and completes setup automatically. Support Linux, macOS, and Windows desktop builds.

## Non-goals and compatibility boundaries

- Do not change global search (`searchTracks`, `searchYtDlpTracks`, or their UI/results behavior).
- Do not change the SoundCloud-to-YouTube replacement/fallback path.
- Do not use YouTube Data API OAuth or API keys for the new YouTube Music library integration.
- Do not implement remote playlist editing, like/unlike actions, history import, or recommendation features in the first iteration.
- `ytmusicapi` is a metadata/library client, not an audio-stream provider. Library tracks will play through the existing yt-dlp video-ID stream path. A missing/unsupported video ID must fail with an actionable unavailable-track result rather than silently alter global search or SoundCloud fallback.

## Current codebase findings

- SoundCloud login is implemented in `src-tauri/src/lib.rs` with a dedicated `WebviewWindowBuilder`, an initialization script that observes Fetch/XHR, and Tauri events. Its flow uses platform-neutral Tauri/Wry APIs.
- `src/pages/Providers.tsx` currently presents SoundCloud and Google OAuth cards. The YouTube card is its only frontend caller of the YouTube Data API auth functions.
- General search and SoundCloud fallback are separate: `src/lib/api.ts` calls `searchYtDlpTracks` for global search and `findYouTubeFallback`; these paths must remain unchanged.
- `api/youtube_dlp.go` already resolves YouTube video IDs to audio streams. The current player supports direct YouTube tracks through this path.
- `ytmusicapi` exposes account info, all library playlists (`get_library_playlists(limit=None)`), playlist contents (`get_playlist(..., limit=None)`), liked songs (`get_liked_songs`), and saved library songs (`get_library_songs`). It emulates YouTube Music's private web client protocol; these endpoints and response shapes are not a stable official Google API.
- Current Tauri/Wry WebView APIs expose cookies for a URL on desktop platforms, including secure/HTTP-only cookies. This permits the login script to observe the account-menu request while native Tauri code retrieves the associated cookie jar without depending on `document.cookie` or OS-specific browser APIs.

## Proposed architecture

### 1. Cross-platform login and credential capture

- Add a YouTube Music login command/window parallel to the existing SoundCloud flow; use the same embedded Tauri webview pattern and open `https://music.youtube.com/`.
- Open `https://music.youtube.com/library` in the login window. A Rust watcher polls the window URL: if the session cookie is already present it emits the credentials; if the user lands on a non-library page (e.g. after sign-in redirect) the window is navigated back to `/library`.
- Capture the request's `Authorization` and `X-Goog-AuthUser` values and the non-secret protocol headers required by `ytmusicapi`. After a successful account-menu response, navigate the same webview to `https://music.youtube.com/library` and pass the capture to a one-shot native Tauri command.
- The native command validates the source window, current origin, one-time login state, and required values; it obtains the full YouTube Music cookie set from the WebView cookie store for the exact origin. Credentials must never be placed in a URL, logged, or exposed in error text.
- Build the browser-header configuration expected by `ytmusicapi`. The captured `Authorization` value is used to validate/capture the authenticated request; `ytmusicapi` browser mode derives a fresh SAPISID-based Authorization value from the saved cookie for subsequent requests, rather than reusing a stale timestamped request header.
- Validate credentials by calling `get_account_info()` through the Python adapter. On success, close the login window, report the account name, and sync the library. On failure, retain no partial credentials and show a redacted actionable error.
- Store the session locally with restrictive permissions in the existing per-user application data directory, consistent with the current sidecar auth storage. On Unix use owner-only directory/file permissions; on Windows rely on the per-user app-data ACL. Clear credentials on disconnect. Never persist credentials in frontend state, app preferences, source control, or logs.

### 2. `ytmusicapi` adapter and packaging

- Add a small Python JSON-lines worker that uses a pinned `ytmusicapi` version. It accepts one request at a time and returns normalized JSON. Authentication material is supplied through stdin, not command-line arguments or environment variables; diagnostics must redact headers/cookies.
- Bundle the worker as a Tauri sidecar for Linux, macOS, and Windows (matching supported architectures) so end users do not need a system Python installation. Add reproducible build instructions/scripts and include the worker in Tauri's sidecar configuration. The repository currently contains only a Linux `local-api` sidecar, so add reproducible Go sidecar builds for the same desktop target triples; keep its runtime behavior and yt-dlp integration intact.
- Keep the Python boundary small: `auth.status`, `auth.validate`, `auth.logout`, `library.sync`, and `playlist.tracks`. Normalize only fields the app needs: playlist ID/title/artwork/count and track video ID/title/artists/artwork/duration/availability.
- Treat API errors, expired cookies, malformed responses, and missing required cookie values as recoverable provider errors; no automatic credential guessing, browser-profile scraping, or network proxying.

### 3. Library, playback, and UI

- Replace the YouTube OAuth controls in `src/pages/Providers.tsx` with Connect / Refresh library / Disconnect, connection status, account name, and clear sign-in/error states. Keep the SoundCloud card and its current login untouched.
- Add YouTube Music account library state and loading/error handling in `src/state/library.ts`. On app startup, check auth status and sync the user's playlists, playlist metadata, liked songs, and saved songs. Provide an explicit refresh action.
- Display YouTube Music playlists alongside SoundCloud and local playlists in Home and the sidebar. Extend the collection route to load and play YouTube Music remote playlists, and expose YouTube Music Liked Songs and saved songs as provider collections without merging provider likes into the app's own like/unlike semantics.
- Map music tracks to the existing `Track` model with the YouTube video ID. Reuse the current direct YouTube/yt-dlp playback path; do not edit global search or SoundCloud fallback code. Handle duplicate IDs across account collections by deduplicating IDs in the shared cache while preserving each playlist's order.
- Remove the now-unused OAuth/Data API-only YouTube integration code and stale settings types after call-site verification. Retain `youtube_dlp.go` and all paths used by global search, SoundCloud fallback, and existing shuffle recommendations.

## Data flow

1. User chooses YouTube Music Connect.
2. Tauri opens an isolated login webview at `music.youtube.com` with a one-shot login nonce.
3. User completes Google sign-in; the watcher detects `__Secure-3PAPISID` in the webview cookie store and hands the session to the app.
4. A source-validated native command reads the cookie jar from that webview, builds browser auth headers, and sends them to the local Python adapter for validation.
5. After validation, the credentials are stored locally with restrictive permissions, the login window navigates to `/library`, and the adapter syncs library metadata.
6. React renders playlists/liked/saved collections. Selecting a track passes its video ID to the existing yt-dlp playback path.

## Failure and security behavior

- Missing account-menu requests, user cancellation, or timeout: leave the provider disconnected and allow retry.
- Missing `__Secure-3PAPISID`/required auth values or failed validation: do not save credentials; show a message to retry sign-in.
- Expired/revoked cookie: mark disconnected, preserve no stale auth status, and offer reconnect. Library refresh errors must not corrupt local playlists or SoundCloud state.
- Logout removes only YouTube Music credentials and in-memory provider data; it does not affect SoundCloud or local playlists/likes.
- Never log Cookie, Authorization, raw request headers, raw Python exceptions that may contain headers, or credentials in RPC payload diagnostics.
- `ytmusicapi` and YouTube Music web endpoints are unofficial/reverse-engineered and may change independently of Resonance. Pin the dependency and isolate it behind the adapter.

## Validation

- Python adapter tests: header normalization/redaction, account-info validation, library/playlists/liked/saved response mapping, continuation/pagination, malformed or unavailable tracks, and errors without secret leakage.
- Rust/Tauri tests or focused helpers: accept only the expected account-menu origin/path, require expected headers and login nonce, retrieve cookies for the YouTube Music origin, reject stale/cancelled sessions, and never serialize credentials into URLs/events/logs.
- Go tests: provider RPC and persistence/migration/logout behavior, restrictive file permissions, and worker invocation/error handling.
- Frontend tests: provider connection state and mapping remote playlists/liked/saved songs into collection routes; assert SoundCloud provider state remains independent.
- Run TypeScript checks, all Node tests, `go test ./...`, Rust tests/build, and Python worker tests. Verify Linux locally; build both `local-api` and `ytmusic-worker` on Windows/macOS target-native runners before claiming cross-platform release readiness.
- Confirm by diff/test that `src/lib/api.ts` global search and `findYouTubeFallback` behavior are unchanged.

## Source references

- ytmusicapi browser auth: https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html
- ytmusicapi library API: https://ytmusicapi.readthedocs.io/en/stable/reference/library.html
- ytmusicapi request/auth implementation: https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/ytmusic.py
- ytmusicapi library/playlist implementation: https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/library.py and https://github.com/sigma67/ytmusicapi/blob/main/ytmusicapi/mixins/playlists.py
- Wry WebView cookie APIs: https://docs.rs/wry/latest/wry/struct.WebView.html
