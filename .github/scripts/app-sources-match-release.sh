#!/usr/bin/env bash
# Did this release tag ship the app sources currently checked out?
#
# APK builds are not byte-reproducible, so re-running the release workflow for a
# change that never entered the app (a workflow file, a check script) always
# produces different bytes for the same version. The publish step refuses to
# swap an existing asset — that law stays — but it needs to know whether the
# tree it is holding is the tree that is already out there, so a rebuild of
# unchanged sources can say so instead of looking like a forgotten bump.
#
# The record is written into the release body at publish time:
#     App sources: <sha256 of `git ls-tree -r HEAD -- <app dir>`>
# Exit 0 only when the recorded tree is exactly the tree checked out now.
set -euo pipefail

tag=${1:?usage: app-sources-match-release.sh <release-tag>}

appdir=$(git rev-parse --show-prefix)          # e.g. "CrushlyApp/" when run from the app
top=$(git rev-parse --show-toplevel)
current=$(git -C "$top" ls-tree -r HEAD -- "$appdir" | sha256sum | cut -d' ' -f1)

recorded=$(gh release view "$tag" --json body -q .body 2>/dev/null \
  | sed -n 's/^App sources: \([0-9a-f]\{64\}\)$/\1/p' | tail -n 1)

if [ -z "$recorded" ]; then
  echo "$tag carries no record of the sources it was built from (it predates the record), so this build cannot be shown to match it."
  exit 1
fi

echo "app sources now ${current}; ${tag} was built from ${recorded}"
[ "$current" = "$recorded" ]
