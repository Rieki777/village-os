/**
 * The map's STAGE: how big the box is, and where the camera is pointing.
 *
 * Three hooks lifted out of `PowerMap.tsx`, and the reason is a ratchet
 * rather than tidiness. That file sits at 959 lines against the 1000-line
 * monolith gate, and the drag-and-drop org editor is a layer that lands
 * inside it. Extracting after the editor exists would mean moving code
 * nobody could rebuild a mental model of; extracting before means the editor
 * arrives into a file with room.
 *
 * Each of these is about the STAGE and not about circles: none of them knows
 * what a circle is, what a seat is, or what the village looks like. That is
 * the line the split follows, so a reader of PowerMap.tsx is not sent here
 * to understand the picture, only to understand the frame around it.
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { transition, viewFor, type CameraTarget, type CameraView } from "./camera";

/**
 * The rendered size of the SVG, in real pixels.
 *
 * WHY MEASURED RATHER THAN ASSUMED. The layout is square by construction, so
 * a square viewBox was handed to a box that is almost never square, and
 * therefore told the browser nothing about the space available. Handing it
 * the CONTAINER's aspect does two things: the world coordinate system now
 * covers the full box, and the space beside the disc becomes addressable
 * world space instead of dead margin. That space is where a name too long
 * for its circle goes.
 *
 * It does NOT on its own make the disc bigger. A disc in a short wide box is
 * height-limited whatever the viewBox says, which is why `md:h-[74vh]` moved
 * too: the stage was capped at 533px while 864px wide.
 */
export function useMeasuredBox(el: SVGSVGElement | null): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const r = el.getBoundingClientRect();
      // Round before comparing: a fractional resize that changes nothing
      // visible would otherwise re-render on every scroll on some browsers.
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      // A HIDDEN instance measures ZERO, and zero is not a measurement.
      //
      // This page mounts TWO PowerMaps, one for the standing panel and one
      // for the phone, and CSS hides whichever does not apply. The hidden
      // one reports 0x0, and taking that as the box would divide the label
      // floor by zero and hand every label back unchanged, which is exactly
      // the bug this hook exists to prevent. Keep the last real size.
      if (next.w <= 0 || next.h <= 0) return;
      setBox((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    read();
    // The first paint can land before layout has given this subtree a size,
    // so read again on the next frame. The observer covers every later
    // change; this covers the one before it starts.
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame(read) : null;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [el]);
  return box;
}

/**
 * The camera's current view, flying toward `target` when the target moves.
 *
 * Van Wijk interpolation lives in `camera.ts` and is pure; this is the part
 * that owns a frame loop and therefore cannot be. Aiming is a side effect of
 * the TARGET changing, never of a render, which is why the effect keys on
 * the target's four numbers rather than on the object.
 */
export function useCameraFlight(target: CameraTarget, reduced: boolean): CameraView {
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
  }, [target.cx, target.cy, target.r, target.id, reduced]);

  return view;
}

/** A pan and zoom the reader drives, on top of wherever the camera is aimed. */
export interface Nudge {
  dx: number;
  dy: number;
  k: number;
}

export const NO_NUDGE: Nudge = { dx: 0, dy: 0, k: 1 };

/**
 * Two-finger pinch and pan, and the state it leaves behind.
 *
 * A phone shows fifteen circles at 18 to 30px each. Tap-to-zoom answers
 * "step into this one"; it does not answer "let me look closer at that
 * corner", and the compact rule means most names only appear once you are
 * inside. So the small stage gets a real camera the reader drives.
 *
 * ONE FINGER IS LEFT ALONE, deliberately. The map sits in a scrolling page,
 * and a canvas that swallows one-finger drag is a canvas a reader cannot
 * scroll past: they reach the map and the page stops. Two fingers pinch and
 * pan, which is the convention every embedded map uses for exactly this
 * reason, and `touch-action: pan-y` keeps vertical scrolling with the page.
 *
 * The nudge is a DELTA on top of the camera, never a replacement for it:
 * tapping a circle still flies there, and `resetOn` clears the nudge on
 * arrival, so the two ways of moving cannot fight over where the view is.
 */
export function useNudge(resetOn: unknown[]): {
  nudge: Nudge;
  setNudge: Dispatch<SetStateAction<Nudge>>;
  gesture: { current: { dist: number; mx: number; my: number } | null };
} {
  const [nudge, setNudge] = useState<Nudge>(NO_NUDGE);
  const gesture = useRef<{ dist: number; mx: number; my: number } | null>(null);
  useEffect(() => setNudge(NO_NUDGE), resetOn);
  return { nudge, setNudge, gesture };
}
