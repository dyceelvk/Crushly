#!/usr/bin/env bash
# Netlify build entrypoint — works no matter where Netlify starts us.
#
# The site's UI settings and netlify.toml can disagree about the base dir and
# win in either order. This script finds the app either way, builds it, and
# materializes dist/ at both the app dir and the repo root so the publish
# setting resolves correctly either way.
set -euo pipefail

start="$PWD"
echo "build.sh starting at $start"

# Walk up until we find the app (package.json next to us, or in CrushlyApp/).
dir="$start"
while [ ! -f "$dir/CrushlyApp/package.json" ] && [ ! -f "$dir/package.json" ]; do
  [ "$dir" = "/" ] && { echo "cannot find CrushlyApp/package.json"; exit 1; }
  dir=$(dirname "$dir")
done
if [ -f "$dir/CrushlyApp/package.json" ]; then
  app="$dir/CrushlyApp"
else
  app="$dir"
fi
echo "building app at $app"
cd "$app"

npm ci --include=dev
node scripts/check-public-build.mjs
npm run build:web

# Repo root = where .git lives (or the directory above the app).
root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$dir")
if [ "$app/dist" != "$root/dist" ] && [ -d "$app/dist" ]; then
  echo "mirroring dist to $root/dist for publish resolution"
  rm -rf "$root/dist"
  cp -r "$app/dist" "$root/dist"
fi

echo "build.sh done"
