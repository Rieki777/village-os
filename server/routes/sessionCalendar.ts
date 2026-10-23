/**
 * Live Sessions over HTTP: circle meetings on a calendar. Every door is the
 * "Doors" list in shared/sessionCalendar.ts, the contract, and every rule
 * behind a door is server/lib/sessionCalendar.ts:
 *
 *   GET    /api/sessions/circles/following       FollowPayload
 *   PUT    /api/sessions/circles/following       FollowInput -> FollowPayload
 *   POST   /api/sessions/circles/following/key   -> { url }, shown this once
 *   DELETE /api/sessions/circles/following/key   -> { ok: true }
 *   GET    /api/calendar/circles.ics?key=        the feed a calendar app reads
 *
 * BEHIND THE ROOM'S OWN GATES, the four member doors: server/index.ts
 * registers this module after server/routes/liveSessions.ts, so the module
 * gate and the members-only gate on `/api/sessions` stand in front of them,
 * and this module mounts the module gate on its own prefix too. No room door
 * is read as one of them: they take four and five segments beginning
 * `circles`, and no room door takes a second segment as a parameter.
 *
 * THE FEED STANDS OUTSIDE THEM, because a calendar app reads it with no
 * sign-in. It is bounded per network address before anything else, and
 * `feedFor` measures the module's state and the key holder itself; anything
 * it will not serve is one bare 404, the same for a wrong key as for a module
 * that is off, so the door says nothing about either.
 *
 * THE MIRROR'S JOB REGISTERS HERE, hourly, beside the doors that read what
 * it mirrors; every change to a rhythm mirrors at once too
 * (server/routes/sessionRhythm.ts).
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import type { Outcome } from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { feedFor, followFor, makeAddress, mirrorRhythms, setFollow, stopAddress } from "../lib/sessionCalendar";
import { liveCircles } from "./sessionRhythm";
import { CALENDAR_LIMITS, CALENDAR_REFUSALS, CIRCLE_FEED_PATH, FOLLOW_API, FOLLOW_KEY_API } from "../../shared/sessionCalendar";

/**
 * What this module touches, and why. `circlesRepo` says which circles are
 * live. `members` tells the feed whether the key's holder is still a member.
 * `clientIp` and `overLimit` bound the feed and the writes. `deploymentOrigin`
 * and `projectName` make the address and name the calendar.
 */
type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "members" | "circlesRepo" | "clientIp" | "deploymentOrigin" | "projectName">;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The mirror's job: every circle's rhythm into the village calendar, hourly. */
export const MIRROR_JOB = "session-calendar-mirror";

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, members, circlesRepo, clientIp } = deps;
  const calendar = { circles: () => liveCircles(circlesRepo) };

  registerJob(MIRROR_JOB, HOUR_MS, async () => {
    const r = await mirrorRhythms(getPool(), calendar);
    return `${r.written} circle rhythm(s) on the calendar, ${r.retired} retired`;
  });

  app.use(FOLLOW_API, requireModule("sessions"));

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ error: out.error });

  /** The signed-in member behind a request, or a 401 already sent; with a bucket, or a 429 already sent. */
  const signedIn = async (req: Request, res: Response, bucket?: { name: string; max: number; windowMs: number; error: string }) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const userId = String(user.id);
    if (bucket && (await overLimit(`${bucket.name}:${userId}`, bucket.max, bucket.windowMs))) {
      res.status(429).json({ error: bucket.error });
      return null;
    }
    return { userId };
  };

  app.get(FOLLOW_API, async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(await followFor(getPool(), who, calendar));
  });

  app.put(FOLLOW_API, async (req, res) => {
    const who = await signedIn(req, res, { name: "sessions-follow", max: CALENDAR_LIMITS.followsPerHour, windowMs: HOUR_MS, error: CALENDAR_REFUSALS.slowDown });
    if (!who) return;
    answer(res, await setFollow(getPool(), who, req.body, calendar), (v) => v);
  });

  app.post(FOLLOW_KEY_API, async (req, res) => {
    const who = await signedIn(req, res, { name: "sessions-feed-key", max: CALENDAR_LIMITS.keysPerDay, windowMs: DAY_MS, error: CALENDAR_REFUSALS.tooManyAddresses });
    if (!who) return;
    res.setHeader("Cache-Control", "no-store");
    res.json({ url: await makeAddress(getPool(), who, deps.deploymentOrigin()) });
  });

  app.delete(FOLLOW_KEY_API, async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    await stopAddress(getPool(), who);
    res.json({ ok: true });
  });

  app.get(CIRCLE_FEED_PATH, async (req, res) => {
    if (await overLimit(`sessions-feed:${clientIp(req)}`, CALENDAR_LIMITS.feedReadsPerHour, HOUR_MS)) {
      return res.status(429).type("text/plain").send("Too many requests. Try again in an hour.");
    }
    const body = await feedFor(getPool(), req.query.key, {
      ...calendar,
      member: (userId) => members.byId(userId),
      villageName: deps.projectName,
      origin: deps.deploymentOrigin,
    });
    if (body == null) return res.status(404).type("text/plain").send("Not found");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="circles.ics"');
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(body);
  });
}
