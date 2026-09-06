/**
 * A WINDOW ONTO THE MAP, ON THE CIRCLES PAGE.
 *
 * The cards page lists what every circle is. The map shows how they sit
 * together, which a column of cards cannot. This is the door between them:
 * the REAL circles at their REAL layout positions in their REAL colours,
 * drawn small, with one link through to `/map/circles`.
 *
 * It renders live data rather than a saved picture, so it cannot go stale
 * against the village it is describing. Both surfaces read the same rows
 * through the same projection (`shared/circleView.ts`), so a circle added
 * this morning is in this picture and on the map without anybody exporting
 * anything.
 *
 * WHY IT DOES NOT MOUNT `PowerMap`. That component carries framer-motion,
 * the camera, five seat glyphs, relation lines, term arcs and the keyboard
 * and screen-reader paths, none of which a 200px thumbnail can use, and all
 * of which would land in the `/circles` route's chunk. This draws circles.
 * It shares the LAYOUT and the PALETTE with the real map, which is what
 * makes the two agree; it shares no machinery, which is what keeps it cheap.
 *
 * It is deliberately not interactive. One link, one destination. A thumbnail
 * that half-responds to taps teaches people the map is broken.
 */
import { Link } from "wouter";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { layoutNestedMap, type NestedInput } from "@shared/mapLayout";
import { cssColourForCircle, MAP_CHROME } from "@shared/circleView";

export interface MiniCircle {
  id: string;
  name: string;
  color?: string | null;
  parentCircleId?: string | null;
  order?: number;
}

export interface MiniSeat {
  id: string;
  circleId?: string | null;
  seats?: number;
  holderCount?: number;
}

/* The ground the map draws on, so this reads as a window and not a card.
   Themeable with a shipped default (shared/circleView.ts): a fork sets
   --circle-ground and this window follows its map. */
const { ground: GROUND, ring: RING, ink: INK, inkDim: INK_DIM, scrim: SCRIM } = MAP_CHROME;

export default function CirclesMiniMap({
  circles,
  seats,
}: {
  circles: MiniCircle[];
  seats: MiniSeat[];
}) {
  const { layout, byId, openSeats } = useMemo(() => {
    const seatsByCircle = new Map<string, MiniSeat[]>();
    for (const s of seats) {
      const key = String(s.circleId ?? "");
      if (!key) continue;
      const list = seatsByCircle.get(key) ?? [];
      list.push(s);
      seatsByCircle.set(key, list);
    }
    const inputs: NestedInput[] = circles.map((c, i) => {
      const mine = seatsByCircle.get(c.id) ?? [];
      return {
        id: c.id,
        name: c.name,
        parentId: c.parentCircleId ?? null,
        order: Number(c.order ?? i),
        memberCount: mine.reduce((n, s) => n + Number(s.holderCount ?? 0), 0),
        questCount: 0,
        roles: mine.map((s) => ({
          id: s.id,
          vacant: Number(s.holderCount ?? 0) < Number(s.seats ?? 1),
        })),
      };
    });
    return {
      layout: layoutNestedMap(inputs),
      byId: new Map(circles.map((c) => [c.id, c])),
      openSeats: seats.reduce(
        (n, s) => n + Math.max(0, Number(s.seats ?? 1) - Number(s.holderCount ?? 0)),
        0,
      ),
    };
  }, [circles, seats]);

  if (!circles.length) return null;

  const v = layout.village;
  // A square window onto a square drawing, so nothing is cropped and nothing
  // is letterboxed. The pad clears the seat dots that ride on the boundary.
  const pad = 14;
  const size = Math.max(1, v.r * 2 + pad * 2);
  const viewBox = `${v.x - v.r - pad} ${v.y - v.r - pad} ${size} ${size}`;

  return (
    <Link
      href="/map/circles"
      className="group block rounded-2xl overflow-hidden border border-border no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sage focus-visible:ring-offset-2"
      aria-label={`Open the living map of the circles. ${circles.length} circles, ${openSeats} seats open.`}
    >
      <div className="relative" style={{ background: GROUND }}>
        <svg
          viewBox={viewBox}
          className="w-full h-auto block"
          style={{ aspectRatio: "1 / 1", maxHeight: 340 }}
          role="img"
          aria-hidden="true"
          focusable="false"
        >
          {/* the village ring */}
          <circle cx={v.x} cy={v.y} r={v.r} fill="none" stroke={RING} strokeOpacity={0.34} strokeWidth={3} />
          {layout.circles.map((pos) => {
            const c = byId.get(pos.id);
            const hue = cssColourForCircle({ id: pos.id, color: c?.color ?? null });
            return (
              <g key={pos.id}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.r}
                  fill={hue}
                  fillOpacity={0.18}
                  stroke={hue}
                  strokeOpacity={0.85}
                  strokeWidth={2.2}
                />
                {/* the seats on the ring: filled is solid, open is hollow */}
                {pos.roles.map((rp) => (
                  <circle
                    key={rp.id}
                    cx={rp.x}
                    cy={rp.y}
                    r={5.5}
                    fill={rp.vacant ? GROUND : hue}
                    stroke={hue}
                    strokeOpacity={0.9}
                    strokeWidth={rp.vacant ? 1.6 : 0}
                    strokeDasharray={rp.vacant ? "3 3" : undefined}
                  />
                ))}
              </g>
            );
          })}
          <circle cx={v.x} cy={v.y} r={Math.max(10, v.r * 0.07)} fill={INK} fillOpacity={0.5} />
        </svg>

        {/* The invitation. It sits ON the picture so the whole tile reads as
            one door, and it carries the two counts a reader wants before
            deciding to walk through. */}
        <div
          className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between gap-3"
          style={{ background: SCRIM }}
        >
          <div>
            <div className="font-semibold text-[15px]" style={{ color: INK }}>
              Walk the circles on the living map
            </div>
            <div className="text-[13px]" style={{ color: INK_DIM }}>
              {circles.length} circle{circles.length === 1 ? "" : "s"}
              {openSeats > 0 ? `, ${openSeats} seat${openSeats === 1 ? "" : "s"} open` : ""}. Step inside any one of them.
            </div>
          </div>
          <ArrowRight
            className="w-5 h-5 shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
            style={{ color: RING }}
            aria-hidden="true"
          />
        </div>
      </div>
    </Link>
  );
}
