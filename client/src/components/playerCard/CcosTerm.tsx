/**
 * A plain heading with its CCOS term on hover or tap.
 *
 * TWO FACES OF ONE CONTRACT.
 *
 * `CardTerm` is the player card's, drawn exactly as the approved CCOS card
 * draws it (https://claude.ai/artifact/XGP6VP5WFU1T6ti7RD482P, `.ccos`): the
 * words take a dotted underline, and the term opens under them in the night's
 * ground with a gold-deep edge and gold-lit words (`.pc-ccos` and
 * `.pc-ccostip` in playerCard.css). Hover, Tab and a tap all open it; Escape,
 * a tap elsewhere and leaving close it.
 *
 * `CcosTerm` is the light pages' (the proposal's words step), an `InfoTip`
 * trigger, the circle card's own pattern
 * (client/src/components/circleCard/CircleCardView.tsx).
 *
 * Both keep the same accessibility contract: the words are a button with
 * `aria-expanded`, the term is `aria-describedby`-linked and stays in the DOM
 * while closed as `hidden`, so a screen reader hears "CCOS: <term>" on focus
 * and never reads it mid-sentence (InfoTip.tsx says why `hidden` and not
 * `sr-only`). With no term, because the village turned them off
 * (`org.ccos_terms`), the words draw exactly as they are and nothing is
 * underlined.
 *
 * TAP TARGETS, 44px on a phone without moving any layout: an invisible inset
 * pseudo-element grows the touch area around the words.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import InfoTip from "@/components/InfoTip";

/** An eyebrow heading: text-xs, so a 16px line grown to 44px. */
export const EYEBROW_TAP = "relative uppercase before:absolute before:-inset-x-1 before:-inset-y-3.5 before:content-['']";
/** A phrase inside a text-sm sentence, as the circle card's "This circle exists while". */
export const INLINE_TAP = "relative before:absolute before:-inset-x-1 before:-inset-y-3 before:content-['']";
/** A bold label inside a text-sm block, its own 44px row like the circle card's headings. */
export const LABEL_TAP = "inline-flex min-h-11 items-center text-left";

export function CcosTerm({ term, children, tap = EYEBROW_TAP }: { term: string | null | undefined; children: ReactNode; tap?: string }) {
  if (!term) return <>{children}</>;
  return (
    <InfoTip tip={term} triggerClassName={tap}>
      {children}
    </InfoTip>
  );
}

/** The player card's term: the design's dotted underline and its night tooltip. */
export function CardTerm({ term, children }: { term: string | null | undefined; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const pinned = useRef(false);
  const pointerDown = useRef(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const tip = useRef<HTMLSpanElement | null>(null);
  const id = useId();

  const hide = () => {
    pinned.current = false;
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onDown = (e: Event) => {
      if (wrap.current && e.target instanceof Node && wrap.current.contains(e.target)) return;
      hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // The design opens the term at the words' left edge. Near the screen's right
  // edge that would run off it, so it is nudged back in, and only then.
  useLayoutEffect(() => {
    if (!open || !tip.current || typeof window === "undefined") return;
    const r = tip.current.getBoundingClientRect();
    const over = r.right - (window.innerWidth - 8);
    setShift(over > 0 ? -Math.ceil(over) : 0);
  }, [open]);

  if (!term) return <>{children}</>;
  return (
    <span ref={wrap} className="pc-ccoswrap">
      <button
        type="button"
        className="pc-ccos"
        aria-expanded={open}
        aria-describedby={id}
        onPointerDown={() => {
          pointerDown.current = true;
        }}
        onClick={() => {
          pointerDown.current = false;
          if (open && pinned.current) hide();
          else {
            pinned.current = true;
            setOpen(true);
          }
        }}
        onFocus={() => {
          if (!pointerDown.current) setOpen(true);
        }}
        onBlur={hide}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinned.current) setOpen(false);
        }}
      >
        {children}
      </button>
      <span ref={tip} id={id} role="tooltip" className="pc-ccostip" hidden={!open} style={shift ? { left: shift } : undefined}>
        {term}
      </span>
    </span>
  );
}
