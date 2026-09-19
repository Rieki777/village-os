#!/usr/bin/env python3
"""The ground becomes DATA: a village supplies its own plates at runtime.

Until now the ground under every map was baked into this file. `fetch_sat.py`
stitched Esri tiles, `embed_plate.py` base64'd them in at /*PLATE_HOOK*/, and
`patch_d3_surround.py` did the same for the wide plate. That works exactly once
per village, and only with a developer, a Python run and a redeploy of a 5.7 MB
artifact. Village two cannot have a map without village one's toolchain.

This patch does not remove the bake. It makes the bake a SEED and lets the
shell hand the map a different ground at runtime, which is what turns a
one-off into a platform:

    parent -> map: {type:'ground', core:{url}, surround:{url, rect:[x,y,w,h]}}

PRECEDENCE IS EXPLICIT, AND THAT IS DELIBERATE. The seed's loaders are left
byte for byte alone, so `embed_plate.py` and `patch_d3_surround.py` keep
working and a re-run of either cannot silently revert this. The village's
plates live in their OWN variables and every reader goes through a resolver
that prefers them. A seed image that finishes decoding after the village's
has already been applied therefore cannot clobber it -- which is a real race
on a data: URI of a megabyte, and it would have shown up as "the wrong
village's land, sometimes, on a fast connection".

The surround RECT travels with the surround image. It has to: [-780,-920,
3960,3440] is the rect Amora's mosaic was cut to, and a village whose ocean
is four kilometres east needs a different one. Requirement from Rye: the
surround must reach far enough to show the coast, so that a reader can see
how close the land is to the sea. That is a per-village number, so it is
per-village data.

Nothing about the world moves. W and H are still 2400x1600 and every stored
coordinate keeps its meaning.

Usage: python3 patch_i1_ground_runtime.py [grounds-v0.html]
"""
import io, sys

HTML = sys.argv[1] if len(sys.argv) > 1 else "grounds-v0.html"

# Text mode would translate newlines on the way in and back out, and this
# artifact is `-text` in .gitattributes: bytes in, same bytes out.
src = io.open(HTML, encoding="utf8", newline="").read()
before = len(src)


def swap(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"anchor appears {n} times, expected {count}: {old[:80]!r}"
    src = src.replace(old, new, count)


# ── 1. the resolver, in place of the old one-line activePlate ───────────────
swap(
    "const activePlate=()=>terrainMode==='paint'?satPlate:(terrainMode==='sat'?satPlate:null);",
    """/* ---------- THE GROUND IS DATA ----------
   `satPlate` and `surPlate` are the SEED: the plates baked into this file by
   embed_plate.py and patch_d3_surround.py, which are Amora's and which every
   standalone open and every file:// QA run still draws.

   `vilCore` and `vilSur` are the village's own, pushed by the shell at
   runtime from its land record. They WIN when present, and they win by being
   read first rather than by overwriting the seed, so a seed image that
   decodes late cannot land on top of a village's ground. */
let vilCore=null,vilSur=null,vilSurRect=null;
const groundCore=()=>vilCore||satPlate;
/* THE SEED SURROUND IS AMORA'S COASTLINE. Drawing it around another
   village's land would put a Pacific beach beside a landlocked farm --
   invented geography, which is the one thing this map may never do. So a
   village that supplies its own core and no surround gets NO surround, and
   the honest flat field past its plate, until its own wide plate exists. */
const groundSurround=()=>vilSur?{im:vilSur,rect:vilSurRect||SURROUND}
                              :(vilCore?null
                              :(surPlate?{im:surPlate,rect:SURROUND}:null));
const activePlate=()=>terrainMode==='paint'?groundCore():(terrainMode==='sat'?groundCore():null);
/* A plate that fails to load leaves the map exactly as it was. There is no
   broken-image state and no empty frame: the vector floor drawn by
   paintTerrain() is already the honest answer for "no photograph yet". */
function loadPlate(url,onto){try{const im=new Image();im.decoding='async';
  im.onload=()=>{try{onto(im)}catch(_){}};im.onerror=()=>{};im.src=url}catch(_){}}
/* The shell's ground push. Returns whether anything was accepted, which is
   what a QA run asserts on. A message carrying neither url is not an error:
   it is a village that has not placed itself yet, and it means "keep the
   seed", which is the same answer /api/land gives with configured:false. */
function setGround(g){
  if(!g||typeof g!=='object')return false;
  const core=g.core&&typeof g.core.url==='string'&&g.core.url?g.core.url:null;
  const sur=g.surround&&typeof g.surround.url==='string'&&g.surround.url?g.surround.url:null;
  const r=g.surround&&g.surround.rect;
  const rect=Array.isArray(r)&&r.length===4&&r.every(n=>typeof n==='number'&&isFinite(n))?r.slice():null;
  if(core)loadPlate(core,im=>{vilCore=im;paintReady=false;mmDirty=true;
    window.bakePainted&&bakePainted()});
  if(sur)loadPlate(sur,im=>{vilSur=im;vilSurRect=rect;mmDirty=true});
  return !!(core||sur);
}
window.setGround=setGround;
window.groundSource=()=>vilCore?'village':(satPlate?'seed':'vector');
/* QA hook, in the same spirit as window.camBounds and window.minZoom: what
   the map would actually draw, asked from outside. */
window.groundHas=()=>{const s=groundSurround();return {core:!!groundCore(),village:!!vilCore,surround:!!s,rect:s?s.rect.slice():null}};""",
)

# ── 2. the painted bake reads the resolved plate, not the seed ─────────────
swap(
    "function bakePainted(){if(paintReady||!satPlate)return;",
    "function bakePainted(){if(paintReady||!groundCore())return;",
)
swap(
    "    const g0=c0.getContext('2d');g0.drawImage(satPlate,0,0,BW,BH);",
    "    const g0=c0.getContext('2d');g0.drawImage(groundCore(),0,0,BW,BH);",
)

# ── 3. the draw: surround by resolved rect, core by resolved image ─────────
swap(
    "  if(surPlate)cx.drawImage(surPlate,SURROUND[0],SURROUND[1],SURROUND[2],SURROUND[3]); // the land beyond the land",
    "  {const _s=groundSurround();if(_s)cx.drawImage(_s.im,_s.rect[0],_s.rect[1],_s.rect[2],_s.rect[3]);} // the land beyond the land",
)
swap(
    "  if(terrainMode==='paint'&&satPlate){cx.drawImage(satPlate,0,0,W,H);",
    "  if(terrainMode==='paint'&&groundCore()){cx.drawImage(groundCore(),0,0,W,H);",
)

# ── 4. the bridge learns one more verb ─────────────────────────────────────
swap(
    "  if(d.type==='goto'&&typeof d.hash==='string'){leaveIntro();location.hash=d.hash;routeHash()}",
    "  if(d.type==='ground')setGround(d);\n"
    "  if(d.type==='goto'&&typeof d.hash==='string'){leaveIntro();location.hash=d.hash;routeHash()}",
)

# ── 5. SURROUND stops being a constant, because it is a village's number ───
swap(
    "const SURROUND=[-780,-920,3960,3440]; // world rect of the wide plate",
    "/* The SEED's surround rect. A village that pushes its own wide plate\n"
    "   pushes the rect it was cut to alongside it; see setGround. */\n"
    "const SURROUND=[-780,-920,3960,3440]; // world rect of the wide plate",
)

io.open(HTML, "w", encoding="utf8", newline="").write(src)
print(f"ground runtime: {before} -> {len(src)} bytes ({len(src)-before:+d})")
