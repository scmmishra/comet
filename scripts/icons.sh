#!/bin/bash
# Renders the logo into the app's icons. Run it after changing assets/logo.svg or assets/logo-dark.svg,
# and commit what it writes. Needs rsvg-convert (`brew install librsvg`).
#
# - build/Desk.icon: the Icon Composer icon, which macOS 26 shows in light or dark with the system.
#   electron-builder also renders it into the .icns that older macOS shows.
# - build/icon-dev.png: an amber icon that Desk Dev shows in the Dock, so the two are told apart.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
assets="$repo/assets"
out="$repo/app/build"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# An Icon Composer layer is the drawing alone, full bleed: macOS draws the icon's shape and fills it.
# Dropping the background and cropping to the squircle's square gives that layer.
layer() {
  perl -0pe 's/<rect x="100" y="100" width="824" height="824" rx="185" fill="url\(#bg\)"\/>//; s/viewBox="0 0 1024 1024"/viewBox="100 100 824 824" width="1024" height="1024"/' "$1" > "$work/layer.svg"
  rsvg-convert -w 1024 -h 1024 "$work/layer.svg" -o "$2"
}
rm -rf "$out/Desk.icon"
mkdir -p "$out/Desk.icon/Assets"
layer "$assets/logo.svg" "$out/Desk.icon/Assets/light.png"
layer "$assets/logo-dark.svg" "$out/Desk.icon/Assets/dark.png"
# The fills are the logos' background gradients. Glass, shadow and translucency stay off, so macOS
# draws the drawing as it is.
cat > "$out/Desk.icon/icon.json" <<'EOF'
{
  "fill-specializations" : [
    { "value" : { "linear-gradient" : [ "srgb:0.93333,0.95686,1.00000,1.00000", "srgb:0.78824,0.85882,0.98039,1.00000" ] } },
    { "appearance" : "dark", "value" : { "linear-gradient" : [ "srgb:0.10196,0.11373,0.14118,1.00000", "srgb:0.03922,0.04314,0.05490,1.00000" ] } }
  ],
  "groups" : [
    {
      "layers" : [
        {
          "glass" : false,
          "image-name-specializations" : [
            { "value" : "light.png" },
            { "appearance" : "dark", "value" : "dark.png" }
          ],
          "name" : "Desk"
        }
      ],
      "shadow" : { "kind" : "neutral", "opacity" : 0 },
      "specular" : false,
      "translucency" : { "enabled" : false, "value" : 0 }
    }
  ],
  "supported-platforms" : { "squares" : [ "macOS" ] }
}
EOF

# The dev icon swaps the slab's blues for ambers of the same weight.
sed -e 's/#9CC6FF/#FFD08A/g' -e 's/#4C8BF0/#F0962E/g' -e 's/#2F64C4/#C46F1F/g' -e 's/#244F9E/#9E5615/g' \
  "$assets/logo.svg" > "$work/logo-dev.svg"
rsvg-convert -w 512 -h 512 "$work/logo-dev.svg" -o "$out/icon-dev.png"
echo "Wrote $out/Desk.icon and $out/icon-dev.png"
