/**
 * What arrange mode draws INSIDE the map: a dashed ring on the circle being
 * carried, a ring on where it would land (a circle, or the village's own edge
 * for the top of the village), and, while a circle is carried, the places it
 * can be put in its own ring (0286).
 *
 * Rendered through PowerMap's `lenses` seam, in world coordinates, so it moves
 * with the camera and the pinch the way every other lens does, and nothing
 * here does geometry the layout has not already done.
 *
 * A REFUSED LANDING IS NEVER COLOUR ALONE. It draws dotted and thin where an
 * accepted one draws solid and heavy, the same rule the role glyphs follow, so
 * the difference survives greyscale and a reader who does not see the hue.
 *
 * A LANDING IS DRAWN ONLY WHILE SOMETHING IS CARRIED. A drag that Escape put
 * down still moves the pointer across circles, and a ring there would promise a
 * drop that is not going to happen.
 *
 * THE DROP TARGETS (0286, Rye: org designers and the founder and steward roles
 * "drag and drop the orientation"). The middle of the carried circle's
 * container: let go there and it becomes the lead, the circle that holds the
 * middle. And a slot between each two neighbours round the ring: let go there
 * and the ring reads in that order. Each target carries the ring as it would
 * read after the drop (`data-arrange-slot`), so the hook lands it without
 * redoing this geometry. They are the only things in this lens that take a
 * pointer, and they draw above the circles so they win the hit test.
 */
import type { NestedLayout } from "@shared/mapLayout";
import { MAP_CHROME } from "@shared/circleView";

type Circle = { id: string; parentCircleId?: string | null; layer?: string | null; isExample?: boolean };

export interface ArrangeSlot {
  key: string;
  x: number;
  y: number;
  r: number;
  kind: "middle" | "order";
}

/**
 * Where the carried circle can be put in its own ring, from the layout: the
 * middle of its container (unless it already holds it), and one slot between
 * each two neighbours, clockwise from twelve. Pure, so it is tested alone.
 */
export function arrangeSlots(layout: NestedLayout, circles: Circle[], picked: string): ArrangeSlot[] {
  const pos = new Map(layout.circles.map((c) => [c.id, c]));
  const carried = circles.find((c) => c.id === picked);
  const at = pos.get(picked);
  if (!carried || !at || at.band || carried.isExample) return [];
  const parentId = carried.parentCircleId ?? null;
  const box = parentId ? pos.get(parentId) : layout.village;
  if (!box) return [];
  const clock = (p: { x: number; y: number }) => {
    const a = Math.atan2(p.x - box.x, -(p.y - box.y));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const siblings = circles
    .filter((c) => c.id !== picked && (c.parentCircleId ?? null) === parentId)
    .map((c) => ({ c, p: pos.get(c.id) }))
    .filter((s): s is { c: Circle; p: NonNullable<ReturnType<typeof pos.get>> } => !!s.p && !s.p.band);
  const centre = siblings.find((s) => Math.hypot(s.p.x - box.x, s.p.y - box.y) < 1);
  const ring = siblings.filter((s) => s !== centre).sort((a, b) => clock(a.p) - clock(b.p));
  const slotR = Math.max(10, Math.min(28, box.r * 0.06));
  const slots: ArrangeSlot[] = [];
  const holdsMiddle = Math.hypot(at.x - box.x, at.y - box.y) < 1;
  if (!holdsMiddle) slots.push({ key: "middle", x: box.x, y: box.y, r: slotR * 1.4, kind: "middle" });
  if (ring.length) {
    const radius = ring.reduce((s, x) => s + Math.hypot(x.p.x - box.x, x.p.y - box.y), 0) / ring.length;
    const ids = ring.map((x) => x.c.id);
    for (let i = 0; i < ring.length; i++) {
      const a0 = clock(ring[i].p);
      const a1 = i + 1 < ring.length ? clock(ring[i + 1].p) : clock(ring[0].p) + 2 * Math.PI;
      const mid = (a0 + a1) / 2;
      // After the last one round the clock is the same place as before the first: the start of the ring.
      const sequence = i + 1 < ring.length ? [...ids.slice(0, i + 1), picked, ...ids.slice(i + 1)] : [picked, ...ids];
      slots.push({
        key: `order|${parentId ?? ""}|${sequence.join(",")}`,
        x: box.x + radius * Math.sin(mid),
        y: box.y - radius * Math.cos(mid),
        r: slotR,
        kind: "order",
      });
    }
  }
  return slots;
}

export default function ArrangeLens({
  layout,
  circles,
  picked,
  target,
  refused,
  onSlot,
}: {
  layout: NestedLayout;
  /** The circles as the pending moves leave them. */
  circles: Circle[];
  picked: string | null;
  /** A circle id, "" for the top of the village, "slot:..." for a drop target, or null for nowhere. */
  target: string | null;
  /** True when landing on `target` would be refused. */
  refused: boolean;
  /** A drop target was clicked while a circle is carried. */
  onSlot?: (where: string) => void;
}) {
  const at = (id: string) => layout.circles.find((c) => c.id === id) ?? null;
  const carried = picked ? at(picked) : null;
  const into = picked && target && !target.startsWith("slot:") ? at(target) : null;
  const toTop = !!picked && target === "";
  const landing = refused
    ? { stroke: MAP_CHROME.inkDim, strokeWidth: 2, strokeDasharray: "2 5" }
    : { stroke: MAP_CHROME.ring, strokeWidth: 4, strokeDasharray: undefined };
  const slots = picked ? arrangeSlots(layout, circles, picked) : [];

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
      {slots.map((s) => {
        const hot = target === `slot:${s.key}`;
        return (
          <g key={s.key}>
            <circle
              cx={s.x}
              cy={s.y}
              r={s.r}
              data-arrange-slot={s.key}
              aria-label={s.kind === "middle" ? "The middle" : "A place in the ring"}
              pointerEvents="all"
              fill={MAP_CHROME.ring}
              fillOpacity={hot ? 0.45 : 0.15}
              stroke={MAP_CHROME.ring}
              strokeWidth={hot ? 3 : 1.5}
              strokeDasharray={s.kind === "middle" ? undefined : "4 3"}
              onClick={(e) => {
                e.stopPropagation();
                onSlot?.(`slot:${s.key}`);
              }}
            />
            {s.kind === "middle" && (
              <circle cx={s.x} cy={s.y} r={s.r * 0.35} fill={MAP_CHROME.ring} fillOpacity={hot ? 0.9 : 0.5} pointerEvents="none" />
            )}
          </g>
        );
      })}
    </g>
  );
}
