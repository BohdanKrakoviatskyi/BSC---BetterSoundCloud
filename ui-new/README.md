# BetterSoundCloud

A local desktop music client with search, a library, playlists, listening history, and a playback queue. The desktop shell uses Tauri 2; the interface uses plain HTML, CSS, and JavaScript.

## Frontend location

The complete frontend is in `src/renderer/`:

- `src/renderer/index.html` - app entry point and page structure
- `src/renderer/styles.css` - layout, theme, and responsive styles
- `src/renderer/app.js` - interface rendering and client-side behavior

Tauri and Rust configuration and source files are in `src-tauri/`.

## Requirements

- Node.js and npm
- Rust with the MSVC toolchain to build on Windows
- Microsoft C++ Build Tools and WebView2 Runtime on Windows

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform-specific requirements.

## Install and run

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
```

`package.json` and `package-lock.json` define the npm scripts and dependencies. `LICENSE` contains the project license. Build artifacts and local dependencies are excluded from the repository.