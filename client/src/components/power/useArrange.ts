/**
 * ARRANGE MODE'S HANDS: a pointer drag and a keyboard equal, both ending in
 * one call, `land`, which asks the same question publishing will ask before it
 * records anything.
 *
 * HIT-TESTING IS THE BROWSER'S. What sits under a pointer comes from
 * `document.elementsFromPoint`, never from geometry done here. The browser
 * already accounts for the animated viewBox, the landscape widening, the pinch
 * nudge and framer's per-node transform, and a hand-rolled test would have to
 * re-derive all four and would drift from them. The plural form matters: a
 * seat or a quest dot drawn on a circle is the topmost element at that point,
 * and the circle it sits on is underneath it.
 *
 * YOU REARRANGE THE LEVEL YOU ARE STANDING IN. PowerMap gives pointer events
 * only to the focus, its children and its parent, so those are the circles a
 * drag picks up or lands on. Open ground inside the focus is the focus itself,
 * and ground outside every circle is the top of the village. Step into a circle
 * to rearrange inside it, which keeps every drop target few and large.
 *
 * MOUSE AND PEN ONLY FOR THE DRAG. One finger on a phone is the page's scroll
 * and two are the map's pinch, so a touch drag is left alone. The keyboard path
 * works wherever there is a keyboard: M picks a focused circle up, M on another
 * circle puts it inside, Shift and M puts it at the top of the village, Escape
 * puts it down.
 *
 * A DRAG IS NOT A CLICK. PowerMap flies into a circle on click, and its
 * backdrop steps out a level. A press that travelled far enough to be a drag
 * swallows the one click the browser sends after it, wherever that click lands,
 * so landing a circle never also moves the camera.
 *
 * THE LISTENERS SIT ON THE DOCUMENT and find the map through `svgRef` at the
 * moment of each event. The map unmounts in list mode and mounts again after,
 * and a listener bound to the first SVG would be deaf on the second.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { addMove, dropRefusal, withMoves, type PendingMove } from "./arrange";

type Circle = { id: string; name: string; parentCircleId?: string | null; isExample?: boolean };

/** How far a press travels before it is a drag, in CSS pixels. */
const DRAG_PX = 6;

export interface Arrange {
  moves: PendingMove[];
  /** The circle being carried, by pointer or by keyboard. */
  picked: string | null;
  /** Where it would land: a circle id, "" for the top of the village, null for nowhere. */
  target: string | null;
  /** Why landing there would be refused, or null. */
  refusal: string | null;
  /** The sentence the Arrange bar reads out. */
  status: string;
  /** Forget every move and anything being carried. */
  clear(): void;
  /** Forget the moves a publish just made true, keeping any made while it ran. */
  settle(published: PendingMove[]): void;
}

const circleOf = (el: Element | null): string | null =>
  el?.closest?.("[data-circle-id]")?.getAttribute("data-circle-id") ?? null;

export function useArrange({
  on,
  svgRef,
  live,
}: {
  on: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
  /** The circles as PUBLISHED. The picture with moves applied is derived from these. */
  live: Circle[] | null;
}): Arrange {
  const [moves, setMoves] = useState<PendingMove[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // The document listeners are bound once per mode change and read the newest values here.
  const now = useRef({ moves, picked, live });
  now.current = { moves, picked, live };

  const putDown = useCallback(() => {
    setPicked(null);
    setTarget(null);
  }, []);

  const land = useCallback((circleId: string, where: string) => {
    const { live: circles, moves: made } = now.current;
    setPicked(null);
    setTarget(null);
    if (!circles) return;
    const parentId = where === "" ? null : where;
    const refused = dropRefusal(circles, made, circleId, parentId);
    if (refused) {
      setNote(refused);
      return;
    }
    const name = (id: string) => circles.find((c) => c.id === id)?.name ?? id;
    setMoves((m) => addMove(circles, m, { circleId, parentId }));
    setNote(
      parentId
        ? `${name(circleId)} now sits inside ${name(parentId)}.`
        : `${name(circleId)} now sits at the top of the village.`,
    );
  }, []);

  const clear = useCallback(() => {
    setMoves([]);
    setPicked(null);
    setTarget(null);
    setNote("");
  }, []);

  const settle = useCallback((published: PendingMove[]) => {
    setMoves((m) => m.filter((x) => !published.some((p) => p.circleId === x.circleId && p.parentId === x.parentId)));
    setNote("");
  }, []);

  // Leaving arrange mode puts down anything being carried. The moves stay.
  useEffect(() => {
    if (!on) putDown();
  }, [on, putDown]);

  useEffect(() => {
    if (!on) return;
    const map = () => svgRef.current;

    /** What letting go at this point means: a circle id, "" for the top of the village, null for off the map. */
    const under = (x: number, y: number): string | null => {
      const svg = map();
      const stack = document.elementsFromPoint(x, y);
      if (!svg || !stack.length || !svg.contains(stack[0])) return null;
      for (const el of stack) {
        if (!svg.contains(el)) break;
        const id = circleOf(el);
        if (id) return id;
      }
      return "";
    };

    let press: { id: string; x: number; y: number; dragging: boolean } | null = null;
    let swallowClick = false;

    const endPress = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (press?.dragging) document.body.style.userSelect = "";
      press = null;
    };

    const onMove = (e: PointerEvent) => {
      if (!press) return;
      // The button came up outside the window, where no pointerup reaches the page.
      if ((e.buttons & 1) === 0) {
        const wasDragging = press.dragging;
        endPress();
        if (wasDragging) putDown();
        return;
      }
      if (!press.dragging) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX) return;
        press.dragging = true;
        document.body.style.userSelect = "none";
        setPicked(press.id);
      }
      const where = under(e.clientX, e.clientY);
      setTarget(where === press.id ? null : where);
    };

    const onUp = (e: PointerEvent) => {
      const p = press;
      endPress();
      if (!p?.dragging) return; // a press that never travelled is a click
      swallowClick = true;
      // The browser dispatches its click before this timer runs, if it sends one at all.
      window.setTimeout(() => {
        swallowClick = false;
      }, 0);
      const where = under(e.clientX, e.clientY);
      if (where === null || where === p.id) {
        putDown();
        setNote("Put down where it was.");
        return;
      }
      land(p.id, where);
    };

    const onCancel = () => {
      const wasDragging = press?.dragging;
      endPress();
      if (wasDragging) putDown();
    };

    const onDown = (e: PointerEvent) => {
      const svg = map();
      if (press || e.button !== 0 || e.pointerType === "touch" || !svg || !svg.contains(e.target as Node)) return;
      const id = circleOf(e.target as Element);
      if (!id) return;
      press = { id, x: e.clientX, y: e.clientY, dragging: false };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const svg = map();
      const inMap = !!svg && svg.contains(document.activeElement);
      const focused = inMap ? circleOf(document.activeElement) : null;
      const carrying = now.current.picked;
      if (e.key === "Escape") {
        if (!carrying) return;
        // Captured ahead of PowerMap's own Escape, which would step out a level.
        e.preventDefault();
        e.stopPropagation();
        putDown();
        setNote("Put down where it was.");
        return;
      }
      if (e.key !== "m" && e.key !== "M") return;
      if (!carrying && !inMap) return;
      e.preventDefault();
      if (!carrying) {
        if (!focused) {
          setNote("Move to a circle first, then press M to pick it up.");
          return;
        }
        setPicked(focused);
        setTarget(null);
        return;
      }
      if (e.shiftKey) {
        land(carrying, "");
        return;
      }
      if (!focused || focused === carrying) {
        putDown();
        setNote("Put down where it was.");
        return;
      }
      land(carrying, focused);
    };

    const onFocusIn = (e: FocusEvent) => {
      const svg = map();
      const carrying = now.current.picked;
      if (!carrying || !svg || !svg.contains(e.target as Node)) return;
      const id = circleOf(e.target as Element);
      setTarget(id && id !== carrying ? id : null);
    };

    document.addEventListener("pointerdown", onDown);
    window.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      endPress();
    };
  }, [on, svgRef, land, putDown]);

  const picture = useMemo(() => (live ? withMoves(live, moves) : []), [live, moves]);
  const nameOf = (id: string) => picture.find((c) => c.id === id)?.name ?? id;
  const refusal =
    picked !== null && target !== null && live ? dropRefusal(live, moves, picked, target === "" ? null : target) : null;

  let status = note;
  if (picked) {
    if (target === null) {
      status = `Carrying ${nameOf(picked)}. Drop it on the circle it belongs inside, or press M on that circle. Shift and M puts it at the top of the village. Escape puts it down.`;
    } else if (refusal) {
      status = refusal;
    } else {
      const parentId = target === "" ? null : target;
      const where = parentId ? `inside ${nameOf(parentId)}` : "at the top of the village";
      const sits = (picture.find((c) => c.id === picked)?.parentCircleId ?? null) === parentId;
      status = sits ? `${nameOf(picked)} already sits ${where}.` : `${nameOf(picked)} would sit ${where}.`;
    }
  }

  return { moves, picked, target, refusal, status, clear, settle };
}
