# Migration TODO and handoff

Updated: 2026-10-19
Branch: `codex/resonance-tauri-migration`
Repository: `C:\Users\krako\Desktop\resonance-tauri`
Read-only source: `C:\Users\krako\Desktop\BSC-main`

## Resume here first

1. In PowerShell, enter the migration repo and run `git status --short` and `git branch --show-current`. Stay on `codex/resonance-tauri-migration`; do not change repository access or contributors.
2. The latest completed Phase 3 slice migrates legacy version-1 playlist JSON (`songs` URI strings, `copies`, filename-based covers) to current records. Its implementation and regression fixture are in `crates/library/src/playlists.rs`.
3. Keep Cargo output outside the repo: `$env:CARGO_TARGET_DIR="$env:TEMP\resonance-target"`.
4. This checkpoint passed: Rust workspace (39 tests), strict Clippy/fmt, ESLint, TypeScript/Vite build, Vitest (3), Playwright (1), Tauri release no-bundle build (`%TEMP%\resonance-target\release\resonance.exe`) and `git diff --check`.
5. If the migration checkpoint is not already in `git log`, update `MIGRATION_LOG.md`, `PHASE3_PLAN.md` and `PARITY_CHECKLIST.md`, commit and push it to the existing branch. Continue Phase 3 before Phase 4.

## Completed and pushed

- Phase 0 reconnaissance documents and parity baseline; Phase 1 Tauri 2 / React 19 / TypeScript / Vite shell.
- Substantial Phase 2 audio core: local decoding/output, seek, queue/preload, crossfade/advance, DSP and spectrum. Phase remains open.
- Phase 3.1 scanner/Saved Songs and 3.2 local source management/settings migration.
- Phase 3.3 playlist CRUD, copy-on-add, persistence/order, play/add/remove/reorder UI and desktop build.
- Phase 3.4 indexed local tag editing via Lofty, plus embedded/folder artwork extraction and validated artwork data URLs.
- Latest pushed checkpoint before current work: `0a88340 feat: edit local playlist details and covers`.
- Local track and playlist cover editing passed full Windows verification. The current legacy migration checkpoint also passed full Windows verification with 39 Rust tests and the same frontend, e2e, Clippy/fmt and Tauri checks.

## Remaining work by phase

1. **Phase 2:** output-device runtime checks; real MP3/FLAC/Vorbis/AAC/ALAC/AIFF fixtures and seek; remaining legacy spectrum comparisons; previous/queue UI and native file picker.
2. **Phase 3:** tag writes to playlist-owned copies; broader `tst_local`, `tst_covers`, `tst_session`, `tst_settings` parity/integration tests.
3. **Phase 4:** inspect old SoundCloud and Spotify implementations in full; implement Rust providers, OAuth, keyring credential storage, librespot playback, library/search and unified provider trait.
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
- Only Windows has been verified locally; macOS and Linux need CI evidence.
- Native dialog dependency was unavailable locally; path entry/drag-drop remain interim.
- Legacy source contains no audio fixture corpus; generated WAVs do not validate every decoder.
- Enabling Tauri asset protocol with empty scope was rejected by automatic approval review as potentially broad local-file access. The change was not applied; indexed artwork is sent through validated IPC as data URLs.
- Do not change contributor or repository access settings.
