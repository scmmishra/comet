#!/bin/bash
# Renders the logo into native/assets/Comet.icon, the Icon Composer icon that macOS 26 shows. The logo is
# black in light and dark mode alike. `scripts/package.sh` also renders it into the .icns that older macOS
# shows. Run it after changing assets/logo.svg, and commit what it writes. Needs rsvg-convert
# (`brew install librsvg`).
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
assets="$repo/assets"
out="$repo/native/assets"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# An Icon Composer layer is the drawing alone, full bleed: macOS draws the icon's shape and fills it.
# Dropping the background and cropping to the squircle's square gives that layer.
layer() {
  perl -0pe 's/<rect x="100" y="100" width="824" height="824" rx="185" fill="url\(#bg\)"\/>//; s/viewBox="0 0 1024 1024"/viewBox="100 100 824 824" width="1024" height="1024"/' "$1" > "$work/layer.svg"
  rsvg-convert -w 1024 -h 1024 "$work/layer.svg" -o "$2"
}
rm -rf "$out/Comet.icon"
mkdir -p "$out/Comet.icon/Assets"
layer "$assets/logo.svg" "$out/Comet.icon/Assets/logo.png"
# The fill is the logo's background gradient. Glass, shadow and translucency stay off, so macOS
# draws the drawing as it is.
cat > "$out/Comet.icon/icon.json" <<'EOF'
{
  "fill" : { "linear-gradient" : [ "srgb:0.10980,0.10980,0.12157,1.00000", "srgb:0.01961,0.01961,0.02353,1.00000" ] },
  "groups" : [
    {
      "layers" : [
        {
          "glass" : false,
          "image-name" : "logo.png",
          "name" : "Comet"
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

echo "Wrote $out/Comet.icon"
