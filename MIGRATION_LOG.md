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
- GitHub CLI is present but its saved github.com token is invalid (`gh auth status`); therefore remote branch creation/push cannot presently be authenticated.
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
1. Finish Phase 0: read relevant old implementations in full and refine behavioral checklist/mapping.
2. Phase 1: implement Tauri skeleton and validate local toolchain.
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
- Limit: host is Windows; macOS-only menu branch and Linux/macOS bundle jobs remain unexecuted until CI is available. GitHub token remains invalid, so no remote workflow has run.
- UI smoke test found and fixed a conditional React hook bug and literal Unicode escape rendering. Vitest excludes Playwright specs to keep runners separate.

## Next
1. Continue Phase 0 source review as each subsystem is prepared for porting; read each original module in full before implementing its replacement.
2. Phase 2: port local audio decode/output, playback, shaping and spectrum into `crates/audio-core` with tests derived from `spotify-core/src` and legacy playback tests.