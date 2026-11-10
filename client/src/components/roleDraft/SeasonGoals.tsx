/**
 * This season's goals, drawn on /roles from the live season (`useSeason`, the
 * same read /roles/select makes). Nothing here is written by hand: the name,
 * the dates and every goal come from the season the village set in Admin, so
 * the block changes when the season does. No season, or one with nothing to
 * show, draws nothing. A season with no goals says so and still offers the door.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Check } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useSeason } from "@/lib/gameApi";
import { seasonView } from "@shared/seasonGoalsView";

/** More goals than this fold behind one button, so a long list never pushes the page down. */
const SHOWN = 6;

export default function SeasonGoals() {
  const { t } = useLingui();
  const season = useSeason();
  const [all, setAll] = useState(false);
  const view = seasonView(season);
  if (!view) return null;
  const { name, dates, goals } = view;
  const shown = all ? goals : goals.slice(0, SHOWN);
  const folded = goals.length - SHOWN;
  return (
    <section aria-labelledby="roles-season-h" className="sel-rise mx-auto mb-12 max-w-5xl rounded-3xl border-2 border-notice bg-card p-6 text-left shadow-sm sm:p-8">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-notice">{t({ message: "This season's goals", context: "roles page season" })}</p>
      <h2 id="roles-season-h" className="mt-1 font-display text-3xl font-bold text-card-foreground text-balance">
        {name || t({ message: "This season", context: "roles page season" })}
      </h2>
      {dates && <p className="mt-1 text-sm font-semibold text-muted-foreground">{dates}</p>}
      {goals.length > 0 ? (
        <>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2">
            {shown.map((g, i) => (
              <li key={g.id} className={`flex items-start gap-3 rounded-2xl border border-border bg-muted/30 p-4 ${g.done ? "opacity-75" : ""}`}>
                <span aria-hidden="true" className="font-display text-3xl font-bold leading-none text-notice">{i + 1}</span>
                <span className="min-w-0 text-sm leading-relaxed text-card-foreground">
                  {g.text}
                  {g.done && (
                    <span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      <Check className="size-3" aria-hidden="true" />
                      {t({ message: "Done", context: "roles page goal" })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {folded > 0 && (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {all ? t({ message: "Show fewer goals", context: "roles page goals" }) : t({ message: `Show all ${goals.length} goals`, context: "roles page goals" })}
            </button>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t({ message: "No goals are set for this season yet.", context: "roles page goals" })}</p>
      )}
      <div className="mt-5">
        <Link
          href="/roles/select#sel-season"
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-notice px-5 text-sm font-bold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t({ message: "Explore the goals", context: "roles page goals" })}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
