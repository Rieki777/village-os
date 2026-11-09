#!/usr/bin/env python3
"""
Write the unhinted copies of the packaged Latin faces into client/src/fonts.

WHY. The @fontsource woff2 files carry TrueType hinting: bytecode programs
(fpgm, prep, cvt, per-glyph instructions) that tell a rasteriser how to snap
outlines to a pixel grid. Every engine this app runs in (Chrome, Edge, Firefox
and Safari, all on DirectWrite, Core Text or FreeType's light autohinter)
ignores most or all of it at the sizes the site sets text in. It was a fifth of
the font bytes: 888 KB of the dist budget, 808 KB without it.

WHAT IS KEPT, and the reason this is safe: every glyph, every cmap entry, every
OpenType layout feature (small caps, tabular figures, ligatures, contextual
alternates) and every name record. Only the hinting goes. `--check` proves that
for each file against its original, and fails loudly if a glyph, a code point
or a feature tag differs.

ONE VARIABLE FILE PER FAMILY, where @fontsource-variable publishes one. Each
static cut of those families is an instance of the variable font, so every cut
of the family is served from a single `<family>-latin-wght-<style>.woff2` copy
(client/src/lib/unhintedFonts.ts does the pointing; each @font-face keeps its
one weight, so font matching is unchanged). That is 39 files and 663 KB down to
9 files and 348 KB. `--check` proves the instance claim per cut: the variable
copy, set to the cut's weight, must give the static original's vertical
metrics, and every code point the same advance width (to 1 unit in 1000) and
the same glyph bounds (to 2 units). A family whose variable build drifts from
its static cuts fails here: take it out of VARIABLE_FAMILIES and it goes back
to its static files. The variable originals are NOT dependencies of the app
(nothing at build or run time reads them), so this script fetches the pinned
release with `npm pack` into node_modules/.cache/fontsource-variable.

WHICH FILES: exactly the cuts client/src/main.tsx imports. vite.config.ts
points the @fontsource CSS at a copy here when one exists, so a cut added to
main.tsx without re-running this still renders, in the hinted original.
client/src/lib/unhintedFonts.test.ts fails until it is re-run.

Needs fonttools and brotli (pip install fonttools brotli), and npm on the
PATH for the variable originals. CI does not run this; the outputs are
committed.

Usage:
  python scripts/unhint-fonts.py           # write the files
  python scripts/unhint-fonts.py --check   # compare committed files to originals
"""
import os
import re
import subprocess
import sys
import tarfile

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "client", "src", "main.tsx")
OUT = os.path.join(ROOT, "client", "src", "fonts")
FONTSOURCE = os.path.join(ROOT, "node_modules", "@fontsource")
# Where the variable originals are unpacked. Under node_modules so git ignores
# it; the test that compares copy sizes against originals looks here too.
FONTSOURCE_VARIABLE = os.path.join(ROOT, "node_modules", ".cache", "fontsource-variable")
# The families with a variable build that passes `instance_matches`, and the
# version they are pinned to (the same release as the @fontsource statics).
VARIABLE_VERSION = "5.3.0"
VARIABLE_FAMILIES = ("caveat", "cormorant-garamond", "josefin-sans", "jost", "montserrat", "nunito-sans",
                     "playfair-display", "raleway")
HINTING = ("fpgm", "prep", "cvt ", "cvar", "hdmx", "VDMX", "LTSH")

# How far an instance may sit from the static cut it replaces, in font units
# (1000 per em in every family here). 1 unit is 0.016 px at 16 px.
ADVANCE_TOLERANCE = 1
BOUNDS_TOLERANCE = 2


def cuts():
    text = open(MAIN, encoding="utf-8").read()
    for pkg, cut in re.findall(r'"@fontsource/([a-z-]+)/latin-([0-9a-z-]+)\.css"', text):
        style = "italic" if cut.endswith("-italic") else "normal"
        weight = cut.replace("-italic", "")
        yield pkg, int(weight), style, f"{pkg}-latin-{weight}-{style}.woff2"


def variable_name(pkg, style):
    return f"{pkg}-latin-wght-{style}.woff2"


def fetch_variable_package(pkg):
    """
    Unpack @fontsource-variable/<pkg>@VARIABLE_VERSION into the cache, once.
    The packages are not dependencies of the app: nothing at build or run time
    reads them, only this script, so they are fetched here instead of
    installed (a new dependency is a ruled exception, scripts/dependency-allowlist.mjs).
    Returns False when the registry has no such package, which means the
    family has no variable build and stays on its static cuts.
    """
    dest = os.path.join(FONTSOURCE_VARIABLE, pkg)
    if os.path.isdir(os.path.join(dest, "files")):
        return True
    os.makedirs(FONTSOURCE_VARIABLE, exist_ok=True)
    spec = f"@fontsource-variable/{pkg}@{VARIABLE_VERSION}"
    npm = "npm.cmd" if os.name == "nt" else "npm"
    done = subprocess.run([npm, "pack", spec, "--silent", "--pack-destination", FONTSOURCE_VARIABLE],
                          capture_output=True, text=True)
    if done.returncode != 0:
        return False
    tgz = os.path.join(FONTSOURCE_VARIABLE, done.stdout.strip().splitlines()[-1])
    with tarfile.open(tgz) as tar:
        tar.extractall(FONTSOURCE_VARIABLE, filter="data")
    os.replace(os.path.join(FONTSOURCE_VARIABLE, "package"), dest)
    os.remove(tgz)
    return True


def variable_source(pkg, style):
    if pkg not in VARIABLE_FAMILIES or not fetch_variable_package(pkg):
        return None
    path = os.path.join(FONTSOURCE_VARIABLE, pkg, "files", variable_name(pkg, style))
    return path if os.path.exists(path) else None


def features(font):
    tags = set()
    for t in ("GSUB", "GPOS"):
        if t in font and font[t].table.FeatureList:
            tags |= {r.FeatureTag for r in font[t].table.FeatureList.FeatureRecord}
    return tags


def unhint(src, dst):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.hinting = False
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    font = TTFont(src)
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=font.getGlyphOrder())
    sub.subset(font)
    font.flavor = "woff2"
    font.save(dst)


def same(src, dst):
    a, b = TTFont(src), TTFont(dst)
    problems = []
    # Glyph NAMES go (post table format 3), so compare by glyph id.
    if len(a.getGlyphOrder()) != len(b.getGlyphOrder()):
        problems.append("glyph count differs")
    gid = lambda f: {u: f.getGlyphID(g) for u, g in f.getBestCmap().items()}
    if gid(a) != gid(b):
        problems.append("cmap differs")
    if features(a) != features(b):
        problems.append(f"features differ: {sorted(features(a) ^ features(b))}")
    if ("fvar" in a) != ("fvar" in b):
        problems.append("variation tables differ")
    left = [t for t in HINTING if t in b]
    if left:
        problems.append(f"still hinted: {left}")
    return problems


def vertical_metrics(font):
    h, o = font["hhea"], font["OS/2"]
    return (font["head"].unitsPerEm, h.ascent, h.descent, h.lineGap, o.sTypoAscender, o.sTypoDescender,
            o.sTypoLineGap, o.usWinAscent, o.usWinDescent, bool(o.fsSelection & 128))


def instance_matches(static_src, variable_copy, weight):
    """The variable copy set to `weight` must lay text out as the static cut does."""
    st = TTFont(static_src)
    vi = instancer.instantiateVariableFont(TTFont(variable_copy), {"wght": weight})
    problems = []
    if vertical_metrics(st) != vertical_metrics(vi):
        problems.append(f"vertical metrics differ at {weight}: {vertical_metrics(st)} vs {vertical_metrics(vi)}")
    cs, cv = st.getBestCmap(), vi.getBestCmap()
    if set(cs) != set(cv):
        problems.append(f"code points differ at {weight}")
        return problems
    gs, gv = st.getGlyphSet(), vi.getGlyphSet()
    worst_adv = worst_box = 0
    for cp, name in cs.items():
        worst_adv = max(worst_adv, abs(st["hmtx"][name][0] - vi["hmtx"][cv[cp]][0]))
        p1, p2 = BoundsPen(gs), BoundsPen(gv)
        gs[name].draw(p1)
        gv[cv[cp]].draw(p2)
        if (p1.bounds is None) != (p2.bounds is None):
            worst_box = max(worst_box, 9999)
        elif p1.bounds:
            worst_box = max(worst_box, max(abs(x - y) for x, y in zip(p1.bounds, p2.bounds)))
    if worst_adv > ADVANCE_TOLERANCE:
        problems.append(f"advance widths differ at {weight} by up to {worst_adv} units")
    if worst_box > BOUNDS_TOLERANCE:
        problems.append(f"glyph bounds differ at {weight} by up to {worst_box} units")
    return problems


def main():
    check = "--check" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    before = after = 0
    written = set()
    for pkg, weight, style, name in cuts():
        static_src = os.path.join(FONTSOURCE, pkg, "files", name)
        var_src = variable_source(pkg, style)
        src = var_src or static_src
        dst = os.path.join(OUT, variable_name(pkg, style) if var_src else name)
        if not check and dst not in written:
            unhint(src, dst)
        if not os.path.exists(dst):
            print(f"MISSING {os.path.basename(dst)} (for {name})")
            failed += 1
            continue
        problems = same(src, dst) if dst not in written else []
        if var_src:
            problems += instance_matches(static_src, dst, weight)
        before += os.path.getsize(static_src)
        if dst not in written:
            after += os.path.getsize(dst)
        written.add(dst)
        label = f"{name} -> {os.path.basename(dst)}" if var_src else name
        print(f"{'FAIL' if problems else 'ok  '} {label} {os.path.getsize(static_src)} -> {os.path.getsize(dst)} {'; '.join(problems)}")
        failed += bool(problems)
    stale = sorted(set(f for f in os.listdir(OUT) if f.endswith(".woff2")) - {os.path.basename(d) for d in written})
    for f in stale:
        print(f"STALE {f}: no imported cut uses it, delete it")
    failed += len(stale)
    print(f"{before} bytes of static originals -> {after} bytes in {len(written)} committed copies")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
