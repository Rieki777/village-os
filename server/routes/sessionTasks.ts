/**
 * Live Sessions, after the call, over HTTP: a task keeps going once its
 * session closes. Every door is the "Doors" list in shared/sessionTasks.ts,
 * which is the contract, and every rule behind a door is
 * server/lib/sessionTasks.ts (the board, the answers, the record) and
 * server/lib/sessionTaskMail.ts (the emails and the gentle notes):
 *
 *   GET   /api/sessions/tasks/mine            TaskBoardPayload (?earlier=1 adds older finished tasks)
 *   GET   /api/sessions/tasks/count           TaskCountPayload, the signed-in member's own
 *   PATCH /api/sessions/tasks/:entryId        TaskAnswer -> { task }, or 409 { error, task }
 *   POST  /api/sessions/tasks/:entryId/done   {} -> { task }: "It's done" from a notice
 *   POST  /api/sessions/tasks/:entryId/accept { note? } -> { task }: "Accept as accomplished"
 *   GET   /api/sessions/:id/task-record       TaskRecordPayload; the mail line only for the record's readers
 *   POST  /api/sessions/:id/task-emails       {} -> TaskMailResult, or 409 { error } while open
 *
 * A refusal is `{ error: <a sentence> }` with a 4xx status, and every
 * sentence is TASK_REFUSALS or SESSION_REFUSALS in the contracts.
 *
 * BEHIND THE ROOM'S OWN GATES. server/index.ts registers this module right
 * after server/routes/liveSessions.ts, so the module gate and the
 * members-only gate that module mounts on `/api/sessions` stand in front of
 * every door here too: the module off answers 404, and a guest answers 403
 * before any of this runs. This module also mounts the module gate on its own
 * prefix, so the board's doors stay gated if the order ever changes.
 *
 * NO DOOR HERE IS SWALLOWED BY THE ROOM'S. `/api/sessions/:id` matches one
 * segment, so `/api/sessions/tasks/mine` and `/tasks/count` (two) never reach
 * it, the room's doors with two segments are POSTs to fixed words or its one
 * GET of `minutes.md`, and the room has no POST with three. The route suite
 * proves it on a real Express app.
 *
 * THE GENTLE NOTES' JOB REGISTERS HERE, beside the doors that answer what it
 * reminds people about, the way server/routes/failedActions.ts registers its
 * own. It reads the pool when it runs, never at boot.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { memberNo, parseId, rolesIn, mapSession, type MemberLookup, type Outcome } from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { acceptTask, answerTask, markTaskDone, taskBoard, taskCount, taskRecord, type TaskDeps } from "../lib/sessionTasks";
import { TASK_NOTES_EVERY_MS, TASK_NOTES_JOB, reserveSend, runTaskNotes, sendTaskEmails } from "../lib/sessionTaskMail";
import { sessionRow } from "../repos/liveSessions";
import { SESSION_REFUSALS as R } from "../../shared/sessions";
import { ACCEPTING_POWER, TASK_LIMITS, TASK_REFUSALS, TASKS_API } from "../../shared/sessionTasks";

/**
 * What this module touches, and why. `members` names the people on a card,
 * `circlesRepo` names a circle. The post office, the spine's member reader,
 * `notify`, `notifyAdmins`, the origin and the village's name carry the task
 * emails and the notices. `lapseContext` reads whose seat term still runs.
 * `overLimit` bounds the doors that write. `liveHoldersOf` counts who holds
 * the power that seats people the way the gate counts, for who may accept
 * work as accomplished; without it nobody is offered the accept control.
 */
type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "isAdmin"
  | "getPool"
  | "overLimit"
  | "members"
  | "circlesRepo"
  | "notify"
  | "notifyAdmins"
  | "notifyDeps"
  | "commsPostOffice"
  | "lapseContext"
  | "deploymentOrigin"
  | "projectName"
> & {
  /** `liveHoldersOf` in server/index.ts. */
  liveHoldersOf?(capability: string): Promise<string[]>;
};

const HOUR_MS = 60 * 60 * 1000;
/** How long a person's name is remembered between reads. */
const NAME_TTL_MS = 30_000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, members, circlesRepo } = deps;

  registerJob(TASK_NOTES_JOB, TASK_NOTES_EVERY_MS, () => runTaskNotes(deps));

  app.use(TASKS_API, requireModule("sessions"));

  const nameCache = new Map<string, { at: number; m: { name: unknown; handle: unknown } | null }>();
  const lookup: MemberLookup = async (userId) => {
    const hit = nameCache.get(userId);
    if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.m;
    const m = await members.byId(userId);
    const v = m ? { name: m.name, handle: m.handle ?? null } : null;
    if (nameCache.size > 5000) nameCache.clear();
    nameCache.set(userId, { at: Date.now(), m: v });
    return v;
  };
  const circleName = (id: string | null): string | null => {
    if (!id) return null;
    const c = (circlesRepo.all() as Array<{ id?: unknown; name?: unknown }>).find((x) => x?.id === id);
    return c ? String(c.name ?? id) : null;
  };
  const liveHoldersOf = deps.liveHoldersOf;
  const tasks: TaskDeps = {
    lookup,
    circleName,
    lapseContext: deps.lapseContext,
    notify: deps.notify,
    acceptors: liveHoldersOf ? () => liveHoldersOf(ACCEPTING_POWER) : undefined,
  };

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ ...(out.body ?? {}), error: out.error });

  /** The signed-in member behind a request, or a 401 already sent. */
  const signedIn = async (req: Request, res: Response) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    return { userId: String(user.id), admin: await isAdmin(req) };
  };

  // ── The board ─────────────────────────────────────────────────────────────

  app.get("/api/sessions/tasks/mine", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    res.setHeader("Cache-Control", "private, no-cache");
    res.json(await taskBoard(getPool(), who, tasks, { earlier: req.query?.earlier === "1" }));
  });

  /**
   * How many tasks wait on the signed-in member, and the nearest date, for
   * the menu's count and the profile's card. Their own numbers, read fresh:
   * nothing is cached, here or in a shared cache on the way.
   */
  app.get("/api/sessions/tasks/count", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await taskCount(getPool(), who, tasks));
  });

  /**
   * One answer. The version the page saw comes back with it; a task that moved
   * since answers 409 with the card as it stands now.
   */
  app.patch("/api/sessions/tasks/:entryId", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    // One hour's bucket for every answer one member gives, the PATCH and "It's done" alike.
    if (await overLimit(`sessions-task-answer:${who.userId}`, TASK_LIMITS.answersPerHour, HOUR_MS)) {
      return res.status(429).json({ error: TASK_REFUSALS.tooMany });
    }
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: TASK_REFUSALS.notFound });
    answer(res, await answerTask(getPool(), who, entryId, req.body, tasks), (v) => ({ task: v.task }));
  });

  /**
   * "It's done" from a notice in the bell. No body: the server reads the
   * task's version itself and gives the PATCH's own done answer. A task
   * already done answers 200 with the card and changes nothing.
   */
  app.post("/api/sessions/tasks/:entryId/done", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    // One hour's bucket for every answer one member gives, the PATCH and "It's done" alike.
    if (await overLimit(`sessions-task-answer:${who.userId}`, TASK_LIMITS.answersPerHour, HOUR_MS)) {
      return res.status(429).json({ error: TASK_REFUSALS.tooMany });
    }
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: TASK_REFUSALS.notFound });
    answer(res, await markTaskDone(getPool(), who, entryId, tasks), (v) => ({ task: v.task }));
  });

  /**
   * "Accept as accomplished". The body is an optional `note`, one line of at
   * most 300 characters with no payment details; the server reads the version
   * itself. Nobody accepts their own work (`acceptRefusal`). The appended
   * `accepted` event is the record of who accepted what and when, the same
   * audit every answer here leaves, and nothing goes to the public event
   * spine. A task already accepted answers 200 with the card and changes
   * nothing. The same hour's bucket as every other answer.
   */
  app.post("/api/sessions/tasks/:entryId/accept", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (await overLimit(`sessions-task-answer:${who.userId}`, TASK_LIMITS.answersPerHour, HOUR_MS)) {
      return res.status(429).json({ error: TASK_REFUSALS.tooMany });
    }
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: TASK_REFUSALS.notFound });
    answer(res, await acceptTask(getPool(), who, entryId, req.body, tasks), (v) => ({ task: v.task }));
  });

  // ── One session's tasks ───────────────────────────────────────────────────

  app.get("/api/sessions/:id/task-record", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    const viewer = { no: await memberNo(pool, who.userId), admin: who.admin, userId: who.userId };
    answer(res, await taskRecord(pool, id, viewer, tasks), (v) => v);
  });

  /**
   * Send the task emails again: the closed session's facilitator, or an admin.
   * Each press takes the next send number, so its emails are new ones; the
   * same send run twice is still one email per person. The answer is the
   * counts, by reason, never an address.
   */
  app.post("/api/sessions/:id/task-emails", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    if (await overLimit(`sessions-task-mail:${who.userId}`, TASK_LIMITS.sendsPerHour, HOUR_MS)) {
      return res.status(429).json({ error: TASK_REFUSALS.sendsTooMany });
    }
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    const rows = await sessionRow(pool, id);
    if (!rows.length) return res.status(404).json({ error: R.notFound });
    const s = mapSession(rows[0]);
    const no = await memberNo(pool, who.userId);
    if (!rolesIn(s, { no, admin: who.admin }).runs) return res.status(403).json({ error: R.facilitatorOnly });
    if (s.status !== "closed") return res.status(409).json({ error: TASK_REFUSALS.stillOpen });
    const sendNo = await reserveSend(pool, id, no ?? 0);
    res.json(await sendTaskEmails(deps, id, { sendNo, sentByNo: no ?? 0 }));
  });
}
