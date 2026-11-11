import Layout from "@/components/Layout";
import { authToken, gameFetch } from "@/lib/gameApi";
import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Circle, ExternalLink, FileText, GraduationCap, Hand, Radio, Users, Video } from "lucide-react";
import { usePageContent } from "@/hooks/usePageContent";
import { Emphasized } from "@/components/PageText";
import { BreathingLoader } from "@/components/natural";
import { SeedOfLife } from "@/components/journey/nature";
import {
  BTN_NOTICE,
  BTN_SECONDARY,
  CARD,
  CHIP_SOFT,
  DOOR,
  EYEBROW,
  H1,
  H2,
  HINT,
  LEDE,
  LINK,
  RING,
  TILE,
  WORLD,
} from "@/components/journey/look";
import { TRAINING_PAGES, TRAINING_TRACKS, isTrainingTrack, type TrainingTrack } from "@shared/pageContent/training";
import type { ResolvedPage } from "@shared/pageContent/types";

interface TrainingModule {
  id: string;
  title: string;
  description: string;
  type: string;
  url: string;
  order: number;
  /**
   * Whether finishing this one is required to climb (migration 0197). Optional
   * modules are offered and gate nothing. Absent on a server older than 0197,
   * where every module was required, so `!== false` is the reading that keeps
   * an old server honest.
   */
  mandatory?: boolean;
}

/*
 * TWO TRAINING PAGES AND A CHOOSER (the lead, 11 Nov 2026: "should have 2
 * different routes in admin").
 *
 *   /training/steward and /training/resident each read their own words from
 *   Admin, Pages (shared/pageContent/training.ts), so a village can tell each
 *   path its own story, and each track's "Community training" step links to
 *   its own page.
 *   /training is the chooser: the two doors, each named in its page's words.
 *   Older links, the path card and the menu still land somewhere true.
 *
 * The lessons are one list for both pages for now (Admin, Training modules),
 * because the rung that counts them is one rule for everybody.
 *
 * DRAWN IN THE NIGHT WORLD (docs/DESIGN_RULE.md). The bar and percentage the
 * page used to draw were a meter; the progress is a Seed of Life now, one
 * circle per lesson, with the words beside it. It is the member's own record
 * and names nobody else.
 */

/** Each lesson type's icon. Keyed by the types Admin offers; anything else reads as an article. */
const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  Video,
  Article: FileText,
  Practice: Hand,
  Workshop: Users,
  "Live Session": Radio,
};

/*
 * ── THE RECORD LIVES ON THE SERVER, AND USED NOT TO ─────────────────────────
 *
 * This page kept completions in `localStorage` under "amora-training-completed"
 * and mirrored them to `POST /api/game/journey/sync`. Both halves were wrong,
 * and together they made a whole rung of the ladder unreachable:
 *
 *   The ladder's Participant rung has the rule `training-complete`, which the
 *   server answers from `training_completions`. Nothing this page did ever
 *   wrote that table, so no member using the app could ever cross it.
 *
 *   The sync route it did call REFUSES the "training" journey BY NAME now,
 *   because that route stored whatever list it was handed and a member could
 *   promote their own rung by posting one. The refusal was caught and dropped,
 *   so the page had been failing silently since that door closed.
 *
 *   And a cleared browser erased somebody's training record entirely.
 *
 * So the server is the source now: `GET /api/game/training/completed` on load,
 * and one POST or DELETE per module. No localStorage at all, deliberately. A
 * mirror would only reintroduce the question of which copy is true.
 */

/** wouter hands a routed component its params; a track page is mounted with `track`. */
export default function Training({ track }: { track?: unknown }) {
  return isTrainingTrack(track) ? <TrackTraining track={track} /> : <TrainingChooser />;
}

function Hero({ eyebrow, headline, intro, waiting }: { eyebrow: string; headline: string; intro: string; waiting: boolean }) {
  return (
    <header className={`space-y-3${waiting ? " invisible" : ""}`}>
      <p className={`${EYEBROW} inline-flex items-center gap-2`}>
        <GraduationCap className="size-4" aria-hidden="true" />
        {eyebrow || " "}
      </p>
      <h1 className={H1}>{headline || " "}</h1>
      {intro ? (
        <p className={LEDE}>
          <Emphasized text={intro} />
        </p>
      ) : null}
    </header>
  );
}

/** /training: one door per track, each in its own page's words. */
function TrainingChooser() {
  const steward = usePageContent(TRAINING_PAGES.steward);
  const resident = usePageContent(TRAINING_PAGES.resident);
  const pages: Record<TrainingTrack, ResolvedPage | null> = { steward, resident };
  const ready = steward !== null && resident !== null;
  return (
    <Layout>
      <div className={`${WORLD} py-10 sm:py-16`}>
        <div className="mx-auto max-w-3xl space-y-8 px-4">
          <Hero
            eyebrow="Community training"
            headline="Choose your training"
            intro="Each path has its own training. Open the one for the path you are walking."
            waiting={false}
          />
          {ready ? (
            <nav aria-label="Training pages" className="grid gap-4 sm:grid-cols-2">
              {TRAINING_TRACKS.map((t) => {
                const door = pages[t]?.door.fields;
                return (
                  // Spelled out, so the reachability gate reads each door (trainingPathFor gives the same two).
                  <Link key={t} href={t === "steward" ? "/training/steward" : "/training/resident"} className={`${CARD} group flex min-h-11 flex-col gap-3 hover:border-notice`}>
                    <span className={RING} aria-hidden="true">
                      <GraduationCap className="size-5" />
                    </span>
                    <span className={H2}>{door?.title}</span>
                    <span className={HINT}>{door?.line}</span>
                    <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-notice">
                      Open
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  </Link>
                );
              })}
            </nav>
          ) : (
            <div className="flex justify-center py-10">
              <BreathingLoader label="Opening the training" />
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function TrackTraining({ track }: { track: TrainingTrack }) {
  const page = usePageContent(TRAINING_PAGES[track]);
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [completed, setCompleted] = useState<string[] | null>(null);
  const [signedIn] = useState(() => Boolean(authToken()));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/training-modules");
      const data = await res.json();
      setModules(Array.isArray(data) ? data : []);
    } catch {
      setModules([]);
    }
    // The member's own record, from the server that decides the rung. Null
    // stays null on a failure, so an unreadable record never renders as an
    // empty one: "we could not ask" and "you have finished nothing" are
    // different sentences and only one of them is a reason to start.
    // Signed out there is no record to read and the route answers 401, which
    // the browser logged as a failure on every visit. Null is the same answer.
    try {
      const res = authToken() ? await gameFetch("/api/game/training/completed") : null;
      const data = res?.ok ? await res.json() : null;
      if (Array.isArray(data?.completed)) setCompleted(data.completed.map(String));
    } catch {
      /* leaves null */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * A DECLARATION, AND ITS WITHDRAWAL, both answered by the server.
   *
   * The Response is read rather than dropped: this control claims a change
   * landed, so it has to know that it did. On a refusal the tick goes back
   * where it was and the page says so, because a checkbox that reverts in
   * silence is how somebody comes to believe they finished a module they did
   * not.
   */
  const toggle = async (id: string) => {
    if (completed === null || busy) return;
    const had = completed.includes(id);
    setBusy(id);
    setSaid("");
    try {
      const res = await gameFetch(`/api/game/training/${encodeURIComponent(id)}/complete`, {
        method: had ? "DELETE" : "POST",
      });
      if (!res.ok) {
        setSaid("That didn't save. Try again.");
        return;
      }
      const data = await res.json();
      // The server's own list, never the one this page guessed at.
      if (Array.isArray(data?.completed)) setCompleted(data.completed.map(String));
      setSaid(had ? "No longer marked done." : "Marked done.");
    } catch {
      setSaid("That didn't save. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const held = completed ?? [];
  const total = modules.length;
  const done = modules.filter((m) => held.includes(m.id)).length;
  /*
   * The rung turns on the MANDATORY modules only, so the page counts them
   * separately from the total above. Both are said, because "3 of 5 lessons"
   * and "the 2 that complete your training" are different questions.
   */
  const required = modules.filter((m) => m.mandatory !== false);
  const requiredDone = required.filter((m) => held.includes(m.id)).length;
  // The one lesson to take next: the first required one not yet done, else the first of any.
  const next = completed === null ? null : (required.find((m) => !held.includes(m.id)) ?? modules.find((m) => !held.includes(m.id)) ?? null);

  const hero = page?.hero.fields;
  const lessons = page?.lessons.fields;
  const close = page?.close;

  const progress =
    completed !== null && total > 0 ? (
      <section aria-labelledby="training-progress" className={`${CARD} flex items-center gap-5 lg:flex-col lg:items-start`}>
        {total <= 19 ? (
          <SeedOfLife
            total={total}
            walked={done}
            size="md"
            bloom
            label={`${done} of ${total} lessons done`}
            labels={modules.map((m) => m.title)}
            className="shrink-0"
          />
        ) : null}
        <div className="min-w-0 space-y-1">
          <h2 id="training-progress" className={EYEBROW}>
            Your training
          </h2>
          <p className="font-display text-2xl text-card-foreground">
            {done} of {total} lessons done
          </p>
          {required.length > 0 ? (
            <p className={HINT}>
              {requiredDone === required.length
                ? "Required training complete."
                : `${requiredDone} of ${required.length} required lessons done. Finish the rest to complete your training.`}
            </p>
          ) : null}
        </div>
      </section>
    ) : !loading && !signedIn ? (
      <section className={CARD}>
        <p className={HINT}>
          <Link href="/login" className={LINK}>
            Sign in
          </Link>{" "}
          to mark lessons done as you go.
        </p>
      </section>
    ) : null;

  return (
    <Layout>
      <div className={`${WORLD} py-10 sm:py-16`}>
        <div className="mx-auto max-w-5xl space-y-8 px-4">
          <Hero eyebrow={hero?.eyebrow ?? ""} headline={hero?.headline ?? ""} intro={hero?.intro ?? ""} waiting={!page} />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start">
            {/* On a desktop the record stays beside the lessons; on a phone it sits above them. */}
            <div className="space-y-4 lg:sticky lg:top-24">
              {progress}
              {/* Mounted on every render, empty until there is something to say:
                  a region inserted with its text already in it announces nothing. */}
              <p aria-live="polite" className={said ? HINT : "sr-only"}>
                {said}
              </p>
            </div>

            <section aria-labelledby="training-lessons" className={`${CARD} space-y-4`}>
              <div className={`space-y-1${page ? "" : " invisible"}`}>
                <h2 id="training-lessons" className={H2}>
                  {lessons?.heading || " "}
                </h2>
                {lessons?.intro ? <p className={HINT}>{lessons.intro}</p> : null}
              </div>

              {loading ? (
                <div className="flex justify-center py-10">
                  <BreathingLoader label="Gathering the lessons" />
                </div>
              ) : modules.length === 0 ? (
                <p className={HINT}>No lessons yet. They appear here once the village adds them.</p>
              ) : (
                <ul className="space-y-3">
                  {modules.map((m) => {
                    const Icon = TYPE_ICON[m.type] ?? FileText;
                    const isDone = held.includes(m.id);
                    const isNext = next?.id === m.id;
                    return (
                      <li key={m.id} className={`${TILE}${isNext ? " border-notice/60" : ""}`} data-next={isNext || undefined}>
                        <div className="flex items-start gap-4">
                          <span className={`${RING} hidden sm:inline-flex`} aria-hidden="true">
                            {isDone ? <CheckCircle2 className="size-5 text-open" /> : <Icon className="size-5" />}
                          </span>
                          <div className="min-w-0 flex-1 space-y-2">
                            {isNext ? <p className={EYEBROW}>Next</p> : null}
                            {/*
                              The title and its chips share a row that may WRAP, so at 320 the
                              chips drop under the title instead of pushing the page wider than
                              the phone.
                            */}
                            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                              <h3 className={`min-w-0 break-words font-display text-lg ${isDone ? "text-muted-foreground" : "text-card-foreground"}`}>
                                {m.title}
                              </h3>
                              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                                <span className={CHIP_SOFT}>{m.mandatory === false ? "Optional" : "Required"}</span>
                                <span className={CHIP_SOFT}>
                                  <Icon className="size-3.5" aria-hidden="true" />
                                  {m.type}
                                </span>
                              </div>
                            </div>
                            {m.description ? <p className={`${HINT} leading-relaxed`}>{m.description}</p> : null}
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                              {m.url ? (
                                <a href={m.url} target="_blank" rel="noopener noreferrer" className={BTN_NOTICE}>
                                  Open <ExternalLink className="size-3.5" aria-hidden="true" />
                                </a>
                              ) : (
                                <span className={`${HINT} italic`}>Link coming soon</span>
                              )}
                              {/* Disabled until the member's record has arrived, so
                                  nobody can toggle against a list nobody has read,
                                  and while a write is in flight so a double press
                                  cannot post and delete the same module. */}
                              <button
                                type="button"
                                onClick={() => void toggle(m.id)}
                                disabled={completed === null || busy !== null}
                                aria-busy={busy === m.id}
                                className={BTN_SECONDARY}
                              >
                                {isDone ? (
                                  <>
                                    <CheckCircle2 className="size-4 text-open" aria-hidden="true" /> I have done this
                                  </>
                                ) : (
                                  <>
                                    <Circle className="size-4" aria-hidden="true" /> Mark as done
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {close && !close.hidden ? (
            <section aria-labelledby="training-close" className={`${CARD} space-y-3`}>
              <h2 id="training-close" className={H2}>
                {close.fields.heading}
              </h2>
              {close.fields.body ? (
                <p className={LEDE}>
                  <Emphasized text={close.fields.body} />
                </p>
              ) : null}
              {close.fields.ctaLabel && close.fields.ctaTarget ? (
                <a href={close.fields.ctaTarget} className={DOOR}>
                  {close.fields.ctaLabel}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </a>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
