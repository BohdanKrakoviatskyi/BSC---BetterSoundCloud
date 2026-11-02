# Provider and UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Spotify and confirmed-dead Qt/C++ code, preserve the active Go sidecar, improve source logos, responsive immersive lyrics, sidebar layout, and recommendation shuffle.

**Architecture:** Keep the React/Vite + Tauri app and its Go `api/` sidecar. Remove Spotify integrations at frontend and sidecar boundaries. Treat Qt/C++ sources as removable only after verifying they are not part of active build/runtime; keep shared files and all sidecar dependencies.

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2, CSS, Go.

**Spec:** `docs/superpowers/specs/2026-11-02-provider-ui-cleanup-design.md`

## Global Constraints

- Preserve SoundCloud and YouTube Music behavior and their Go sidecar RPCs.
- Remove Spotify from the shipped application and active source, not just hide its UI.
- Delete Qt/C++ files only when unreferenced by active build/runtime.
- Test logic changes before implementation; do not add a test framework when existing Node/Go tooling suffices.
- Keep Appearance and Music providers pinned below the independently scrollable sidebar list.

---

### Task 1: Audit API directory and Spotify dependency map

**Files:**
- Inspect: `api/*`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src/lib/sidecar.ts`, `package.json`, `README.md`
- Modify: none

**Interfaces:**
- Produces: a verified list of active sidecar files and Qt/C++-only files; dependency/call map of Spotify references.

- [x] **Step 1: Trace active sidecar execution and build path**

Inspect the Tauri external binary declaration, sidecar launch call, repository build scripts, Go module, and references to sidecar RPCs. Search all tracked files for C++/Qt source references and Spotify RPC usage.

- [x] **Step 2: Run the baseline checks**

Run `npm run build` and `go test ./...` from `api/`. Record any pre-existing failures before editing.

- [x] **Step 3: Establish deletion boundary**

Delete no C++ source unless no active build or runtime reference exists. Preserve Go files/assets required by SoundCloud and YouTube Music. If evidence shows Qt code is independently buildable/used, stop deletion of that part and report the finding.

### Task 2: Remove Spotify from frontend and Go sidecar

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/providers-api.ts`
- Modify: `src/lib/provider-player.ts`
- Modify: `src/components/ProviderEmbed.tsx`
- Modify: `src/components/TrackList.tsx`
- Modify: `src/pages/Providers.tsx`
- Modify: `src/state/player.ts`
- Modify: `api/main.go`, Spotify-specific Go files identified in Task 1, `api/go.mod` / `api/go.sum` only if Spotify-only dependencies exist
- Delete: Spotify-only assets/source files identified in Task 1; confirmed-unused Qt/C++ tree
- Test: relevant existing frontend and Go tests

**Interfaces:**
- Consumes: Task 1 audit.
- Produces: only SoundCloud and YouTube Music provider source/auth/search/playback APIs in active code.

- [x] **Step 1: Add/update a minimal regression check**

Add a small Node test or Go test for the Spotify-free provider/source behavior at the layer with an existing test runner; ensure it fails against the current integration. Avoid tests that merely grep implementation text.

- [x] **Step 2: Run the focused test and verify the expected failure**

Run the specific Node test with `node --test <test-path>` or the targeted Go test from `api/`.

- [x] **Step 3: Remove frontend Spotify branches and APIs**

Remove the Spotify source type, result mapping/search calls, OAuth UI/config/actions, embed iframe branch, and Spotify-specific playback state. Keep YouTube and SoundCloud branches intact.

- [x] **Step 4: Remove Go Spotify RPC/backend implementation**

Remove Spotify dispatch/RPC methods, auth/storage/settings fields and Spotify-only source files after tracing references. Do not remove shared HTTP, settings, lyrics, SoundCloud, or YouTube code.

- [x] **Step 5: Remove confirmed-dead Qt/C++ implementation**

Delete the disconnected Qt/C++ application files and stale Spotify C++ implementation established in Task 1. Keep Go sidecar files, module metadata and provider logos still needed by the active app.

- [x] **Step 6: Run focused tests and check for remaining active Spotify references**

Run `node --test src/lib/*.test.mjs` and `go test ./...` from `api/`; search active tracked sources for `spotify`, `Spotify`, Spotify URLs, and Spotify RPC names. Remove any remaining integration reference, while documenting historical text only if it is intentionally retained.

### Task 3: Replace provider text badges with logos

**Files:**
- Modify: `src/components/TrackList.tsx`
- Modify: `src/index.css`
- Reuse/inspect: `api/soundcloud.svg`, `api/youtube-music.svg` or existing provider logo resources

**Interfaces:**
- Consumes: Spotify-free `Track.source` type from Task 2.
- Produces: provider mark component/rendering with accessible service label.

- [x] **Step 1: Add a focused check for source mapping/accessibility if the component test infrastructure supports it**

Use the project's existing test infrastructure only; otherwise verify through build and DOM/browser inspection.

- [x] **Step 2: Render the correct local logo for each remaining source**

Replace uppercase text pills with logo marks; include an accessible label and preserve compact sizing/truncation behavior.

- [ ] **Step 3: Run build and inspect both source variants**

Run `npm run build`; verify SoundCloud and YouTube Music tracks display the correct marks.

### Task 4: Make immersive lyrics responsive to constrained windows

**Files:**
- Modify: `src/index.css`
- Inspect: `src/components/Immersive.tsx`, `src/components/Lyrics.tsx`

**Interfaces:**
- Produces: responsive presentation with no clipped critical controls in narrow or short windowed dimensions.

- [x] **Step 1: Identify current grid and lyrics overflow constraints**

Check current `.immersive`, `.imm-grid`, `.imm-left`, `.imm-cover`, `.imm-right`, `.lyrics` rules and breakpoints.

- [x] **Step 2: Implement width- and height-aware CSS**

Use bounded grid/flex sizing, `minmax(0, ...)`, viewport/container-aware cover sizing, and a short-height adaptation; preserve scroll access to lyrics and controls.

- [ ] **Step 3: Verify build and viewport cases**

Run `npm run build`; inspect regular, narrow, short, and narrow+short dimensions using available browser tooling or an explicit manual verification report.

### Task 5: Pin Appearance and Music providers at sidebar bottom

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Produces: scrollable main/sidebar playlist list and pinned bottom preferences links, with correct active route indication.

- [x] **Step 1: Restructure sidebar into a scroll region and bottom region**

Keep home/search/favorites/playlists and the indicator in the scroll area; move Appearance and Music providers to a sibling bottom container.

- [x] **Step 2: Update layout styles and indicator measurement**

Ensure the bottom area does not scroll with playlists; make route highlighting/indicator handle bottom links without incorrect offset calculations.

- [ ] **Step 3: Run build and verify collapsed/expanded/drawer variants**

Run `npm run build`; inspect long playlist list, short sidebar height, collapsed sidebar, and drawer behavior.

### Task 6: Make shuffle choose distinct, similar recommendations

**Files:**
- Modify: `src/state/player.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/providers-api.ts` only if exposing existing YouTube search capability needs an adjustment
- Test: new recommendation unit test using existing Node test setup

**Interfaces:**
- Consumes: existing SoundCloud related API and YouTube search API.
- Produces: tested candidate selection that rejects exact normalized title duplicates and irrelevant candidates, and avoids queued/disliked/current tracks.

- [x] **Step 1: Write failing tests for title duplicates and recommendation relevance**

Cover punctuation/case normalization, duplicate queue IDs, disliked candidates, unrelated artists, and a suitable different-title candidate. Keep matching helper pure and export only if needed for the test.

- [x] **Step 2: Run test and verify it fails for the expected current behavior**

Run the focused Node test with `node --test <test-path>`.

- [x] **Step 3: Implement minimal candidate normalization/filtering/ranking**

For SoundCloud related results, reject the seed, queued IDs, disliked tracks, and same normalized title. For YouTube Music, search by seed artist/title, require credible artist similarity and a distinct title, then rank/select rather than selecting the first exact-title result. Respect available duration metadata; do not invent a recommendation when no candidate qualifies.

- [x] **Step 4: Run focused test and full Go/frontend validations**

Run the recommendation test, `node --test src/lib/*.test.mjs`, `go test ./...` from `api/`, and `npm run build`.
