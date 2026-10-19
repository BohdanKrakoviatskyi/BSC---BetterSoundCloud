# Migration TODO and handoff

Updated: 2026-10-19
Branch: `codex/resonance-tauri-migration`
Repository: `C:\Users\krako\Desktop\resonance-tauri`
Read-only source: `C:\Users\krako\Desktop\BSC-main`

## Resume here first

1. Open PowerShell in `C:\Users\krako\Desktop\resonance-tauri` and run `git status --short` and `git branch --show-current`. Stay on `codex/resonance-tauri-migration`; do not change contributor settings or repository access.
2. Current uncommitted work adds Lofty tag writing and a local-song tag form on top of the pushed playlist feature: `crates/library/src/tags_edit.rs`, `crates/library/src/lib.rs`, `src-tauri/src/lib.rs`, `src/app/commands.ts`, `src/App.tsx`, `src/design/app.css`, `crates/library/Cargo.toml`, and `Cargo.lock`.
3. Set Cargo output outside the repo: `$env:CARGO_TARGET_DIR="$env:TEMP\resonance-target"`.
4. The initial copy cleanup failure is fixed; the targeted playlist copy/reopen/delete test passes. Re-run it after any storage edits.
5. Tag editing is now implemented for indexed local songs and verified on a generated WAV: supplied fields update, empty values clear, unspecified fields remain, artwork can be embedded or removed. Next implement artwork extraction into the cache/UI, cover replacement UI, and source-copy deduplication/migration semantics for playlists.
6. Rerun `cargo fmt --all`, `cargo test --offline --workspace`, `cargo clippy --offline --workspace --all-targets -- -D warnings`, `cargo fmt --all --check`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd test`, and `npm.cmd run test:e2e`. Use scoped sandbox escalation only when writes to this sibling repo are denied.
7. Tauri/React create/list/add/remove/reorder/delete integrations exist. The current tag-edit changes passed all listed checks and Windows Tauri desktop build. Commit and push this checkpoint, then continue with artwork extraction and playlist source-copy reuse/migration.

## Completed and pushed

- Phase 0 reconnaissance documents and parity baseline.
- Phase 1 Tauri 2 / React 19 / TypeScript / Vite shell and Windows desktop build setup.
- Phase 2 substantial audio core: local decoding, output, seek, queue/preload, crossfade/advance, DSP, spectrum. Checkpoints pushed through `7ddca52`.
- Phase 3.1 scanner and Saved Songs view; Phase 3.2 source add/remove/rescan and settings migration. Commit `589dd51 feat: manage local library sources` is pushed to `origin/codex/resonance-tauri-migration`.
- Phase 3.3 candidate checks: 36 Rust tests, strict Clippy and fmt, ESLint, frontend build, Vitest (2), Playwright (1) pass on Windows. The Windows desktop Tauri build also passed and produced `%TEMP%\\resonance-target\\release\\resonance.exe`.

## In progress

- Phase 3.3 local playlist data layer has been started but is verified at crate/workspace/frontend/desktop-build level, but not yet full legacy parity; not committed. `playlists.rs` currently copies selected files and companion files, stores ordered song records atomically, and implements CRUD/reorder operations. The copy cleanup test passes after canonical-path comparison fix.
- Current parity gaps: legacy playlists reuse an unchanged source copy per playlist, migrate old outside-path playlist records and support cover editing. Embedded artwork is written/removed in tags, but extraction and replacement UI are not complete.

## Remaining work by phase

1. **Phase 2 completion:** output-device runtime check; fixture-based MP3/FLAC/Vorbis/AAC/ALAC/AIFF decoding and seek checks; remaining legacy spectrum comparisons; previous-track and queue UI; native file picker. Some require fixtures/tooling and runtime environments not present on this Windows machine.
2. **Phase 3 completion:** finish playlist copy/persistence/migration and UI; Lofty tag writes and embedded/folder art extraction/editor; playlist art; parity tests for `tst_local`, `tst_covers`, `tst_session`, and `tst_settings`.
3. **Phase 4 providers:** inspect old SoundCloud Go sidecar and Spotify session/web API/librespot sources in full; implement SoundCloud and Spotify in Rust, keyring credentials, OAuth and unified provider interface.
4. **Phase 5 design:** port artwork-derived Material 3 palette, design tokens, all 15 motion primitives and 40 controls; add settings UI and theme parity.
5. **Phase 6 graphics:** inventory and port all 25 shaders to WebGL2, spectrum/backdrop/material components, frame pacing and benchmark.
6. **Phase 7 screens:** inspect and port all 18 screens, shell navigation and window/view behavior.
7. **Phase 8 immersive:** lyrics, queue, backdrop, equalizer, sound/sleep panels and image/GIF/video wallpapers.
8. **Phase 9 system integration:** MPRIS, media keys, Now Playing, tray, lock screen and updater progress.
9. **Phase 10 packaging:** macOS DMG, Windows ZIP/MSI, Linux AppImage/PKGBUILD, version sync and release CI.
10. **Phase 11 final audit:** walk every checkbox, run all release builds/tests/lints on target platforms, search for stubs/TODO markers, document evidence and limitations. Do not call migration complete before this passes.

## Approximate remaining size

The source specification contains 12 phases (0Р Р†Р вЂљРІР‚Сљ11); Phases 0Р Р†Р вЂљРІР‚Сљ1 and portions of 2Р Р†Р вЂљРІР‚Сљ3 are done. Roughly 8 full phases plus the remaining portions of Phases 2Р Р†Р вЂљРІР‚Сљ3 remain. This is a large migration, likely many implementation/checkpoint cycles; do not equate a passing shell build with feature parity. Update this estimate when a phase is audited against `PARITY_CHECKLIST.md`.

## Important decisions and constraints

- Legacy DSP source uses six EQ bands; preserve that observed behavior although the prompt summary mentions ten.
- Existing user explicitly authorized autonomous local work and creating/committing/pushing a branch. The migration branch exists and the previous verified checkpoint push succeeded. Do not add contributors or change access settings.
- Keep `BSC-main` read-only. Do not modify or delete anything there.
- Only Windows has been checked locally; macOS/Linux need CI evidence.
- Native dialog plugin was unavailable from local cache/network; path entry and drag/drop remain temporary until a supported dialog dependency can be obtained.
- Original source tests contain no audio fixture corpus; generated WAV fixtures do not validate every decoder.
