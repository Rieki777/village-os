import { useEffect } from "react";
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
  return null;
}
