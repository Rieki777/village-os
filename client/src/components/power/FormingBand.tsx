/**
 * THE FORMING BAND, DRAWN (2026-10-23).
 *
 * A circle a village has named and not yet started, with no roles and nothing
 * inside it, rides a band just inside its container's role ring instead of
 * holding a full circle of its own (the geometry is `layoutNestedMap`'s
 * `bands`). Here each one becomes an arc of that band with its name along it,
 * dashed and hatched like every forming thing on the map, so the circles doing
 * the work today hold the middle and what is still forming reads as a horizon.
 *
 * Each arc is a real button: it carries the circle's node id, so the arrow keys
 * walk to it and search lands on it, and `data-circle-id`, so arrange mode can
 * pick it up. Opening one shows its card; the camera stays on the container,
 * because the arc is a part of that picture rather than a place to fly into.
 */
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { NestedBand, NestedCircle } from "@shared/mapLayout";
import { cssColourForCircle } from "@shared/circleView";
import { arcPath } from "./CapacityArc";
import { haloWidth } from "./CircleLabel";
import type { PowerCircle } from "./types";

/** The size a name on the band is drawn at, and the smallest it may shrink to, in screen pixels. */
const NAME_PX = 11;
const MIN_NAME_PX = 9;

/** An arc run anticlockwise, from a0 back to a1 (a0 > a1): the direction a
 *  name on the lower half of a circle has to travel to stand upright. */
function arcBack(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const at = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M ${at(a0)} A ${r} ${r} 0 ${a0 - a1 > Math.PI ? 1 : 0} 0 ${at(a1)}`;
}

/** An annular sector, outer edge clockwise and inner edge back. */
function sector(cx: number, cy: number, inner: number, outer: number, a0: number, a1: number): string {
  const at = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${at(outer, a0)} A ${outer} ${outer} 0 ${large} 1 ${at(outer, a1)} L ${at(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${at(inner, a0)} Z`;
}

/**
 * The word every name on a band ends with, when they all share one ("Council"),
 * so each arc can say only what tells it apart and the band says the rest once.
 */
export function sharedLastWord(names: string[]): string | null {
  if (names.length < 2) return null;
  const last = (n: string) => n.trim().split(/\s+/).pop() ?? "";
  const word = last(names[0]);
  if (!word || names.some((n) => last(n) !== word || n.trim().split(/\s+/).length < 2)) return null;
  return word;
}

/** "8 councils forming", or "8 forming" when the shared word does not take a plain s. */
export function bandCaption(count: number, word: string | null): string {
  const plural = word && !/(s|x|z|ch|sh|y)$/i.test(word) ? ` ${word.toLowerCase()}${count === 1 ? "" : "s"}` : "";
  return `${count}${plural} forming`;
}

/** Fit a name to the room its arc gives it: shrink to the floor, then shorten. */
export function fitBandName(name: string, roomPx: number): { text: string; px: number } {
  const width = (t: string, px: number) => t.length * px * 0.55;
  for (let px = NAME_PX; px >= MIN_NAME_PX; px -= 1) if (width(name, px) <= roomPx) return { text: name, px };
  const max = Math.max(1, Math.floor(roomPx / (MIN_NAME_PX * 0.55)) - 1);
  return { text: `${name.slice(0, max).trimEnd()}…`, px: MIN_NAME_PX };
}

export default function FormingBand({
  bands,
  riders,
  byId,
  pxPerWorld,
  compact,
  keys,
  uid,
  isInteractive,
  showLabel,
  captionY,
  opacityFor,
  focusId,
  hoverId,
  onHover,
  onOpen,
}: {
  bands: NestedBand[];
  /** The layout's circles that ride a band. */
  riders: NestedCircle[];
  byId: Map<string, PowerCircle>;
  pxPerWorld: number;
  compact?: boolean;
  keys?: ReadonlyMap<string, number>;
  /** Unique per map instance: the phone map and the desktop map share one document. */
  uid: string;
  isInteractive: (id: string) => boolean;
  showLabel: (id: string) => boolean;
  /** Where the band's caption sits: just under its container's name, inside the gap the band leaves for it. */
  captionY: (containerId: string | null) => number | null;
  opacityFor: (id: string) => number;
  focusId: string | null;
  hoverId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const unit = pxPerWorld > 0 ? 1 / pxPerWorld : 1;
  return (
    <g data-forming-band>
      {bands.map((band) => {
        const mine = riders.filter((r) => r.band?.containerId === band.containerId);
        const names = mine.map((r) => String(byId.get(r.id)?.name ?? r.id));
        const word = sharedLastWord(names);
        const mid = (band.inner + band.outer) / 2;
        const key = band.containerId ?? "village";
        const captionPx = 10;
        return (
          <g key={key}>
            <path
              d={arcPath(band.x, band.y, mid, -Math.PI / 2 + band.crown, (3 * Math.PI) / 2 - band.crown)}
              fill="none"
              stroke="var(--color-sage)"
              strokeOpacity={0.08}
              strokeWidth={band.outer - band.inner}
              pointerEvents="none"
            />
            {/* What the band is, said once: under its container's name, in the
                gap at the top the band leaves open for that name. */}
            {!compact && captionY(band.containerId) !== null && (
              <text
                x={band.x}
                y={captionY(band.containerId)!}
                textAnchor="middle"
                className="fill-muted-foreground pointer-events-none"
                fontSize={captionPx * unit}
                paintOrder="stroke"
                stroke="var(--background)"
                strokeWidth={haloWidth(captionPx * unit)}
                strokeLinejoin="round"
                data-band-caption
              >
                {bandCaption(mine.length, word)}
              </text>
            )}
            {mine.map((r, i) => {
              const c = byId.get(r.id);
              const b = r.band!;
              const tone = cssColourForCircle({ id: r.id, color: c?.color ?? null });
              const interactive = isInteractive(r.id);
              const isFocus = focusId === r.id;
              const hovered = hoverId === r.id && interactive && !isFocus;
              const full = names[i];
              const short = word ? full.slice(0, full.length - word.length).trim() : full;
              const roomPx = (b.a1 - b.a0) * mid * (pxPerWorld || 1) - 8;
              const fitted = fitBandName(short, roomPx);
              // A name on the lower half would read upside down along a
              // clockwise path, so there it runs the other way.
              const am = (b.a0 + b.a1) / 2;
              const lower = Math.sin(am) > 0.15;
              const pathD = lower ? arcBack(band.x, band.y, mid, b.a1, b.a0) : arcPath(band.x, band.y, mid, b.a0, b.a1);
              return (
                <g key={r.id} opacity={opacityFor(r.id)}>
                  <path
                    id={`power-node-${r.id}`}
                    d={sector(band.x, band.y, band.inner, band.outer, b.a0, b.a1)}
                    fill={tone}
                    fillOpacity={isFocus ? 0.34 : hovered ? 0.26 : 0.14}
                    stroke={tone}
                    strokeOpacity={isFocus ? 0.9 : 0.55}
                    strokeWidth={(isFocus ? 2 : 1.2) * unit}
                    strokeDasharray={`${6 * unit} ${4 * unit}`}
                    className={interactive ? "cursor-pointer focus:outline-none focus-visible:stroke-[3]" : ""}
                    pointerEvents={interactive ? undefined : "none"}
                    data-circle-id={r.id}
                    role="button"
                    tabIndex={interactive ? 0 : -1}
                    aria-label={`${keys?.get(r.id) ? `${keys.get(r.id)}, ` : ""}${full}, forming, no roles yet. Press Enter to open it`}
                    onMouseEnter={() => interactive && onHover(r.id)}
                    onMouseLeave={() => onHover(null)}
                    onClick={(e: ReactMouseEvent) => {
                      e.stopPropagation();
                      onOpen(r.id);
                    }}
                    onKeyDown={(e: ReactKeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onOpen(r.id);
                      }
                    }}
                  />
                  <path d={sector(band.x, band.y, band.inner, band.outer, b.a0, b.a1)} fill={`url(#${uid}-hatch)`} pointerEvents="none" />
                  {compact && keys?.has(r.id) && (
                    <text
                      x={r.x}
                      y={r.y}
                      dy="0.35em"
                      textAnchor="middle"
                      aria-hidden="true"
                      className="fill-foreground font-semibold pointer-events-none"
                      fontSize={13 * unit}
                      paintOrder="stroke"
                      stroke="var(--background)"
                      strokeWidth={3 * unit}
                      strokeLinejoin="round"
                    >
                      {keys.get(r.id)}
                    </text>
                  )}
                  {!compact && (showLabel(r.id) || hovered) && (
                    <>
                      <path id={`${uid}-band-${r.id}`} d={pathD} fill="none" stroke="none" />
                      <text
                        className="fill-foreground font-semibold pointer-events-none"
                        fontSize={fitted.px * unit}
                        dy={`${0.35}em`}
                        paintOrder="stroke"
                        stroke="var(--background)"
                        strokeWidth={haloWidth(fitted.px * unit)}
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <textPath href={`#${uid}-band-${r.id}`} startOffset="50%" textAnchor="middle">
                          {fitted.text}
                        </textPath>
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
