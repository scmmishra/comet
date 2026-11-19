#!/bin/bash
# Builds Comet.app and installs it in /Applications. If Comet is running, this updates it: Comet quits,
# the new app replaces the old one, and Comet opens again.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
app="/Applications/Comet.app"
# Copied next to the installed app first, so the swap is a rename on one volume and never leaves half an app.
staged="/Applications/.Comet.app.new"
log="$HOME/.comet/update.log"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Links the command line tool onto the PATH. The link points into the installed app, so each install
# updates it. A `comet` there that is not a link is someone else's, and stays.
link_cli() {
  local bin="$HOME/.local/bin" tool="$app/Contents/Resources/bin/comet"
  mkdir -p "$bin"
  if [ -e "$bin/comet" ] && [ ! -L "$bin/comet" ]; then
    echo "$bin/comet is not a link Comet made, so the command line tool is not installed. Link $tool yourself."
    return
  fi
  ln -sfn "$tool" "$bin/comet"
  case ":$PATH:" in
    *":$bin:"*) echo "Linked the comet command into $bin." ;;
    *) echo "Linked the comet command into $bin. Add $bin to your PATH to run it." ;;
  esac
}

"$repo/scripts/package.sh"
rm -rf "$staged"
ditto "$repo/dist/mac-arm64/Comet.app" "$staged"

if ! pgrep -f "^$app/Contents/MacOS/Comet" > /dev/null; then
  rm -rf "$app" && mv "$staged" "$app"
  # The installed app takes comet:// links, over a build in dist with the same bundle id.
  "$lsregister" -f "$app"
  echo "Installed $app"
  link_cli
  exit 0
fi

# This may run in one of Comet's own terminals, which close when Comet quits. The swap runs in a session of
# its own, so closing that terminal does not stop it.
mkdir -p "$(dirname "$log")"
APP="$app" STAGED="$staged" LSREGISTER="$lsregister" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' bash -c '
  set -euo pipefail
  echo "Updating Comet at $(date)"
  osascript -e "tell application id \"app.comet\" to quit"
  for _ in $(seq 1 60); do pgrep -f "^$APP/Contents/MacOS/Comet" > /dev/null || break; sleep 0.5; done
  if pgrep -f "^$APP/Contents/MacOS/Comet" > /dev/null; then echo "Comet did not quit, so it was not updated."; exit 1; fi
  rm -rf "$APP" && mv "$STAGED" "$APP"
  "$LSREGISTER" -f "$APP"
  open "$APP"
  echo "Updated."
' > "$log" 2>&1 < /dev/null &
echo "Comet will quit, update and open again. The log is $log."
# The link names the installed app's path, so it can be made while the swap waits for Comet to quit.
link_cli
