#!/usr/bin/env bash
# Copy a released version of the kit into a site repo as plain files. No submodules, no
# package dependency: the site's git history shows exactly what changed, and a plain
# `git clone` of the site is enough to run the suite.
#
#   scripts/vendor-into.sh <site-test-dir> [<git-ref>]
#
# Example (from a checkout of this repo):
#   scripts/vendor-into.sh ~/workspace/randyfay/test/playwright v0.1.0
#
# The directory <site-test-dir>/kit/ is replaced wholesale, and kit/KIT_VERSION records the
# ref and commit it came from. Never edit kit/ in a site repo: make the change here, tag it,
# and vendor it again. That is the whole update procedure.

set -euo pipefail

dest="${1:?usage: vendor-into.sh <site-test-dir> [<git-ref>]}"
ref="${2:-HEAD}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -d "$dest" ] || { echo "No such directory: $dest" >&2; exit 1; }
commit="$(git -C "$here" rev-parse --verify "${ref}^{commit}")"

rm -rf "$dest/kit"
mkdir -p "$dest/kit"
git -C "$here" archive "$commit" lib scripts tests templates docs README.md LICENSE | tar -x -C "$dest/kit"

cat > "$dest/kit/KIT_VERSION" <<VERSION
site-migration-kit
ref:    ${ref}
commit: ${commit}
vendored by scripts/vendor-into.sh -- do not edit this directory; change the kit and vendor again.
VERSION

echo "Vendored site-migration-kit ${ref} (${commit:0:9}) into ${dest}/kit"
