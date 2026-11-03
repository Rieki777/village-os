/**
 * Move the open admin tab to one card, after that card has actually rendered.
 *
 * The tab change paints first. A scroll fired in the same turn looks for an
 * element the fetch has not drawn yet and does nothing. This retries for a
 * short while, then places the card under the sticky header and moves focus
 * to its heading.
 */
const WAIT_MS = 2000;
const STEP_MS = 100;
const LIT_MS = 1600;

export function revealCard(id: string, now: () => number = Date.now): void {
  const started = now();
  const tick = () => {
    const el = document.getElementById(`integration-${id}`);
    if (!el) {
      if (now() - started < WAIT_MS) window.setTimeout(tick, STEP_MS);
      return;
    }
    const place = () => {
      const header = document.querySelector("header");
      const offset = (header?.getBoundingClientRect().height ?? 0) + 16;
      const want = window.scrollY + el.getBoundingClientRect().top - offset;
      const main = document.querySelector("main");
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (main && want > max) {
        const extra = want - max + 24;
        const current = Number.parseFloat(main.style.paddingBottom || "0");
        main.style.paddingBottom = `${current + extra}px`;
      }
      window.scrollTo({ top: Math.max(0, want) });
    };
    place();
    window.requestAnimationFrame(place);
    window.setTimeout(place, 350);
    window.setTimeout(place, 800);
    const heading = el.matches("h1, h2, h3") ? el : el.querySelector("h2, h3, p");
    const focus = heading instanceof HTMLElement ? heading : el;
    if (!focus.hasAttribute("tabindex")) focus.tabIndex = -1;
    window.setTimeout(() => focus.focus({ preventScroll: true }), 850);
    el.setAttribute("data-lit", "1");
    window.setTimeout(() => el.removeAttribute("data-lit"), LIT_MS + 800);
  };
  window.setTimeout(tick, STEP_MS);
}
