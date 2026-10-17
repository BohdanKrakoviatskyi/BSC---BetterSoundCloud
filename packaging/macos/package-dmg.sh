#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Swiftify macOS Standalone Packaging & DMG Creation Script
#
# Usage:
#   package-dmg.sh <path-to-app> <output-dir> <version> [signing-identity]
# ==============================================================================

APP_BUNDLE="${1:-}"
OUTPUT_DIR="${2:-}"
VERSION="${3:-}"
SIGNING_IDENTITY="${4:--}"

if [ -z "$APP_BUNDLE" ] || [ -z "$OUTPUT_DIR" ] || [ -z "$VERSION" ]; then
    echo "Usage: $0 <path-to-app> <output-dir> <version> [signing-identity]"
    exit 1
fi

if [ ! -d "$APP_BUNDLE" ]; then
    echo "Error: App bundle '$APP_BUNDLE' not found."
    exit 1
fi

# Ensure absolute output dir
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

# Resolve macdeployqt
MACDEPLOYQT="$(which macdeployqt 2>/dev/null || true)"
if [ -z "$MACDEPLOYQT" ]; then
    BREW_QT_BIN="$(brew --prefix qt@6 2>/dev/null)/bin/macdeployqt"
    if [ -x "$BREW_QT_BIN" ]; then
        MACDEPLOYQT="$BREW_QT_BIN"
    else
        MACDEPLOYQT="/opt/homebrew/bin/macdeployqt"
    fi
fi

if [ ! -x "$MACDEPLOYQT" ]; then
    echo "Error: macdeployqt not found. Ensure Qt6 is installed and in PATH."
    exit 1
fi

echo "==> Using macdeployqt at: $MACDEPLOYQT"
echo "==> Packaging version: $VERSION"
echo "==> Signing identity: $SIGNING_IDENTITY"

STAGING_DIR="$(mktemp -d -t swiftify-deploy.XXXXXX)"
cleanup() {
    rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

TARGET_APP="$STAGING_DIR/Swiftify.app"
echo "==> Copying application bundle to staging directory..."
cp -R "$APP_BUNDLE" "$TARGET_APP"

# Find QML root relative to script or app
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QML_DIR="$REPO_ROOT/qml"

echo "==> Deploying Qt frameworks and QML plugins..."
"$MACDEPLOYQT" "$TARGET_APP" -qmldir="$QML_DIR" -verbose=1

# Ensure local-api sidecar is executable
if [ -f "$TARGET_APP/Contents/MacOS/local-api" ]; then
    chmod +x "$TARGET_APP/Contents/MacOS/local-api"
    echo "==> Marked Contents/MacOS/local-api as executable"
fi

# Strip quarantine / iCloud attributes before signing
xattr -cr "$TARGET_APP"

echo "==> Signing frameworks, plugins, and executables..."
CODESIGN_FLAGS=(--force --timestamp=none)
if [ "$SIGNING_IDENTITY" != "-" ]; then
    CODESIGN_FLAGS=(--force --timestamp --options runtime)
fi

# Sign all dylibs in Frameworks
find "$TARGET_APP/Contents/Frameworks" -type f \( -name "*.dylib" -o -perm +111 \) 2>/dev/null | while read -r lib; do
    codesign "${CODESIGN_FLAGS[@]}" --sign "$SIGNING_IDENTITY" "$lib" 2>/dev/null || true
done

# Sign all .framework bundles in Frameworks
find "$TARGET_APP/Contents/Frameworks" -name "*.framework" -type d 2>/dev/null | while read -r fw; do
    codesign "${CODESIGN_FLAGS[@]}" --sign "$SIGNING_IDENTITY" "$fw" 2>/dev/null || true
done

# Sign all plugins
find "$TARGET_APP/Contents/PlugIns" -type f -perm +111 2>/dev/null | while read -r plugin; do
    codesign "${CODESIGN_FLAGS[@]}" --sign "$SIGNING_IDENTITY" "$plugin" 2>/dev/null || true
done

# Sign local-api
if [ -f "$TARGET_APP/Contents/MacOS/local-api" ]; then
    codesign "${CODESIGN_FLAGS[@]}" --sign "$SIGNING_IDENTITY" "$TARGET_APP/Contents/MacOS/local-api" 2>/dev/null || true
fi

# Sign main executable and app bundle
codesign "${CODESIGN_FLAGS[@]}" --deep --sign "$SIGNING_IDENTITY" "$TARGET_APP"

echo "==> Verifying code signature..."
codesign --verify --deep --strict --verbose=2 "$TARGET_APP"

DMG_NAME="Swiftify-${VERSION}-macOS.dmg"
ZIP_NAME="Swiftify-${VERSION}-macOS.zip"

echo "==> Creating Zip archive: $OUTPUT_DIR/$ZIP_NAME"
ditto -c -k --keepParent "$TARGET_APP" "$OUTPUT_DIR/$ZIP_NAME"

echo "==> Creating DMG: $OUTPUT_DIR/$DMG_NAME"
DMG_STAGING="$STAGING_DIR/dmg"
mkdir -p "$DMG_STAGING"
cp -R "$TARGET_APP" "$DMG_STAGING/"
ln -s /Applications "$DMG_STAGING/Applications"

rm -f "$OUTPUT_DIR/$DMG_NAME"
hdiutil create \
    -volname "Swiftify" \
    -srcfolder "$DMG_STAGING" \
    -ov \
    -format UDZO \
    "$OUTPUT_DIR/$DMG_NAME"

if [ "$SIGNING_IDENTITY" != "-" ]; then
    echo "==> Signing DMG..."
    codesign --force --sign "$SIGNING_IDENTITY" "$OUTPUT_DIR/$DMG_NAME"
fi

echo "==> Successfully created release artifacts:"
ls -lh "$OUTPUT_DIR/$DMG_NAME" "$OUTPUT_DIR/$ZIP_NAME"
