/**
 * A member's own task list: `/api/member-tasks/**` ("Your list", PR 1).
 *
 *   GET   /api/member-tasks/me                 the switch, and when on: the ranked list and counts
 *   POST  /api/member-tasks/me                 add a task (by hand, or from a journal entry)
 *   PATCH /api/member-tasks/me/:id             change fields, at the version the member saw (409 when it moved)
 *   POST  /api/member-tasks/me/:id/done        mark it done
 *   POST  /api/member-tasks/me/:id/remove      remove it, with a reason code; it can be restored for 30 days
 *   POST  /api/member-tasks/me/:id/undo        bring a done or removed task back
 *   POST  /api/member-tasks/me/:id/not-now     push it down the list
 *
 *   GET   /api/admin/member-tasks/access        steward: whose lists are on
 *   PUT   /api/admin/member-tasks/access/:userId steward: turn one member's list on or off
 *   POST  /api/admin/member-tasks/import         steward: bring one member's library tasks in (dry run unless dryRun is false)
 *   POST  /api/admin/member-tasks/import/:batch/remove  steward: undo a whole import batch
 *
 * Every door needs a signed-in member and reaches ONLY their own rows. Every
 * write refuses until a steward has turned the member's list on, so nothing
 * changes for anybody until then. The days are the village's, never the
 * server's (`villageDayKey`).
 */
import { boolVar } from "../lib/variables";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { SCREEN_REASONS, parseFeedback, type FeedbackAction, type ScreenReason } from "../../shared/memberTaskFeedback";
import { pullForImport, recordAction } from "../lib/memberTaskBridge";
import { importPhrase, latestFeedback, setImportPhrase, undoFeedback, enqueue } from "../repos/memberTaskFeedback";
import type { AppDeps } from "../lib/appDeps";
import { itemsOf, planImport, planSummary } from "../../shared/memberTaskImport";
import { heldFromLibrary, memberExists, removeBatch, runImport } from "../repos/memberTaskImport";
import { villageDayKey } from "../../shared/companionItems";
import {
  PRESETS, clampWeights, countsOf, parseTaskInput, parseTaskPatch, rankTasks,
  type PresetName, type TaskSource,
} from "../../shared/memberTasks";
import {
  bumpNotNow, insertTask, listIsOn, membersWithListOn, ownTask, ownTasks, patchTask, setListOn, setStatus, type MemberTaskRow,
} from "../repos/memberTasks";

/** Re-exported so server/index.ts reaches it on its one exempt import line for this module. */
export { exportMemberTasks } from "../repos/memberTasks";

type Deps = Pick<AppDeps, "authedUser" | "getPool" | "overLimit" | "isAdmin" | "adminActor"> & { timeZone: () => string };

const HOUR_MS = 60 * 60 * 1000;
/** Writes one member may make in an hour. A busy morning of sorting is well under this. */
const WRITES_PER_HOUR = 600;
/** Sources a member may set by hand. The library's tasks arrive only through the steward import. */
const MEMBER_SOURCES: readonly TaskSource[] = ["self", "journal"];

/** What the member's own browser sees. The private detail is theirs, so it is included here and nowhere else. */
export function taskOut(t: MemberTaskRow) {
  return {
    id: t.id, title: t.title, privateDetail: t.privateDetail, tier: t.tier, horizon: t.horizon, dueOn: t.dueOn,
    minutes: t.minutes, status: t.status, pinned: t.pinned, memberPinned: t.memberPinned, externalId: t.source === "sera" ? t.externalId : null, source: t.source, version: t.version,
    createdOn: t.createdOn, requestedBy: t.requestedBy ?? null, waitingForRole: t.seraRoleId != null, doneAt: t.doneAt, removedAt: t.removedAt, removeReason: t.removeReason,
  };
}

export function listOut(rows: MemberTaskRow[], today: string, preset: PresetName) {
  const weights = clampWeights(PRESETS[preset]);
  const ranked = rankTasks(rows, weights, today);
  return {
    today,
    preset,
    weights,
    counts: countsOf(ranked),
    open: ranked.map((r) => ({ ...taskOut(r.task), score: r.score, horizonNow: r.horizon, reasons: r.reasons, always: r.always, shown: r.shown })),
    done: rows.filter((t) => t.status === "done").map(taskOut),
    removed: rows.filter((t) => t.status === "removed").map(taskOut),
  };
}

export function register(app: Express, deps: Deps): void {
  const { authedUser, getPool, overLimit, timeZone, isAdmin, adminActor } = deps;
  const today = () => villageDayKey(new Date(), timeZone());

  /** The signed-in member whose list is on, or null after answering. */
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
    if (!(await listIsOn(getPool(), uid, boolVar("memberTasks.listDefault")))) {
      res.status(write ? 403 : 200).json(write ? { error: "list_off" } : { on: false });
      return null;
    }
    return uid;
  };

  const answer = async (res: any, uid: string, id: string, result: "ok" | "conflict" | "missing") => {
    if (result === "missing") return res.status(404).json({ error: "not_found" });
    const task = await ownTask(getPool(), uid, id);
    if (result === "conflict") return res.status(409).json({ error: "conflict", task: task ? taskOut(task) : null });
    res.json({ task: task ? taskOut(task) : null });
  };

  const versionOf = (body: any): number | null => {
    const v = Number(body?.version);
    return Number.isInteger(v) && v > 0 ? v : null;
  };

  /** The feedback a press carries. A client that sends none still gets one, made here. */
  const feedbackOf = (body: any, action: FeedbackAction) => {
    const b = { ...(body ?? {}) };
    if (!b.feedbackId) b.feedbackId = `fb-${randomUUID()}`;
    if (action === "remove" && !SCREEN_REASONS.includes(b.reason as ScreenReason)) b.reason = "other";
    return parseFeedback(b, action);
  };

  /** Tell the bridge, never failing the member's press because of it. */
  const tell = async (uid: string, id: string, action: FeedbackAction, body: any, extra: { redirectToUserId?: string | null; redirectToRoleId?: string | null; mergedIntoExternalId?: string | null } = {}) => {
    try {
      const f = feedbackOf(body, action);
      const task = await ownTask(getPool(), uid, id);
      if (f.ok && task) await recordAction(getPool(), { userId: uid, task, action, feedback: f.value, ...extra });
    } catch (err) {
      console.warn("[member-task-bridge] could not record feedback", (err as Error)?.message);
    }
  };

  app.get("/api/member-tasks/me", async (req, res) => {
    const uid = await member(req, res, false);
    if (!uid) return;
    const p = String((req.query as any)?.preset ?? "");
    const preset: PresetName = p in PRESETS ? (p as PresetName) : "balanced";
    res.json({ on: true, ...listOut(await ownTasks(getPool(), uid), today(), preset) });
  });

  app.post("/api/member-tasks/me", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const parsed = parseTaskInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.problem });
    const source = String((req.body as any)?.source ?? "self") as TaskSource;
    if (!MEMBER_SOURCES.includes(source)) return res.status(400).json({ error: "That source is not one a member can set." });
    const id = await insertTask(getPool(), uid, { ...parsed.value, source, createdOn: today() }, uid);
    const task = await ownTask(getPool(), uid, id);
    res.status(201).json({ task: task ? taskOut(task) : null });
  });

  app.patch("/api/member-tasks/me/:id", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const parsed = parseTaskPatch(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.problem });
    const id = String(req.params.id);
    const before = await ownTask(getPool(), uid, id);
    const result = await patchTask(getPool(), uid, id, version, parsed.value, { byMember: true });
    if (result === "ok" && before && parsed.value.tier && parsed.value.tier !== before.tier) await tell(uid, id, "priority_changed", req.body);
    await answer(res, uid, id, result);
  });

  app.post("/api/member-tasks/me/:id/done", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const id = String(req.params.id);
    const result = await setStatus(getPool(), uid, id, version, "done");
    if (result === "ok") await tell(uid, id, "done", req.body);
    await answer(res, uid, id, result);
  });

  app.post("/api/member-tasks/me/:id/remove", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const f = feedbackOf(req.body, "remove");
    if (!f.ok) return res.status(400).json({ error: f.problem });
    const id = String(req.params.id);
    const result = await setStatus(getPool(), uid, id, version, "removed", f.value.reason);
    if (result === "ok") {
      // A duplicate may name the task that stays; the library hears it only when that task is the library's too.
      let mergedIntoExternalId: string | null = null;
      const keeps = typeof req.body?.mergedIntoTaskId === "string" ? req.body.mergedIntoTaskId.slice(0, 64) : "";
      if (keeps && keeps !== id && (f.value.reason === "duplicate" || f.value.reason === "merged")) {
        const kept = await ownTask(getPool(), uid, keeps).catch(() => null);
        if (kept && kept.source === "sera" && kept.externalId) mergedIntoExternalId = kept.externalId;
      }
      await tell(uid, id, "remove", { ...req.body, feedbackId: f.value.feedbackId, reason: f.value.reason }, { mergedIntoExternalId });
    }
    await answer(res, uid, id, result);
  });

  app.post("/api/member-tasks/me/:id/undo", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const id = String(req.params.id);
    const result = await setStatus(getPool(), uid, id, version, "open");
    if (result === "ok") {
      // The press it undoes is marked undone; what was sent already is taken back.
      const last = await latestFeedback(getPool(), uid, id).catch(() => null);
      if (last) {
        const { wasSent } = await undoFeedback(getPool(), uid, last.feedbackId);
        const task = await ownTask(getPool(), uid, id);
        if (wasSent && task?.source === "sera" && task.externalId) {
          await enqueue(getPool(), uid, last.feedbackId, "undo", { task_id: task.externalId, feedback_id: last.feedbackId, reason_code: "not_now" }).catch(() => {});
        }
      }
    }
    await answer(res, uid, id, result);
  });

  app.post("/api/member-tasks/me/:id/not-now", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const id = String(req.params.id);
    if (!(await bumpNotNow(getPool(), uid, id))) return res.status(404).json({ error: "not_found" });
    const task = await ownTask(getPool(), uid, id);
    res.json({ task: task ? taskOut(task) : null });
  });

  // ── Steward: the per-member switch ──────────────────────────────────────

  app.get("/api/admin/member-tasks/access", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    res.json({ on: await membersWithListOn(getPool(), boolVar("memberTasks.listDefault")) });
  });

  app.put("/api/admin/member-tasks/access/:userId", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const userId = String(req.params.userId ?? "").trim();
    if (!userId || userId.length > 64) return res.status(400).json({ error: "Which member?" });
    const on = (req.body as any)?.on === true;
    await setListOn(getPool(), userId, on, adminActor(req)?.id ?? null);
    res.json({ userId, on });
  });

  // ── Steward: one member's library tasks ─────────────────────────────────

  app.post("/api/admin/member-tasks/import", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const seraOwnerId = String(body.seraOwnerId ?? "").trim();
    if (!userId || userId.length > 64) return res.status(400).json({ error: "Which member?" });
    if (!seraOwnerId || seraOwnerId.length > 128) return res.status(400).json({ error: "Which person in the library? Paste their owner id." });
    let items: unknown[];
    let phrase: string | null = null;
    if (body.pull === true) {
      // Read straight from the library, filtered by the evidence phrase (never by date).
      phrase = typeof body.evidenceContains === "string" ? body.evidenceContains.trim().slice(0, 200) : await importPhrase(getPool());
      const pulled = await pullForImport(seraOwnerId, phrase);
      if (!pulled.ok) return res.status(502).json({ error: pulled.error });
      items = itemsOf(pulled.items);
      if (!items.length) return res.status(400).json({ error: "The library returned no tasks for that person and phrase." });
      if (body.dryRun === false && phrase) await setImportPhrase(getPool(), phrase);
    } else {
      items = itemsOf(body.items ?? body.answer);
      if (!items.length) return res.status(400).json({ error: "No tasks found in what was pasted." });
    }
    if (items.length > 2000) return res.status(400).json({ error: "That is more than 2000 tasks. Split it." });
    if (!(await memberExists(getPool(), userId))) return res.status(404).json({ error: "No member with that id." });
    const plan = planImport(items, seraOwnerId, await heldFromLibrary(getPool(), userId));
    const summary = planSummary(plan);
    // A dry run unless the steward said otherwise in so many words.
    if (body.dryRun !== false) return res.json({ dryRun: true, pulled: phrase !== null, ...summary });
    const result = await runImport(getPool(), userId, seraOwnerId, plan, today(), adminActor(req)?.id ?? null);
    res.json({ dryRun: false, ...summary, ...result, listOn: await listIsOn(getPool(), userId, boolVar("memberTasks.listDefault")) });
  });

  app.post("/api/admin/member-tasks/import/:batch/remove", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const batch = String(req.params.batch ?? "").trim();
    if (!/^imp-[0-9a-f-]{36}$/.test(batch)) return res.status(400).json({ error: "That is not an import batch." });
    res.json({ batch, removed: await removeBatch(getPool(), batch, adminActor(req)?.id ?? null) });
  });
}
