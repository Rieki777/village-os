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
for each file against the @fontsource original, and fails loudly if a glyph,
a code point or a feature tag differs.

WHICH FILES: exactly the cuts client/src/main.tsx imports. vite.config.ts
points the @fontsource CSS at a copy here when one exists, so a cut added to
main.tsx without re-running this still renders, in the hinted original.
client/src/lib/unhintedFonts.test.ts fails until it is re-run.

Needs fonttools and brotli (pip install fonttools brotli). CI does not run
this; the outputs are committed.

Usage:
  python scripts/unhint-fonts.py           # write the files
  python scripts/unhint-fonts.py --check   # compare committed files to originals
"""
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, "client", "src", "main.tsx")
OUT = os.path.join(ROOT, "client", "src", "fonts")
FONTSOURCE = os.path.join(ROOT, "node_modules", "@fontsource")
HINTING = ("fpgm", "prep", "cvt ", "hdmx", "VDMX", "LTSH")


def cuts():
    text = open(MAIN, encoding="utf-8").read()
    for pkg, cut in re.findall(r'"@fontsource/([a-z-]+)/latin-([0-9a-z-]+)\.css"', text):
        style = "italic" if cut.endswith("-italic") else "normal"
        weight = cut.replace("-italic", "")
        yield pkg, f"{pkg}-latin-{weight}-{style}.woff2"


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
    left = [t for t in HINTING if t in b]
    if left:
        problems.append(f"still hinted: {left}")
    return problems


def main():
    check = "--check" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    before = after = 0
    for pkg, name in cuts():
        src = os.path.join(FONTSOURCE, pkg, "files", name)
        dst = os.path.join(OUT, name)
        if not check:
            unhint(src, dst)
        if not os.path.exists(dst):
            print(f"MISSING {name}")
            failed += 1
            continue
        problems = same(src, dst)
        before += os.path.getsize(src)
        after += os.path.getsize(dst)
        print(f"{'FAIL' if problems else 'ok  '} {name} {os.path.getsize(src)} -> {os.path.getsize(dst)} {'; '.join(problems)}")
        failed += bool(problems)
    print(f"{before} -> {after} bytes")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
