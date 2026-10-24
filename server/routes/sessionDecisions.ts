/**
 * Live Sessions over HTTP: a circle's decisions and their review dates. Every
 * door is the "Doors" list in shared/sessionDecisions.ts, the contract, and
 * every rule behind a door is server/lib/sessionDecisions.ts:
 *
 *   GET /api/sessions/circles/:circleId/decisions                    CircleDecisionLog
 *   PUT /api/sessions/circles/:circleId/decisions/:entryId/review    { reviewOn } -> { decision }
 *
 * BEHIND THE ROOM'S OWN GATES: server/index.ts registers this module after
 * server/routes/liveSessions.ts, so the module gate and the members-only gate
 * on `/api/sessions` stand in front of both doors, and this module mounts the
 * module gate on its own prefix too. Neither door is read as a room's: they
 * take five and seven segments beginning `circles`.
 *
 * THE REVIEW JOB REGISTERS HERE, hourly, beside the doors that set what it
 * brings back.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { Outcome } from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { DECISION_REVIEW_EVERY_MS, DECISION_REVIEW_JOB, circleDecisionLog, runDecisionReviews, setReview } from "../lib/sessionDecisions";
import { liveCircles } from "./sessionRhythm";
import { CIRCLES_API } from "../../shared/sessionRhythm";
import { DECISION_LIMITS, DECISION_REFUSALS } from "../../shared/sessionDecisions";

/**
 * What this module touches, and why. `circlesRepo` says which circles are
 * live. `lapseContext` reads whose seat terms still run, for standing.
 * `overLimit` bounds the door that writes.
 */
type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "overLimit" | "circlesRepo" | "lapseContext">;

const HOUR_MS = 60 * 60 * 1000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, circlesRepo } = deps;
  const decisions = { circles: () => liveCircles(circlesRepo), lapseContext: deps.lapseContext };

  registerJob(DECISION_REVIEW_JOB, DECISION_REVIEW_EVERY_MS, () => runDecisionReviews({ ...decisions, getPool }));

  app.use(`${CIRCLES_API}/:circleId/decisions`, requireModule("sessions"));

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ error: out.error });

  const signedIn = async (req: Request, res: Response, limited: boolean) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const userId = String(user.id);
    if (limited && (await overLimit(`sessions-decision-review:${userId}`, DECISION_LIMITS.writesPerHour, HOUR_MS))) {
      res.status(429).json({ error: DECISION_REFUSALS.slowDown });
      return null;
    }
    return { userId, admin: await isAdmin(req) };
  };
  const circleIdOf = (req: Request) => String(req.params?.circleId ?? "").slice(0, 64);

  app.get(`${CIRCLES_API}/:circleId/decisions`, async (req, res) => {
    const who = await signedIn(req, res, false);
    if (!who) return;
    res.setHeader("Cache-Control", "private, no-cache");
    answer(res, await circleDecisionLog(getPool(), who, circleIdOf(req), decisions), (v) => v);
  });

  app.put(`${CIRCLES_API}/:circleId/decisions/:entryId/review`, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    answer(res, await setReview(getPool(), who, circleIdOf(req), Number(req.params?.entryId), req.body, decisions), (v) => v);
  });
}
