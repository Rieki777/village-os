/**
 * The members this village half-erased, and the button that finishes it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * There are two ways to be half-erased and they have nothing to do with each
 * other, so this queue answers about both.
 *
 * ONE: A STORE OUTSIDE THIS VILLAGE DID NOT CONFIRM.
 * `forgetMemberEverywhere` retires a departing member's subject reference only
 * when every connected store confirmed the deletion. When one does not confirm
 * the mapping is KEPT, deliberately: rule 2 of `server/lib/memberDrivers.ts`
 * says the village keeps owing that member a confirmation, and chasing it later
 * means asking about them again, which needs the reference to still resolve.
 *
 * That leaves a state with nobody watching it. "Kept because we still owe you a
 * confirmation" becomes "kept forever" the first time a vendor goes dark and
 * never answers, and the decision then belongs to a third party's silence
 * rather than to anybody here.
 *
 * TWO: THE SWEEP IN THIS DATABASE STOPPED PART WAY.
 * `anonymizeMember` is a sequence of about twenty writes that cannot be one
 * transaction (its header says why at length). A dropped connection or a deploy
 * restarting the process leaves some tables scrubbed and some not. Until 0195
 * that left NOTHING recording it, which is the worse of the two failures: the
 * outside case at least had a row somewhere. `member_erasures` records the
 * sweep, and this queue is where somebody sees it and ends it.
 *
 * A departed member the village half-erased, indefinitely, invisibly, is the
 * shape of honest-looking failure this codebase keeps producing: nothing is
 * wrong, nothing is red, and nobody can see it.
 *
 * ── WHY A RETRY AND NOT ONLY A COUNT ─────────────────────────────────────
 *
 * A counter with no way to act is a dashboard rather than a fix. The obvious
 * design says the state clears "when a later attempt succeeds", and the
 * question that breaks it is: what causes a later attempt? Nothing will erase
 * these members a second time, because they are already gone. So the re-ask has
 * to be something somebody presses, and it lives on the same screen as the
 * number, because the person reading the count is the person who wants to press
 * it. A scheduled job can come later, once anyone has watched this work.
 *
 * ── WHY /review AND NOT THE ADMIN PANEL ──────────────────────────────────
 *
 * `intake.moderate` reads "work the village's queues and act on what gets
 * reported", and a member the village half-erased is exactly an item in a queue
 * somebody has to work. Putting it here also keeps it off `isAdmin`, which is
 * the property that made the review surface worth building: a steward who keeps
 * the queues without holding the whole admin panel is who this is for.
 *
 * ── WHAT THIS ROUTE NEVER SAYS ───────────────────────────────────────────
 *
 * A member id, a name, an email. It says the village owes somebody something,
 * how old the debt is and which store or which STEP is holding it, and not who.
 * That rule survived the second queue being added to this file: the unfinished
 * sweeps are counted and their failing steps are tallied, and neither payload
 * carries a person.
 */
import type { Express } from "express";
import type { Pool } from "mysql2/promise";
import type { AppDeps } from "../lib/appDeps";
import { forgetMemberEverywhere } from "../lib/memberDrivers";
import { resumeErasure, type ErasureDeps } from "../lib/erasure";
import { countUnfinishedErasures, unfinishedErasures } from "../repos/memberErasure";
import { halfErasedMembers, pendingErasureUserIds } from "../lib/subjectRefs";

type Deps = Pick<AppDeps, "guardCapability" | "getPool"> & {
  /** The module-local singletons the sweep cannot import. See server/lib/erasure.ts. */
  erasureDeps: ErasureDeps;
};

/**
 * The unfinished local sweeps, counted and tallied, naming nobody.
 *
 * The COUNT comes from the database and never from `rows.length`. The row read
 * is capped so one press does bounded work, so a village past that cap would
 * otherwise be told the page size, and a number that silently stops rising is
 * worse than no number.
 */
async function unfinishedSweeps(pool: Pool) {
  const rows = await unfinishedErasures(pool);
  const stoppedAt: Record<string, number> = {};
  for (const r of rows) {
    // A sweep that was killed rather than thrown has no failing step, and
    // saying so is the point: "we do not know where it stopped" is a different
    // and worse state than "it stopped at portraits", and reporting the two as
    // one would hide the difference.
    const key = r.failedStep ?? "unknown";
    stoppedAt[key] = (stoppedAt[key] ?? 0) + 1;
  }
  return {
    count: await countUnfinishedErasures(pool),
    oldestSince: rows[0]?.startedAt ?? null,
    stoppedAt,
  };
}

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool, erasureDeps } = deps;

  /**
   * How many obligations are outstanding, who they are waiting on, and how old
   * the oldest is. Both kinds, under their own keys, because "three members are
   * waiting on a vendor" and "three members' sweeps died at the portrait step"
   * are different problems with different answers.
   *
   * `external` holds the shape this route has always returned, so a reader
   * built against it keeps working.
   */
  app.get("/api/review/erasure", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      const pool = getPool();
      const external = await halfErasedMembers(pool);
      res.json({ ...external, external, local: await unfinishedSweeps(pool) });
    } catch (e: any) {
      // An error, never an empty count. Zero outstanding obligations and a
      // failed read look identical to a reader, and one of them is a village
      // being told it owes nobody anything.
      res.status(500).json({ error: "erasure_queue_unavailable", detail: String(e?.message ?? e).slice(0, 200) });
    }
  });

  /**
   * Finish what is outstanding, oldest obligation first.
   *
   * THE LOCAL SWEEPS GO FIRST, and the order is the same one `anonymizeMember`
   * keeps for the same reason: the deletion this deployment fully controls is
   * not made to wait behind a vendor that may not answer for thirty seconds.
   *
   * Each member goes back through the same path their erasure took, so a store
   * that now confirms retires the mapping exactly as it would have at the time,
   * and one that still does not is left recorded with its original date. The
   * age never resets, because an obligation that looks new every time somebody
   * tries is one nobody ever escalates.
   *
   * ONE MEMBER'S FAILURE DOES NOT END THE PASS. A resume that throws again is
   * caught, counted, and the loop moves on: the whole point of the queue is
   * that several members can be outstanding at once, and letting the first
   * stubborn one abort the run would leave every member behind it untouched
   * while the response still looked like a retry had happened.
   */
  app.post("/api/review/erasure/retry", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const pool = getPool();
    try {
      const stalled = await unfinishedErasures(pool);
      let swept = 0;
      let stillStuck = 0;
      for (const row of stalled) {
        try {
          const out = await resumeErasure(pool, row.userId, erasureDeps);
          if (out.finished) swept += 1;
          else stillStuck += 1;
        } catch {
          // `resumeErasure` has already recorded which step failed and what it
          // said, which is the durable half. Nothing useful is lost here.
          stillStuck += 1;
        }
      }

      const ids = await pendingErasureUserIds(pool);
      let finished = 0;
      for (const userId of ids) {
        const out = await forgetMemberEverywhere(pool, userId);
        if (out.unconfirmed.length === 0) finished += 1;
      }
      // Every number, because "we asked about 9 and finished 2" is the honest
      // report and "2 finished" alone reads as though 2 was all there was.
      res.json({
        asked: ids.length,
        finished,
        resumed: stalled.length,
        swept,
        stillStuck,
        remaining: await halfErasedMembers(pool),
        local: await unfinishedSweeps(pool),
      });
    } catch (e: any) {
      res.status(500).json({ error: "retry_failed", detail: String(e?.message ?? e).slice(0, 200) });
    }
  });
}
