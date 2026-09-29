# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop-only product, shipped as a Tauri 2 shell (Windows, macOS, Linux) around a React renderer. Recorded as `web` because the design language is web and there is no per-OS native adaptation; the native shell is a distribution and capability boundary, not a visual one. No mobile app, no browser product — `npm run vite` is a development convenience, not a supported surface.

## Users

Anyone who downloads the application. The user signs in with their own SoundCloud account, so the library, likes, playlists, listening history and profile they see are their own real data, not a demo.

Confirmed: this is distributed publicly, not a personal tool. The repository is MIT-licensed and public, releases are signed and published through GitHub Actions for three platforms, and the app ships an in-app updater. Design and copy work should therefore assume a stranger is the first person to see a given screen.

**Unconfirmed — do not treat as settled:** whether karaoke lyrics (LRCLIB-sourced) are the product's center of gravity or an adjacent feature. The owner was asked and did not answer. The lyrics work is substantial and receives dedicated commits and planning documents, which is weak evidence either way. Confirm before treating any surface as secondary.

## Product Purpose

A desktop SoundCloud client that is better to live in than the web player: it owns the account locally, keeps playback, library and lyrics in one window, and never routes the user through a browser tab or an ad surface.

Success means a user opens the app, connects their SoundCloud account, and their real library, likes and playlists are immediately browsable and playable — with lyrics and personalisation as durable local settings.

## Positioning

The user's own SoundCloud account, on their own machine, in one persistent window that behaves like software rather than a website. Tokens are stored locally with `0600` permissions and never leave the Go sidecar, never reach `localStorage`, and the app needs no account of its own — there is no BetterSoundCloud user, only the user's SoundCloud identity.

The differentiator against the official SoundCloud desktop app is the *use*: lyrics, a local library view, and personalisation (accent color, compact mode, background image) that persists offline.

## Operating Context

- **Shipped as a native desktop app on three OSes.** Built per-OS: macOS bundles must be built on macOS, Windows on Windows. The app self-updates through Tauri's updater, so a released version is a frozen artifact users keep for months — regressions are not hot-fixable.
- **Onboarding requires a manual step users cannot guess.** Full OAuth is not connected. The user pastes an access token copied from the `Authorization: OAuth …` header of any SoundCloud request. This is the first screen every new user sees. *The owner has not stated whether this is accepted for public release or a known debt.*
- **The default library profile is not the mainstream one.** The reference lyrics dataset (`scripts/lyrics-sample.txt`, 41 tracks) is Russian phonk, slowed/reverb versions, internet rap, and unreleased tracks. Lyrics coverage is measurably hard on exactly this profile, and `docs/LYRICS_COVERAGE.md` exists to manage that. Assume users' libraries skew the same way; do not tune features to English pop hits.
- **Backend is a local Go sidecar, not a server.** No network server, no database. The renderer talks line-delimited JSON-RPC over stdin/stdout; the sidecar owns settings, auth and SoundCloud calls. Development has a `npm run backend` REPL for poking the same protocol without Tauri.
- **Dev and production installs are separate applications** with separate identifiers and data directories, and can run side by side.

## Capabilities and Constraints

**Confirmed functionality:** SoundCloud account connection by access token; home with mixed selections; track search; own library (likes and playlists) with pagination; track detail pages; artist profiles and their track lists; artist and user follow lists; playback with previous/next, shuffle-over-likes, repeat-one, seek, volume, and queue; like/unlike round-tripping to SoundCloud; lyrics lookup with a fullscreen lyrics view; user profile, history and playlists; settings for accent color, compact mode, startup volume, background image and blur; in-app updater.

**Constraints future work must respect:**

- **Architecture is a hard boundary, documented in `docs/ARCHITECTURE.md`.** React components take props and use only `domain/models.ts` types; `appGateway.ts` is the only place in the renderer that knows backend DTOs and RPC method names; `desktop.ts` only spawns the sidecar and speaks JSON-RPC; Go knows nothing about components, pages or design. New features arrive as narrow RPC methods plus gateway operations. Do not bypass this to move faster.
- **Security posture is deliberate.** The Tauri capability grants permission to run the configured sidecar binary only, with no arbitrary arguments and no system access. Tokens are validated via `GET /me`, stored `0600` in the user config directory via atomic write, and never returned to the renderer. A rejected token is deleted; a network error preserves the cached profile. Preserve this.
- **Terminology used in-product** (Russian UI, do not re-translate casually): медиатека (library), лайки (likes), плейлисты (playlists), очередь (queue), треки (tracks), лента/история прослушивания (listening history), исполнитель (artist/performer), обзор (home/overview).
- **Current known debts, stated by the owner in the repo docs:** full OAuth login is not connected (file-based token storage is explicitly described as an interim solution pending a system credential store and OAuth 2.1 + PKCE); SoundCloud host and data directory are overridable via `BSC_SOUNDCLOUD_API_BASE` and `BSC_DATA_DIR` for development.

**Undecided product facts — record as open, do not resolve silently:** whether the access-token onboarding is acceptable for public release; whether lyrics is a primary or secondary feature; the system's target conformance level (no stated target beyond implied WCAG AA).

## Brand Commitments

- **Name:** BetterSoundCloud.
- **Language: Russian only, confirmed as a standing commitment.** All user-facing copy, including accessible names and error messages, is written in Russian. Future work preserves this; do not introduce an i18n framework or English strings.
- **Voice:** the existing UI uses plain, direct, non-marketing Russian — "Выйти", "Повторить", "Ничего не найдено", "Показать больше". No exclamation marks, no persuasion, no product claims. Preserve the register; `clarify` work should tighten it, never brighten it.
- **Identity is user-owned, not imposed.** Accent color, background image, compact mode and volume are all user-set, and the interface recedes behind them. New design work must not hardcode a look that fights a user-chosen accent or background.
- **Licensing:** MIT, © 2026 BohdanKrakoviatskyi.

## Evidence on Hand

- **Real user data is the content.** The app renders a real SoundCloud account — real tracks, artwork, likes, playlists, follower counts. No lorem ipsum, no placeholder personas.
- **Lyrics dataset:** `scripts/lyrics-sample.txt` — 41 tracks exported from a real library, the reference corpus for coverage measurement. `scripts/lyrics-coverage.mjs` is the measurement tool. `docs/LYRICS_COVERAGE.md` holds the diagnosis and the sequencing plan.
- **Shipped background presets (real, named, licensed-by-author):** `public/025bef26455d0dd81b480740debab6aa.jpg` ("Синий нуар"), `public/24a15fa7c44039c32c08754e5f88b0ad.jpg` ("Ночной пейзаж"), `public/ddf5ad34da8ad9ac8cd399c48cd418f2.jpg` ("Lovers Rock"), `public/kira.jpg` ("Дождливый город"), `public/sigara.jpg` ("Blue hour"), `public/сау.jpg` ("Красное яблоко"). Note the mix of Russian and English names is intentional to the owner, not an error. `public/auth_bg.mp4` is the auth screen backdrop.
- **Architecture and integration documentation:** `docs/ARCHITECTURE.md`, `docs/SOUNDCLOUD_INTEGRATION.md` (contains the target OAuth scheme), `docs/LYRICS_COVERAGE.md`.
- **Automated test coverage exists on the backend only:** `backend/cmd/local-api/main_test.go` (auth against a stub SoundCloud server, no network), plus `npm test` for scripts. There is no automated UI test suite.

**Absences that future work must not fabricate:** there are no user testimonials, no download or adoption numbers, no review quotes, no usage analytics, no stated pricing or business model (the project is MIT and free), no third-party press or coverage, and no competitive benchmark. Any future surface must be built from product truth, not from invented social proof.

## Product Principles

1. **The user's own account is the only content.** Every list, count, image and name comes from the signed-in user's real SoundCloud data. Never mock it, never pad it, never show an empty state that pretends content exists.
2. **Software, not a website.** One persistent desktop window, native expectations, a session that persists. Behavior that belongs in an OS app — keyboard operation, focus management, real dialogs — is not optional garnish.
3. **The user's choices win over the app's taste.** Accent, background, compact mode and volume are the user's. The interface's job is to make all of them look intentional, not to steer the user back toward a default.
4. **Fix the local-first posture or don't touch it.** Tokens, settings and the backend stay on the machine, and the sidecar boundary is not a convenience to be refactored away for speed.
5. **Design for this library, not the average one.** The reference corpus is phonk, slowed versions, internet rap and unreleased tracks. Russian-only and that taste profile are the product's center of gravity, not edge cases to be smoothed away.

## Accessibility & Inclusion

No conformance target has been stated by the owner — recorded as open. The baseline to hold going forward is WCAG 2.2 AA, which the interface largely meets on semantics: interactive elements are native buttons, all imagery carries `alt`, icon-only controls carry Russian accessible names, and async regions announce through live regions. The known gaps are interaction-layer rather than markup-layer, and are listed in the current audit: settings toggles have no visible keyboard focus, the search results listbox is not keyboard-operable, and there is no focus management on page navigation.

Russian-only has an accessibility consequence worth holding onto: text expansion and screen-reader pronunciation must be validated in Russian, and Latin-only assumptions (type scale tuned for English, uppercase tracking) do not transfer.
