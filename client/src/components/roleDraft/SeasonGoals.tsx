/**
 * This season's goals, drawn on /roles from the live season (`useSeason`, the
 * same read /roles/select makes). Nothing here is written by hand: the name,
 * the dates and every goal come from the season the village set in Admin, so
 * the block changes when the season does. No season, or one with nothing to
 * show, draws nothing. A season with no goals says so and still offers the door.
 *
 * Drawn in the profile's language (docs/DESIGN_RULE.md): the featured panel
 * StartHereCard uses, an eyebrow over a display heading, the season's walk as a
 * trail of days, and each goal as a tile with its number in a gold ring, the
 * way the sheet's stat tiles carry theirs. A reached goal's ring fills and
 * takes a check. The count of reached goals is the village's, never a person's.
 *
 * The commons (Phase D): beside the list sits the same season as circles, moss
 * spread into each goal the village has reached and a seed in each one not
 * reached yet (components/commons). It holds every goal, folded or not.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check, Sprout } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useSeason } from "@/lib/gameApi";
import { seasonView } from "@shared/seasonGoalsView";
import Commons from "@/components/commons/Commons";
import { GoalWords } from "@/components/commons/CommonsPanel";
import { openWorkFor, useGoalOpenWork } from "@/components/commons/goalOpenWork";
import { BTN_PRIMARY, BTN_SECONDARY, CARD_FEATURED, CHIP_SOFT, EYEBROW, HINT, RING } from "@/components/journey/look";

/** More goals than this fold behind one button, so a long list never pushes the page down. */
const SHOWN = 6;

export default function SeasonGoals() {
  const { t } = useLingui();
  const season = useSeason();
  const [all, setAll] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  // The village's open quests per goal (lane C5's read; null until it lands). Each goal opens its thread.
  const work = useGoalOpenWork();
  const view = seasonView(season);
  if (!view) return null;
  const { name, dates, goals, day, of } = view;
  const shown = all ? goals : goals.slice(0, SHOWN);
  const folded = goals.length - SHOWN;
  const reached = goals.filter((g) => g.done).length;
  const total = goals.length;
  const walked = day !== null && of ? day / of : null;
  return (
    <section aria-labelledby="roles-season-h" className={`sel-rise mx-auto mb-12 max-w-5xl text-left ${CARD_FEATURED}`}>
      <div className="flex items-center gap-2">
        <Sprout className="h-5 w-5 shrink-0 text-notice" aria-hidden="true" />
        <p className={EYEBROW}>{t({ message: "This season's goals", context: "roles page season" })}</p>
      </div>
      <h2 id="roles-season-h" className="mt-3 font-display text-3xl leading-tight text-card-foreground text-balance sm:text-4xl">
        {name || t({ message: "This season", context: "roles page season" })}
      </h2>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {dates && <p className={HINT}>{dates}</p>}
        {day !== null && of !== null && (
          <p className="text-sm font-semibold text-foreground" data-season-day="">
            {t({ message: `Day ${day} of ${of}`, context: "roles page season: how far into the season today is" })}
          </p>
        )}
      </div>
      {walked !== null && (
        // The season as a walk: the path fills to today. Decoration only; the words above carry it.
        <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className="jw-trail-fill absolute inset-0" style={{ transform: `scaleX(${walked})` }} />
        </div>
      )}
      {goals.length > 0 ? (
        <>
          {reached > 0 && (
            <p className={`mt-5 ${HINT}`}>
              {t({ message: `${reached} of ${goals.length} reached so far`, context: "roles page season goals: how many of the village's goals are done" })}
            </p>
          )}
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_15rem]">
          {/* The commons: the same goals as circles, moss in each one the village reached.
              Above the list on a phone, beside it on a desktop, where hovering either lights the other. */}
          <div className="mx-auto w-full max-w-[13rem] lg:order-2 lg:max-w-none">
            <Commons
              goals={goals}
              active={active}
              onActive={setActive}
              label={t({
                message: `This season's ${total} goals as circles. Moss has spread into the ${reached} we have reached together. Each goal not reached yet holds a seed.`,
                context: "the commons drawing: what a screen reader hears",
              })}
            />
          </div>
          <ol className="grid gap-3 sm:grid-cols-2 lg:order-1">
            {shown.map((g, i) => (
              <li
                key={g.id}
                className={`flex min-h-[4.5rem] items-center gap-4 rounded-xl border bg-muted p-4 transition-colors ${active === i ? "border-notice" : "border-border"}`}
                data-done={g.done || undefined}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
              >
                <span aria-hidden="true" className={`${RING} font-display text-lg ${g.done ? "bg-notice text-background" : ""}`}>
                  {g.done ? <Check className="size-5" /> : i + 1}
                </span>
                <GoalWords goal={g} count={openWorkFor(work, g.goalId)} />
                {g.done && (
                  <span className={`shrink-0 ${CHIP_SOFT}`}>
                    {t({ message: "Done", context: "roles page goal" })}
                  </span>
                )}
              </li>
            ))}
          </ol>
          </div>
          {folded > 0 && (
            <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)} className={`mt-3 ${BTN_SECONDARY}`}>
              {all ? t({ message: "Show fewer goals", context: "roles page goals" }) : t({ message: `Show all ${goals.length} goals`, context: "roles page goals" })}
            </button>
          )}
        </>
      ) : (
        <p className={`mt-4 ${HINT}`}>{t({ message: "No goals are set for this season yet.", context: "roles page goals" })}</p>
      )}
      <div className="mt-6 border-t border-border pt-5">
        <Link href="/roles/select#sel-season" className={BTN_PRIMARY}>
          {t({ message: "Explore the goals", context: "roles page goals" })}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
