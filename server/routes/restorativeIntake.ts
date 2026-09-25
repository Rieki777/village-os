/**
 * The restorative intake: a member's private path to raise a harm.
 *
 *   POST /api/exit/restorative-intake   { message }  -> { success, reached }
 *
 * Lifted out of server/index.ts on 2026-09-24 with its logic in
 * server/lib/restorativeIntake.ts, whose header says what changed and why:
 * the title names no one, the email for this kind carries the title alone,
 * only live holders of the intake role are reached, and the link opens a page
 * every member can open.
 *
 * REGISTERED WHERE IT WAS. `register()` is called from startServer at exactly
 * the point this route used to occupy, because Express matches in
 * registration order.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { sendRestorativeIntake, type IntakeDeps } from "../lib/restorativeIntake";

type Deps = Pick<AppDeps, "authedUser" | "notify" | "overLimit"> & Pick<IntakeDeps, "readExitPolicy" | "roleHolders">;

export function register(app: Express, deps: Deps): void {
  app.post("/api/exit/restorative-intake", async (req, res) => {
    const user = await deps.authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required", message: "Sign in first" });
    const answer = await sendRestorativeIntake(deps, user, req.body?.message);
    res.status(answer.status).json(answer.body);
  });
}
