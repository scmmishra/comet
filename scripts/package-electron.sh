#!/bin/bash
# Builds the Electron Desk.app in dist/electron, beside the native one `package.sh` builds. The app carries
# the core's source, the core's production packages and the Bun binary that runs it, so it needs nothing
# from the repo. It runs the Claude Code installed on the Mac, found on the login shell's PATH.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

bun run --cwd app build
scripts/stage-core.sh
(cd app && bunx electron-builder --mac --arm64 --config electron-builder.yml)
# electron-builder writes dist/mac-arm64, where the native Desk.app goes, so its app moves aside.
rm -rf dist/electron && mkdir -p dist/electron
mv dist/mac-arm64/Desk.app dist/electron/Desk.app
# Copied in after electron-builder, which leaves every node_modules folder out of what it packs.
resources="$repo/dist/electron/Desk.app/Contents/Resources"
rsync -a --delete dist/stage/core/ "$resources/core/"
cp dist/stage/bun "$resources/bun"
# Deep, so the helper apps electron-builder renamed are signed again too.
codesign --force --deep --sign - dist/electron/Desk.app
echo "Built $repo/dist/electron/Desk.app"
