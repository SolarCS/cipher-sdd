#!/bin/sh
# One-line bootstrap for a repo that has never run sdd before:
#
#   curl -fsSL https://raw.githubusercontent.com/SolarCS/cipher-sdd/main/install.sh | bash
#
# Already have a clone? Run this file directly instead -- `./install.sh` from inside it installs
# straight from that copy, no re-clone, no network round trip.
#
# Either way it does the same three things: get a copy of this repo (reuse one already on disk, or
# a shallow `git clone` into a temp dir), run `python3 sdd.py install` against the CALLER's current
# directory, clean up.
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
