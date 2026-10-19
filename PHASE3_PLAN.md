# Phase 3 plan: local library

Source files reviewed in full before porting: `src/library/LocalLibrary.h/.cpp`, `src/library/CollectionModels.h/.cpp`, `src/library/SongListModel.h/.cpp`, local-file/tag bridge in `spotify-core/src/local.rs`, and `tests/tst_local.cpp`, `tests/tst_covers.cpp`, `tests/tst_session.cpp`, `tests/tst_settings.cpp`.

## Legacy behavior to preserve

- Sources are canonical local files/directories. A parent directory subsumes nested sources; unsupported extensions and nonexistent inputs are ignored.
- Recursive scans skip hidden files; music extension matching is case-insensitive. Songs sort naturally by album artist, album, disc, track, then path.
- Tag cache is keyed by path and reused only when size and modification time match. Cache updates are atomic. Missing/invalid metadata is remembered so unchanged unreadable files are not retried.
- Song display fallbacks: filename title, album folder name, album artist when artist is absent, then `Unknown Artist`.
- Locally created playlists persist metadata and ordered URIs. Tracks are copied into app storage, including matching `.lrc` and folder cover companions; identical unchanged source files reuse one stored copy. Unreferenced copies are collected.
- Tag editing is restricted to indexed local tracks, updates only supported fields, can replace/remove embedded artwork, rescans the changed entry, and retains the playback occurrence identity when visible song metadata is otherwise unchanged.
- Scans/copies/tag writes run off the UI thread, serialize overlapping operations, report completion/errors, and discard stale scans.

## Implementation slices

1. **Implemented, verified:** `crates/library` has typed `Song`/`LocalTags`, source validation/hierarchy, recursive scanner, tag-reader adapter, size+mtime atomic cache, natural sort/fallbacks, source persistence and 7 tests. Tauri restores sources and scans in a blocking worker. Saved Songs lists and plays results.
2. **Implemented, verified (Phase 3.2):** source settings integration with the legacy `localMusicSources` Store key, add/remove/rescan controls, scan-state reporting, async blocking-thread scanning and migration between the settings store and Rust cache. The UI currently accepts paths through a prompt; native folder picking remains pending. Stale scan generation/cancellation still needs implementation before this slice is fully closed.
3. Add durable playlist metadata/order, copy-on-add storage, deduplication, companion files, reorder/remove/delete and garbage collection.
4. Complete Lofty tag write, embedded/folder artwork extraction, cover editing and playlist artwork storage with tests.
5. Finish Tauri commands/events and frontend local-files/playlist UI, then run old/new parity scenarios and update checklist.

Do not mark Phase 3 green until each slice is implemented and tests pass. Record deviations and environment limitations in `MIGRATION_LOG.md`.
