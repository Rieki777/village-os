/**
 * Live Sessions over HTTP: a circle holds a working call together, in real
 * time. Every door is the "Doors" list in shared/sessions.ts, which is the
 * contract, and every rule behind a door is server/lib/liveSessions.ts:
 *
 *   GET    /api/sessions                          { open, recent, circles, library, comingUp }
 *   POST   /api/sessions                          { title, circleId?, durationMin?, libraryIds? } -> { id }
 *   GET    /api/sessions/:id                      SessionView, with an ETag; 304 when nothing moved
 *   PATCH  /api/sessions/:id                      { title } -> { ok }
 *   DELETE /api/sessions/:id                      { ok }: discard an open session, or delete a closed record
 *   POST   /api/sessions/:id/join                 { ok }
 *   POST   /api/sessions/:id/here                 { ok }
 *   POST   /api/sessions/:id/arrival              { score, wish? } -> { ok }
 *   POST   /api/sessions/:id/items                { title, aim, minutes, fromSessionId? } -> { id }
 *   PATCH  /api/sessions/:id/items/:itemId        { title?, aim?, minutes?, position?, status?, presenterUserId? } -> { ok }
 *   POST   /api/sessions/:id/items/:itemId/vote   { vote: 1 | -1 | 0 } -> { ok }, never for someone else
 *   POST   /api/sessions/:id/agenda/order         { set } -> { ok, state }: the facilitator sets the voted order
 *   POST   /api/sessions/:id/entries              { kind, text, itemId?, ownerSeatId?, dueOn? } -> { id }
 *   PATCH  /api/sessions/:id/entries/:entryId     { claim?, release?, ownerSeatId?, text?, dueOn?, status? } -> { ok }
 *   DELETE /api/sessions/:id/entries/:entryId     { ok }
 *   POST   /api/sessions/:id/entries/:entryId/check   {} -> { ok }: the facilitator or the proposer checks a proposal (0297)
 *   POST   /api/sessions/:id/respond              { target, value, text? } -> { ok }, never for someone else
 *   POST   /api/sessions/:id/on-behalf/:fillId/undo   {} -> { ok }
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
 * member's token, before it touches the database. There is no guest door:
 * a signed-in account the village has not admitted yet (the Guest stage) is
 * refused 403 by the members-only gate below, admins excepted. The gate asks
 * `isAdmitted` on the platform's own ladder, the same answer the map's chips
 * and the vouch door read.
 *
 * THE MODULE GATE MOUNTS HERE, first, the way the journal mounts its own:
 * `requireModule("sessions")` in front of the whole prefix, so a village with
 * the module off answers 404 on every door below. The members-only gate
 * mounts right after it.
 *
 * A ROOM NOBODY CLOSES CLOSES ITSELF, lazily: reading the list sweeps every
 * quiet room (`closeStaleRooms`, one indexed read), and reading or joining a
 * room checks that one room when its row says it is old enough to be quiet.
 *
 * THE ROOM POLLS, AND A 304 IS NEARLY FREE. There is no push channel to a
 * browser in this server (server/routes/mapOrg.ts says why), so an open room
 * asks every ROOM_POLL_MS with the ETag it last saw. The tag is the session's
 * version, a presence bucket and the viewer, all known from one row, so an
 * unchanged room answers 304 before any of the view is built.
 *
 * THE FACILITATOR FILLS IN FOR SOMEBODY (0288, shared/sessionOnBehalf.ts).
 * The arrival, item and entry doors take a `forUserId`, and an entry's PATCH
 * an `ownerUserId`, from the person facilitating. Each door that can write a
 * fill-in tells the person after its transaction commits (`afterFills`), and
 * the undo door takes one back.
 *
 * NOTHING HERE RECORDS AN EVENT. `recordEvent` writes to a public audience by
 * default. The close tells the admins and the people holding actions through
 * the notification spine, after its transaction commits.
 *
 * THE TASK EMAILS START FROM THE CLOSE, AND NOTHING WAITS FOR THEM. Both
 * closes (the door below, and a quiet room closing itself inside a read) go
 * through `noticesAfterClose`, which starts `queueCloseMail` and returns. What
 * happens to a task after the call has its own doors in
 * server/routes/sessionTasks.ts.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { GAME_CONFIG } from "../../shared/gameConfig";
import { isAdmitted } from "../lib/admission";
import type { AppDeps } from "../lib/appDeps";
import { recordFeedback } from "../lib/feedback";
import {
  NIGHT_EVERY_MS,
  NIGHT_JOB,
  actInRoom,
  addEntry,
  answerAfterNight,
  addItem,
  buildView,
  checkEntry,
  cleanStart,
  closeSession,
  closeStaleRooms,
  decideAfterNight,
  defaultDuration,
  discardSession,
  ensureMemberNo,
  etagMatches,
  joinSession,
  listSessions,
  markHere,
  mayBeStale,
  maySee,
  memberNo,
  noticesAfterClose,
  noticesAfterNights,
  openSession,
  parseId,
  patchEntry,
  patchItem,
  patchSession,
  readMinutes,
  removeEntry,
  respond,
  saveArrival,
  sessionEtag,
  sessionForViewer,
  setHosts,
  settleNights,
  undoFill,
  voteOnItem,
  setAgendaOrder,
  type Actor,
  type MemberLookup,
  type Outcome,
  type Viewer,
} from "../lib/liveSessions";
import { requireModule } from "../lib/modules";
import { registerJob } from "../lib/scheduler";
import { libraryFor, noticesAfterTakes, reconcileLibrary } from "../lib/sessionLibrary";
import { noticesAfterFills } from "../lib/sessionOnBehalf";
import { comingUpFor } from "../lib/sessionRhythm";
import { linkSession, seasonRefOf, templateForStart } from "../lib/sessionTemplates";
import { saberraAgentName, saberraOpenToMembers } from "../lib/saberraGuide";
import { CHECK_REFUSALS } from "../../shared/sessionCheck";
import { queueCloseMail } from "../lib/sessionTaskMail";
import {
  SESSION_COPY,
  SESSION_LIMITS,
  SESSION_REFUSALS as R,
  SESSIONS_API,
  cleanLine,
  cleanText,
  parseSessionAction,
} from "../../shared/sessions";
import { ON_BEHALF_REFUSALS as OB } from "../../shared/sessionOnBehalf";

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
 * `lapseContext` reads which seat holders' terms still run. `seasonState` gives
 * a proposal's check the running season's priorities (0297). The post office,
 * the spine's member reader, the origin and the village's name are for the
 * task emails a close starts (server/lib/sessionTaskMail.ts).
 */
type Deps = Pick<
  AppDeps,
  | "authedUser"
  | "isAdmin"
  | "getPool"
  | "overLimit"
  | "members"
  | "notify"
  | "notifyAdmins"
  | "circlesRepo"
  | "lapseContext"
  | "seasonState"
  | "notifyDeps"
  | "commsPostOffice"
  | "deploymentOrigin"
  | "projectName"
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
/** Sessions one member may discard or records one admin may delete in an hour: a test or a mistake, not a sweep. */
const DISCARDS_PER_HOUR = 30;
/** Ideas for the tool in an hour. */
const TOOL_IDEAS_PER_HOUR = 10;
/** Answers after a night and decisions marked from a record (0281): a person answers a handful at most. */
const NIGHT_WRITES_PER_HOUR = 60;
/** Proposal checks in an hour (0297): a facilitator checking each proposal of a long call, and again after a reword. */
const CHECKS_PER_HOUR = 120;
/** How long a person's name is remembered between polls. */
const NAME_TTL_MS = 30_000;

export function register(app: Express, deps: Deps): void {
  const { authedUser, isAdmin, getPool, overLimit, members, notify, notifyAdmins, circlesRepo } = deps;

  app.use(SESSIONS_API, requireModule("sessions"));

  /**
   * Members only. A signed-in account the village has not admitted is a guest,
   * and a guest gets one sentence and no room. An admin passes either way.
   * Nobody signed in passes through to the door, which answers 401 itself
   * before it touches the database.
   */
  app.use(SESSIONS_API, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authedUser(req);
      if (user && !isAdmitted(user, GAME_CONFIG.stages) && !(await isAdmin(req))) {
        return res.status(403).json({ error: R.membersOnly });
      }
      next();
    } catch (e) {
      next(e);
    }
  });

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
  /** A proposal's check (0297) is offered while the module that names its agent is open to members. */
  const checkOffer = () => (saberraOpenToMembers() ? { agent: saberraAgentName() } : null);
  const ctx = { lookup, circleName, lapseContext: deps.lapseContext, circles, check: checkOffer };
  /** The close's task emails, started and left. Absent when the post office is not wired, as in a suite. */
  const closeMail = deps.commsPostOffice
    ? (sessionId: number) => {
        void queueCloseMail(deps, sessionId).catch((e) => console.error(`[sessions] the task emails for session ${sessionId} did not go`, e));
      }
    : undefined;
  const notices = { notify, notifyAdmins, lapseContext: deps.lapseContext, closeMail };
  // A round that outlived its call settles once no night on it lasts (0281).
  registerJob(NIGHT_JOB, NIGHT_EVERY_MS, () => settleNights(getPool(), lookup, { notify }));

  /**
   * One room's row for a read or a join, after closing it if it has gone quiet
   * for good. Only a row old enough to be quiet pays for the extra read, so the
   * poll of a room in use costs what it did.
   */
  const current = async (pool: Parameters<typeof sessionForViewer>[0], id: number, viewer: Viewer) => {
    const found = await sessionForViewer(pool, id, viewer);
    if (!found || !mayBeStale(found.s, Date.now())) return found;
    const closed = await closeStaleRooms(pool, ctx, notices, new Date(), id);
    return closed.length ? sessionForViewer(pool, id, viewer) : found;
  };

  // ── Answering ─────────────────────────────────────────────────────────────

  const answer = <T>(res: Response, out: Outcome<T>, ok: (v: T) => unknown) =>
    out.ok ? res.json(ok(out.value)) : res.status(out.status).json({ ...(out.body ?? {}), error: out.error });

  const slow = (res: Response) => res.status(429).json({ error: R.slowDown });

  /**
   * A write that may have filled something in for somebody: answer, then tell
   * the person (0288). The notice waits for the commit, which `inRoom` has
   * made by the time the outcome is here.
   */
  const answerFilled = async <T>(res: Response, w: { pool: ReturnType<typeof getPool>; id: number }, out: Outcome<T>, ok: (v: T) => unknown) => {
    if (out.ok) await noticesAfterFills(w.pool, w.id, { notify });
    answer(res, out, ok);
  };

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
    const admin = await isAdmin(req);
    const viewer = { no: await memberNo(pool, String(user.id)), admin };
    // A room nobody closed closes now, so the list never offers its arrival round to a late joiner.
    await closeStaleRooms(pool, ctx, notices);
    // And an item a session left on its agenda without settling it is mended before the list is read.
    await reconcileLibrary(pool);
    const lists = await listSessions(pool, viewer, ctx);
    const library = await libraryFor(pool, { userId: String(user.id), admin }, ctx);
    // Each circle's next meeting, from its rhythm (server/lib/sessionRhythm.ts).
    const comingUp = await comingUpFor(pool, { userId: String(user.id), admin }, { circles, lapseContext: deps.lapseContext });
    res.json({ ...lists, circles: circles(), defaultMinutes: defaultDuration(), library, comingUp });
  });

  /**
   * Open a room. `libraryIds`, when sent, are the agenda library's items to
   * put on its agenda in that order, all or none (`openSession`). Whoever
   * brought each one hears it is on the agenda, after the commit.
   */
  app.post("/api/sessions", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-start:${uid}`, STARTS_PER_HOUR, HOUR_MS)) return slow(res);
    const input = cleanStart(req.body, new Set(circles().map((c) => c.id)));
    if (!input.ok) return res.status(input.status).json({ error: input.error });
    const pool = getPool();
    // A meeting template (0291, shared/sessionTemplates.ts): checked before the room opens, linked once it has.
    const template = await templateForStart(pool, req.body?.templateId);
    if (!template.ok) return res.status(template.status).json({ error: template.error });
    const no = await ensureMemberNo(pool, uid);
    const out = await openSession(pool, { no, userId: uid, admin: await isAdmin(req) }, input.value, req.body?.libraryIds, ctx);
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    if (template.value) await linkSession(pool, out.value.id, template.value.id);
    await noticesAfterTakes(pool, { notify }, { sessionTitle: input.value.title, takerNo: no, taken: out.value.taken });
    res.json({ id: out.value.id });
  });

  // ── The room ──────────────────────────────────────────────────────────────

  app.get("/api/sessions/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    // Their own id rides along so "From last time" reads their seats before they have a number.
    const viewer = { no: await memberNo(pool, String(user.id)), admin: await isAdmin(req), userId: String(user.id) };
    const found = await current(pool, id, viewer);
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

  /**
   * The session's title: the facilitator, the secretary, or an admin who has
   * joined. Behind the same gates as an item's PATCH, and an unchanged title
   * answers ok without moving the room's version.
   */
  app.patch("/api/sessions/:id", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    answer(res, await patchSession(w.pool, w.id, w.actor, req.body), () => ({ ok: true }));
  });

  /**
   * Discard an open session, or delete a closed record: a real delete, and
   * every row the session holds goes with it (`discardSession`). The open
   * room's facilitator or an admin, joined or not; a closed record, an admin
   * only. Asks no seat in the room, so it reads the viewer the way the room's
   * GET does. Everybody else in an open room finds it gone on their next poll.
   */
  app.delete("/api/sessions/:id", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-discard:${uid}`, DISCARDS_PER_HOUR, HOUR_MS)) return slow(res);
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    const viewer = { no: await memberNo(pool, uid), admin: await isAdmin(req) };
    answer(res, await discardSession(pool, id, viewer), () => ({ ok: true }));
  });

  app.post("/api/sessions/:id/join", async (req, res) => {
    const user = await authedUser(req);
    if (!user) return res.status(401).json({ error: "auth_required" });
    const uid = String(user.id);
    if (await overLimit(`sessions-join:${uid}`, JOINS_PER_HOUR, HOUR_MS)) return slow(res);
    const id = parseId(req.params?.id);
    if (id == null) return res.status(404).json({ error: R.notFound });
    const pool = getPool();
    // Refuse a missing or closed room before handing out a number. A room that
    // went quiet closes here, so nobody joins it to read its arrival round.
    const found = await current(pool, id, { no: null, admin: false });
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
    await answerFilled(res, w, await saveArrival(w.pool, w.id, w.actor, req.body), () => ({ ok: true }));
  });

  // ── The agenda ────────────────────────────────────────────────────────────

  app.post("/api/sessions/:id/items", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-entries", max: ENTRIES_PER_HOUR });
    if (!w) return;
    await answerFilled(res, w, await addItem(w.pool, w.id, w.actor, req.body), (v) => ({ id: v.id }));
  });

  app.patch("/api/sessions/:id/items/:itemId", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const itemId = parseId(req.params?.itemId);
    if (itemId == null) return res.status(404).json({ error: R.itemUnknown });
    await answerFilled(res, w, await patchItem(w.pool, w.id, w.actor, itemId, req.body), () => ({ ok: true }));
  });

  /** The room votes its agenda (0290): one vote per person per waiting item, their own. */
  app.post("/api/sessions/:id/items/:itemId/vote", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-respond", max: RESPONSES_PER_HOUR });
    if (!w) return;
    const itemId = parseId(req.params?.itemId);
    if (itemId == null) return res.status(404).json({ error: R.itemUnknown });
    answer(res, await voteOnItem(w.pool, w.id, w.actor, itemId, req.body), () => ({ ok: true }));
  });

  app.post("/api/sessions/:id/agenda/order", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    answer(res, await setAgendaOrder(w.pool, w.id, w.actor, req.body), (v) => ({ ok: true, state: v.state }));
  });

  // ── Entries ───────────────────────────────────────────────────────────────

  app.post("/api/sessions/:id/entries", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-entries", max: ENTRIES_PER_HOUR });
    if (!w) return;
    await answerFilled(res, w, await addEntry(w.pool, w.id, w.actor, req.body), (v) => ({ id: v.id }));
  });

  app.patch("/api/sessions/:id/entries/:entryId", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: R.entryUnknown });
    await answerFilled(res, w, await patchEntry(w.pool, w.id, w.actor, entryId, req.body), () => ({ ok: true }));
  });

  app.delete("/api/sessions/:id/entries/:entryId", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: R.entryUnknown });
    answer(res, await removeEntry(w.pool, w.id, w.actor, entryId), () => ({ ok: true }));
  });

  /** Check a proposal (0297, shared/sessionCheck.ts): its facilitator or its proposer, while it is open. */
  app.post("/api/sessions/:id/entries/:entryId/check", async (req, res) => {
    // Who is asking comes first, as on every door: a stranger hears 401 and never what the village offers.
    const w = await writer(req, res, { key: "sessions-check", max: CHECKS_PER_HOUR });
    if (!w) return;
    if (!checkOffer()) return res.status(404).json({ error: CHECK_REFUSALS.off });
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: R.entryUnknown });
    const season = seasonRefOf(deps.seasonState?.().current ?? null);
    answer(res, await checkEntry(w.pool, w.id, w.actor, entryId, { season, lapseContext: deps.lapseContext }), () => ({ ok: true }));
  });

  app.post("/api/sessions/:id/respond", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-respond", max: RESPONSES_PER_HOUR });
    if (!w) return;
    answer(res, await respond(w.pool, w.id, w.actor, req.body), () => ({ ok: true }));
  });

  /** Take back something the facilitator filled in: the person it was for, or the facilitator (0288). */
  app.post("/api/sessions/:id/on-behalf/:fillId/undo", async (req, res) => {
    const w = await writer(req, res);
    if (!w) return;
    const fillId = parseId(req.params?.fillId);
    if (fillId == null) return res.status(404).json({ error: OB.fillUnknown });
    answer(res, await undoFill(w.pool, w.id, w.actor, fillId), () => ({ ok: true }));
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
    await noticesAfterClose(w.pool, out.value, notices);
    res.json({ ok: true });
  });

  /**
   * A round that outlived its call (0281): somebody who asked for a night
   * answers it from the record, by their time. `{ entryId, value, text }`.
   * When the answer settles the round, its facilitator hears how it went.
   */
  app.post("/api/sessions/:id/night", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-night", max: NIGHT_WRITES_PER_HOUR });
    if (!w) return;
    const out = await answerAfterNight(w.pool, w.id, w.actor, req.body, lookup);
    if (!out.ok) return res.status(out.status).json({ ...(out.body ?? {}), error: out.error });
    if (out.value.settled) await noticesAfterNights(w.pool, [out.value.settled], { notify });
    res.json({ ok: true });
  });

  /** The facilitator, or an admin, marks a round that consented after its call decided, from the record. */
  app.post("/api/sessions/:id/entries/:entryId/decide", async (req, res) => {
    const w = await writer(req, res, { key: "sessions-night", max: NIGHT_WRITES_PER_HOUR });
    if (!w) return;
    const entryId = parseId(req.params?.entryId);
    if (entryId == null) return res.status(404).json({ error: R.entryUnknown });
    const out = await decideAfterNight(w.pool, w.id, entryId, w.actor, lookup);
    answer(res, out, () => ({ ok: true }));
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
