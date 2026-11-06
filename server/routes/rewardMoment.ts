/**
 * The reward moment over HTTP (0294).
 *
 *   GET  /api/me/reward-moment       what landed for me that I have not been shown
 *   POST /api/me/reward-moment/seen  I have been shown these; never show them again
 *
 * IN THEIR OWN MODULE, for the reason server/routes/cashOwed.ts gives:
 * server/index.ts is on a ratchet, and a route module's import and register
 * call are the lines it exempts.
 *
 * NOT A MODULE THAT SHIPS OFF. What it reads is what quests, roles and
 * proposals pay, and those are core, so a village with nothing paid yet simply
 * has an empty moment.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { markRewardMomentSeen, pendingRewardMoment } from "../lib/rewardMoment";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit } = deps;

  app.get("/api/me/reward-moment", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    res.json(await pendingRewardMoment(getPool(), user.id));
  });

  app.post("/api/me/reward-moment/seen", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    if (await overLimit(`reward-seen:${user.id}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many requests at once. Try again in a while." });
    }
    const recorded = await markRewardMomentSeen(getPool(), user.id, req.body?.keys);
    res.json({ success: true, recorded });
  });
}
