/**
 * THE COMMS ADMIN ROUTES, `/api/admin/comms/*` (the comms build spec 5.1,
 * 5.15 and 6). A skeleton from the foundation lane: the status summary and
 * the "run now" button. The setup, words, journeys, people, letters and sent
 * mail lanes add their routes to this file.
 *
 * ── WHERE THIS IS REGISTERED, AND WHY ──────────────────────────────────────
 *
 * After `express.json()`, the admin audit middleware and the admin
 * default-deny gate, like every admin route module, so a write here is
 * audited and a success that passed no gate is refused. Every route asks the
 * one capability gate for `comms.manage`: a change through `guardCapability`
 * (the break-glass and the public record live there), a look through
 * `mayStillSee` (a GET carries no break-glass, so a refused look would strand
 * an operator).
 *
 * NOT behind `requireModule("comms")` as a whole, and that is deliberate.
 * Settings and Sent mail must work while the module is off, because a village
 * sets up its sending before it turns anything on, and the status below is
 * plumbing that answers at every lifecycle. The routes that drive automations
 * mount the module gate on themselves, one route at a time, the way
 * `/api/admin/hypha` gates its own routes (shared/modules.ts, `comms`).
 *
 * "RUN NOW" IS HOW TIME IS DRIVEN. The e2e suites run with the scheduler off,
 * so they move the post office, the journeys and the time votes forward by
 * calling `POST /api/admin/comms/run` with the job's name and reading the
 * summary it answers.
 */
import type { Express } from "express";
import { MODULES_BY_ID } from "../../shared/modules";
import type { AppDeps } from "../lib/appDeps";
import { tick } from "../lib/comms/journeys";
import { drain, POST_OFFICE_EVERY_MS, POST_OFFICE_JOB, runPostOfficeJob } from "../lib/comms/postOffice";
import { effectiveLifecycle } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { messageCountsByStatus, providerEventCounts } from "../repos/commsMessages";
import { register as registerCommsSettings, type CommsSettingsDeps } from "./commsSettings";
import { registerAdmin as registerPeopleAdmin } from "./commsPeople";
import { register as registerWords } from "./commsWords";
import { register as registerSentMailRoutes } from "./commsSent";
import { register as registerJourneys, journeysTickDeps } from "./commsJourneys";
import { runTimePollsNow, timePollDepsOf } from "./commsPolls";
import { register as registerLetters, runLettersNow } from "./commsLetters";
import { register as registerPaths } from "./commsPaths";

type Deps = Pick<
  AppDeps,
  "authedUser" | "guardCapability" | "mayStillSee" | "getPool" | "commsPostOffice" | "members" | "adminActor" | "notify" | "lapseContext"
> &
  Omit<CommsSettingsDeps, "jobs">;

/** How far back the status summary counts. */
const STATUS_DAYS = 30;

/** The jobs "run now" can run, by the name the request gives. */
export const COMMS_JOBS = ["drain", "journeys", "polls", "letters"] as const;
export type CommsJob = (typeof COMMS_JOBS)[number];

export function register(app: Express, deps: Deps): void {
  const { authedUser, guardCapability, mayStillSee, getPool, commsPostOffice } = deps;

  const runners: Record<CommsJob, () => Promise<Record<string, number>>> = {
    drain: () => drain(commsPostOffice),
    journeys: () => tick(journeysTickDeps(deps)),
    // The live time vote's job (server/routes/commsPolls.ts registers it on the scheduler).
    polls: () => runTimePollsNow(timePollDepsOf(deps)),
    letters: () => runLettersNow(deps),
  };

  // The post office's drain on the scheduler, beside the button that runs it now.
  registerJob(POST_OFFICE_JOB, POST_OFFICE_EVERY_MS, () => runPostOfficeJob(commsPostOffice));
  registerSentMailRoutes(app, { authedUser, guardCapability, mayStillSee, getPool });

  /**
   * What the post office has done lately, and whether it can send at all.
   * Counts and yes-or-no answers only: no address and no key ever leaves.
   */
  app.get("/api/admin/comms/status", async (req, res) => {
    if (!(await authedUser(req))) return res.status(401).json({ error: "Sign in to see the village's email" });
    if (!(await mayStillSee(req, "comms.manage"))) {
      return res.status(403).json({ error: "Running the village's email is an appointment" });
    }
    const pool = getPool();
    const readiness = MODULES_BY_ID.comms?.readiness ? await MODULES_BY_ID.comms.readiness() : null;
    res.json({
      module: {
        lifecycle: effectiveLifecycle("comms"),
        ready: readiness?.ready ?? false,
        hint: readiness?.hint ?? null,
      },
      provider: {
        keySet: commsPostOffice.hasApiKey(),
        senderSet: commsPostOffice.sender() !== "",
      },
      messages: { days: STATUS_DAYS, byStatus: await messageCountsByStatus(pool, STATUS_DAYS) },
      deliveryReports: await providerEventCounts(pool),
      jobs: COMMS_JOBS,
    });
  });

  /** Run one comms job now and answer what it did. */
  app.post("/api/admin/comms/run", async (req, res) => {
    const may = await guardCapability(req, res, "comms.manage", {
      status: 403,
      body: { error: "Running the village's email is an appointment" },
    });
    if (!may) return;
    const job = String(req.body?.job ?? "");
    if (!(COMMS_JOBS as readonly string[]).includes(job)) {
      return res.status(400).json({ error: `Name a job to run: ${COMMS_JOBS.join(", ")}.` });
    }
    const summary = await runners[job as CommsJob]();
    res.json({ job, summary, ranAt: new Date().toISOString() });
  });

  // Settings and the Overview (the setup lane, B4): server/routes/commsSettings.ts.
  registerCommsSettings(app, { ...deps, jobs: COMMS_JOBS });

  // People: the address book, a person's page, suppress and restore (server/routes/commsPeople.ts).
  registerPeopleAdmin(app, deps);

  // Words: every email's words, versions, preview and test (server/routes/commsWords.ts).
  registerWords(app, deps);

  // Journeys: the timeline, on and off, step edits, walk-through, and the tick's job (server/routes/commsJourneys.ts).
  registerJourneys(app, deps);

  // Letters, and each journey step's outcomes (server/routes/commsLetters.ts).
  registerLetters(app, deps);
  // Paths: the path journeys' options, and the paths lane's rules, values and hand-off (server/routes/commsPaths.ts).
  registerPaths(app, deps);
}
