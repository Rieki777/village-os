/**
 * TWO DOORS A FOUNDER HAS AND DID NOT USED TO.
 *
 * ── ASK THE VILLAGE NOW ──────────────────────────────────────────────────────
 *
 * The `moon-proposal` job asks on its own, hourly, and refuses to ask twice
 * about a moon the village has already answered. `settlementProposalDecision`
 * is deliberate about that: a vote that FAILED is never re-posted by a machine,
 * because a machine that asks again until it gets the answer it wants is not
 * conducting a vote, and a moon that went unanswered twice stops being asked
 * about for the same reason.
 *
 * Both of those leave a moon parked, and a village needs a way out of a park
 * that is not "wait for the next release". This is that way, and it is a PERSON
 * pressing it, which is the only hand allowed to overrule a machine's restraint.
 * It opens exactly the ballot the job would have opened, on the same frozen
 * split, so the door is a trigger and never a second mechanism.
 *
 * ── LAND WHAT IS DUE ─────────────────────────────────────────────────────────
 *
 * `applyDueGovernance` had two callers, and neither could be reached by hand: a
 * five-minute job, and the tail of the cycle close. A founder whose scheduler
 * was off had no way to land a decision the village had already carried except
 * to settle a cycle, which is a much larger act with its own consequences and
 * which they may have no reason to want.
 *
 * It is also what makes the settlement ballot PROVABLE. The established idiom
 * in the e2e suites is to land a decision by calling the cycle close, and for
 * every other subject that is harmless. For this one it is not: the close
 * settles due cycles on its own, first, so a test that landed a settlement
 * ballot that way would watch the BUTTON pay and never learn whether the vote
 * would have. A test whose assertion cannot distinguish the path it is testing
 * from the path it is not is a test that defends whatever it finds.
 */
import type express from "express";

import type { AppDeps } from "../lib/appDeps";
import type { ProposalRun } from "../lib/moonProposal";

type Deps = Pick<AppDeps, "isAdmin"> & {
  /** One tick of the moon proposer, on demand. */
  runProposal: () => Promise<ProposalRun>;
  /** One pass of the landing routine, and nothing else. */
  landDue: () => Promise<unknown>;
};

export function registerMoonSettlementRoutes(app: express.Express, deps: Deps): void {
  app.post("/api/admin/cycles/settlement-proposal", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const r = await deps.runProposal();
    /*
     * 200 EITHER WAY, because "nothing needed asking" is an answer and not a
     * failure. `posted` carries the fact and `why` carries the sentence, so a
     * desk can say "the village is already voting on cycle 331" instead of
     * showing an error for a system working correctly.
     */
    res.json(r);
  });

  app.post("/api/admin/governance/land-due", async (req, res) => {
    if (!(await deps.isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ landing: await deps.landDue() });
  });
}
