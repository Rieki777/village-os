import { useEffect, useState } from "react";

/**
 * The page's hash, kept current. A notice's link is a client-side move
 * (wouter pushes the history entry), which fires no `hashchange`, so the
 * router's own events are read too. The agenda items and "Coming up" on
 * /sessions both land a notice's link with it.
 */
export function useHash(): string {
  const read = () => (typeof window === "undefined" ? "" : window.location.hash);
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const update = () => setHash(read());
    const events = ["hashchange", "popstate", "pushState", "replaceState"];
    for (const e of events) window.addEventListener(e, update);
    return () => {
      for (const e of events) window.removeEventListener(e, update);
    };
  }, []);
  return hash;
}
