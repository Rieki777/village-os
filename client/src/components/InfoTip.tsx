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
 * - The plaque is aria-describedby-linked and stays in the DOM while closed,
 *   so a screen reader hears the mechanics on focus without needing the
 *   visual open state. It is `hidden` while closed, NOT `sr-only`: see below.
 * - Keyboard focus opens the plaque visually too, and blur closes it.
 * - The plaque positions FIXED from the trigger's measured rect, so an
 *   overflow-hidden card ancestor never clips it; scrolling closes it
 *   instead of letting it drift.
 *
 * WHY THE CLOSED PLAQUE IS `hidden` AND NOT `sr-only`. This wrapper is
 * `relative inline-block`, so the plaque node sits in the HOST PARAGRAPH'S
 * INLINE FLOW. An `sr-only` node is out of the VISUAL flow and fully inside
 * the reading order, so every one of these read its definition MID-SENTENCE
 * and then let the host sentence resume as a fragment after a full stop, and
 * then read the same words AGAIN when the trigger took focus. On /campaigns
 * that was: "...through the hub's crowdpool A crowdpool gathers pledges of
 * money, goods, tools and hands for one build. Nothing moves through this
 * page; every claim finishes on the hub's own page. . Each ring fills as the
 * pool does". It renders perfectly for sighted visitors, which is why no
 * screenshot, contrast pass or overflow sweep could ever have caught it.
 *
 * `hidden` (display:none) takes the node out of the accessibility tree
 * altogether, and accname (Accessible Name and Description Computation 1.2,
 * step 2A) carves out one exception: a node hidden but DIRECTLY referenced by
 * aria-labelledby or aria-describedby is still traversed for the description.
 * So both halves hold, which is the whole requirement: out of the sentence,
 * still resolvable on focus. Measured in Chromium 153.0.8010.12 over the
 * browser's own accessibility tree: the button's computed description is the
 * tip text while the plaque is `hidden`, and the tip text is NOT among the
 * tree's static-text nodes. Under `sr-only` the description resolved too and
 * the text WAS a static-text node, which is the defect.
 *
 * The same defect had a second face, in HEADINGS. Fourteen of the call sites
 * sit inside an h2, h3 or h4, and a heading's accessible name is computed
 * from its content, which `sr-only` content is part of. Measured the same
 * way: the governance "Your weight" h3 was named "Your weight What voting
 * weight is Weight is how much a vote counts. It is read when a ballot opens
 * and frozen there, so a later change never rewrites a vote in flight." in a
 * screen reader's list of headings. Under `hidden` it is "Your weight What
 * voting weight is".
 *
 * A portal was the other candidate, and the probe ruled it out: a portalled
 * `sr-only` description was still a static-text node, merely relocated to the
 * end of the document, so it is read out of nowhere instead of mid-sentence.
 * A portal only helps if the node is ALSO hidden, and once it is hidden the
 * portal adds nothing. Clipping needs no portal either, since the open plaque
 * is already position:fixed. And the open plaque sets no font family or font
 * variant of its own, so moving it would make its face depend on the body
 * instead of on the host it opens from.
 *
 * The OPEN plaque stays where it is, beside its trigger: that is the expected
 * DOM position for role="tooltip", and the open state is always
 * user-initiated.
 *
 * The plaque wears the map's parchment look (the cp-plaque palette from the
 * crowdpool pieces), so the two tooltip families read as one voice.
 */
import { decayReachSentence } from "@shared/tokenScale";
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
        // display:none while closed. The node stays in the DOM so the
        // aria-describedby above still resolves; see the header for what was
        // measured and why `sr-only` was the defect.
        hidden={!(open && pos)}
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
            : undefined
        }
      >
        {tip}
      </span>
    </span>
  );
}

/**
 * THE SMALLEST BALANCE A WANING RATE ACTUALLY REACHES, said beside the dial.
 *
 * Here beside `InfoTip` because both are the same kind of thing: the extra
 * sentence a control carries so a person can act on it. The difference is that
 * a plaque explains what a dial MEANS and this one states what the value in
 * front of you WOULD DO, computed rather than written.
 *
 * `decayVoice` floors each member's share and skips the member when the answer
 * is zero, so every percentage has a line below which it silently does nothing.
 * At one percent and two decimals that line is one whole Voice, and at half a
 * percent it is two. A number that quietly stops applying below a line is a
 * promise the village cannot see it is not keeping, and a village voting a
 * small percentage to be gentle may be voting one that reaches almost nobody
 * while the panel shows it working.
 *
 * A STATEMENT OF FACT AND NEVER A REFUSAL. The standing ruling is that a
 * warning never blocks, and this sits one step below a warning.
 *
 * The sentence comes from `shared/tokenScale.ts`, which derives it from
 * `decayUnits`, the SAME floor the engine uses. A displayed number and an
 * actual behaviour that are different quantities is the mint cap's lesson.
 *
 * It reads the STAGED value when there is one, so it moves as the dial moves.
 * A `span` and not a `p`, because it renders inside the description paragraph.
 *
 * PROPOSED BY THE GOVERNANCE SESSION on 2026-09-04 and NOT a founder ruling.
 * Rye ruled the scale and this follows from the same measurement, and he has
 * not been asked for it.
 */
export function DialFact({
  v,
  staged,
}: {
  v: { key: string; value?: string; default?: string };
  staged?: string;
}) {
  if (v.key !== "economy.voice_decay_pct") return null;
  const pct = Number(staged ?? v.value ?? v.default);
  if (!Number.isFinite(pct)) return null;
  return <span className="block text-teal-deep mt-1">{decayReachSentence(pct, "Voice")}</span>;
}
