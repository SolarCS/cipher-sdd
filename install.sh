#!/bin/sh
# One-line bootstrap for a repo that has never run sdd before.
#
#   sh -c "$(curl -fsSL https://raw.githubusercontent.com/SolarCS/cipher-sdd/main/install.sh)"
#
# ...would be the usual curl-pipe form, except cipher-sdd is a PRIVATE repo: raw.githubusercontent.com
# needs a token to serve a private file, and asking every installer to mint one defeats the point of
# a one-liner. `git clone` doesn't have that problem -- it uses whatever credential already lets this
# machine reach the org's other private repos (an SSH key, a cached HTTPS credential), the same way
# as any other clone here. So the one true one-liner is this file's own contents, run directly:
#
#   sh -c 'd=$(mktemp -d) && git clone --depth 1 -q https://github.com/SolarCS/cipher-sdd "$d" && python3 "$d/sdd.py" install; rm -rf "$d"'
#
# This file exists for anyone who already has a clone and wants a named, reviewable script instead
# of a one-liner to paste -- `./install.sh` from inside this repo, or `sh /path/to/cipher-sdd/install.sh`
# pointed at a clone anywhere. It does the same three things: clone-or-reuse, run sdd.py install
# against the CALLER's current directory, clean up.
#
# POSIX sh only -- no bashisms, so it runs under dash/sh as well as bash/zsh.

set -eu

REPO_URL="https://github.com/SolarCS/cipher-sdd"

if ! command -v git >/dev/null 2>&1; then
  echo "install.sh: git is required (used to fetch cipher-sdd; you already have access to it)" >&2
  exit 1
fi

PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "install.sh: no python3 found on PATH. sdd needs Python 3.11+; install one for this" >&2
  echo "  platform first (e.g. brew install python@3.13, or apt install python3.13), then re-run." >&2
  exit 1
fi

# Running from inside an existing cipher-sdd checkout (this file, invoked directly): no clone needed.
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$SELF_DIR/_sdd_core.py" ] && [ -f "$SELF_DIR/sdd.py" ]; then
  exec "$PYTHON" "$SELF_DIR/sdd.py" install
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "install.sh: cloning $REPO_URL (shallow) ..." >&2
git clone --depth 1 -q "$REPO_URL" "$TMP_DIR"

# sdd.py's own version check reports a friendly error and a non-zero exit for anything older than
# 3.11 or not really Python 3 at all -- this script does not duplicate that check, only "is there
# an interpreter to try at all".
"$PYTHON" "$TMP_DIR/sdd.py" install
