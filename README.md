# Resonance

Music player in Material 3 Expressive style.

## Run in development
```bash
npm install
npm run dev
```

## Run as Tauri app (development)
```bash
npm install
npx tauri dev
```

## Build
```bash
npm run build
```

## Build desktop apps (.AppImage, .exe, .dmg)

Prerequisites: [Rust](https://rustup.rs/), Tauri dependencies for your OS ([Tauri docs](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npx tauri build
```

Output:
- Linux: `src-tauri/target/release/bundle/appimage/*.AppImage`, `src-tauri/target/release/bundle/deb/*.deb`
- Windows: `src-tauri/target/release/bundle/nsis/*.exe`, `src-tauri/target/release/bundle/msi/*.msi`
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`, `src-tauri/target/release/bundle/macos/*.app`
