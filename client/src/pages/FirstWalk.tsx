/**
 * Your First Walk: the founder's guided tour of the standing examples.
 *
 * The standing examples demonstrate every module and still wait to be found.
 * This is the page that sends a founder to look at them, one specific stop at
 * a time, each one teaching a rule the platform runs on.
 *
 * Steps come from client/src/lib/firstWalk.ts (data, not markup) and are
 * filtered to what this village is ACTUALLY showing, so nobody is sent to a
 * shelf that does not exist. Ticking is manual and local: this is a reading
 * list, and a checkbox a founder controls is more honest than inferring that
 * they understood something because a page loaded.
 *
 * The walk retires itself. Every stop depends on a module still showing
 * examples, so publishing real content removes stops, and the last real
 * thing published removes the page's reason to exist.
 */
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { CheckCircle2, Circle, Compass, X } from "lucide-react";
import { useExampleModules } from "@/components/ExamplesBanner";
import {
  applicableSteps,
  dismissWalk,
  getDoneSteps,
  isWalkDismissed,
  setStepDone,
  walkProgress,
} from "@/lib/firstWalk";

export default function FirstWalk() {
  const { modules, loaded } = useExampleModules();
  const [done, setDone] = useState<string[]>(() => getDoneSteps());

  const steps = applicableSteps(modules);
  const progress = walkProgress(modules, done);

  const toggle = (id: string) => setDone(setStepDone(id, !done.includes(id)));

  return (
    <Layout>
      <section className="py-12 bg-gradient-to-b from-teal-deep/5 to-background">
        <div className="container text-center">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">Your First Walk</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {/* Counted, never hard-coded: stops drop off as modules publish
                real content, and a village that seeds its own circles never
                sees the map stop at all. */}
            {steps.length > 0 ? `${steps.length} stops` : "A short walk"}, a minute each. Each one
            shows you one thing your village can do.
          </p>
        </div>
      </section>

      <section className="py-8 bg-background">
        <div className="container max-w-2xl space-y-4">
          {!loaded && <p className="text-sm text-muted-foreground">Looking at what your village is showing…</p>}

          {loaded && steps.length === 0 && (
            <div className="bg-card border border-border rounded-xl p-6 text-center">
              <Compass className="w-6 h-6 text-teal-deep mx-auto mb-3" />
              <p className="text-sm text-foreground font-medium mb-1">This village speaks for itself already.</p>
              <p className="text-sm text-muted-foreground">
                The practice examples are gone. Everything here now, your
                village made.
              </p>
            </div>
          )}

          {loaded && steps.length > 0 && (
            <>
              <div className="bg-card border border-border rounded-xl px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">
                    {progress.done}/{progress.total} stops
                  </p>
                  {progress.done === progress.total && (
                    <p className="text-xs text-teal-deep font-medium">Walk complete</p>
                  )}
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-deep transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>

              {steps.map((s, i) => {
                const isDone = done.includes(s.id);
                return (
                  <div
                    key={s.id}
                    className={`bg-card border rounded-xl p-5 ${isDone ? "border-teal-deep/30" : "border-border"}`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => toggle(s.id)}
                        aria-pressed={isDone}
                        aria-label={isDone ? `Mark "${s.title}" as not seen` : `Mark "${s.title}" as seen`}
                        className="mt-0.5 shrink-0"
                      >
                        {isDone
                          ? <CheckCircle2 className="w-5 h-5 text-teal-deep" />
                          : <Circle className="w-5 h-5 text-muted-foreground/40" />}
                      </button>
                      <div className="flex-1">
                        <p className={`font-semibold text-sm ${isDone ? "text-muted-foreground" : "text-foreground"}`}>
                          {i + 1}. {s.title}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">{s.todo}</p>
                        <p className="text-xs text-teal-deep mt-1.5">{s.teaches}</p>
                        <Link
                          href={s.href}
                          className="inline-block mt-3 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium hover:bg-teal-deep-dark"
                        >
                          {s.cta}
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* The walk ends by reading, and reading is half of it. Every
                  stop stands on a module that is still showing examples, so
                  the way OUT of the walk is to publish the first real thing:
                  that module's examples retire on the spot and the stop
                  disappears. Say so where the founder has just finished. */}
              {progress.done === progress.total && (
                <div className="rounded-xl border border-teal-deep/30 bg-teal-deep/5 p-5">
                  <p className="font-semibold text-sm text-foreground">Now plant your own</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Publish your first real post, event or item. That room's
                    examples clear on their own, and this walk retires when the
                    last one goes.
                  </p>
                  <Link
                    href="/admin"
                    className="inline-block mt-3 text-sm bg-teal-deep text-white rounded-lg px-4 py-2 font-medium hover:bg-teal-deep-dark"
                  >
                    Open Village Settings
                  </Link>
                </div>
              )}

            </>
          )}
        </div>
      </section>
    </Layout>
  );
}

/**
 * The invitation, for the pages a founder actually lands on.
 *
 * Shown only while there is a walk left to take: it needs at least one stop
 * that applies, and it disappears once every stop is ticked or the founder
 * closes it. A prompt that survives being answered is a nag.
 */
export function FirstWalkInvite() {
  const { modules, loaded } = useExampleModules();
  // The walk is the team's tour (R47), so the invitation is too.
  const { user } = useAuth();
  const isTeam = user?.role === "admin" || user?.role === "founder";
  const [dismissed, setDismissed] = useState(() => isWalkDismissed());
  const [done, setDone] = useState<string[]>(() => getDoneSteps());

  // Re-read on mount so returning from a stop shows the new count.
  useEffect(() => { setDone(getDoneSteps()); }, []);

  if (!loaded || dismissed || !isTeam) return null;
  const progress = walkProgress(modules, done);
  if (progress.total === 0 || progress.done >= progress.total) return null;

  return (
    <div className="mb-6 rounded-lg border border-teal-deep/30 bg-teal-deep/5 px-4 py-3 flex items-start gap-3">
      <Compass className="w-4 h-4 text-teal-deep mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <p className="text-foreground">
          Your village still shows practice examples.{" "}
          <Link href="/first-walk" className="text-teal-deep font-medium hover:underline">
            Take Your First Walk
          </Link>
          :{" "}
          {progress.total - progress.done === 1
            ? "one stop left"
            : `${progress.total - progress.done} stops, a minute each`}.
        </p>
      </div>
      <button
        onClick={() => { dismissWalk(); setDismissed(true); }}
        aria-label="Hide the walk invitation"
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
