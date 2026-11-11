#!/bin/bash
# Stages what Desk.app carries to run its core in dist/stage: the core's source, its production packages,
# and the Bun binary that runs it. `package.sh` and `package-electron.sh` copy it into their bundles.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
bun="${DESK_BUN:-$(command -v bun)}"
stage="$repo/dist/stage"
cd "$repo"

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
# Desk runs the Claude Code installed on the Mac, so the Agent SDK's own copy of it, about 300 MB, stays out.
rm -rf "$stage/core/node_modules/@anthropic-ai/claude-agent-sdk-darwin-"*
cp "$(readlink -f "$bun")" "$stage/bun"
