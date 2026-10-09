/**
 * Live Sessions over HTTP: a circle holds a working call together, in real
 * time. Every door is the "Doors" list in shared/sessions.ts, which is the
 * contract, and every rule behind a door is server/lib/liveSessions.ts:
 *
 *   GET    /api/sessions                          { open, recent, circles }
 *   POST   /api/sessions                          { title, circleId?, durationMin? } -> { id }
 *   GET    /api/sessions/:id                      SessionView, with an ETag; 304 when nothing moved
 *   POST   /api/sessions/:id/join                 { ok }
 *   POST   /api/sessions/:id/here                 { ok }
 *   POST   /api/sessions/:id/arrival              { score, wish? } -> { ok }
 *   POST   /api/sessions/:id/items                { title, aim, minutes, fromSessionId? } -> { id }
 *   PATCH  /api/sessions/:id/items/:itemId        { title?, aim?, minutes?, position?, status?, presenterUserId? } -> { ok }
 *   POST   /api/sessions/:id/entries              { kind, text, itemId?, ownerSeatId?, dueOn? } -> { id }
 *   PATCH  /api/sessions/:id/entries/:entryId     { claim?, release?, ownerSeatId?, text?, dueOn?, status? } -> { ok }
 *   DELETE /api/sessions/:id/entries/:entryId     { ok }
 *   POST   /api/sessions/:id/respond              { target, value, text? } -> { ok }
 *   POST   /api/sessions/:id/act                  { action } -> { ok, state }
 *   POST   /api/sessions/:id/hosts                { facilitatorUserId?, secretaryUserId? } -> { ok }
 *   POST   /api/sessions/:id/close                {} -> { ok }, or 409 { error, unowned }
 *   POST   /api/sessions/:id/tool-feedback        { text } -> { ok }
 *   GET    /api/sessions/:id/minutes.md?for=shareable   text/markdown
 *
 * A refusal is `{ error: <a sentence> }` with a 4xx status, and every
 * sentence is SESSION_REFUSALS in the contract.
 *
 * MEMBERS ONLY. Every door answers 401 `auth_required` to anybody without a
 * member's token, before it touches the database. There is no guest door.
 *
 * THE MODULE GATE MOUNTS HERE, first, the way the journal mounts its own:
 * `requireModule("sessions")` in front of the whole prefix, so a village with
 * the module off answers 404 on every door below.
 *
 * THE ROOM POLLS, AND A 304 IS NEARLY FREE. There is no push channel to a
 * browser in this server (server/routes/mapOrg.ts says why), so an open room
 * asks every ROOM_POLL_MS with the ETag it last saw. The tag is the session's
 * version, a presence bucket and the viewer, all known from one row, so an
 * unchanged room answers 304 before any of the view is built.
 *
 * NOTHING HERE RECORDS AN EVENT. `recordEvent` writes to a public audience by
 * default. The close tells the admins and the people holding actions through
 * the notification spine, after its transaction commits.
 */
import type { Express, Request, Response } from "express";
import type { AppDeps } from "../lib/appDeps";
import { recordFeedback } from "../lib/feedback";
import {
  actInRoom,
  addEntry,
  addItem,
  buildView,
  cleanStart,
  closeSession,
  defaultDuration,
  ensureMemberNo,
  etagMatches,
  joinSession,
  listSessions,
  markHere,
  maySee,
  memberNo,
  noticesAfterClose,
  parseId,
  patchEntry,
  patchItem,
  readMinutes,
  removeEntry,
  respond,
  saveArrival,
  sessionEtag,
  sessionForViewer,
  setHosts,
  startSession,
  type Actor,
  type MemberLookup,
  type Outcome,
} from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import {
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_REFUSALS as R,
  SESSIONS_API,
  cleanLine,
  cleanText,
  parseSessionAction,
} from "../../shared/sessions";

/**
 * `exportMemberSessions` travels through this module so server/index.ts reads
 * it off the same import line as `register`: that file forgives one
 * route-module import and one register call per module, and a second import
 * from server/lib would be a counted line.
 */
export { exportMemberSessions } from "../lib/liveSessions";

/**
 * What this module touches, and why.
 *
 * `members` is wide, and is taken for one question: the name and handle of a
 * person in a room. Nothing here writes a member. `circlesRepo` answers which
 * circles exist and what they are called. `notify` and `notifyAdmins` carry
 * the two notices a close sends. `overLimit` bounds the doors that write.
 */
type Deps = Pick<
  AppDeps,
  "authedUser" | "isAdmin" | "getPool" | "overLimit" | "members" | "notify" | "notifyAdmins" | "circlesRepo"
>;

const HOUR_MS = 60 * 60 * 1000;
/** Sessions one member may open in an hour. A busy day is three or four. */
const STARTS_PER_HOUR = 12;
/** Joins in an hour. Coming and going from several rooms stays far under it. */
const JOINS_PER_HOUR = 120;
/** Presence beats in an hour: one every HERE_EVERY_MS from two tabs, with room to spare. */
const HERES_PER_HOUR = 600;
/** Entries in an hour, across every room: a fast secretary in a long session. */
const ENTRIES_PER_HOUR = 400;
/** Answers in an hour: consent rounds change their minds. */
const RESPONSES_PER_HOUR = 300;
/** Ideas for the tool in an hour. */
const TOOL_IDEAS_PER_HOUR = 10;
/** How long a person's name is remembered between polls. */
const NAME_TTL_MS = 30_000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, members, notify, notifyAdmins, circlesRepo } = deps;

  app.use(SESSIONS_API, requireModule("sessions"));

  // ── Names and circles ─────────────────────────────────────────────────────

  /**
   * A short memory of names, because an open room of thirty people each
   * rebuilding the view on every change would otherwise ask for thirty names
   * thirty times.
   */
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

  /** The circles a session can belong to: live ones, never a dormant circle or a standing example. */
  const circles = (): { id: string; name: string }[] =>
    (circlesRepo.all() as Array<{ id?: unknown; name?: unknown; status?: unknown; isExample?: unknown }>)
      .filter((c) => typeof c?.id === "string" && c.id && c.status !== "dormant" && !c.isExample)
      .map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const circleName = (id: string | null): string | null => {
    if (!id) return null;
    const c = (circlesRepo.all() as Array<{ id?: unknown; name?: unknown }>).find((x) => x?.id === id);
    return c ? String(c.name ?? id) : null;
  };
  const ctx = { lookup, circleName };

  // ── Answering ─────────────────────────────────────────────────────────────

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ ...(out.body ?? {}), error: out.error });

  const slow = (res: Response) => res.status(429).json({ error: R.slowDown });

  /**
   * The writer behind a request to one room, or a refusal already sent.
   * Somebody with no number has never been in any room, so the refusal names
   * what is true of this one: missing, closed, or not joined.
   */
  const writer = async (req: Request, res: Response, bucket?: { key: string; max: number }) => {
    const user = await authedUser(req);
    if (!user) {
      res.status(401).json({ error: "auth_required" });
      return null;
    }
    const uid = String(user.id);
    if (bucket && (await overLimit(`${bucket.key}:${uid}`, bucket.max, HOUR_MS))) {
      slow(res);
      return null;
    }
    const id = parseId(req.params?.id);
    if (id == null) {
      res.status(404).json({ error: R.notFound });
      return null;
    }
    const pool = getPool();
    const admin = await isAdmin(req);
    const no = await memberNo(pool, uid);
    if (no == null) {
      const found = await sessionForViewer(pool, id, { no: null, admin });
      if (!found) res.status(404).json({ error: R.notFound });
      else if (found.s.status !== "open") res.status(409).json({ error: R.closed });
      else res.status(403).json({ error: R.joinFirst });
      return null;
    }
    const actor: Actor = { no, admin };
    return { pool, actor, id, uid };
  };

  // ── The list, and opening a session ───────────────────────────────────────

  app.get("/api/sessions", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const pool = getPool();
    const viewer = { no: await memberNo(pool, String(user.id)), admin: await isAdmin(req) };
    const lists = await listSessions(pool, viewer, ctx);
    res.json({ ...lists, circles: circles(), defaultMinutes: defaultDuration() });
  });

  app.post("/api/sessions", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-start:${uid}`, STARTS_PER_HOUR, HOUR_MS)) return slow(res);
    const input = cleanStart(req.body, new Set(circles().map((c) => c.id)));
    if (!input.ok) return res.status(input.status).json({ error: input.error });
    const pool = getPool();
    const no = await ensureMemberNo(pool, uid);
    const id = await startSession(pool, no, input.value);
    res.json({ id });
  });

  // ── The room ──────────────────────────────────────────────────────────────

  app.get("/api/sessions/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    const viewer = { no: await memberNo(pool, String(user.id)), admin: await isAdmin(req) };
    const found = await sessionForViewer(pool, id, viewer);
    if (!found) return res.status(404).json({ error: R.notFound });
    if (!maySee(found.s, found.joined, viewer.admin)) return res.status(403).json({ error: SESSION_COPY.closedNoAccess });
    const now = Date.now();
    const tag = sessionEtag(found.s, viewer, now);
    res.setHeader("ETag", tag);
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("Vary", "Authorization");
    if (etagMatches(req.headers?.["if-none-match"], tag)) return res.status(304).end();
    res.json(await buildView(pool, found.s, viewer, found.joined, ctx, now));
  });

  app.post("/api/sessions/:id/join", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-join:${uid}`, JOINS_PER_HOUR, HOUR_MS)) return slow(res);
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    // Refuse a missing or closed room before handing out a number.
    const found = await sessionForViewer(pool, id, { no: null, admin: false });
    if (!found) return res.status(404).json({ error: R.notFound });
    if (found.s.status !== "open") return res.status(409).json({ error: R.closed });
    const no = await ensureMemberNo(pool, uid);
    answer(res, await joinSession(pool, id, no), () => ({ ok: true }));
  });

  app.post("/api/sessions/:id/here", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-here:${uid}`, HERES_PER_HOUR, HOUR_MS)) return slow(res);
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    answer(res, await markHere(pool, id, await memberNo(pool, uid)), () => ({ ok: true }));
  });

  app.post("/api/sessions/:id/arrival", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    answer(res, await saveArrival(w.pool, w.id, w.actor, req.body), () => ({ ok: true }));
  });

  // ── The agenda ────────────────────────────────────────────────────────────

  app.post("/api/sessions/:id/items", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-entries", max: ENTRIES_PER_HOUR });
    if (!w) return;
    answer(res, await addItem(w.pool, w.id, w.actor, req.body), (v) => ({ id: v.id }));
  });

  app.patch("/api/sessions/:id/items/:itemId", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const itemId = parseId(req.params?.itemId);
    if (itemId == null) return res.status(404).json({ error: R.itemUnknown });
    answer(res, await patchItem(w.pool, w.id, w.actor, itemId, req.body), () => ({ ok: true }));
  });

  // ── Entries ───────────────────────────────────────────────────────────────

  app.post("/api/sessions/:id/entries", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-entries", max: ENTRIES_PER_HOUR });
    if (!w) return;
    answer(res, await addEntry(w.pool, w.id, w.actor, req.body), (v) => ({ id: v.id }));
  });

  app.patch("/api/sessions/:id/entries/:entryId", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: R.entryUnknown });
    answer(res, await patchEntry(w.pool, w.id, w.actor, entryId, req.body), () => ({ ok: true }));
  });

  app.delete("/api/sessions/:id/entries/:entryId", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: R.entryUnknown });
    answer(res, await removeEntry(w.pool, w.id, w.actor, entryId), () => ({ ok: true }));
  });

  app.post("/api/sessions/:id/respond", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-respond", max: RESPONSES_PER_HOUR });
    if (!w) return;
    answer(res, await respond(w.pool, w.id, w.actor, req.body), () => ({ ok: true }));
  });

  // ── Running the room ──────────────────────────────────────────────────────

  app.post("/api/sessions/:id/act", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const action = parseSessionAction(req.body?.action);
    if (!action) return res.status(400).json({ error: R.actionUnknown });
    answer(res, await actInRoom(w.pool, w.id, w.actor, action), (v) => ({ ok: true, state: v.state }));
  });

  app.post("/api/sessions/:id/hosts", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    answer(res, await setHosts(w.pool, w.id, w.actor, req.body), () => ({ ok: true }));
  });

  /**
   * The close. Refused with the unowned actions' ids while any action has
   * nobody holding it. Once its transaction commits, the admins hear the
   * record is ready and each person holding an action hears it is theirs.
   */
  app.post("/api/sessions/:id/close", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const out = await closeSession(w.pool, w.id, w.actor, ctx);
    if (!out.ok) return res.status(out.status).json({ ...(out.body ?? {}), error: out.error });
    await noticesAfterClose(w.pool, out.value, { notify, notifyAdmins });
    res.json({ ok: true });
  });

  /**
   * An idea for this tool, from somebody who was in the room. It lands in the
   * village's own feedback inbox as an idea. It is recorded as NOT relayable:
   * the form says the idea goes to the village's inbox, and the disclosure a
   * form makes is the consent (server/routes/feedback.ts), so it stays home.
   */
  app.post("/api/sessions/:id/tool-feedback", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-tool:${uid}`, TOOL_IDEAS_PER_HOUR, HOUR_MS)) return slow(res);
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const text = cleanText(req.body?.text, SESSION_LIMITS.text);
    if (!text) return res.status(400).json({ error: R.textNeeded });
    const pool = getPool();
    const found = await sessionForViewer(pool, id, { no: await memberNo(pool, uid), admin: false });
    if (!found) return res.status(404).json({ error: R.notFound });
    if (!found.joined) return res.status(403).json({ error: R.joinFirst });
    await recordFeedback(
      pool,
      {
        kind: "idea",
        title: `${SESSION_COPY.listTitle}: ${cleanLine(text, 80) ?? ""}`,
        detail: text,
        pageUrl: `/sessions/${id}`,
        submittedBy: uid,
      },
      false,
    );
    res.json({ ok: true });
  });

  /** The record as markdown. `?for=shareable` is the version that names no one. */
  app.get("/api/sessions/:id/minutes.md", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    const viewer = { no: await memberNo(pool, String(user.id)), admin: await isAdmin(req) };
    const audience = req.query?.for === "shareable" ? "shareable" : "people";
    const out = await readMinutes(pool, id, viewer, audience);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="session-${id}${audience === "shareable" ? "-shareable" : ""}.md"`);
    res.setHeader("Cache-Control", "private, no-cache");
    res.send(out.value);
  });
}
