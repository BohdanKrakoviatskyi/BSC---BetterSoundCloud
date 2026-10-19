# Migration TODO and handoff

Updated: 2026-10-19
Branch: `codex/resonance-tauri-migration`
Repository: `C:\Users\krako\Desktop\resonance-tauri`
Read-only source: `C:\Users\krako\Desktop\BSC-main`

## Resume here first

1. In PowerShell, enter the migration repo and run `git status --short` and `git branch --show-current`. Stay on `codex/resonance-tauri-migration`; do not change repository access or contributors.
2. Latest pushed commit: `e346601 fix: normalize bundle icons and artifact paths`. It points CI to `target/release/bundle/**` and uses the normalized RGBA8 icon.
3. CI run `39293399821` passed all jobs: Playwright, quality, Windows NSIS, macOS DMG, Linux AppImage/DEB, and artifact upload on all three platforms.
4. Local checks at `e346601`: 47 Rust tests, strict Clippy, rustfmt, frontend lint/Vitest/build, Playwright, Windows NSIS bundle, and `git diff --check` passed.
5. Uncommitted Phase 2 work adds deterministic 8/16/24/32-bit PCM WAV decoding at 22.05/44.1/48/96 kHz; all six local playback tests pass, and the workspace now has 48 passing Rust tests. Strict Clippy, rustfmt and diff checks pass. Commit/push this checkpoint.
6. Remaining audio checks: real compressed-format fixtures, output-device runtime/listening, and prior spectrum comparison. Native file picker and queue UI also remain.
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
- Cross-platform packaging is confirmed green by CI run `39293399821`. Audio-device runtime behavior and compressed decoder fixtures remain unverified.
- Native dialog dependency was unavailable locally; path entry/drag-drop remain interim.
- Legacy source contains no audio fixture corpus; generated WAVs do not validate every decoder.
- Enabling Tauri asset protocol with empty scope was rejected by automatic approval review as potentially broad local-file access. The change was not applied; indexed artwork is sent through validated IPC as data URLs.
- Do not change contributor or repository access settings.
