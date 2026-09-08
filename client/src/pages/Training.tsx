import Layout from "@/components/Layout";
import { gameFetch } from "@/lib/gameApi";
import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  CheckCircle2,
  Circle,
  ExternalLink,
  Video,
  FileText,
  Hand,
  Users,
  Radio,
  GraduationCap,
} from "lucide-react";

interface TrainingModule {
  id: string;
  title: string;
  description: string;
  type: string;
  url: string;
  order: number;
  /**
   * Whether finishing this one is required to climb (migration 0179). Optional
   * modules are offered and gate nothing. Absent on a server older than 0179,
   * where every module was required, so `!== false` is the reading that keeps
   * an old server honest.
   */
  mandatory?: boolean;
}

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string }> = {
  Video: { icon: Video, color: "bg-coral/15 text-coral" },
  Article: { icon: FileText, color: "bg-teal-deep/10 text-teal-deep" },
  Practice: { icon: Hand, color: "bg-sage/20 text-sage" },
  Workshop: { icon: Users, color: "bg-amber/20 text-amber-700" },
  "Live Session": { icon: Radio, color: "bg-gold/20 text-gold" },
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

export default function Training() {
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [completed, setCompleted] = useState<string[] | null>(null);
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
    try {
      const res = await gameFetch("/api/game/training/completed");
      const data = res.ok ? await res.json() : null;
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
        setSaid("That did not save. Try again in a moment.");
        return;
      }
      const data = await res.json();
      // The server's own list, never the one this page guessed at.
      if (Array.isArray(data?.completed)) setCompleted(data.completed.map(String));
      setSaid(had ? "Taken off your record." : "Added to your record.");
    } catch {
      setSaid("That did not save. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const held = completed ?? [];
  const total = modules.length;
  const done = modules.filter((m) => held.includes(m.id)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  /*
   * The rung turns on the MANDATORY modules only, so the page counts them
   * separately from the total above. Both figures are shown, because "3 of 5
   * modules" and "the 2 that open the next rung" are different questions and a
   * single percentage answers neither of them.
   */
  const required = modules.filter((m) => m.mandatory !== false);
  const requiredDone = required.filter((m) => held.includes(m.id)).length;

  return (
    <Layout>
      <div className="bg-teal-band text-white py-16">
        <div className="container max-w-4xl">
          <div className="flex items-center gap-3 mb-3">
            <GraduationCap className="w-6 h-6 text-amber-on-band" />
            <span className="text-amber-on-band font-medium text-sm tracking-widest uppercase">
              Community Training
            </span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold mb-3">
            Learn Together, Grow Together
          </h1>
          <p className="text-white/80 text-lg max-w-2xl">
            Practical training in nonviolent communication, authentic relating, and
            consent-based decision making. The practices that make community life
            actually work.
          </p>
        </div>
      </div>

      <div className="bg-stone-50 py-12">
        <div className="container max-w-4xl">
          {/* Progress bar */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 mb-8">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-display text-xl font-bold text-teal-deep">
                  Your Progress
                </h2>
                <p className="text-sm text-stone-500 mt-0.5">
                  {done} of {total} modules completed
                </p>
              </div>
              <span className="text-teal-deep font-bold text-2xl">{pct}%</span>
            </div>
            <div className="bg-stone-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-teal-deep h-2 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            {/* What the bar above does NOT answer. A percentage over every
                module says nothing about the rung, because only the required
                ones open it, and a member deserves to know which count they
                are being measured on. */}
            {required.length > 0 ? (
              <p className="mt-3 text-sm text-stone-600">
                {requiredDone === required.length ? (
                  <>You have finished every required module.</>
                ) : (
                  <>
                    <span className="font-semibold text-teal-deep">
                      {requiredDone} of {required.length}
                    </span>{" "}
                    required modules done. Finishing them all opens the next rung.
                  </>
                )}
              </p>
            ) : null}
            {/* Mounted on every render, empty until there is something to say:
                a region inserted with its text already in it announces
                nothing. */}
            <p aria-live="polite" className={said ? "mt-2 text-sm text-stone-600" : "sr-only"}>
              {said}
            </p>
          </div>

          {/* Modules */}
          {loading ? (
            <div className="text-center py-16 text-stone-400">Loading modules...</div>
          ) : modules.length === 0 ? (
            <div className="text-center py-16 text-stone-400">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No training modules available yet. Check back soon.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {modules.map((m) => {
                const meta = TYPE_META[m.type] ?? TYPE_META.Article;
                const Icon = meta.icon;
                const isDone = held.includes(m.id);
                return (
                  <div
                    key={m.id}
                    className={`bg-white rounded-2xl border ${
                      isDone ? "border-teal-deep/30 bg-teal-deep/[0.02]" : "border-stone-200"
                    } shadow-sm p-5 md:p-6 transition-colors`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${meta.color}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <h3 className={`font-display text-lg font-semibold ${isDone ? "text-stone-500" : "text-teal-deep"}`}>
                            {m.title}
                          </h3>
                          <div className="shrink-0 flex items-center gap-1.5">
                            {m.mandatory === false ? (
                              <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">
                                Optional
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-amber/20 px-2 py-0.5 text-xs font-medium text-amber-700">
                                Required
                              </span>
                            )}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                              {m.type}
                            </span>
                          </div>
                        </div>
                        <p className={`text-sm leading-relaxed mb-4 ${isDone ? "text-stone-400" : "text-stone-600"}`}>
                          {m.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-3">
                          {m.url ? (
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-deep hover:text-teal-deep/80 transition-colors"
                            >
                              Open <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-sm text-stone-400 italic">Link coming soon</span>
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
                            className={`inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                              isDone
                                ? "bg-teal-deep/10 text-teal-deep hover:bg-teal-deep/15"
                                : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                            }`}
                          >
                            {isDone ? (
                              <>
                                <CheckCircle2 className="w-4 h-4" /> I have done this
                              </>
                            ) : (
                              <>
                                <Circle className="w-4 h-4" /> Mark as done
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
