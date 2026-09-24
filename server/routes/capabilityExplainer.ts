/**
 * WHY CAN THIS PERSON DO THAT: the capability explainer, moved here whole.
 *
 *   GET /api/admin/members/:id/capabilities
 *
 * MOVED BYTE FOR BYTE out of server/index.ts, comments and all, and nothing
 * about what it answers changed in the move. It was picked for the move
 * because of what it does NOT touch: it reads the gate and the member, writes
 * nothing, and closes over four things, so it is the cheapest route in that
 * file to give a boundary to.
 *
 * WHY IT MOVED AT ALL, said plainly rather than left to be guessed. The lane
 * that moved it added a subject to the close dispatcher and four one-line
 * fields to routes that live in that file, and the monolith ratchet had been
 * lowered to exactly what the composed tree measured. The ratchet is a
 * one-way street by design and the way to pay for a line in that file is to
 * take lines out of it. So this is the payment, and the file is smaller than
 * it was rather than larger.
 *
 * The explainer READS the decision rather than guessing at it, which is the
 * whole of its comment below and the reason it cannot drift from the gate.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import {
  ALL_CAPABILITIES,
  capabilityDecision,
  STAGE_UNLOCKS,
  TRANSFERABLE,
} from "../../shared/capabilities";

type Deps = Pick<AppDeps, "isAdmin" | "members" | "capabilityCtx" | "stageOf">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, members, capabilityCtx, stageOf } = deps;
  /**
   * P8 (Wave 1): why can this person do that?
   *
   * The gate now answers from five sources (admin, badge denies, roles,
   * badge grants, stage) and the honest failure mode is FOG: an admin
   * cannot see which one decided. This runs the real `hasCapability` for
   * every capability and reports the DECIDING source alongside the answer,
   * so a surprising permission has a traceable cause instead of a shrug.
   */
  app.get("/api/admin/members/:id/capabilities", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const target = await members.byId(String(req.params.id));
    if (!target) return res.status(404).json({ error: "No such member" });
    const ctx = await capabilityCtx(target);
    // 0098: the ladder is no longer re-implemented here. It used to be, under
    // a comment admitting that "if that order ever changes, this explanation
    // lies", and the gate's order changed in this very commit. `hasCapability`
    // is now a projection of `capabilityDecision`, which reports the deciding
    // step, so the explainer READS the decision instead of guessing at it and
    // the two cannot drift.
    const rows = ALL_CAPABILITIES.map((cap) => {
      const decision = capabilityDecision(cap, ctx);
      // The rung the GATE compared against, `capabilityDecision`'s own
      // expression: a village that moved a rung was told the platform's.
      const rung = ctx.stageUnlockOverrides?.[cap] ?? STAGE_UNLOCKS[cap];
      const source =
        decision.source === "stage" ? `stage (${rung ?? "?"})` : decision.source;
      return {
        capability: cap,
        held: decision.allowed,
        source,
        // What the village holds, so an admin reading "not granted" on a key
        // they used to pass can see WHY rather than filing a bug.
        villageHolds: decision.villageHolds,
        transferable: TRANSFERABLE[cap] === true,
      };
    });
    res.json({
      member: { id: target.id, name: target.name, role: target.role },
      stage: await stageOf(target),
      roles: ctx.roleCapabilities,
      badgeGrants: ctx.badgeCapabilities,
      badgeDenies: ctx.badgeDenies,
      villageHeld: ctx.villageHeld,
      capabilities: rows,
    });
  });
}
