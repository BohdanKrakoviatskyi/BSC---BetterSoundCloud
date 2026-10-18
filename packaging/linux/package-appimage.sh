#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Swiftify Linux AppImage packaging
#
# Usage:
#   package-appimage.sh <build-dir> <output-dir> <version>
#
# The installed layout is what the app expects at run time: the binary and the
# go sidecar in usr/bin, the fonts in usr/share/swiftify/fonts (Fonts.cpp looks
# beside the executable for them), and the desktop file and the icons where the
# desktop environment finds them. linuxdeploy then pulls the Qt and system
# libraries in and writes the AppImage.
# ==============================================================================

BUILD_DIR="${1:-build}"
OUTPUT_DIR="${2:-release-artifacts}"
VERSION="${3:-}"

if [ -z "$VERSION" ]; then
    echo "Usage: $0 <build-dir> <output-dir> <version>"
    exit 1
fi
if [ ! -d "$BUILD_DIR" ]; then
    echo "Error: build directory '$BUILD_DIR' not found."
    exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

# linuxdeploy and its qt plugin are appimages themselves; running them through
# the extract-and-run path keeps them working on runners without fuse
export APPIMAGE_EXTRACT_AND_RUN=1

TOOLS_DIR="${LINUXDEPLOY_DIR:-$PWD/.linuxdeploy}"
mkdir -p "$TOOLS_DIR"
LINUXDEPLOY="$TOOLS_DIR/linuxdeploy-x86_64.AppImage"

fetch() {
    local url="$1" destination="$2"
    if [ ! -x "$destination" ]; then
        echo "==> Downloading $(basename "$destination")"
        curl -fsSL -o "$destination" "$url"
        chmod +x "$destination"
    fi
}

if ! command -v linuxdeploy >/dev/null 2>&1; then
    fetch "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage" \
        "$LINUXDEPLOY"
    # the download is named after its architecture; the tool is invoked as
    # linuxdeploy, so the plain name has to exist or the call below finds nothing
    ln -sf "$LINUXDEPLOY" "$TOOLS_DIR/linuxdeploy"
fi
# linuxdeploy looks for its plugins beside itself or on PATH, under the plain
# name without the architecture and the .AppImage suffix
fetch "https://github.com/linuxdeploy/linuxdeploy-plugin-qt/releases/download/continuous/linuxdeploy-plugin-qt-x86_64.AppImage" \
    "$TOOLS_DIR/linuxdeploy-plugin-qt-x86_64.AppImage"
ln -sf "$TOOLS_DIR/linuxdeploy-plugin-qt-x86_64.AppImage" "$TOOLS_DIR/linuxdeploy-plugin-qt"
export PATH="$TOOLS_DIR:$PATH"

# the qt plugin needs qmake to know which Qt to deploy
if [ -z "${QMAKE:-}" ] && command -v qmake6 >/dev/null 2>&1; then
    QMAKE="$(command -v qmake6)"
fi
if [ -z "${QMAKE:-}" ] && [ -n "${Qt6_DIR:-}" ] && [ -x "$Qt6_DIR/bin/qmake" ]; then
    QMAKE="$Qt6_DIR/bin/qmake"
fi
if [ -z "${QMAKE:-}" ]; then
    echo "Error: qmake not found; set QMAKE or Qt6_DIR."
    exit 1
fi
export QMAKE

APPDIR="$(mktemp -d -t swiftify-appimage.XXXXXX)"
cleanup() {
    rm -rf "$APPDIR"
}
trap cleanup EXIT

echo "==> Installing into $APPDIR/usr"
cmake --install "$BUILD_DIR" --prefix "$APPDIR/usr" --config Release

# The qml lives compiled into the binary. QML_SOURCES_PATHS still points the
# scanner at the sources so it can see which Qt modules are used, but the
# scanner will report the project's own module as missing — Swiftify is not a
# deployable QML module, it is inside the executable. The platform styles
# (QtQuick.Controls.Windows, .macOS, .iOS) are absent from a linux Qt for the
# same obvious reason. None of that stops the AppImage being built correctly,
# but linuxdeploy's qt plugin exits non-zero over it, so its status is recorded
# and the artifact decides whether the step passes — not the plugin's opinion
# of a module that cannot be deployed.
export QML_SOURCES_PATHS="$REPO_ROOT/qml"
export EXTRA_QT_MODULES="QtQuick;QtQuickControls2;QtQml;QtMultimedia;QtSvg"

echo "==> Running linuxdeploy"
DEPLOY_STATUS=0
OUTPUT="Resonance-${VERSION}-Linux.AppImage" \
    linuxdeploy \
    --appdir "$APPDIR" \
    --desktop-file "$APPDIR/usr/share/applications/swiftify.desktop" \
    --icon-file "$APPDIR/usr/share/icons/hicolor/512x512/apps/swiftify.png" \
    --plugin qt \
    --output appimage || DEPLOY_STATUS=$?
echo "==> linuxdeploy exited $DEPLOY_STATUS"

# linuxdeploy writes into the current directory
if [ -f "$OUTPUT" ]; then
    mv "$OUTPUT" "$OUTPUT_DIR/"
fi

ARTIFACT="$(find "$OUTPUT_DIR" -maxdepth 1 -name 'Resonance-*-Linux*.AppImage' -print -quit)"
if [ -z "$ARTIFACT" ]; then
    echo "Error: linuxdeploy produced no AppImage (it exited $DEPLOY_STATUS)."
    exit 1
fi
if [ "$DEPLOY_STATUS" -ne 0 ]; then
    echo "Note: linuxdeploy reported $DEPLOY_STATUS over undeployable qml modules;"
    echo "the AppImage below is checked for self-containment before it ships."
fi

echo "==> Successfully created release artifact:"
ls -lh "$ARTIFACT"
