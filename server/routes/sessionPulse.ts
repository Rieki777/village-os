/**
 * Live Sessions over HTTP: a circle's season. The door is in
 * shared/sessionPulse.ts, the contract, and the rule behind it is
 * server/lib/sessionPulse.ts:
 *
 *   GET /api/sessions/circles/:circleId/pulse    CirclePulse
 *
 * BEHIND THE ROOM'S OWN GATES: server/routes/sessionDecisions.ts registers
 * this module (server/index.ts has no room for another counted line), after
 * server/routes/liveSessions.ts, so the module gate and the members-only gate
 * on `/api/sessions` stand in front of it, and this module mounts the module
 * gate on its own prefix too. It takes five segments beginning `circles`, so
 * it is never read as a room's.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { requireModule } from "../lib/modules";
import { circlePulse, type PulseDeps } from "../lib/sessionPulse";
import { liveCircles } from "./sessionRhythm";
import { CIRCLES_API } from "../../shared/sessionRhythm";

/** What this module touches: who is asking, which circles are live, and whose role terms still run. */
type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "circlesRepo" | "lapseContext">;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, circlesRepo } = deps;
  const pulse: PulseDeps = { circles: () => liveCircles(circlesRepo), lapseContext: deps.lapseContext };

  app.use(`${CIRCLES_API}/:circleId/pulse`, requireModule("sessions"));

  app.get(`${CIRCLES_API}/:circleId/pulse`, async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const circleId = String(req.params?.circleId ?? "").slice(0, 64);
    const out = await circlePulse(getPool(), { userId: String(user.id), admin: await isAdmin(req) }, circleId, pulse);
    res.setHeader("Cache-Control", "private, no-cache");
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json(out.value);
  });
}
