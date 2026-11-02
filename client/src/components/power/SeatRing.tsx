/**
 * A CIRCLE'S ROLES ON THE MAP: a meter from afar, the glyphs up close.
 *
 * Moved out of `PowerMap.tsx` (2026-10-23) when the capacity arc came in and
 * that file stood at 950 of its 1000 lines. Two pictures of the same roles:
 *
 *   arc     the circle's border as a meter (CapacityArc). What a circle shows
 *           while the reader is looking at the whole village, where a glyph is
 *           a few pixels across and said only "something is here".
 *   glyphs  one SeatGlyph per role, with faces, term arcs, the link ring and
 *           its own tap area: what a circle shows once the reader steps into
 *           it (Rye, 2026-10-23: "arc far, glyphs close").
 *
 * The double link, a role that speaks for its circle in the one above, is drawn
 * in both: from the glyph up close, and from that role's own segment of the arc
 * from afar, so the structure that holds the village together never disappears.
 */
import { m } from "framer-motion";
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { NestedCircle } from "@shared/mapLayout";
import SeatGlyph, { HitArea, seatStateWords } from "./SeatGlyph";
import { TermArc } from "./TermMarkers";
import CapacityArc, { arcFor } from "./CapacityArc";
import type { PowerSeat, Selection } from "./types";

export default function SeatRing({
  pos,
  circleName,
  tone,
  glyphs,
  interactive,
  anchor,
  seatById,
  seatPasses,
  showFaces,
  seatHits,
  selected,
  onSelect,
  pulseSeatId,
  showQuestOverflow,
  pxPerWorld,
  morph,
}: {
  pos: NestedCircle;
  circleName: string;
  tone: string;
  /** Up close: one glyph per role. Otherwise the border as a meter. */
  glyphs: boolean;
  interactive: boolean;
  /** Where a role that speaks for this circle links to: the circle above, or the village. */
  anchor: { x: number; y: number } | null;
  seatById: Map<string, PowerSeat>;
  seatPasses: (seat: PowerSeat | undefined) => boolean;
  showFaces: boolean;
  seatHits: Map<string, number>;
  selected: Selection;
  onSelect: (sel: Selection) => void;
  pulseSeatId?: string | null;
  showQuestOverflow: boolean;
  pxPerWorld: number;
  morph: object;
}) {
  const roles = pos.roles.map((rp) => seatById.get(rp.id)).filter((s): s is PowerSeat => !!s);

  // Where each linking role meets the circle: its glyph up close, the middle of
  // its first segment of the arc from afar.
  const linkFrom = new Map<string, { x: number; y: number }>();
  if (glyphs) {
    for (const rp of pos.roles) linkFrom.set(rp.id, { x: rp.x, y: rp.y });
  } else {
    for (const s of arcFor(roles, pos.r, pxPerWorld)) {
      if (linkFrom.has(s.roleId)) continue;
      const a = (s.a0 + s.a1) / 2;
      linkFrom.set(s.roleId, { x: pos.x + pos.r * Math.cos(a), y: pos.y + pos.r * Math.sin(a) });
    }
  }

  return (
    <>
      {/* ── THE DOUBLE LINK, DRAWN ────────────────────────────────
          Sociocracy's one structural idea that a normal org chart
          cannot show: a circle is joined to its parent by a PERSON
          who sits in both. `representsCircle` marks that seat, and
          it has been on the wire since 0083 and said out loud only
          in the holder card, as a sentence, one seat at a time. A
          reader looking at the whole village could not see which
          seats hold it together.

          So the seat is joined to the circle it speaks into. Drawn
          before the glyphs, so the line passes UNDER them, and
          dashed so it never reads as the containment the solid
          rings mean. */}
      {anchor &&
        roles.map((seat) => {
          const from = linkFrom.get(seat.id);
          if (!seat.representsCircle || !from) return null;
          return (
            <line
              key={`dbl-${seat.id}`}
              x1={from.x}
              y1={from.y}
              x2={anchor.x}
              y2={anchor.y}
              stroke={tone}
              strokeOpacity={seatPasses(seat) ? 0.5 : 0.12}
              strokeWidth={1.6}
              strokeDasharray="5 4"
              pointerEvents="none"
            />
          );
        })}

      {!glyphs && <CapacityArc cx={pos.x} cy={pos.y} r={pos.r} roles={roles} tone={tone} pxPerWorld={pxPerWorld} />}

      {/* The seats on this circle's ring, once the reader is close enough for them. */}
      {glyphs &&
        pos.roles.map((rp) => {
          const seat = seatById.get(rp.id);
          const dotR = pos.depth === 0 ? 11 : 9;
          const pass = seatPasses(seat);
          const words = seat ? seatStateWords(seat.state, seat.holderCount, seat.seats) : "";
          return (
            <m.g
              key={rp.id}
              animate={{ x: rp.x, y: rp.y, opacity: pass ? 1 : 0.2 }}
              initial={false}
              transition={morph}
              className="cursor-pointer focus:outline-none"
              role="button"
              tabIndex={interactive ? 0 : -1}
              pointerEvents={interactive ? undefined : "none"}
              aria-label={`${seat?.name ?? rp.id}, a role in ${circleName}, ${words}${
                seat?.representsCircle ? ", and it speaks for this circle where it links out" : ""
              }. Press Enter to open it`}
              onClick={(e: ReactMouseEvent) => {
                // A tap on a seat NEVER moves the camera (spec 1).
                e.stopPropagation();
                onSelect({ kind: "role", id: rp.id });
              }}
              onKeyDown={(e: ReactKeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect({ kind: "role", id: rp.id });
                }
              }}
            >
              {/* The tap area, which is bigger than the dot and carries
                  no ink. Drawn first, so it sits UNDER the glyph and
                  cannot cover the face on a held seat. */}
              <HitArea r={seatHits.get(rp.id) ?? dotR} drawn={dotR} />
              <SeatGlyph
                x={0}
                y={0}
                r={dotR}
                state={seat?.state}
                held={seat?.holderCount ?? 0}
                seats={seat?.seats ?? 1}
                holders={seat?.holders ?? []}
                showAvatars={showFaces}
                pulse={pulseSeatId === rp.id}
              />
              <TermArc x={0} y={0} r={dotR} termEnds={seat?.termEnds} />
              {/* The representative's badge, at the far end of the link
                  drawn above. A second ring, so the mark survives
                  greyscale and never depends on colour alone (spec 4's
                  rule, applied to representation as well as to state). */}
              {seat?.representsCircle && (
                <circle cx={0} cy={0} r={dotR + 4} fill="none" stroke={tone} strokeOpacity={0.85} strokeWidth={1.4} pointerEvents="none" />
              )}
              {selected?.kind === "role" && selected.id === rp.id && (
                <circle cx={0} cy={0} r={dotR + 3} fill="none" stroke="var(--color-teal-deep)" strokeWidth={1.6} />
              )}
            </m.g>
          );
        })}

      {/* Quests are not roles: they draw in the page's own ink, so amber on
          this map means one thing, an opening waiting for someone. */}
      {pos.questDots.map((q, i) => (
        <circle key={i} cx={q.x} cy={q.y} r={4} className="fill-foreground/45 pointer-events-none" />
      ))}
      {pos.questOverflow > 0 && showQuestOverflow && (
        <text x={pos.x} y={pos.y + pos.r - 10} textAnchor="middle" className="fill-muted-foreground pointer-events-none" style={{ fontSize: 10 }}>
          +{pos.questOverflow} more quests
        </text>
      )}
    </>
  );
}
