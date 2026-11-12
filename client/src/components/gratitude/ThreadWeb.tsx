/**
 * THE WEB THIS MOON: faces on a ring, a thread between each pair who thanked
 * each other since the moon turned.
 *
 * The drawing is mycelium: what joins people, never how much. So:
 *   - the faces sit in ALPHABETICAL order (`ringPeople`), never by activity;
 *   - a pair draws ONE thread however many thanks passed between them, all
 *     at the same weight;
 *   - nothing on it, and nothing in its label, is a number.
 *
 * A thread lights when its thanks is hovered or focused on the wall
 * (`lit`, desktop, where the web sits beside the words). The newest thread
 * draws itself in once (`fresh`), which is the lantern landing; under reduced
 * motion it is simply there.
 *
 * Phone and desktop: on a phone it is a full-bleed band above the words; on a
 * desktop it is a large panel that stays put beside them. The same drawing
 * scales to its field.
 */
import { m } from "framer-motion";
import { useLingui } from "@lingui/react/macro";

import { useReducedMotion } from "@/components/natural/useReducedMotion";
import type { WallEntry } from "@shared/gratitudeVoices";
import { firstNameOf, initialOf, personKey, ringPeople, ringPlaces, threadPath, webThreads } from "./threads";

const W = 400;
const H = 360;
const CX = W / 2;
const CY = H / 2;
const R = 132;
const FACE = 15;

/** Past this many faces the names give way to the faces alone, each still titled. */
const NAMES_UP_TO = 16;

export interface ThreadWebProps {
  /** This moon's thanks, newest first. */
  entries: readonly WallEntry[];
  /** The pair whose thread is lit, if any. */
  lit?: string | null;
  /** The pair whose thread just landed: it draws itself in once. */
  fresh?: string | null;
  /** The reader's own key (`personKey`), so their face carries a quiet ring. */
  me?: string | null;
  className?: string;
}

export default function ThreadWeb({ entries, lit = null, fresh = null, me = null, className = "" }: ThreadWebProps) {
  const { t } = useLingui();
  const still = useReducedMotion();
  const people = ringPeople(entries);
  const threads = webThreads(entries);
  const places = ringPlaces(people.length, CX, CY, R);
  const at = new Map(people.map((p, i) => [personKey(p), places[i]!]));
  const showNames = people.length <= NAMES_UP_TO;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t({
        message: "This moon's threads between people who thanked each other, faces in alphabetical order",
        context: "thanks web: what the drawing shows, read aloud",
      })}
      className={`block h-auto w-full overflow-visible ${className}`.trim()}
      data-testid="thread-web"
    >
      {/* The ring itself, faint: the shape the faces stand on. */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="currentColor" strokeWidth={0.6} strokeDasharray="1 5" className="text-border" />

      {threads.map((th) => {
        const a = at.get(personKey(th.a));
        const b = at.get(personKey(th.b));
        if (!a || !b) return null;
        const d = threadPath(a, b, { x: CX, y: CY });
        const on = lit === th.key;
        const isFresh = fresh === th.key && !still;
        return (
          <m.path
            key={th.key}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            data-pair={th.key}
            data-lit={on ? "true" : "false"}
            className={th.mutual || on ? "text-notice" : "text-open"}
            strokeWidth={on ? 2.2 : 1.2}
            initial={isFresh ? { pathLength: 0, opacity: 0.4 } : false}
            animate={{ pathLength: 1, opacity: on ? 1 : lit ? 0.25 : 0.6 }}
            transition={isFresh ? { duration: 1.4, ease: [0.3, 0.7, 0.3, 1] } : { duration: 0.4 }}
          />
        );
      })}

      {people.map((p, i) => {
        const pt = places[i]!;
        const mine = me !== null && personKey(p) === me;
        // Labels sit outside the ring, on the side the face is on.
        const left = pt.x < CX - 4;
        const right = pt.x > CX + 4;
        const lx = left ? pt.x - FACE - 5 : right ? pt.x + FACE + 5 : pt.x;
        const ly = right || left ? pt.y + 4 : pt.y < CY ? pt.y - FACE - 6 : pt.y + FACE + 14;
        const anchor = left ? "end" : right ? "start" : "middle";
        return (
          <g key={personKey(p)} data-face={personKey(p)}>
            <title>{p.name}</title>
            {mine && <circle cx={pt.x} cy={pt.y} r={FACE + 4} fill="none" stroke="currentColor" strokeWidth={1} className="text-open" />}
            <circle cx={pt.x} cy={pt.y} r={FACE} stroke="currentColor" strokeWidth={1} className="fill-card text-border" />
            <text x={pt.x} y={pt.y + 4.5} textAnchor="middle" fontSize={13} className="fill-foreground font-display">
              {initialOf(p)}
            </text>
            {showNames && (
              <text x={lx} y={ly} textAnchor={anchor} fontSize={11} className="fill-muted-foreground">
                {firstNameOf(p)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
