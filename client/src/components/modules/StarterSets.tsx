/**
 * Starter sets on the library page (`shared/moduleStarterSets.ts`).
 *
 * Everyone reads them, with links to each module's page. A steward before
 * launch turns a whole set on with one press or adds it to the plan; after
 * launch a signed-in member proposes the set as one vote. Sets whose modules
 * are all on already say so and offer nothing. These are panels above the
 * shelves, never tiles, so R55 is untouched.
 */
import { Link } from "wouter";
import { STARTER_SETS } from "@shared/moduleStarterSets";
import { turnOnPlan, type LibraryViewer, type PlanModule } from "@shared/moduleSwitch";
import TurnOnAction from "./TurnOnAction";
import { readBasket, writeBasket } from "./planBasket";

export default function StarterSets({ all, viewer }: { all: PlanModule[]; viewer: LibraryViewer }) {
  const byId = new Map(all.map((m) => [m.id, m]));
  const sets = STARTER_SETS.map((s) => ({ ...s, ids: s.moduleIds.filter((id) => byId.has(id)) })).filter(
    (s) => s.ids.length > 1,
  );
  if (sets.length === 0) return null;
  const seesState = viewer.mode !== "visitor";
  return (
    <section aria-labelledby="starter-sets" className="mb-10">
      <h2 id="starter-sets" className="font-display text-xl font-bold text-foreground">Starter sets</h2>
      <p className="text-sm text-muted-foreground mt-1">A few modules that are usually wanted together.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {sets.map((s) => {
          const remaining = seesState ? turnOnPlan(s.ids, viewer.launched ? "members" : "preview", all) : [];
          return (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4 min-w-0 break-words flex flex-col gap-2">
              <h3 className="font-semibold text-foreground">{s.name}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.gloss}</p>
              <p className="text-sm">
                {s.ids.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <Link href={`/modules/${id}`} className="text-teal-deep underline">
                      {byId.get(id)?.name ?? id}
                    </Link>
                  </span>
                ))}
              </p>
              {seesState && remaining.length === 0 && <p className="text-sm text-emerald-700">All on here.</p>}
              {remaining.length > 0 && (
                <div className="mt-auto space-y-2">
                  <TurnOnAction ids={s.ids} all={all} viewer={viewer} label="the set" />
                  {viewer.canSwitch && !viewer.launched && (
                    <button
                      type="button"
                      onClick={() => writeBasket([...readBasket(), ...s.ids])}
                      className="min-h-[44px] px-4 rounded-lg border border-border bg-background text-sm font-medium"
                    >
                      Add to my plan
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
