/**
 * THE 404's SCENE (Phase B, lane B3): a root that wandered off the trail and
 * frays at its end, a short path of stepping stones from there, and a lit
 * door home. One door, gold, with fireflies on it: the one act on the page.
 *
 * Lazy on purpose. NotFound.tsx is imported by the app shell (every unknown
 * route lands on it), and the nature kit must never reach the first page
 * (docs/DESIGN_RULE.md, "The nature kit"). NotFound draws the landmark and the
 * language bar at once and this arrives a moment later in its own chunk.
 *
 * Phone and desktop, each at its best:
 * - a phone stacks a short, full-bleed trail over the words, so the door is
 *   inside the first screen at 390px;
 * - a desktop sets the trail beside the words as one wide scene in a panel,
 *   and the trail runs toward the door the words lead to. Hovering or focusing
 *   the door draws its fireflies in (the kit's own desktop behaviour).
 *
 * Still under reduced motion: the drawing never moves, and the fireflies are
 * a still drawing of the same lights (Fireflies reads useReducedMotion).
 */
import { useLingui } from "@lingui/react/macro";
import { Link } from "wouter";
import { BTN_PRIMARY, EYEBROW, H1, LEDE } from "@/components/journey/look";
import Fireflies from "@/components/journey/nature/Fireflies";
import { fx } from "@/components/journey/nature/geometry";
import { offTrailScene } from "./quietGeometry";

export function TrailDrawing({ className = "" }: { className?: string }) {
  const s = offTrailScene();
  return (
    <svg
      viewBox={`0 ${s.top} ${s.width} ${s.height - s.top}`}
      aria-hidden="true"
      focusable="false"
      data-drawing="off-trail"
      className={`block h-auto w-full ${className}`.trim()}
    >
      <path d={s.ground} fill="currentColor" className="text-muted" />
      <path d={s.groundEdge} fill="none" stroke="currentColor" strokeWidth={1} className="text-open" opacity={0.45} />
      <path d={s.root} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="text-open" opacity={0.6} />
      {s.frays.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" className="text-open" opacity={0.5} data-fray="" />
      ))}
      {s.stones.map((st, i) => (
        <ellipse
          key={i}
          cx={st.cx}
          cy={st.cy}
          rx={st.rx}
          ry={st.ry}
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={1}
          className="text-muted-foreground"
          fillOpacity={0.18}
          strokeOpacity={0.6}
          data-stone=""
        />
      ))}
      <ellipse cx={s.glow.cx} cy={s.glow.cy} rx={s.glow.rx} ry={s.glow.ry} fill="currentColor" className="text-notice" opacity={0.07} />
      <path d={s.door} fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.4} className="text-notice" data-door="" />
      {s.lights.map((l, i) => (
        <circle key={i} cx={fx(l.x)} cy={fx(l.y)} r={l.r} fill="currentColor" className="text-notice" opacity={0.5 + (i % 3) * 0.15} />
      ))}
    </svg>
  );
}

export default function OffTheTrail() {
  const { t } = useLingui();
  return (
    <section
      aria-labelledby="off-trail-title"
      className="mx-auto grid w-full max-w-6xl items-center gap-6 py-4 sm:rounded-2xl sm:border sm:border-border sm:bg-card sm:p-10 sm:shadow-sm lg:grid-cols-[1.2fr_1fr] lg:gap-12 lg:p-12"
    >
      {/* Full bleed on a phone: the trail runs edge to edge above the words. */}
      <div className="-mx-4 sm:mx-0">
        <TrailDrawing />
      </div>
      <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
        <p className={EYEBROW}>404</p>
        <h1 id="off-trail-title" className={`${H1} mt-2`}>
          {t({ message: "Off the trail", context: "404 page heading" })}
        </h1>
        <p className={`${LEDE} mt-4`}>
          {t`There is no page at this address. It may have moved, or it may never have existed. The land is still here, and the way home is short.`}
        </p>
        <div className="mt-8">
          <Fireflies count={7}>
            <Link href="/" className={BTN_PRIMARY}>
              {t`Back to the village`}
            </Link>
          </Fireflies>
        </div>
      </div>
    </section>
  );
}
