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
- Added `crates/audio-core`: six-band RBJ EQ, tempo/pitch processing via WSOLA and linear resampling, decoder-backed local playback for MP3/FLAC/Vorbis/WAV/AAC/ALAC/AIFF, stereo output, seek/reset, device-backed Rodio player, volume/pause/resume/stop/seek state and a 48-band dual-window FFT spectrum analyzer. Added a two-sink gain-ramped local-track crossfade and source-frame position reporting.
- Wired player commands into Tauri and React state/dock. The desktop shell accepts a local path and drag-and-drop audio files; native file picker has not yet been integrated. Crossfade is available for explicit crossfade transitions; playlist queue/preload scheduling and live EQ-retuning remain.
- `cargo test --offline --workspace`: passed (17 audio-core tests and 1 CLI test).
- `cargo clippy --offline --workspace --all-targets -- -D warnings`: passed after the latest Rust changes.
- `cargo fmt --all -- --check`: passed after the latest Rust changes.
- `npm.cmd run lint`, `npm.cmd run build`, and `npm.cmd test`: passed (2 frontend unit tests).
- `npm.cmd run test:e2e`: passed (1 shell and preferences persistence scenario).
- `npm.cmd run desktop:build -- --no-bundle`: passed after the audio engine, spectrum worker, and queue integration; produced `resonance.exe` under `%TEMP%\resonance-target\release`.
- Build artifacts are directed to `%TEMP%\resonance-target` because sandbox denies writes to the sibling `target` folder. Cargo/rustfmt permission prompts were accepted by the automatic reviewer for operations scoped to the migration repo.
- `SpectrumAnalyzer` follows the source dual FFT sizes, stereo complex packing, windowing, reference gain, compression, smoothing and logarithmic band-bin mapping, with an additional test for bass/main boundary bins.
- Deviation: no `@tauri-apps/plugin-dialog` package was cached and network access failed; the shell currently uses path entry + drag-and-drop. Replace with a native file picker when package access is available.
- Phase 2 remains in progress: output-device rate conversion parity, broader spectrum behavior comparison against legacy tests, full playback command/device tests and completion validation remain. Local path queue, explicit decoder preload with reuse, next/manual and automatic crossfade transitions are implemented. Previous-track navigation and queue editing UI remain for later shell/library phases. The shared analyzer queue is non-blocking and drops when full; UI polls it at 4 Hz. Automatic queue advancement is checked every 250 ms in Tauri.

## Remote branches
- codex/resonance-tauri-migration: correct migration repository branch, pushed at cec46e7.
- codex/resonance-tauri-rewrite: unintended branch created in the legacy repository from its unchanged main head during a misdirected Git command. No files or commits were added to it.
