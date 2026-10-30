/**
 * A CIRCLE'S SIX LINES ON THE LIVING MAP (Rye, 2026-10-23: "Great"): six small
 * bars on a plate just outside the circle's rim, lower right, read from the
 * bottom up like every hexagram. A bar is solid when someone in the circle
 * shows that line, and a dashed gold outline when nobody does, so a circle's
 * gaps are visible from the whole-village view.
 *
 * OUTSIDE THE RIM, NOT INSIDE. Seats ring every circle at even spacing and a
 * name sits in its middle, so every spot inside collided with a seat's avatar
 * (seen on the QA map, 2026-10-30). The map already promotes a name outside a
 * circle it does not fit; the glyph takes the same way out. Sized in SCREEN
 * pixels through `px` (world units per pixel), like the map's number key, so it
 * reads the same whatever the camera is doing.
 *
 * Drawn only once at least one holder shows their lines: a circle of hidden
 * members draws nothing, never six empty bars that would read as "nobody here
 * has lines".
 */
import { useEffect, useMemo, useState } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
import { heldLines, shownLinesOf } from "./shownLines";

/** The plate's size and its bars, in screen pixels. */
const PLATE = { w: 22, h: 30, bar: 14, barH: 2.6, gap: 1.8 };

export default function CircleGlyph({ cx, cy, r, px, holderIds }: { cx: number; cy: number; r: number; px: number; holderIds: readonly string[] }) {
  const on = useModuleOn("gene-keys");
  const key = useMemo(() => Array.from(new Set(holderIds)).sort().join(","), [holderIds]);
  const [held, setHeld] = useState<number[] | null>(null);

  useEffect(() => {
    if (!on || !key) return;
    let live = true;
    shownLinesOf(key.split(",")).then((views) => live && setHeld(Object.values(views).some(Boolean) ? heldLines(Object.values(views)) : null));
    return () => {
      live = false;
    };
  }, [on, key]);

  if (!on || !held) return null;
  // Lower right, on the 45-degree line, the plate's near corner just clear of the rim.
  const at = r * Math.SQRT1_2 + 2 * px;
  const left = cx + at, top = cy + at - (PLATE.h * px) / 2;
  const barLeft = left + ((PLATE.w - PLATE.bar) / 2) * px;
  const barTop = top + ((PLATE.h - (6 * PLATE.barH + 5 * PLATE.gap)) / 2) * px;
  return (
    <g role="img" aria-label={`${held.length} of 6 lines shown in this circle`} className="pointer-events-none">
      <rect x={left} y={top} width={PLATE.w * px} height={PLATE.h * px} rx={4 * px} className="fill-background" opacity={0.9} />
      {[1, 2, 3, 4, 5, 6].map((n) => {
        const y = barTop + (6 - n) * (PLATE.barH + PLATE.gap) * px;
        const common = { x: barLeft, y, width: PLATE.bar * px, height: PLATE.barH * px, rx: px };
        return held.includes(n) ? (
          <rect key={n} {...common} className="fill-foreground" />
        ) : (
          <rect key={n} {...common} className="fill-none stroke-notice" strokeWidth={0.8 * px} strokeDasharray={`${2 * px} ${1.4 * px}`} />
        );
      })}
    </g>
  );
}
