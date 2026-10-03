# Windows-local QA environment for the map lane.
# The suites were authored against a Linux sandbox; FILE/EXE read from here.
#
# GROUNDS_FILE IS DERIVED, NOT WRITTEN DOWN, and that is the whole point now
# that every lane works in its own worktree. It used to be an absolute path
# into `Desktop/Amora/ga-map`, so sourcing this file from a worktree pointed
# every suite at ANOTHER lane's artifact: green or red about a file you were
# not editing, with nothing to tell you. It resolves against this script's own
# location instead, so the suites always test the tree they were run from.
#
# Every value stays overridable, which is how you test an artifact that is not
# the working one:
#   GROUNDS_FILE="file:///.../head-artifact.html" node qa/verify_badges.js

_qa_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_qa_art="$_qa_dir/../grounds-v0.html"
# Chromium wants file:///C:/... on Windows; cygpath -m gives exactly that.
if command -v cygpath >/dev/null 2>&1; then
  _qa_art="$(cygpath -m "$_qa_art")"
fi
export GROUNDS_FILE="${GROUNDS_FILE:-file:///${_qa_art#/}}"

export PW_EXE="${PW_EXE:-${USERPROFILE//\\//}/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe}"
export NODE_PATH="${NODE_PATH:-${USERPROFILE//\\//}/Downloads/regen-civics-clean/node_modules}"
# Scratch output, beside the suites rather than in one session's temp dir.
export EXPORT_OUT="${EXPORT_OUT:-$_qa_dir/../.qa-out/amora-export.json}"
mkdir -p "$(dirname "$EXPORT_OUT")" 2>/dev/null

# Say which tree you are about to test. One line, and it has caught the wrong
# worktree twice in the time it took to write it.
echo "qa env: $GROUNDS_FILE"
unset _qa_dir _qa_art
