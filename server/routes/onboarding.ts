/**
 * Onboarding routes: `/api/onboarding/**`, "Your first moons in <role>".
 *
 *   GET   /api/onboarding/me                         the paths the member is part of
 *   POST  /api/onboarding/paths/:id/items/:key/done   tick a step they may tick
 *   POST  /api/onboarding/paths/:id/checkins/:day     the holder files a day 30, 60 or 90 check-in
 *
 * Every door needs a signed-in member. A check-in is served only to the holder,
 * the buddy and the holder of the village's onboarding role (server/lib/onboarding.ts);
 * anybody else, an admin included, is answered as if the path did not exist.
 */
import type { Express, Request, Response } from "express";
import type { Pool } from "mysql2/promise";
import type { AppDeps } from "../lib/appDeps";
import { hasOpenOnboardingItems, dayIn, fileCheckin, servePaths, tick, type OnboardingEnv } from "../lib/onboarding";
import { roleHasCompanion } from "../lib/companions";
import { stringVar } from "../lib/variables";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit"> & { village: () => { timeZone: string } };

const consentedBy = () => {
  const scope = stringVar("companions.role_ids");
  return (orgRoleId: string) => roleHasCompanion(scope, orgRoleId);
};

/** For the Trail: re-exported so server/index.ts reaches it on its one exempt import line for this module. */
export async function onboardingOpenFor(pool: Pool, userId: string): Promise<boolean> {
  return hasOpenOnboardingItems(pool, userId, consentedBy());
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, village } = deps;
  const env = (): OnboardingEnv => ({ db: getPool(), today: dayIn(new Date(), village().timeZone || "UTC"), consented: consentedBy() });

  const member = async (req: Request, res: Response): Promise<string | null> => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required", message: "Sign in first" });
      return null;
    }
    return String(user.id);
  };

  app.get("/api/onboarding/me", async (req, res) => {
    const me = await member(req, res);
    if (!me) return;
    res.json({ paths: await servePaths(env(), me) });
  });

  app.post("/api/onboarding/paths/:id/items/:key/done", async (req, res) => {
    const me = await member(req, res);
    if (!me) return;
    if (await overLimit(`onboarding-tick:${me}`, 60, 60 * 60 * 1000)) return void res.status(429).json({ error: "Slow down a little and try again." });
    const r = await tick(env(), me, String(req.params.id), String(req.params.key));
    if (!r.ok) return void res.status(r.status).json({ error: r.error });
    res.json({ ok: true, paths: await servePaths(env(), me) });
  });

  app.post("/api/onboarding/paths/:id/checkins/:day", async (req, res) => {
    const me = await member(req, res);
    if (!me) return;
    if (await overLimit(`onboarding-checkin:${me}`, 20, 60 * 60 * 1000)) return void res.status(429).json({ error: "Slow down a little and try again." });
    const r = await fileCheckin(env(), me, String(req.params.id), Number(req.params.day), req.body);
    if (!r.ok) return void res.status(r.status).json({ error: r.error });
    res.json({ ok: true, paths: await servePaths(env(), me) });
  });
}
