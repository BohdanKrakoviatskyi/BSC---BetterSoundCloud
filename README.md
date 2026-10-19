# Resonance Tauri

Resonance is a desktop music player being migrated from Qt/QML and a mixed C++/Rust/Go backend to Tauri 2, Rust, React 19 and TypeScript. This repository is the new implementation; the original project is not copied into it.

## Requirements

- Rust stable and the MSVC C++ build tools on Windows
- Node.js 22 or newer
- Tauri 2 desktop prerequisites for the host platform (WebView2 on Windows, WebKitGTK on Linux, and Xcode command line tools on macOS)

## Develop

```powershell
npm ci
npm run desktop:dev
```

For a browser-only frontend preview, use `npm run dev`.

## Verify and build

```powershell
npm run lint
npm test
npm run test:e2e
npm run build
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
npm run desktop:build -- --no-bundle
```

The current shell supports Home, Search, Playlists, Saved songs, appearance/source preferences, single-instance launch actions, custom window controls, and error notifications. Playback and provider operations are implemented in later migration phases.