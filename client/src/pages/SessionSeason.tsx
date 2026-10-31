/**
 * THE SEASON SO FAR, at /sessions/season: the meeting series seen across a
 * whole season, held against the season's own priorities (shared/
 * sessionTemplates.ts, "The season", 0292).
 *
 * Three things, all counts and words, never a score or a ranking:
 *
 *   - Each season priority with the weekly priorities that named it, set
 *     against how each was marked (done, partly, carried over, not yet), and
 *     the wins that named it.
 *   - Wins over time, a row per week, oldest first.
 *   - The tensions that keep coming up in Heart share, latest first. Their
 *     words reach the people who were in those Heart shares; everybody else
 *     reads that it came up and how often.
 *
 * It is here for the question Heart share asks: is the way we work helping
 * people thrive? Behind the `sessions` module, members only.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  PRIORITY_OUTCOME_LABEL,
  SEASON_COPY,
  SEASON_VIEW_API,
  prioritiesTally,
  type SeasonPriorityItem,
  type SeasonView,
  type SeasonWin,
} from "@shared/sessionTemplates";
import { SESSION_LIST_COPY } from "@shared/sessions";
import Layout from "@/components/Layout";
import BreathingLoader from "@/components/natural/BreathingLoader";
import ModuleGate, { SignInToSee } from "@/components/modules/ModuleGate";
import { LIST_UI } from "@/components/sessions/SessionList";
import { CHIP, HINT, LABEL_CAPS, SOFT, STAGE_LEDE, STAGE_TITLE } from "@/components/sessions/roomUi";
import { useAuth } from "@/contexts/AuthContext";
import { gameFetch } from "@/lib/gameApi";
import { useModules } from "@/modules/ModuleProvider";

const dayLabel = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
};

type Load = { kind: "loading" } | { kind: "ready"; view: SeasonView | null } | { kind: "failed" };

function PriorityList({ items }: { items: readonly SeasonPriorityItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((p, i) => (
        <li key={`${p.sessionId}-${i}`} className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="text-foreground">{p.text}</span>
          <span className={CHIP}>{p.outcome ? PRIORITY_OUTCOME_LABEL[p.outcome] : SEASON_COPY.notMarked}</span>
          <span className="text-xs text-muted-foreground">
            {p.sessionTitle}, {dayLabel(p.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function WinList({ wins }: { wins: readonly SeasonWin[] }) {
  return (
    <ul className="space-y-1">
      {wins.map((w, i) => (
        <li key={`${w.at}-${i}`} className="text-sm text-foreground">
          {w.text} <span className="text-xs text-muted-foreground">{dayLabel(w.at)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SessionSeason() {
  const { user } = useAuth();
  const modules = useModules();
  const on = (modules.modules ?? []).some((m) => m.id === "sessions" && m.lifecycle !== "off");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [seasonId, setSeasonId] = useState<string | null>(null);

  const read = useCallback(async (id: string | null) => {
    setLoad({ kind: "loading" });
    try {
      const res = await gameFetch(id ? `${SEASON_VIEW_API}?season=${encodeURIComponent(id)}` : SEASON_VIEW_API);
      if (!res.ok) return setLoad({ kind: "failed" });
      const body = (await res.json()) as { view?: SeasonView | null };
      setLoad({ kind: "ready", view: body?.view ?? null });
    } catch {
      setLoad({ kind: "failed" });
    }
  }, []);

  useEffect(() => {
    if (on && user) void read(seasonId);
  }, [on, user, seasonId, read]);

  if (!modules.loaded) {
    return (
      <Layout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <BreathingLoader label={SESSION_LIST_COPY.loading} />
        </div>
      </Layout>
    );
  }
  if (!on) return <ModuleGate moduleId="sessions" name={SESSION_LIST_COPY.moduleName} />;
  if (!user) return <SignInToSee moduleId="sessions" name={SESSION_LIST_COPY.moduleName} />;

  const view = load.kind === "ready" ? load.view : null;
  return (
    <Layout>
      <section className="py-8 md:py-12">
        <div className="container max-w-4xl">
          <Link href="/sessions" className="text-sm text-muted-foreground underline underline-offset-4">
            {SESSION_LIST_COPY.moduleName}
          </Link>
          <h1 className={`mt-3 ${STAGE_TITLE}`}>{view ? SEASON_COPY.heading(view.season.name) : SEASON_COPY.link}</h1>
          <p className={STAGE_LEDE}>{SEASON_COPY.lede}</p>
          {view && view.seasons.length > 1 && (
            <label className="mt-4 flex max-w-xs flex-col gap-1 text-sm font-semibold text-foreground">
              {SEASON_COPY.pickSeason}
              <select className={LIST_UI.input} value={view.season.id} onChange={(e) => setSeasonId(e.target.value)}>
                {view.seasons.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <div className="container max-w-4xl space-y-6 pb-16">
        {load.kind === "loading" && (
          <div className={`${LIST_UI.card} flex justify-center py-10`}>
            <BreathingLoader label={SESSION_LIST_COPY.loading} showLabel />
          </div>
        )}
        {load.kind === "failed" && (
          <p role="alert" className={LIST_UI.card}>
            {SEASON_COPY.loadFailed}
          </p>
        )}
        {load.kind === "ready" && !view && <p className={LIST_UI.card}>{SEASON_COPY.noSeason}</p>}

        {view && (
          <>
            {view.season.focus && (
              <section className={LIST_UI.card}>
                <h2 className={LABEL_CAPS}>{SEASON_COPY.focus}</h2>
                <p className="mt-2 text-lg text-foreground">{view.season.focus}</p>
              </section>
            )}

            <section aria-labelledby="season-goals" className={`${LIST_UI.card} space-y-4`}>
              <h2 id="season-goals" className={LIST_UI.heading}>
                {SEASON_COPY.goalsHeading}
              </h2>
              {view.goals.length === 0 && <p className={HINT}>{SEASON_COPY.noGoals}</p>}
              {view.goals.map((g) => {
                const t = prioritiesTally(g.priorities);
                return (
                  <article key={g.text} className={`${SOFT} space-y-2`}>
                    <h3 className="font-display text-xl text-foreground">
                      {g.text} {g.done && <span className={CHIP}>{SEASON_COPY.markedDone}</span>}
                    </h3>
                    {t.set ? (
                      <>
                        <p className="text-sm tabular-nums text-foreground">{SEASON_COPY.setLine(t.set, t.done, t.partly, t.carried)}</p>
                        {/* Set against done, as proportion, never as a grade: one segment per priority, in the order it was set. */}
                        <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                          {g.priorities.map((p, i) => (
                            <span
                              key={i}
                              className={`h-full flex-1 border-r border-card last:border-r-0 ${
                                p.outcome === "done" ? "bg-notice" : p.outcome === "partly" ? "bg-notice/50" : p.outcome === "carried" ? "bg-notice/20" : "bg-border"
                              }`}
                            />
                          ))}
                        </div>
                        <PriorityList items={g.priorities} />
                      </>
                    ) : (
                      <p className={HINT}>{SEASON_COPY.noneSet}</p>
                    )}
                    {g.wins.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">{SEASON_COPY.winsFor(g.wins.length)}</p>
                        <WinList wins={g.wins} />
                      </div>
                    )}
                  </article>
                );
              })}
              {view.unlinked.length > 0 && (
                <div className="space-y-2">
                  <h3 className={LABEL_CAPS}>{SEASON_COPY.unlinkedHeading}</h3>
                  <PriorityList items={view.unlinked} />
                </div>
              )}
              {view.unlinkedWins.length > 0 && (
                <div className="space-y-2">
                  <h3 className={LABEL_CAPS}>{SEASON_COPY.unlinkedWinsHeading}</h3>
                  <WinList wins={view.unlinkedWins} />
                </div>
              )}
            </section>

            <section aria-labelledby="season-weeks" className={`${LIST_UI.card} space-y-3`}>
              <h2 id="season-weeks" className={LIST_UI.heading}>
                {SEASON_COPY.weeksHeading}
              </h2>
              {view.weeks.length === 0 ? (
                <p className={HINT}>{SEASON_COPY.noWeeks}</p>
              ) : (
                <ol className="space-y-3">
                  {view.weeks.map((w) => (
                    <li key={w.weekOf} className="grid gap-2 border-l-2 border-notice/60 pl-4">
                      <p className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-foreground">{SEASON_COPY.weekOf(dayLabel(w.weekOf))}</span>
                        <span className={CHIP}>{SEASON_COPY.weekWins(w.wins.length)}</span>
                        {w.itemWins > 0 && <span className={CHIP}>{SEASON_COPY.weekItemWins(w.itemWins)}</span>}
                        {w.prioritiesSet > 0 && <span className={CHIP}>{SEASON_COPY.weekPriorities(w.prioritiesSet, w.prioritiesDone)}</span>}
                      </p>
                      {w.wins.length > 0 && <WinList wins={w.wins} />}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="season-tensions" className={`${LIST_UI.card} space-y-3`}>
              <h2 id="season-tensions" className={LIST_UI.heading}>
                {SEASON_COPY.tensionsHeading}
              </h2>
              <p className={HINT}>{SEASON_COPY.tensionsLede}</p>
              {view.tensions.length === 0 ? (
                <p className={HINT}>{SEASON_COPY.noTensions}</p>
              ) : (
                <ul className="space-y-2">
                  {view.tensions.map((t, i) => (
                    <li key={`${t.lastAt}-${i}`} className={`${SOFT} space-y-1`}>
                      <p className={t.text ? "text-foreground" : "text-sm italic text-muted-foreground"}>{t.text ?? SEASON_COPY.tensionHidden}</p>
                      <p className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className={t.sessions > 1 ? "font-semibold text-foreground" : undefined}>{SEASON_COPY.tensionTimes(t.sessions)}</span>
                        <span>
                          {dayLabel(t.firstAt)}
                          {t.sessions > 1 ? ` to ${dayLabel(t.lastAt)}` : ""}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
