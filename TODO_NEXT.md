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
- Phase 2 checkpoint `7ddca52` is committed and pushed. It fixed seek accounting/read-ahead and added volume-compensated spectrum analysis with dropped-worker-chunk timing.
- Current Phase 3.1 work adds the `library` crate (Lofty tags, persistent cache/source list, recursive scanner and Local Songs UI). Workspace currently passes 34 Rust tests (13 audio-core unit, 8 DSP, 5 local playback, 7 library, 1 CLI), strict Clippy/fmt, frontend lint/build/Vitest (2), Playwright (1) and Windows Tauri desktop build.

## Exact stopping point

The working tree contains an uncommitted Phase 3.1 scanner/tag reader and Local Songs UI. Cache reuse follows file size + modification time; sources and cache are atomically persisted; source hierarchy, hidden files, natural sorting, tag fallbacks and stable song identity have tests. Tauri startup restores sources and scans off the UI thread. The desktop UI can list and play scanned local songs.

The native file picker is not integrated. The current shell has drag-and-drop plus a temporary full-path prompt because the Tauri dialog plugin was absent from local caches and package-registry network access failed. The original repository contains no audio fixtures, so only generated WAV decoding and seeking are directly fixture-verified; verify the remaining decoder formats when fixtures or an encoder are available.

## Next actions, in order

1. Continue Phase 2 parity as tooling/device/fixtures permit, keeping open gaps explicit.
2. Update `PHASE3_PLAN.md`, the migration log and parity ledger; commit/push current scanner and UI checkpoint.
3. Complete Phase 3.2 source settings parity and robust async/stale scan semantics, including add/remove/rescan UI and real `read_local_tags` coverage.
4. Phase 3.3–3.4: implement copy-backed local playlists, metadata/tag and artwork editing; wire commands/events/UI; verify and checkpoint.
5. Continue in order through Phases 4–11, updating this task list/log/checklist and committing each verified checkpoint. Do not claim overall completion until the Phase 11 audit passes.

## Known issues and limits

- GitHub push access has worked for earlier commits, but a previous attempt failed due to network reachability; retry push after this checkpoint.
- Local output device runtime and non-WAV fixture coverage remain unverified.
- Only Windows is locally available. macOS/Linux build and runtime checks must be provided by CI before claiming cross-platform verification.
- Local queue editing UI and previous-track behavior are not complete.
- User-facing EQ controls belong to the later design/settings phase; Rust/Tauri commands already support live updates.
- The prompt states 10-band EQ; legacy code establishes six bands. Preserve source behavior unless new evidence changes that conclusion.
