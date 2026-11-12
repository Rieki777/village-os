/**
 * THE COMMONS AS A PANEL: the drawing beside the season's goals in words,
 * the two joined so a goal in hand lights its circle.
 *
 * Used on the public landing (VillagePulse) and on a member's own season
 * page (MySeason). Both read the live season and nothing else: the goals, the
 * dates and the village's own count of goals reached. No name and no
 * personal count can reach it, because nothing it is given carries one.
 *
 * Phone: the drawing full width at the top, then the words, one thing at a
 * time; a tap on a goal lights its circle. Desktop: the words and the goals
 * on one side and a larger drawing on the other, and hovering either one
 * lights the other.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import type { SeasonGoalView } from "@shared/seasonGoalsView";
import { CHIP_SOFT, HINT } from "@/components/journey/look";
import Commons from "./Commons";
import { goalWorkHref, openWorkFor, useGoalOpenWork, type GoalOpenWork } from "./goalOpenWork";

export interface CommonsPanelProps {
  goals: readonly SeasonGoalView[];
  /** The words above the list (eyebrow, heading, dates): the caller's own. */
  head: ReactNode;
  /** A door under the list, when the page offers one. */
  door?: ReactNode;
  /** Goals shown before "Show all"; the drawing always holds every goal. */
  shown?: number;
  /**
   * Open quests per goal id, the village's own count. Left out, the panel asks
   * `useGoalOpenWork` (the "Open work" board's read, `GET /api/quests/goals`); a test passes it directly.
   */
  openWork?: GoalOpenWork;
}

/** A small glyph matching the drawing: a moss disc once reached, a seed before. */
function GoalMark({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="size-5 shrink-0">
      {done ? (
        <>
          <circle cx={10} cy={10} r={8.5} className="text-open" fill="currentColor" fillOpacity={0.45} />
          <circle cx={10} cy={10} r={8.5} className="text-notice" fill="none" stroke="currentColor" strokeWidth={1.2} />
          <circle cx={10} cy={10} r={2} className="text-notice" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx={10} cy={10} r={8.5} className="text-border" fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 2.4" />
          <ellipse cx={10} cy={10} rx={1.6} ry={2.6} transform="rotate(-30 10 10)" className="text-open" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/**
 * A goal's words: a door to its thread on the Open work board when it has an
 * id, and under it the village's count of open quests that grow it, once known.
 */
export function GoalWords({ goal, count }: { goal: SeasonGoalView; count: number | null }) {
  const text = goal.text;
  const line =
    count === null
      ? null
      : plural(count, { one: `# open quest grows ${text}`, other: `# open quests grow ${text}` });
  return (
    <span className="min-w-0 flex-1 break-words">
      {goal.goalId ? (
        <Link
          href={goalWorkHref(goal.goalId)}
          onClick={(e) => e.stopPropagation()}
          className="text-base leading-snug text-card-foreground underline decoration-border underline-offset-4 hover:text-notice hover:decoration-notice"
        >
          {text}
        </Link>
      ) : (
        <span className="text-base leading-snug text-card-foreground">{text}</span>
      )}
      {line && (
        <span className="mt-0.5 block text-sm text-muted-foreground" data-open-work="">
          {line}
        </span>
      )}
    </span>
  );
}

export default function CommonsPanel({ goals, head, door, shown = 7, openWork }: CommonsPanelProps) {
  const { t } = useLingui();
  const asked = useGoalOpenWork();
  const work = openWork === undefined ? asked : openWork;
  const [active, setActive] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  if (!goals.length) return null;
  const reached = goals.filter((g) => g.done).length;
  const total = goals.length;
  const list = all ? goals : goals.slice(0, shown);
  const folded = total - shown;
  const label = t({
    message: `This season's ${total} goals as circles. Moss has spread into the ${reached} we have reached together. Each goal not reached yet holds a seed.`,
    context: "the commons drawing: what a screen reader hears",
  });

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-12" data-testid="commons">
      <div className="mx-auto w-full max-w-[22rem] sm:max-w-sm lg:order-2 lg:max-w-none lg:sticky lg:top-24">
        <Commons goals={goals} label={label} active={active} onActive={setActive} />
      </div>
      <div className="min-w-0 lg:order-1">
        {head}
        <p className="mt-4 text-base font-semibold text-foreground" data-commons-count="">
          {t({ message: `We have reached ${reached} of ${total} goals so far.`, context: "the commons: the village's own count of goals reached" })}
        </p>
        <ol className="mt-4 space-y-2">
          {list.map((g, i) => (
            <li
              key={g.id}
              data-goal={i}
              data-done={g.done || undefined}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onClick={() => setActive((a) => (a === i ? null : i))}
              className={`flex min-h-11 items-center gap-3 rounded-xl border bg-muted px-4 py-3 transition-colors ${active === i ? "border-notice" : "border-border"}`}
            >
              <GoalMark done={g.done} />
              <GoalWords goal={g} count={openWorkFor(work, g.goalId)} />
              {g.done && <span className={CHIP_SOFT}>{t({ message: "Reached", context: "the commons: a goal the village has reached" })}</span>}
            </li>
          ))}
        </ol>
        {folded > 0 && (
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
            className="jw-btn mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {all
              ? t({ message: "Show fewer goals", context: "the commons: fold the list" })
              : t({ message: `Show all ${total} goals`, context: "the commons: unfold the list" })}
          </button>
        )}
        <p className={`mt-4 ${HINT}`}>{t({ message: "The moss shows the village's work, never one person's.", context: "the commons: what the moss means" })}</p>
        {door && <div className="mt-6">{door}</div>}
      </div>
    </div>
  );
}
