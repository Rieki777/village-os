/**
 * The admin surface for which character suits which power.
 *
 *   GET /api/admin/power-affinity        every power the village entrusts, the
 *                                        classes each one suits here, and what
 *                                        the platform suggests
 *   PUT /api/admin/power-affinity/:key   { classes: string[] | null }, for one power
 *
 * The rules live in shared/powerAffinity.ts and the reading and writing in
 * server/lib/powerAffinity.ts. This file only asks who is allowed.
 *
 * ── THE GATES ──────────────────────────────────────────────────────────────
 *
 * The same pair `server/routes/archetypes.ts` uses, on purpose: the read takes
 * `isAdmin` and the write takes `story.tell`. Which powers suit a class is part
 * of what the class IS to this village, and `/api/archetypes/:key/paths` serves
 * it to anybody at the front door beside the class's own words. The editor sits
 * in the same panel as those words, so whoever can reword The Architect can say
 * what The Architect is suited to.
 *
 * A suggestion permits nothing. The capability gate never reads the map, so
 * this gate being wrong would put the wrong hint in front of a member and could
 * never hand anybody a power.
 *
 * ── ONE POWER PER REQUEST ──────────────────────────────────────────────────
 *
 * The key rides in the path and the body carries that one power's classes, so a
 * save touches exactly the power the founder pressed save on. A whole-map PUT
 * would let a stale screen write every other power back as it stood when the
 * page loaded, over whatever somebody else saved in between.
 */
import type { Express } from "express";
import type { Capability } from "../../shared/capabilities";
import { affinityEditProblem } from "../../shared/powerAffinity";
import type { AppDeps } from "../lib/appDeps";
import { listArchetypes } from "../lib/characters";
import { villageId } from "../lib/economy";
import { affinityForAdmin, saveAffinityEdit } from "../lib/powerAffinity";

/*
 * The two member-facing reads are re-exported from here, so `server/index.ts`
 * reaches this whole surface through one import of this route module. The
 * server-index ratchet exempts exactly that shape of line, and a second import
 * of the lib would be a line the file may not grow by.
 */
export { powersForClass, withPowerAffinity } from "../lib/powerAffinity";

type Deps = Pick<AppDeps, "isAdmin" | "guardCapability" | "getPool">;

export function register(app: Express, deps: Deps): void {
  const { isAdmin, guardCapability, getPool } = deps;

  app.get("/api/admin/power-affinity", async (req, res) => {
    if (!(await isAdmin(req))) {
      return res.status(401).json({
        error: "auth_required",
        message: "Sign in as an admin to see which classes suit which powers.",
      });
    }
    res.json(await affinityForAdmin(getPool(), villageId()));
  });

  /**
   * One power's classes. `classes` is the whole list for that power, empty for
   * none, or null to follow the platform's suggestion again. A body with no
   * `classes` at all is refused, so a truncated request can never read as a
   * decision that the power suits nobody.
   */
  app.put("/api/admin/power-affinity/:key", async (req, res) => {
    if (!(await guardCapability(req, res, "story.tell"))) return;
    const key = String(req.params.key ?? "").trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const classes = Object.prototype.hasOwnProperty.call(body, "classes") ? body.classes : undefined;
    const cast = await listArchetypes(getPool(), villageId());
    const problem = affinityEditProblem(key, classes, cast.map((a) => a.key));
    if (problem) return res.status(400).json({ error: problem });

    const decided = classes === null ? null : (classes as unknown[]).map((k) => String(k).trim());
    await saveAffinityEdit(getPool(), key as Capability, decided);
    res.json({ success: true, ...(await affinityForAdmin(getPool(), villageId())) });
  });
}
