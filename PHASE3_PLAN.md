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
2. **Implemented, verified (Phase 3.2):** source settings integration with the legacy `localMusicSources` Store key, add/remove/rescan controls, scan-state reporting, async blocking-thread scanning and migration between the settings store and Rust cache. Scan status is now set/reset consistently by source set/add/remove and rescan operations. Persisted add/remove/restore source changes roll back in-memory state if JSON persistence fails. The UI currently accepts paths through a prompt; native folder picking remains pending. Stale scan generation/cancellation still needs implementation before this slice is fully closed.
3. **In progress:** durable playlist metadata/order, name/description editing, owned JPEG/PNG cover replacement, copy-on-add, companion files, reorder/remove/delete and garbage collection are implemented in `crates/library/src/playlists.rs`; Tauri commands and React playlist browse/edit flows are wired. Repeated unchanged source tracks reuse a stored copy while retaining distinct occurrence IDs; changed sources receive a new managed copy while old copies remain until their occurrences are removed. Track and cover cleanup preserves held files. Create/add mutations now roll back their records on copy/persist failure and best-effort collect copies created by a failed operation. Version-1 legacy JSON migration copies reachable tracks, LRC companions and valid playlist covers, preserves order/duplicate occurrences and missing-file URIs, then safely replaces the old records with backup/restore on rename failure. Broader command/UI parity tests remain.
4. **Partially implemented (Phase 3.4):** Lofty tag writing, indexed local and playlist-copy Tauri command, Saved Songs/playlist edit forms, embedded/folder cover extraction and JPEG/PNG cover replacement UI are implemented. Playlist copy edits require an exact URI in the managed store and canonical path under its copy directory; repeated occurrences are refreshed while preserving their identities. Generated WAV tests cover field writes/clears and artwork; Vitest covers selected image bytes. Broader local editor parity tests remain.
5. Remaining: broaden `tst_local`, `tst_covers`, `tst_session`, `tst_settings` parity and Tauri/UI command scenarios; verify source scan cancellation/stale results and native folder picking; then compare old/new behavior and update the checklist.

Do not mark Phase 3 green until each slice is implemented and tests pass. Record deviations and environment limitations in `MIGRATION_LOG.md`.
