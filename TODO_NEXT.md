# Migration TODO and handoff

Updated: 2026-10-19
Branch: `codex/resonance-tauri-migration`
Repository: `C:\Users\krako\Desktop\resonance-tauri`
Read-only source: `C:\Users\krako\Desktop\BSC-main`

## Resume here first

1. In PowerShell, enter the migration repo and run `git status --short` and `git branch --show-current`. Stay on `codex/resonance-tauri-migration`; do not change repository access or contributors.
2. Latest pushed commit: `4c6606f docs: refresh audio migration handoff`. Current uncommitted work adds the initial Rust provider crate and SoundCloud client; finish workspace verification, then commit and push this checkpoint.
3. CI run `39293399821` passed all jobs on `e346601`: Playwright, quality, Windows NSIS, macOS DMG, Linux AppImage/DEB, and artifact upload on all three platforms. Runs for `9ccbe80`, `6c73913`, and `4c6606f` were in progress at last check; query GitHub Actions before updating this status.
4. Local checks at this uncommitted provider checkpoint: full `cargo test --workspace` passes (55 tests total), workspace strict Clippy passes, and `cargo fmt --all -- --check` plus `git diff --check` must be rerun after final doc updates.
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
3. **Phase 4:** initial `crates/providers` trait/models and SoundCloud HTTP paths are implemented locally, with legacy card mapping and pagination-origin tests. Not yet integrated into Tauri commands/UI. Continue full profile/details/stream behavior, auth/keyring, native playlists, lyrics, Spotify OAuth/API/keyring/librespot; inspect each old Spotify source file completely before porting it. The old checkout has no Go files or `go.mod`; `docs/SOUNDCLOUD_API_REFERENCE.md` is incomplete. In particular, confirm the account-playlist endpoint against the actual old sidecar before treating it as parity.
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
