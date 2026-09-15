/**
 * The scheduler host (S17): ONE mechanism, deliberately.
 *
 * regen-civics ran two overlapping systems — in-process setInterval timers
 * AND external HTTP crons — with no locks, cadence truth scattered across
 * comments and a dashboard, and a "nightly" cron that silently ran 4 of the
 * 10 steps its comment promised. This host is the opposite: a registry in
 * code, a ledger in the database, and a single claim rule.
 *
 * How a job runs: every tick (5 min), each registered job checks its
 * scheduled_jobs row; if enough time has passed, ONE process claims it with
 *   UPDATE scheduled_jobs SET last_run_at = NOW()
 *   WHERE job = ? AND (last_run_at IS NULL OR last_run_at <= ?)
 * — affectedRows says who won. Restart-safe (the ledger is the DB, not the
 * interval), multi-process-safe (the UPDATE is the lock), and drift-free
 * enough for daily work (a job runs when DUE, not N ms after boot).
 *
 * WHAT THIS HOST WILL NEVER DO — written down so nobody "helpfully" adds it:
 *  - It does NOT close gratitude cycles. Settlement releases value and no job
 *    here may release value. There are exactly two ways a moon is settled and
 *    a person is in both of them: a founder pressing Close
 *    (POST /api/admin/cycles/close), or the village passing a ballot.
 *
 *    The `moon-proposal` job is not an exception to this and must not be read
 *    as one. Its whole power is to ASK: it notices a lunation ended, writes
 *    down what each member would receive, and OPENS A BALLOT. It cannot close
 *    a cycle, it cannot post to the ledger, and it never decides. The
 *    settlement itself runs from the closer registered for `cycle_settlement`,
 *    which the landing routine calls only after the village has voted the
 *    decision through and the steward's window has run. See
 *    shared/moonSettlement.ts for the ruling this keeps (Rye, 2026-09-05:
 *    every human is in charge of minting value, and the foundation for
 *    automating it later must not be automation today).
 *  - It does NOT roll seasons. Season rollover is compute-on-read by design;
 *    migrating it here would re-introduce the stale-banner bug it fixed.
 */
import type { Pool } from "mysql2/promise";
import { reportError } from "./errors";

interface Job {
  name: string;
  everyMs: number;
  fn: () => Promise<string | void>;
}

const jobs: Job[] = [];
let timer: NodeJS.Timeout | null = null;

export const TICK_MS = 5 * 60 * 1000;

export function registerJob(name: string, everyMs: number, fn: () => Promise<string | void>) {
  jobs.push({ name, everyMs, fn });
}

async function tick(pool: Pool) {
  for (const job of jobs) {
    try {
      await pool.query("INSERT IGNORE INTO scheduled_jobs (job) VALUES (?)", [job.name]);
      const due = new Date(Date.now() - job.everyMs);
      const [r]: any = await pool.query(
        "UPDATE scheduled_jobs SET last_run_at = NOW() WHERE job = ? AND (last_run_at IS NULL OR last_run_at <= ?)",
        [job.name, due],
      );
      if (!r.affectedRows) continue; // not due, or another process claimed it
      const started = Date.now();
      try {
        const result = await job.fn();
        const summary = `ok in ${Date.now() - started}ms${result ? `: ${result}` : ""}`.slice(0, 255);
        await pool.query("UPDATE scheduled_jobs SET last_result = ? WHERE job = ?", [summary, job.name]);
        console.log(`[scheduler] ${job.name} ${summary}`);
      } catch (e: any) {
        const summary = `FAILED: ${String(e?.message ?? e)}`.slice(0, 255);
        await pool.query("UPDATE scheduled_jobs SET last_result = ? WHERE job = ?", [summary, job.name]);
        // A job that fails every hour used to write the same row and print
        // the same line to a log nobody reads. These are the jobs that settle
        // library loans, sweep abandoned checkouts and relay feedback — a
        // silent one is a village quietly losing a service it thinks it has.
        await reportError(e, { where: `the ${job.name} job`, detail: { job: job.name } });
      }
    } catch (e) {
      console.error(`[scheduler] tick error for ${job.name}`, e);
    }
  }
}

/**
 * Whether this process should run background work at all. ON unless the
 * environment says otherwise, so production, staging and a founder's own
 * instance are unchanged by this existing.
 *
 * WHY THERE IS A SWITCH AT ALL, and why it is not a test-mode gate. The e2e
 * suites spawn the REAL built server, with NODE_ENV=production, because that
 * is the only honest way to test a boot path. So the scheduler arms in them
 * too, and fifteen seconds later every job with no `scheduled_jobs` row runs
 * against the same scratch database the suite is asserting on. That is how the
 * S15 tools flake happened: `tools-link-check` and `PUT /api/admin/tools/:id`
 * are both read-modify-write cycles over the same table, and before 0122 the
 * later one erased the earlier one silently (see server/repos/store-db.ts).
 *
 * The lost update is fixed where it lived, in the store. This switch is the
 * separate problem: a suite of sequential HTTP assertions has no way to
 * observe or order background work, so any job firing mid-suite is a variable
 * nobody controls. `server/loop.e2e.test.ts` sets SCHEDULER_ENABLED=0 for that
 * reason and drives every sweep it cares about through its admin route
 * instead, which is what it already did.
 *
 * WHAT WAS CONSIDERED AND REJECTED: stamping a never-run job as "just ran"
 * when its row is created, so a first boot does not fire every job at once.
 * That is a real improvement for thirteen founder instances booting one image,
 * and it is not this lane's to make, because a test already proves the current
 * behaviour is intended: `server/synthesisBatch.routes.e2e.test.ts` waits for
 * `synthesis-batch-poll` to report a result within 120s, which only happens
 * because the first tick runs a job that has never run. Its real subject is
 * that the job reads its switch when it RUNS rather than when it is
 * registered, and the first tick is how it gets an answer inside a test. That
 * change needs its own lane, its own reasoning about first boot, and a new
 * vehicle for that assertion.
 */
export function schedulerEnabled(): boolean {
  const raw = process.env.SCHEDULER_ENABLED;
  if (raw === undefined || raw === "") return true;
  const v = raw.trim().toLowerCase();
  return !(v === "0" || v === "off" || v === "false" || v === "no");
}

/** Start ticking. First tick runs shortly after boot so due jobs never wait 5 minutes. */
export function startScheduler(pool: Pool) {
  if (timer) return;
  if (!schedulerEnabled()) {
    // Loud, every boot. A village that has this set by accident is a village
    // whose loans never settle and whose feedback never leaves, and the only
    // way anybody finds out is if the process says so out loud.
    console.log(
      `[scheduler] NOT STARTED: SCHEDULER_ENABLED=${process.env.SCHEDULER_ENABLED}. ` +
        `No background job will run in this process. ` +
        `${jobs.length} job(s) are registered and idle: ${jobs.map((j) => j.name).join(", ") || "(none)"}`,
    );
    return;
  }
  setTimeout(() => void tick(pool), 15 * 1000);
  timer = setInterval(() => void tick(pool), TICK_MS);
  // Never hold the process open just to tick.
  timer.unref?.();
  console.log(`[scheduler] started: ${jobs.map((j) => j.name).join(", ") || "(no jobs)"}`);
}

/** For tests and admin visibility. */
export function registeredJobs(): Array<{ name: string; everyMs: number }> {
  return jobs.map(({ name, everyMs }) => ({ name, everyMs }));
}
