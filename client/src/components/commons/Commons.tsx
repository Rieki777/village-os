/**
 * THE COMMONS, drawn (Phase D, decision 2): this season's goals as circles,
 * moss spreading into each one the village has reached.
 *
 * Moss means the village's shared work (the sitewide grammar). It never sits
 * beside a person, and this drawing takes goals and nothing else: no name,
 * no member, no personal count can reach it. A goal not reached yet holds a
 * seed at its heart; a reached goal is moss to its edge, ringed in gold, with
 * a small six-petalled flower opening at its heart.
 *
 * It takes data and decides nothing: the caller says which goals there are
 * and which one is in hand (`active`), so a list beside it can light the
 * matching circle on hover or focus (desktop) or on a tap (phone). Hovering a
 * circle names it back to the caller through `onActive`.
 *
 * Motion: the moss spreads once and the flower opens after it, inside 1.6s.
 * Under reduced motion the finished drawing is simply there.
 */
import type { CSSProperties } from "react";
import { useReducedMotion } from "@/components/natural/useReducedMotion";
import { fx } from "@/components/journey/nature/geometry";
import { PETALS, VIEW, commonsLayout, mossDots, mossShare } from "./commonsGeometry";
import "./commons.css";

export interface CommonsGoal {
  id: string;
  done: boolean;
}

export interface CommonsProps {
  goals: readonly CommonsGoal[];
  /** What a screen reader hears, in the caller's words. */
  label: string;
  /** The goal in hand, by index, or null. */
  active?: number | null;
  /** Called with a circle's index when the pointer rests on it, and null when it leaves. */
  onActive?: (i: number | null) => void;
  className?: string;
}

/** How long the moss takes to reach the last dot of a goal, before each dot's own 500ms. */
const SPREAD_S = 0.6;

export default function Commons({ goals, label, active = null, onActive, className = "" }: CommonsProps) {
  const still = useReducedMotion();
  const { circles, boundary } = commonsLayout(goals.length);
  if (!circles.length) return null;
  const reached = goals.filter((g) => g.done).length;
  return (
    <span
      className={`cm relative block aspect-square w-full ${className}`.trim()}
      data-motion={still ? "still" : "live"}
      data-active={active !== null ? "true" : undefined}
      data-goals={goals.length}
      data-reached={reached}
    >
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={label} className="block size-full overflow-visible">
        <defs>
          {circles.map((c, i) => (
            <clipPath key={i} id={`cm-clip-${i}`}>
              <circle cx={fx(c.x)} cy={fx(c.y)} r={fx(c.r)} />
            </clipPath>
          ))}
        </defs>
        <circle cx={50} cy={50} r={fx(boundary)} fill="none" className="text-border" stroke="currentColor" strokeOpacity={0.45} strokeWidth={0.5} />
        {circles.map((c, i) => {
          const goal = goals[i];
          const share = mossShare(goal);
          const dots = mossDots(c, share);
          const on = active === i;
          return (
            <g
              key={goal.id}
              className="cm-goal"
              data-goal={i}
              data-state={goal.done ? "reached" : "seed"}
              data-active={on ? "true" : undefined}
              onPointerEnter={onActive ? () => onActive(i) : undefined}
              onPointerLeave={onActive ? () => onActive(null) : undefined}
            >
              {dots.length > 0 && (
                <g className="cm-moss" clipPath={`url(#cm-clip-${i})`} data-testid="commons-moss">
                  {dots.map((d, k) => (
                    <circle
                      key={k}
                      cx={fx(d.x)}
                      cy={fx(d.y)}
                      r={fx(d.size)}
                      className={d.lit ? "text-notice" : "text-open"}
                      fill="currentColor"
                      fillOpacity={d.lit ? 0.85 : 0.35 + (k % 4) * 0.12}
                      style={{ "--cm-delay": `${(d.order * SPREAD_S + i * 0.05).toFixed(2)}s` } as CSSProperties}
                    />
                  ))}
                </g>
              )}
              {/* The goal's own edge: gold once reached, a quiet line before. Wider when it is in hand. */}
              <circle
                cx={fx(c.x)}
                cy={fx(c.y)}
                r={fx(c.r)}
                fill="transparent"
                className={on ? "text-foreground" : goal.done ? "text-notice" : "text-border"}
                stroke="currentColor"
                strokeWidth={on ? 1.4 : goal.done ? 1 : 0.7}
                strokeDasharray={goal.done || on ? undefined : "1.2 1.6"}
              />
              {goal.done ? (
                <g transform={`translate(${fx(c.x)} ${fx(c.y)})`}>
                  <g className="cm-flower text-notice" data-testid="commons-flower">
                    {PETALS.map((a) => (
                      <ellipse
                        key={a}
                        cx={0}
                        cy={-c.r * 0.13}
                        rx={c.r * 0.07}
                        ry={c.r * 0.14}
                        transform={`rotate(${a})`}
                        fill="currentColor"
                        fillOpacity={0.4}
                        stroke="currentColor"
                        strokeWidth={0.3}
                      />
                    ))}
                    <circle r={c.r * 0.06} fill="currentColor" />
                  </g>
                </g>
              ) : (
                // A seed, sown and waiting: the state of a piece of work before anything grows.
                <ellipse
                  cx={fx(c.x)}
                  cy={fx(c.y)}
                  rx={fx(c.r * 0.06)}
                  ry={fx(c.r * 0.1)}
                  transform={`rotate(-30 ${fx(c.x)} ${fx(c.y)})`}
                  className="text-open"
                  fill="currentColor"
                  fillOpacity={0.7}
                  data-testid="commons-seed"
                />
              )}
            </g>
          );
        })}
      </svg>
    </span>
  );
}
