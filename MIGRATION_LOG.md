# Migration log

## Mission
Rewrite Resonance (legacy internal name Swiftify), version 0.2.6, from Qt 6/QML/C++ plus Rust and Go sidecar to Tauri 2, Rust, React 19 and TypeScript. Source of truth: `C:/Users/krako/Desktop/BSC-main`, read-only for this migration. Target: macOS 13+, Linux Wayland/X11, Windows 10/11 x64.

## Current state
Migration workspace is this sibling directory and has its own git repository on `main`. Legacy repository remains untouched; it contains pre-existing modified files `src/main.cpp`, `src/provider/SidecarClient.cpp`, and `tools/build-windows.ps1`.

## Checkpoints
- Phase 0: Source inventory and parity ledger exist. The audit confirms 125 QML files, 24 shaders and 13 legacy test/check files. Full behavior-by-behavior source review remains active and will continue before each ported module.
- Phase 1: Skeleton implemented. React 19/Vite/TypeScript shell, frameless window controls, settings persistence adapter, error events, single-instance routing, CLI parsing, macOS menu code, typed IPC wrappers, CSP/capabilities and cross-platform CI are present. Windows development/test and release executable builds pass. Mac/Linux CI jobs are authored but have not run.

## Evidence and decisions
- Legacy README describes SoundCloud, Spotify Premium, local music, karaoke lyrics, spectrum, wallpapers, dynamic Material 3 palette, updates, and macOS/Linux/Windows targets (`../BSC-main/README.md`).
- CMake confirms Qt 6.9, C++20, Rust `spotify-core`, shader compilation and platform-specific sources (`../BSC-main/CMakeLists.txt`).
- Exact QML, shader and test source inventory is enumerated in `PARITY_CHECKLIST.md`; machine scan is `source-scan.txt`.
- GitHub CLI reports its saved token invalid, but Git Credential Manager successfully authenticated the branch push. The correct migration branch is `codex/resonance-tauri-migration` at commit `cec46e7`. An initial command ran in the source checkout and created `codex/resonance-tauri-rewrite`, pointing at the unchanged source main commit; the source checkout has been returned to `main` and its working files remain untouched.
- This host is Windows. Native macOS and Linux builds cannot be run here; those targets require remote CI runners for verification.

## Initial old-to-new mapping
| Legacy source | Target location |
|---|---|
| `src/main.cpp`, `src/app/*`, `src/system/*` | `src-tauri/src/*` |
| `src/core/*`, `spotify-core/src/*` | `crates/audio-core/*`, `crates/providers/spotify/*` |
| `src/provider/SoundCloud.*`, Go sidecar | `crates/providers/soundcloud/*` |
| `src/library/*`, local audio modules | `crates/library/*` |
| `src/theme/*`, `src/artwork/*` | `crates/theme/*`, `crates/artwork/*` |
| `qml/design/*`, `qml/components/*` | `src/design/*`, `src/components/*` |
| `qml/shell/*`, `qml/views/*` | `src/shell/*`, `src/views/*` |
| `qml/immersive/*`, `qml/motion/*` | `src/immersive/*`, `src/motion/*` |
| `src/render/*`, `shaders/*` | `src/render/*`, `src/shaders/*` (WebGL2) |
| `tests/*` | Rust tests, Vitest and Playwright under `tests/` |
| `.github/workflows/release.yml`, `packaging/*` | new `.github/workflows/release.yml`, `packaging/*` |

## Risks
- Need inspect vendored librespot changes before deciding patch strategy.
- Audio device behavior, media integrations, updater signing and window chrome differ per OS and require target-native verification.
- Full parity spans hundreds of source modules and individual UI files; checklist is the acceptance ledger, not evidence of implementation.
- Current GitHub token invalid; remote push/CI unavailable until reauthenticated.
- Windows host cannot independently verify macOS/Linux builds.

## Next
1. Phase 0 and Phase 1 were completed below before starting audio work.
2. Continue reading each legacy subsystem before implementing its corresponding migration phase.
3. Record evidence and commit at each green phase; continue in dependency order.

## Phase 1 checkpoint — 2026-10-19
- `npm run lint`: passed.
- `npm test`: passed, 2 tests.
- `npm run test:e2e`: passed, 1 Playwright flow covers navigation and persistent preferences in Chromium.
- `npm run build`: passed, TypeScript and Vite production build.
- `cargo fmt --all -- --check`: passed.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `cargo test`: passed, 1 Rust CLI parity test.
- `npm run desktop:build -- --no-bundle`: passed; produced `target/release/resonance.exe`.
- `npm install` reports 0 dependency vulnerabilities after updating Vitest to 5.0.5.
- Visual smoke check at 1360x900 passed; no screenshot is retained in the repo.
- Limit: host is Windows; macOS-only menu branch and Linux/macOS bundle jobs remain unexecuted locally. GitHub CLI token status is invalid, although Git Credential Manager pushed the migration branch; remote workflow status has not yet been verified.
- UI smoke test found and fixed a conditional React hook bug and literal Unicode escape rendering. Vitest excludes Playwright specs to keep runners separate.

## Next
1. Continue Phase 0 source review as each subsystem is prepared for porting; read each original module in full before implementing its replacement.
2. Phase 2: port local audio decode/output, playback, shaping and spectrum into `crates/audio-core` with tests derived from `spotify-core/src` and legacy playback tests.

## Phase 0 source-of-truth correction
- Read `spotify-core/src/dsp.rs`, `spotify-core/src/file_playback.rs`, `src/audio/AudioShaping.*` and playback/output sections of `spotify-core/src/lib.rs` and `output.rs` in full before implementing the corresponding Phase 2 modules.
- The migration prompt says 10-band EQ, but the old DSP and UI use six bands: 60, 150, 400, 1000, 2400 and 15000 Hz, Q=0.9 and ±12 dB. Implementing the actual six-band behavior is required for parity.
- The old file source decodes in 4096-sample blocks, converts mono to stereo, takes the front stereo channels on multichannel files, counts decoded source frames for position, and resets DSP state after seek.

## Phase 2 checkpoint — 2026-10-19 (local Windows validation)
- Added `crates/audio-core`: six-band RBJ EQ, tempo/pitch processing via WSOLA and linear resampling, decoder-backed local playback for MP3/FLAC/Vorbis/WAV/AAC/ALAC/AIFF, stereo output, seek/reset, device-backed Rodio player, volume/pause/resume/stop/seek state and a 48-band dual-window FFT spectrum analyzer. Added a two-sink gain-ramped local-track crossfade, an ordered file queue, next-track transition, explicit next decoder preload with reuse, automatic queue advance, and output-rate conversion utility with continuity/reset tests.
- Wired player commands into Tauri and React state/dock. The desktop shell accepts a local path and drag-and-drop audio files; native file picker has not yet been integrated. Queue/preload scheduling, next and crossfade are wired; live EQ retuning is implemented in the current uncommitted checkpoint.
- Earlier `cargo test --offline --workspace`: passed (18 audio-core tests and 1 CLI test); the latest post-pause-fix result is recorded in the handoff clarification below.
- `cargo clippy --offline --workspace --all-targets -- -D warnings`: passed after the latest Rust changes.
- `cargo fmt --all -- --check`: passed after the latest Rust changes.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd test`: passed (2 frontend unit tests).
- `npm.cmd run test:e2e`: passed (1 shell and preferences persistence scenario).
- `npm.cmd run desktop:build -- --no-bundle`: passed after the audio engine, spectrum worker, and queue integration; produced `resonance.exe` under `%TEMP%\resonance-target\release`.
- Build artifacts are directed to `%TEMP%\resonance-target` because sandbox denies writes to the sibling `target` folder. Cargo/rustfmt permission prompts were accepted by the automatic reviewer for operations scoped to the migration repo.
- `SpectrumAnalyzer` follows the source dual FFT sizes, stereo complex packing, windowing, reference gain, compression, smoothing and logarithmic band-bin mapping, with an additional test for bass/main boundary bins.
- Deviation: no `@tauri-apps/plugin-dialog` package was cached and network access failed; the shell currently uses a temporary path-entry prompt plus drag-and-drop. Replace the prompt with the native picker when package access is available.
- Live EQ/tempo retuning is connected from Tauri to the shared DSP processor; user-facing equalizer controls are pending the settings design phase.
- Phase 2 remains in progress: verify remaining codec formats with real fixtures, broader spectrum behavior comparison against legacy tests and device-backed playback/crossfade. Previous-track navigation and queue editing UI remain for later shell/library phases. The shared analyzer queue is non-blocking and drops when full; UI polls it at 4 Hz. Automatic queue advancement is checked every 250 ms in Tauri. Rodio owns output-rate adaptation at runtime; the separate converter utility is tested at irregular 44.1→48 kHz block boundaries.

## Remote branches
- codex/resonance-tauri-migration: correct migration repository branch, pushed at cec46e7.
- codex/resonance-tauri-rewrite: unintended branch created in the legacy repository from its unchanged main head during a misdirected Git command. No files or commits were added to it.

## Phase 2 handoff clarification — 2026-10-19
- `TODO_NEXT.md` is the current task list and handoff; it supersedes earlier generic Next bullets above.
- The most recent changes add shared DSP retuning and a tested rate-conversion utility. A review also removed a pause observer that could incorrectly signal end-of-file; Rodio sink pause/resume now owns pause behavior.
- After the pause correction, `cargo test --offline --workspace` passed (18 audio-core tests plus 1 CLI test), Clippy with `-D warnings` passed, rustfmt check passed, ESLint/Vite/Vitest passed, Playwright passed (1 scenario), `cargo build --offline --release -p resonance` passed, and `npm.cmd run desktop:build -- --no-bundle` passed with `resonance.exe` under `%TEMP%\resonance-target\release`.
- Phase 2 remains open: actual device verification, real fixture coverage for non-WAV decoders, fuller spectrum comparisons, UI for queue/EQ and native file picking remain outstanding.
- Current correct working branch is `codex/resonance-tauri-migration` in the sibling target repository. There are two prior local commits ahead of origin plus this checkpoint to commit. GitHub push previously failed because `github.com:443` was unreachable; retry after commit.

## Phase 2 continuation — 2026-10-19 (seek and spectrum parity)
- Fixed local seek accounting: decoded source frames now start at zero after a seek while the seek offset is stored once as the base position; requests beyond known duration clamp to the end. Added generated-WAV tests for repeated seek positions and duration clamp.
- Fixed local decoder read-ahead to preserve the legacy 4096-scalar-sample block size across source channel counts instead of decoding 4096 frames. Added a test asserting bounded stereo read-ahead.
- Added spectrum input compensation for provider output volume, keeping visual levels independent from playback volume. Tests cover volume invariance, tone band localization, phase-inverted stereo, clear/invalid input and release to silence.
- Ported the legacy analyzer's dropped-packet timing behavior: worker chunks carry monotonically increasing sequence numbers, including dropped queue submissions. The analyzer shifts old FFT history out and advances release time when chunks were lost. Tests cover sequence gaps and rapid decay after skipped hops.
- Verification: `cargo fmt --all -- --check`, `cargo test --offline --workspace` (27 tests: 13 audio-core unit + 8 DSP + 5 local playback + 1 CLI), `cargo clippy --offline --workspace --all-targets -- -D warnings`, `cargo build --offline --release -p resonance`, and `npm.cmd run desktop:build -- --no-bundle` all pass on Windows. Existing frontend lint/build/Vitest/Playwright results remain valid because this checkpoint changes only Rust and migration documentation.
- Phase 2 remains open: local output-device playback has not been exercised; real decoder fixtures beyond generated WAV are unavailable; native file picker and UI playback controls remain incomplete; porting of the remaining legacy spectrum scenarios is ongoing.

## Phase 3 reconnaissance — 2026-10-19
- Completed full reads of `LocalLibrary.h/.cpp`, `CollectionModels.h/.cpp`, `SongListModel.h/.cpp`, the legacy local tag bridge and local library/cover/session/settings test sources before implementation.
- `PHASE3_PLAN.md` records the observed source/cache rules, metadata fallbacks, playlist copy semantics, tag editing and the staged target implementation.
- This reconnaissance status is superseded by the Phase 3.1 scanner implementation below.
- Phase 2 checkpoint `7ddca52` is committed and pushed to `origin/codex/resonance-tauri-migration`; the working tree was clean immediately after push.

## Phase 3.1 checkpoint candidate — 2026-10-19 (scanner and local song view)
- Added the `crates/library` workspace crate with `Song`/`LocalTags`, Lofty-based local tag/duration reader, supported-extension validation, canonical source hierarchy and deduplication, recursive hidden-file-excluding scan, natural album/track sorting, filename/folder/Unknown Artist fallbacks, size+mtime cache, atomic cache/source-list persistence, and stable song occurrence IDs. Invalid cache JSON is ignored; reader errors cache empty metadata but the audio file remains visible.
- Tauri restores persisted local sources on startup, loads the cached records, and runs a blocking-thread scan with Lofty; scan completion is emitted as `local-library-scanned`. Commands expose sources/songs and add+scan sources.
- React Saved songs route now renders scanned local tracks and plays a chosen row. Empty state gives a file action. E2E expects the new empty-state copy.
- Tests: 7 library tests cover source hierarchy, hidden/unsupported files, natural sorting, scan cache reuse and invalidation, failed tag memoization, corrupt cache recovery, source persistence, stable identity, untagged file visibility and legacy display fallbacks.
- Verification on Windows: `cargo fmt --all -- --check`, `cargo test --offline --workspace` (34: 13 audio-core unit + 8 DSP + 5 local playback + 7 library + 1 CLI), strict workspace Clippy, `npm run lint`, `npm run build`, Vitest (2), Playwright (1) and `npm run desktop:build -- --no-bundle` all pass; Tauri executable is in `%TEMP%\resonance-target\release\resonance.exe`.
- Phase 3 remains in progress. Source selection/removal/rescan controls, UI scan progress, complete embedded/folder artwork extraction and tag writing, playlist storage/copy semantics and playlist UI are not implemented. The current file-open prompt is separate from managing library folders.

## Phase 3.2 checkpoint candidate - 2026-10-19 (source management)
- Added source add/remove/rescan actions in Saved Songs and synchronized source paths with the legacy Tauri Store setting `localMusicSources`; startup migrates sources between Store and the Rust persisted source list without allowing initial empty UI state to erase existing settings.
- Added typed status and an atomic scan flag, asynchronous blocking-thread rescans for source changes, and scan-complete events. Frontend song fields now match the camelCase Rust serialization.
- Updated the shell e2e assertion for the two identical Add file or folder actions.
- Verification: workspace check and tests pass (34 tests); strict Clippy and rustfmt check pass; ESLint/build and Vitest pass (2 tests); Playwright passes (1 scenario).
- Phase 3 remains open: cancel/stale-scan handling, native picker, robust metadata/artwork editing and playlist storage/copy semantics still need implementation. The full-path prompt is a temporary path-entry interaction.

## Phase 3.3 working checkpoint - 2026-10-19 (initial local playlists)
- Added `LocalPlaylistStore` with versioned atomic JSON persistence, playlist create/update/delete, local track copies, `.lrc` and adjacent image companions, song order operations, and collection of unheld playlist folders. A Windows canonical-path comparison issue was found by the test and fixed; a track referenced after reopening remains on disk until its playlist is deleted.
- Added Tauri commands to list/create/add/delete playlists and connected the React Playlists route to create, browse, play and add indexed local songs. Updated the shell e2e assertion.
- Verification: workspace tests pass (35 total: 13 audio-core + 8 DSP + 5 local playback + 8 library + 1 CLI); workspace check, strict Clippy, rustfmt, ESLint, Vite build, Vitest (2) and Playwright (1) pass.
- Not yet a Phase 3 completion checkpoint: repeated source tracks currently receive separate copies, occurrence identity/keying needs refinement, legacy playlist JSON migration and artwork editing are missing, and remove/reorder/update need complete frontend commands and user flows. Desktop Tauri packaging build must be rerun before commit.
- Follow-up within Phase 3.3: added playlist track removal and reorder Tauri commands/UI, and unique IDs for copied playlist occurrences so repeated entries render as distinct React rows. The full Windows Tauri no-bundle build passed and produced `%TEMP%\resonance-target\release\resonance.exe`.
