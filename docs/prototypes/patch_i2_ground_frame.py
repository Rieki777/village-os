#!/usr/bin/env python3
"""A picture is drawn where it truly is, and the seed's geography stays home.

patch_i1 made the ground runtime data: the shell pushes a village's own plate
and the map draws it. It pushed a URL and nothing else, and a URL says nothing
about where a picture was taken or how much ground it covers. So the map
stretched every village's picture across the seed's frame, and read the seed's
scale and coordinates off it. On the seed village itself that was a picture
three times too large and 345 metres off, under every building already placed.
Found before it shipped; the shell now sends `frame` with the picture.

WHAT THE MAP DOES WITH THE FRAME

  THE SEED'S OWN RECTANGLE (`frame.seed`). The server compares the parcel's
  frame with the rectangle this file's baked plate was cut to, because at
  "hidden" the browser may not learn the coordinates it would need to compare
  them itself. When it IS that rectangle, the seed's georeference is exactly
  right and nothing about it moves. The seed's surround, place names and
  coordinate caption describe this ground, so they stay: that is how the
  village the seed depicts keeps its coast.

  ANYWHERE ELSE. The seed's surround, its four place names and its caption are
  another place's geography, drawn at the same fidelity as the real thing, so
  they come down. The map's scale becomes the picture's (`spanM` across the
  world rect), so every area and length a founder reads describes their own
  land. The map's coordinates become the picture's centre when the village's
  visibility allows the centre to be known, and otherwise the map shows no
  coordinates at all rather than the seed's.

THE TWIN. The seed's scale was written down twice: `GEOREF.mPerUnit` for
coordinates and `M_PER_UNIT` for every area, length and the village's headline
hectares. Adopting a frame through one and not the other would have measured a
five-hectare field as fifty-odd, so both move together, and `M_PER_UNIT`
stops being a constant. Every reader already computes from it at call time.

The seed's own georeference is frozen before anything adopts a village's, so
the comparison and the QA hooks always have the original to hand.

Usage: python3 patch_i2_ground_frame.py [grounds-v0.html]
"""
import io, sys

HTML = sys.argv[1] if len(sys.argv) > 1 else "grounds-v0.html"
src = io.open(HTML, encoding="utf8", newline="").read()
before = len(src)


def swap(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"anchor appears {n} times, expected {count}: {old[:80]!r}"
    src = src.replace(old, new, count)


# ── 1. the scale's twin becomes reassignable ────────────────────────────────
swap(
    "const M_PER_UNIT=2592/2400;",
    "/* NOT a constant: a village's own picture brings its own scale. See\n"
    "   patch_i2 and adoptFrame. GEOREF.mPerUnit is its twin and moves with it. */\n"
    "let M_PER_UNIT=2592/2400;",
)

# ── 2. the surround rule, and the frame the rule reads ──────────────────────
swap(
    """/* THE SEED SURROUND IS AMORA'S COASTLINE. Drawing it around another
   village's land would put a Pacific beach beside a landlocked farm --
   invented geography, which is the one thing this map may never do. So a
   village that supplies its own core and no surround gets NO surround, and
   the honest flat field past its plate, until its own wide plate exists. */
const groundSurround=()=>vilSur?{im:vilSur,rect:vilSurRect||SURROUND}
                              :(vilCore?null
                              :(surPlate?{im:surPlate,rect:SURROUND}:null));""",
    """/* THE SEED'S GEOGRAPHY BELONGS TO THE SEED'S RECTANGLE. Its surround, its
   place names and its coordinate caption describe one piece of the Earth.
   Under a village standing on that same piece they are true and they stay,
   which is how the village the seed depicts keeps its coast. Under a village
   standing anywhere else they are invented geography at the same fidelity as
   the real thing, the one thing this map may never draw, so they come down
   and the honest flat field shows past the plate until that village's own
   wide plate exists.

   `vilFrame.seed` answers "same rectangle". The server works it out, because
   at "hidden" the browser is not allowed the coordinates it would take. */
const SEED_GEOREF=Object.freeze({lat:GEOREF.lat,lon:GEOREF.lon,z:GEOREF.z,
  pinW:Object.freeze(GEOREF.pinW.slice()),mPerUnit:GEOREF.mPerUnit});
const SEED_M_PER_UNIT=M_PER_UNIT;
let vilFrame=null;
const seedGeography=()=>!vilCore||!!(vilFrame&&vilFrame.seed);
/* Whether the map knows where its own ground is, so it may print coordinates.
   The seed always does. A village elsewhere does only when its visibility
   let the centre cross the wire. */
const geoKnown=()=>seedGeography()||!!(vilFrame&&vilFrame.centre);
const groundSurround=()=>vilSur?{im:vilSur,rect:vilSurRect||SURROUND}
                              :(seedGeography()&&surPlate?{im:surPlate,rect:SURROUND}:null);""",
)

# ── 3. adopting a frame ──────────────────────────────────────────────────────
swap(
    """/* The shell's ground push. Returns whether anything was accepted, which is
   what a QA run asserts on.""",
    """/* What a pushed frame means for the map's scale and coordinates.

   THE SEED'S RECTANGLE: the seed georeference is exactly right, so it is put
   back as baked, which also undoes any frame adopted earlier in this page.

   ELSEWHERE: `spanM` across the world's width is the scale, for coordinates
   AND for every area and length. The centre becomes the world centre's
   coordinates when it is known. When it is not, the seed's coordinates are
   left in place and `geoKnown()` stops anything printing them.

   A frame with no usable spanM leaves the scale where it was: there is
   nothing true to put in its place, and a guess would be a number presented
   as a measurement. */
function adoptFrame(f){
  const spanM=f&&typeof f.spanM==='number'&&isFinite(f.spanM)&&f.spanM>0?f.spanM:null;
  const c=f&&f.centre&&isFinite(+f.centre.lat)&&isFinite(+f.centre.lon)
    ?{lat:+f.centre.lat,lon:+f.centre.lon}:null;
  if(f&&f.seed===true){
    GEOREF.lat=SEED_GEOREF.lat;GEOREF.lon=SEED_GEOREF.lon;
    GEOREF.pinW=SEED_GEOREF.pinW.slice();GEOREF.mPerUnit=SEED_GEOREF.mPerUnit;
    M_PER_UNIT=SEED_M_PER_UNIT;
    return {spanM,seed:true,centre:c};
  }
  if(spanM){GEOREF.mPerUnit=spanM/W;M_PER_UNIT=spanM/W}
  if(c){GEOREF.lat=c.lat;GEOREF.lon=c.lon;GEOREF.pinW=[W/2,H/2]}
  return {spanM,seed:false,centre:c};
}
/* The seed's caption names a place in words. Shown only where it is true. */
function applySeedGeography(){try{const el=$('mmLabel');if(el)el.style.display=seedGeography()?'':'none'}catch(_){}}
/* The shell's ground push. Returns whether anything was accepted, which is
   what a QA run asserts on.""",
)
swap(
    """  if(core)loadPlate(core,im=>{vilCore=im;paintReady=false;mmDirty=true;
    window.bakePainted&&bakePainted()});""",
    """  const frame=g.frame&&typeof g.frame==='object'?g.frame:null;
  if(core)loadPlate(core,im=>{vilCore=im;vilFrame=adoptFrame(frame);
    paintReady=false;mmDirty=true;applySeedGeography();
    window.bakePainted&&bakePainted()});""",
)

# ── 4. the QA hook reports what the map now believes ────────────────────────
swap(
    "window.groundHas=()=>{const s=groundSurround();return {core:!!groundCore(),village:!!vilCore,surround:!!s,rect:s?s.rect.slice():null}};",
    "window.groundHas=()=>{const s=groundSurround();return {core:!!groundCore(),village:!!vilCore,surround:!!s,rect:s?s.rect.slice():null,\n"
    "  seedGeography:seedGeography(),geoKnown:geoKnown(),mPerUnit:M_PER_UNIT,georefMPerUnit:GEOREF.mPerUnit,\n"
    "  pin:[GEOREF.lat,GEOREF.lon],pinW:GEOREF.pinW.slice(),caption:(()=>{try{return $('mmLabel').style.display!=='none'}catch(_){return null}})()}};",
)

# ── 5. the seed's place names, only over the seed's own ground ──────────────
swap(
    "    const hideG=!(cam.z<1.25&&roomy);",
    "    const hideG=!seedGeography()||!(cam.z<1.25&&roomy); // another place's names never sit on this ground",
)

# ── 6. no seed coordinates printed over another village's land ──────────────
swap(
    "+ ` · v0 at ${la.toFixed(5)}, ${lo.toFixed(5)}`",
    "+ (geoKnown()?` · v0 at ${la.toFixed(5)}, ${lo.toFixed(5)}`:'')",
)

io.open(HTML, "w", encoding="utf8", newline="").write(src)
print(f"ground frame: {before} -> {len(src)} chars ({len(src)-before:+d})")
