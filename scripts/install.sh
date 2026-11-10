#!/bin/bash
# Builds Desk.app and installs it in /Applications. If Desk is running, this updates it: Desk quits,
# the new app replaces the old one, and Desk opens again.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
app="/Applications/Desk.app"
# Copied next to the installed app first, so the swap is a rename on one volume and never leaves half an app.
staged="/Applications/.Desk.app.new"
log="$HOME/.desk/update.log"

"$repo/scripts/package.sh"
rm -rf "$staged"
ditto "$repo/dist/mac-arm64/Desk.app" "$staged"

if ! pgrep -f "^$app/Contents/MacOS/Desk" > /dev/null; then
  rm -rf "$app" && mv "$staged" "$app"
  echo "Installed $app"
  exit 0
fi

# This may run in one of Desk's own terminals, which close when Desk quits. The swap runs in a session of
# its own, so closing that terminal does not stop it.
mkdir -p "$(dirname "$log")"
APP="$app" STAGED="$staged" perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' bash -c '
  set -euo pipefail
  echo "Updating Desk at $(date)"
  osascript -e "tell application id \"app.desk\" to quit"
  for _ in $(seq 1 60); do pgrep -f "^$APP/Contents/MacOS/Desk" > /dev/null || break; sleep 0.5; done
  if pgrep -f "^$APP/Contents/MacOS/Desk" > /dev/null; then echo "Desk did not quit, so it was not updated."; exit 1; fi
  rm -rf "$APP" && mv "$STAGED" "$APP"
  open "$APP"
  echo "Updated."
' > "$log" 2>&1 < /dev/null &
echo "Desk will quit, update and open again. The log is $log."
