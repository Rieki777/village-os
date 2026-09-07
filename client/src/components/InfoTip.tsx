/**
 * InfoTip (R46): the tooltip layer under the enchant-first copy ruling. The
 * surface line enchants in the map's register; the plaque this component
 * opens carries the plain one-sentence mechanics. One card may wear up to
 * three of these where three concepts genuinely live on it; a plaque never
 * contains another trigger.
 *
 * Why not the shadcn/Radix tooltip two doors down: Radix tooltips never open
 * on touch, and mobile is most of this audience. This trigger is a real
 * button, so tap toggles it, Tab reaches it, Enter and Space toggle it,
 * Escape dismisses it, and hover still works for mouse visitors.
 *
 * Accessibility contract:
 * - The trigger is a <button> with aria-expanded and a focus-visible ring.
 * - The plaque is aria-describedby-linked and stays in the DOM sr-only while
 *   closed, so a screen reader hears the mechanics on focus without needing
 *   the visual open state.
 * - Keyboard focus opens the plaque visually too, and blur closes it.
 * - The plaque positions FIXED from the trigger's measured rect, so an
 *   overflow-hidden card ancestor never clips it; scrolling closes it
 *   instead of letting it drift.
 *
 * The plaque wears the map's parchment look (the cp-plaque palette from the
 * crowdpool pieces), so the two tooltip families read as one voice.
 */
import { useEffect, useId, useRef, useState } from "react";

const PLAQUE_MAX_W = 264;

interface InfoTipProps {
  /** The plain mechanics, one to three short sentences. Text only. */
  tip: string;
  /** The visible trigger. Omit it for the small circled question mark. */
  children?: React.ReactNode;
  /** Names the bare-mark trigger for screen readers. Default "What is this?" */
  label?: string;
  className?: string;
}

export default function InfoTip({ tip, children, label, className = "" }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // True while a pointer interaction is underway, so the focus that a tap or
  // click raises does not pre-open the plaque the click is about to toggle.
  const pointerDown = useRef(false);
  // True when the plaque was pinned open by a click or tap; a pinned plaque
  // ignores mouseleave and closes on outside tap, Escape, or a second tap.
  const pinned = useRef(false);
  const id = useId();

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(PLAQUE_MAX_W, vw - 16);
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    const above = r.bottom + 150 > vh && r.top > 150;
    setPos({ top: above ? r.top - 8 : r.bottom + 8, left, above });
  };

  const show = () => {
    place();
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    pinned.current = false;
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const onDocDown = (e: Event) => {
      if (triggerRef.current && e.target instanceof Node && triggerRef.current.contains(e.target)) return;
      hide();
    };
    // Scrolling would leave a fixed plaque floating over the wrong words.
    const onScroll = () => hide();
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDocDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const bare = children == null;
  const w = typeof window !== "undefined" ? Math.min(PLAQUE_MAX_W, window.innerWidth - 16) : PLAQUE_MAX_W;

  return (
    <span className={`relative inline-block ${className}`}>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-describedby={id}
        aria-label={bare ? (label ?? "What is this?") : undefined}
        onPointerDown={() => {
          pointerDown.current = true;
        }}
        onClick={() => {
          pointerDown.current = false;
          if (open && pinned.current) {
            hide();
          } else {
            pinned.current = true;
            show();
          }
        }}
        onFocus={() => {
          if (!pointerDown.current) show();
        }}
        onBlur={hide}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (!pinned.current) setOpen(false);
        }}
        className={
          bare
            // `before:-inset-1.5` grows the TOUCH TARGET and nothing else.
            // Measured on a real 390px phone: this control is 16 by 16 CSS
            // pixels, and WCAG 2.5.8 asks 24 by 24 at AA, so a thumb was being
            // asked to hit two thirds of the minimum. The circle is 16px by
            // design and is in twenty-six files, so growing the VISUAL would
            // reflow every one of them; an invisible inset pseudo-element
            // takes the hit area to 28 by 28 and moves no layout anywhere.
            ? "relative inline-flex items-center justify-center align-middle w-4 h-4 ml-1 rounded-full border border-current/40 text-[10px] leading-none opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep/60 cursor-help select-none before:absolute before:-inset-1.5 before:content-['']"
            : "underline decoration-dotted decoration-1 underline-offset-4 cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep/60"
        }
      >
        {bare ? <span aria-hidden="true">?</span> : children}
      </button>
      <span
        id={id}
        role="tooltip"
        style={
          open && pos
            ? {
                position: "fixed",
                top: pos.above ? undefined : pos.top,
                bottom: pos.above ? window.innerHeight - pos.top : undefined,
                left: pos.left,
                width: w,
                zIndex: 80,
                background: "linear-gradient(180deg,#fdf3d7,#efdcae)",
                border: "1px solid #8a6a33",
                borderRadius: 10,
                color: "#241a10",
                boxShadow: "0 2px 10px rgba(0,0,0,.25)",
              }
            : undefined
        }
        className={
          open && pos
            ? "block px-3 py-2 text-xs font-normal leading-relaxed text-left normal-case tracking-normal"
            : "sr-only"
        }
      >
        {tip}
      </span>
    </span>
  );
}
