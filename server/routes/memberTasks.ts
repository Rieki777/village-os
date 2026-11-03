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
import type { Express } from "express";
import type { AppDeps } from "../lib/appDeps";
import { itemsOf, planImport, planSummary } from "../../shared/memberTaskImport";
import { heldFromLibrary, memberExists, removeBatch, runImport } from "../repos/memberTaskImport";
import { villageDayKey } from "../../shared/companionItems";
import {
  PRESETS, REMOVE_REASONS, clampWeights, countsOf, parseTaskInput, parseTaskPatch, rankTasks,
  type PresetName, type RemoveReason, type TaskSource,
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
    minutes: t.minutes, status: t.status, pinned: t.pinned, source: t.source, version: t.version,
    createdOn: t.createdOn, doneAt: t.doneAt, removedAt: t.removedAt, removeReason: t.removeReason,
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
    if (!(await listIsOn(getPool(), uid))) {
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
    await answer(res, uid, id, await patchTask(getPool(), uid, id, version, parsed.value, { byMember: true }));
  });

  app.post("/api/member-tasks/me/:id/done", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const id = String(req.params.id);
    await answer(res, uid, id, await setStatus(getPool(), uid, id, version, "done"));
  });

  app.post("/api/member-tasks/me/:id/remove", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const r = String((req.body as any)?.reason ?? "other") as RemoveReason;
    const reason: RemoveReason = REMOVE_REASONS.includes(r) ? r : "other";
    const id = String(req.params.id);
    await answer(res, uid, id, await setStatus(getPool(), uid, id, version, "removed", reason));
  });

  app.post("/api/member-tasks/me/:id/undo", async (req, res) => {
    const uid = await member(req, res, true);
    if (!uid) return;
    const version = versionOf(req.body);
    if (!version) return res.status(400).json({ error: "version_required" });
    const id = String(req.params.id);
    await answer(res, uid, id, await setStatus(getPool(), uid, id, version, "open"));
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
    res.json({ on: await membersWithListOn(getPool()) });
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
    const items = itemsOf(body.items ?? body.answer);
    if (!items.length) return res.status(400).json({ error: "No tasks found in what was pasted." });
    if (items.length > 2000) return res.status(400).json({ error: "That is more than 2000 tasks. Split it." });
    if (!(await memberExists(getPool(), userId))) return res.status(404).json({ error: "No member with that id." });
    const plan = planImport(items, seraOwnerId, await heldFromLibrary(getPool(), userId));
    const summary = planSummary(plan);
    // A dry run unless the steward said otherwise in so many words.
    if (body.dryRun !== false) return res.json({ dryRun: true, ...summary });
    const result = await runImport(getPool(), userId, seraOwnerId, plan, today(), adminActor(req)?.id ?? null);
    res.json({ dryRun: false, ...summary, ...result, listOn: await listIsOn(getPool(), userId) });
  });

  app.post("/api/admin/member-tasks/import/:batch/remove", async (req, res) => {
    if (!(await isAdmin(req))) return res.status(401).json({ error: "auth_required" });
    const batch = String(req.params.batch ?? "").trim();
    if (!/^imp-[0-9a-f-]{36}$/.test(batch)) return res.status(400).json({ error: "That is not an import batch." });
    res.json({ batch, removed: await removeBatch(getPool(), batch, adminActor(req)?.id ?? null) });
  });
}
