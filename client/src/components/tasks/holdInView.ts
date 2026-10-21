/**
 * KEEP A LANDED CARD IN VIEW WHILE THE PAGE ABOVE IT SETTLES.
 *
 * A task link (/profile#task-<id>, from an email, a notice or the menu) lands
 * once the board has drawn. On a first visit the sections above the board
 * (the waiting card, the dashboard, the banners) are still arriving, and each
 * one that draws pushes the board down: a tour on a phone saw the card's top
 * go from 1536 to 860, below an 844 fold, while it wore its ring and held
 * focus out of sight.
 *
 * So the landing holds. For a short while after the first scroll it watches
 * the page's size, and whenever the target has drifted more than a few pixels
 * from where its own scroll margin puts it, it scrolls it back, at once and
 * without a glide. It lets go at the first wheel, touch or key from the
 * reader, who has taken the page into their own hands, or when the time is up.
 *
 * Where there is no ResizeObserver it holds nothing and simply settles at the
 * end, which is what the first scroll already did.
 */

/** How long a landing holds its target while the page settles. */
export const HOLD_IN_VIEW_MS = 3000;

/** Drift smaller than this is the page breathing, not moving. */
const DRIFT_PX = 6;

const READER_TOOK_OVER = ["wheel", "touchstart", "keydown", "mousedown"] as const;

export interface HoldOptions {
  /** How long to hold. */
  ms?: number;
  /** Runs once, when the hold ends for any reason other than being cancelled. */
  onSettle?: () => void;
}

/** Where the target should sit: its own scroll margin below the top of the viewport. */
function restingTop(el: HTMLElement): number {
  try {
    const margin = parseFloat(window.getComputedStyle(el).scrollMarginTop);
    return Number.isFinite(margin) ? margin : 0;
  } catch {
    return 0;
  }
}

/**
 * Hold `el` where the first scroll put it. Answers a function that lets go
 * without settling, for a newer landing that replaces this one.
 */
export function holdInView(el: HTMLElement, { ms = HOLD_IN_VIEW_MS, onSettle }: HoldOptions = {}): () => void {
  if (typeof window === "undefined") return () => {};
  let done = false;
  let observer: ResizeObserver | null = null;
  let timer = 0;

  const stop = (settle: boolean) => {
    if (done) return;
    done = true;
    observer?.disconnect();
    window.clearTimeout(timer);
    for (const e of READER_TOOK_OVER) window.removeEventListener(e, letGo, true);
    if (settle) onSettle?.();
  };
  const letGo = () => stop(true);

  const check = () => {
    if (done || !el.isConnected) return;
    const top = el.getBoundingClientRect().top;
    if (Math.abs(top - restingTop(el)) > DRIFT_PX) el.scrollIntoView?.({ block: "start", behavior: "auto" });
  };

  if (typeof ResizeObserver === "function") {
    // An observer reports once as soon as it starts, mid-glide, before anything
    // has moved: that first report is not drift, and snapping on it would cut
    // the first scroll's glide short.
    let first = true;
    observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      check();
    });
    observer.observe(document.body);
  }
  for (const e of READER_TOOK_OVER) window.addEventListener(e, letGo, { capture: true, passive: true });
  timer = window.setTimeout(() => {
    check();
    stop(true);
  }, ms);

  return () => stop(false);
}
