/**
 * What is failing in the village, for the people who run it.
 *
 *   GET /api/admin/failures   the report the failed-actions job keeps
 *
 * And the job itself, registered here beside the route that reads what it
 * writes, the way server/lib/moduleUsage.ts registers its own. Why the job does
 * what it does, and why it reruns so little, is argued once, in
 * server/lib/failedActions.ts.
 *
 * ── WHY ADMIN AND NOT A CAPABILITY ──────────────────────────────────────────
 *
 * The report reaches across payments, governance, connections and the
 * scheduler, and several of its findings name a Stripe order or a ballot. The
 * nearest capability, `intake.moderate`, is for working queues, and holding it
 * does not make somebody responsible for a village's Stripe account. The one
 * area a steward works, account deletions, already has its own queue at
 * /review, and this report sends them there.
 *
 * ── WHAT THIS ROUTE NEVER SAYS ──────────────────────────────────────────────
 *
 * A member id, a name or an email. The job never stores one, so there is none
 * here to leak.
 */
import type { Express } from "express";

import type { AppDeps } from "../lib/appDeps";
import type { ErasureDeps } from "../lib/erasure";
import {
  BLIND_SPOTS,
  defaultSources,
  FAILED_ACTIONS_EVERY_MS,
  FAILED_ACTIONS_JOB,
  labelFor,
  REPORT_SOURCE,
  resumeClosedErasures,
  runFailedActions,
  SOURCE_LABELS,
} from "../lib/failedActions";
import { registerJob, schedulerEnabled } from "../lib/scheduler";
import { openItems, recentlyResolved, type FailedItem } from "../repos/failedActionItems";
import { scheduledJobRows } from "../repos/failureSources";

type Deps = Pick<AppDeps, "isAdmin" | "getPool" | "notifyAdmins"> & {
  /** The module-local singletons the erasure sweep needs. See server/lib/erasure.ts. */
  erasureDeps: ErasureDeps;
};

/**
 * The order areas appear on the tab: this report's own trouble first, because
 * an area it could not read makes everything else less certain, then the order
 * the job reads them in. The repo sorts by source KEY, which is alphabetical
 * and means nothing to a founder.
 */
const AREA_ORDER = [REPORT_SOURCE, ...Object.keys(SOURCE_LABELS).filter((source) => source !== REPORT_SOURCE)];
const areaRank = (source: string) => {
  const rank = AREA_ORDER.indexOf(source);
  return rank === -1 ? AREA_ORDER.length : rank;
};

/** One item as the tab reads it. Ages come from the database's clock, never from a Date. */
const present = (item: FailedItem) => ({
  area: labelFor(item.source),
  source: item.source,
  // Opaque within its source: an order, a ballot, a job name. Never a member.
  key: item.key,
  title: item.title,
  advice: item.advice,
  lastError: item.lastError,
  failingForSeconds: item.ageSeconds,
  resolvedSecondsAgo: item.resolvedAgeSeconds,
});

export function register(app: Express, deps: Deps): void {
  // The pool is read when the job RUNS, never when it is registered: this runs
  // during boot, before the pool is guaranteed to be the one the village uses.
  registerJob(FAILED_ACTIONS_JOB, FAILED_ACTIONS_EVERY_MS, () =>
    runFailedActions({
      pool: deps.getPool(),
      sources: defaultSources(deps.getPool()),
      retries: [(deadline) => resumeClosedErasures(deps.getPool(), deps.erasureDeps, deadline)],
      notifyAdmins: deps.notifyAdmins,
    }),
  );

  app.get("/api/admin/failures", async (req, res) => {
    if (!(await deps.isAdmin(req))) {
      return res.status(401).json({ error: "auth_required", message: "Sign in as an admin to read this report." });
    }
    try {
      const pool = deps.getPool();
      const [open, resolved, jobs] = await Promise.all([openItems(pool), recentlyResolved(pool, 7), scheduledJobRows(pool)]);
      const job = jobs.find((j) => j.job === FAILED_ACTIONS_JOB) ?? null;
      res.json({
        // A stable sort, so within one area the repo's oldest-first order holds.
        open: open.slice().sort((a, b) => areaRank(a.source) - areaRank(b.source)).map(present),
        resolved: resolved.map(present),
        blindSpots: BLIND_SPOTS,
        job: {
          everyMinutes: FAILED_ACTIONS_EVERY_MS / 60000,
          schedulerEnabled: schedulerEnabled(),
          lastRunSecondsAgo: job?.sinceLastRunSeconds ?? null,
          lastResult: job?.lastResult ?? null,
        },
      });
    } catch (e: any) {
      // An error, never an empty report. "Nothing is failing" and "the report
      // could not be read" must not look alike to the person reading it.
      res.status(500).json({
        error: "failures_unavailable",
        message: "The report could not be read.",
        detail: String(e?.message ?? e).slice(0, 200),
      });
    }
  });
}
