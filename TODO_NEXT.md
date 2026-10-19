# Migration TODO and handoff

Updated: 2026-10-19
Branch: `codex/resonance-tauri-migration`
Repository: `C:\Users\krako\Desktop\resonance-tauri`
Read-only source: `C:\Users\krako\Desktop\BSC-main`

## Resume here first

1. In PowerShell, enter the migration repo and run `git status --short` and `git branch --show-current`. Stay on `codex/resonance-tauri-migration`; do not change repository access or contributors.
2. Current uncommitted changes move all Rodio/CoreAudio stream ownership to a dedicated audio-output worker. Tauri receives a `Send + Sync` command handle; automatic queue advance and crossfade run on the output worker. Windows compile/release, Rust tests, strict Clippy, rustfmt, and `git diff --check` pass. Commit and push, then inspect the new cross-platform run.
3. CI run `39287130778`: quality and Playwright passed; Windows NSIS and Linux AppImage/DEB bundles passed; macOS DMG failed because Tauri's `AudioPlayer` state was not `Send` due to a CoreAudio property callback. The new worker architecture addresses that compile error; macOS confirmation is pending.
4. Keep Cargo output outside the repo when space is limited: `$env:CARGO_TARGET_DIR="$env:TEMP\resonance-target"`.
5. After the next CI run, update this file and continue Phase 2/3 integration scenarios, then move to the Rust providers in Phase 4.

## Completed and pushed

- Phase 0 reconnaissance documents and parity baseline; Phase 1 Tauri 2 / React 19 / TypeScript / Vite shell.
- Substantial Phase 2 audio core: local decoding/output, seek, queue/preload, crossfade/advance, DSP and spectrum. Phase remains open.
- Phase 3.1 scanner/Saved Songs and 3.2 local source management/settings migration.
- Phase 3.3 playlist CRUD, copy-on-add, persistence/order, play/add/remove/reorder UI and desktop build.
- Phase 3.4 indexed local tag editing via Lofty, plus embedded/folder artwork extraction and validated artwork data URLs.
- Latest pushed checkpoint before current work: `813b491 fix: harden local library and release bundles`.
- Playlist-copy tag editing, playlist/source mutation recovery, concurrent scan status, CI Linux/Windows bundle fixes and preference synchronization are pushed. Run `39287130778` confirmed Linux and Windows packages build; macOS exposed a CoreAudio Send boundary now addressed by a dedicated audio worker.

## Remaining work by phase

1. **Phase 2:** output-device runtime checks; real MP3/FLAC/Vorbis/AAC/ALAC/AIFF fixtures and seek; remaining legacy spectrum comparisons; previous/queue UI and native file picker.
2. **Phase 3:** broaden `tst_local`, `tst_covers`, `tst_session`, `tst_settings` parity/integration tests; add command/UI flow coverage; verify scan cancellation/stale-result behavior and native folder picking.
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
- Windows is verified locally; Windows and Linux bundles passed CI on `813b491`; macOS bundle needs CI confirmation after the audio worker change.
- Native dialog dependency was unavailable locally; path entry/drag-drop remain interim.
- Legacy source contains no audio fixture corpus; generated WAVs do not validate every decoder.
- Enabling Tauri asset protocol with empty scope was rejected by automatic approval review as potentially broad local-file access. The change was not applied; indexed artwork is sent through validated IPC as data URLs.
- Do not change contributor or repository access settings.
