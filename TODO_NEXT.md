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
- Verification on Windows: current audio-core suite has 13 unit + 8 DSP + 5 playback tests, plus 1 Tauri CLI test (27 total). Rust fmt, strict Clippy, release Rust build and Tauri desktop build have passed for this checkpoint. Prior frontend ESLint, TypeScript/Vite build, Vitest (2) and Playwright (1) checks passed; no frontend code changed in the current audio-core checkpoint.
- The current uncommitted checkpoint fixes seek position accounting and bounded read-ahead; adds provider-volume compensation and spectrum tests; and makes the spectrum worker account for dropped chunks so FFT history and release timing advance correctly.

## Exact stopping point

The working tree contains Phase 2 corrections in `local.rs`, `spectrum.rs`, `spectrum_worker.rs` and playback tests. Seek now counts source frames once and clamps past-duration positions; decoder read-ahead respects the legacy 4096-scalar block size; the analyzer compensates provider output gain and ages FFT/release state when its bounded worker queue drops chunks. The Rust and Tauri builds and strict checks pass. Commit and push this checkpoint, then continue Phase 2 parity.

The native file picker is not integrated. The current shell has drag-and-drop plus a temporary full-path prompt because the Tauri dialog plugin was absent from local caches and package-registry network access failed. The original repository contains no audio fixtures, so only generated WAV decoding and seeking are directly fixture-verified; verify the remaining decoder formats when fixtures or an encoder are available.

## Next actions, in order

1. Complete strict Rust workspace checks and verify the Windows Tauri executable.
2. Update this handoff, the migration log and parity ledger, commit the Phase 2 checkpoint on `codex/resonance-tauri-migration`, and push it to `origin`.
3. Continue Phase 2: investigate native file picker dependency, add real codec fixtures if available locally, test output-device handling, port remaining spectrum signal tests and playback controls. Keep Phase 2 open until evidence supports completion.
4. Proceed to Phase 3 by fully reading the legacy library sources, then implement scanning/indexing, metadata/cover editing, playlist operations, settings/session migration and tests.
5. Continue in order through Phases 4–11, updating this task list/log/checklist and committing each verified checkpoint. Do not claim overall completion until the Phase 11 audit passes.

## Known issues and limits

- GitHub push access has worked for earlier commits, but a previous attempt failed due to network reachability; retry push after this checkpoint.
- Local output device runtime and non-WAV fixture coverage remain unverified.
- Only Windows is locally available. macOS/Linux build and runtime checks must be provided by CI before claiming cross-platform verification.
- Local queue editing UI and previous-track behavior are not complete.
- User-facing EQ controls belong to the later design/settings phase; Rust/Tauri commands already support live updates.
- The prompt states 10-band EQ; legacy code establishes six bands. Preserve source behavior unless new evidence changes that conclusion.
