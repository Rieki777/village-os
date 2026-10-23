/**
 * Your season's goals (player role card PR 6): the village goals a member
 * serves, each with a "How it helps" line, and one to three seasonal goals of
 * their own. Drawn inside Your part on `/season-plans/mine`; the page holds the
 * state and saves it with the rest of the plan.
 *
 * One tick per village goal. A goal ticked shows its "How it helps" line right
 * under it; unticking keeps what was typed until the page saves, so a slip of
 * the finger loses nothing.
 */
import { Plus, Trash2 } from "lucide-react";
import { DONE_WHEN_MAX, HOW_IT_HELPS_MAX, SEASONAL_GOALS_LIMIT, SEASONAL_TITLE_MAX } from "@shared/seasonPlanWords";

export const SEASON_GOALS_WORDS = {
  servesHeading: "The season goals you serve",
  servesLine: "Tick each goal your work this season helps.",
  howItHelps: "How it helps",
  howItHelpsFor: (goal: string) => `How it helps: ${goal}`,
  seasonalHeading: "Seasonal goals",
  seasonalLede: "One to three bigger goals for the whole season. Each moon's tasks build toward them.",
  title: "Goal",
  doneWhen: "Done when",
  addGoal: "Add a seasonal goal",
  removeGoal: (n: number) => `Remove seasonal goal ${n}`,
} as const;

/** A goal served as the form holds it: the line is kept while unticked, until the page saves. */
export interface ServedRow {
  goal: string;
  ticked: boolean;
  howItHelps: string;
}

export interface SeasonalRow {
  title: string;
  doneWhen: string;
}

// min-h-[44px]: a 44px tap on a phone (the role proposal steps reuse these fields at 375px).
const inputClass =
  "min-h-[44px] w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";

/** Rows for every goal of the season, ticked where the plan serves it. */
export function servedRows(goals: readonly string[], served: ReadonlyArray<{ goal: string; howItHelps: string | null }>): ServedRow[] {
  return goals.map((goal) => {
    const s = served.find((g) => g.goal === goal);
    return { goal, ticked: !!s, howItHelps: s?.howItHelps ?? "" };
  });
}

/** What a save sends: the ticked goals in the season's order, each with its line. */
export function servedBody(rows: readonly ServedRow[]): Array<{ goal: string; howItHelps: string | null }> {
  return rows.filter((r) => r.ticked).map((r) => ({ goal: r.goal, howItHelps: r.howItHelps.trim() || null }));
}

/** What a save sends: the seasonal goals with a title. */
export function seasonalBody(rows: readonly SeasonalRow[]): Array<{ title: string; doneWhen: string | null }> {
  return rows.filter((r) => r.title.trim()).map((r) => ({ title: r.title.trim(), doneWhen: r.doneWhen.trim() || null }));
}

export function ServedGoalsField({ rows, onChange }: { rows: readonly ServedRow[]; onChange: (rows: ServedRow[]) => void }) {
  if (rows.length === 0) return null;
  const set = (i: number, patch: Partial<ServedRow>) => onChange(rows.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  return (
    <fieldset data-testid="serves-goals">
      <legend className="text-sm font-semibold text-stone-800">{SEASON_GOALS_WORDS.servesHeading}</legend>
      <p className="text-sm text-stone-600">{SEASON_GOALS_WORDS.servesLine}</p>
      <ul className="mt-2 space-y-3">
        {rows.map((r, i) => (
          <li key={r.goal} className="rounded-lg border border-stone-200 bg-white p-3">
            <label className="flex min-h-[44px] items-center gap-3 text-base text-stone-900">
              <input
                type="checkbox"
                checked={r.ticked}
                onChange={(e) => set(i, { ticked: e.target.checked })}
                className="h-5 w-5 rounded border-stone-400 text-teal-deep focus-visible:ring-2 focus-visible:ring-teal-deep"
              />
              {r.goal}
            </label>
            {r.ticked && (
              <label className="mt-2 block text-sm text-stone-700">
                {SEASON_GOALS_WORDS.howItHelps}
                <input
                  type="text"
                  maxLength={HOW_IT_HELPS_MAX}
                  value={r.howItHelps}
                  aria-label={SEASON_GOALS_WORDS.howItHelpsFor(r.goal)}
                  onChange={(e) => set(i, { howItHelps: e.target.value })}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            )}
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

export function SeasonalGoalsField({ rows, onChange }: { rows: readonly SeasonalRow[]; onChange: (rows: SeasonalRow[]) => void }) {
  const set = (i: number, patch: Partial<SeasonalRow>) => onChange(rows.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  return (
    <fieldset data-testid="seasonal-goals">
      <legend className="text-sm font-semibold text-stone-800">{SEASON_GOALS_WORDS.seasonalHeading}</legend>
      <p className="text-sm text-stone-600">{SEASON_GOALS_WORDS.seasonalLede}</p>
      <ol className="mt-2 space-y-3">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <label className="text-sm text-stone-700">
              {SEASON_GOALS_WORDS.title}
              <input type="text" maxLength={SEASONAL_TITLE_MAX} value={r.title} onChange={(e) => set(i, { title: e.target.value })} className={`mt-1 ${inputClass}`} />
            </label>
            <label className="text-sm text-stone-700">
              {SEASON_GOALS_WORDS.doneWhen}
              <input type="text" maxLength={DONE_WHEN_MAX} value={r.doneWhen} onChange={(e) => set(i, { doneWhen: e.target.value })} className={`mt-1 ${inputClass}`} />
            </label>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, ri) => ri !== i))}
              aria-label={SEASON_GOALS_WORDS.removeGoal(i + 1)}
              className="inline-flex min-h-[44px] items-center justify-center self-end rounded-lg px-3 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      {rows.length < SEASONAL_GOALS_LIMIT && (
        <button
          type="button"
          onClick={() => onChange([...rows, { title: "", doneWhen: "" }])}
          className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-teal-deep hover:bg-teal-deep/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {SEASON_GOALS_WORDS.addGoal}
        </button>
      )}
    </fieldset>
  );
}
