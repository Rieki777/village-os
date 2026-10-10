/**
 * `/season-plans`: THE VILLAGE'S SEASON, EVERYONE'S PLAN (season plans RC1).
 *
 * Members only. The read behind it answers 401 to a visitor and to a signed-in
 * guest (terms.read opens at the member rung), and this page says so in a
 * sentence.
 *
 *   THE HEADER       the season, its window, and how many have filed
 *   ONE CARD EACH    every present member, ordered by name and never by
 *                    progress: seats held and handed back, applications and
 *                    where they stand, aim, this moon's quest pips, measures
 *   WAITING          a filter to the members with an application the village
 *                    has not answered yet
 *   NOT FILED YET    the members who have not filed, by name (Rye, 2026-10-09)
 *
 * No terms and no money reach this page. An application's terms are read on
 * its own page, which every chip links.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarDays } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import PlanCard from "@/components/seasonPlans/PlanCard";
import { fetchVillage, type VillagePayload } from "@/components/seasonPlans/seasonPlansApi";
import { civilDayWords } from "@shared/seasonPlans";

export const SEASON_PLANS_WORDS = {
  title: "The village's season",
  membersOnly: "Members read the village's season plans.",
  membersOnlyLine: "Each plan names the seats people hold and ask for, so this page opens at the member rung.",
  noSeason: "There is no season to plan yet.",
  noSeasonLine: "Planning opens one moon before the next season starts.",
  filed: (n: number, of: number) => `${n} of ${of} have filed`,
  window: (opens: string, closes: string) => `Planning runs from ${civilDayWords(opens)} to ${civilDayWords(closes)}.`,
  everyone: "Everyone",
  waiting: "Waiting on the village",
  noneWaiting: "Nobody is waiting on the village right now.",
  notFiled: "Not filed yet",
  allFiled: "Everyone has filed.",
  mine: "Plan your season",
} as const;

export default function SeasonPlans() {
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  const [data, setData] = useState<VillagePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "members" | "error">("loading");
  const [error, setError] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void fetchVillage().then((answer) => {
      if (!alive) return;
      if (answer.ok) {
        setData(answer.data);
        setState("ready");
      } else if (answer.status === 401) setState("members");
      else {
        setError(answer.error);
        setState("error");
      }
    });
    return () => {
      alive = false;
    };
  }, [user]);

  if (modules.loaded && !governance) {
    return <ModuleGate moduleId="governance" name="Season plans" behind={PAGE_GATE_LINES.seasonPlans} />;
  }

  if (!user || state === "members") {
    return (
      <Layout>
        <div className="container max-w-3xl px-4 py-8">
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-stone-900">{SEASON_PLANS_WORDS.membersOnly}</h1>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-stone-600">{SEASON_PLANS_WORDS.membersOnlyLine}</p>
            {!user && (
              <div className="mt-5">
                <SignInDoors next="/season-plans" />
              </div>
            )}
          </div>
        </div>
      </Layout>
    );
  }

  const people = data?.people ?? [];
  const shown = onlyWaiting ? people.filter((p) => p.waiting) : people;
  const toggle = (on: boolean, label: string, pick: () => void) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={pick}
      className={`inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${on ? "border-teal-deep bg-teal-deep text-white" : "border-stone-400 bg-white text-stone-800 hover:bg-stone-50"}`}
    >
      {label}
    </button>
  );

  return (
    <Layout>
      <div className="container max-w-5xl px-4 py-8">
        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label="Reading the village's plans" />
          </div>
        )}
        {state === "error" && (
          <p role="alert" className="mt-6 text-coral">
            {error}
          </p>
        )}
        {state === "ready" && data && !data.season && (
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-stone-900">{SEASON_PLANS_WORDS.noSeason}</h1>
            <p className="mx-auto mt-2 max-w-md text-stone-600">{SEASON_PLANS_WORDS.noSeasonLine}</p>
          </div>
        )}
        {state === "ready" && data?.season && (
          <div className="space-y-8">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-teal-deep">{data.season.name}</p>
                <h1 className="mt-1 font-display text-3xl font-bold text-stone-900">{SEASON_PLANS_WORDS.title}</h1>
                {data.window && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-stone-700">
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    {SEASON_PLANS_WORDS.window(data.window.opensOn, data.window.closesOn)}
                  </p>
                )}
                <p className="mt-1 text-lg font-semibold text-stone-900">{SEASON_PLANS_WORDS.filed(data.filedCount, data.memberCount)}</p>
              </div>
              <Link
                href="/season-plans/mine"
                className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
              >
                {SEASON_PLANS_WORDS.mine}
              </Link>
            </header>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
              {toggle(!onlyWaiting, SEASON_PLANS_WORDS.everyone, () => setOnlyWaiting(false))}
              {toggle(onlyWaiting, SEASON_PLANS_WORDS.waiting, () => setOnlyWaiting(true))}
            </div>

            {shown.length === 0 ? (
              <p className="text-stone-600">{SEASON_PLANS_WORDS.noneWaiting}</p>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {shown.map((card) => (
                  <li key={card.userId}>
                    <PlanCard card={card} headingLevel={3} />
                  </li>
                ))}
              </ul>
            )}

            <section aria-labelledby="sp-not-filed" className="rounded-xl border border-stone-200 bg-stone-50 p-5">
              <h2 id="sp-not-filed" className="text-lg font-bold text-stone-900">
                {SEASON_PLANS_WORDS.notFiled}
              </h2>
              {data.notFiled.length === 0 ? (
                <p className="mt-1 text-stone-700">{SEASON_PLANS_WORDS.allFiled}</p>
              ) : (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-stone-900">
                  {data.notFiled.map((p) => (
                    <li key={p.userId}>
                      {p.handle ? (
                        <Link href={`/profile/${encodeURIComponent(p.handle)}`} className="underline underline-offset-2 hover:text-teal-deep">
                          {p.name}
                        </Link>
                      ) : (
                        p.name
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </Layout>
  );
}
