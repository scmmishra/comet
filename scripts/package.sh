#!/bin/bash
# Builds dist/mac-arm64/Desk.app for this Mac. The app carries the core's source, the core's
# production packages and the Bun binary that runs it, so it needs nothing from the repo or PATH.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
bun="${DESK_BUN:-$(command -v bun)}"
stage="$repo/dist/stage"
cd "$repo"

bun run --cwd app build

# The core reads Solid, the plugin package, Babel and the Agent SDK's Claude binary from disk while it
# runs, so it ships as source with its packages instead of as one compiled file.
rm -rf "$stage"
mkdir -p "$stage/core"
for package in protocol plugin core; do
  mkdir -p "$stage/core/$package"
  cp "$package/package.json" "$stage/core/$package/"
  rsync -a --exclude '*.test.ts' --exclude 'test-*.ts' --exclude 'test-support.ts' "$package/src" "$stage/core/$package/"
done
cp bun.lock "$stage/core/"
# The root package.json without the app's workspace. A production install takes the lockfile as frozen,
# so the rest must match the repo's.
"$bun" -e 'const root = await Bun.file("package.json").json(); root.workspaces = root.workspaces.filter((w) => w !== "app"); await Bun.write(process.argv[1], JSON.stringify(root, null, 2))' "$stage/core/package.json"
(cd "$stage/core" && "$bun" install --production --linker hoisted)
cp "$(readlink -f "$bun")" "$stage/bun"

(cd app && bunx electron-builder --mac --arm64 --config electron-builder.yml)
# Copied in after electron-builder, which leaves every node_modules folder out of what it packs.
resources="$repo/dist/mac-arm64/Desk.app/Contents/Resources"
rsync -a --delete "$stage/core/" "$resources/core/"
cp "$stage/bun" "$resources/bun"
# Deep, so the helper apps electron-builder renamed are signed again too.
codesign --force --deep --sign - "$repo/dist/mac-arm64/Desk.app"
echo "Built $repo/dist/mac-arm64/Desk.app"
