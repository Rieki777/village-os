/**
 * `/season-plans/mine`: YOUR SEASON (season plans RC1).
 *
 * Each season every member says three things, in the order they are asked:
 *
 *   YOUR SEATS     each seat you hold: Carry on, Hand it back, or Not sure.
 *                  Carry on opens the member door (PR4's wizard) on that seat
 *                  for this season, so the village decides it as an ordinary
 *                  application. Hand it back is filed with your plan.
 *   NEW SEATS      Apply for a seat opens the same door with no seat picked.
 *   YOUR PART      your aim, a tick for each village goal you serve with a
 *                  "How it helps" line under each one ticked, one to three
 *                  seasonal goals of your own (SeasonGoalsFields.tsx), quests
 *                  a moon and up to three measures. Filed, never voted. With no quests
 *                  saved, Fewest and Most fill in from the member's seats
 *                  (shared/seasonPartSuggestions.ts), marked until saved and
 *                  never over a saved value. From your roles offers measures
 *                  from the seats' terms and what each seat answers for, each
 *                  added only by the member's own Add.
 *
 * Save keeps a new version. File my season stamps the newest one, and the
 * village page shows the version you filed. A plan filed after the window
 * closes is taken all the same.
 *
 * `?renew=<seat>` (the term warning's link) lights that seat up.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Plus, Trash2, Users } from "lucide-react";
import Layout from "@/components/Layout";
import ModuleGate, { SignInDoors } from "@/components/modules/ModuleGate";
import { PAGE_GATE_LINES } from "@/components/modules/gateCopy";
import { useModule, useModules } from "@/modules/ModuleProvider";
import { useAuth } from "@/contexts/AuthContext";
import { BreathingLoader } from "@/components/natural";
import { ApplicationChip, QuestPips } from "@/components/seasonPlans/PlanCard";
import { fetchMine, fileMine, saveMine, type MinePayload, type PlanBody } from "@/components/seasonPlans/seasonPlansApi";
import {
  SeasonalGoalsField,
  seasonalBody,
  ServedGoalsField,
  servedBody,
  servedRows,
  type SeasonalRow,
  type ServedRow,
} from "@/components/seasonPlans/SeasonGoalsFields";
import { AIM_MAX, applyHref, civilDayWords, PLAN_MEASURES_MAX } from "@shared/seasonPlans";
import { questHint, type MeasureSuggestion } from "@shared/seasonPartSuggestions";

export const MY_SEASON_WORDS = {
  title: "Your season",
  signIn: "Sign in to plan your season.",
  signInLine: "Choose the roles you keep, hand back or apply for, and what you will do this season.",
  noSeason: "There is no season to plan yet.",
  noSeasonLine: "Planning opens one moon before the next season starts. You will get a notice.",
  open: (closes: string) => `Open until ${civilDayWords(closes)}.`,
  before: (opens: string) => `Opens on ${civilDayWords(opens)}.`,
  closed: "The window has closed. You can still file.",
  seatsHeading: "Your roles",
  noSeats: "You hold no roles yet.",
  carryOn: "Carry on",
  handBack: "Hand it back",
  notSure: "Not sure",
  handingBackLine: "You hand this role back when the season turns.",
  carryingOn: "You asked to carry on",
  heldThrough: "You hold it through your application",
  applyMembersOnly: "Applying for a role opens at the member rung. Once you reach it, you can apply here.",
  applyHeading: "Apply for a role",
  applyLine: "Ask the village for any role on the chart. You pick up to five in one application.",
  apply: "Apply for a role",
  applicationsHeading: "Your applications this season",
  partHeading: "Your part",
  partLine: "What you will do this season. You file it. Nobody votes on it.",
  aim: "Your aim",
  aimHelp: "What will be true at the end of the season because of you.",
  quests: "Quests a moon",
  fewest: "Fewest",
  most: "Most",
  thisMoon: "Done this moon",
  measures: "How you measure your work",
  measure: "Measure",
  target: "Target",
  addMeasure: "Add a measure",
  removeMeasure: "Remove this measure",
  suggested: "Suggested. Saved when you save.",
  fromRoles: "From your roles",
  fromRolesLine: "Add one, then set your own target.",
  pickUpTo: `Pick up to ${PLAN_MEASURES_MAX}.`,
  add: "Add",
  added: "Added",
  addNamed: (measure: string) => `Add ${measure}`,
  fromTerms: "From its terms",
  fromAnswersFor: "What it answers for",
  termsTarget: (target: string) => `Aims for ${target}.`,
  noRoleMeasures: "Your roles do not list what they answer for yet.",
  applyForMeasures: "Apply for a role to see measures from its role.",
  save: "Save",
  file: "File my season",
  saved: "Saved.",
  filedNow: "Filed. The village can read your season.",
  filedOn: (on: string) => `Filed on ${civilDayWords(on)}.`,
  changed: "You have changes that are not filed yet.",
  notFiled: "Not filed yet.",
  village: "See the village's plans",
} as const;

interface Measure {
  measure: string;
  target: string;
}

const inputClass =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep";
/** A value the page filled in and the member has not saved: dashed, so it reads as a suggestion. */
const suggestedInputClass = inputClass.replace("border-stone-300 bg-white", "border-dashed border-amber-600 bg-amber-50");

/** The same measure in other words of case and spacing. */
const measureKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Suggestions by seat, in the order the server ranked them. */
function bySeat(list: readonly MeasureSuggestion[]): Array<{ seatId: string; seat: string; items: MeasureSuggestion[] }> {
  const groups: Array<{ seatId: string; seat: string; items: MeasureSuggestion[] }> = [];
  for (const m of list) {
    let g = groups.find((x) => x.seatId === m.seatId);
    if (!g) {
      g = { seatId: m.seatId, seat: m.seat, items: [] };
      groups.push(g);
    }
    g.items.push(m);
  }
  return groups;
}

/**
 * FROM YOUR ROLES: measures the member's seats suggest, by seat, each with an
 * Add button. Nothing is added for them, and Add stops at the plan's limit.
 */
function RoleMeasures(props: {
  suggestions: readonly MeasureSuggestion[];
  hasSeats: boolean;
  applyLink: string | null;
  measures: readonly Measure[];
  onAdd: (s: MeasureSuggestion) => void;
}) {
  const { suggestions, hasSeats, applyLink, measures, onAdd } = props;
  const taken = new Set(measures.map((m) => measureKey(m.measure)).filter(Boolean));
  const room = measures.some((m) => !m.measure.trim()) || measures.length < PLAN_MEASURES_MAX;
  return (
    <section aria-labelledby="ms-roles" className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4" data-testid="role-measures">
      <h3 id="ms-roles" className="text-sm font-semibold text-stone-900">
        {MY_SEASON_WORDS.fromRoles}
      </h3>
      {!hasSeats ? (
        <p className="mt-1 text-sm text-stone-700">
          {MY_SEASON_WORDS.applyForMeasures}{" "}
          {applyLink && (
            <Link href={applyLink} className="font-semibold text-teal-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep">
              {MY_SEASON_WORDS.apply}
            </Link>
          )}
        </p>
      ) : suggestions.length === 0 ? (
        <p className="mt-1 text-sm text-stone-700">{MY_SEASON_WORDS.noRoleMeasures}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-stone-700">
            {MY_SEASON_WORDS.fromRolesLine} <span className={room ? "" : "font-semibold text-stone-900"}>{MY_SEASON_WORDS.pickUpTo}</span>
          </p>
          {bySeat(suggestions).map((g) => (
            <div key={g.seatId} className="mt-3">
              <h4 className="text-sm font-bold text-stone-800">{g.seat}</h4>
              <ul className="mt-1 space-y-2">
                {g.items.map((s) => {
                  const added = taken.has(measureKey(s.measure));
                  return (
                    <li key={`${s.from}:${s.measure}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-stone-900">{s.measure}</p>
                        <p className="text-xs text-stone-600">
                          {s.from === "terms" ? MY_SEASON_WORDS.fromTerms : MY_SEASON_WORDS.fromAnswersFor}
                          {s.target ? `. ${MY_SEASON_WORDS.termsTarget(s.target)}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onAdd(s)}
                        disabled={added || !room}
                        aria-label={added ? `${MY_SEASON_WORDS.added}: ${s.measure}` : MY_SEASON_WORDS.addNamed(s.measure)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-teal-deep px-3 text-sm font-semibold text-teal-deep hover:bg-teal-deep/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:border-stone-300 disabled:text-stone-600 disabled:hover:bg-transparent"
                      >
                        {added ? MY_SEASON_WORDS.added : (
                          <>
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            {MY_SEASON_WORDS.add}
                          </>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

export default function MySeason() {
  const { user } = useAuth();
  const modules = useModules();
  const governance = useModule("governance");
  const [renew] = useState(() => new URLSearchParams(window.location.search).get("renew") ?? "");
  const [data, setData] = useState<MinePayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const [aim, setAim] = useState("");
  const [served, setServed] = useState<ServedRow[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalRow[]>([]);
  const [fewest, setFewest] = useState("");
  const [most, setMost] = useState("");
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [handingBack, setHandingBack] = useState<string[]>([]);
  /** True while Fewest and Most hold the seats' suggestion and nothing the member saved. */
  const [questsSuggested, setQuestsSuggested] = useState(false);

  const adopt = useCallback((d: MinePayload) => {
    setData(d);
    const p = d.plan;
    setAim(p?.aim ?? "");
    // A plan saved before the player card holds only `servesGoal`.
    setServed(servedRows(d.season?.goals ?? [], p?.servesGoals ?? (p?.servesGoal ? [{ goal: p.servesGoal, howItHelps: null }] : [])));
    setSeasonal((p?.seasonalGoals ?? []).map((g) => ({ title: g.title, doneWhen: g.doneWhen ?? "" })));
    const savedQuests = p?.commitments?.quests;
    const hasSaved = savedQuests?.perMoonMin != null || savedQuests?.perMoonMax != null;
    // A saved value is never overwritten. With none, the seats' suggestion fills in, marked until saved.
    const fill = hasSaved ? null : d.suggestions?.quests ?? null;
    const min = hasSaved ? savedQuests?.perMoonMin : fill?.min;
    const max = hasSaved ? savedQuests?.perMoonMax : fill?.max;
    setFewest(min != null ? String(min) : "");
    setMost(max != null ? String(max) : "");
    setQuestsSuggested(!!fill && (fill.min != null || fill.max != null));
    setMeasures((p?.commitments?.scoreboard?.measures ?? []).map((m) => ({ measure: m.measure, target: m.target ?? "" })));
    setHandingBack(p?.handingBack ?? []);
  }, []);

  const load = useCallback(async () => {
    const answer = await fetchMine();
    if (answer.ok) {
      adopt(answer.data);
      setState("ready");
    } else {
      setError(answer.error);
      setState("error");
    }
  }, [adopt]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  useEffect(() => {
    if (state !== "ready" || !renew) return;
    document.getElementById(`seat-${renew}`)?.scrollIntoView({ block: "center" });
  }, [state, renew]);

  const body = useMemo((): PlanBody => {
    const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
    const min = n(fewest);
    const max = n(most);
    const kept = measures.filter((m) => m.measure.trim());
    const servesGoals = servedBody(served);
    return {
      aim: aim.trim(),
      servesGoal: servesGoals[0]?.goal ?? null,
      servesGoals,
      seasonalGoals: seasonalBody(seasonal),
      commitments: {
        ...(min !== undefined || max !== undefined
          ? { quests: { ...(min !== undefined ? { perMoonMin: min } : {}), ...(max !== undefined ? { perMoonMax: max } : {}), doneWhenRequired: true as const } }
          : {}),
        ...(kept.length ? { scoreboard: { measures: kept.map((m) => ({ measure: m.measure.trim(), ...(m.target.trim() ? { target: m.target.trim() } : {}) })) } } : {}),
      },
      handingBack,
    };
  }, [aim, served, seasonal, fewest, most, measures, handingBack]);

  const save = async (andFile: boolean) => {
    setBusy(true);
    setSaid(null);
    const saved = await saveMine(body);
    if (!saved.ok) {
      setSaid({ ok: false, text: saved.error });
      setBusy(false);
      return;
    }
    if (!andFile) {
      adopt(saved.data);
      setSaid({ ok: true, text: MY_SEASON_WORDS.saved });
      setBusy(false);
      return;
    }
    const filed = await fileMine();
    if (filed.ok) {
      adopt(filed.data);
      setSaid({ ok: true, text: MY_SEASON_WORDS.filedNow });
    } else {
      adopt(saved.data);
      setSaid({ ok: false, text: filed.error });
    }
    setBusy(false);
  };

  if (modules.loaded && !governance) {
    return <ModuleGate moduleId="governance" name="Your season" behind={PAGE_GATE_LINES.seasonPlans} />;
  }

  if (!user) {
    return (
      <Layout>
        <div className="container max-w-3xl px-4 py-8">
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-stone-900">{MY_SEASON_WORDS.signIn}</h1>
            <p className="mx-auto mt-2 max-w-md leading-relaxed text-stone-600">{MY_SEASON_WORDS.signInLine}</p>
            <div className="mt-5">
              <SignInDoors next="/season-plans/mine" />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const season = data?.season ?? null;
  const w = data?.window ?? null;
  const appsBySeat = new Map<string, MinePayload["applications"][number]>();
  for (const a of data?.applications ?? []) for (const s of a.seats) if (!appsBySeat.has(s.id)) appsBySeat.set(s.id, a);

  return (
    <Layout>
      <div className="container max-w-3xl px-4 py-8">
        <Link
          href="/season-plans"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-teal-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {MY_SEASON_WORDS.village}
        </Link>

        {state === "loading" && (
          <div className="flex justify-center py-16">
            <BreathingLoader label="Reading your season" />
          </div>
        )}
        {state === "error" && (
          <p role="alert" className="mt-6 text-coral">
            {error}
          </p>
        )}

        {state === "ready" && !season && (
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-stone-900">{MY_SEASON_WORDS.noSeason}</h1>
            <p className="mx-auto mt-2 max-w-md text-stone-600">{MY_SEASON_WORDS.noSeasonLine}</p>
          </div>
        )}

        {state === "ready" && season && data && (
          <article className="mt-3 space-y-8">
            <header>
              <p className="text-sm font-semibold text-teal-deep">{season.name}</p>
              <h1 className="mt-1 font-display text-3xl font-bold text-stone-900">{MY_SEASON_WORDS.title}</h1>
              {w && (
                <p className="mt-2 text-stone-700">
                  {w.state === "open" ? MY_SEASON_WORDS.open(w.closesOn) : w.state === "before" ? MY_SEASON_WORDS.before(w.opensOn) : MY_SEASON_WORDS.closed}
                </p>
              )}
              <p className="mt-1 text-sm font-medium text-stone-800" role="status">
                {data.filed?.filedOn ? MY_SEASON_WORDS.filedOn(data.filed.filedOn) : MY_SEASON_WORDS.notFiled}
                {data.changedSinceFiling ? ` ${MY_SEASON_WORDS.changed}` : ""}
              </p>
            </header>

            <section aria-labelledby="ms-seats">
              <h2 id="ms-seats" className="text-xl font-bold text-stone-900">
                {MY_SEASON_WORDS.seatsHeading}
              </h2>
              {data.heldSeats.length === 0 ? (
                <p className="mt-2 text-stone-600">{MY_SEASON_WORDS.noSeats}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {data.heldSeats.map((seat) => {
                    const app = appsBySeat.get(seat.id);
                    const back = handingBack.includes(seat.id);
                    const lit = renew === seat.id;
                    return (
                      <li
                        key={seat.id}
                        id={`seat-${seat.id}`}
                        className={`rounded-xl border bg-white p-4 ${lit ? "border-teal-deep ring-2 ring-teal-deep/30" : "border-stone-200"}`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-display text-lg font-bold text-stone-900">{seat.name}</p>
                          {seat.termEndsOn && <p className="text-sm text-stone-600">Term until {civilDayWords(seat.termEndsOn)}</p>}
                        </div>
                        {app ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-stone-700">
                              {seat.heldThrough === app.id ? MY_SEASON_WORDS.heldThrough : MY_SEASON_WORDS.carryingOn}:
                            </span>
                            <ApplicationChip app={app} />
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`What happens to ${seat.name}`}>
                            <Link
                              href={applyHref({ seasonId: season.id, renew: seat.id, supersedes: seat.heldThrough })}
                              className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
                            >
                              {MY_SEASON_WORDS.carryOn}
                            </Link>
                            <button
                              type="button"
                              aria-pressed={back}
                              onClick={() => setHandingBack((list) => (list.includes(seat.id) ? list : [...list, seat.id]))}
                              className={`inline-flex min-h-[44px] items-center rounded-lg border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${back ? "border-amber-500 bg-amber-50 text-amber-900" : "border-stone-400 text-stone-800 hover:bg-stone-50"}`}
                            >
                              {MY_SEASON_WORDS.handBack}
                            </button>
                            <button
                              type="button"
                              aria-pressed={!back}
                              onClick={() => setHandingBack((list) => list.filter((id) => id !== seat.id))}
                              className={`inline-flex min-h-[44px] items-center rounded-lg border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep ${!back ? "border-stone-500 bg-stone-100 text-stone-900" : "border-stone-400 text-stone-800 hover:bg-stone-50"}`}
                            >
                              {MY_SEASON_WORDS.notSure}
                            </button>
                          </div>
                        )}
                        {back && !app && <p className="mt-2 text-sm text-amber-900">{MY_SEASON_WORDS.handingBackLine}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="ms-apply" className="rounded-xl border border-stone-200 bg-stone-50 p-5">
              <h2 id="ms-apply" className="text-lg font-bold text-stone-900">
                {MY_SEASON_WORDS.applyHeading}
              </h2>
              {data.mayApply === false ? (
                // A guest is told before the wizard, never at its Review step (red team U5).
                <p className="mt-1 text-stone-700">{MY_SEASON_WORDS.applyMembersOnly}</p>
              ) : (
                <>
                  <p className="mt-1 text-stone-700">{MY_SEASON_WORDS.applyLine}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={applyHref({ seasonId: season.id })}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-deep px-4 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {MY_SEASON_WORDS.apply}
                    </Link>
                  </div>
                </>
              )}
              {/* "Propose a role" waits for the role-proposal kind (PR7): the wizard has no such kind yet (red team U11). */}
              {data.applications.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-stone-800">{MY_SEASON_WORDS.applicationsHeading}</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {data.applications.map((a) => (
                      <li key={a.id}>
                        <ApplicationChip app={a} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section aria-labelledby="ms-part">
              <h2 id="ms-part" className="text-xl font-bold text-stone-900">
                {MY_SEASON_WORDS.partHeading}
              </h2>
              <p className="mt-1 text-stone-700">{MY_SEASON_WORDS.partLine}</p>
              <div className="mt-4 space-y-5">
                <div>
                  <label htmlFor="ms-aim" className="block text-sm font-semibold text-stone-800">
                    {MY_SEASON_WORDS.aim}
                  </label>
                  <p id="ms-aim-help" className="text-sm text-stone-600">
                    {MY_SEASON_WORDS.aimHelp}
                  </p>
                  <textarea
                    id="ms-aim"
                    aria-describedby="ms-aim-help"
                    rows={4}
                    maxLength={AIM_MAX}
                    value={aim}
                    onChange={(e) => setAim(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                  <p className="text-right text-xs text-stone-600">
                    {aim.length} / {AIM_MAX}
                  </p>
                </div>

                <ServedGoalsField rows={served} onChange={setServed} />
                <SeasonalGoalsField rows={seasonal} onChange={setSeasonal} />

                <fieldset aria-describedby={questsSuggested ? "ms-quests-hint" : undefined}>
                  <legend className="text-sm font-semibold text-stone-800">{MY_SEASON_WORDS.quests}</legend>
                  <div className="mt-1 grid max-w-xs grid-cols-2 gap-3">
                    <label className="text-sm text-stone-700">
                      {MY_SEASON_WORDS.fewest}
                      <input type="number" min={1} max={12} inputMode="numeric" value={fewest} onChange={(e) => setFewest(e.target.value)} className={`mt-1 ${questsSuggested ? suggestedInputClass : inputClass}`} />
                    </label>
                    <label className="text-sm text-stone-700">
                      {MY_SEASON_WORDS.most}
                      <input type="number" min={1} max={12} inputMode="numeric" value={most} onChange={(e) => setMost(e.target.value)} className={`mt-1 ${questsSuggested ? suggestedInputClass : inputClass}`} />
                    </label>
                  </div>
                  {questsSuggested && data.suggestions && (
                    <div id="ms-quests-hint" data-testid="quests-suggested" className="mt-2 text-sm text-stone-700">
                      <p>{questHint(data.suggestions.quests)}</p>
                      <p className="mt-1 inline-flex items-center rounded-full border border-dashed border-amber-600 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                        {MY_SEASON_WORDS.suggested}
                      </p>
                    </div>
                  )}
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-700">
                    {MY_SEASON_WORDS.thisMoon}:{" "}
                    <QuestPips done={data.questsThisMoon.done} min={fewest ? Number(fewest) : null} max={most ? Number(most) : null} />
                  </p>
                </fieldset>

                <fieldset>
                  <legend className="text-sm font-semibold text-stone-800">{MY_SEASON_WORDS.measures}</legend>
                  <ul className="mt-2 space-y-3">
                    {measures.map((m, i) => (
                      <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <label className="text-sm text-stone-700">
                          {MY_SEASON_WORDS.measure}
                          <input
                            type="text"
                            maxLength={120}
                            value={m.measure}
                            onChange={(e) => setMeasures((list) => list.map((x, xi) => (xi === i ? { ...x, measure: e.target.value } : x)))}
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <label className="text-sm text-stone-700">
                          {MY_SEASON_WORDS.target}
                          <input
                            type="text"
                            maxLength={120}
                            value={m.target}
                            onChange={(e) => setMeasures((list) => list.map((x, xi) => (xi === i ? { ...x, target: e.target.value } : x)))}
                            className={`mt-1 ${inputClass}`}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setMeasures((list) => list.filter((_, xi) => xi !== i))}
                          aria-label={MY_SEASON_WORDS.removeMeasure}
                          className="inline-flex min-h-[44px] items-center justify-center self-end rounded-lg px-3 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {measures.length < PLAN_MEASURES_MAX && (
                    <button
                      type="button"
                      onClick={() => setMeasures((list) => [...list, { measure: "", target: "" }])}
                      className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-teal-deep hover:bg-teal-deep/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {MY_SEASON_WORDS.addMeasure}
                    </button>
                  )}
                  <RoleMeasures
                    suggestions={data.suggestions?.measures ?? []}
                    hasSeats={data.heldSeats.length > 0 || data.applications.length > 0}
                    applyLink={data.mayApply === false ? null : applyHref({ seasonId: season.id })}
                    measures={measures}
                    onAdd={(s) =>
                      setMeasures((list) => {
                        if (list.some((x) => measureKey(x.measure) === measureKey(s.measure))) return list;
                        // The target is the member's to set.
                        const empty = list.findIndex((x) => !x.measure.trim());
                        if (empty >= 0) return list.map((x, xi) => (xi === empty ? { ...x, measure: s.measure } : x));
                        return list.length < PLAN_MEASURES_MAX ? [...list, { measure: s.measure, target: "" }] : list;
                      })
                    }
                  />
                </fieldset>
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(true)}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-teal-deep px-5 text-sm font-semibold text-white hover:bg-teal-deep-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {MY_SEASON_WORDS.file}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void save(false)}
                className="inline-flex min-h-[44px] items-center rounded-lg border border-stone-400 px-5 text-sm font-semibold text-stone-800 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep disabled:opacity-50"
              >
                {MY_SEASON_WORDS.save}
              </button>
              <Link
                href="/season-plans"
                className="ml-auto inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-teal-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-deep"
              >
                <Users className="h-4 w-4" aria-hidden="true" />
                {MY_SEASON_WORDS.village}
              </Link>
            </div>
            {said && (
              <p role={said.ok ? "status" : "alert"} className={`text-sm font-medium ${said.ok ? "text-sage" : "text-coral"}`}>
                {said.text}
              </p>
            )}
          </article>
        )}
      </div>
    </Layout>
  );
}
