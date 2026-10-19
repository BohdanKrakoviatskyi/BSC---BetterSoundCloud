# Migration TODO and handoff

Updated: 2026-10-19
Branch: `codex/resonance-tauri-migration`
Repository: `C:\Users\krako\Desktop\resonance-tauri`
Read-only source: `C:\Users\krako\Desktop\BSC-main`

## Resume here first

1. In PowerShell, enter the migration repo and run `git status --short` and `git branch --show-current`. Stay on `codex/resonance-tauri-migration`; do not change repository access or contributors.
2. Latest pushed commit: `0227194 feat: integrate Spotify desktop library login`. Local work has begun Spotify Web API JSON mapping; its contract tests are green. Finish strict checks, record the checkpoint, and continue endpoint implementation.
3. CI run `39293399821` passed all jobs on `e346601`: Playwright, quality, Windows NSIS, macOS DMG, Linux AppImage/DEB, and artifact upload on all three platforms. Verify the pending provider CI runs with `gh run list --branch codex/resonance-tauri-migration --limit 5`.
4. Current local checks after the latest local mapping change: full `cargo test --workspace` passes (66 tests), strict workspace Clippy passes, and rustfmt check plus `git diff --check` pass. The last pushed commit's CI run `39299823382` was still in progress at last query; poll before marking the integration CI-green.
5. Remaining audio checks: real compressed-format fixtures, output-device runtime/listening, and legacy spectrum comparisons. Native file picker and queue UI also remain.
6. Keep Cargo output outside the repo when space is limited: `$env:CARGO_TARGET_DIR="$env:TEMP\resonance-target"`.

## Completed and pushed

- Phase 0 reconnaissance documents and parity baseline; Phase 1 Tauri 2 / React 19 / TypeScript / Vite shell.
- Substantial Phase 2 audio core: local decoding/output, seek, queue/preload, crossfade/advance, DSP and spectrum. Phase remains open.
- Phase 3.1 scanner/Saved Songs and 3.2 local source management/settings migration.
- Phase 3.3 playlist CRUD, copy-on-add, persistence/order, play/add/remove/reorder UI and desktop build.
- Phase 3.4 indexed local tag editing via Lofty, plus embedded/folder artwork extraction and validated artwork data URLs.
- Latest pushed checkpoint: `e346601 fix: normalize bundle icons and artifact paths`.
- CoreAudio output is owned by a dedicated thread; Tauri holds a `Send + Sync` handle. CI confirmed Windows, macOS, and Linux packages and artifacts all succeed.

## Remaining work by phase

1. **Phase 2:** output-device runtime checks; real MP3/FLAC/Vorbis/AAC/ALAC/AIFF fixtures and seek; remaining legacy spectrum comparisons; previous/queue UI and native file picker.
2. **Phase 3:** broaden `tst_local`, `tst_covers`, `tst_session`, `tst_settings` parity/integration tests; add command/UI flow coverage; verify scan cancellation/stale-result behavior and native folder picking.
3. **Phase 4:** shared provider types/trait, SoundCloud REST client, progressive/HLS/preview stream selection, Spotify PKCE/token exchange and native keyring are committed. Tauri Spotify library login/logout/status commands and Settings controls are committed. Local Spotify Web API mapping now converts playlist and track JSON into shared provider types; endpoint operations, pagination, token refresh/restore, librespot playback, SoundCloud auth/cache/lyrics, and UI content remain. The old checkout has no Go files or `go.mod`; `docs/SOUNDCLOUD_API_REFERENCE.md` is incomplete. Confirm SoundCloud's account-playlist endpoint against sidecar source if available.
4. **Phase 5:** Material 3 artwork palette, design tokens, 15 motion primitives, 40 controls, theme/settings parity.
5. **Phase 6:** inventory/port 25 shaders to WebGL2; spectrum/backdrop/material components, frame pacing and benchmark.
6. **Phase 7:** port all 18 screens, shell navigation and window/view behavior.
7. **Phase 8:** immersive lyrics/queue/backdrop/equalizer/sound/sleep panels and image/GIF/video wallpapers.
8. **Phase 9:** MPRIS, media keys, Now Playing, tray, lock screen and updater progress.
9. **Phase 10:** macOS DMG, Windows ZIP/MSI, Linux AppImage/PKGBUILD, version sync and release CI.
10. **Phase 11:** audit every parity checkbox, run release builds/tests/lints across target platforms, search for stubs/TODO markers, document evidence and limitations.

## Progress estimate and constraints

The specification defines Phases 0–11. Phase 0–1 and parts of 2–3 are done; approximately eight full phases plus the remainder of Phases 2–3 are left. This is a large migration with many implementation/checkpoint cycles; no claim of full feature parity is warranted yet.

- Keep `BSC-main` read-only.
- Cross-platform packaging is confirmed green by CI run `39293399821`. Audio-device runtime behavior and compressed decoder fixtures remain unverified.
- Native dialog dependency was unavailable locally; path entry/drag-drop remain interim.
- Legacy source contains no audio fixture corpus; generated WAVs do not validate every decoder.
- Enabling Tauri asset protocol with empty scope was rejected by automatic approval review as potentially broad local-file access. The change was not applied; indexed artwork is sent through validated IPC as data URLs.
- Do not change contributor or repository access settings.

## Phase 4 provider foundation - 2026-10-19
- Read `src/provider/SoundCloud.cpp`, `SoundCloud.h`, `SidecarClient.cpp`, `SidecarClient.h`, and `docs/SOUNDCLOUD_API_REFERENCE.md` from the old read-only checkout. The Go sidecar source is absent, so old RPC details beyond these files/docs cannot be verified yet.
- Added `crates/providers` to the workspace with shared provider track/artist/playlist/page types, a `MusicProvider` trait, and an async SoundCloud REST client for search, artist profile/tracks/likes, playlists/playlist tracks, track details, and related tracks.
- SoundCloud card mapping accepts both legacy sidecar camelCase fields and v2 API snake_case fields. Pagination is restricted to the configured API origin so a malicious `next_href` cannot receive the OAuth header or client ID.
- Focused provider suite: 6 tests pass; workspace strict Clippy passes. Full workspace test build is still running. No provider commands/UI or auth/keyring integration has shipped yet; do not mark Phase 4 complete.
- Follow-up: add stream resolution/download/cache, artist/track details, lyrics parity, robust HTTP contract tests; inspect Spotify `WebApi.cpp`, `OAuthFlow.cpp`, `CredentialStore.cpp` and types in full before porting. Confirm `playlists.mine` against sidecar source if available; current native route is a best-effort inference.

## Phase 4 OAuth and stream follow-up - 2026-10-19
- Spotify's complete legacy Web API, OAuth, credential store, types/JSON and session files have now been read. They use PKCE at fixed loopback `/login`, two separate Spotify accounts (librespot playback and Web API library), and carefully ordered refresh-token rotation.
- Added SoundCloud progressive-first / HLS-next / preview-last stream option selection, supporting both legacy sidecar and native v2 response shapes.
- Added Spotify PKCE challenge/state construction, strict callback host/path/state checks, x-www-form-urlencoded code exchange and refresh requests, rotated-token response parsing, and `invalid_grant` as a revoked-login error. Verifiers are zeroized when dropped.
- Added `KeyringCredentialStore` using native OS credential storage, with isolated Spotify playback/library and SoundCloud entries. The app has not yet wired this crate into Tauri or React.
- Focused provider coverage is now 12 tests. Full Rust workspace passes 61 tests; strict Clippy, rustfmt check and `git diff --check` pass. The docs checkpoint is updated; commit/push and CI for this follow-up remain.
- Next: implement Tauri's loopback callback lifecycle and browser opening, persist login state through the native keyring, build Spotify Web API and SoundCloud stream cache, then expose provider data to the shell/search/library UI. Continue with API contract fixtures and platform CI. No claim of Phase 4 parity until live account flows and playback are integrated and verified.
