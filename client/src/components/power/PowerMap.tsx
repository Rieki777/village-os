/**
 * The power map's canvas (0083): one SVG renderer for every shape.
 *
 * The 14-point interaction spec, drawn:
 *   1  tap a circle to fly into it; tap the focused ring or the backdrop to
 *      go out one level; a tap on a SEAT never moves the camera.
 *   3  focus + context: siblings and ancestors stay at 30%, non-interactive
 *      except the parent ring; only children of the focus carry labels
 *      (Bostock's parent === focus rule), so forty circles stay legible.
 *   4  five seat states as five glyphs (SeatGlyph), colour never alone.
 *   7  filters dim everything else to 20% instead of hiding it.
 *   8  relation lines on demand, for the focused circle only.
 *   9  term arcs and the season ring (TermMarkers).
 *  11  every circle and seat is a real button: tabindex 0, an aria-label
 *      carrying state, Enter zooms/opens, Esc zooms out, arrows walk
 *      siblings, and a live region says where you are now.
 *  13  above 400 seats, faces draw only inside the focus.
 *
 * `lenses` renders INSIDE the SVG after the seats: lane L3 draws the
 * resources lens there without touching this file, using the same layout
 * (which takes a `pad` for the outer ring).
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { motion } from "framer-motion";
import { wrapLabel, type NestedLayout } from "@shared/mapLayout";
import { cssColourForCircle } from "@shared/circleView";
import { transition, viewBoxFor, viewFor, type CameraTarget, type CameraView } from "./camera";
import SeatGlyph, { seatStateWords } from "./SeatGlyph";
import { captionSize, fitLabelToScreen } from "./labelFit";
import { TermArc, SeasonRing } from "./TermMarkers";
import RelationLines, { RelationArrowDef } from "./RelationLines";
import type { Filters, PowerData, PowerSeat, Selection } from "./types";
import { anyFilterOn, seatPassesFilters } from "./types";

/** Faces stop drawing outside the focus past this many seats (spec 13). */
const AVATAR_SEAT_CAP = 400;

/*
 * ── HOW BIG THIS PICTURE ACTUALLY DRAWS, AND WHY IT WAS HALF SIZE ──────────
 *
 * The layout is a circle PACKING, so its content is a disc and its canvas is
 * the square that hugs that disc. The SVG then fits that square into the
 * element's real box with `xMidYMid meet`, which scales to whichever side is
 * smaller. On a desktop column the box is landscape (measured 864x533), so
 * the height wins, the whole drawing renders at 0.51x, and 331px of width
 * (38% of the canvas) sits empty on either side of the disc.
 *
 * The viewBox was asking for the LAYOUT's aspect, which is 1 by construction
 * and therefore told the browser nothing about the space available. Handing
 * it the CONTAINER's aspect does two things: the world coordinate system now
 * covers the full box, and the space beside the disc becomes addressable
 * world space instead of dead margin. That space is where a name too long for
 * its circle goes.
 *
 * It does NOT on its own make the disc bigger. A disc in a short wide box is
 * height-limited whatever the viewBox says, which is why `md:h-[74vh]` moved
 * too: the stage was capped at 533px while 864px wide.
 */
function useMeasuredBox(el: SVGSVGElement | null): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const r = el.getBoundingClientRect();
      // Round before comparing: a fractional resize that changes nothing
      // visible would otherwise re-render on every scroll on some browsers.
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      setBox((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return box;
}

// The label floor lives in `labelFit.ts` so it can be tested without a
// browser. See that file for why a world-unit floor was the wrong floor.

/*
 * EVERY CIRCLE GETS ITS OWN COLOUR, AND SEVENTEEN OF THEM USED TO GET ONE.
 *
 * This was a four-entry `Record<string, string>` keyed by bare tone words
 * (sage, amber, coral, teal) with `?? var(--color-teal-deep)` on the end.
 * The seed writes eight words, four of which (rose, stone, sky, emerald)
 * were not in it, and the admin form writes Tailwind classes (`bg-sage`),
 * which matched nothing at all. So most circles fell to the fallback and the
 * map drew one grey, throwing away the strongest wayfinding signal it owns.
 *
 * `cssColourForCircle` resolves both vocabularies onto a union the compiler
 * checks, and the hues are the living map artifact's own `CIRCLE_COL`, so
 * the two lenses agree about what colour a circle is.
 */
const toneOf = (c: any): string => cssColourForCircle({ id: String(c?.id ?? ""), color: c?.color ?? null });

export default function PowerMap({
  data,
  layout,
  shape,
  focusId,
  onFocus,
  selected,
  onSelect,
  filters,
  viewerUserId,
  linesOn,
  pulseSeatId,
  lenses,
  svgRef,
}: {
  data: PowerData;
  layout: NestedLayout;
  shape: string;
  focusId: string | null;
  onFocus: (id: string | null) => void;
  selected: Selection;
  onSelect: (sel: Selection) => void;
  filters: Filters;
  viewerUserId: string | null;
  linesOn: boolean;
  /** A search pick pulses this seat once (spec 6). */
  pulseSeatId?: string | null;
  /** Lenses drawn inside the SVG after the seats (L3's seam). */
  lenses?: ReactNode;
  /** The page exports SVG/PNG from this element (spec 14). */
  svgRef?: RefObject<SVGSVGElement | null>;
}) {
  const byId = useMemo(() => new Map(data.circles.map((c) => [c.id, c])), [data.circles]);
  const posById = useMemo(() => new Map(layout.circles.map((p) => [p.id, p])), [layout]);
  const seatById = useMemo(() => new Map(data.roles.map((r) => [r.id, r])), [data.roles]);
  const totalSeats = data.roles.length;

  const parentOf = (id: string | null): string | null => {
    if (!id) return null;
    return (byId.get(id)?.parentCircleId as string | null) ?? null;
  };

  // The camera. Target derives from the layout, so a shape morph re-aims it.
  const target: CameraTarget = useMemo(() => {
    const pos = focusId ? posById.get(focusId) : null;
    if (focusId && pos) return { id: focusId, cx: pos.x, cy: pos.y, r: pos.r };
    return { id: null, cx: layout.village.x, cy: layout.village.y, r: layout.village.r };
  }, [focusId, posById, layout]);

  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [view, setView] = useState<CameraView>(() => viewFor(target));
  const viewRef = useRef(view);
  viewRef.current = view;
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const to = viewFor(target);
    const from = viewRef.current;
    if (from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    const t = transition(from, to);
    // A hidden tab gets no animation frames, so a flight started there would
    // hang mid-air until the tab surfaces. Nobody is watching: jump.
    const ms = typeof document !== "undefined" && document.hidden ? 0 : t.duration(!!reduced);
    if (ms === 0) {
      setView(t.at(1));
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const k = (now - started) / ms;
      setView(t.at(k));
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.cx, target.cy, target.r, target.id]);

  // Focus + context (spec 3): what is interactive, what dims, what labels.
  const chain = useMemo(() => {
    const set = new Set<string>();
    let cur = focusId;
    while (cur && !set.has(cur)) {
      set.add(cur);
      cur = parentOf(cur);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, byId]);

  const isChildOfFocus = (id: string): boolean => parentOf(id) === focusId;
  const isInteractive = (id: string): boolean =>
    id === focusId || isChildOfFocus(id) || (focusId !== null && id === parentOf(focusId));
  const showLabel = (id: string): boolean => isChildOfFocus(id) || id === focusId;

  const filtersOn = anyFilterOn(filters);
  const seatPasses = (seat: PowerSeat | undefined): boolean =>
    !seat || !filtersOn || seatPassesFilters(seat, filters, viewerUserId);
  const circleAnyPass = (id: string): boolean =>
    !filtersOn || data.roles.some((r) => r.circleId === id && seatPassesFilters(r, filters, viewerUserId));

  // The live region (spec 11): say where we are now, and what is here.
  const announcement = useMemo(() => {
    if (!focusId) return "The whole village";
    const c = byId.get(focusId);
    const seats = data.roles.filter((r) => r.circleId === focusId);
    const open = seats.filter((r) => r.vacant).length;
    return `Now inside ${c?.name ?? focusId}, ${seats.length} role${seats.length === 1 ? "" : "s"}${open ? `, ${open} open` : ""}`;
  }, [focusId, byId, data.roles]);

  // Arrow keys walk siblings (spec 11): the circles sharing a parent.
  const siblingsOf = (id: string): string[] =>
    data.circles
      .filter((c) => (c.parentCircleId ?? null) === parentOf(id))
      .map((c) => c.id)
      .filter((cid) => posById.has(cid));

  const moveSibling = (id: string, dir: 1 | -1) => {
    const sibs = siblingsOf(id);
    const at = sibs.indexOf(id);
    if (at === -1 || sibs.length < 2) return;
    const next = sibs[(at + dir + sibs.length) % sibs.length];
    (document.getElementById(`power-node-${next}`) as unknown as SVGGElement | null)?.focus?.();
  };

  const morph = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 90, damping: 18 };

  const pointFor = (kind: "circle" | "org_role", id: string): { x: number; y: number } | null => {
    if (kind === "circle") {
      const p = posById.get(id);
      return p ? { x: p.x, y: p.y } : null;
    }
    for (const c of layout.circles) {
      const s = c.roles.find((r) => r.id === id);
      if (s) return { x: s.x, y: s.y };
    }
    const vs = layout.village.roles.find((r) => r.id === id);
    return vs ? { x: vs.x, y: vs.y } : null;
  };

  const drawVillageRing = shape !== "pyramid";

  // The CONTAINER's aspect, measured, not the layout's (which is 1 by
  // construction). See useMeasuredBox above for what this was costing.
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const box = useMeasuredBox(svgEl);
  const aspect = box.w > 0 && box.h > 0 ? box.h / box.w : layout.height / layout.width;
  /*
   * THE VIEW WIDTH HAS TO GROW WITH A LANDSCAPE BOX, OR THE DISC IS CUT.
   *
   * `viewFor` asks for a world region `2r + margin` WIDE, and means a square
   * region: the thing it is framing is a disc. Handing that width to a
   * viewBox whose aspect is 0.62 asks for a region 38% SHORTER than it is
   * wide, and the top and bottom of the village ring fall outside the
   * picture. Correct aspect, cropped map, which is a worse bug than the one
   * being fixed and would have looked like a layout error.
   *
   * So the region is widened until its HEIGHT covers the square the camera
   * meant. The scale is unchanged by this (a disc in a short box is
   * height-limited whatever the viewBox says); what it buys is that the
   * space either side of the disc becomes addressable world space instead of
   * dead margin, which is where a name too long for its circle now goes.
   */
  const fittedView: CameraView = aspect < 1 ? [view[0], view[1], view[2] / aspect] : view;
  // Screen pixels per world unit, at the camera's current width. Everything
  // that has to hold a fixed size on screen divides by this.
  const pxPerWorld = box.w > 0 ? box.w / fittedView[2] : 0;

  return (
    <>
      <svg
        ref={(el) => {
          setSvgEl(el);
          // `svgRef` is the caller's handle (export, print). Keep feeding it.
          if (svgRef) (svgRef as { current: SVGSVGElement | null }).current = el;
        }}
        viewBox={viewBoxFor(fittedView, aspect)}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="The power map"
        data-power-map
        data-shape={shape}
        onClick={() => onFocus(parentOf(focusId))}
      >
        <defs>
          <RelationArrowDef />
        </defs>

        {/* The enclosing line. Tapping it, or any backdrop, goes out one
            level; the handler above catches everything a node does not stop. */}
        {drawVillageRing && (
          <>
            <circle
              cx={layout.village.x}
              cy={layout.village.y}
              r={layout.village.r}
              fill="none"
              stroke="var(--color-sage)"
              strokeWidth={shape === "steward" ? 4 : 10}
              opacity={shape === "network" ? 0.18 : 0.5}
            />
            <circle
              cx={layout.village.x}
              cy={layout.village.y}
              r={Math.max(0, layout.village.r - 8)}
              style={{ fill: "var(--color-sage)", fillOpacity: shape === "network" ? 0.02 : 0.05 }}
              stroke="none"
            />
          </>
        )}

        <SeasonRing cx={layout.village.x} cy={layout.village.y} r={layout.village.r} season={data.season} />

        {/* Pyramid connectors: child to parent, before the discs. */}
        {shape === "pyramid" &&
          layout.circles.map((pos) => {
            const parentId = parentOf(pos.id);
            const pp = parentId ? posById.get(parentId) : null;
            if (!pp) return null;
            return (
              <line
                key={`edge-${pos.id}`}
                x1={pp.x}
                y1={pp.y + (posById.get(parentId!)?.r ?? 0)}
                x2={pos.x}
                y2={pos.y - pos.r}
                stroke="var(--color-teal-deep)"
                strokeWidth={1.2}
                opacity={0.35}
                aria-hidden="true"
              />
            );
          })}

        {/* The circles, every shape, one loop. */}
        {layout.circles.map((pos) => {
          const c = byId.get(pos.id);
          const forming = c?.status === "forming";
          const tone = toneOf(c);
          const interactive = isInteractive(pos.id);
          const inChain = chain.has(pos.id);
          const dimForFocus = focusId !== null && !interactive && !inChain ? 0.3 : 1;
          const dimForFilter = filtersOn && !circleAnyPass(pos.id) ? 0.2 : 1;
          const opacity = Math.min(dimForFocus, dimForFilter) * (forming ? 0.6 : 1);
          const isFocus = pos.id === focusId;
          const wrapped = wrapLabel(c?.name ?? pos.id, pos.r, pos.depth);
          // The world-unit size the layout asked for, converted to something
          // legible on THIS screen at THIS zoom. See fitLabelToScreen.
          const fit = fitLabelToScreen(wrapped, pos.r, pxPerWorld);
          const label = { lines: wrapped.lines, fontSize: fit.fontSize, lineHeight: fit.lineHeight };
          const hasChildren = data.circles.some((o) => o.parentCircleId === pos.id && posById.has(o.id));
          const labelTop = fit.outside
            ? // Above the disc, clear of its seat ring, where the circle's own
              // width stops constraining the name.
              pos.y - pos.r - 6 - (label.lines.length - 1) * label.lineHeight
            : hasChildren
              ? pos.y - pos.r + 24
              : pos.y - ((label.lines.length - 1) * label.lineHeight) / 2 + (forming ? -6 : 0);

          return (
            <motion.g key={pos.id} animate={{ opacity }} transition={morph}>
              <motion.circle
                id={`power-node-${pos.id}`}
                animate={{ cx: pos.x, cy: pos.y, r: pos.r }}
                initial={false}
                transition={morph}
                style={{ fill: tone, fillOpacity: isFocus ? 0.16 : 0.1 }}
                stroke={tone}
                strokeOpacity={isFocus ? 0.9 : 0.45}
                strokeWidth={isFocus ? 3 : 2}
                className={interactive ? "cursor-pointer focus:outline-none focus-visible:stroke-[4]" : ""}
                pointerEvents={interactive ? undefined : "none"}
                role="button"
                tabIndex={interactive ? 0 : -1}
                aria-label={`${c?.name ?? pos.id}${forming ? ", still forming" : ""}${
                  isFocus ? ". You are inside it; press Enter or Escape to go out one level" : ". Press Enter to go inside"
                }`}
                onClick={(e: ReactMouseEvent) => {
                  e.stopPropagation();
                  // Tapping the FOCUSED ring goes out one level (spec 1).
                  onFocus(isFocus ? parentOf(pos.id) : pos.id);
                }}
                onKeyDown={(e: ReactKeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onFocus(isFocus ? parentOf(pos.id) : pos.id);
                  } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    e.preventDefault();
                    moveSibling(pos.id, 1);
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    e.preventDefault();
                    moveSibling(pos.id, -1);
                  }
                }}
              />
              {showLabel(pos.id) && (
                <motion.text
                  animate={{ x: pos.x, y: labelTop }}
                  initial={false}
                  transition={morph}
                  textAnchor="middle"
                  className="fill-foreground font-semibold pointer-events-none"
                  style={{
                    fontSize: label.fontSize,
                    // A label pushed outside its circle crosses whatever is
                    // behind it, so it carries the page's own ground as a
                    // halo. `paint-order` puts that stroke UNDER the glyphs;
                    // without it the stroke is drawn over them and the text
                    // thins out to nothing at small sizes.
                    ...(fit.outside
                      ? {
                          paintOrder: "stroke" as const,
                          stroke: "var(--background)",
                          strokeWidth: 3.5,
                          strokeLinejoin: "round" as const,
                        }
                      : null),
                  }}
                >
                  {label.lines.map((ln, i) => (
                    <tspan key={ln + i} x={pos.x} dy={i === 0 ? 0 : label.lineHeight}>
                      {ln}
                    </tspan>
                  ))}
                </motion.text>
              )}
              {forming && showLabel(pos.id) && (
                <text
                  x={pos.x}
                  y={labelTop + (label.lines.length - (hasChildren ? 0 : 1)) * label.lineHeight + (hasChildren ? 14 : 16)}
                  textAnchor="middle"
                  className="fill-muted-foreground pointer-events-none"
                  style={{
                    // This caption was the worst offender on the live page: a
                    // hard floor of 9 WORLD units measured 6px on screen. Its
                    // floor is a screen size now, like the name above it.
                    fontSize: captionSize(label.fontSize, pxPerWorld),
                  }}
                >
                  forming
                </text>
              )}

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
              {pos.roles.map((rp) => {
                const seat = seatById.get(rp.id);
                if (!seat?.representsCircle) return null;
                const parentId = parentOf(pos.id);
                const anchor = parentId ? posById.get(parentId) : layout.village;
                if (!anchor) return null;
                return (
                  <line
                    key={`dbl-${rp.id}`}
                    x1={rp.x}
                    y1={rp.y}
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

              {/* The seats on this circle's ring. */}
              {pos.roles.map((rp) => {
                const seat = seatById.get(rp.id);
                const dotR = pos.depth === 0 ? 11 : 9;
                const pass = seatPasses(seat);
                const showFaces =
                  data.viewer.viewPeople && (totalSeats <= AVATAR_SEAT_CAP || isChildOfFocus(pos.id) || pos.id === focusId);
                const words = seat ? seatStateWords(seat.state, seat.holderCount, seat.seats) : "";
                return (
                  <motion.g
                    key={rp.id}
                    animate={{ x: rp.x, y: rp.y, opacity: pass ? 1 : 0.2 }}
                    initial={false}
                    transition={morph}
                    className="cursor-pointer focus:outline-none"
                    role="button"
                    tabIndex={interactive ? 0 : -1}
                    pointerEvents={interactive ? undefined : "none"}
                    aria-label={`${seat?.name ?? rp.id}, a role in ${c?.name ?? "this circle"}, ${words}${
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
                    <SeatGlyph
                      x={0}
                      y={0}
                      r={dotR}
                      state={seat?.state}
                      held={seat?.holderCount ?? 0}
                      seats={seat?.seats ?? 1}
                      holders={seat?.holders ?? []}
                      showAvatars={!!showFaces}
                      pulse={pulseSeatId === rp.id}
                    />
                    <TermArc x={0} y={0} r={dotR} termEnds={seat?.termEnds} />
                    {/* The representative's badge, at the far end of the link
                        drawn above. A second ring, so the mark survives
                        greyscale and never depends on colour alone (spec 4's
                        rule, applied to representation as well as to state). */}
                    {seat?.representsCircle && (
                      <circle
                        cx={0}
                        cy={0}
                        r={dotR + 4}
                        fill="none"
                        stroke={tone}
                        strokeOpacity={0.85}
                        strokeWidth={1.4}
                        pointerEvents="none"
                      />
                    )}
                    {selected?.kind === "role" && selected.id === rp.id && (
                      <circle cx={0} cy={0} r={dotR + 3} fill="none" stroke="var(--color-teal-deep)" strokeWidth={1.6} />
                    )}
                  </motion.g>
                );
              })}

              {pos.questDots.map((q, i) => (
                <circle key={i} cx={q.x} cy={q.y} r={4} className="fill-amber/70 pointer-events-none" />
              ))}
              {pos.questOverflow > 0 && showLabel(pos.id) && (
                <text
                  x={pos.x}
                  y={pos.y + pos.r - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground pointer-events-none"
                  style={{ fontSize: 10 }}
                >
                  +{pos.questOverflow} more quests
                </text>
              )}
            </motion.g>
          );
        })}

        {/* The village's own seats: the apex, the council ring, the steward's
            centre, or the boundary, wherever the shape put them. */}
        {layout.village.roles.map((rp) => {
          const seat = seatById.get(rp.id);
          const words = seat ? seatStateWords(seat.state, seat.holderCount, seat.seats) : "";
          const pass = seatPasses(seat);
          return (
            <motion.g
              key={rp.id}
              animate={{ x: rp.x, y: rp.y, opacity: pass ? 1 : 0.2 }}
              initial={false}
              transition={morph}
              className="cursor-pointer focus:outline-none"
              role="button"
              tabIndex={0}
              aria-label={`${seat?.name ?? rp.id}, a village-wide role, ${words}. Press Enter to open it`}
              onClick={(e: ReactMouseEvent) => {
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
              <SeatGlyph
                x={0}
                y={0}
                r={12}
                state={seat?.state}
                held={seat?.holderCount ?? 0}
                seats={seat?.seats ?? 1}
                holders={seat?.holders ?? []}
                showAvatars={data.viewer.viewPeople}
                pulse={pulseSeatId === rp.id}
              />
              <TermArc x={0} y={0} r={12} termEnds={seat?.termEnds} />
              {selected?.kind === "role" && selected.id === rp.id && (
                <circle cx={0} cy={0} r={15} fill="none" stroke="var(--color-teal-deep)" strokeWidth={1.6} />
              )}
            </motion.g>
          );
        })}

        {linesOn && (
          <RelationLines
            focusId={focusId}
            relations={data.relations}
            types={data.relationTypes}
            circles={data.circles}
            seats={data.roles}
            pointFor={pointFor}
          />
        )}

        {lenses}
      </svg>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
