/**
 * The members this village half-erased, and the button that finishes it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `forgetMemberEverywhere` retires a departing member's subject reference only
 * when every connected store confirmed the deletion. When one does not confirm
 * the mapping is KEPT, deliberately: rule 2 of `server/lib/memberDrivers.ts`
 * says the village keeps owing that member a confirmation, and chasing it later
 * means asking about them again, which needs the reference to still resolve.
 *
 * That leaves a state with nobody watching it. "Kept because we still owe you a
 * confirmation" becomes "kept forever" the first time a vendor goes dark and
 * never answers, and the decision then belongs to a third party's silence
 * rather than to anybody here. A departed member whose link the village holds
 * indefinitely, invisibly, is the shape of honest-looking failure this codebase
 * keeps producing: nothing is wrong, nothing is red, and nobody can see it.
 *
 * ── WHY A RETRY AND NOT ONLY A COUNT ─────────────────────────────────────
 *
 * A counter with no way to act is a dashboard rather than a fix. The obvious
 * design says the mapping clears "when a later attempt confirms", and the
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
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { forgetMemberEverywhere } from "../lib/memberDrivers";
import { halfErasedMembers, pendingErasureUserIds } from "../lib/subjectRefs";

type Deps = Pick<AppDeps, "guardCapability" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { guardCapability, getPool } = deps;

  /**
   * How many obligations are outstanding, who they are waiting on, and how old
   * the oldest is. Never a member id and never a name: this route says that the
   * village owes somebody something, and not who.
   */
  app.get("/api/review/erasure", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    try {
      res.json(await halfErasedMembers(getPool()));
    } catch (e: any) {
      // An error, never an empty count. Zero outstanding obligations and a
      // failed read look identical to a reader, and one of them is a village
      // being told it owes nobody anything.
      res.status(500).json({ error: "erasure_queue_unavailable", detail: String(e?.message ?? e).slice(0, 200) });
    }
  });

  /**
   * Ask every unconfirmed store again, oldest obligation first.
   *
   * Each member goes back through the same path their erasure took, so a store
   * that now confirms retires the mapping exactly as it would have at the time,
   * and one that still does not is left recorded with its original date. The
   * age never resets, because an obligation that looks new every time somebody
   * tries is one nobody ever escalates.
   */
  app.post("/api/review/erasure/retry", async (req, res) => {
    if (!(await guardCapability(req, res, "intake.moderate"))) return;
    const pool = getPool();
    try {
      const ids = await pendingErasureUserIds(pool);
      let finished = 0;
      for (const userId of ids) {
        const out = await forgetMemberEverywhere(pool, userId);
        if (out.unconfirmed.length === 0) finished += 1;
      }
      // Both numbers, because "we asked about 9 and finished 2" is the honest
      // report and "2 finished" alone reads as though 2 was all there was.
      res.json({ asked: ids.length, finished, remaining: await halfErasedMembers(pool) });
    } catch (e: any) {
      res.status(500).json({ error: "retry_failed", detail: String(e?.message ?? e).slice(0, 200) });
    }
  });
}
