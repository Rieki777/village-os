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
 *   YOUR PART      your aim, the season goal you serve, quests a moon and up
 *                  to three measures. Filed, never voted.
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
import { AIM_MAX, applyHref, civilDayWords, PLAN_MEASURES_MAX } from "@shared/seasonPlans";

export const MY_SEASON_WORDS = {
  title: "Your season",
  signIn: "Sign in to plan your season.",
  signInLine: "Choose the seats you keep, hand back or apply for, and what you will do this season.",
  noSeason: "There is no season to plan yet.",
  noSeasonLine: "Planning opens one moon before the next season starts. You will get a notice.",
  open: (closes: string) => `Open until ${civilDayWords(closes)}.`,
  before: (opens: string) => `Opens on ${civilDayWords(opens)}.`,
  closed: "The window has closed. You can still file.",
  seatsHeading: "Your seats",
  noSeats: "You hold no seats yet.",
  carryOn: "Carry on",
  handBack: "Hand it back",
  notSure: "Not sure",
  handingBackLine: "You hand this seat back when the season turns.",
  carryingOn: "You asked to carry on",
  applyHeading: "Apply for a seat",
  applyLine: "Ask the village for any seat on the chart. You pick up to five in one application.",
  apply: "Apply for a seat",
  proposeLine: "The seat you want is not on the chart yet? Start a proposal for it.",
  propose: "Propose a seat",
  applicationsHeading: "Your applications this season",
  partHeading: "Your part",
  partLine: "What you will do this season. You file it. Nobody votes on it.",
  aim: "Your aim",
  aimHelp: "What will be true at the end of the season because of you.",
  goal: "The season goal you serve",
  noGoal: "None picked",
  quests: "Quests a moon",
  fewest: "Fewest",
  most: "Most",
  thisMoon: "Done this moon",
  measures: "How you measure your work",
  measure: "Measure",
  target: "Target",
  addMeasure: "Add a measure",
  removeMeasure: "Remove this measure",
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
  const [goal, setGoal] = useState("");
  const [fewest, setFewest] = useState("");
  const [most, setMost] = useState("");
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [handingBack, setHandingBack] = useState<string[]>([]);

  const adopt = useCallback((d: MinePayload) => {
    setData(d);
    const p = d.plan;
    setAim(p?.aim ?? "");
    setGoal(p?.servesGoal ?? "");
    setFewest(p?.commitments?.quests?.perMoonMin != null ? String(p.commitments.quests.perMoonMin) : "");
    setMost(p?.commitments?.quests?.perMoonMax != null ? String(p.commitments.quests.perMoonMax) : "");
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
    return {
      aim: aim.trim(),
      servesGoal: goal || null,
      commitments: {
        ...(min !== undefined || max !== undefined
          ? { quests: { ...(min !== undefined ? { perMoonMin: min } : {}), ...(max !== undefined ? { perMoonMax: max } : {}), doneWhenRequired: true as const } }
          : {}),
        ...(kept.length ? { scoreboard: { measures: kept.map((m) => ({ measure: m.measure.trim(), ...(m.target.trim() ? { target: m.target.trim() } : {}) })) } } : {}),
      },
      handingBack,
    };
  }, [aim, goal, fewest, most, measures, handingBack]);

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
                            <span className="text-sm text-stone-700">{MY_SEASON_WORDS.carryingOn}:</span>
                            <ApplicationChip app={app} />
                          </div>
                        ) : (
                          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`What happens to ${seat.name}`}>
                            <Link
                              href={applyHref({ seasonId: season.id, renew: seat.id })}
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
              <p className="mt-3 text-sm text-stone-700">
                {MY_SEASON_WORDS.proposeLine}{" "}
                <Link href="/propose" className="font-medium text-teal-deep underline underline-offset-2">
                  {MY_SEASON_WORDS.propose}
                </Link>
              </p>
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

                {season.goals.length > 0 && (
                  <div>
                    <label htmlFor="ms-goal" className="block text-sm font-semibold text-stone-800">
                      {MY_SEASON_WORDS.goal}
                    </label>
                    <select id="ms-goal" value={goal} onChange={(e) => setGoal(e.target.value)} className={`mt-1 ${inputClass}`}>
                      <option value="">{MY_SEASON_WORDS.noGoal}</option>
                      {season.goals.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <fieldset>
                  <legend className="text-sm font-semibold text-stone-800">{MY_SEASON_WORDS.quests}</legend>
                  <div className="mt-1 grid max-w-xs grid-cols-2 gap-3">
                    <label className="text-sm text-stone-700">
                      {MY_SEASON_WORDS.fewest}
                      <input type="number" min={1} max={12} inputMode="numeric" value={fewest} onChange={(e) => setFewest(e.target.value)} className={`mt-1 ${inputClass}`} />
                    </label>
                    <label className="text-sm text-stone-700">
                      {MY_SEASON_WORDS.most}
                      <input type="number" min={1} max={12} inputMode="numeric" value={most} onChange={(e) => setMost(e.target.value)} className={`mt-1 ${inputClass}`} />
                    </label>
                  </div>
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
