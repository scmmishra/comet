#!/bin/bash
# Builds dist/mac-arm64/Desk.app, the native Desk, for this Mac. The app carries the core's source, the
# core's production packages and the Bun binary that runs it, so it needs nothing from the repo. It runs
# the Claude Code installed on the Mac, found on the login shell's PATH.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
app="$repo/dist/mac-arm64/Desk.app"
cd "$repo"

# Desk's version and icon still live with the Electron app, until it goes.
version="$(jq -r .version app/package.json)"

cargo build --release --manifest-path native/Cargo.toml
scripts/stage-core.sh

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp native/target/release/desk "$app/Contents/MacOS/Desk"
# The core runs from Contents/Resources, where `native/src/core.rs` looks for it.
rsync -a dist/stage/core/ "$app/Contents/Resources/core/"
cp dist/stage/bun "$app/Contents/Resources/bun"

# Desk.icon gives macOS 26 a light and a dark icon, and actool renders an .icns from it for older macOS.
icons="$(mktemp -d)"
trap 'rm -rf "$icons"' EXIT
xcrun actool app/build/Desk.icon --compile "$app/Contents/Resources" --app-icon Desk \
  --enable-on-demand-resources NO --development-region en --target-device mac --platform macosx \
  --minimum-deployment-target 13.0 --output-partial-info-plist "$icons/icon.plist" > /dev/null

# The desk: scheme lets `bin/desk` hand a folder to the running Desk (`native/src/opening.rs`).
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Desk</string>
  <key>CFBundleDisplayName</key><string>Desk</string>
  <key>CFBundleIdentifier</key><string>app.desk</string>
  <key>CFBundleExecutable</key><string>Desk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleIconFile</key><string>Desk</string>
  <key>CFBundleIconName</key><string>Desk</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>app.desk</string>
      <key>CFBundleURLSchemes</key><array><string>desk</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" > /dev/null

# Signed ad hoc: Desk is built for this Mac, not distributed.
codesign --force --sign - "$app"
echo "Built $app"
