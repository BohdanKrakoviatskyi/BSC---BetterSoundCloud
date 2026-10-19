# Migration TODO and handoff

Updated: 2026-10-19  
Branch: `codex/resonance-tauri-migration`  
Working directory: `C:\Users\krako\Desktop\resonance-tauri`

## Completed

- Phase 0 reconnaissance baseline, `PARITY_CHECKLIST.md`, old-to-new module map, risk notes and migration log.
- Phase 1 Tauri 2 + React 19 + TypeScript + Vite shell, custom window controls, single-instance/CLI parsing, preferences, CI scaffolding and local build checks.
- Phase 2 audio-core implementation in progress:
  - Six-band EQ and tempo/pitch DSP port based on the old implementation. The source code uses six bands even though the prompt overview says ten.
  - Local file decoders configured for MP3, FLAC, Vorbis, WAV, AAC/MP4, ALAC and AIFF.
  - Stereo source adapter, seek/reset, source duration/position, device-backed Rodio player, volume and pause/resume/stop.
  - Ordered local path queue, explicit preload with decoder reuse, next-track transitions, gain-ramped crossfade and automatic advance every 250 ms.
  - 48-band dual-FFT spectrum analyzer on a bounded, non-blocking worker queue; UI polls levels through Tauri.
  - Shared DSP updates can retune the current track's EQ/tempo.
  - Separate 44.1 kHz to 48 kHz linear-rate-converter utility with irregular-block continuity and reset tests. Rodio's output mixer performs the actual device-rate conversion at runtime.
  - Pause handling uses Rodio's sink pause, so the decoder source remains alive for resume.
- Verification performed after the pause-source fix on Windows: `cargo test --offline --workspace` passed (18 audio-core tests and 1 CLI test), Clippy with warnings denied passed, rustfmt check passed, ESLint passed, TypeScript/Vite production build passed, Vitest passed (2 tests), Playwright passed (1 shell/preferences flow), `cargo build --offline --release -p resonance` passed, and `npm.cmd run desktop:build -- --no-bundle` passed with `resonance.exe` under `%TEMP%\resonance-target\release`.
- Phase 2 work is committed locally in earlier commits; the latest two local commits are ahead of origin because GitHub networking failed on push.

## Exact stopping point

The working tree contains uncommitted `SharedDsp` live-retuning and `RateConverter` implementation changes, plus the pause-source correction and this handoff document. Full unit, lint, frontend build, e2e, strict Clippy/fmt, optimized Rust release build, and Tauri desktop build checks have now passed. Commit these changes and push before starting a new phase.

The native file picker is not integrated. The current shell has drag-and-drop plus a temporary full-path prompt because the Tauri dialog plugin was absent from local caches and package-registry network access failed. The original repository contains no audio fixtures, so only generated WAV decoding and seeking are directly fixture-verified; verify the remaining decoder formats when fixtures or an encoder are available.

## Next actions, in order

1. Run `cargo fmt --all -- --check`, `cargo test --offline --workspace`, `cargo clippy --offline --workspace --all-targets -- -D warnings`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd test`, `npm.cmd run test:e2e`, and `npm.cmd run desktop:build -- --no-bundle` using `%TEMP%\resonance-target` for Cargo output.
2. Review `git diff`, update this file, `MIGRATION_LOG.md` and `PARITY_CHECKLIST.md`; commit the current Phase 2 checkpoint on `codex/resonance-tauri-migration`.
3. Push `codex/resonance-tauri-migration` to `origin`. If GitHub is still unreachable, keep the local commits and record the failed push and error.
4. Finish Phase 2 parity: native file picker when dependency access is available, real decoder fixtures for all advertised formats, output-device/playback verification, spectrum comparison against remaining legacy spectrum tests, and playback control coverage. Do not mark Phase 2 complete until its checklist entries and validations are satisfied.
5. Proceed to Phase 3 local library: fully read the corresponding old library, scan/index files, metadata/cover editor, playlist operations, settings/session migration and tests.
6. Continue in order through Phases 4–11 in `resonance-tauri-rewrite-prompt.md`; keep `PARITY_CHECKLIST.md` as the completion source of truth, record decisions/checkpoints here and in `MIGRATION_LOG.md`, and commit each green phase.

## Known issues and limits

- GitHub network access failed in this environment; previous push did not reach GitHub.
- `gh auth status` previously reported an invalid token; Git Credential Manager had succeeded on earlier pushes, so retry ordinary Git push after network availability returns.
- Only Windows is locally available. macOS/Linux build and runtime checks must be provided by CI before claiming cross-platform verification.
- Local queue editing UI and previous-track behavior are not complete.
- User-facing EQ controls belong to the later design/settings phase; Rust/Tauri commands already support live updates.
- The prompt states 10-band EQ; legacy code establishes six bands. Preserve source behavior unless new evidence changes that conclusion.
