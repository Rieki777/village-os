/**
 * Live Sessions over HTTP: a circle's rhythm, and one circle's sessions. Every
 * door is the "Doors" list in shared/sessionRhythm.ts, the contract, and every
 * rule behind a door is server/lib/sessionRhythm.ts:
 *
 *   PUT  /api/sessions/circles/:circleId/rhythm        RhythmInput -> { row }
 *   POST /api/sessions/circles/:circleId/rhythm/skip   { key } -> { row }
 *   GET  /api/sessions/circles/:circleId/summary       CircleSessionsSummary
 *
 * "Coming up" itself rides on `GET /api/sessions` (server/routes/liveSessions.ts),
 * the list the page already reads every half minute.
 *
 * BEHIND THE ROOM'S OWN GATES. server/index.ts registers this module after
 * server/routes/liveSessions.ts, so the module gate and the members-only gate
 * that module mounts on `/api/sessions` stand in front of every door here, and
 * this module mounts the module gate on its own prefix too.
 *
 * NO DOOR HERE IS READ AS A ROOM'S. Each takes four or five segments under
 * `/api/sessions`, and no room door does a PUT, or a GET or POST of that
 * length beginning `circles`.
 *
 * THE DAY-BEFORE NOTICE'S JOB REGISTERS HERE, beside the doors that set what
 * it reminds people of, the way server/routes/sessionTasks.ts registers its
 * gentle notes. It reads the pool when it runs, never at boot.
 *
 * A RHYTHM THAT CHANGES REACHES THE VILLAGE CALENDAR AT ONCE: a set or a skip
 * that lands runs the calendar mirror (server/lib/sessionCalendar.ts), and a
 * mirror that fails is logged and never fails the change. The hourly mirror
 * catches up whatever one missed.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { Outcome } from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { mirrorRhythms } from "../lib/sessionCalendar";
import {
  COMING_UP_EVERY_MS,
  COMING_UP_JOB,
  circleSummary,
  runComingUpNotes,
  setRhythm,
  skipMeeting,
  type RhythmDeps,
} from "../lib/sessionRhythm";
import { CIRCLES_API, RHYTHM_LIMITS, RHYTHM_REFUSALS } from "../../shared/sessionRhythm";

/**
 * What this module touches, and why. `circlesRepo` says which circles are
 * live and what they are called. `lapseContext` reads whose seat terms still
 * run, for standing and for who hears the day before. `notify` carries that
 * notice. `overLimit` bounds the two doors that write.
 */
type Deps = Pick<AppDeps, "authedUser" | "isAdmin" | "getPool" | "overLimit" | "circlesRepo" | "notify" | "lapseContext">;

const HOUR_MS = 60 * 60 * 1000;

/** The circles a rhythm can belong to: live ones, never a dormant circle or a standing example, as a session's. */
export function liveCircles(circlesRepo: Deps["circlesRepo"]): { id: string; name: string }[] {
  return (circlesRepo.all() as Array<{ id?: unknown; name?: unknown; status?: unknown; isExample?: unknown }>)
    .filter((c) => typeof c?.id === "string" && c.id && c.status !== "dormant" && !c.isExample)
    .map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, circlesRepo, notify } = deps;
  const rhythm: RhythmDeps = { circles: () => liveCircles(circlesRepo), lapseContext: deps.lapseContext };

  registerJob(COMING_UP_JOB, COMING_UP_EVERY_MS, () => runComingUpNotes({ ...rhythm, getPool, notify }));

  app.use(CIRCLES_API, requireModule("sessions"));

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ ...(out.body ?? {}), error: out.error });

  /** A change that landed reaches the village calendar now. */
  const mirrored = async <T>(out: Outcome<T>): Promise<Outcome<T>> => {
    if (out.ok) await mirrorRhythms(getPool(), rhythm).catch((e) => console.error("[sessions] the calendar mirror did not run", e));
    return out;
  };

  /** The signed-in member behind a request, or a 401 already sent; with a bucket, or a 429 already sent. */
  const signedIn = async (req: Request, res: Response, limited: boolean) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const userId = String(user.id);
    if (limited && (await overLimit(`sessions-rhythm:${userId}`, RHYTHM_LIMITS.writesPerHour, HOUR_MS))) {
      res.status(429).json({ error: RHYTHM_REFUSALS.slowDown });
      return null;
    }
    return { userId, admin: await isAdmin(req) };
  };
  const circleIdOf = (req: Request) => String(req.params?.circleId ?? "").slice(0, 64);

  app.put(`${CIRCLES_API}/:circleId/rhythm`, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    answer(res, await mirrored(await setRhythm(getPool(), who, circleIdOf(req), req.body, rhythm)), (v) => ({ row: v.row }));
  });

  app.post(`${CIRCLES_API}/:circleId/rhythm/skip`, async (req, res) => {
    const who = await signedIn(req, res, true);
    if (!who) return;
    answer(res, await mirrored(await skipMeeting(getPool(), who, circleIdOf(req), req.body, rhythm)), (v) => ({ row: v.row }));
  });

  app.get(`${CIRCLES_API}/:circleId/summary`, async (req, res) => {
    const who = await signedIn(req, res, false);
    if (!who) return;
    const summary = await circleSummary(getPool(), circleIdOf(req), who, rhythm);
    if (!summary) return res.status(404).json({ error: RHYTHM_REFUSALS.circleUnknown });
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(summary);
  });
}
