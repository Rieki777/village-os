import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * The element a URL hash names by id, or null when it names none.
 *
 * This used to be `document.querySelector(hash)`, which reads the hash as a
 * CSS selector. A hash is not a selector. The Living Map's deep links are
 * addresses like `#/place/greenhouse` and `#hud=pocket`, and neither parses,
 * so every one of them threw "is not a valid selector" from inside a timer
 * nobody catches. Ids the selector syntax cannot spell threw the same way,
 * such as one that starts with a digit or carries a percent-encoded letter.
 *
 * `getElementById` takes any string and never throws. The raw text is tried
 * first and the decoded text second, which is the order a browser follows
 * for its own fragment links. Decoding is the only step that can throw, on a
 * malformed escape like `%E0%A4%A`, and such a hash names nothing.
 */
export function hashTarget(hash: string, doc: Document = document): HTMLElement | null {
  if (hash.length < 2 || hash[0] !== "#") return null;
  const raw = hash.slice(1);
  const byRaw = doc.getElementById(raw);
  if (byRaw) return byRaw;
  try {
    return doc.getElementById(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/**
 * Whether the page at `path` owns its hash as an address.
 *
 * The Living Map at `/map` keeps its own route in the hash and forwards it to
 * the artifact it frames. It is a fixed, full-screen surface over a body that
 * cannot scroll, so there is never anything there to scroll TO. Reading its
 * hash as an anchor can only do harm: `scrollIntoView` also scrolls ancestors
 * a visitor cannot scroll by hand, so a chance match on an id would slide the
 * whole map sideways.
 */
function hashIsAnAddress(path: string): boolean {
  return path.replace(/\/+$/, "") === "/map";
}

export default function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    // If the URL carries an anchor (e.g. /#choose-path from another page),
    // scroll to it once the new page has rendered instead of forcing the top.
    const hash = window.location.hash;
    if (hash && !hashIsAnAddress(location)) {
      const t = setTimeout(() => {
        const el = hashTarget(hash);
        if (el) el.scrollIntoView({ behavior: "smooth" });
        else window.scrollTo({ top: 0, behavior: "instant" });
      }, 100);
      return () => clearTimeout(t);
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);

  // A NEW PAGE TAKES FOCUS. Every page renders its own Layout, so following a
  // link unmounts the element that had focus and the browser drops it on
  // <body>: a screen reader heard nothing, and on a phone the next Tab landed
  // in the bottom bar (measured on 4 of 4 in-app navigations). Focus goes to
  // <main> instead, which already has tabIndex -1 for the skip link, so the
  // reader announces the new page and the next Tab starts in its content.
  // Not on first load (the visitor's own start), not when the address carries
  // a hash (the effect above owns that), and never away from a field the new
  // page focused itself. Lazy pages arrive a few frames late, so it waits.
  const settled = useRef(location);
  useEffect(() => {
    if (location === settled.current) return;
    settled.current = location;
    if (window.location.hash) return;
    let frame = 0;
    let tries = 0;
    const land = () => {
      const main = document.getElementById("main");
      if (main) {
        if (!main.contains(document.activeElement)) main.focus({ preventScroll: true });
        return;
      }
      if (++tries < 300) frame = requestAnimationFrame(land);
    };
    frame = requestAnimationFrame(land);
    return () => cancelAnimationFrame(frame);
  }, [location]);
  return null;
}
