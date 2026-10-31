/**
 * The gratitude nudge and its suggestions: one signed-in read and one job.
 *
 * A route module rather than more lines in server/index.ts, on the pattern
 * server/routes/faqs.ts set out. The rules and their reasoning live in
 * server/lib/gratitudeNudge.ts; this file only wires them.
 *
 *  - `GET /api/game/gratitude/suggestions` is the send panel's quick-pick
 *    chips: the same `gratitudeSuggestionsFor` the nudge counts, for the
 *    member asking and nobody else. It is a list of the asker's own
 *    co-workers, never a directory: no id parameter exists to ask about
 *    anybody else.
 *  - The `gratitude-nudge` job runs every six hours. The dedupe key is per
 *    cycle and member, so the runs inside the lead window are one notice. It
 *    sends no gratitude and closes no cycle.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import { recognitionName } from "../lib/economy";
import { gratitudeSuggestionsFor, runGratitudeNudge, type SuggestionDeps } from "../lib/gratitudeNudge";
import { effectiveLifecycle } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { numberVar } from "../lib/variables";
import { villageTimezone } from "../lib/villageReaders";

export const GRATITUDE_NUDGE_JOB = "gratitude-nudge";
export const GRATITUDE_NUDGE_EVERY_MS = 6 * 60 * 60 * 1000;

type Deps = Pick<AppDeps, "getPool" | "authedUser" | "members" | "notify" | "notifyDeps"> & {
  /** What this member may still send this cycle: `gratitudeBudget(user).remaining`. */
  remainingFor(member: any): Promise<number>;
};

export function register(app: Express, deps: Deps): void {
  const suggestionDeps = (): SuggestionDeps => ({
    pool: deps.getPool(),
    memberById: (id) => deps.members.byId(id),
    isPresent: deps.notifyDeps.isPresent,
    moduleOn: (id) => effectiveLifecycle(id) !== "off",
  });

  app.get("/api/game/gratitude/suggestions", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    try {
      const people = await gratitudeSuggestionsFor(suggestionDeps(), String(user.id));
      res.json({ suggestions: people.map(({ name, handle, sources }) => ({ name, handle, sources })) });
    } catch (e) {
      // No chips is a send panel that still works. A 500 here would cost the
      // member nothing they need, so the answer is an honest empty list.
      console.error("[gratitude-nudge] suggestions failed", e);
      res.json({ suggestions: [] });
    }
  });

  registerJob(GRATITUDE_NUDGE_JOB, GRATITUDE_NUDGE_EVERY_MS, async () => {
    const leadDays = numberVar("gratitude.nudge_days_before_close");
    if (!(leadDays > 0)) return "switched off (0 days)";
    const r = await runGratitudeNudge({
      leadDays,
      timeZone: villageTimezone(),
      currency: recognitionName(),
      members: await deps.members.all(),
      isPresent: deps.notifyDeps.isPresent,
      remainingFor: deps.remainingFor,
      suggestionsFor: (userId) => gratitudeSuggestionsFor(suggestionDeps(), userId),
      notify: deps.notify,
    });
    return r.due ? `${r.told} of ${r.eligible} nudged, ${r.due.daysLeft} day(s) before ${r.due.cycleId} closes` : undefined;
  });
}
