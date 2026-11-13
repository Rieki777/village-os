/**
 * THE LANTERN: a thanks on its way, and the moment it arrives.
 *
 * It shows in exactly two moments and nowhere else (the sitewide grammar):
 *   - `carrying`: the send is in flight. The lantern rises from the hand.
 *   - `arrived`: the server said yes. The lantern rests over a thread that
 *     has just drawn itself between two points, and the words say it reached
 *     the person. From here it is a thread on the web.
 *
 * Ceremony is a bloom, never a burst: one rise of up to 1.6s, one thread
 * drawn, nothing that loops. The light inside is a soft radial fill in the
 * drawing itself, so no page class carries a glow. Under reduced motion both
 * moments are drawn still and complete: the lantern in its place, the thread
 * whole.
 */
import { m } from "framer-motion";
import { useId } from "react";
import { useLingui } from "@lingui/react/macro";

import { useReducedMotion } from "@/components/natural/useReducedMotion";

export type LanternMoment = "carrying" | "arrived";

export interface LanternProps {
  moment: LanternMoment;
  /** Who it is going to, for the words under it. */
  toName: string;
  /** Under the arrival words: what happens next, in the caller's words. */
  after?: string;
}

const EASE = [0.3, 0.6, 0.2, 1] as const;

export default function Lantern({ moment, toName, after }: LanternProps) {
  const { t } = useLingui();
  const still = useReducedMotion();
  const glowId = `lantern-glow-${useId().replace(/:/g, "")}`;
  const arrived = moment === "arrived";
  const name = toName || t({ message: "them", context: "lantern: the person a thanks is going to, when no name is known" });

  return (
    <div className="py-2 text-center" data-testid="lantern" data-moment={moment} data-motion={still ? "still" : "live"}>
      <svg viewBox="0 0 300 150" className="mx-auto block h-36 w-full max-w-xs" aria-hidden="true">
        <defs>
          <radialGradient id={glowId}>
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.55} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </radialGradient>
        </defs>
        {/* The thread it becomes: drawn once it has arrived. */}
        {arrived && (
          <m.path
            d="M40 126 Q150 92 260 126"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className="text-notice"
            initial={still ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: EASE }}
            data-testid="lantern-thread"
          />
        )}
        <m.g
          initial={still ? false : { y: arrived ? 0 : 40, opacity: arrived ? 1 : 0 }}
          animate={{ y: arrived ? 0 : -6, opacity: 1 }}
          transition={{ duration: 1.6, ease: EASE }}
        >
          <circle cx={150} cy={58} r={40} fill={`url(#${glowId})`} className="text-notice" />
          <line x1={150} y1={14} x2={150} y2={26} stroke="currentColor" strokeWidth={1.4} className="text-notice" />
          <rect x={134} y={26} width={32} height={6} rx={2} fill="currentColor" className="text-notice" />
          <path d="M136 32 C126 46 126 70 136 84 L164 84 C174 70 174 46 164 32 Z" fill="currentColor" fillOpacity={0.12} stroke="currentColor" strokeWidth={1.6} className="text-notice" />
          <path d="M150 32 L150 84" stroke="currentColor" strokeWidth={0.8} opacity={0.6} className="text-notice" />
          <rect x={134} y={84} width={32} height={6} rx={2} fill="currentColor" className="text-notice" />
          <circle cx={150} cy={58} r={5} fill="currentColor" className="text-foreground" />
        </m.g>
      </svg>
      <p className="font-display text-xl text-card-foreground" role="status">
        {arrived
          ? t({ message: `Your lantern reached ${name}`, context: "lantern: a thanks arrived" })
          : t({ message: `Carrying your thanks to ${name}`, context: "lantern: a thanks on its way" })}
      </p>
      {arrived && after && <p className="mt-1 text-sm text-muted-foreground">{after}</p>}
    </div>
  );
}
