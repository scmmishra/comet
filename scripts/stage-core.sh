#!/bin/bash
# Stages what Comet.app carries to run its core in dist/stage: the core's source, its production packages,
# and the Bun binary that runs it. `package.sh` copies it into the bundle.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
bun="${COMET_BUN:-$(command -v bun)}"
stage="$repo/dist/stage"
cd "$repo"

# The core reads Solid, the plugin package and Babel from disk while it runs,
# so it ships as source with its packages instead of as one compiled file.
rm -rf "$stage"
mkdir -p "$stage/core"
for package in protocol plugin core; do
  mkdir -p "$stage/core/$package"
  cp "$package/package.json" "$stage/core/$package/"
  rsync -a --exclude '*.test.ts' --exclude 'test-*.ts' --exclude 'test-support.ts' "$package/src" "$stage/core/$package/"
done
cp bun.lock "$stage/core/"
# A production install takes the lockfile as frozen, so the root package.json goes as it is.
cp package.json "$stage/core/"
(cd "$stage/core" && "$bun" install --production --linker hoisted)
# Comet runs the Claude Code installed on the Mac, so the Agent SDK's own copy of it, about 300 MB, stays out.
rm -rf "$stage/core/node_modules/@anthropic-ai/claude-agent-sdk-darwin-"*
cp "$(readlink -f "$bun")" "$stage/bun"
