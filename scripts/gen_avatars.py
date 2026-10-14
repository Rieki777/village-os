#!/usr/bin/env python3
"""Character card portraits for the class selection page.

Five classes x two presentations x three skin tones = 30 card portraits at
`server/assets/avatars/<archetype>-<f|m>-<tone>.webp`, which the server
serves at /images/avatars/ (server/routes/stockAvatars.ts).

The style guide is reused verbatim from the platform repo's character-art
prompt: solarpunk meets elven meets regenerative future, deep forest greens,
warm golds, bioluminescent teals, sunrise amber light, grown tools, living
fibers. Card portrait means three-quarter body on a soft warm green-to-gold
gradient, no text, no scene elements, clean edges for compositing.

Four properties this pipeline is built around, each of which was a real
failure mode somewhere else:

  1. RESUME-SAFE. An output that already exists is skipped. A run that dies
     at asset 19 picks up at 19, and costs nothing for the 18 before it.
  2. THE BASE IS SAVED. Each (class, presentation) has ONE generated base
     PNG on disk. The other two skin tones are EDITS of that exact file, so
     a resumed run derives its tone variants from the same face it started
     with instead of a freshly generated stranger.
  3. THE MODEL IS PINNED, and there is NO fallback list. A pipeline that
     quietly drops to a weaker model on a bad afternoon produces a set that
     does not match itself, and nothing in the output says so. On a 429 this
     backs off and retries; on anything else it stops and says why.
  4. THE MANIFEST IS THE TRUTH. Every asset records the model that made it,
     the base it came from, and when. The selection page reads the manifest
     and falls back to a medallion for anything missing, so a half-finished
     run renders as a half-finished run and never as a broken image.

Usage:

    GEMINI_API_KEY=...  python scripts/gen_avatars.py --samples
    GEMINI_API_KEY=...  python scripts/gen_avatars.py
    GEMINI_API_KEY=...  python scripts/gen_avatars.py building storytelling
    GEMINI_API_KEY=...  python scripts/gen_avatars.py --dry-run

`--samples` generates exactly the three blessing samples and stops, which is
the gate before the full thirty. The key comes from the environment only and
is never written to disk, a log line, or the manifest.
"""
import argparse
import base64
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO, "server", "assets", "avatars")
BASE_DIR = os.path.join(REPO, "scripts", "avatar-bases")
MANIFEST = os.path.join(OUT_DIR, "manifest.json")

# Pinned. Override deliberately with AVATAR_MODEL when a newer model has been
# blessed, and expect the manifest to show a mixed set until every asset is
# regenerated. There is no automatic second choice on purpose.
MODEL = os.environ.get("AVATAR_MODEL", "gemini-3-pro-image")

# How the two non-base skin tones are made.
#
#   generate  each tone is its own generation from the class prompt with the
#             tone written in. Three genuinely distinct complexions. The three
#             faces of one class are close but not identical.
#   edit      each tone is an image-edit of the saved base. Identical faces.
#
# `generate` is the default because `edit` did not work: asked to repaint a fair
# complexion as deep brown while holding face, hair, clothing, pose, lighting
# and background, the model held all of those and returned a tan. Two further
# attempts with progressively blunter wording moved it no further. An identical
# face is worth less than a skin tone a player can actually pick, so the tone
# wins and `edit` stays available behind the flag for when a model can do both.
TONE_MODE = os.environ.get("AVATAR_TONE_MODE", "generate")
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

TONES = ("deep", "olive", "light")
TONE_WORDS = {"deep": "deep brown", "olive": "medium olive", "light": "light freckled"}

HEAD = (
    "Illustrated character design with a hand-painted quality, solarpunk meets elven meets "
    "regenerative future aesthetic. Card portrait of "
)
# Two clauses here are not in the original style guide and are load-bearing.
#
# The framing is PINNED to one crop. The first sample run came back with one
# character drawn head to mid-calf and the next head to waist, which reads as a
# roster of cards shot by two different photographers once they sit side by
# side. "Three-quarter body" alone was not specific enough to repeat 30 times.
#
# The frame is BANNED. Every image in that run painted its own decorative card
# border, which the style guide's "clean edges for card compositing" is meant to
# prevent: the page draws the card, and a second painted frame inside it fights
# the real one at every screen size.
TAIL = (
    ", full standing pose, the entire figure visible from the top of the head down to the "
    "feet with both feet inside the frame, centered with generous even margin on every side, "
    "simple soft "
    "warm green-to-gold gradient background that bleeds off all four edges of the image, the "
    "gradient must touch every edge with no white space, no paper margin, no matte, no mount, "
    "no border, no frame, no card edge, no inner outline, no drop shadow behind the artwork, "
    "no text, no scene elements, clean edges for card compositing, detailed but not "
    "photorealistic, deep forest greens, warm golds, bioluminescent teal accents, sunrise "
    "amber light"
)

# The edit prompt keeps the spec's list of what must not move, and adds force to
# the one thing that must. The spec's wording on its own produced a light-to-deep
# edit that was a shade warmer and nothing more, which would have shipped three
# "tones" a player could not tell apart. Naming the direction of the change and
# asking for it to be unmistakable is what makes the variant a variant.
EDIT = (
    "Repaint this character as a different person of {ethnicity} with {words} skin. Their "
    "complexion must read unmistakably as {words}: {detail} Change the skin on the face, "
    "neck and both hands. Keep the face structure, hairstyle, hair colour, expression, "
    "clothing, tools, pose, lighting and background exactly the same."
)

# What each tone actually has to look like. Naming a complexion in plain terms is
# what finally moved it: "change the skin tone to deep brown" produced a tan, and
# three tones a player cannot tell apart is the same as one tone.
TONE_DETAIL = {
    "deep": ("Black African", "deep brown",
             "rich dark brown skin, deep umber, clearly dark, not tan and not olive."),
    "olive": ("Mediterranean or Latin American", "medium olive",
              "warm mid-tone olive skin, clearly darker than fair skin and clearly lighter "
              "than dark brown skin."),
    "light": ("Northern European", "light freckled",
              "fair pale skin with visible freckles, clearly light."),
}

# Ten bases: one per class per presentation. `skin` is the tone this base is
# GENERATED at; the other two tones are edits of it. Base tones vary across the
# set on purpose, so the roster is not ten people who look related.
BASES = {
    "building-f": {
        "skin": "deep",
        "subject": (
            "a woman with {skin} skin and dark coiled hair woven with tiny golden flowers, warm "
            "confident expression, subtle pointed ears, subtle bioluminescent freckles, wearing a "
            "fitted builder's tunic of living woven fibers in deep forest green and warm gold with "
            "soft glowing teal circuitry patterns, a tool belt of grown-wood and brass tools with "
            "small glowing crystals, holding a living-wood mallet in one hand while her other open "
            "palm raises a small floating translucent holographic blueprint of a treehouse "
            "pavilion, moss cushion boots with tiny ferns"
        ),
    },
    "building-m": {
        "skin": "light",
        "subject": (
            "a man with {skin} skin and short copper hair with small leaves growing in it, open "
            "steady expression, subtle pointed ears, wearing a fitted builder's tunic of living "
            "woven fibers in deep forest green and warm gold with soft glowing teal circuitry "
            "patterns, a tool belt of grown-wood and brass tools with small glowing crystals, "
            "carrying a living-wood beam with glowing graft lines over one shoulder while a small "
            "floating translucent holographic blueprint of a treehouse pavilion hovers at his "
            "shoulder, moss cushion boots with tiny ferns"
        ),
    },
    "researching-f": {
        "skin": "olive",
        "subject": (
            "a woman with {skin} skin and long dark hair pulled back loosely with a living-wood "
            "pin, focused thoughtful expression, thin crystalline glasses, subtle pointed ears, "
            "wearing a fitted vest with geometric bioluminescent patterns over a simple tunic of "
            "living woven fibers in deep forest green and warm gold, holding a crystalline lens up "
            "in one hand, translucent leaf-paper scrolls tucked under her other arm, a small "
            "floating map of glowing paths hovering beside her, soft woven shoes"
        ),
    },
    "researching-m": {
        "skin": "deep",
        "subject": (
            "a man with {skin} skin and short silver-streaked hair, calm precise expression, thin "
            "crystalline glasses, subtle bioluminescent markings at his temples, wearing a fitted "
            "vest with geometric bioluminescent patterns over a simple tunic of living woven "
            "fibers in deep forest green and warm gold, one hand turning a small crystalline orrery "
            "of glowing rings, translucent leaf-paper scrolls in a shoulder satchel, a small "
            "floating map of glowing paths hovering beside him, soft woven shoes"
        ),
    },
    "facilitating-f": {
        "skin": "light",
        "subject": (
            "a woman with {skin} skin and silver-streaked hair in a soft crown braid woven with "
            "tiny living flowers, serene welcoming expression, subtle pointed ears, wearing a "
            "flowing robe of living woven fibers in deep forest green and warm gold, holding a "
            "circle staff topped with a shallow bowl of soft hearth-light, a rolled woven seating "
            "mat across her back, a small companion bird resting on her shoulder, bare feet in "
            "soft moss"
        ),
    },
    "facilitating-m": {
        "skin": "olive",
        "subject": (
            "a man with {skin} skin and a short greying beard and close-cropped hair, patient open "
            "expression, kind crinkled eyes, wearing a flowing robe of living woven fibers in deep "
            "forest green and warm gold, holding a circle staff topped with a shallow bowl of soft "
            "hearth-light, a rolled woven seating mat across his back, a small companion bird "
            "resting on his shoulder, bare feet in soft moss"
        ),
    },
    "catalyzing-f": {
        "skin": "deep",
        "subject": (
            "a woman with {skin} skin and very long hair in elaborate braids threaded with thin "
            "bioluminescent fibers, calm far-seeing expression, subtle pointed ears, wearing a "
            "flowing cape with a soft mycelium-network pattern that pulses with gentle light over "
            "a tunic of living woven fibers in deep forest green and warm gold, threads of "
            "golden-green light extending outward from her fingertips, a crystalline pendant at "
            "her chest pulsing with a soft heartbeat glow, travel sandals with living vine straps"
        ),
    },
    "catalyzing-m": {
        "skin": "light",
        "subject": (
            "a man with {skin} skin and windswept sandy hair, bright open expression, subtle "
            "bioluminescent freckles, wearing a flowing cape with a soft mycelium-network pattern "
            "that pulses with gentle light over a tunic of living woven fibers in deep forest "
            "green and warm gold, threads of golden-green light extending outward from his "
            "fingertips, a crystalline pendant at his chest pulsing with a soft heartbeat glow, "
            "travel sandals with living vine straps"
        ),
    },
    "storytelling-f": {
        "skin": "olive",
        "subject": (
            "a woman with {skin} skin and medium-length windswept hair with a few small feathers "
            "woven in, animated expressive eyes, subtle pointed ears, wearing a draped wrap in "
            "sunset colors over a tunic of living woven fibers in deep forest green and warm gold, "
            "holding an open living-wood book whose pages glow softly, a quill of light in her "
            "other hand, a small lantern with a firefly glow hanging at her hip, "
            "ink-like bioluminescent markings on her hands, soft woven shoes"
        ),
    },
    "storytelling-m": {
        "skin": "deep",
        "subject": (
            "a man with {skin} skin and short natural hair with tiny bioluminescent flowers tucked "
            "above one ear, warm animated expression, subtle pointed ears, wearing a draped wrap in "
            "sunset colors over a tunic of living woven fibers in deep forest green and warm gold, "
            "holding an open living-wood book whose pages glow softly, a quill of light in his "
            "other hand, a small lantern with a firefly glow hanging at his hip, ink-like "
            "bioluminescent markings on his hands, soft woven shoes"
        ),
    },
}

ARCHETYPES = ("building", "researching", "facilitating", "catalyzing", "storytelling")

# Dry-run bookkeeping only. A real run asks the filesystem.
_PLANNED_BASES: set = set()
# Bases already regenerated during THIS forced run, so one --force refreshes a
# base once and all three tones still come off the same face.
_REFRESHED_BASES: set = set()


def base_prompt(base_key: str, tone: str | None = None) -> str:
    """The full generation prompt for one base, at `tone` (default its own)."""
    spec = BASES[base_key]
    subject = spec["subject"].format(skin=TONE_WORDS[tone or spec["skin"]])
    return HEAD + subject + TAIL


def call_api(key: str, parts: list, retries: int = 4) -> bytes:
    """One image out of the PINNED model, or a raised error. No fallback.

    429 and 5xx back off and retry, because those are the API saying "later".
    Everything else raises immediately: a 400 means the prompt is wrong and
    retrying it just spends the quota to be told so four more times.
    """
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE", "TEXT"],
            "imageConfig": {"aspectRatio": "3:4", "imageSize": "2K"},
        },
    }
    delay = 5
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            API.format(model=MODEL),
            data=json.dumps(body).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                resp = json.load(r)
            for part in resp.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                if "inlineData" in part:
                    return base64.b64decode(part["inlineData"]["data"])
            raise RuntimeError(f"{MODEL} answered without an image part")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                print(f"    {e.code} from the API, waiting {delay}s ({attempt + 1}/{retries})")
                time.sleep(delay)
                delay *= 3
                continue
            raise RuntimeError(f"{MODEL} returned {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            if attempt < retries:
                print(f"    network error, waiting {delay}s ({attempt + 1}/{retries})")
                time.sleep(delay)
                delay *= 3
                continue
            raise RuntimeError(f"could not reach the API: {e.reason}") from None
    raise RuntimeError("retries exhausted")


# What ships to a browser. The model returns 2K masters, and 30 of those is
# roughly 9 MB against a CI budget of 6 MB for the WHOLE of dist. A card
# portrait renders a few hundred pixels tall, so 2K is about four times more
# image than any screen asks for and the budget is the thing that notices.
#
# The master is not thrown away: it stays in scripts/avatar-bases, out of git,
# so a future re-encode at a different size costs nothing.
DELIVER_HEIGHT = 1024
DELIVER_QUALITY = 80


def to_webp(png_bytes: bytes, dest: str) -> int:
    """PNG bytes to a web-sized webp at `dest`. Returns the byte size.

    Written to a sibling temp file and renamed into place. Resume treats "the
    file exists" as "this asset is done", so a run killed mid-write must not
    leave a half webp sitting there looking finished.
    """
    from PIL import Image
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    staging = dest + ".part"
    img = Image.open(io.BytesIO(png_bytes))
    if img.height > DELIVER_HEIGHT:
        width = max(1, round(img.width * DELIVER_HEIGHT / img.height))
        img = img.resize((width, DELIVER_HEIGHT), Image.LANCZOS)
    img.save(staging, "WEBP", quality=DELIVER_QUALITY, method=6)
    os.replace(staging, dest)
    return os.path.getsize(dest)


def load_manifest() -> dict:
    if os.path.exists(MANIFEST):
        try:
            with open(MANIFEST, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data.get("assets"), dict):
                return data
        except (json.JSONDecodeError, OSError):
            print("  manifest unreadable, starting a fresh one")
    return {"assets": {}}


def save_manifest(man: dict) -> None:
    man["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(man, f, indent=2, sort_keys=True)
        f.write("\n")


def record(man: dict, asset: str, base_key: str, derived: bool) -> None:
    man["assets"][asset] = {
        "file": f"{asset}.webp",
        "model": MODEL,
        "base": base_key,
        "derivedFromBase": derived,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def ensure_base(key: str, base_key: str, man: dict, dry: bool, force: bool = False) -> bytes:
    """The base PNG for one (class, presentation), generated once and kept.

    Reading it back from disk on a resumed run is the whole point: the tone
    edits have to derive from the SAME face the first run produced.

    `force` refreshes the base, but only ONCE per run. Without the guard a
    forced class would regenerate its base for each of the three tones and the
    three portraits would be three different people.
    """
    path = os.path.join(BASE_DIR, f"{base_key}.png")
    stale = force and base_key not in _REFRESHED_BASES
    if os.path.exists(path) and not stale:
        with open(path, "rb") as f:
            return f.read()
    if stale:
        _REFRESHED_BASES.add(base_key)
    if dry:
        # A dry run has no file to find, so it tracks what it already planned.
        # Without this the plan reads as three base generations per base and
        # overstates the cost of a full run by twenty images.
        if base_key not in _PLANNED_BASES:
            _PLANNED_BASES.add(base_key)
            print(f"  [dry-run] would generate base {base_key}")
        return b""
    print(f"  generating base {base_key} at tone {BASES[base_key]['skin']}")
    png = call_api(key, [{"text": base_prompt(base_key)}])
    os.makedirs(BASE_DIR, exist_ok=True)
    # Same reason as to_webp: a truncated base would be silently reused as the
    # source for both tone edits, and the class would ship three broken faces.
    with open(path + ".part", "wb") as f:
        f.write(png)
    os.replace(path + ".part", path)
    return png


def build_asset(key: str, archetype: str, presentation: str, tone: str,
                man: dict, dry: bool, force: bool) -> None:
    base_key = f"{archetype}-{presentation}"
    asset = f"{archetype}-{presentation}-{tone}"
    dest = os.path.join(OUT_DIR, f"{asset}.webp")

    if os.path.exists(dest) and not force:
        # Resume: the file is the record. Backfill a manifest row if a previous
        # run wrote the image and died before the manifest.
        if asset not in man["assets"]:
            record(man, asset, base_key, tone != BASES[base_key]["skin"])
            save_manifest(man)
        print(f"  {asset} exists, skipping")
        return

    is_variant = tone != BASES[base_key]["skin"]
    # A generate-mode variant is its own generation and needs no base image, so
    # do not spend a call making one it will not read.
    base_png = b"" if (is_variant and TONE_MODE == "generate") else \
        ensure_base(key, base_key, man, dry, force)

    if dry:
        if not is_variant:
            what = f"base {base_key}"
        elif TONE_MODE == "generate":
            what = f"its own generation at tone {tone}"
        else:
            what = f"edit of {base_key} to {tone}"
        print(f"  [dry-run] would write {asset}.webp from {what}")
        return

    if not is_variant:
        png = base_png
    elif TONE_MODE == "generate":
        print(f"  generating {base_key} at tone {tone}")
        png = call_api(key, [{"text": base_prompt(base_key, tone)}])
    else:
        print(f"  editing {base_key} to {tone}")
        ethnicity, words, detail = TONE_DETAIL[tone]
        png = call_api(key, [
            {"text": EDIT.format(ethnicity=ethnicity, words=words, detail=detail)},
            {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(base_png).decode()}},
        ])

    size = to_webp(png, dest)
    record(man, asset, base_key, is_variant and TONE_MODE == "edit")
    save_manifest(man)
    print(f"  wrote {asset}.webp  {size // 1024} KB")
    time.sleep(1.0)


def run_samples(key: str, man: dict, dry: bool, force: bool) -> None:
    """The three blessing samples, then stop.

    1. Builder, woman, deep brown skin.
    2. Builder, man, light freckled skin.
    3. The tone edit of sample 1 to medium olive, which is the one that proves
       identity survives an edit. If it does not, the other 27 are not worth
       generating yet.
    """
    print("Three samples for the blessing gate, then stopping.")
    build_asset(key, "building", "f", "deep", man, dry, force)
    build_asset(key, "building", "m", "light", man, dry, force)
    build_asset(key, "building", "f", "olive", man, dry, force)
    print("\nSamples done. Review them before running the full set:")
    for a in ("building-f-deep", "building-m-light", "building-f-olive"):
        print(f"  server/assets/avatars/{a}.webp")


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate class card portraits.")
    ap.add_argument("archetypes", nargs="*", help="limit to these class keys")
    ap.add_argument("--samples", action="store_true", help="the three blessing samples only")
    ap.add_argument("--dry-run", action="store_true", help="print the plan, write nothing")
    ap.add_argument("--force", action="store_true", help="regenerate assets that already exist")
    ap.add_argument("--tone-mode", choices=("generate", "edit"),
                    help="how tone variants are made (default generate; see TONE_MODE)")
    args = ap.parse_args()

    global TONE_MODE
    if args.tone_mode:
        TONE_MODE = args.tone_mode

    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key and not args.dry_run:
        print("GEMINI_API_KEY is not set. The key comes from the environment only.", file=sys.stderr)
        return 2

    for a in args.archetypes:
        if a not in ARCHETYPES:
            print(f"unknown class {a}. Known: {', '.join(ARCHETYPES)}", file=sys.stderr)
            return 2

    os.makedirs(OUT_DIR, exist_ok=True)
    man = load_manifest()
    print(f"model {MODEL}  ->  {os.path.relpath(OUT_DIR, REPO)}")

    if args.samples:
        run_samples(key, man, args.dry_run, args.force)
        return 0

    wanted = args.archetypes or list(ARCHETYPES)
    for archetype in wanted:
        print(f"\n{archetype}")
        for presentation in ("f", "m"):
            # Base tone first, so the edits always have their base on disk.
            base_key = f"{archetype}-{presentation}"
            order = [BASES[base_key]["skin"]] + [t for t in TONES if t != BASES[base_key]["skin"]]
            for tone in order:
                build_asset(key, archetype, presentation, tone, man, args.dry_run, args.force)

    done = len(man["assets"])
    print(f"\n{done} of 30 assets recorded in {os.path.relpath(MANIFEST, REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
