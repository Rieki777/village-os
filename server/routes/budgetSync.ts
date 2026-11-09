/**
 * SYNC BUDGET, THE SCHEDULE AND THE ON-OPEN READ (budgets spec R19, PR 2).
 *
 *   POST /api/admin/budgets/sync/:source   a door holder reads a source now
 *
 * Registered by `server/routes/budgets.ts`, which hands in the budget's one
 * door (R21): only the people who keep the budget press Sync budget, and a
 * refusal is the door's own. The press reads the source whether its switch is
 * on or off; off, what it reads lands waiting and counts for nothing. The
 * same registration plugs Sera into the budget's source registry
 * (`registerBudgetSource`), registers the schedule's job, and hands back
 * `opened()`, which the member read of the budget calls once it has answered,
 * to queue the on-open read without waiting on it.
 *
 * Everything Sera-specific sits behind the saberra module: the press passes
 * `requireModule("saberra")` first, and the schedule and the on-open read ask
 * the module's lifecycle themselves (server/lib/saberraBudgets.ts).
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import { budgetSource, registerBudgetSource } from "../lib/budgets";
import { requireModule } from "../lib/modules";
import { SERA_BUDGETS_JOB, onBudgetsOpened, pullSeraBudgets, scheduledSeraBudgets, type SeraBudgetRead, type SeraBudgetState } from "../lib/saberraBudgets";
import { registerJob, TICK_MS } from "../lib/scheduler";

export interface BudgetSyncDeps {
  getPool(): Pool;
  /** The budget's one door (R21). It answers its own refusal and returns null; it marks the admin gate. */
  doorFor(req: any, res: any): Promise<{ uid: string; byAs: string } | null>;
  overLimit(key: string, max: number, windowMs: number): Promise<boolean>;
}

/** A press calls the service, so it is bounded on its own, apart from the budget's writes. */
const PRESSES_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60 * 1000;

/** How each state answers a press. Not offered, cut short and empty are answers, never errors. */
const STATUS: Readonly<Record<SeraBudgetState, number>> = {
  module_off: 404,
  off: 409,
  busy: 409,
  not_connected: 409,
  not_offered: 200,
  failed: 502,
  cut_short: 200,
  empty: 200,
  whole: 200,
};

/** What a press is answered: the read's state and counts, the import's changes, never a spent figure. */
export function syncAnswer(r: SeraBudgetRead) {
  const x = r.result;
  return {
    state: r.state,
    message: r.message,
    landed: r.ok,
    whole: r.whole,
    records: r.records,
    refused: r.refused,
    dropped: r.dropped,
    turnedOff: r.turnedOff,
    added: x?.added.length ?? 0,
    changed: x?.changed.length ?? 0,
    unchanged: x?.unchanged ?? 0,
    withdrawn: x?.withdrawn ?? [],
    refusals: (x?.refused ?? []).map(({ row, cell, reason, message }) => ({ row, cell, reason, message })),
    flags: (x?.flags ?? []).map(({ row, cell, kind, message }) => ({ row, cell, kind, message })),
    stillListed: x?.stillListed ?? [],
    lineChanges: x?.lineChanges ?? [],
    moonChanges: x?.moonChanges ?? [],
    swing: x?.swing ?? false,
    shareBefore: x?.shareBefore ?? null,
    shareAfter: x?.shareAfter ?? null,
    syncId: x?.syncId ?? null,
  };
}

export function register(app: Express, deps: BudgetSyncDeps): { opened(): void } {
  registerBudgetSource("sera", async ({ pool, by }) => {
    const r = await pullSeraBudgets({ pool, by, byAs: null, trigger: "press" });
    return { ok: r.ok, state: r.state, message: r.message ?? undefined };
  });
  // Every tick, the way the structure sync's poll runs: the job decides whether anything is due, and a source
  // that is off, or a schedule set to off, reads nothing. The pool is read when the job runs.
  registerJob(SERA_BUDGETS_JOB, TICK_MS, () => scheduledSeraBudgets(deps.getPool()));
  const seraModule = requireModule("saberra");

  app.post("/api/admin/budgets/sync/:source", async (req, res) => {
    const source = String(req.params?.source ?? "");
    if (!budgetSource(source)) return res.status(404).json({ error: "unknown_source", message: "There is no budget source by that name." });
    if (source === "sera") {
      // Sera-specific, so behind the module (R19): off answers exactly what the module gate answers everywhere.
      let through = false;
      let failed: unknown = null;
      await seraModule(req, res, (err?: unknown) => {
        if (err) failed = err;
        else through = true;
      });
      if (failed) throw failed;
      if (!through) return;
    }
    const w = await deps.doorFor(req, res);
    if (!w) return;
    if (await deps.overLimit(`budget-sync:${w.uid}`, PRESSES_PER_WINDOW, WINDOW_MS)) {
      return res.status(429).json({ error: "too_many", message: "That is a lot of budget reads in a few minutes. Wait a little and try again." });
    }
    const out = await pullSeraBudgets({ pool: deps.getPool(), by: w.uid, byAs: w.byAs, trigger: "press" });
    res.status(STATUS[out.state]).json(syncAnswer(out));
  });

  return {
    opened: () => {
      void onBudgetsOpened(deps.getPool()).catch(() => undefined);
    },
  };
}
