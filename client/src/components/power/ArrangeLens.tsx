/**
 * What arrange mode draws INSIDE the map: a dashed ring on the circle being
 * carried, and a ring on where it would land, either a circle or the village's
 * own edge for the top of the village.
 *
 * Rendered through PowerMap's `lenses` seam, in world coordinates, so it moves
 * with the camera and the pinch the way every other lens does, and nothing
 * here does geometry the layout has not already done.
 *
 * A REFUSED LANDING IS NEVER COLOUR ALONE. It draws dotted and thin where an
 * accepted one draws solid and heavy, the same rule the seat glyphs follow, so
 * the difference survives greyscale and a reader who does not see the hue.
 */
import type { NestedLayout } from "@shared/mapLayout";
import { MAP_CHROME } from "@shared/circleView";

export default function ArrangeLens({
  layout,
  picked,
  target,
  refused,
}: {
  layout: NestedLayout;
  picked: string | null;
  /** A circle id, "" for the top of the village, or null for nowhere. */
  target: string | null;
  /** True when landing on `target` would be refused. */
  refused: boolean;
}) {
  const at = (id: string) => layout.circles.find((c) => c.id === id) ?? null;
  const carried = picked ? at(picked) : null;
  const into = target ? at(target) : null;
  const toTop = target === "";
  const landing = refused
    ? { stroke: MAP_CHROME.inkDim, strokeWidth: 2, strokeDasharray: "2 5" }
    : { stroke: MAP_CHROME.ring, strokeWidth: 4, strokeDasharray: undefined };

  return (
    <g pointerEvents="none" data-arrange-lens>
      {carried && (
        <circle
          cx={carried.x}
          cy={carried.y}
          r={carried.r + 5}
          fill="none"
          stroke={MAP_CHROME.ink}
          strokeWidth={2.5}
          strokeDasharray="7 5"
        />
      )}
      {into && <circle cx={into.x} cy={into.y} r={into.r + 8} fill="none" {...landing} />}
      {toTop && (
        <circle
          cx={layout.village.x}
          cy={layout.village.y}
          r={Math.max(0, layout.village.r - 6)}
          fill="none"
          {...landing}
          strokeDasharray={refused ? "2 5" : "12 7"}
        />
      )}
    </g>
  );
}
