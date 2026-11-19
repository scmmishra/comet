#!/bin/bash
# Builds dist/mac-arm64/Comet.app, the native Comet, for this Mac. The app carries the core's source, the
# core's production packages and the Bun binary that runs it, so it needs nothing from the repo. It runs
# the Claude Code installed on the Mac, found on the login shell's PATH.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo/dist/mac-arm64/Comet.app"
cd "$repo"

# Comet's version is the native crate's.
version="$(sed -n 's/^version = "\(.*\)"$/\1/p' native/Cargo.toml | head -1)"

cargo build --release --manifest-path native/Cargo.toml
scripts/stage-core.sh

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp native/target/release/comet "$app/Contents/MacOS/Comet"
# The core runs from Contents/Resources, where `native/src/core.rs` looks for it.
rsync -a dist/stage/core/ "$app/Contents/Resources/core/"
cp dist/stage/bun "$app/Contents/Resources/bun"
# The command line tool rides in the app, so it updates with it. The core links it onto the PATH when it
# starts (`core/src/command-line-tool.ts`).
mkdir -p "$app/Contents/Resources/bin"
cp bin/comet "$app/Contents/Resources/bin/comet"

# Comet.icon gives macOS 26 a light and a dark icon, and actool renders an .icns from it for older macOS.
icons="$(mktemp -d)"
trap 'rm -rf "$icons"' EXIT
xcrun actool native/assets/Comet.icon --compile "$app/Contents/Resources" --app-icon Comet \
  --enable-on-demand-resources NO --development-region en --target-device mac --platform macosx \
  --minimum-deployment-target 13.0 --output-partial-info-plist "$icons/icon.plist" > /dev/null

# The comet: scheme lets `bin/comet` hand a folder to the running Comet (`native/src/opening.rs`).
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Comet</string>
  <key>CFBundleDisplayName</key><string>Comet</string>
  <key>CFBundleIdentifier</key><string>app.comet</string>
  <key>CFBundleExecutable</key><string>Comet</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleIconFile</key><string>Comet</string>
  <key>CFBundleIconName</key><string>Comet</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>app.comet</string>
      <key>CFBundleURLSchemes</key><array><string>comet</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" > /dev/null

# Signed ad hoc: Comet is built for this Mac, not distributed.
codesign --force --sign - "$app"
echo "Built $app"
