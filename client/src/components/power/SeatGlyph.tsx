/**
 * One seat, five states, five GLYPHS (0083, spec 4): colour never carries a
 * state alone, because a fifth of men reading this map do not see the
 * difference between the colours that would.
 *
 *   open     dashed hollow ring with a small plus
 *   partial  solid ring, a pie of held over needed, a notch per empty seat
 *   filled   solid ring, avatars inside, up to three then a +n
 *   forming  dotted ring at half opacity with an hourglass
 *   expired  solid ring, greyed holder, a clock badge
 *
 * Pure SVG fragments, positioned by the caller. The <title> repeats the
 * state in words for hover; the OWNING <g> carries the aria-label, because
 * the glyph is drawing, not interaction.
 */
import { useId } from "react";
import type { PowerHolder, SeatStateWord } from "./types";

/** An arc path from angle a0 to a1 (radians, clockwise) on radius r. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** A filled pie wedge from the top, `fraction` of the way round. */
function piePath(cx: number, cy: number, r: number, fraction: number): string {
  const a0 = -Math.PI / 2;
  const a1 = a0 + 2 * Math.PI * Math.min(0.9999, Math.max(0, fraction));
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

export function seatStateWords(state: SeatStateWord | undefined, held: number, seats: number): string {
  switch (state) {
    case "open":
      return "open call, nobody holds this yet";
    case "partial":
      return `partly held, ${held} of ${seats}`;
    case "forming":
      return "forming";
    case "expired":
      return "held, and the term has run out";
    default:
      return seats > 1 ? `held, ${held} of ${seats}` : "held";
  }
}

export default function SeatGlyph({
  x,
  y,
  r,
  state,
  held,
  seats,
  holders,
  showAvatars,
  pulse,
}: {
  x: number;
  y: number;
  r: number;
  state: SeatStateWord | undefined;
  held: number;
  seats: number;
  holders: PowerHolder[];
  /** Faces ride the viewPeople tier AND the performance rule (spec 13). */
  showAvatars: boolean;
  /** A search pick lands here: one attention ring, then quiet. */
  pulse?: boolean;
}) {
  /*
   * ONE ID PER RENDERED GLYPH, because an SVG id is document-wide.
   *
   * The clip id was built from the holder and the seat coordinates, and
   * BOTH map call sites pass `x={0} y={0}` and place the glyph with a
   * transform. So every seat on the map produced the same string:
   * `seat-face-<userId>-0-0`. A person holding two seats put two
   * clipPaths with one id into the document, and `url(#id)` resolves to
   * the FIRST in document order.
   *
   * It looked fine because the geometry also matched, so the wrong clip
   * and the right clip were the same shape. They stop matching the moment
   * the two seats fan a different number of faces: alone a face fills the
   * seat, one of three sits at 62% off-centre, and the second seat would
   * then be clipped by the first seat's circle. Rare while few people hold
   * two seats; ordinary once faces can be dragged onto seats.
   *
   * `useId` is per component INSTANCE, which is exactly the scope an SVG
   * id needs. Stripped to alphanumerics because React returns `:r1:` and a
   * colon has no business in a fragment reference.
   */
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const s: SeatStateWord = state ?? (held > 0 ? "filled" : "open");
  const stroke = "var(--color-teal-deep)";

  const avatars = showAvatars ? holders.filter((h) => h.avatar).slice(0, 3) : [];
  const overflow = Math.max(0, held - (avatars.length || held > 0 ? Math.min(held, 3) : 0));
  const greyed = s === "expired";

  return (
    <g>
      <title>{seatStateWords(s, held, seats)}</title>
      {pulse && (
        <circle cx={x} cy={y} r={r + 3} fill="none" stroke="var(--color-amber)" strokeWidth={2.5}>
          <animate attributeName="r" values={`${r + 3};${r + 10};${r + 3}`} dur="1.2s" repeatCount="3" />
          <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="3" />
        </circle>
      )}

      {s === "open" && (
        <>
          <circle cx={x} cy={y} r={r} fill="var(--color-parchment, #fff)" stroke="var(--color-muted-foreground, #6b7280)" strokeWidth={2} strokeDasharray="3 3" />
          <path
            d={`M ${x - r * 0.45} ${y} H ${x + r * 0.45} M ${x} ${y - r * 0.45} V ${y + r * 0.45}`}
            stroke="var(--color-muted-foreground, #6b7280)"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      )}

      {s === "partial" && (
        <>
          <circle cx={x} cy={y} r={r} fill="var(--color-parchment, #fff)" stroke={stroke} strokeWidth={2} />
          <path d={piePath(x, y, r - 2.5, seats > 0 ? held / seats : 0)} fill={stroke} opacity={0.85} />
          {/* A hairline notch per EMPTY seat, spread on the lower arc: the
              count is readable without a legend. */}
          {Array.from({ length: Math.max(0, Math.min(6, seats - held)) }, (_, i) => {
            const a = Math.PI / 2 + (i - (Math.min(6, seats - held) - 1) / 2) * 0.5;
            return (
              <line
                key={i}
                x1={x + (r - 3) * Math.cos(a)}
                y1={y + (r - 3) * Math.sin(a)}
                x2={x + (r + 2) * Math.cos(a)}
                y2={y + (r + 2) * Math.sin(a)}
                stroke={stroke}
                strokeWidth={1.4}
              />
            );
          })}
        </>
      )}

      {s === "forming" && (
        <g opacity={0.5}>
          <circle cx={x} cy={y} r={r} fill="var(--color-parchment, #fff)" stroke={stroke} strokeWidth={2} strokeDasharray="1.5 3" />
          {/* The hourglass: two triangles meeting at the waist. */}
          <path
            d={`M ${x - r * 0.4} ${y - r * 0.5} H ${x + r * 0.4} L ${x - r * 0.4} ${y + r * 0.5} H ${x + r * 0.4} Z`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
        </g>
      )}

      {(s === "filled" || s === "expired") && (
        <>
          <circle
            cx={x}
            cy={y}
            r={r}
            fill={avatars.length ? "var(--color-parchment, #fff)" : "var(--color-teal-deep)"}
            stroke={greyed ? "var(--color-muted-foreground, #6b7280)" : "white"}
            strokeWidth={2}
            opacity={greyed ? 0.75 : 1}
          />
          {avatars.map((h, i) => {
            // Up to three faces fanned inside the seat; alone, one fills it.
            const fr = avatars.length === 1 ? r - 1.5 : r * 0.62;
            const fa = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, avatars.length);
            const fx = avatars.length === 1 ? x : x + (r - fr) * Math.cos(fa);
            const fy = avatars.length === 1 ? y : y + (r - fr) * Math.sin(fa);
            const clip = `seat-face-${uid}-${i}`;
            return (
              <g key={h.userId ?? i} opacity={greyed || h.lapsed ? 0.45 : 1}>
                <clipPath id={clip}>
                  <circle cx={fx} cy={fy} r={fr} />
                </clipPath>
                <image
                  href={h.avatar!}
                  x={fx - fr}
                  y={fy - fr}
                  width={fr * 2}
                  height={fr * 2}
                  clipPath={`url(#${clip})`}
                  preserveAspectRatio="xMidYMid slice"
                />
                <circle cx={fx} cy={fy} r={fr} fill="none" stroke="white" strokeWidth={1} />
              </g>
            );
          })}
          {held > 3 && showAvatars && (
            <text x={x + r + 2} y={y + r * 0.5} fontSize={r * 0.9} className="fill-muted-foreground">
              +{held - 3}
            </text>
          )}
          {s === "expired" && (
            <g aria-hidden="true">
              {/* The clock badge, riding the rim. */}
              <circle cx={x + r * 0.85} cy={y - r * 0.85} r={r * 0.55} fill="white" stroke={stroke} strokeWidth={1.2} />
              <line x1={x + r * 0.85} y1={y - r * 0.85} x2={x + r * 0.85} y2={y - r * 1.15} stroke={stroke} strokeWidth={1.1} strokeLinecap="round" />
              <line x1={x + r * 0.85} y1={y - r * 0.85} x2={x + r * 1.06} y2={y - r * 0.78} stroke={stroke} strokeWidth={1.1} strokeLinecap="round" />
            </g>
          )}
        </>
      )}
    </g>
  );
}
