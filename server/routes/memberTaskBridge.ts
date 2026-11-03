/**
 * The feedback bridge's doors ("Your list", PR E).
 *
 *   POST /api/member-tasks/me/:id/redirect     hand a task to a named member or a role, with a reason
 *   POST /api/member-tasks/me/:id/pin          pin it to the top of its tier, or unpin ({ on })
 *   GET  /api/member-tasks/me/feedback         the member's own switch for telling the library
 *   PUT  /api/member-tasks/me/feedback         turn it on or off ({ on }); off drops anything unsent
 *   GET  /api/member-tasks/redirect-targets    members a task can go to (names only) and the active roles
 *
 *   GET  /api/admin/member-tasks/bridge        steward: outbox counts, last errors, the notes switch, review and role queues
 *   PUT  /api/admin/member-tasks/bridge/notes  steward: hold or release notes ({ release: true | false })
 *   POST /api/admin/member-tasks/bridge/send   steward: send what is due now
 *   POST /api/admin/member-tasks/bridge/sync   steward: read linked members' changes now
 *   POST /api/admin/member-tasks/review/:feedbackId  steward: mark a logged item reviewed
 *   POST /api/admin/member-tasks/role-queue/:id      steward: take or dismiss a task handed to a role ({ status })
 *
 * Two jobs: the outbox drains every 15 minutes (and sweeps feedback older than
 * 12 months), and linked members' changes are read every 6 hours.
 */
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { registerJob } from "../lib/scheduler";
<<<<<<< HEAD
import { runListNudges } from "../lib/memberTaskNudges";
=======
import { randomUUID } from "node:crypto";
import { HARD_DELETE_TOOL, callPrivacyTool, libraryExportFor, readHardDelete } from "../lib/saberraPrivacy";
import { exportMemberTasks } from "../repos/memberTasks";
>>>>>>> 73f8c964 (Saberra: before erasing a member, export their tasks and remove them in Sera over a separate privacy connection)
import { villageDayKey } from "../../shared/companionItems";
import { REDIRECT_CHOICES, parseFeedback, type ScreenReason } from "../../shared/memberTaskFeedback";
import { heldFromLibrary } from "../repos/memberTaskImport";
import { drainOutbox, libraryOwnerOf, recordAction, syncLinked } from "../lib/memberTaskBridge";
import { insertTask, listIsOn, ownTask, setMemberPinned, setStatus } from "../repos/memberTasks";
import {
  activeRoles, closeRoleItem, feedbackOn, lastOutboxErrors, markReviewed, notesRelease, outboxCounts, queueForRole,
  redirectPeople, reviewQueue, roleQueue, setFeedbackOn, setNotesRelease,
} from "../repos/memberTaskFeedback";
import { taskOut } from "./memberTasks";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "isAdmin" | "adminActor"> & { timeZone: () => string; notify?: AppDeps["notify"] };

const HOUR_MS = 60 * 60 * 1000;
const WRITES_PER_HOUR = 600;

/** One pending hard-delete confirmation per member, in memory: a restart means a fresh dry run. */
const hardDeletePending = new Map<string, { code: string; at: number }>();

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, isAdmin, adminActor, timeZone } = deps;
  const today = () => villageDayKey(new Date(), timeZone());

  registerJob("member-task-bridge", 15 * 60 * 1000, () => drainOutbox(getPool()));
  // Due-soon and asked-for notes on the bell, hourly, inside the daytime window.
  registerJob("member-task-nudges", HOUR_MS, () =>
    deps.notify ? runListNudges({ pool: getPool(), notify: deps.notify, zone: timeZone(), today: today() }) : Promise.resolve("no notifier"));
  registerJob("member-task-sync", 6 * HOUR_MS, async () => {
    const r = await syncLinked(getPool(), today());
    return `${r.status}: ${r.members} member(s), ${r.created} new, ${r.updated} refreshed, ${r.closed} closed${r.errors.length ? `, ${r.errors.length} error(s)` : ""}`;
  });

  const member = async (req: any, res: any, write: boolean): Promise<string | null> => {
    const me = await authedUser(req);
    if (!me) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const uid = String(me.id);
    if (write && (await overLimit(`member-tasks:${uid}`, WRITES_PER_HOUR, HOUR_MS))) {
      res.status(429).json({ error: "That is a lot of changes for one hour. Try again a little later." });
      return null;
    }
    if (!(await listIsOn(getPool(), uid))) {
      res.status(403).json({ error: "list_off" });
      return null;
    }
    return uid;
  };

  app.post("/api/member-tasks/me/:id/redirect", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: "version_required" });
    if (!REDIRECT_CHOICES.includes(body.reason as ScreenReason)) return res.status(400).json({ error: "Pick a reason." });
    const f = parseFeedback(body, "redirect");
    if (!f.ok) return res.status(400).json({ error: f.problem });
    const toUserId = body.toUserId ? String(body.toUserId) : null;
    const toRoleId = body.toRoleId ? String(body.toRoleId) : null;
    if (!toUserId === !toRoleId) return res.status(400).json({ error: "Hand it to one person or one role." });
    const pool = getPool();
    const task = await ownTask(pool, uid, String(req.params.id));
    if (!task || task.status !== "open") return res.status(404).json({ error: "not_found" });
    if (toUserId) {
      if (toUserId === uid || !(await redirectPeople(pool, uid)).some((p) => p.id === toUserId)) {
        return res.status(400).json({ error: "That member can't take tasks yet." });
      }
    } else if (!(await activeRoles(pool)).some((r) => r.id === toRoleId)) {
      return res.status(400).json({ error: "No such role." });
    }
    const result = await setStatus(pool, uid, task.id, version, "removed", "redirected");
    if (result === "conflict") return res.status(409).json({ error: "conflict", task: taskOut((await ownTask(pool, uid, task.id))!) });
    if (result === "missing") return res.status(404).json({ error: "not_found" });
    // The task's words travel; the private detail (journal text) never does.
    if (toUserId) {
      // When both sides are linked to the library, the copy keeps the library's id, so the library's
      // reassignment lands on this row at the next sync instead of arriving as a second task.
      const sameLibraryTask = task.source === "sera" && !!task.externalId && !!(await libraryOwnerOf(pool, toUserId));
      // They already hold it from the library (open, or removed and kept as a tombstone): no second copy.
      const already = sameLibraryTask && (await heldFromLibrary(pool, toUserId)).some((h) => h.externalId === task.externalId);
      if (!already) await insertTask(pool, toUserId, {
        title: task.title, tier: task.tier, dueOn: task.dueOn, horizon: null, minutes: task.minutes, privateDetail: null,
        source: sameLibraryTask ? "sera" : "redirect", ...(sameLibraryTask ? { externalId: task.externalId } : {}), createdOn: today(),
      }, uid);
    } else {
      await queueForRole(pool, toRoleId!, task.title, uid, f.value.feedbackId);
    }
    try {
      await recordAction(pool, { userId: uid, task, action: "redirect", feedback: f.value, redirectToUserId: toUserId, redirectToRoleId: toRoleId });
    } catch (err) {
      console.warn("[member-task-bridge] could not record a redirect", (err as Error)?.message);
    }
    const after = await ownTask(pool, uid, task.id);
    res.json({ task: after ? taskOut(after) : null, feedbackId: f.value.feedbackId });
  });

  app.post("/api/member-tasks/me/:id/pin", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const on = (req.body as any)?.on !== false;
    const id = String(req.params.id);
    if (!(await setMemberPinned(getPool(), uid, id, on))) return res.status(404).json({ error: "not_found" });
    const task = await ownTask(getPool(), uid, id);
    res.json({ task: task ? taskOut(task) : null });
  });

  app.get("/api/member-tasks/me/feedback", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    res.json({ on: await feedbackOn(getPool(), String(me.id)) });
  });

  app.put("/api/member-tasks/me/feedback", async (req, res) => {
    const me = await authedUser(req);
    if (!me) return res.status(401).json({ error: "auth_required" });
    const on = (req.body as any)?.on === true;
    await setFeedbackOn(getPool(), String(me.id), on);
    res.json({ on: await feedbackOn(getPool(), String(me.id)) });
  });

  app.get("/api/member-tasks/redirect-targets", async (req, res) => {
    const uid = await member(req, res, false);
    if (!uid) return;
    res.json({ people: await redirectPeople(getPool(), uid), roles: await activeRoles(getPool()) });
  });

  // ── Steward ─────────────────────────────────────────────────────────────

  app.get("/api/admin/member-tasks/bridge", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    res.json({
      notes: await notesRelease(pool),
      outbox: await outboxCounts(pool),
      errors: await lastOutboxErrors(pool),
      review: await reviewQueue(pool),
      roleQueue: await roleQueue(pool),
    });
  });

  app.put("/api/admin/member-tasks/bridge/notes", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const release = (req.body as any)?.release === true;
    await setNotesRelease(getPool(), release ? "released" : "held", adminActor(req)?.id ?? null);
    res.json({ notes: await notesRelease(getPool()) });
  });

  app.post("/api/admin/member-tasks/bridge/send", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ result: await drainOutbox(getPool()) });
  });

  app.post("/api/admin/member-tasks/bridge/sync", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json(await syncLinked(getPool(), today()));
  });

  // ── Before erasing a member: their tasks, exported and (in Sera) removed ──

  /** A steward-only file of the village's own copy of a member's tasks. Nothing is sent anywhere. */
  app.get("/api/admin/member-tasks/:userId/export", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const userId = String(req.params.userId).slice(0, 64);
    const rows = await exportMemberTasks(getPool(), userId);
    const owner = await libraryOwnerOf(getPool(), userId);
    // The member's private detail is theirs alone (their own export carries it); a steward's file never does.
    const tasks = rows.map(({ privateDetail: _p, ...t }) => t);
    const sera = owner ? await libraryExportFor(owner).catch(() => ({ offered: false as const, note: "Sera did not answer." })) : { offered: false as const, note: "Not linked to Sera." };
    res.setHeader("Content-Disposition", `attachment; filename="member-tasks-${userId.replace(/[^A-Za-z0-9_-]/g, "")}.json"`);
    res.json({ exportedAt: new Date().toISOString(), userId, tasks, sera });
  });

  /**
   * Hard delete of a member's tasks in Sera, over the privacy connection only.
   * A dry run first, always: it answers the count and a one-time code. Only a
   * second press carrying `confirm: true` and that code, within 10 minutes,
   * asks Sera to archive them.
   */
  app.post("/api/admin/member-tasks/:userId/sera-hard-delete", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const userId = String(req.params.userId).slice(0, 64);
    const owner = await libraryOwnerOf(getPool(), userId);
    if (!owner) return res.status(404).json({ error: "This member is not linked to Sera, so Sera holds no tasks under them that we know of." });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pending = hardDeletePending.get(userId);
    const confirming = body.confirm === true;
    if (confirming && (!pending || pending.code !== body.code || Date.now() - pending.at > 10 * 60_000)) {
      return res.status(409).json({ error: "Run the dry run again first; the confirmation has expired or does not match." });
    }
    const r = await callPrivacyTool(HARD_DELETE_TOOL, confirming ? { owner_id: owner, confirm: true } : { owner_id: owner });
    if (!r.ok) return res.status(r.needsFullScope ? 412 : 502).json({ error: r.error, needsFullScope: !!r.needsFullScope });
    const read = readHardDelete(r.value);
    if (confirming) {
      hardDeletePending.delete(userId);
      return res.json({ dryRun: false, count: read.count, archived: true });
    }
    const code = randomUUID().slice(0, 8);
    hardDeletePending.set(userId, { code, at: Date.now() });
    res.json({ dryRun: true, count: read.count, code });
  });

  app.post("/api/admin/member-tasks/review/:feedbackId", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ reviewed: await markReviewed(getPool(), String(req.params.feedbackId)) });
  });

  app.post("/api/admin/member-tasks/role-queue/:id", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const status = (req.body as any)?.status === "taken" ? "taken" : "dismissed";
    res.json({ closed: await closeRoleItem(getPool(), String(req.params.id), status, adminActor(req)?.id ?? null) });
  });
}
