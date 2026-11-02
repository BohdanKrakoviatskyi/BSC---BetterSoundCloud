# Provider and UI Cleanup Design

## Goal
Remove Spotify integration, remove confirmed-dead Qt/C++ application code while preserving the Go sidecar used by the active Tauri/React app, improve provider attribution and shuffle recommendations, and fix layout/navigation behavior.

## Current architecture
The active application is a React/Vite frontend wrapped by Tauri. `src/lib/sidecar.ts` starts the bundled `binaries/local-api` process; that process is built from `api/` Go sources and handles SoundCloud and YouTube Music RPCs. The flat Qt/C++ files in `api/` were unrelated to the active build and caused `go test ./...` to fail because Go found C++ sources in the Go module root; they were removed after checking manifests and source references. Spotify is present in the frontend provider UI, track model, provider APIs, and Go sidecar; the frontend additionally has Spotify embed handling.

## Decisions
- Spotify is removed throughout the active application, including frontend/UI and Go sidecar APIs and stored Spotify-specific settings/auth data. Do not remove unrelated generic provider features.
Keep Go sidecar functionality required by SoundCloud and YouTube Music. Move the provider logo assets used by the React frontend out of the sidecar directory.
- Remove old Qt/C++ sources only after confirming they are unreferenced by the active build and runtime; do not delete files that are shared or needed by Go.
- Render source attribution using local/service logos with accessible names, not text-only all-caps pills.
- Keep sidebar preferences pinned below a separately scrolling navigation/playlists region.
- Make immersive lyrics fit constrained window dimensions by responsive CSS rather than assuming fullscreen dimensions.
- Shuffle recommendations must avoid the current track, repeated IDs, disliked tracks, and candidates whose normalized title is the same as the current track. Use SoundCloud related-track results and YouTube search candidates ranked for artist/title similarity; do not present an exact-title lookup as recommendation quality.

## Components and behavior
1. **Spotify removal:** remove Spotify source variants, provider configuration and OAuth actions, embed player branches/API resources, Spotify RPC handlers and files, and Spotify-specific settings/data migration where present. Keep SoundCloud and YouTube routes operational.
2. **Dead-code audit:** trace all files in `api/` to Tauri configuration, executable build/install scripts, Go imports, and runtime references. Delete Qt/C++ only if the evidence confirms it is disconnected. Retain Go sources and assets consumed by the active sidecar.
3. **Provider identity:** replace `SourcePill` text labels with compact provider logo marks. Logos need accessible labels; provider identity should remain legible at narrow widths.
4. **Immersive lyrics:** use width/height-aware responsive rules and bounded overflow so controls, cover, and lyrics remain usable in windowed, short, and narrow layouts.
5. **Sidebar:** separate scrollable navigation/playlists from a bottom-pinned preferences group; keep route highlighting correct after the DOM layout changes.
6. **Shuffle:** centralize recommendation candidate filtering/ranking enough to test it. SoundCloud uses related results. YouTube Music uses search results for the seed track and filters/ranks using normalized title, artist, duration where available, queue membership, and dislike state. If no suitable candidate exists, stop cleanly rather than queueing an unrelated exact-name result.

## Validation
- Add focused tests first for candidate filtering/ranking and any isolated Spotify-free source/model behavior; verify tests fail before implementation.
- Run `npm run build`, the existing Node tests, and Go tests in `api/`.
- Search tracked active sources for Spotify RPCs/types/player references after removal.
- Confirm Tauri sidecar configuration still points to Go binary and required SoundCloud/YouTube RPCs remain.
- Check responsive CSS at narrow, short, and regular viewport dimensions when browser tooling is available.
