#!/usr/bin/env bash
# Acceptance harness for verify_help_l8.js. It proves the gate in BOTH directions
# and refuses a false green off a red baseline:
#
#   1. THE CONTROL FIRST. The UNMUTATED shipped artifact must PASS — checks>0 AND
#      fails==0. A gate that is red on the correct artifact is a broken gate, not
#      a caught mutant; a red baseline would also lend every mutant below a free
#      "fails>0". So if the control is not clean this ABORTS and no mutant verdict
#      is trusted.
#   2. EVERY MUTANT ADDS FAILS. checks>0 AND fails>control(0). A mutant that does
#      not move the gate off green is a HOLE in the gate, reported as such. A
#      crash (checks==0) is a hole too, never a silent pass.
#
# The script exits non-zero if the control is not clean or any mutant is a hole.
#
#     cd docs/prototypes/qa
#     MUT_ROOT="C:/some/real/path/L8MUT" bash _mut_run_l8.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${MUT_ROOT:?set MUT_ROOT to a real C:/ path}"
JOBS="${JOBS:-4}"
export PW_EXE="${PW_EXE:-${USERPROFILE//\\//}/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe}"
export NODE_PATH="${NODE_PATH:-${USERPROFILE//\\//}/Downloads/regen-civics-clean/node_modules}"
mkdir -p "$ROOT"

# Run the gate once against one artifact URL. Echoes 'label|exit|checks|fails'.
runone () {  # <label> <grounds-url> <logfile>
  local label="$1" url="$2" log="$3"
  GROUNDS_FILE="$url" node "$HERE/verify_help_l8.js" > "$log" 2>&1
  local code=$?
  local checks fails
  checks=$(grep -oE '^CHECKS [0-9]+' "$log" | tail -1 | awk '{print $2}')
  fails=$(grep -oE 'FAILS [0-9]+$'   "$log" | tail -1 | awk '{print $2}')
  [ -z "${checks:-}" ] && checks=0
  [ -z "${fails:-}" ] && fails=0
  printf '%s|%s|%s|%s\n' "$label" "$code" "$checks" "$fails"
}

# ---- 1. THE CONTROL: the unmutated shipped artifact must pass -----------------
CTRL_ART="$HERE/../grounds-v0.html"
CTRL_URL="file:///$(cygpath -m "$CTRL_ART" | sed 's|^/||')"
echo "control artifact: $CTRL_URL"
ctrl_row="$(runone control "$CTRL_URL" "$ROOT/_control.log")"
IFS='|' read -r _cl ccode cchecks cfails <<<"$ctrl_row"
echo "control|$ccode|$cchecks|$cfails"
if [ "${cchecks:-0}" -eq 0 ]; then
  echo "ABORT: control executed 0 checks (harness crash). See $ROOT/_control.log"
  exit 3
fi
if [ "${cfails:-1}" -ne 0 ]; then
  echo "ABORT: control has $cfails FAILS on the UNMUTATED artifact. The gate is red on the"
  echo "       correct shipped artifact, so nothing below can be trusted. See $ROOT/_control.log"
  grep '^FAIL' "$ROOT/_control.log" || true
  exit 1
fi
echo "control OK: $cchecks checks, 0 fails on the shipped artifact"
echo

# ---- 2. EVERY MUTANT MUST ADD FAILS OVER THE CONTROL -------------------------
names="$(python "$HERE/_mut_l8.py" --list | awk '{print $1}')"
: > "$ROOT/_summary.psv"

one () {
  local n="$1" d="$ROOT/$n"
  rm -rf "$d"
  python "$HERE/_mut_l8.py" "$n" "$d" >/dev/null || { echo "$n|STAGE-FAILED|0|0" >> "$ROOT/_summary.psv"; return; }
  local url="file:///$(cygpath -m "$d/grounds-v0.html" | sed 's|^/||')"
  runone "$n" "$url" "$ROOT/$n.log" >> "$ROOT/_summary.psv"
}

i=0
for n in $names; do
  one "$n" &
  i=$((i+1))
  if [ $((i % JOBS)) -eq 0 ]; then wait; fi
done
wait

echo "mutant results (name|exit|checks|fails), control fails=$cfails:"
sort "$ROOT/_summary.psv" | sed 's/^/  /'
echo

# ---- verdict -----------------------------------------------------------------
bad=0
while IFS='|' read -r n code checks fails; do
  [ -z "${n:-}" ] && continue
  if [ "$code" = "STAGE-FAILED" ]; then echo "HOLE: $n failed to stage"; bad=$((bad+1)); continue; fi
  if [ "${checks:-0}" -eq 0 ]; then echo "HOLE: $n executed 0 checks (crash), not a caught mutant"; bad=$((bad+1)); continue; fi
  if [ "${fails:-0}" -le "${cfails:-0}" ]; then
    echo "HOLE: $n added no fails over control ($fails <= $cfails); the gate did not catch it"
    bad=$((bad+1))
  fi
done < "$ROOT/_summary.psv"

if [ "$bad" -ne 0 ]; then
  echo
  echo "ACCEPTANCE FAILED: control passed, but $bad mutant(s) were not caught."
  exit 1
fi
echo "ACCEPTANCE PASSED: control is clean (0 fails) and every mutant added fails over it."
