/**
 * The air on the sheet: slow motes drifting upward through the night.
 *
 * The character sheet is a night ground, and a flat one reads as a dark page
 * rather than as a place. This is the smallest thing that makes it a place:
 * about forty points of moonlight, rising, fading in and out over ten to
 * twenty seconds each. It is behind everything and touches nothing.
 *
 * ── WHY CANVAS AND NOT FORTY DIVS ────────────────────────────────────────
 *
 * Forty absolutely-positioned elements with CSS animations are forty entries
 * in the compositor and forty more nodes for a screen reader to skip. One
 * canvas is one node, `aria-hidden`, and the whole field costs a single
 * `requestAnimationFrame` that draws about forty circles. Reach for SVG or
 * DOM when the shapes carry meaning; these carry none.
 *
 * ── IT IS THE VIEWPORT, NOT THE PAGE, AND THAT WAS A DEFECT FIRST ───────
 *
 * This was `absolute inset-0` over the whole scrolling page, and a real 390px
 * mobile viewport showed what that costs: the canvas came out 390 by 9418 CSS
 * pixels, a 780 by 7802 backing store, 6.1 megapixels and 23 MB of memory for
 * decoration. Worse, `h-full` stretched the ELEMENT to the full page while the
 * backing store had been sized from a smaller rect, so every mote was drawn at
 * the wrong vertical scale.
 *
 * Fixed to the viewport instead: 390 by 844 on that phone, 1.3 megapixels, and
 * the air travels with the reader rather than being a tall picture they scroll
 * past. Nothing on this page transforms an ancestor, which was checked rather
 * than assumed, so `fixed` resolves against the viewport as intended.
 *
 * ── IT STOPS WHEN NOBODY IS LOOKING ──────────────────────────────────────
 *
 * Three ways, and all three matter on a laptop battery:
 *
 *   reduced motion  a member who asked for less gets ONE still frame and no
 *                   loop at all, not the same drift slowed down. The air is
 *                   still; the page is not empty.
 *   hidden tab      `visibilitychange` cancels the frame and resumes it, so a
 *                   profile left open in a background tab draws nothing.
 *   unmount         the frame and both listeners are released together.
 *
 * ── THE COLOUR IS THE THEME'S, READ AT RUNTIME ───────────────────────────
 *
 * Canvas cannot take a Tailwind class, so the ink is read off the mounted
 * element with `getComputedStyle`, which resolves `--foreground` through
 * whatever `.sheet-night` (or a village's own `--sheet-ink`) has set. That
 * keeps one source of truth for the palette and means a re-tinted village gets
 * re-tinted air for free. A browser that answers with nothing gets a plain
 * fallback rather than an invisible field.
 */
import { useEffect, useRef } from "react";

import { useReducedMotion } from "@/components/natural/useReducedMotion";

const COUNT = 40;
/** Alpha never reaches 1: this is air, and air does not compete with text. */
const MAX_ALPHA = 0.42;

interface Mote {
  x: number;
  y: number;
  r: number;
  /** Pixels per second, upward. */
  rise: number;
  /** Seconds for one fade in and out, and where in it this mote starts. */
  period: number;
  offset: number;
}

const seed = (w: number, h: number): Mote[] =>
  Array.from({ length: COUNT }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    r: 0.6 + Math.random() * 1.6,
    rise: 4 + Math.random() * 10,
    period: 10 + Math.random() * 10,
    offset: Math.random() * 20,
  }));

export default function NightMotes() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    let ink = "233, 239, 230";
    try {
      const read = getComputedStyle(el).color;
      const nums = read.match(/[\d.]+/g);
      if (nums && nums.length >= 3) ink = `${nums[0]}, ${nums[1]}, ${nums[2]}`;
    } catch {
      /* the fallback above is the platform's own moonlight */
    }

    let motes: Mote[] = [];
    let w = 0;
    let h = 0;

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = el.getBoundingClientRect();
      // Clamped to the viewport as well as measured from the element. The
      // measurement is right today and a stray `h-full` under a taller parent
      // is all it took to make it wrong before, so the ceiling stays.
      w = Math.max(1, Math.min(Math.floor(rect.width), window.innerWidth));
      h = Math.max(1, Math.min(Math.floor(rect.height), window.innerHeight));
      el.width = Math.floor(w * dpr);
      el.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      motes = seed(w, h);
    };

    const draw = (seconds: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        // Wrap at the top rather than respawn, so the field never thins out.
        const y = ((m.y - m.rise * seconds) % h + h) % h;
        const phase = ((seconds + m.offset) % m.period) / m.period;
        const alpha = Math.sin(phase * Math.PI) * MAX_ALPHA;
        if (alpha <= 0.01) continue;
        ctx.beginPath();
        ctx.arc(m.x, y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ink}, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    fit();

    if (reduced) {
      // One frame, at a moment where roughly half the field is visible.
      draw(2.5);
      const onResize = () => { fit(); draw(2.5); };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      draw((now - started) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (!frame) {
        frame = requestAnimationFrame(tick);
      }
    };
    const onResize = () => fit();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      // `text-foreground` is here to be READ, not to paint: it is what
      // getComputedStyle resolves the ink from above.
      className="pointer-events-none fixed inset-0 h-full w-full text-foreground"
    />
  );
}
