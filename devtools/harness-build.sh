#!/usr/bin/env bash
# Rebuild the internal render harness from the current working tree.
#
# This file lives in the repo so it survives a workspace rollback; the harness it
# builds still runs outside the app (in /tmp) so it can never be bundled or
# deployed. One screen at a time, outside the navigator, with a seeded query
# cache — the only way to render signed-in screens without a live backend.
#
# Usage, from anywhere:  bash devtools/harness-build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$HERE/../CrushlyApp"
SRC="$HERE"
H="${HARNESS_DIR:-/tmp/harness}"
OUT="${HARNESS_OUT:-/tmp/webbuild-h}"
MEDIA="${HARNESS_MEDIA:-/tmp/harness-media}"

mkdir -p "$H"
rm -rf "$H/src" && cp -a "$REPO/src" "$H/src"
rm -rf "$H/harness" && cp -a "$SRC/harness" "$H/harness"
[ -e "$H/node_modules" ] || ln -s "$REPO/node_modules" "$H/node_modules"
cp "$REPO/package.json" "$H/package.json"
node -e "const fs=require('fs');const p='$H/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.main='harness/index.tsx';fs.writeFileSync(p,JSON.stringify(j,null,2));"

cd "$H"
EXPO_PUBLIC_SUPABASE_URL=https://abc.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig \
  npx expo export -p web --output-dir "$OUT"

# The clips and faces the mocks point at. Re-copied after every export because
# `expo export` owns the output directory.
mkdir -p "$OUT/media" && cp -a "$MEDIA"/. "$OUT/media/"
echo "harness ready in $OUT — serve it on :8097"
