/**
 * THE LIVE TIME VOTE'S ROUTES, `/api/events/:id/time-poll...` (the comms
 * build spec 5.10), the `time_vote` one-click answer, and the job.
 *
 *   GET    /api/events/:id/time-poll              the vote: counts for anyone who
 *                                                 can see the gathering; first names
 *                                                 for a signed-in member while the host
 *                                                 shows them, and always for the host
 *   PUT    /api/events/:id/time-poll/vote         my picks: a member by session, a
 *                                                 guest by the signed link (`t`)
 *   POST   /api/events/:id/time-poll              give a gathering a vote   (event.manage)
 *   PUT    /api/events/:id/time-poll              the host's dials          (event.manage)
 *   POST   /api/events/:id/time-poll/options      offer more times          (event.manage)
 *   DELETE /api/events/:id/time-poll/options/:o   take a time off           (event.manage)
 *   POST   /api/events/:id/time-poll/pin          pin a time, or clear it   (event.manage)
 *   POST   /api/events/:id/time-poll/lock         lock now                  (event.manage)
 *   POST   /api/events/:id/time-poll/reopen       open it again             (event.manage)
 *   POST   /api/events/:id/time-poll/invite       ask people to vote        (event.manage)
 *   DELETE /api/events/:id/time-poll              remove the vote           (event.manage)
 *
 * ── WHERE THIS IS REGISTERED, AND WHY IT MUST STAY THERE ───────────────────
 *
 * From server/routes/commsEvents.ts, which server/index.ts registers AFTER
 * `app.use("/api/events", requireModule("events"))`. So the calendar
 * module's gate stands in front of every route here: with events off, each
 * answers the module's own 404. server/comms.timevote.e2e.test.ts asks the
 * vote with the module off and expects that 404, so a registration moved
 * above the mount turns it red.
 *
 * ── WHO MAY DO WHAT ─────────────────────────────────────────────────────────
 *
 * The host's routes are ACTS and ask `guardCapability` for `event.manage`,
 * the same power that puts a gathering on the calendar. Reading the vote is a
 * LOOK: `mayStillSee` decides only how much of the answer to build (whether
 * names travel), and never refuses. A vote is a person's own say, so it asks
 * only that the person can see the gathering.
 *
 * Every door a stranger can knock on (the read and the vote) takes a per-IP
 * `overLimit` bucket.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { canViewRow, getCalendarRow } from "../lib/calendar";
import { registerAction } from "../lib/comms/actions";
import { verifyLink } from "../lib/comms/links";
import {
  addPollOptions,
  closePoll,
  createPoll,
  invite,
  lockNow,
  pinPollOption,
  pollView,
  removePollOption,
  reopenPoll,
  runTimePollJob,
  TIME_POLLS_EVERY_MS,
  TIME_POLLS_JOB,
  timeVoteAction,
  updatePoll,
  vote,
  type PollResult,
  type TimePollDeps,
} from "../lib/comms/timePolls";
import { effectiveLifecycle } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { pollForEvent } from "../repos/timePolls";

export type PollRouteDeps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "guardCapability" | "mayStillSee" | "getPool" | "commsPostOffice" | "members" | "isPresent" | "notify" | "overLimit" | "clientIp"
>;

/** The refusal a signed-in member without the power reads. */
const HOST_ONLY = { status: 403, body: { error: "Only the people who run the calendar can change a gathering's vote." } };

const READ_PER_IP = 240;
const VOTE_PER_IP = 60;
const WINDOW_MS = 10 * 60 * 1000;

/** The vote's own dependencies, built from what a route module is handed. */
export function timePollDepsOf(d: Pick<AppDeps, "getPool" | "commsPostOffice" | "members"> & Partial<Pick<AppDeps, "notify">>): TimePollDeps {
  return {
    getPool: d.getPool,
    postOffice: d.commsPostOffice,
    members: d.members,
    ...(d.notify ? { notify: d.notify } : {}),
  };
}

/**
 * The job, as "run now" and the scheduler both run it. The vote belongs to
 * the calendar, so it sleeps while the events module is off.
 */
export async function runTimePollsNow(deps: TimePollDeps): Promise<Record<string, number>> {
  if (effectiveLifecycle("events") === "off") return { locked: 0, applied: 0, evenings: 0, notified: 0, cleared: 0 };
  return runTimePollJob(deps);
}

const tooMany = (res: Response) =>
  res.status(429).set("Retry-After", "600").json({ error: "Too many requests. Try again in a few minutes." });

function answer<T>(res: Response, result: PollResult<T>, body: (value: T) => unknown): void {
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(body(result.value));
}

export function register(app: Express, deps: PollRouteDeps): void {
  const { authedUser, isAdmin, guardCapability, mayStillSee, getPool, overLimit, clientIp } = deps;
  const polls = timePollDepsOf(deps);

  registerAction(timeVoteAction(polls));
  registerJob(TIME_POLLS_JOB, TIME_POLLS_EVERY_MS, async () => {
    const s = await runTimePollsNow(polls);
    return `${s.locked} locked, ${s.applied} moved, ${s.evenings} evening(s), ${s.notified} emailed, ${s.cleared} cleared`;
  });

  const eventId = (req: Request): string => String(req.params.id ?? "");

  /** The person a signed `time_vote` link names, when it is for this gathering's vote. */
  async function linkedPerson(req: Request): Promise<{ personKey: string } | null> {
    const t = typeof req.body?.t === "string" ? req.body.t : typeof req.query.t === "string" ? req.query.t : "";
    if (!t) return null;
    const payload = verifyLink("time_vote", t);
    const poll = await pollForEvent(getPool(), eventId(req));
    if (!payload || !poll || payload.p !== poll.id || typeof payload.k !== "string") return null;
    return { personKey: payload.k };
  }

  /** Whether this request may see the gathering, and who is asking. */
  async function viewerOf(req: Request): Promise<{ visible: boolean; user: any | null; canManage: boolean }> {
    const user = await authedUser(req);
    const canManage = user ? await mayStillSee(req, "event.manage") : false;
    const row = await getCalendarRow(getPool(), eventId(req));
    const visible = !!row && canViewRow(row, { userId: user?.id ?? null, isAdmin: user ? await isAdmin(req) : false }, { includeDrafts: canManage });
    return { visible, user, canManage };
  }

  const notFound = (res: Response) => res.status(404).json({ error: "This gathering has no vote on its time." });

  app.get("/api/events/:id/time-poll", async (req, res) => {
    if (await overLimit(`time-poll-read:${clientIp(req)}`, READ_PER_IP, WINDOW_MS)) return tooMany(res);
    const linked = await linkedPerson(req);
    const viewer = await viewerOf(req);
    if (!viewer.visible && !linked) return notFound(res);
    const view = await pollView(polls, eventId(req), {
      personKey: linked?.personKey ?? viewer.user?.id ?? null,
      signedIn: !!viewer.user,
      canManage: viewer.canManage,
    });
    if (!view) return notFound(res);
    res.json({ poll: view });
  });

  app.put("/api/events/:id/time-poll/vote", async (req, res) => {
    if (await overLimit(`time-poll-vote:${clientIp(req)}`, VOTE_PER_IP, WINDOW_MS)) return tooMany(res);
    const ids = req.body?.optionIds;
    if (!Array.isArray(ids) || ids.length > 8 || ids.some((id: unknown) => typeof id !== "string")) {
      return res.status(400).json({ error: "Send the times you can make as a list." });
    }
    const linked = await linkedPerson(req);
    let personKey = linked?.personKey ?? null;
    const viewer = await viewerOf(req);
    if (!personKey) {
      if (!viewer.user) return res.status(401).json({ error: "Sign in to vote." });
      if (!viewer.visible) return notFound(res);
      personKey = String(viewer.user.id);
    }
    const poll = await pollForEvent(getPool(), eventId(req));
    if (!poll) return notFound(res);
    const result = await vote(polls, poll.id, personKey, { set: ids as string[] });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    const view = await pollView(polls, eventId(req), { personKey, signedIn: !!viewer.user, canManage: viewer.canManage });
    res.json({ poll: view });
  });

  // ── The host's routes ─────────────────────────────────────────────────────

  /** Answer a host's change with the vote as it now stands. */
  const hostView = async (req: Request) => {
    const user = await authedUser(req);
    return { poll: await pollView(polls, eventId(req), { personKey: user?.id ?? null, signedIn: true, canManage: true }) };
  };

  app.post("/api/events/:id/time-poll", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const user = await authedUser(req);
    const b = req.body ?? {};
    const made = await createPoll(polls, {
      eventId: eventId(req),
      mode: b.mode,
      options: Array.isArray(b.options) ? b.options : [],
      closesAt: typeof b.closesAt === "string" ? b.closesAt : null,
      settleMinutes: b.settleMinutes,
      freezeHours: b.freezeHours,
      showNames: b.showNames !== false,
      createdBy: String(user?.id ?? "admin"),
    });
    answer(res, made, (poll) => ({ poll }));
  });

  app.put("/api/events/:id/time-poll", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const b = req.body ?? {};
    const result = await updatePoll(polls, eventId(req), {
      closesAt: b.closesAt,
      settleMinutes: b.settleMinutes,
      freezeHours: b.freezeHours,
      showNames: b.showNames,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(await hostView(req));
  });

  app.post("/api/events/:id/time-poll/options", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const result = await addPollOptions(polls, eventId(req), Array.isArray(req.body?.options) ? req.body.options : []);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(await hostView(req));
  });

  app.delete("/api/events/:id/time-poll/options/:optionId", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const result = await removePollOption(polls, eventId(req), String(req.params.optionId ?? ""));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(await hostView(req));
  });

  app.post("/api/events/:id/time-poll/pin", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const optionId = req.body?.optionId;
    if (optionId !== null && typeof optionId !== "string") return res.status(400).json({ error: "Name the time to pin, or null to clear the pin." });
    const result = await pinPollOption(polls, eventId(req), optionId);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(await hostView(req));
  });

  app.post("/api/events/:id/time-poll/lock", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const result = await lockNow(polls, eventId(req));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(await hostView(req));
  });

  app.post("/api/events/:id/time-poll/reopen", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const closesAt = typeof req.body?.closesAt === "string" && req.body.closesAt ? req.body.closesAt : null;
    const result = await reopenPoll(polls, eventId(req), closesAt);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(await hostView(req));
  });

  app.post("/api/events/:id/time-poll/invite", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const asked = req.body?.members;
    let members: string[] = [];
    if (asked === "all") {
      members = (await deps.members.all()).filter((m: any) => deps.isPresent(m)).map((m: any) => String(m.id));
    } else if (Array.isArray(asked)) {
      members = asked.filter((id: unknown): id is string => typeof id === "string").slice(0, 2000);
    }
    const result = await invite(polls, eventId(req), { answered: req.body?.answered !== false, members });
    answer(res, result, (value) => value);
  });

  app.delete("/api/events/:id/time-poll", async (req, res) => {
    if (!(await guardCapability(req, res, "event.manage", HOST_ONLY))) return;
    const result = await closePoll(polls, eventId(req));
    answer(res, result, () => ({ success: true }));
  });
}
