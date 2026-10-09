import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useModule } from "@/modules/ModuleProvider";

/**
 * A window onto the Living Map, on the landing page.
 *
 * Most people who arrive never find the map, because it is one entry in a
 * menu and a menu entry cannot show you painted land. A moving picture of the
 * village can, so this is a framed peek that opens the real thing.
 *
 * ── WHY IT DOES NOT JUST EMBED THE MAP ───────────────────────────────────
 * The artifact is four megabytes. Loading it for every arrival, including the
 * ones who scroll past, would put the landing page's weight up by an order of
 * magnitude and spend a rural phone's data on something nobody asked for.
 * This repo already measures that: the CI bundle budget caps the whole of
 * dist at 6 MB, and one visit here would exceed it.
 *
 * So the peek is lazy on three conditions, all of which must hold:
 *  - the map module is on for this viewer (no dead frame on a fresh fork),
 *  - the card has actually scrolled into view,
 *  - the connection has not asked us to be careful (`saveData`, or 2g/3g).
 * When any fails, the same card renders as a still invitation that costs
 * nothing. Either way the click goes to the real map.
 *
 * The frame is inert: `pointer-events: none` and `tabIndex={-1}`, so the peek
 * cannot swallow a scroll on a phone or trap focus on the way down the page.
 * It is a picture that happens to be alive; the whole card is the link.
 */
export default function MapPeek() {
  const mapModule = useModule("map");
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!mapModule) return;
    const el = hostRef.current;
    if (!el) return;

    /*
     * Respect a metered connection. `connection` is unavailable on Safari, in
     * which case the peek loads: guessing "expensive" for every iOS visitor
     * would disable the feature for most phones on the strength of a missing
     * API.
     */
    const conn = (navigator as any).connection;
    const frugal = Boolean(conn?.saveData) || /(^|-)(2g|slow-2g)$/.test(String(conn?.effectiveType ?? ""));
    if (frugal) return;
    // A moving map is decoration, and decoration yields to this preference.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    if (typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mapModule?.id]);

  // Nothing to advertise on a fork whose map is off.
  if (!mapModule) return null;

  return (
    <section className="py-16 bg-background">
      <div className="container max-w-5xl">
        <div className="text-center mb-8">
          <h2 className="font-display text-3xl font-bold text-foreground mb-2">
            See the village
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {/* It promised every building traced to something true, the same
                promise the map's own guide made over sample data, and both
                were taken back on 2026-10-02. The map says how it moves. */}
            The village drawn as a map you can walk. Step in and tap any building to open its door.
          </p>
        </div>

        <Link href="/map">
          <a
            ref={hostRef as any}
            className="group block relative rounded-2xl overflow-hidden border border-border shadow-lg
                       aspect-[16/9] bg-teal-deep/10 focus:outline-none focus-visible:ring-2
                       focus-visible:ring-teal-deep"
            aria-label="Open the Living Map"
          >
            {live ? (
              <iframe
                src="/grounds/index.html#?peek=1"
                title=""
                aria-hidden="true"
                tabIndex={-1}
                loading="lazy"
                className="pointer-events-none absolute inset-0 h-full w-full border-0"
              />
            ) : (
              // The still card. Costs nothing and says the same thing.
              <div className="absolute inset-0 bg-gradient-to-br from-teal-deep/25 via-teal-deep/10 to-amber/20" />
            )}

            {/* A scrim so the label stays legible over painted land. */}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent p-5">
              <span className="inline-flex items-center gap-2 text-white font-medium">
                Open the Living Map
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                  &rarr;
                </span>
              </span>
            </div>
          </a>
        </Link>
      </div>
    </section>
  );
}
