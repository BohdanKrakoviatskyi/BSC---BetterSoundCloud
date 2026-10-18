# Resonance

A high-performance, native desktop music player built with Qt 6 (QML / C++) and Rust, featuring seamless SoundCloud and Spotify integration, local music management, synchronized karaoke-style lyrics, dynamic spectrum visualizers, custom background wallpapers (images, GIFs, videos), and automated updates.

---

## Features

- **SoundCloud & Spotify Integration**:
  - Full SoundCloud streaming and browsing: user likes, playlists, artist tracks, and global search via native Go sidecar architecture.
  - Spotify Premium playback powered by an ultra-fast Rust audio core (`librespot`), with full library, playlist, and search sync.
- **Local Music Library**:
  - Play and organize local audio files (MP3, FLAC, OGG, WAV, M4A/AAC, ALAC).
  - Built-in metadata editor and album cover art extraction.
- **Immersive Full-Screen Player**:
  - Adaptive synced lyrics with ambient glow, explicit indicators, and a left-to-right karaoke color wipe effect.
  - Live multi-band audio spectrum visualizer and responsive liquid backdrop.
  - Multi-format background wallpapers: static images, animated GIFs, and looping video backgrounds.
- **Material 3 Expressive Interface**:
  - Dynamic palette generation adapting to the colors of the current track's album art.
  - Smooth spring physics and fluid motion designed for low CPU/GPU overhead.
- **Built-in Auto-Updates**:
  - In-app update checking against GitHub Releases with real-time download progress and one-click installation.
- **Lightweight & Efficient**:
  - Native architecture running significantly lighter on CPU and memory than Electron- or WebView-based streaming apps.

---

## System Requirements

- **macOS**: 13.0 (Ventura) or newer (Apple Silicon & Intel)
- **Linux**: Any modern distribution with Wayland or X11, PipeWire or PulseAudio
- **Windows**: Windows 10 / 11 64-bit

---

## Building from Source

### Prerequisites

- **Qt 6.9+**: Core, Gui, Network, Concurrent, Qml, Quick, QuickControls2, ShaderTools, Multimedia
- **QCoro6** (0.10+) and **Qt6Keychain**
- **CMake** (3.24+) and **Ninja**
- **Rust Toolchain** (stable, via [rustup](https://rustup.rs))
- **Go** (1.22+ for the SoundCloud backend sidecar)
- **C++20** compatible compiler (Clang / GCC / MSVC)

---

### macOS

Install build tools and libraries via [Homebrew](https://brew.sh):

```bash
brew install cmake ninja qt@6 qcoro6 qtkeychain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

Configure and build:

```bash
git clone https://github.com/BohdanKrakoviatskyi/BSC---BetterSoundCloud.git
cd BSC---BetterSoundCloud

# Configure CMake
QT_PREFIX="$(brew --prefix qt@6)"
QCORO_PREFIX="$(brew --prefix qcoro6)"
KEYCHAIN_PREFIX="$(brew --prefix qtkeychain)"

cmake -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$QT_PREFIX;$QCORO_PREFIX;$KEYCHAIN_PREFIX" \
  -DBUILD_TESTING=OFF

# Build
cmake --build build --target swiftify
```

To create a standalone, fully bundled macOS `.dmg` and `.zip`:

```bash
./packaging/macos/package-dmg.sh build/swiftify.app release-artifacts 0.3.3 -
```

---

### Linux

Install dependencies (example for Arch Linux):

```bash
sudo pacman -S --needed git qt6-base qt6-declarative qt6-shadertools qt6-multimedia \
  qt6-wayland qtkeychain-qt6 qcoro libpulse alsa-lib openssl cmake ninja rust go pkgconf
```

Build and install:

```bash
cmake -B build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$HOME/.local" \
  -DBUILD_TESTING=OFF

cmake --build build
cmake --install build
```

The app integrates with system MPRIS (media keys, `playerctl`, lock screen widgets) and system tray.

---

### Windows

Install Qt 6.9+, CMake, Ninja, Rust, and Visual Studio 2022 C++ Build Tools or MinGW 64-bit:

```powershell
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build build
```

---

## Command Line Controls

Resonance supports single-instance IPC. Launching a command while the player is running forwards the action immediately:

| Option | Action |
|---|---|
| `--immersive` | Toggle full-screen immersive player |
| `--close-immersive` | Exit immersive player |
| `--play-pause` | Play or pause current playback |
| `--next` | Skip to the next track |
| `--previous` | Return to previous track |
| `home` | Navigate to Home view |
| `playlists` | Navigate to Playlists view |
| `songs` | Navigate to Saved Songs view |

Example keybinding configuration for Hyprland (`hyprland.conf`):

```ini
bind = SUPER SHIFT, M, exec, swiftify --immersive
bind = , XF86AudioPlay, exec, swiftify --play-pause
bind = , XF86AudioNext, exec, swiftify --next
bind = , XF86AudioPrev, exec, swiftify --previous
```

---

## Releases & Automated Builds

Releases are built by `.github/workflows/release.yml`, one platform per runner, and
all three publish into the same GitHub release. Asset names carry the platform
(`Resonance-<version>-macOS.dmg`, `-Windows.zip`, `-Linux.AppImage`), which is what
the in-app updater matches on, so a name has to keep its platform token.

Pushing a version tag builds and publishes every platform:

```bash
git tag v0.3.4 && git push origin v0.3.4
```

`npm run release` picks the next patch tag from the highest of `package.json` and the
local and remote tags, and dispatches the workflow for it; pass one to pin it:

```bash
npm run release
npm run release -- v0.3.4
```

The workflow can also be started by hand from the Actions tab. Its `platform` input
narrows the matrix to a single runner, so one platform can be rebuilt after a failure
without rebuilding the other two.

The version in the tag is written into `CMakeLists.txt`, `spotify-core/Cargo.toml`,
`spotify-core/Cargo.lock` and `package.json` before anything is built, so nothing has
to be bumped by hand. A version that cannot be written fails the run instead of
shipping a build that reports the previous one.

macOS builds are signed ad hoc and are not notarized unless the Apple secrets are set.
Add them under Settings → Secrets and variables → Actions to get a signed and
notarized `.dmg`:

| Secret | Used for |
|---|---|
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | the Developer ID certificate, base64 encoded |
| `APPLE_SIGNING_IDENTITY` | the certificate's identity, for example `Developer ID Application: …` |
| `APPLE_KEYCHAIN_PASSWORD` | a throwaway password for the temporary keychain |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | notarization |

Without them the run still succeeds and warns in the log about the mode it used. The
Windows and Linux installers are unsigned.
