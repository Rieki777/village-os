#!/usr/bin/env python3
"""L1 / g family / 02 — say "example" on every surface that shows an invented
housing number.

WHAT IS WRONG TODAY. `window.LOTS` (:4511) is sample data: ridgeA 2 of 5,
ridgeB 1 of 6, pondhomes 3 of 4. FOUR player-facing surfaces render those
numbers as fact and ONE of them says so:

    :2865  homeSheet route line   "2 of 5 spoken for"      UNLABELLED
                                  and the card's own button says
                                  "Begin your request"
    :3025  hover card             "2 of 5 spoken for · 3 open"   UNLABELLED
                                  and it is the first thing a visitor meets
    :3062  structure detail       "...· reserve through the door below"
                                  UNLABELLED and actively directive
    :4586  Housing module rows    "2 of 5 · lots spoken for · 3 open"
    :4587  Housing module footer  "sample until the Stays door feeds it live"
                                  LABELLED, and the only one

The contract at <workspace>/HOUSING_AVAILABILITY_CONTRACT.md
counted three surfaces. homeSheet at :2865 is a fourth: it renders `lot.sold`
into the `.route` line of the sheet whose primary action asks a visitor to
request a home. It is the most directive of the four and it carried no label
at all. So the before/after here is 1 of 4, not 1 of 3.

The `sample data` string at :3070 belongs to the "vitals at this address"
block lower in the same panel. It is not a housing label and reading it as one
scores this patch 2 of 4 for free.

THE PREDICATE, single-sourced. Contract section F:

    a surface labels its numbers as an example whenever the structure key it
    renders is absent from `housing.entries` on /api/map/config.

Presence in `entries` is the whole test. The server filters rows whose counts
are still NULL, so nothing here reads a NULL and nothing re-derives the rule:
three lanes implementing three copies of "is it set" is how three lanes
disagree. `window.HOUSING` stays null until the shell hands the block over,
which is why every hamlet reads as an example today and why all four labels
disappear on their own the moment L7's block arrives, with no further patch.

NAMING. `SITE_ROUTES` is already taken at :4504 by the journey→site map, in
what is very likely the same script block. A second top-level `const` of that
name is a redeclaration SyntaxError, which in this file means one silently
dead script block and no error anywhere. Nothing here reuses a name; the two
helpers are `housingSet` / `housingTag` / `housingNote` and they are checked
against the artifact before being written.

RE-RUNNABLE. One guard PER EDIT, keyed on a marker only that edit writes. A
single guard at the top would let a run that applied four of six edits look
finished, which is the same shape as the bug this patch removes.

Usage:  python patch_g1_02_examples.py [--check]
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(HERE, "grounds-v0.html")
CHECK = "--check" in sys.argv

# newline='' so LF stays LF. .gitattributes pins this file to `-text`, the
# working tree is 5604 bare LF and zero CRLF, and Python would otherwise write
# CRLF on Windows and rewrite all 5.4 MB.
with io.open(HTML, encoding="utf-8", newline="") as fh:
    src = fh.read()

before_bytes = len(src)
applied = skipped = 0


def step(name, marker, old, new, count=1):
    """One edit, one guard, one line of output.

    `marker` is a string ONLY this edit writes, so a re-run skips this edit
    and this edit alone. The assert on `count` is the swarm's conflict
    detector: an anchor matching zero or two times aborts before a byte is
    written, which is what stops two lanes from silently overwriting one
    another in a file with no build step.
    """
    global src, applied, skipped
    if marker in src:
        print("  skip   %s" % name)
        skipped += 1
        return
    n = src.count(old)
    assert n == count, "%s: anchor appears %d times, expected %d" % (name, n, count)
    src = src.replace(old, new, count)
    print("  apply  %s" % name)
    applied += 1


print("patch_g1_02_examples.py  ->  %s" % HTML)

# ---------------------------------------------------------------- 1. the predicate
LOTS_OLD = (
    "window.LOTS={ridgeA:{sold:2,total:5},ridgeB:{sold:1,total:6},"
    "pondhomes:{sold:3,total:4}}; // sample until Stays feeds it"
)
LOTS_NEW = LOTS_OLD + """
/* ---------- housing numbers: one predicate, four surfaces ----------
   A hamlet's numbers are an EXAMPLE until its structure key appears in the
   housing block of /api/map/config. Presence in `entries` is the whole test.
   The server has already dropped every row with a count still unset, so no
   surface here reads a NULL and no surface re-derives the rule: three lanes
   with three copies of "is it set" is how three lanes disagree.
   HOUSING_AVAILABILITY_CONTRACT.md, section F.

   `window.HOUSING` is null until the shell hands the block over, so every
   hamlet on this map reads as an example today, and all four labels go away
   on their own when a founder sets one. A hamlet at 0 of 0 is SET and is
   never called an example, which is why this asks about presence and never
   about the numbers. */
window.HOUSING=window.HOUSING||null;
window.housingSet=function(k){const H=window.HOUSING;
  return !!(H&&Array.isArray(H.entries)&&H.entries.some(e=>e&&e.structureKey===k))};
window.housingTag=function(k){return window.housingSet(k)?'':'Example numbers'};
window.housingNote=function(k){return window.housingSet(k)?'':'Example numbers. The founder has not set this hamlet yet.'};"""
step("1  predicate + labels beside window.LOTS (:4511)",
     "window.housingSet=function(k)", LOTS_OLD, LOTS_NEW)

# ---------------------------------------------------------------- 2. hover card :3025
HOVER_OLD = "spoken for \u00b7 ${LOTS[s.key].total-LOTS[s.key].sold} open</span></div>`:''}"
HOVER_NEW = (
    "spoken for \u00b7 ${LOTS[s.key].total-LOTS[s.key].sold} open</span></div>"
    "${housingTag(s.key)?`<div class=\"row\"><span style=\"color:#a3703d\">"
    "${housingTag(s.key)}</span></div>`:''}`:''}"
)
step("2  hover card, the first thing a visitor meets (:3025)",
     "${housingTag(s.key)?`<div class=\"row\"", HOVER_OLD, HOVER_NEW)

# ---------------------------------------------------------------- 3. detail panel :3062
# The directive clause goes with the numbers: "reserve through the door below"
# beside an invented count is the honesty problem, not decoration. It comes
# back by itself the moment the hamlet is set.
SHEET_OLD = "open \u00b7 reserve through the door below</p>`:''}"
SHEET_NEW = (
    "open${housingSet(s.key)?' \u00b7 reserve through the door below':''}</p>"
    "${housingSet(s.key)?'':`<p style=\"margin:3px 0 0;font-size:11.5px;color:#a3703d\">"
    "${housingNote(s.key)}</p>`}`:''}"
)
step("3  structure detail panel, drops the directive while unset (:3062)",
     "${housingSet(s.key)?' \u00b7 reserve through the door below'", SHEET_OLD, SHEET_NEW)

# ---------------------------------------------------------------- 4a. homeSheet line :2865
HOME_OLD = "const line=lot?`${lot.sold} of ${lot.total} spoken for`"
HOME_NEW = (
    "const line=lot?`${lot.sold} of ${lot.total} spoken for"
    "${housingTag(key)?' \u00b7 '+housingTag(key):''}`"
)
step("4a homeSheet route line (:2865)", "${housingTag(key)?' \u00b7 '+housingTag(key)",
     HOME_OLD, HOME_NEW)

# ---------------------------------------------------------------- 4b. homeSheet body
# The full sentence goes on this one because this is the card that asks for the
# request. ROOMS is out of scope (contract F), so the note is gated on `lot`.
ROUTE_OLD = "<div class=\"route\">${line}</div>"
ROUTE_NEW = (
    "<div class=\"route\">${line}</div>\n"
    "    ${(lot&&housingNote(key))?`<p style=\"margin:4px 0 0;font-size:11.5px;"
    "color:#a3703d\">${housingNote(key)}</p>`:''}"
)
step("4b homeSheet body, the card that asks for the request (:2871)",
     "${(lot&&housingNote(key))?", ROUTE_OLD, ROUTE_NEW)

# ---------------------------------------------------------------- 5. module rows :4586
MROW_OLD = "<small>lots spoken for \u00b7 ${L.total-L.sold} open</small>"
MROW_NEW = (
    "<small>lots spoken for \u00b7 ${L.total-L.sold} open"
    "${housingTag(k)?' \u00b7 '+housingTag(k):''}</small>"
)
step("5  Housing module rows, per hamlet (:4586)", "${housingTag(k)?' \u00b7 '+housingTag(k)",
     MROW_OLD, MROW_NEW)

# ---------------------------------------------------------------- 6. module footer :4587
# The old label was unconditional and named the wrong door ("the Stays door"),
# so it would still have been claiming "sample" after L7 set a hamlet. Per-row
# labels above carry the per-key truth; this carries the sentence once.
MFOOT_OLD = "the same numbers the banners wear \u00b7 sample until the Stays door feeds it live"
MFOOT_NEW = (
    "the same numbers the banners wear${(()=>{const u=['ridgeA','ridgeB','pondhomes']"
    ".filter(k=>!housingSet(k));return u.length?' \u00b7 Example numbers. The founder has not set '"
    "+(u.length===1?'this hamlet':'these hamlets')+' yet.':''})()}"
)
step("6  Housing module footer, was unconditional and named the wrong door (:4587)",
     "const u=['ridgeA','ridgeB','pondhomes']", MFOOT_OLD, MFOOT_NEW)

# ---------------------------------------------------------------------------
print("  ---")
print("  applied %d, skipped %d" % (applied, skipped))
delta = len(src) - before_bytes
if CHECK:
    print("  --check: nothing written (%+d bytes would change)" % delta)
    sys.exit(0)
if delta == 0 and applied == 0:
    print("  0 bytes changed")
    sys.exit(0)
with io.open(HTML, "w", encoding="utf-8", newline="") as fh:
    fh.write(src)
print("  wrote %s  (%+d bytes)" % (HTML, delta))
