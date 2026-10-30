/**
 * A CIRCLE'S SIX LINES ON THE LIVING MAP (Rye, 2026-10-23: "Great"): six small
 * bars under the circle's name, read from the bottom up like every hexagram.
 * A bar is solid when someone in the circle shows that line, and a dashed gold
 * outline when nobody does, so a circle's gaps are visible from the map.
 *
 * Drawn in the map's own world units (the camera scales them) and only once at
 * least one holder shows their lines: a circle of hidden members draws nothing,
 * never six empty bars that would read as "nobody here has lines".
 */
import { useEffect, useMemo, useState } from "react";
import { useModuleOn } from "@/modules/ModuleProvider";
import { heldLines, shownLinesOf } from "./shownLines";

export default function CircleGlyph({ x, top, unit, holderIds }: { x: number; top: number; unit: number; holderIds: readonly string[] }) {
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
  const w = unit * 1.8, h = unit * 0.2, gap = unit * 0.13;
  return (
    <g role="img" aria-label={`${held.length} of 6 lines shown in this circle`} className="pointer-events-none">
      {[1, 2, 3, 4, 5, 6].map((n) => {
        const y = top + (6 - n) * (h + gap);
        return held.includes(n) ? (
          <rect key={n} x={x - w / 2} y={y} width={w} height={h} rx={h / 3} className="fill-foreground" />
        ) : (
          <rect
            key={n}
            x={x - w / 2}
            y={y}
            width={w}
            height={h}
            rx={h / 3}
            className="fill-none stroke-notice"
            strokeWidth={Math.max(0.4, h * 0.22)}
            strokeDasharray={`${h * 0.9} ${h * 0.6}`}
          />
        );
      })}
    </g>
  );
}
