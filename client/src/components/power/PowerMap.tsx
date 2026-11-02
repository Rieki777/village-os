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
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { m } from "framer-motion";
import { wrapLabel, type NestedLayout } from "@shared/mapLayout";
import { cssColourForCircle } from "@shared/circleView";
import { arcCounts } from "@shared/capacityArc";
import { iconFor } from "@/lib/circleIcons";
import { viewBoxFor, type CameraTarget, type CameraView } from "./camera";
import { NO_NUDGE, useCameraFlight, useMeasuredBox, useNudge } from "./mapStage";
import SeatGlyph, { HitArea, seatStateWords } from "./SeatGlyph";
import CircleLabel from "./CircleLabel";
import { bandObstacles, buildLabelPlan } from "./labelPlacement";
import { seatHitRadii, type SeatPoint } from "./seatTargets";
import { fitLabelToScreen } from "./labelFit";
import { TermArc, SeasonRing } from "./TermMarkers";
import RelationLines, { RelationArrowDef } from "./RelationLines";
import SeatRing from "./SeatRing";
import FormingBand from "./FormingBand";
import CircleGlyph from "@/components/geneKeys/CircleGlyph";
import type { Filters, PowerData, PowerSeat, Selection } from "./types";
import { anyFilterOn, seatPassesFilters } from "./types";

/** Faces stop drawing outside the focus past this many seats (spec 13). */
const AVATAR_SEAT_CAP = 400;


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
  maxDepth,
  compact,
  keys,
  namedId,
  onName,
  arrangeHint,
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
  /** While arranging: how to pick a circle up, read out on every circle that takes a keypress. */
  arrangeHint?: string;
  /*
   * ONE LEVEL AT A TIME, WHICH IS WHAT A PHONE HAS ROOM FOR.
   *
   * Seventeen circles and their nested children in a 375px square is a
   * picture nobody can use: at that size a grandchild circle is a few pixels
   * across and its seats are smaller than a fingertip. Undefined draws every
   * depth, which is what a desktop wants; a number draws that depth and
   * above, and the breadcrumb is the way down.
   */
  maxDepth?: number;
  /*
   * COMPACT: a stage too small to carry every name at a legible size.
   *
   * The screen floor makes each label readable on its own. On a 358px phone
   * stage with fifteen sibling circles that is not enough: measured live at
   * 1d0d869, the names cleared 12.5px and then collided into an unreadable
   * pile, because legible and legible-together are different problems.
   *
   * So a compact stage draws a name only where it FITS INSIDE its circle. A
   * name that would have to be promoted above the disc is dropped instead:
   * the circle is still tappable, tapping it makes it the focus and gives it
   * room, and the accordion underneath carries every name in full. Fewer
   * words, all of them readable, beats fifteen words in a heap.
   */
  compact?: boolean;
  /**
   * THE KEY A PHONE READS THE MAP BY (2026-09-21): circle id to the number it
   * carries. Drawn only on a compact stage, where a circle is too small for its
   * name. The numbers come from `phoneKeysFor`, and a list under the map names
   * every one of them.
   */
  keys?: ReadonlyMap<string, number>;
  /** The circle a tap has asked to see the name of, on a compact stage. */
  namedId?: string | null;
  /**
   * The first tap on a numbered circle NAMES it instead of stepping inside,
   * and a second tap on the same circle steps in. Omitted, a tap steps in at
   * once, which is every stage except the phone.
   */
  onName?: (id: string | null) => void;
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
    const at = focusId ? posById.get(focusId) : null;
    // An arc of a forming band is part of its container's picture, so the
    // camera frames the container and the arc lights up inside it.
    const pos = at?.band ? (at.band.containerId ? posById.get(at.band.containerId) : null) : at;
    if (focusId && pos) return { id: focusId, cx: pos.x, cy: pos.y, r: pos.r };
    /*
     * THE VILLAGE VIEW HAS TO CLEAR THE SEASON RING, WHICH DRAWS OUTSIDE IT.
     *
     * `viewFor` frames `2r + FOCUS_MARGIN`, which is 12 world units of
     * clearance on each side. `SeasonRing` draws its dashed ring at r + 14
     * and rides its LABEL on an arc at r + 20, so at the village level the
     * season words along the top were being shaved by the frame. Measured
     * live at 1280x800: the ring clipped by 2 units, the label arc by 8.
     *
     * It is only the village that needs this: the season ring draws once,
     * around the whole village, and a focused circle has nothing outside it.
     * So the allowance goes here instead of into FOCUS_MARGIN, which every
     * other focus would then pay for as a smaller picture.
     */
    const seasonPad = data.season.current || data.season.nextRollAt ? 34 : 0;
    return {
      id: null,
      cx: layout.village.x,
      cy: layout.village.y,
      r: layout.village.r + seasonPad,
    };
  }, [focusId, posById, layout, data.season]);

  const reduced =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // The flight itself owns a frame loop, so it lives in mapStage.ts with
  // the rest of the stage. `camera.ts` stays pure.
  const view = useCameraFlight(target, !!reduced);

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

  /*
   * A SINGLE ROOT AND THE VILLAGE ARE THE SAME PICTURE.
   *
   * Bostock's rule is that only the children of the FOCUS carry labels and
   * take clicks, which is what keeps forty circles legible. At the village
   * level the focus is null, so "child of the focus" means "has no parent".
   *
   * That was fine while Amora had fifteen parentless circles. The moment the
   * General Coordinating Circle became the parent of all of them, exactly ONE
   * circle had no parent, and the rule collapsed: the map opened on a single
   * big disc labelled "General Coordinating Circle" with fourteen unnamed
   * discs inside it, none of them clickable. A reader had to guess to click
   * the one circle before the village had any names in it at all.
   *
   * So when a village has ONE root, that root's ring IS the village boundary,
   * and standing outside the village means standing inside it. Anything else
   * is drawing the same edge twice and making the reader cross it by hand.
   *
   * A village with several roots is unchanged, which is every fork on its
   * first day.
   */
  const soleRoot = useMemo(() => {
    const roots = layout.circles.filter((c) => c.depth === 0);
    return roots.length === 1 ? roots[0].id : null;
  }, [layout]);
  /** The focus for READING: what is named, what takes a click. */
  const readFocus = focusId ?? soleRoot;

  const isChildOfFocus = (id: string): boolean => parentOf(id) === readFocus;
  const isInteractive = (id: string): boolean =>
    // Stepping OUT still keys on the real focus: at the village level there is
    // no level above to go to, so the root ring is not a door.
    id === readFocus || isChildOfFocus(id) || (focusId !== null && id === parentOf(focusId));
  const showLabel = (id: string): boolean => isChildOfFocus(id) || id === readFocus;

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
    // Looked up inside THIS map. The phone map is mounted too, hidden, with the same
    // ids, and a document-wide lookup found its node first, so arrows did nothing here.
    (svgEl?.querySelector(`[id="power-node-${next}"]`) as SVGGElement | null)?.focus?.();
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
  // construction). See `useMeasuredBox` in mapStage.ts for what this
  // was costing.
  /*
   * A STABLE REF CALLBACK, WHICH IS THE WHOLE DIFFERENCE.
   *
   * This was an inline arrow. React treats a ref callback with a new
   * identity as a different ref, so on EVERY render it detached the old one
   * (calling it with null) and attached the new one. The element state
   * thrashed null/element every render, the effect below tore its
   * ResizeObserver down and rebuilt it each time, and the measurement never
   * settled: `box` stayed {0,0} in production.
   *
   * Measured live on 2026-09-05 at build b865a34: `pxPerWorld` was 0, so
   * `fitLabelToScreen` returned every label unchanged and the "forming"
   * caption sat at its 9-world-unit fallback. The label floor was shipped
   * and doing nothing, on desktop and on mobile alike.
   *
   * `useCallback` keyed on the one prop it closes over gives React the same
   * function every render, so the ref attaches once.
   */
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const attachSvg = useCallback(
    (el: SVGSVGElement | null) => {
      setSvgEl(el);
      // `svgRef` is the caller's handle (export, print). Keep feeding it.
      if (svgRef) (svgRef as { current: SVGSVGElement | null }).current = el;
    },
    [svgRef],
  );
  /* HOVER, SO A READER CAN SURVEY WITHOUT NAVIGATING.
     Reading the shape of the village meant stepping into every circle and
     back out again, which loses your place each time. Pointer only: a touch
     device gets the tap, and hover would fire on the way to it. */
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Ids this map's own defs answer to. The phone map and the desktop map are
  // both mounted in one document, so a fixed id would resolve to whichever came first.
  const uid = `pm${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
  /*
   * ── PINCH AND PAN, ON THE STAGE THAT NEEDS IT ─────────────────────────────
   *
   * A phone shows fifteen circles at 18 to 30px each. Tap-to-zoom answers
   * "step into this one"; it does not answer "let me look closer at that
   * corner", and the compact rule means most names only appear once you are
   * inside. So the small stage gets a real camera the reader drives.
   *
   * ONE FINGER IS LEFT ALONE, deliberately. The map sits in a scrolling page
   * now, and a canvas that swallows one-finger drag is a canvas a reader
   * cannot scroll past: they reach the map and the page stops. Two fingers
   * pinch and pan, which is the convention every embedded map uses for
   * exactly this reason, and `touch-action: pan-y` keeps vertical scrolling
   * with the page.
   *
   * The nudge is a DELTA on top of the camera, never a replacement for it:
   * tapping a circle still flies there, and arriving resets the nudge, so
   * the two ways of moving cannot fight over where the view is.
   */
  const { nudge, setNudge, gesture } = useNudge([focusId, shape]);
  const zoomable = !!compact;

  // Screen pixels per world unit, at the camera's current width. Everything
  // that has to hold a fixed size on screen divides by this.
  const navView: CameraView = zoomable
    ? [fittedView[0] + nudge.dx, fittedView[1] + nudge.dy, fittedView[2] / nudge.k]
    : fittedView;
  const pxPerWorld = box.w > 0 ? box.w / navView[2] : 0;

  /*
   * WHERE EVERY NAME GOES, decided once for the whole picture rather than
   * circle by circle. A name too big for its own circle is drawn outside it,
   * and a circle holding others draws its name just inside its top edge, so
   * names land on each other unless something reads the whole map at once.
   * Measured live at nine window sizes before and after. See labelPlacement.
   */
  const labelPlan = useMemo(
    () =>
      buildLabelPlan(
        layout.circles
          .filter((pos) => (maxDepth === undefined || pos.depth <= maxDepth) && !pos.band)
          .map((pos) => ({
            id: pos.id,
            x: pos.x,
            y: pos.y,
            r: pos.r,
            depth: pos.depth,
            name: byId.get(pos.id)?.name ?? pos.id,
            shown: showLabel(pos.id),
            hasChildren: data.circles.some((o) => o.parentCircleId === pos.id && posById.has(o.id)),
            forming: byId.get(pos.id)?.status === "forming",
          })),
        pxPerWorld,
        layout.bands ? bandObstacles(layout.bands, layout.circles.filter((pos) => maxDepth === undefined || pos.depth <= maxDepth)) : [],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showLabel reads focusId and readFocus, both listed.
    [layout, maxDepth, byId, data.circles, posById, pxPerWorld, focusId, readFocus],
  );

  /*
   * HOW BIG EACH SEAT'S TAP AREA IS. Measured live at 390x844: every seat on
   * the village view draws at 7x7 with 19 pixels to its nearest neighbour, so
   * the ring is too tight for the 44px every one of them wants. Each takes
   * what the picture allows instead, and never a pixel that belongs to the
   * seat beside it. See seatTargets.
   */
  const seatHits = useMemo(() => {
    const points: SeatPoint[] = [];
    for (const pos of layout.circles) {
      if (maxDepth !== undefined && pos.depth > maxDepth) continue;
      for (const rp of pos.roles) points.push({ id: rp.id, x: rp.x, y: rp.y, r: pos.depth === 0 ? 11 : 9, hostR: pos.r, hostSeats: pos.roles.length });
    }
    for (const rp of layout.village.roles) points.push({ id: rp.id, x: rp.x, y: rp.y, r: 12, hostR: layout.village.r, hostSeats: layout.village.roles.length });
    return seatHitRadii(points, pxPerWorld);
  }, [layout, maxDepth, pxPerWorld]);

  return (
    <>
      <svg
        ref={attachSvg}
        viewBox={viewBoxFor(navView, aspect)}
        style={zoomable ? { touchAction: "pan-y" } : undefined}
        onTouchStart={
          zoomable
            ? (e: ReactTouchEvent) => {
                // Two fingers only. One is the page's, so scrolling survives.
                if (e.touches.length !== 2) { gesture.current = null; return; }
                const [a, b] = [e.touches[0]!, e.touches[1]!];
                gesture.current = {
                  dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
                  mx: (a.clientX + b.clientX) / 2,
                  my: (a.clientY + b.clientY) / 2,
                };
              }
            : undefined
        }
        onTouchMove={
          zoomable
            ? (e: ReactTouchEvent) => {
                const g = gesture.current;
                if (!g || e.touches.length !== 2 || pxPerWorld <= 0) return;
                e.preventDefault();
                const [a, b] = [e.touches[0]!, e.touches[1]!];
                const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
                const mx = (a.clientX + b.clientX) / 2;
                const my = (a.clientY + b.clientY) / 2;
                setNudge((n) => ({
                  // Panning is the midpoint's travel, converted to world
                  // units and inverted: dragging the picture right moves the
                  // camera left.
                  dx: n.dx - (mx - g.mx) / pxPerWorld,
                  dy: n.dy - (my - g.my) / pxPerWorld,
                  // Between 1x and 6x. Below 1 the reader zooms out past the
                  // whole village into empty ground, which looks broken and
                  // answers nothing.
                  k: Math.min(6, Math.max(1, n.k * (g.dist > 0 ? dist / g.dist : 1))),
                }));
                gesture.current = { dist, mx, my };
              }
            : undefined
        }
        onTouchEnd={zoomable ? () => { gesture.current = null; } : undefined}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="The power map"
        data-power-map
        data-shape={shape}
        onClick={() => onFocus(parentOf(focusId))}
        /*
         * ESCAPE, WHICH THE LABELS HAVE BEEN PROMISING ALL ALONG.
         *
         * Every focused circle carries the aria-label "You are inside it;
         * press Enter or Escape to go out one level", and spec 11 lists Esc
         * among the keyboard paths. Enter was wired and Escape never was, so
         * the one instruction a screen-reader user is given for leaving a
         * circle did nothing. Verified live at build b9806ea: Enter cleared
         * the focus, Escape left it exactly where it was.
         *
         * It sits on the SVG rather than on each node so it works from a
         * seat as well as from a circle: key events bubble, and "go out one
         * level" is the same act wherever focus happens to be.
         *
         * A selected seat closes FIRST. Escape means "back out of the thing
         * I am in", and when a seat card is open that thing is the card, not
         * the circle behind it.
         */
        onKeyDown={(e: ReactKeyboardEvent) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          if (selected) onSelect(null);
          else onFocus(parentOf(focusId));
        }}
      >
        <defs>
          <RelationArrowDef />
          {/* The forming material: a hatch over the tint, so "not yet" never
              rests on a fade alone (opacity is a dimmer, not a status). */}
          <pattern id={`${uid}-hatch`} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={8} stroke="var(--foreground)" strokeOpacity={0.14} strokeWidth={2} />
          </pattern>
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

        <SeasonRing cx={layout.village.x} cy={layout.village.y} r={layout.village.r} season={data.season} pxPerWorld={pxPerWorld} />

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
        {layout.circles
          .filter((pos) => (maxDepth === undefined || pos.depth <= maxDepth) && !pos.band)
          .map((pos) => {
          const c = byId.get(pos.id);
          const forming = c?.status === "forming";
          const tone = toneOf(c);
          const interactive = isInteractive(pos.id);
          const inChain = chain.has(pos.id);
          const dimForFocus = focusId !== null && !interactive && !inChain ? 0.3 : 1;
          const dimForFilter = filtersOn && !circleAnyPass(pos.id) ? 0.2 : 1;
          const opacity = Math.min(dimForFocus, dimForFilter);
          const isFocus = pos.id === focusId;
          const hovered = hoverId === pos.id && interactive && !isFocus;
          const placed = labelPlan.get(pos.id)!;
          const label = { lines: placed.lines, fontSize: placed.fontSize, lineHeight: placed.lineHeight };
          const hasChildren = data.circles.some((o) => o.parentCircleId === pos.id && posById.has(o.id));
          const labelTop = placed.top;
          /*
           * ARC FAR, GLYPHS CLOSE (Rye, 2026-10-23). Looking at the whole
           * village, every circle's border is a meter of its roles; stepping
           * into a circle brings back the glyphs for it and the circles
           * directly inside it. A circle holding the role a reader picked or a
           * search pulsed shows its glyphs wherever the camera is.
           */
          const glyphs =
            (focusId !== null && (isFocus || parentOf(pos.id) === focusId)) ||
            pos.roles.some((rp) => (selected?.kind === "role" && rp.id === selected.id) || rp.id === pulseSeatId);
          const counts = arcCounts(data.roles.filter((r) => r.circleId === pos.id));
          const countWords = counts.places ? `, ${counts.held} of ${counts.places} held${counts.open ? `, ${counts.open} open` : ""}` : "";
          const unit = pxPerWorld > 0 ? 1 / pxPerWorld : 1;
          const Icon = iconFor(c?.icon);
          const iconSize = 18 * unit;
          const iconY = labelTop - label.fontSize * 0.9 - 4 * unit - iconSize;
          const showIcon =
            !compact && pxPerWorld > 0 && showLabel(pos.id) && !placed.outside && !hasChildren && !!c?.icon &&
            iconY >= pos.y - pos.r + (glyphs ? 34 : 8 * unit);

          return (
            <m.g key={pos.id} animate={{ opacity }} transition={morph}>
              {/* The circle, its links and its roles. A forming circle reads by
                  its material, a dashed edge and a hatch, never by a fade. */}
              <g>
              <m.circle
                id={`power-node-${pos.id}`}
                animate={{ cx: pos.x, cy: pos.y, r: pos.r }}
                initial={false}
                transition={morph}
                /* ATTRIBUTES, NOT STYLE, FOR THE SAME REASON AS THE LABEL.
                   framer owns `style` on a motion component and does not
                   reliably re-apply a static value that CHANGES between
                   renders. `fillOpacity` changes on hover and on focus, so
                   through `style` the hover lift would have been dead on
                   arrival: the handler fires, React re-renders, framer keeps
                   the first paint. `stroke` and the two below were already
                   attributes, which is why they were going to work and this
                   one was not. */
                fill={tone}
                /*
                 * THESE HUES WERE DRAWN FOR A DARK GROUND.
                 *
                 * They are the living map artifact's `CIRCLE_COL`, and the
                 * artifact paints them on #131a11 where a tenth of a hue
                 * still reads. This page is light, and at 0.1 a mid-tone on
                 * white is within a few percent of white: measured on the
                 * live phone at b711620 the ring was seventeen near-identical
                 * pale discs, which is the same "one grey" the palette work
                 * was supposed to end.
                 *
                 * A third of the hue reads as a tint on white and still sits
                 * far behind the near-black label on top of it, so nothing
                 * about legibility moves. The mini render on /circles is on
                 * the dark ground and keeps its own lower value.
                 */
                fillOpacity={isFocus ? 0.42 : hovered ? 0.46 : forming ? 0.16 : 0.32}
                stroke={tone}
                strokeOpacity={isFocus ? 0.9 : hovered ? 0.85 : forming ? 0.7 : 0.45}
                strokeWidth={isFocus ? 3 : hovered ? 3 : 2}
                strokeDasharray={forming ? `${7 * unit} ${5 * unit}` : undefined}
                className={interactive ? "cursor-pointer focus:outline-none focus-visible:stroke-[4]" : ""}
                pointerEvents={interactive ? undefined : "none"}
                onMouseEnter={() => interactive && setHoverId(pos.id)}
                onMouseLeave={() => setHoverId((h) => (h === pos.id ? null : h))}
                // Arrange mode finds the circle under a pointer with
                // `document.elementFromPoint`, which already accounts for the
                // animated viewBox, the landscape widening, the pinch nudge and
                // framer's transform. An id on the element is all it needs.
                data-circle-id={pos.id}
                role="button"
                tabIndex={interactive ? 0 : -1}
                aria-label={`${keys?.get(pos.id) ? `${keys.get(pos.id)}, ` : ""}${c?.name ?? pos.id}${forming ? ", still forming" : ""}${countWords}${
                  isFocus ? ". You are inside it; press Enter or Escape to go out one level" : ". Press Enter to go inside"
                }${arrangeHint && interactive ? `, or ${arrangeHint}` : ""}`}
                onClick={(e: ReactMouseEvent) => {
                  e.stopPropagation();
                  // ON A PHONE THE FIRST TAP NAMES A NUMBERED CIRCLE, and the
                  // second tap on it steps in. Before this, the only way to learn
                  // a small circle's name was to walk into it and back out.
                  if (compact && onName && keys?.has(pos.id) && namedId !== pos.id && !isFocus) {
                    onName(pos.id);
                    return;
                  }
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
              {/* NESTING READS AS DEPTH, NOT AS ANOTHER OUTLINE.
                  Three levels of flat rings collapse into noise: every edge
                  is the same weight, so the eye cannot tell "inside" from
                  "next to". A faint rim just within the edge gives the disc
                  a lip, which is enough for containment to read at a glance
                  and cheap enough that it costs no filter. */}
              <circle
                cx={pos.x}
                cy={pos.y}
                r={Math.max(0, pos.r - 1.5)}
                fill="none"
                stroke={tone}
                strokeOpacity={0.16}
                strokeWidth={3}
                pointerEvents="none"
              />



              {/* A forming disc carries the hatch over its tint. */}
              {forming && (
                <m.circle animate={{ cx: pos.x, cy: pos.y, r: pos.r }} initial={false} transition={morph} fill={`url(#${uid}-hatch)`} pointerEvents="none" />
              )}

              <SeatRing
                pos={pos}
                circleName={c?.name ?? "this circle"}
                tone={tone}
                glyphs={glyphs}
                interactive={interactive}
                anchor={(() => {
                  const parentId = parentOf(pos.id);
                  return parentId ? (posById.get(parentId) ?? null) : layout.village;
                })()}
                seatById={seatById}
                seatPasses={seatPasses}
                showFaces={data.viewer.viewPeople && (totalSeats <= AVATAR_SEAT_CAP || isChildOfFocus(pos.id) || pos.id === focusId)}
                seatHits={seatHits}
                selected={selected}
                onSelect={onSelect}
                pulseSeatId={pulseSeatId}
                showQuestOverflow={showLabel(pos.id)}
                pxPerWorld={pxPerWorld}
                morph={morph}
              />
              </g>

              {/* The number and the name are drawn AFTER the seats and OUTSIDE
                  the fade above: a name is a circle's identity, so a seat glyph
                  never sits on top of it, and a forming circle stays named at
                  full strength while its disc is the thing that goes quiet. */}
              {/* THE NUMBER THE KEY UNDER THE MAP NAMES. Sized in SCREEN
                  pixels through pxPerWorld, like every label here, so it reads
                  at 13px whatever the camera is doing, with the page's ground
                  as a halo so it holds on any circle's tone. Not on a circle
                  whose own name is drawn CENTRED in it: the number would sit
                  across the name, and the name already says which one it is. */}
              {compact && keys?.has(pos.id) && !(showLabel(pos.id) && !placed.outside && !hasChildren) && (
                <text
                  x={pos.x}
                  y={pos.y}
                  dy="0.35em"
                  textAnchor="middle"
                  aria-hidden="true"
                  className="fill-foreground font-semibold pointer-events-none"
                  fontSize={pxPerWorld > 0 ? 13 / pxPerWorld : 12}
                  paintOrder="stroke"
                  stroke="var(--background)"
                  strokeWidth={pxPerWorld > 0 ? 3 / pxPerWorld : 3}
                  strokeLinejoin="round"
                >
                  {keys.get(pos.id)}
                </text>
              )}

              {/* THE CIRCLE'S SIX LINES (Gene Keys lane, 2026-10-30): which lines its
                  holders show and where the gaps are, once you step in. It draws nothing
                  while the module is off or no holder shows lines. */}
              {glyphs && pxPerWorld > 0 && (
                <CircleGlyph
                  cx={pos.x}
                  cy={pos.y}
                  r={pos.r}
                  px={1 / pxPerWorld}
                  holderIds={data.roles
                    .filter((r) => r.circleId === pos.id)
                    .flatMap((r) => r.holders)
                    .filter((h) => !!h.userId && !(h as { lapsed?: boolean }).lapsed)
                    .map((h) => String(h.userId))}
                />
              )}
              {showIcon && (
                <Icon x={pos.x - iconSize / 2} y={iconY} width={iconSize} height={iconSize} color={tone} strokeWidth={2} aria-hidden="true" pointerEvents="none" />
              )}

              <CircleLabel
                circleId={pos.id}
                x={pos.x + placed.dx}
                labelTop={labelTop}
                label={label}
                show={showLabel(pos.id)}
                hovered={hovered}
                drop={!!compact && placed.outside && !isFocus}
                forming={forming}
                hasChildren={hasChildren}
                pxPerWorld={pxPerWorld}
                morph={morph}
                roles={data.roles}
              />
            </m.g>
          );
        })}

        {layout.bands && (
          <FormingBand
            bands={layout.bands}
            riders={layout.circles.filter((pos) => !!pos.band && (maxDepth === undefined || pos.depth <= maxDepth))}
            byId={byId}
            pxPerWorld={pxPerWorld}
            compact={compact}
            keys={keys}
            uid={uid}
            isInteractive={isInteractive}
            showLabel={showLabel}
            captionY={(containerId) => {
              const unit = pxPerWorld > 0 ? 1 / pxPerWorld : 1;
              if (!containerId) return layout.village.y - layout.village.r + 30 + 14 * unit;
              const named = labelPlan.get(containerId);
              if (!named || !showLabel(containerId)) return null;
              // Below the hover line, when the container is hovered, so the two never sit on each other.
              return named.top + (named.lines.length - 1) * named.lineHeight + named.fontSize * 0.25 + (hoverId === containerId ? 34 : 14) * unit;
            }}
            opacityFor={(id) => {
              const dimForFocus = focusId !== null && !isInteractive(id) && !chain.has(id) ? 0.3 : 1;
              const dimForFilter = filtersOn && !circleAnyPass(id) ? 0.2 : 1;
              return Math.min(dimForFocus, dimForFilter);
            }}
            focusId={focusId}
            hoverId={hoverId}
            onHover={setHoverId}
            onOpen={(id) => onFocus(id === focusId ? parentOf(id) : id)}
          />
        )}

        {/* The village's own seats: the apex, the council ring, the steward's
            centre, or the boundary, wherever the shape put them. */}
        {layout.village.roles.map((rp) => {
          const seat = seatById.get(rp.id);
          const words = seat ? seatStateWords(seat.state, seat.holderCount, seat.seats) : "";
          const pass = seatPasses(seat);
          return (
            <m.g
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
              <HitArea r={seatHits.get(rp.id) ?? 12} drawn={12} />
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
            </m.g>
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

        {/* THE NAME A TAP ASKED FOR. Drawn after every circle so no later
            circle paints over it, and above the disc on the page's own
            ground, because a phone circle is too small to hold it. */}
        {compact && namedId && posById.get(namedId) && (() => {
          const at = posById.get(namedId)!;
          const name = byId.get(namedId)?.name ?? namedId;
          // A circle big enough to carry its own name already shows it, and a
          // second copy stacked above the first reads as a stutter, so the tap
          // label stands down wherever the circle's own label is drawn.
          const own = fitLabelToScreen(wrapLabel(name, at.r, at.depth), at.r, pxPerWorld);
          if (showLabel(namedId) && !own.outside) return null;
          const unit = pxPerWorld > 0 ? 1 / pxPerWorld : 1;
          return (
            <text
              x={at.x}
              y={at.y - at.r - 8 * unit}
              textAnchor="middle"
              data-named-circle={namedId}
              className="fill-foreground font-semibold pointer-events-none"
              fontSize={15 * unit}
              paintOrder="stroke"
              stroke="var(--background)"
              strokeWidth={4 * unit}
              strokeLinejoin="round"
            >
              {name}
            </text>
          );
        })()}
        {lenses}
      </svg>

      {/* THE WAY BACK, which a camera the reader drives has to have.
          Pinched in three levels and panned to a corner, there is no gesture
          that means "start again"; double-tap is taken by the browser and a
          pinch-out only walks back the way you came. It appears only once
          the view has actually moved, so it costs nothing at rest. */}
      {zoomable && (nudge.k !== 1 || nudge.dx !== 0 || nudge.dy !== 0) && (
        <button
          type="button"
          onClick={() => setNudge(NO_NUDGE)}
          className="absolute right-2 top-2 z-10 rounded-full bg-card/90 border border-border px-3 py-1.5 text-xs text-foreground shadow-sm"
        >
          Fit the village
        </button>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
